import * as Tone from "tone";
import { effectAmount, FILTER_MAX_HZ, filterCutoff } from "./effects";
import { generateArpeggio } from "./generators/arpeggio";
import { generateBassline } from "./generators/bassline";
import { drumStepLength, generateDrums } from "./generators/drums";
import { generateMelody } from "./generators/melody";
import { generatePads } from "./generators/pads";
import {
  buildDrumInstrument,
  drumInstrumentKeys,
  type DrumInstrument,
} from "./drum-kit";
import { stepSeconds } from "./theory";
import { readDevFlags, type DevFlags } from "./dev-flags";
import { hashDrumEvents, hashEvents, hashPadEvents } from "./hash";
import type { EffectId } from "../lib/studio-state";
import type {
  AnyVoiceKind,
  ArpeggioParams,
  BassVoiceKind,
  BasslineParams,
  DrumEvent,
  DrumKitName,
  DrumParams,
  MelodyParams,
  NoteEvent,
  PadChordEvent,
  PadParams,
  Voice,
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
  kind: AnyVoiceKind;
  source: Tone.MonoSynth | Tone.FMSynth | Tone.Synth;
  level: Tone.Gain;
  nodes: Tone.ToneAudioNode[];
  configure: (voice: Voice) => void;
};

export type EngineParams =
  | ArpeggioParams
  | MelodyParams
  | BasslineParams
  | DrumParams
  | PadParams;

function isMelodyParams(params: EngineParams): params is MelodyParams {
  return "melody" in params;
}

function isBasslineParams(params: EngineParams): params is BasslineParams {
  return "bass" in params;
}

function isDrumParams(params: EngineParams): params is DrumParams {
  return "drums" in params;
}

function isPadParams(params: EngineParams): params is PadParams {
  return "pad" in params;
}

type StepItem = {
  index: number;
  note: NoteEvent | null;
  /** The drum lanes that sound on this step. */
  drums?: DrumEvent[];
};

const TONE_LOOKAHEAD = 0.1;
const VOICE_FADE = 0.05;
const KIT_FADE = 0.06;
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

// The bass family plays in the lowest part of the spectrum (36-147 Hz), where
// laptop speakers and small headphones roll off, so a plain sine is inaudible
// there. A quiet harmonic an octave above the fundamental keeps the note
// audible without moving its pitch or adding a single node to the graph.
const BASS_PARTIALS: Partial<Record<BassVoiceKind, number[]>> = {
  sub: [1, 0.25, 0.1],
  "pluck-bass": [1, 0.4, 0.15],
};

// +2.5 dB of trim on the bass voices: the loudest one lands about 6 dB below
// unity, which leaves headroom under the limiter while the bass still sits
// under the lead voices instead of disappearing.
const BASS_GAIN_TRIM = 1.33;

/**
 * A voice with no gain is silent, no matter what the sequence schedules.
 */
export function voiceIsSilent(voice: Voice): boolean {
  return voice.gain <= 0;
}

/**
 * The length of a drum hit, in seconds. An open hat that is choked by the
 * next hat is cut short: the distance to that hat is counted in steps, so the
 * tempo changes the sound without changing the event.
 */
export function drumHitDuration(
  event: DrumEvent,
  base: number,
  secondsPerStep: number,
): number {
  if (event.choke <= 0) return base;
  return Math.max(0.01, Math.min(base, event.choke * secondsPerStep));
}

/**
 * Tone builds a custom wave from a list of partial amplitudes. The order
 * matters: setting a basic type ("sine") resets the partial count, so the
 * partials are applied after the oscillator type.
 */
function setOscillatorPartials(
  source: Tone.MonoSynth | Tone.FMSynth | Tone.Synth,
  partials: number[] | undefined,
): void {
  if (!partials) return;
  const oscillator = (source as { oscillator?: { partials: number[] } }).oscillator;
  if (!oscillator) return;
  oscillator.partials = partials;
}

// Dev-only stand-ins used by `?voice=`, so a forced kind always has valid params.
const FORCED_VOICES: Record<AnyVoiceKind, Voice> = {
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
  sub: {
    kind: "sub",
    waveform: "sine",
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.2,
    gain: 0.4,
    glide: 0,
  },
  "saw-lowpass": {
    kind: "saw-lowpass",
    waveform: "sawtooth",
    attack: 0.005,
    decay: 0.2,
    sustain: 0.5,
    release: 0.2,
    filterFrequency: 1200,
    filterQ: 1,
    gain: 0.34,
    glide: 0,
  },
  "soft-square": {
    kind: "soft-square",
    waveform: "square",
    attack: 0.005,
    decay: 0.2,
    sustain: 0.5,
    release: 0.2,
    filterFrequency: 900,
    filterQ: 0.7,
    gain: 0.3,
    glide: 0,
  },
  "pluck-bass": {
    kind: "pluck-bass",
    waveform: "triangle",
    attack: 0.005,
    decay: 0.15,
    sustain: 0.1,
    release: 0.2,
    filterFrequency: 1500,
    filterQ: 1.2,
    gain: 0.36,
    glide: 0,
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
  if (isBasslineParams(params)) {
    const block = params.bass;
    // The waveform, cutoff and glide only pick the timbre: they never change a
    // note, but they do change the voice, so the sequence is rebuilt for them.
    return [
      "bassline",
      params.seed,
      params.root,
      params.scale,
      params.density,
      block.style,
      block.octave,
      block.noteLength,
      block.waveform,
      block.cutoff,
      block.glide,
    ].join("|");
  }
  if (isDrumParams(params)) {
    const block = params.drums;
    // The kit is a timbre: it never changes a note, but it does change the
    // instruments, so the sequence is rebuilt for it.
    return [
      "drum-pattern",
      params.seed,
      params.density,
      block.style,
      block.kit,
      block.steps,
      block.ghostNotes,
      block.fills,
      block.hatDensity,
    ].join("|");
  }
  if (isPadParams(params)) {
    const block = params.pad;
    return [
      "ambient-pad",
      params.seed,
      params.root,
      params.scale,
      params.density,
      block.waveform,
      block.chordSize,
      block.voicing,
      block.chordLengthBars,
      block.attack,
      block.release,
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

  private readonly instruments: Record<AnyVoiceKind, PersistentInstrument>;
  private activeKind: AnyVoiceKind | null = null;
  // The level each instrument is heading for. The level nodes ramp, so their
  // current value is 0 while a voice fades in: the intended target is what
  // says whether the engine is actually silent.
  private intendedLevels: Partial<Record<AnyVoiceKind, number>> = {};

  // One persistent instrument per lane and kit. Switching the kit crossfades
  // the lane levels, it never builds or disposes a synth.
  private readonly drumInstruments = new Map<string, DrumInstrument>();
  private drumKit: DrumKitName | null = null;
  private drumLevels: Record<string, number> = {};

  private sequence: Tone.Sequence<StepItem> | null = null;
  private params: EngineParams | null = null;
  private generatorId: "arpeggio" | "melody" | "bassline" | "drum-pattern" | "ambient-pad" =
    "arpeggio";
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
    this.buildDrumInstruments();

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

    for (const kind of Object.keys(this.instruments) as AnyVoiceKind[]) {
      for (const node of this.instruments[kind].nodes) {
        try {
          node.dispose();
        } catch {
          // Already disposed.
        }
      }
    }

    for (const instrument of this.drumInstruments.values()) {
      for (const node of instrument.nodes) {
        try {
          node.dispose();
        } catch {
          // Already disposed.
        }
      }
    }
    this.drumInstruments.clear();

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

  private buildInstruments(): Record<AnyVoiceKind, PersistentInstrument> {
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

    // The bass family. One persistent instrument per kind, so switching the
    // voice never builds or disposes a synth while the transport runs.
    const subSource = new Tone.Synth({ oscillator: { type: "sine" } });
    const subLevel = makeLevel();
    subSource.connect(subLevel);

    const sawSource = new Tone.MonoSynth({ oscillator: { type: "sawtooth" } });
    const sawLevel = makeLevel();
    sawSource.connect(sawLevel);

    const squareSource = new Tone.MonoSynth({ oscillator: { type: "square" } });
    const squareLevel = makeLevel();
    squareSource.connect(squareLevel);

    const pluckBassSource = new Tone.MonoSynth({
      oscillator: { type: "triangle" },
    });
    const pluckBassLevel = makeLevel();
    pluckBassSource.connect(pluckBassLevel);

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
      sub: {
        kind: "sub",
        source: subSource,
        level: subLevel,
        nodes: [subSource, subLevel],
        configure: (voice) => {
          if (voice.kind !== "sub") return;
          // The glide is a portamento: the pitch slides into the new note.
          subSource.portamento = voice.glide;
          subSource.set({
            oscillator: { type: voice.waveform },
            envelope: {
              attack: voice.attack,
              decay: voice.decay,
              sustain: voice.sustain,
              release: voice.release,
            },
          });
          // A pure sine this low is inaudible on small speakers: blend in a
          // quiet harmonic an octave up and keep the fundamental clean.
          setOscillatorPartials(subSource, BASS_PARTIALS.sub);
          subSource.volume.value = Tone.gainToDb(voice.gain * BASS_GAIN_TRIM);
        },
      },
      "saw-lowpass": {
        kind: "saw-lowpass",
        source: sawSource,
        level: sawLevel,
        nodes: [sawSource, sawLevel],
        configure: (voice) => {
          if (voice.kind !== "saw-lowpass") return;
          // The glide is a portamento: the pitch slides into the new note.
          sawSource.portamento = voice.glide;
          sawSource.set({
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
              decay: 0.05,
              sustain: 1,
              release: voice.release,
              baseFrequency: voice.filterFrequency,
              octaves: 0,
            },
          });
          sawSource.volume.value = Tone.gainToDb(voice.gain * BASS_GAIN_TRIM);
        },
      },
      "soft-square": {
        kind: "soft-square",
        source: squareSource,
        level: squareLevel,
        nodes: [squareSource, squareLevel],
        configure: (voice) => {
          if (voice.kind !== "soft-square") return;
          // The glide is a portamento: the pitch slides into the new note.
          squareSource.portamento = voice.glide;
          squareSource.set({
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
              decay: 0.05,
              sustain: 1,
              release: voice.release,
              baseFrequency: voice.filterFrequency,
              octaves: 0,
            },
          });
          squareSource.volume.value = Tone.gainToDb(voice.gain * BASS_GAIN_TRIM);
        },
      },
      "pluck-bass": {
        kind: "pluck-bass",
        source: pluckBassSource,
        level: pluckBassLevel,
        nodes: [pluckBassSource, pluckBassLevel],
        configure: (voice) => {
          if (voice.kind !== "pluck-bass") return;
          // The glide is a portamento: the pitch slides into the new note.
          pluckBassSource.portamento = voice.glide;
          pluckBassSource.set({
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
              decay: 0,
              sustain: 0,
              release: voice.release,
              baseFrequency: voice.filterFrequency,
              octaves: 2,
            },
          });
          // A triangle alone is thin this low: a little extra harmonic keeps
          // the note present on small speakers.
          setOscillatorPartials(pluckBassSource, BASS_PARTIALS["pluck-bass"]);
          pluckBassSource.volume.value = Tone.gainToDb(
            voice.gain * BASS_GAIN_TRIM,
          );
        },
      },
    };
  }

  private buildDrumInstruments(): void {
    for (const { lane, kit } of drumInstrumentKeys()) {
      const instrument = buildDrumInstrument(lane, kit, this.chainInput);
      this.drumInstruments.set(`${lane}:${kit}`, instrument);
      this.drumLevels[`${lane}:${kit}`] = 0;
    }
  }

  /**
   * The kit crossfades the lane levels. Every instrument is already built, so
   * the kit never builds or disposes a synth while the transport runs.
   */
  private applyDrumKit(kit: DrumKitName): void {
    if (this.drumKit === kit) return;
    const previous = this.drumKit;
    this.drumKit = kit;
    for (const key of this.drumInstruments.keys()) {
      const instrument = this.drumInstruments.get(key);
      if (!instrument) continue;
      const target = instrument.kit === kit ? 1 : 0;
      if (target === 1 && !previous) {
        // The first kit fades in with the rest of the engine.
        instrument.level.gain.setValueAtTime(0, Tone.now());
        instrument.level.gain.rampTo(1, KIT_FADE);
      } else {
        instrument.level.gain.cancelScheduledValues(Tone.now());
        instrument.level.gain.rampTo(target, KIT_FADE);
      }
      this.drumLevels[key] = target;
    }
    if (isDev) {
      console.debug(`[drum-pattern] kit=${kit}`);
    }
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
    if (isDrumParams(params)) {
      this.buildDrumSequence(params);
      return;
    }
    if (isPadParams(params)) {
      this.buildPadSequence(params);
      return;
    }
    const start = now();
    const melody = isMelodyParams(params);
    const bass = isBasslineParams(params);
    const result = bass
      ? generateBassline(params)
      : melody
        ? generateMelody(params)
        : generateArpeggio(params);
    const { events, voice, archetype } = result;
    this.generatorId = bass ? "bassline" : melody ? "melody" : "arpeggio";
    this.activeStepLength = bass
      ? params.bass.noteLength
      : melody
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
    const sounding = events.filter((event) => event !== null).length;
    if (isDev) {
      console.debug(
        `[${this.generatorId}] buildSequence seed=${params.seed} archetype=${archetype} kind=${finalVoice.kind} sounding=${sounding} hash=${hashEvents(events)} generate=${(generated - start).toFixed(2)}ms total=${(done - start).toFixed(2)}ms ${contextInfo()}`,
      );
      // A silent engine is the one failure the user cannot diagnose from the
      // UI, so it is called out in the console.
      if (sounding === 0) {
        console.warn(
          `[${this.generatorId}] no scheduled events: the pattern is empty, so nothing will sound`,
        );
      }
      const allLevelsZero = Object.values(this.intendedLevels).every(
        (level) => (level ?? 0) <= 0,
      );
      if (allLevelsZero || voiceIsSilent(finalVoice)) {
        console.warn(
          `[${this.generatorId}] every voice gain is 0 (voice gain=${finalVoice.gain}): the engine is silent`,
        );
      }
    }
  }

  private buildDrumSequence(params: DrumParams): void {
    const start = now();
    const result = generateDrums(params);
    this.generatorId = "drum-pattern";
    this.activeStepLength = drumStepLength(params.drums.steps);
    this.applyDrumKit(params.drums.kit);
    this.disposeSequence();
    const items: StepItem[] = result.steps.map((drums, index) => ({
      index,
      note: null,
      drums,
    }));
    const sequence = new Tone.Sequence<StepItem>(
      (time, item) => this.onSequenceStep(time, item),
      items,
      this.activeStepLength,
    );
    sequence.loop = true;
    const transport = Tone.getTransport();
    sequence.start(this.running ? transport.position : 0);
    this.sequence = sequence;
    const events = result.steps.flat();
    const done = now();
    if (isDev) {
      console.debug(
        `[drum-pattern] buildSequence seed=${params.seed} archetype=${result.archetype} kit=${params.drums.kit} steps=${result.totalSteps} sounding=${events.length} hash=${hashDrumEvents(events)} generate=${(done - start).toFixed(2)}ms total=${(done - start).toFixed(2)}ms ${contextInfo()}`,
      );
      // A silent engine is the one failure the user cannot diagnose from the
      // UI, so it is called out in the console.
      if (events.length === 0) {
        console.warn(
          `[drum-pattern] no scheduled events: the pattern is empty, so nothing will sound`,
        );
      }
      const allLevelsZero = Object.values(this.drumLevels).every(
        (level) => (level ?? 0) <= 0,
      );
      if (allLevelsZero) {
        console.warn(
          `[drum-pattern] every drum lane gain is 0: the engine is silent`,
        );
      }
    }
  }



  private buildPadSequence(params: PadParams): void {
    const start = now();
    const result = generatePads(params);
    this.generatorId = "ambient-pad";
    this.activeStepLength = "16n";
    // Apply a voice so levels get crossfaded on - use a soft voice for pads
    this.applyVoice(this.flags.forcedVoice ? FORCED_VOICES[this.flags.forcedVoice] : FORCED_VOICES.soft);
    this.disposeSequence();
    const items: StepItem[] = [];
    // Create steps across the timeline
    const totalSteps = 128; // 8 bars * 16
    for (let i = 0; i < totalSteps; i++) {
      items.push({ index: i, note: null });
    }
    const sequence = new Tone.Sequence<StepItem>(
      (time, item) => this.onPadSequenceStep(time, item, result.events, params),
      items,
      "16n",
    );
    sequence.loop = true;
    const transport = Tone.getTransport();
    sequence.start(this.running ? transport.position : 0);
    this.sequence = sequence;
    const done = now();
    if (isDev) {
      console.debug(
        `[ambient-pad] buildSequence seed=${params.seed} archetype=${result.archetype} sounding=${result.events.reduce((a, e) => a + e.pitches.length, 0)} hash=${hashPadEvents(result.events)} generate=${(done - start).toFixed(2)}ms total=${(done - start).toFixed(2)}ms ${contextInfo()}`,
      );
      if (result.events.length === 0) {
        console.warn(
          `[ambient-pad] no scheduled events: the pattern is empty, so nothing will sound`,
        );
      }
      const allLevelsZero = Object.values(this.intendedLevels).every(
        (level) => (level ?? 0) <= 0,
      );
      if (allLevelsZero) {
        console.warn(
          `[ambient-pad] every voice gain is 0: the engine is silent`,
        );
      }
    }
  }

  private onPadSequenceStep(time: number, item: StepItem, events: PadChordEvent[], params: PadParams): void {
    if (this.disposed) return;
    const start = now();
    if (this.onStep) {
      const step = item.index;
      Tone.getDraw().schedule(() => this.onStep?.(step), time);
    }
    // Find events starting at this step (16n steps)
    for (const ev of events) {
      if (ev.step === item.index) {
        // Trigger chord
        const secondsPerStep = 60 / params.tempo / 4; // 16n
        const duration = Math.max(0.5, ev.durationSteps * secondsPerStep * 2); // long release
        const vel = Math.max(0.01, ev.velocity || 0.5);
        // Use the soft/lead synths for pads - route through chain
        const instr = this.activeKind ? this.instruments[this.activeKind] : (this.instruments["soft"] || this.instruments["pluck"]);
        // Try to use available instruments
        if (instr) {
          for (let i = 0; i < ev.pitches.length; i++) {
            const startTime = Math.max(time, Tone.now() + 0.001, this.lastNoteStart + SCHEDULE_EPSILON);
            this.lastNoteStart = startTime + 0.0005;
            try {
              instr.source.triggerAttackRelease(
                Tone.Frequency(ev.pitches[i], "midi").toFrequency(),
                duration,
                startTime,
                vel / Math.max(1, ev.pitches.length),
              );
            } catch {
              // ignore
            }
          }
        }
      }
    }
    if (isDev) {
      const elapsed = now() - start;
      if (elapsed > STEP_WARN_MS) {
        console.warn(
          `[ambient-pad] step ${item.index} callback ${elapsed.toFixed(2)}ms exceeds ${STEP_WARN_MS}ms`,
        );
      }
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
    for (const kind of Object.keys(this.instruments) as AnyVoiceKind[]) {
      const target = kind === voice.kind ? 1 : 0;
      this.intendedLevels[kind] = target;
      const gain = this.instruments[kind].level.gain;
      gain.cancelScheduledValues(Tone.now());
      gain.rampTo(target, VOICE_FADE);
    }
    if (isDev) {
      console.debug(
        `[${this.generatorId}] voice kind=${voice.kind} ${kindChanged ? "switch" : "update"} ${(now() - start).toFixed(2)}ms`,
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
    if (item.drums && item.drums.length > 0 && this.params) {
      this.onDrumStep(time, item);
    } else {
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

  /**
   * The drum lanes of one step. Every lane plays its own instrument, so
   * several lanes can sound on the same step without fighting over a voice.
   */
  private onDrumStep(time: number, item: StepItem): void {
    const params = this.params;
    if (!params || !item.drums) return;
    const seconds = stepSeconds(this.activeStepLength, params.tempo);
    const offset = item.index % 2 === 1 ? (params.swing * seconds) / 3 : 0;
    for (const event of item.drums) {
      const instrument = this.drumInstruments.get(
        `${event.lane}:${this.drumKit ?? "electronic"}`,
      );
      if (!instrument) continue;
      // Keep starts strictly increasing, the same way the melodic voices do.
      const startTime = Math.max(
        time + offset,
        Tone.now(),
        this.lastNoteStart + SCHEDULE_EPSILON,
      );
      this.lastNoteStart = startTime;
      instrument.trigger(
        drumHitDuration(event, instrument.duration, seconds),
        startTime,
        event.velocity,
      );
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
