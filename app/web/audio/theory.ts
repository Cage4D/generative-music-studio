import { NOTE_NAMES } from "@gms/shared";
import type { NoteName, ScaleName } from "../lib/studio-state";

export const SCALE_INTERVALS: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "pentatonic-major": [0, 2, 4, 7, 9],
  "pentatonic-minor": [0, 3, 5, 7, 10],
};

export const BASE_MIDI = 48;

export function buildPool(
  root: NoteName,
  scale: ScaleName,
  octaves: number,
): number[] {
  const rootPc = NOTE_NAMES.indexOf(root);
  const pool: number[] = [];
  for (let octave = 0; octave < octaves; octave++) {
    for (const interval of SCALE_INTERVALS[scale]) {
      pool.push(BASE_MIDI + rootPc + octave * 12 + interval);
    }
  }
  return pool;
}

export function stepSeconds(stepLength: string, tempo: number): number {
  const denominator = Number(stepLength.slice(0, -1));
  return (60 / tempo) * (4 / denominator);
}
