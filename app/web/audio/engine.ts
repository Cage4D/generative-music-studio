import * as Tone from "tone";
import { effectAmount, FILTER_MAX_HZ, filterCutoff } from "./effects";
import { generateArpeggio } from "./generators/arpeggio";
import { stepSeconds } from "./theory";
import type { ArpeggioParams, NoteEvent, Voice } from "./types";

export type StepListener = (step: number) => void;

const SYNTH_SUSTAIN = 0.5;

type StepItem = {
  index: number;
  note: NoteEvent | null;
};

function signatureOfVoice(voice: Voice): string {
  return [
    voice.waveform,
    voice.attack,
    voice.decay,
    voice.release,
    voice.gain,
  ].join("|");
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

export class ArpeggioEngine {
  onStep: StepListener | null = null;

  private readonly synth: Tone.Synth;
  private readonly distortion: Tone.Distortion;
  private readonly phaser: Tone.Phaser;
  private readonly chorus: Tone.Chorus;
  private readonly vibrato: Tone.Vibrato;
  private readonly filter: Tone.Filter;
  private readonly tremolo: Tone.Tremolo;
  private readonly delay: Tone.FeedbackDelay;
  private readonly reverb: Tone.Reverb;

  private sequence: Tone.Sequence<StepItem> | null = null;
  private params: ArpeggioParams | null = null;
  private signature = "";
  private voiceSignature = "";
  private running = false;
  private disposed = false;

  constructor() {
    this.synth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.4 },
    });
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

    this.synth.chain(
      this.distortion,
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
    this.synth.dispose();
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
    const { events, voice } = generateArpeggio(params);
    this.applyVoice(voice);
    this.disposeSequence();
    const items: StepItem[] = events.map((note, index) => ({ index, note }));
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
    const signature = signatureOfVoice(voice);
    if (signature === this.voiceSignature) return;
    this.voiceSignature = signature;
    this.synth.set({
      oscillator: { type: voice.waveform },
      envelope: {
        attack: voice.attack,
        decay: voice.decay,
        sustain: SYNTH_SUSTAIN,
        release: voice.release,
      },
    });
    this.synth.volume.rampTo(Tone.gainToDb(voice.gain), 0.05);
  }

  private onSequenceStep(time: number, item: StepItem): void {
    if (this.disposed) return;
    if (this.onStep) {
      const step = item.index;
      Tone.getDraw().schedule(() => this.onStep?.(step), time);
    }
    if (!item.note || !this.params) return;
    const seconds = stepSeconds(
      this.params.arpeggio.stepLength,
      this.params.tempo,
    );
    const offset =
      item.index % 2 === 1 ? (this.params.swing * seconds) / 3 : 0;
    this.synth.triggerAttackRelease(
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
