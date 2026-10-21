/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal Tone stand-in: enough of the node graph to observe connections and
// parameter ramps without an AudioContext (Tone can't run under Node).
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

  const store: any = { gains: [] };

  class BaseNode {
    connections = new Set<any>();
    connect(dest: any) {
      this.connections.add(dest);
      return dest;
    }
    disconnect() {
      this.connections.clear();
    }
    chain(...nodes: any[]) {
      const all = [this, ...nodes];
      for (let i = 0; i < all.length - 1; i++) {
        all[i].connect(all[i + 1]);
      }
      return this;
    }
    toDestination() {
      this.connect(store.destination);
      return this;
    }
    dispose() {}
  }

  class EffectNode extends BaseNode {
    wet = new Param(0);
    constructor(options: any = {}) {
      super();
      if (typeof options.wet === "number") this.wet.value = options.wet;
    }
  }

  class Freeverb extends EffectNode {
    roomSize = new Param(0.7);
    dampening = 3000;
    constructor(options: any = {}) {
      super(options);
      if (typeof options.roomSize === "number")
        this.roomSize.value = options.roomSize;
      if (typeof options.dampening === "number")
        this.dampening = options.dampening;
      store.freeverb = this;
    }
  }

  class Distortion extends EffectNode {
    distortion = 0;
    constructor(options: any = {}) {
      super(options);
      if (typeof options.distortion === "number")
        this.distortion = options.distortion;
    }
  }

  class Phaser extends EffectNode {}

  class Chorus extends EffectNode {
    frequency = new Param(1.5);
    depth = 0.7;
    start = vi.fn();
    constructor(options: any = {}) {
      super(options);
      if (typeof options.depth === "number") this.depth = options.depth;
    }
  }

  class Vibrato extends EffectNode {
    frequency = new Param(5);
    depth = new Param(0);
  }

  class Filter extends BaseNode {
    frequency = new Param(20000);
    constructor(frequency = 20000) {
      super();
      this.frequency.value = frequency;
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

  class Gain extends BaseNode {
    gain = new Param(1);
    constructor(value = 1) {
      super();
      this.gain.value = value;
      if (!store.chainInput) store.chainInput = this;
      store.gains.push(this);
    }
  }

  class Limiter extends BaseNode {
    constructor(_threshold: number) {
      super();
      void _threshold;
      store.limiter = this;
    }
  }

  class Meter extends BaseNode {
    getValue = vi.fn(() => -Infinity);
  }

  class MonoSynth extends BaseNode {
    volume = new Param(0);
    set = vi.fn();
    triggerAttackRelease = vi.fn();
  }
  class FMSynth extends MonoSynth {}
  class Synth extends MonoSynth {}
  class MembraneSynth extends BaseNode {
    pitchDecay = 0.05;
    octaves = 3;
    envelope: any;
    volume = new Param(0);
    triggerAttackRelease = vi.fn();
    constructor(options: any = {}) {
      super();
      this.pitchDecay = options?.pitchDecay ?? 0.05;
      this.octaves = options?.octaves ?? 3;
      this.envelope = options?.envelope;
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
    }
  }

  class Sequence extends BaseNode {
    loop = false;
    start = vi.fn();
    stop = vi.fn();
    constructor(callback: any, events: any, subdivision: any) {
      super();
      void callback;
      void events;
      void subdivision;
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
  const draw = { schedule: vi.fn() };

  return {
    store,
    destination,
    Context: class {
      constructor(_options?: any) {
        void _options;
      }
    },
    setContext: vi.fn(),
    getContext: () => context,
    getTransport: () => transport,
    getDraw: () => draw,
    getDestination: () => destination,
    now: () => 0,
    gainToDb: (value: number) => 20 * Math.log10(value),
    Frequency: (value: number) => ({ toFrequency: () => value }),
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
import type { ArpeggioParams } from "./types";

function params(effects: Record<string, number>): ArpeggioParams {
  return {
    seed: 1,
    tempo: 96,
    root: "D",
    scale: "dorian",
    density: 0.6,
    swing: 0.1,
    effects: effects as ArpeggioParams["effects"],
    arpeggio: { pattern: "up", octaves: 2, stepLength: "16n" },
  };
}

describe("ArpeggioEngine reverb (Tone.Freeverb)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tone.store.gains = [];
    tone.store.chainInput = undefined;
    tone.store.freeverb = undefined;
    tone.store.limiter = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the reverb as Freeverb with fixed roomSize 0.8 and dampening 3000", () => {
    const engine = new ArpeggioEngine();
    expect(tone.store.freeverb.roomSize.value).toBe(0.8);
    expect(tone.store.freeverb.dampening).toBe(3000);
    engine.dispose();
  });

  it("0.35 -> 0.6 only updates wet and never roomSize/dampening", () => {
    const engine = new ArpeggioEngine();
    const reverb = tone.store.freeverb;

    engine.update(params({ delay: 0.2, reverb: 0.35 }));
    engine.update(params({ delay: 0.2, reverb: 0.6 }));

    expect(reverb.wet.rampTo).toHaveBeenLastCalledWith(0.6, expect.any(Number));
    expect(reverb.roomSize.rampTo).not.toHaveBeenCalled();
    expect(reverb.roomSize.value).toBe(0.8);
    expect(reverb.dampening).toBe(3000);
    engine.dispose();
  });

  it("0 -> 0.3 connects the reverb into the chain", () => {
    const engine = new ArpeggioEngine();
    const reverb = tone.store.freeverb;

    engine.update(params({ reverb: 0.3 }));

    expect(tone.store.chainInput.connections.has(reverb)).toBe(true);
    expect(reverb.connections.has(tone.store.limiter)).toBe(true);
    engine.dispose();
  });

  it("0.3 -> 0 disconnects only after the settle time", () => {
    const engine = new ArpeggioEngine();
    const reverb = tone.store.freeverb;

    engine.update(params({ reverb: 0.3 }));
    engine.update(params({}));

    // Still connected during the wet ramp-down.
    expect(tone.store.chainInput.connections.has(reverb)).toBe(true);

    vi.advanceTimersByTime(50);
    expect(tone.store.chainInput.connections.has(reverb)).toBe(true);

    vi.advanceTimersByTime(40);
    expect(tone.store.chainInput.connections.has(reverb)).toBe(false);
    expect(reverb.connections.has(tone.store.limiter)).toBe(false);
    engine.dispose();
  });
});
