import * as Tone from "tone";
import {
  TEXTURE_VOICE_KINDS,
  type TextureParams,
  type TextureVoiceKind,
} from "./types";

/**
 * Four persistent texture instruments, built once. Switching voice, filtering
 * or noise type only reconfigures them: no synth is ever built or disposed
 * while the transport runs.
 *
 * Every envelope has an attack of at least 5 ms and a release of at least
 * 20 ms, so a grain can never click or be cut hard. The loudest voice sits
 * about 6 dB below unity.
 */

export const TEXTURE_MIN_ATTACK = 0.005;
export const TEXTURE_MIN_RELEASE = 0.02;

const VOICE_GAINS: Record<TextureVoiceKind, number> = {
  dust: 0.4,
  rain: 0.46,
  shimmer: 0.46,
  breath: 0.4,
};

// The grains are much quieter than a melody note, so a small trim keeps the
// texture present on laptop speakers without letting it dominate the mix.
export const TEXTURE_GAIN_TRIM = 1.2;

export const TEXTURE_VOICE_LEVEL: Record<TextureVoiceKind, number> = {
  dust: VOICE_GAINS.dust * TEXTURE_GAIN_TRIM,
  rain: VOICE_GAINS.rain * TEXTURE_GAIN_TRIM,
  shimmer: VOICE_GAINS.shimmer * TEXTURE_GAIN_TRIM,
  breath: VOICE_GAINS.breath * TEXTURE_GAIN_TRIM,
};

// Each noise family keeps its own centre around the user's filter frequency,
// so the archetypes stay timbrally distinct even when the setting changes.
const FILTER_MULTIPLIER: Record<Exclude<TextureVoiceKind, "shimmer">, number> = {
  dust: 2.2,
  rain: 1,
  breath: 0.45,
};

const FILTER_Q: Record<Exclude<TextureVoiceKind, "shimmer">, number> = {
  dust: 0.7,
  rain: 0.9,
  breath: 0.6,
};

export type TextureInstrument = {
  kind: TextureVoiceKind;
  source: Tone.NoiseSynth | Tone.Synth;
  filter: Tone.Filter | null;
  level: Tone.Gain;
  nodes: Tone.ToneAudioNode[];
  /** True for the tonal (shimmer) family: the trigger takes a frequency. */
  tonal: boolean;
  trigger: (
    frequency: number,
    duration: number,
    time: number,
    velocity: number,
  ) => void;
  configure: (block: TextureParams["texture"]) => void;
};

function envelope(
  attack: number,
  decay: number,
  sustain: number,
  release: number,
) {
  return {
    attack: Math.max(TEXTURE_MIN_ATTACK, attack),
    decay,
    sustain,
    release: Math.max(TEXTURE_MIN_RELEASE, release),
  };
}

export function buildTextureInstrument(
  kind: TextureVoiceKind,
  destination: Tone.ToneAudioNode,
): TextureInstrument {
  const level = new Tone.Gain(0);
  level.connect(destination);

  if (kind === "shimmer") {
    const source = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: envelope(0.012, 0.35, 0.15, 0.12),
    });
    source.connect(level);
    return {
      kind,
      source,
      filter: null,
      level,
      nodes: [source, level],
      tonal: true,
      trigger: (frequency, duration, time, velocity) => {
        source.triggerAttackRelease(
          frequency,
          Math.max(0.05, duration),
          time,
          velocity,
        );
      },
      // The shimmer is tonal: the noise timbre controls do not apply to it.
      configure: () => undefined,
    };
  }

  const source = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope:
      kind === "breath"
        ? envelope(0.12, 0.5, 0.55, 0.35)
        : kind === "rain"
          ? envelope(0.006, 0.18, 0, 0.05)
          : envelope(0.005, 0.08, 0, 0.03),
  });
  const filter = new Tone.Filter({
    type: kind === "breath" ? "lowpass" : kind === "rain" ? "bandpass" : "highpass",
    frequency: kind === "breath" ? 900 : kind === "rain" ? 2200 : 1200,
    Q: FILTER_Q[kind],
    rolloff: -12,
  });
  source.connect(filter);
  filter.connect(level);

  return {
    kind,
    source,
    filter,
    level,
    nodes: [source, filter, level],
    tonal: false,
    trigger: (_frequency, duration, time, velocity) => {
      source.triggerAttackRelease(Math.max(0.05, duration), time, velocity);
    },
    configure: (block) => {
      source.noise.type = block.noiseType;
      filter.type = block.filterType;
      filter.frequency.rampTo(
        Math.min(
          12000,
          Math.max(120, block.filterFrequency * FILTER_MULTIPLIER[kind]),
        ),
        0.05,
      );
    },
  };
}

export function buildTextureInstruments(
  destination: Tone.ToneAudioNode,
): Record<TextureVoiceKind, TextureInstrument> {
  return Object.fromEntries(
    TEXTURE_VOICE_KINDS.map((kind) => [
      kind,
      buildTextureInstrument(kind, destination),
    ]),
  ) as Record<TextureVoiceKind, TextureInstrument>;
}
