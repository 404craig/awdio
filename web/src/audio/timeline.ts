/**
 * Pure helpers for the word-indexed timeline (docs/SPEC.md §4) and timing lookups.
 * No DOM, no I/O: unit-tested in timeline.test.ts.
 */

export interface Position {
  blockIndex: number;
  wordIndex: number;
}

export type Timings = readonly (readonly [number, number])[];

/** Index of the last element whose value ≤ target (0 when target precedes all). */
export function lastAtOrBefore(sorted: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The word being spoken at time t: the last word whose start ≤ t. */
export function findWordAt(timings: Timings, t: number): number {
  let lo = 0;
  let hi = timings.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timings[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Minimal block shape the timeline needs. */
export interface TimelineBlock {
  wordStart: number;
  wordCount: number;
}

export function totalWords(blocks: readonly TimelineBlock[]): number {
  const last = blocks[blocks.length - 1];
  return last ? last.wordStart + last.wordCount : 0;
}

export function positionToOrdinal(blocks: readonly TimelineBlock[], pos: Position): number {
  const block = blocks[pos.blockIndex];
  if (!block) return 0;
  return block.wordStart + Math.min(Math.max(pos.wordIndex, 0), block.wordCount - 1);
}

/** Global word ordinal → (block, word), clamped to the document. */
export function ordinalToPosition(blocks: readonly TimelineBlock[], ordinal: number): Position {
  if (blocks.length === 0) return { blockIndex: 0, wordIndex: 0 };
  const clamped = Math.min(Math.max(Math.floor(ordinal), 0), totalWords(blocks) - 1);
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (blocks[mid].wordStart <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return { blockIndex: lo, wordIndex: clamped - blocks[lo].wordStart };
}

/** Where a block's audio stands for skip computation: duration when known, else an estimate. */
export interface SkipBlock {
  wordCount: number;
  durationSec: number | null;
}

export interface SkipTarget {
  blockIndex: number;
  /** Seconds into the block's audio. Exact when the block's duration was known. */
  time: number;
  exact: boolean;
}

/**
 * Move `delta` seconds from `time` within `blockIndex`, walking across block boundaries.
 * Unknown durations are estimated from word count × secondsPerWord. Clamped to the document.
 */
export function computeSkipTarget(
  blocks: readonly SkipBlock[],
  from: { blockIndex: number; time: number },
  delta: number,
  secondsPerWord: number,
): SkipTarget {
  const duration = (i: number) => blocks[i].durationSec ?? blocks[i].wordCount * secondsPerWord;
  let b = from.blockIndex;
  let t = from.time + delta;
  while (t < 0) {
    if (b === 0) return { blockIndex: 0, time: 0, exact: true };
    b -= 1;
    t += duration(b);
  }
  while (t >= duration(b)) {
    if (b === blocks.length - 1) {
      return { blockIndex: b, time: Math.max(0, duration(b) - 0.25), exact: blocks[b].durationSec !== null };
    }
    t -= duration(b);
    b += 1;
  }
  return { blockIndex: b, time: t, exact: blocks[b].durationSec !== null };
}

/** Word index for an estimated time inside a block whose timings are not loaded yet. */
export function estimateWord(wordCount: number, time: number, secondsPerWord: number): number {
  return Math.min(wordCount - 1, Math.max(0, Math.floor(time / secondsPerWord)));
}
