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
    envelope: any;
    oscillator = new Oscillator();
    set = vi.fn((options: any) => {
      if (options?.oscillator?.type) this.oscillator.type = options.oscillator.type;
      // The engine only configures the voice it is about to play.
      store.lastConfigured = this;
    });
    triggerAttackRelease = vi.fn();
    constructor(options: any = {}) {
      super();
      this.envelope = options?.envelope;
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
import { TEXTURE_VOICE_LEVEL } from "./texture-kit";
import type { TextureParams } from "./types";

function params(overrides: Partial<TextureParams> = {}): TextureParams {
  return {
    seed: 1,
    tempo: 96,
    root: "D",
    scale: "dorian",
    density: 0.6,
    swing: 0.1,
    effects: { reverb: 0.35, delay: 0.2 },
    texture: {
      noiseType: "pink",
      filterType: "lowpass",
      filterFrequency: 2000,
      movementRate: 0.4,
      movementDepth: 0.5,
      crackle: 0.1,
    },
    ...overrides,
  };
}

type Trigger = {
  frequency: number | null;
  duration: number;
  time: number;
  velocity: number;
  kind: "dust" | "rain" | "shimmer" | "breath";
};

/**
 * The constructor creates the texture instruments last: three noise voices
 * (dust, rain, breath) and the tonal shimmer synth. The mock keeps creation
 * order, so this is the same stable order as TEXTURE_VOICE_KINDS.
 */
function textureSources() {
  return {
    noise: tone.store.noise.slice(-3),
    shimmer: tone.store.synths[tone.store.synths.length - 1],
  };
}

function scheduledTriggers(): Trigger[] {
  const sequence = tone.store.sequences[tone.store.sequences.length - 1];
  const { noise, shimmer } = textureSources();
  expect(sequence).toBeDefined();
  expect(shimmer).toBeDefined();
  for (const source of noise) source.triggerAttackRelease.mockClear();
  shimmer.triggerAttackRelease.mockClear();
  for (const item of sequence.events) sequence.callback(1, item);

  const triggers: Trigger[] = [];
  const kinds = ["dust", "rain", "breath"] as const;
  noise.forEach((source: any, index: number) => {
    for (const call of source.triggerAttackRelease.mock.calls) {
      triggers.push({
        frequency: null,
        duration: call[0],
        time: call[1],
        velocity: call[2],
        kind: kinds[index],
      });
    }
  });
  for (const call of shimmer.triggerAttackRelease.mock.calls) {
    triggers.push({
      frequency: call[0],
      duration: call[1],
      time: call[2],
      velocity: call[3],
      kind: "shimmer",
    });
  }
  return triggers;
}

describe("ArpeggioEngine texture", () => {
  beforeEach(() => {
    tone.store.gains = [];
    tone.store.synths = [];
    tone.store.noise = [];
    tone.store.lastConfigured = undefined;
    tone.store.sequences = [];
    tone.store.chainInput = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  it("triggers every texture gesture with an audible velocity and duration", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());

    const triggers = scheduledTriggers();
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      expect(trigger.duration).toBeGreaterThanOrEqual(0.05);
      expect(trigger.velocity).toBeGreaterThan(0);
      expect(trigger.velocity).toBeLessThanOrEqual(0.5);
      if (trigger.kind === "shimmer") {
        // C4 to C6.
        expect(trigger.frequency).toBeGreaterThanOrEqual(261);
        expect(trigger.frequency).toBeLessThanOrEqual(1047);
      }
    }
    engine.dispose();
  });

  it("keeps every persistent texture voice audible and crossfaded through a gain", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());

    const levels = tone.store.gains
      .slice(-4)
      .map((gain: any) => gain.gain.value);
    expect(levels).toHaveLength(4);
    expect(Math.min(...levels)).toBeGreaterThan(0);
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.6);
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(
      Math.min(...Object.values(TEXTURE_VOICE_LEVEL)) * 0.9,
    );
    engine.dispose();
  });

  it("gives every voice an attack of at least 5 ms and a release of at least 20 ms", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());

    const { noise, shimmer } = textureSources();
    for (const source of [...noise, shimmer]) {
      expect(source.envelope.attack).toBeGreaterThanOrEqual(0.005);
      expect(source.envelope.release).toBeGreaterThanOrEqual(0.02);
    }
    engine.dispose();
  });

  it("routes ?voice=shimmer through one persistent voice", async () => {
    (globalThis as any).window = { location: { search: "?voice=shimmer" } };
    const engine = new ArpeggioEngine();
    await engine.start(params());

    const sequence = tone.store.sequences[tone.store.sequences.length - 1];
    const { noise, shimmer } = textureSources();
    for (const source of noise) source.triggerAttackRelease.mockClear();
    shimmer.triggerAttackRelease.mockClear();
    for (const item of sequence.events) sequence.callback(1, item);

    expect(shimmer.triggerAttackRelease.mock.calls.length).toBeGreaterThan(0);
    expect(
      noise.reduce(
        (total: number, source: any) =>
          total + source.triggerAttackRelease.mock.calls.length,
        0,
      ),
    ).toBe(0);
    engine.dispose();
  });
});
