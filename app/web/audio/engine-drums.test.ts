/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  const store: any = { gains: [], synths: [], sequences: [], membrane: [], noise: [], filters: [] };

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
    Q = new Param(1);
    type: string;
    rolloff: number;
    constructor(options: any = {}) {
      super();
      this.type = options?.type ?? "lowpass";
      this.frequency.value = options?.frequency ?? 20000;
      this.Q.value = options?.Q ?? 1;
      this.rolloff = options?.rolloff ?? -12;
      store.filters.push(this);
    }
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
      store.membrane.push(this);
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
      store.noise.push(this);
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
import { generateDrums } from "./generators/drums";
import type { DrumParams } from "./types";
import { DRUM_LANES } from "./types";

function params(overrides: Partial<DrumParams> = {}): DrumParams {
  return {
    seed: 1,
    tempo: 96,
    root: "D",
    scale: "dorian",
    density: 0.8,
    swing: 0,
    effects: {},
    drums: {
      style: "breakbeat",
      kit: "electronic",
      steps: 16,
      ghostNotes: 0.2,
      fills: 0.2,
      hatDensity: 0.6,
    },
    ...overrides,
  };
}

describe("ArpeggioEngine drums", () => {
  beforeEach(() => {
    tone.store.gains = [];
    tone.store.synths = [];
    tone.store.membrane = [];
    tone.store.noise = [];
    tone.store.filters = [];
    tone.store.lastConfigured = undefined;
    tone.store.sequences = [];
    tone.store.chainInput = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules drum hits for each lane with non-zero velocity", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());
    const sequence = tone.store.sequences[tone.store.sequences.length - 1];
    const lanes = new Set<string>();
    for (const item of sequence.events) {
      if (!item?.drums) continue;
      for (const event of item.drums) {
        lanes.add(event.lane);
        expect(event.velocity).toBeGreaterThan(0);
        expect(event.velocity).toBeLessThanOrEqual(1);
      }
    }
    expect(lanes.size).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(DRUM_LANES).toContain(lane);
    }
    engine.dispose();
  });

  it("triggers the lane instruments when a step sounds", async () => {
    const engine = new ArpeggioEngine();
    await engine.start(params());
    const sequence = tone.store.sequences[tone.store.sequences.length - 1];
    const callBefore = tone.store.membrane
      .map((m: any) => m.triggerAttackRelease.mock.calls.length)
      .reduce((a: number, b: number) => a + b, 0) +
      tone.store.noise
        .map((n: any) => n.triggerAttackRelease.mock.calls.length)
        .reduce((a: number, b: number) => a + b, 0);
    let triggered = 0;
    for (const item of sequence.events) {
      if (!item?.drums || item.drums.length === 0) continue;
      // The callbacks record calls via the mocked sources.
      (sequence as any).callback(1, item);
      triggered++;
      if (triggered >= 3) break;
    }
    const callAfter = tone.store.membrane
      .map((m: any) => m.triggerAttackRelease.mock.calls.length)
      .reduce((a: number, b: number) => a + b, 0) +
      tone.store.noise
        .map((n: any) => n.triggerAttackRelease.mock.calls.length)
        .reduce((a: number, b: number) => a + b, 0);
    expect(callAfter).toBeGreaterThan(callBefore);
    engine.dispose();
  });

  it("keeps the pattern identical when only playback or kit settings change", async () => {
    const engine = new ArpeggioEngine();
    const base = params();
    await engine.start(base);
    const first = generateDrums(base);
    engine.update({ ...base, tempo: 120, swing: 0.4, effects: { reverb: 0.8 } });
    const second = generateDrums({ ...base, tempo: 120, swing: 0.4, effects: { reverb: 0.8 } });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    engine.dispose();
  });

  it("warns in dev when the drum pattern schedules no events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = new ArpeggioEngine();
    await engine.start(params({ density: 0 }));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no scheduled events/));
    engine.dispose();
  });
});
