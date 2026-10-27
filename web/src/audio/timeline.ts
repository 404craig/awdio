/**
 * Pure helpers for the word-indexed timeline (docs/DECISIONS.md D3) and character positions.
 * No DOM, no I/O: unit-tested in timeline.test.ts.
 */

export interface Position {
  blockIndex: number;
  wordIndex: number;
}

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

/** Start of each block in the document's spoken characters (one separator between blocks). */
export function blockCharStarts(texts: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const t of texts) {
    starts.push(at);
    at += t.length + 1;
  }
  return starts;
}

/** Global character position → (block, character within the block), clamped to the document. */
export function blockAtChar(starts: readonly number[], totalChars: number, char: number): { blockIndex: number; char: number } {
  const clamped = Math.min(Math.max(char, 0), Math.max(totalChars - 1, 0));
  const blockIndex = lastAtOrBefore(starts, clamped);
  return { blockIndex, char: clamped - (starts[blockIndex] ?? 0) };
}
