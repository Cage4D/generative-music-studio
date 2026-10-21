import * as Tone from "tone";
import { DRUM_KITS, DRUM_LANES, type DrumKitName, type DrumLane } from "./types";

/**
 * The kit. Every lane has one instrument per kit flavour, all of them built
 * once and kept alive: switching the kit crossfades the lane levels, it never
 * builds or disposes a synth while the transport runs.
 *
 * The kit is a timbre, so it never changes a note. It only changes how the
 * note sounds.
 */

export type DrumInstrumentKind = "membrane" | "noise";

export type DrumEnvelope = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

export type DrumVoiceConfig = {
  kind: DrumInstrumentKind;
  /** The membrane note, for the pitched lanes. */
  note?: string;
  /** The length of the hit, in seconds. */
  duration: number;
  /** The lane level. The loudest lane sits about 6 dB below unity. */
  level: number;
  envelope: DrumEnvelope;
  pitchDecay?: number;
  octaves?: number;
  noiseType?: "white" | "pink" | "brown";
  filterType?: BiquadFilterType;
  filterFrequency?: number;
  filterQ?: number;
};

const membrane = (
  note: string,
  duration: number,
  level: number,
  envelope: DrumEnvelope,
  pitchDecay: number,
  octaves: number,
): DrumVoiceConfig => ({
  kind: "membrane",
  note,
  duration,
  level,
  envelope,
  pitchDecay,
  octaves,
});

const noise = (
  duration: number,
  level: number,
  envelope: DrumEnvelope,
  noiseType: "white" | "pink" | "brown",
  filterType: BiquadFilterType,
  filterFrequency: number,
  filterQ: number,
): DrumVoiceConfig => ({
  kind: "noise",
  duration,
  level,
  envelope,
  noiseType,
  filterType,
  filterFrequency,
  filterQ,
});

/**
 * The kick is tuned to C2 (65 Hz) with a fast pitch drop, so the note has a
 * click and mid content that survives on laptop speakers.
 */
export const DRUM_KIT_TABLE: Record<DrumKitName, Record<DrumLane, DrumVoiceConfig>> = {
  electronic: {
    kick: membrane("C2", 0.3, 0.5, { attack: 0.005, decay: 0.22, sustain: 0, release: 0.05 }, 0.04, 6),
    snare: noise(0.18, 0.42, { attack: 0.005, decay: 0.13, sustain: 0, release: 0.05 }, "white", "bandpass", 1800, 0.8),
    clap: noise(0.22, 0.4, { attack: 0.005, decay: 0.15, sustain: 0, release: 0.06 }, "white", "bandpass", 1100, 1.2),
    "closed-hat": noise(0.06, 0.3, { attack: 0.005, decay: 0.035, sustain: 0, release: 0.02 }, "white", "highpass", 7000, 0.7),
    "open-hat": noise(0.38, 0.32, { attack: 0.005, decay: 0.3, sustain: 0, release: 0.08 }, "white", "highpass", 6500, 0.7),
    perc: membrane("A2", 0.16, 0.34, { attack: 0.005, decay: 0.11, sustain: 0, release: 0.04 }, 0.03, 3),
  },
  acoustic: {
    kick: membrane("C2", 0.4, 0.5, { attack: 0.006, decay: 0.3, sustain: 0, release: 0.08 }, 0.08, 3),
    snare: noise(0.24, 0.42, { attack: 0.005, decay: 0.17, sustain: 0, release: 0.06 }, "pink", "bandpass", 1400, 0.6),
    clap: noise(0.28, 0.38, { attack: 0.006, decay: 0.19, sustain: 0, release: 0.08 }, "pink", "bandpass", 900, 1),
    "closed-hat": noise(0.07, 0.28, { attack: 0.005, decay: 0.045, sustain: 0, release: 0.02 }, "white", "highpass", 6000, 0.7),
    "open-hat": noise(0.46, 0.3, { attack: 0.005, decay: 0.38, sustain: 0, release: 0.1 }, "white", "highpass", 5500, 0.7),
    perc: membrane("A2", 0.2, 0.32, { attack: 0.005, decay: 0.14, sustain: 0, release: 0.05 }, 0.04, 2),
  },
  lofi: {
    kick: membrane("C2", 0.46, 0.48, { attack: 0.008, decay: 0.36, sustain: 0, release: 0.1 }, 0.06, 2.5),
    snare: noise(0.26, 0.4, { attack: 0.006, decay: 0.19, sustain: 0, release: 0.08 }, "brown", "lowpass", 2600, 0.5),
    clap: noise(0.3, 0.36, { attack: 0.006, decay: 0.21, sustain: 0, release: 0.1 }, "brown", "lowpass", 1400, 0.6),
    "closed-hat": noise(0.08, 0.26, { attack: 0.005, decay: 0.05, sustain: 0, release: 0.03 }, "pink", "lowpass", 6500, 0.5),
    "open-hat": noise(0.5, 0.28, { attack: 0.005, decay: 0.4, sustain: 0, release: 0.12 }, "pink", "lowpass", 6000, 0.5),
    perc: membrane("G2", 0.22, 0.3, { attack: 0.006, decay: 0.15, sustain: 0, release: 0.06 }, 0.05, 2),
  },
};

export type DrumInstrument = {
  lane: DrumLane;
  kit: DrumKitName;
  source: Tone.MembraneSynth | Tone.NoiseSynth;
  filter: Tone.Filter | null;
  level: Tone.Gain;
  nodes: Tone.ToneAudioNode[];
  /** The length of the hit, in seconds. */
  duration: number;
  trigger: (duration: number, time: number, velocity: number) => void;
};

/** Build one persistent drum instrument and wire it to the given input. */
export function buildDrumInstrument(
  lane: DrumLane,
  kit: DrumKitName,
  destination: Tone.ToneAudioNode,
): DrumInstrument {
  const config = DRUM_KIT_TABLE[kit][lane];
  const level = new Tone.Gain(0);
  level.connect(destination);

  if (config.kind === "membrane") {
    const source = new Tone.MembraneSynth({
      pitchDecay: config.pitchDecay ?? 0.05,
      octaves: config.octaves ?? 3,
      envelope: config.envelope,
    });
    source.connect(level);
    const note = config.note ?? "C2";
    return {
      lane,
      kit,
      source,
      filter: null,
      level,
      nodes: [source, level],
      duration: config.duration,
      trigger: (duration, time, velocity) => {
        source.triggerAttackRelease(note, duration, time, velocity);
      },
    };
  }

  const source = new Tone.NoiseSynth({ envelope: config.envelope });
  source.noise.type = config.noiseType ?? "white";
  const filter = new Tone.Filter({
    type: config.filterType ?? "bandpass",
    frequency: config.filterFrequency ?? 1000,
    Q: config.filterQ ?? 0.7,
    rolloff: -12,
  });
  source.connect(filter);
  filter.connect(level);
  return {
    lane,
    kit,
    source,
    filter,
    level,
    nodes: [source, filter, level],
    duration: config.duration,
    trigger: (duration, time, velocity) => {
      source.triggerAttackRelease(duration, time, velocity);
    },
  };
}

/** Every lane of every kit, in a stable order. */
export function drumInstrumentKeys(): { lane: DrumLane; kit: DrumKitName }[] {
  const keys: { lane: DrumLane; kit: DrumKitName }[] = [];
  for (const lane of DRUM_LANES) {
    for (const kit of DRUM_KITS) {
      keys.push({ lane, kit });
    }
  }
  return keys;
}
