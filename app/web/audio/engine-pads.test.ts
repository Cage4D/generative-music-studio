/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A Tone stand-in that is just detailed enough to observe what the engine
// schedules: the sequence callback, the trigger calls, the source gain and
// the oscillator wave.
const tone = vi.hoisted(() => {
  class Param {
    value: number;
    rampTo = vi.fn((v: number) => {
      this.value = v;
    });
    cancelScheduledValues = vi.fn();
    setValueAtTime = vi.fn((v: number) => {
      this.value = v;
    });
    constructor(v = 0) {
      this.value = v;
    }
  }

  // Mirrors Tone: a basic type resets the partial count, and setting the
  // partials switches the oscillator to the custom wave.
  class Oscillator {
    type = "sine";
    private _partials: number[] = [];
    get partials(): number[] {
      return this._partials;
    }
    set partials(value: number[]) {
      this._partials = value;
      this.type = "custom";
    }
  }

  const store: any = { gains: [], synths: [], sequences: [], membrane: [], noise: [] };

  class BaseNode {
    connections = new Set<any>();
    connect(dest: any) {
      this.connections.add(dest);
      return dest;
    }
    disconnect() {
      this.connections.clear();
    }
    toDestination() {
      this.connections.add(store.destination);
      return this;
    }
    dispose() {}
  }

  class EffectNode extends BaseNode {
    wet = new Param(0);
  }

  class Distortion extends EffectNode {
    distortion = 0;
  }

  class Phaser extends EffectNode {}
  class Chorus extends EffectNode {
    frequency = new Param(1.5);
    depth = 0.7;
    start = vi.fn();
  }
  class Vibrato extends EffectNode {
    frequency = new Param(5);
    depth = new Param(0);
  }
  class Filter extends BaseNode {
    frequency = new Param(20000);
  }
  class Tremolo extends EffectNode {
    frequency = new Param(4);
    depth = new Param(0);
    start = vi.fn();
  }
  class FeedbackDelay extends EffectNode {
    delayTime = new Param(0);
    feedback = new Param(0);
  }
  class Freeverb extends EffectNode {
    roomSize = new Param(0.8);
    dampening = 3000;
  }
  class Gain extends BaseNode {
    gain = new Param(1);
    constructor(value = 1) {
      super();
      this.gain.value = value;
      if (!store.chainInput) store.chainInput = this;
      store.gains.push(this);
    }
  }
  class Limiter extends BaseNode {}
  class Meter extends BaseNode {
    getValue = vi.fn(() => -Infinity);
  }

  class Synth extends BaseNode {
    volume = new Param(0);
    portamento = 0;
    oscillator = new Oscillator();
    set = vi.fn((options: any) => {
      if (options?.oscillator?.type) this.oscillator.type = options.oscillator.type;
      // The engine only configures the voice it is about to play.
      store.lastConfigured = this;
    });
    triggerAttackRelease = vi.fn();
    constructor(options: any = {}) {
      super();
      if (options?.oscillator?.type) this.oscillator.type = options.oscillator.type;
      store.synths.push(this);
    }
  }
  class MonoSynth extends Synth {}
  class FMSynth extends Synth {}


  class MembraneSynth extends BaseNode {
    pitchDecay: number;
    octaves: number;
    envelope: any;
    volume = new Param(0);
    triggerAttackRelease = vi.fn();
    constructor(options: any = {}) {
      super();
      this.pitchDecay = options?.pitchDecay ?? 0.05;
      this.octaves = options?.octaves ?? 3;
      this.envelope = options?.envelope;
      if (store.membrane) store.membrane.push(this);
    }
  }
  class Noise {
    type = "white";
    constructor(options: any = {}) {
      this.type = options?.type ?? "white";
    }
  }
  class NoiseSynth extends BaseNode {
    noise: Noise;
    envelope: any;
    triggerAttackRelease = vi.fn();
    constructor(options: any = {}) {
      super();
      this.noise = new Noise(options?.noise);
      this.envelope = options?.envelope;
      if (store.noise) store.noise.push(this);
    }
  }

  class Sequence extends BaseNode {
    loop = false;
    start = vi.fn();
    stop = vi.fn();
    constructor(callback: any, events: any, subdivision: any) {
      super();
      store.sequences.push({ callback, events, subdivision });
    }
  }

  const destination = new BaseNode();
  store.destination = destination;

  const transport = {
    bpm: { value: 120 },
    swing: 0,
    position: 0,
    state: "stopped",
    start: vi.fn(),
    stop: vi.fn(),
  };
  const context = {
    state: "running",
    rawContext: { baseLatency: 0.01, outputLatency: 0.02 },
    resume: vi.fn(async () => {}),
  };

  return {
    store,
    destination,
    Context: class {},
    setContext: vi.fn(),
    getContext: () => context,
    getTransport: () => transport,
    getDraw: () => ({ schedule: vi.fn() }),
    getDestination: () => destination,
    now: () => 0,
    gainToDb: (value: number) => 20 * Math.log10(value),
    // A real midi -> Hz conversion, so the test can check the register the
    // bass actually plays in.
    Frequency: (value: number, unit?: string) => ({
      toFrequency: () =>
        unit === "midi" ? 440 * Math.pow(2, (value - 69) / 12) : value,
    }),
    Distortion,
    Phaser,
    Chorus,
    Vibrato,
    Filter,
    Tremolo,
    FeedbackDelay,
    Freeverb,
    Gain,
    Limiter,
    Meter,
    MonoSynth,
    FMSynth,
    Synth,
    MembraneSynth,
    Noise,
    NoiseSynth,
    Sequence,
  };
});

vi.mock("tone", () => tone);

import { ArpeggioEngine } from "./engine";
import type { PadParams } from "./types";

function params(overrides: Partial<PadParams> = {}): PadParams {
  return {
    seed: 1,
    tempo: 96,
    root: "D",
    scale: "dorian",
    density: 0.6,
    swing: 0.1,
    effects: { reverb: 0.35, delay: 0.2 },
    pad: {
      waveform: "sine",
      chordSize: 3,
      voicing: "open",
      chordLengthBars: 2,
      attack: 2,
      release: 4,
      drift: 0.3,
    },
    ...overrides,
  };
}

type Trigger = {
  frequency: number;
  duration: number;
  time: number;
  velocity: number;
};

/** Run the pad sequence callback for every step, collecting the triggers. */
function scheduledNotes(): Trigger[] {
  const sequence = tone.store.sequences[tone.store.sequences.length - 1];
  const source = tone.store.lastConfigured;
  expect(sequence).toBeDefined();
  expect(source).toBeDefined();
  const calls: any[] = [];
  for (const item of sequence.events) {
    sequence.callback(1, item);
  }
  for (const call of source.triggerAttackRelease.mock.calls) calls.push(call);
  return calls.map((call) => ({
    frequency: call[0],
    duration: call[1],
    time: call[2],
    velocity: call[3],
  }));
}

describe("ArpeggioEngine ambient pad", () => {
  beforeEach(() => {
    tone.store.gains = [];
    tone.store.synths = [];
    tone.store.lastConfigured = undefined;
    tone.store.sequences = [];
    tone.store.chainInput = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers chords with audible pitches, durations and velocities", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());

    const notes = scheduledNotes();
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      // C3 (130.81 Hz) up to C5 (523.25 Hz), with a little headroom.
      expect(note.frequency).toBeGreaterThanOrEqual(130);
      expect(note.frequency).toBeLessThanOrEqual(530);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
    }
    engine.dispose();
  });

  it("keeps the pad voice and its level gain audible", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());

    const source = tone.store.lastConfigured;
    expect(Number.isFinite(source.volume.value)).toBe(true);
    expect(source.volume.value).toBeGreaterThan(-9);
    const levels = tone.store.gains.map((gain: any) => gain.gain.value);
    expect(Math.max(...levels)).toBe(1);
    engine.dispose();
  });

  it("schedules the chord notes of every event, not just the first", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params({ pad: { ...params().pad, chordLengthBars: 1 } }));

    const sequence = tone.store.sequences[tone.store.sequences.length - 1];
    const source = tone.store.lastConfigured;
    source.triggerAttackRelease.mockClear();
    for (const item of sequence.events) sequence.callback(1, item);

    // Four chord changes at 16 steps per bar, three notes in each chord.
    expect(source.triggerAttackRelease.mock.calls.length).toBeGreaterThanOrEqual(
      8,
    );
    engine.dispose();
  });
});
