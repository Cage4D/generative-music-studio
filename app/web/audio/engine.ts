import * as Tone from "tone";
import { effectAmount, FILTER_MAX_HZ, filterCutoff } from "./effects";
import { generateArpeggio } from "./generators/arpeggio";
import { stepSeconds } from "./theory";
import type { ArpeggioParams, NoteEvent, Voice, VoiceKind } from "./types";

export type StepListener = (step: number) => void;

type Instrument = {
  kind: VoiceKind;
  source: Tone.MonoSynth | Tone.FMSynth | Tone.Synth;
  output: Tone.ToneAudioNode;
  release: number;
  nodes: Tone.ToneAudioNode[];
};

type StepItem = {
  index: number;
  note: NoteEvent | null;
};

const RETIRE_FADE = 0.1;
const RETIRE_MIN_MS = 150;
const RETIRE_RELEASE_MS = 150;
const SILENT_DB = -60;

function buildInstrument(voice: Voice): Instrument {
  switch (voice.kind) {
    case "pluck": {
      const source = new Tone.MonoSynth({
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
      source.volume.value = Tone.gainToDb(voice.gain);
      return {
        kind: voice.kind,
        source,
        output: source,
        release: voice.release,
        nodes: [source],
      };
    }
    case "bell": {
      const source = new Tone.FMSynth({
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
      source.volume.value = Tone.gainToDb(voice.gain);
      return {
        kind: voice.kind,
        source,
        output: source,
        release: voice.release,
        nodes: [source],
      };
    }
    case "soft": {
      const source = new Tone.Synth({
        oscillator: { type: voice.waveform },
        envelope: {
          attack: voice.attack,
          decay: voice.decay,
          sustain: voice.sustain,
          release: voice.release,
        },
      });
      const vibrato = new Tone.Vibrato(voice.vibratoFrequency, voice.vibratoDepth);
      const output = new Tone.Gain(1);
      source.connect(vibrato);
      vibrato.connect(output);
      source.volume.value = Tone.gainToDb(voice.gain);
      return {
        kind: voice.kind,
        source,
        output,
        release: voice.release,
        nodes: [source, vibrato, output],
      };
    }
    case "buzz": {
      const source = new Tone.MonoSynth({
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
      source.volume.value = Tone.gainToDb(voice.gain);
      return {
        kind: voice.kind,
        source,
        output: source,
        release: voice.release,
        nodes: [source],
      };
    }
  }
}

function eventSignature(params: ArpeggioParams): string {
  const block = params.arpeggio;
  return [
    params.seed,
    params.root,
    params.scale,
    params.density,
    block.pattern,
    block.octaves,
    block.stepLength,
  ].join("|");
}

function hashEvents(events: (NoteEvent | null)[]): string {
  let hash = 0x811c9dc5;
  for (const event of events) {
    const token = event
      ? `${event.step}:${event.midi}:${event.velocity.toFixed(4)}:${event.gate.toFixed(4)}`
      : "-";
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
  private readonly reverb: Tone.Reverb;

  private instrument: Instrument | null = null;
  private readonly retired = new Set<Instrument>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  private sequence: Tone.Sequence<StepItem> | null = null;
  private params: ArpeggioParams | null = null;
  private signature = "";
  private voiceSignature = "";
  private running = false;
  private disposed = false;

  constructor() {
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
    this.reverb = new Tone.Reverb({ decay: 3, wet: 0 });

    this.chorus.start();
    this.tremolo.start();

    this.distortion.chain(
      this.phaser,
      this.chorus,
      this.vibrato,
      this.filter,
      this.tremolo,
      this.delay,
      this.reverb,
      Tone.getDestination(),
    );
  }

  async start(params: ArpeggioParams): Promise<void> {
    if (this.disposed) return;
    this.params = params;
    await Tone.getContext().resume();
    await this.reverb.ready;
    if (this.disposed) return;
    this.applyLive();
    this.signature = eventSignature(params);
    this.buildSequence();
    const transport = Tone.getTransport();
    transport.bpm.value = params.tempo;
    transport.swing = 0;
    transport.position = 0;
    this.running = true;
    transport.start();
  }

  update(params: ArpeggioParams): void {
    if (this.disposed) return;
    this.params = params;
    if (!this.running) {
      this.signature = eventSignature(params);
      return;
    }
    this.applyLive();
    const next = eventSignature(params);
    if (next !== this.signature) {
      this.signature = next;
      this.buildSequence();
    }
  }

  stop(): void {
    if (this.disposed) return;
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
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
    this.disposeSequence();
    this.onStep = null;

    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();

    if (this.instrument) {
      this.disposeInstrument(this.instrument);
      this.instrument = null;
    }
    for (const instrument of this.retired) this.disposeInstrument(instrument);
    this.retired.clear();

    this.distortion.dispose();
    this.phaser.dispose();
    this.chorus.dispose();
    this.vibrato.dispose();
    this.filter.dispose();
    this.tremolo.dispose();
    this.delay.dispose();
    this.reverb.dispose();
  }

  isRunning(): boolean {
    return this.running;
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
    this.reverb.wet.rampTo(effectAmount(effects, "reverb"), 0.05);
    this.delay.wet.rampTo(effectAmount(effects, "delay"), 0.05);

    const chorus = effectAmount(effects, "chorus");
    this.chorus.wet.rampTo(chorus, 0.05);
    this.chorus.depth = chorus;

    this.phaser.wet.rampTo(effectAmount(effects, "phaser"), 0.05);

    const distortion = effectAmount(effects, "distortion");
    this.distortion.wet.rampTo(distortion, 0.05);
    this.distortion.distortion = distortion;

    this.filter.frequency.rampTo(filterCutoff(effectAmount(effects, "filter")), 0.05);

    const vibrato = effectAmount(effects, "vibrato");
    this.vibrato.wet.rampTo(vibrato, 0.05);
    this.vibrato.depth.rampTo(vibrato, 0.05);

    const tremolo = effectAmount(effects, "tremolo");
    this.tremolo.wet.rampTo(tremolo, 0.05);
    this.tremolo.depth.rampTo(tremolo, 0.05);
  }

  private buildSequence(): void {
    const params = this.params;
    if (!params) return;
    const { events, voice, archetype } = generateArpeggio(params);
    this.applyVoice(voice);
    this.disposeSequence();
    const items: StepItem[] = events.map((note, index) => ({ index, note }));
    if (process.env.NODE_ENV !== "production") {
      const sounding = events.filter((event) => event !== null).length;
      console.debug(
        `[arpeggio] regenerate seed=${params.seed} archetype=${archetype} kind=${voice.kind} sounding=${sounding} hash=${hashEvents(events)}`,
      );
    }
    const sequence = new Tone.Sequence<StepItem>(
      (time, item) => this.onSequenceStep(time, item),
      items,
      params.arpeggio.stepLength,
    );
    sequence.loop = true;
    const transport = Tone.getTransport();
    sequence.start(this.running ? transport.position : 0);
    this.sequence = sequence;
  }

  private applyVoice(voice: Voice): void {
    const signature = JSON.stringify(voice);
    if (signature === this.voiceSignature && this.instrument?.kind === voice.kind) {
      return;
    }
    this.voiceSignature = signature;
    const next = buildInstrument(voice);
    next.output.connect(this.distortion);
    const previous = this.instrument;
    this.instrument = next;
    if (previous) this.retireInstrument(previous);
  }

  private retireInstrument(instrument: Instrument): void {
    this.retired.add(instrument);
    try {
      instrument.source.volume.cancelScheduledValues(Tone.now());
      instrument.source.volume.rampTo(SILENT_DB, RETIRE_FADE);
    } catch {
      // Volume ramp is best-effort; disposal below still reclaims the nodes.
    }
    const delay = Math.max(RETIRE_MIN_MS, instrument.release * 1000 + RETIRE_RELEASE_MS);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.retired.delete(instrument);
      this.disposeInstrument(instrument);
    }, delay);
    this.timers.add(timer);
  }

  private disposeInstrument(instrument: Instrument): void {
    try {
      instrument.output.disconnect();
    } catch {
      // Already disconnected.
    }
    for (const node of instrument.nodes) {
      try {
        node.dispose();
      } catch {
        // Already disposed.
      }
    }
  }

  private onSequenceStep(time: number, item: StepItem): void {
    if (this.disposed) return;
    if (this.onStep) {
      const step = item.index;
      Tone.getDraw().schedule(() => this.onStep?.(step), time);
    }
    if (!item.note || !this.params || !this.instrument) return;
    const seconds = stepSeconds(
      this.params.arpeggio.stepLength,
      this.params.tempo,
    );
    const offset =
      item.index % 2 === 1 ? (this.params.swing * seconds) / 3 : 0;
    this.instrument.source.triggerAttackRelease(
      Tone.Frequency(item.note.midi, "midi").toFrequency(),
      item.note.gate * seconds,
      time + offset,
      item.note.velocity,
    );
  }

  private disposeSequence(): void {
    if (!this.sequence) return;
    this.sequence.stop(0);
    this.sequence.dispose();
    this.sequence = null;
  }
}

export type ArpeggioEngineClass = typeof ArpeggioEngine;
