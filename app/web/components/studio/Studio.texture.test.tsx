// @vitest-environment jsdom
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
    start: vi.fn(async () => {}),
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

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Studio } from "./Studio";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={typeof href === "string" ? href : undefined} {...rest}>
      {children}
    </a>
  ),
}));

function lastSequence() {
  return tone.store.sequences[tone.store.sequences.length - 1];
}

describe("Studio texture playback", () => {
  beforeEach(() => {
    tone.store.gains = [];
    tone.store.synths = [];
    tone.store.noise = [];
    tone.store.sequences = [];
    tone.store.chainInput = undefined;
    tone.store.lastConfigured = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("plays texture, triggers in-range auditable gestures, and stops", async () => {
    render(<Studio />);

    fireEvent.click(screen.getByRole("tab", { name: "Texture" }));
    const save = screen.getByRole("button", { name: /Save & get link/ });
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
      expect(tone.store.sequences.length).toBeGreaterThan(0);
    });

    const sequence = lastSequence();
    const noise = tone.store.noise.slice(-3);
    const shimmer = tone.store.synths[tone.store.synths.length - 1];
    for (const source of noise) source.triggerAttackRelease.mockClear();
    shimmer.triggerAttackRelease.mockClear();
    for (const item of sequence.events) sequence.callback(1, item);

    const noiseCalls = noise.flatMap((source: any) =>
      source.triggerAttackRelease.mock.calls,
    );
    const shimmerCalls = shimmer.triggerAttackRelease.mock.calls;
    expect(noiseCalls.length + shimmerCalls.length).toBeGreaterThan(0);
    for (const call of noiseCalls) {
      expect(call[0]).toBeGreaterThanOrEqual(0.05);
      expect(call[2]).toBeGreaterThan(0);
      expect(call[2]).toBeLessThanOrEqual(0.5);
    }
    for (const call of shimmerCalls) {
      expect(call[0]).toBeGreaterThanOrEqual(261);
      expect(call[0]).toBeLessThanOrEqual(1047);
      expect(call[3]).toBeGreaterThan(0);
      expect(call[3]).toBeLessThanOrEqual(0.5);
    }

    const textureLevels = tone.store.gains
      .slice(-4)
      .map((gain: any) => gain.gain.value);
    expect(Math.min(...textureLevels)).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    });
    expect(tone.getTransport().stop).toHaveBeenCalled();
    expect(tone.store.sequences.length).toBeGreaterThan(0);
  });
});
