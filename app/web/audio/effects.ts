import type { EffectId } from "../lib/studio-state";

export const FILTER_MAX_HZ = 20000;
export const FILTER_MIN_HZ = 400;

export function effectAmount(
  effects: Partial<Record<EffectId, number>>,
  id: EffectId,
): number {
  const value = effects[id];
  return value === undefined ? 0 : value;
}

export function filterCutoff(level: number): number {
  const clamped = Math.min(1, Math.max(0, level));
  return FILTER_MAX_HZ * Math.pow(FILTER_MIN_HZ / FILTER_MAX_HZ, clamped);
}
