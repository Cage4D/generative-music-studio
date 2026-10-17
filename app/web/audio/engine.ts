import * as Tone from "tone";
import { effectAmount, FILTER_MAX_HZ, filterCutoff } from "./effects";
import { generateArpeggio } from "./generators/arpeggio";
import { generateMelody } from "./generators/melody";
import { stepSeconds } from "./theory";
import { readDevFlags, type DevFlags } from "./dev-flags";
import { hashEvents } from "./hash";
import type { EffectId } from "../lib/studio-state";
import type {
  ArpeggioParams,
  MelodyParams,
  NoteEvent,
  Voice,
  VoiceKind,
} from "./types";

export type StepListener = (step: number) => void;

// Serial order of the effect chain, head (voice input) to tail (limiter).
const EFFECT_ORDER: EffectId[] = [
  "distortion",
  "phaser",
  "chorus",
  "vibrato",
  "filter",
  "tremolo",
  "delay",
  "reverb",
];

type PersistentInstrument = {
  kind: VoiceKind;
  source: Tone.MonoSynth | Tone.FMSynth | Tone.Synth;
  level: Tone.Gain;
  nodes: Tone.ToneAudioNode[];
  configure: (voice: Voice) => void;
};

export type EngineParams = ArpeggioParams | MelodyParams;

function isMelodyParams(params: EngineParams): params is MelodyParams {
  return "melody" in params;
}

type StepItem = {
  index: number;
  note: NoteEvent | null;
};

const TONE_LOOKAHEAD = 0.1;
const VOICE_FADE = 0.05;
const REBUILD_DEBOUNCE_MS = 120;
const MASTER_LIMIT_DB = -1;
const METER_INTERVAL_MS = 1000;
const DRIFT_INTERVAL_MS = 50;
const DRIFT_WARN_MS = 30;
const STEP_WARN_MS = 3;
const FX_RAMP_SECONDS = 0.05;
const CHAIN_SETTLE_MS = FX_RAMP_SECONDS * 1000 + 30;
// Minimum gap enforced between consecutive synth note starts so that a
// jank-delayed step (whose time fell behind context.currentTime and got
// clamped by Tone) can never reuse the previous note's start time.
const SCHEDULE_EPSILON = 0.001;
const isDev = process.env.NODE_ENV !== "production";

// Dev-only stand-ins used by `?voice=`, so a forced kind always has valid params.
const FORCED_VOICES: Record<VoiceKind, Voice> = {
  pluck: {
    kind: "pluck",
    waveform: "triangle",
    attack: 0.005,
    decay: 0.2,
    sustain: 0.15,
    release: 0.2,
    filterStart: 800,
    filterEnd: 3000,
    filterSweep: 0.2,
    gain: 0.75,
  },
  bell: {
    kind: "bell",
    carrier: "sine",
    modulator: "sine",
    harmonicity: 2,
    modulationIndex: 8,
    attack: 0.005,
    decay: 0.6,
    sustain: 0.1,
    release: 0.8,
    gain: 0.5,
  },
  soft: {
    kind: "soft",
    waveform: "sine",
    attack: 0.05,
    decay: 0.3,
    sustain: 0.7,
    release: 0.6,
    vibratoFrequency: 5,
    vibratoDepth: 0.05,
    gain: 0.95,
  },
  buzz: {
    kind: "buzz",
    waveform: "sawtooth",
    attack: 0.01,
    decay: 0.2,
    sustain: 0.6,
    release: 0.3,
    filterFrequency: 1200,
    filterQ: 2,
    gain: 0.6,
  },
};

let toneContextReady = false;

/**
 * Configure the shared Tone context once, before any node is created. A
 * "playback" latency hint (and a slightly larger lookAhead) trades a little
 * responsiveness for a much bigger scheduling buffer, which is what prevents
 * the arpeggio from stuttering when the main thread is busy.
 */
export function ensureToneContext(): void {
  if (toneContextReady) return;
  if (typeof window === "undefined") return;
  toneContextReady = true;
  Tone.setContext(new Tone.Context({ latencyHint: "playback", lookAhead: TONE_LOOKAHEAD }));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function contextInfo(): string {
  try {
    const context = Tone.getContext();
    const raw = context.rawContext as AudioContext;
    const baseLatency =
      typeof raw.baseLatency === "number" ? raw.baseLatency.toFixed(4) : "n/a";
    return `state=${context.state} baseLatency=${baseLatency}`;
  } catch {
    return "state=n/a";
  }
}

// Settings that change the note stream (or the sequence subdivision) trigger a
// rebuild. Playback-only settings (tempo, swing, effects) intentionally do not.
function eventSignature(params: EngineParams): string {
  if (isMelodyParams(params)) {
    const block = params.melody;
    return [
      "melody",
      params.seed,
      params.root,
      params.scale,
      params.density,
      block.contour,
      block.octaveRange,
      block.noteLength,
      block.restProbability,
      block.leapiness,
      block.phraseLengthBars,
      block.waveform,
    ].join("|");
  }
  const block = params.arpeggio;
  return [
    "arpeggio",
    params.seed,
    params.root,
    params.scale,
    params.density,
    block.pattern,
    block.octaves,
    block.stepLength,
  ].join("|");
}

export class ArpeggioEngine {
  onStep: StepListener | null = null;

  private readonly distortion: Tone.Distortion;
  private readonly phaser: Tone.Phaser;
  private readonly chorus: Tone.Chorus;
  private readonly vibrato: Tone.Vibrato;
  private readonly filter: Tone.Filter;
  private readonly tremolo: Tone.Tremolo;
  private readonly delay: Tone.FeedbackDelay;
  private readonly reverb: Tone.Freeverb;
  private readonly limiter: Tone.Limiter;
  private readonly meter: Tone.Meter;
  private readonly chainInput: Tone.Gain;
  private readonly flags: DevFlags;

  private readonly instruments: Record<VoiceKind, PersistentInstrument>;
  private activeKind: VoiceKind | null = null;

  private sequence: Tone.Sequence<StepItem> | null = null;
  private params: EngineParams | null = null;
  private generatorId: "arpeggio" | "melody" = "arpeggio";
  private activeStepLength = "16n";
  private signature = "";
  private voiceSignature = "";
  private pendingSignature: string | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private chainTimer: ReturnType<typeof setTimeout> | null = null;
  private chainKeys: EffectId[] = [];
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private driftVisibilityHandler: (() => void) | null = null;
  private lastDrift = 0;
  private visibleSince = 0;
  private lastNoteStart = -Infinity;
  private running = false;
  private disposed = false;

  constructor() {
    ensureToneContext();
    this.flags = readDevFlags();

    this.distortion = new Tone.Distortion({ distortion: 0, wet: 0 });
    this.phaser = new Tone.Phaser({
      frequency: 0.5,
      octaves: 3,
      baseFrequency: 350,
      wet: 0,
    });
    this.chorus = new Tone.Chorus({
      frequency: 1.5,
      delayTime: 3.5,
      depth: 0.7,
      wet: 0,
    });
    this.vibrato = new Tone.Vibrato({ frequency: 5, depth: 0, wet: 0 });
    this.filter = new Tone.Filter(FILTER_MAX_HZ, "lowpass");
    this.tremolo = new Tone.Tremolo({ frequency: 4, depth: 0, wet: 0 });
    this.delay = new Tone.FeedbackDelay({
      delayTime: "8n.",
      feedback: 0.35,
      wet: 0,
    });
    this.reverb = new Tone.Freeverb({ roomSize: 0.8, dampening: 3000, wet: 0 });
    this.limiter = new Tone.Limiter(MASTER_LIMIT_DB);
    this.meter = new Tone.Meter();
    this.chainInput = new Tone.Gain(1);

    this.chorus.start();
    this.tremolo.start();

    this.limiter.connect(this.meter);
    this.limiter.toDestination();

    // Wire the currently-audible effects (none until params arrive).
    this.wireChain(this.activeEffects());

    this.instruments = this.buildInstruments();

    if (isDev) this.startMeterMonitor();
    this.startDriftMonitor();
  }

  async prepare(): Promise<void> {
    if (this.disposed) return;
    if (isDev) {
      console.warn(`[arpeggio] chain=[${this.chainKeys.join(", ") || "dry"}]`);
      const raw = Tone.getContext().rawContext as AudioContext;
      const baseLatency =
        typeof raw.baseLatency === "number" ? raw.baseLatency : "n/a";
      const outputLatency =
        typeof raw.outputLatency === "number" ? raw.outputLatency : "n/a";
      console.debug(
        `[arpeggio] prepare reverbRoomSize=${this.reverb.roomSize.value} reverbDampening=${this.reverb.dampening} latency baseLatency=${baseLatency} outputLatency=${outputLatency} ${contextInfo()}`,
      );
    }
  }

  async start(params: EngineParams): Promise<void> {
    if (this.disposed) return;
    this.params = params;
    await Tone.getContext().resume();
    if (this.disposed) return;
    this.clearPendingRebuild();
    this.applyLive();
    this.signature = eventSignature(params);
    this.lastNoteStart = -Infinity;
    this.buildSequence();
    const transport = Tone.getTransport();
    transport.bpm.value = params.tempo;
    transport.swing = 0;
    transport.position = 0;
    this.running = true;
    transport.start();
  }

  update(params: EngineParams): void {
    if (this.disposed) return;
    this.params = params;
    this.applyLive();
    if (!this.running) {
      this.signature = eventSignature(params);
      this.clearPendingRebuild();
      return;
    }
    const next = eventSignature(params);
    if (next === this.pendingSignature) return;
    if (next === this.signature) {
      this.clearPendingRebuild();
      return;
    }
    this.scheduleRebuild(next);
  }

  stop(): void {
    if (this.disposed) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    this.clearPendingRebuild();
    this.disposeSequence();
    this.running = false;
    this.onStep?.(-1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    this.clearPendingRebuild();
    if (this.chainTimer) {
      clearTimeout(this.chainTimer);
      this.chainTimer = null;
    }
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    if (this.driftTimer) {
      clearInterval(this.driftTimer);
      this.driftTimer = null;
    }
    if (this.driftVisibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.driftVisibilityHandler);
      this.driftVisibilityHandler = null;
    }
    this.disposeSequence();
    this.onStep = null;

    for (const kind of Object.keys(this.instruments) as VoiceKind[]) {
      for (const node of this.instruments[kind].nodes) {
        try {
          node.dispose();
        } catch {
          // Already disposed.
        }
      }
    }

    this.distortion.dispose();
    this.phaser.dispose();
    this.chorus.dispose();
    this.vibrato.dispose();
    this.filter.dispose();
    this.tremolo.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.limiter.dispose();
    this.meter.dispose();
    this.chainInput.dispose();
  }

  isRunning(): boolean {
    return this.running;
  }

  private buildInstruments(): Record<VoiceKind, PersistentInstrument> {
    const makeLevel = (): Tone.Gain => {
      const level = new Tone.Gain(0);
      level.connect(this.chainInput);
      return level;
    };

    const pluckSource = new Tone.MonoSynth({ oscillator: { type: "triangle" } });
    const pluckLevel = makeLevel();
    pluckSource.connect(pluckLevel);

    const buzzSource = new Tone.MonoSynth({ oscillator: { type: "sawtooth" } });
    const buzzLevel = makeLevel();
    buzzSource.connect(buzzLevel);

    const bellSource = new Tone.FMSynth();
    const bellLevel = makeLevel();
    bellSource.connect(bellLevel);

    const softSource = new Tone.Synth({ oscillator: { type: "sine" } });
    const softVibrato = new Tone.Vibrato(5, 0.05);
    const softLevel = makeLevel();
    softSource.connect(softVibrato);
    softVibrato.connect(softLevel);

    return {
      pluck: {
        kind: "pluck",
        source: pluckSource,
        level: pluckLevel,
        nodes: [pluckSource, pluckLevel],
        configure: (voice) => {
          if (voice.kind !== "pluck") return;
          pluckSource.set({
            oscillator: { type: voice.waveform },
            envelope: {
              attack: voice.attack,
              decay: voice.decay,
              sustain: voice.sustain,
              release: voice.release,
            },
            filter: { type: "lowpass", Q: 1 },
            filterEnvelope: {
              attack: 0.001,
              decay: voice.filterSweep,
              sustain: 0,
              release: voice.release,
              baseFrequency: voice.filterStart,
              octaves: Math.max(0, Math.log2(voice.filterEnd / voice.filterStart)),
            },
          });
          pluckSource.volume.value = Tone.gainToDb(voice.gain);
        },
      },
      bell: {
        kind: "bell",
        source: bellSource,
        level: bellLevel,
        nodes: [bellSource, bellLevel],
        configure: (voice) => {
          if (voice.kind !== "bell") return;
          bellSource.set({
            harmonicity: voice.harmonicity,
            modulationIndex: voice.modulationIndex,
            oscillator: { type: voice.carrier },
            modulation: { type: voice.modulator },
            envelope: {
              attack: voice.attack,
              decay: voice.decay,
              sustain: voice.sustain,
              release: voice.release,
            },
            modulationEnvelope: {
              attack: voice.attack,
              decay: voice.decay,
              sustain: voice.sustain,
              release: voice.release,
            },
          });
          bellSource.volume.value = Tone.gainToDb(voice.gain);
        },
      },
      soft: {
        kind: "soft",
        source: softSource,
        level: softLevel,
        nodes: [softSource, softVibrato, softLevel],
        configure: (voice) => {
          if (voice.kind !== "soft") return;
          softSource.set({
            oscillator: { type: voice.waveform },
            envelope: {
              attack: voice.attack,
              decay: voice.decay,
              sustain: voice.sustain,
              release: voice.release,
            },
          });
          softVibrato.frequency.value = voice.vibratoFrequency;
          softVibrato.depth.value = voice.vibratoDepth;
          softSource.volume.value = Tone.gainToDb(voice.gain);
        },
      },
      buzz: {
        kind: "buzz",
        source: buzzSource,
        level: buzzLevel,
        nodes: [buzzSource, buzzLevel],
        configure: (voice) => {
          if (voice.kind !== "buzz") return;
          buzzSource.set({
            oscillator: { type: voice.waveform },
            envelope: {
              attack: voice.attack,
              decay: voice.decay,
              sustain: voice.sustain,
              release: voice.release,
            },
            filter: { type: "lowpass", Q: voice.filterQ },
            filterEnvelope: {
              attack: 0.001,
              decay: 0.2,
              sustain: 1,
              release: voice.release,
              baseFrequency: voice.filterFrequency,
              octaves: 0,
            },
          });
          buzzSource.volume.value = Tone.gainToDb(voice.gain);
        },
      },
    };
  }

  private applyLive(): void {
    const params = this.params;
    if (!params) return;
    const transport = Tone.getTransport();
    transport.bpm.value = params.tempo;
    transport.swing = 0;
    this.applyEffects();
  }

  private applyEffects(): void {
    const effects = this.params?.effects ?? {};
    this.reverb.wet.rampTo(effectAmount(effects, "reverb"), FX_RAMP_SECONDS);
    this.delay.wet.rampTo(effectAmount(effects, "delay"), FX_RAMP_SECONDS);

    const chorus = effectAmount(effects, "chorus");
    this.chorus.wet.rampTo(chorus, FX_RAMP_SECONDS);
    this.chorus.depth = chorus;

    this.phaser.wet.rampTo(effectAmount(effects, "phaser"), FX_RAMP_SECONDS);

    const distortion = effectAmount(effects, "distortion");
    this.distortion.wet.rampTo(distortion, FX_RAMP_SECONDS);
    this.distortion.distortion = distortion;

    this.filter.frequency.rampTo(
      filterCutoff(effectAmount(effects, "filter")),
      FX_RAMP_SECONDS,
    );

    const vibrato = effectAmount(effects, "vibrato");
    this.vibrato.wet.rampTo(vibrato, FX_RAMP_SECONDS);
    this.vibrato.depth.rampTo(vibrato, FX_RAMP_SECONDS);

    const tremolo = effectAmount(effects, "tremolo");
    this.tremolo.wet.rampTo(tremolo, FX_RAMP_SECONDS);
    this.tremolo.depth.rampTo(tremolo, FX_RAMP_SECONDS);

    this.scheduleChainUpdate();
  }

  // Effects whose amount is > 0 (and not excluded by `?fx=`) belong in the
  // audible chain. Everything else is disconnected so it stops processing.
  private activeEffects(): EffectId[] {
    const effects = this.params?.effects ?? {};
    return EFFECT_ORDER.filter((key) => {
      if (this.flags.fxOff) return false;
      if (this.flags.removedFx.includes(key)) return false;
      return effectAmount(effects, key) > 0;
    });
  }

  private effectNode(key: EffectId): Tone.ToneAudioNode {
    switch (key) {
      case "distortion":
        return this.distortion;
      case "phaser":
        return this.phaser;
      case "chorus":
        return this.chorus;
      case "vibrato":
        return this.vibrato;
      case "filter":
        return this.filter;
      case "tremolo":
        return this.tremolo;
      case "delay":
        return this.delay;
      case "reverb":
        return this.reverb;
    }
  }

  private rebuildChain(keys: EffectId[]): void {
    if (
      keys.length === this.chainKeys.length &&
      keys.every((key, index) => key === this.chainKeys[index])
    ) {
      return;
    }
    this.wireChain(keys);
  }

  private wireChain(keys: EffectId[]): void {
    this.chainInput.disconnect();
    for (const key of EFFECT_ORDER) this.effectNode(key).disconnect();

    let prev: Tone.ToneAudioNode = this.chainInput;
    for (const key of EFFECT_ORDER) {
      if (!keys.includes(key)) continue;
      const node = this.effectNode(key);
      prev.connect(node);
      prev = node;
    }
    prev.connect(this.limiter);

    this.chainKeys = keys;
    if (isDev) {
      console.warn(`[arpeggio] chain=[${keys.join(", ") || "dry"}]`);
    }
  }

  private scheduleChainUpdate(): void {
    const next = this.activeEffects();
    const nextSet = new Set(next);
    const prevSet = new Set(this.chainKeys);

    // Join newly-active effects immediately: their wet is ramping up from 0, so
    // they enter transparent and never click. Effects leaving the chain keep
    // playing until their wet ramp reaches 0, then are disconnected.
    const union = EFFECT_ORDER.filter(
      (key) => prevSet.has(key) || nextSet.has(key),
    );
    this.rebuildChain(union);

    if (this.chainTimer) clearTimeout(this.chainTimer);
    this.chainTimer = setTimeout(() => {
      this.chainTimer = null;
      if (this.disposed) return;
      this.rebuildChain(this.activeEffects());
    }, CHAIN_SETTLE_MS);
  }

  private scheduleRebuild(next: string): void {
    this.pendingSignature = next;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      const pending = this.pendingSignature;
      this.pendingSignature = null;
      if (this.disposed || pending === null || pending === this.signature) return;
      this.signature = pending;
      this.buildSequence();
    }, REBUILD_DEBOUNCE_MS);
  }

  private clearPendingRebuild(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.pendingSignature = null;
  }

  private buildSequence(): void {
    const params = this.params;
    if (!params) return;
    const start = now();
    const melody = isMelodyParams(params);
    const result = melody ? generateMelody(params) : generateArpeggio(params);
    const { events, voice, archetype } = result;
    this.generatorId = melody ? "melody" : "arpeggio";
    this.activeStepLength = melody
      ? params.melody.noteLength
      : params.arpeggio.stepLength;
    const finalVoice = this.flags.forcedVoice
      ? FORCED_VOICES[this.flags.forcedVoice]
      : voice;
    const generated = now();
    this.applyVoice(finalVoice);
    this.disposeSequence();
    const items: StepItem[] = events.map((note, index) => ({ index, note }));
    const sequence = new Tone.Sequence<StepItem>(
      (time, item) => this.onSequenceStep(time, item),
      items,
      this.activeStepLength,
    );
    sequence.loop = true;
    const transport = Tone.getTransport();
    sequence.start(this.running ? transport.position : 0);
    this.sequence = sequence;
    const done = now();
    if (isDev) {
      const sounding = events.filter((event) => event !== null).length;
      console.debug(
        `[${this.generatorId}] buildSequence seed=${params.seed} archetype=${archetype} kind=${finalVoice.kind} sounding=${sounding} hash=${hashEvents(events)} generate=${(generated - start).toFixed(2)}ms total=${(done - start).toFixed(2)}ms ${contextInfo()}`,
      );
    }
  }

  private applyVoice(voice: Voice): void {
    const signature = JSON.stringify(voice);
    if (signature === this.voiceSignature) return;
    const kindChanged = this.activeKind !== voice.kind;
    const start = now();
    this.voiceSignature = signature;
    this.instruments[voice.kind].configure(voice);
    this.activeKind = voice.kind;
    for (const kind of Object.keys(this.instruments) as VoiceKind[]) {
      const gain = this.instruments[kind].level.gain;
      gain.cancelScheduledValues(Tone.now());
      gain.rampTo(kind === voice.kind ? 1 : 0, VOICE_FADE);
    }
    if (isDev) {
      console.debug(
        `[arpeggio] voice kind=${voice.kind} ${kindChanged ? "switch" : "update"} ${(now() - start).toFixed(2)}ms`,
      );
    }
  }

  private onSequenceStep(time: number, item: StepItem): void {
    if (this.disposed) return;
    const start = now();
    if (this.onStep) {
      const step = item.index;
      Tone.getDraw().schedule(() => this.onStep?.(step), time);
    }
    const instrument = this.activeKind ? this.instruments[this.activeKind] : null;
    if (item.note && this.params && instrument) {
      const seconds = stepSeconds(this.activeStepLength, this.params.tempo);
      const offset =
        item.index % 2 === 1 ? (this.params.swing * seconds) / 3 : 0;
      // Keep starts strictly increasing: if this step is late, Tone would clamp
      // it to context.currentTime, which can collide with the previous note.
      const startTime = Math.max(
        time + offset,
        Tone.now(),
        this.lastNoteStart + SCHEDULE_EPSILON,
      );
      this.lastNoteStart = startTime;
      instrument.source.triggerAttackRelease(
        Tone.Frequency(item.note.midi, "midi").toFrequency(),
        item.note.gate * seconds,
        startTime,
        item.note.velocity,
      );
    }
    if (isDev) {
      const elapsed = now() - start;
      console.debug(
        `[${this.generatorId}] step ${item.index} callback=${elapsed.toFixed(2)}ms`,
      );
      if (elapsed > STEP_WARN_MS) {
        console.warn(
          `[${this.generatorId}] step ${item.index} callback ${elapsed.toFixed(2)}ms exceeds ${STEP_WARN_MS}ms`,
        );
      }
    }
  }

  private startMeterMonitor(): void {
    this.meterTimer = setInterval(() => {
      if (!this.running) return;
      const value = this.meter.getValue();
      const peak = Array.isArray(value)
        ? Math.max(...value)
        : value;
      if (!Number.isFinite(peak)) return;
      console.debug(`[arpeggio] master peak ${peak.toFixed(2)} dB`);
      if (peak > MASTER_LIMIT_DB) {
        console.warn(
          `[arpeggio] master peak ${peak.toFixed(2)} dB exceeds ${MASTER_LIMIT_DB} dB`,
        );
      }
    }, METER_INTERVAL_MS);
  }

  private startDriftMonitor(): void {
    if (!isDev) return;
    if (typeof document === "undefined") return;
    this.lastDrift = now();
    this.visibleSince = now();
    // A hidden/throttled tab fires ticks far apart; reset the baseline whenever
    // visibility changes so those throttled gaps are never reported as stalls.
    this.driftVisibilityHandler = () => {
      this.lastDrift = now();
      if (!document.hidden) this.visibleSince = now();
    };
    document.addEventListener("visibilitychange", this.driftVisibilityHandler);
    this.driftTimer = setInterval(() => {
      const tick = now();
      if (document.hidden) {
        this.lastDrift = tick;
        return;
      }
      const elapsed = tick - this.lastDrift;
      this.lastDrift = tick;
      // Ignore the catch-up tick right after the tab becomes visible again.
      if (elapsed > 500 && tick - this.visibleSince < 2000) return;
      const drift = elapsed - DRIFT_INTERVAL_MS;
      if (drift > DRIFT_WARN_MS) {
        console.warn(
          `[arpeggio] main thread blocked ${drift.toFixed(1)}ms (tick ${elapsed.toFixed(1)}ms)`,
        );
      }
    }, DRIFT_INTERVAL_MS);
  }

  private disposeSequence(): void {
    if (!this.sequence) return;
    this.sequence.stop(0);
    this.sequence.dispose();
    this.sequence = null;
  }
}

export type ArpeggioEngineClass = typeof ArpeggioEngine;
