export const PAGE_STEPS = 16;

export function pageCount(totalSteps: number): number {
  if (totalSteps <= 0) return 1;
  return Math.ceil(totalSteps / PAGE_STEPS);
}

export function pageOf(step: number, totalSteps: number): number {
  if (step < 0) return 0;
  const page = Math.floor(step / PAGE_STEPS);
  return Math.min(page, pageCount(totalSteps) - 1);
}

export function columnOf(step: number): number {
  return ((step % PAGE_STEPS) + PAGE_STEPS) % PAGE_STEPS;
}
