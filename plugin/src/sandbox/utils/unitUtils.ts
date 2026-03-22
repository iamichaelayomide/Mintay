export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function px(value?: number, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}
