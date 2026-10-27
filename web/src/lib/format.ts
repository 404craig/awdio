/** "~2 h 10 m", "~45 m", "~1 m" */
export function formatDuration(seconds: number, approx = true): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const body = h > 0 ? (m > 0 ? `${h} h ${m} m` : `${h} h`) : `${Math.max(m, 1)} m`;
  return approx ? `~${body}` : body;
}

export const formatSpeed = (speed: number) => `${Number(speed.toFixed(2))}x`;

export const formatPercent = (fraction: number) => `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`;

export const SOURCE_LABEL: Record<string, string> = {
  pdf: "PDF",
  epub: "EPUB",
  docx: "DOCX",
  txt: "TXT",
  md: "MD",
};

/** Server percent is wordOrdinal / wordCount × 100, so the last word reads just under 100. */
export const FINISHED_PERCENT = 99.5;

/** Tap-cycle speeds for the speed chip (full 0.5–3 range lives in Settings). */
export const SPEED_CYCLE = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.25;

export function nextCycleSpeed(current: number): number {
  return SPEED_CYCLE.find((s) => s > current + 1e-6) ?? SPEED_CYCLE[0];
}

export function stepSpeed(current: number, dir: 1 | -1): number {
  const next = Math.round((current + dir * SPEED_STEP) / SPEED_STEP) * SPEED_STEP;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, next));
}
