import { describe, expect, it } from "vitest";
import {
  computeSkipTarget,
  estimateWord,
  findWordAt,
  lastAtOrBefore,
  ordinalToPosition,
  positionToOrdinal,
  totalWords,
  type SkipBlock,
} from "./timeline";

const timings: [number, number][] = [
  [0, 0.3],
  [0.3, 0.7],
  [0.7, 1.0],
  [1.2, 1.6],
];

describe("findWordAt", () => {
  it("returns the last word whose start ≤ t", () => {
    expect(findWordAt(timings, 0)).toBe(0);
    expect(findWordAt(timings, 0.29)).toBe(0);
    expect(findWordAt(timings, 0.3)).toBe(1);
    expect(findWordAt(timings, 1.1)).toBe(2); // inside a gap → previous word stays active
    expect(findWordAt(timings, 99)).toBe(3);
  });
  it("clamps before the first word and handles empty timings", () => {
    expect(findWordAt([[0.5, 1]], 0.1)).toBe(0);
    expect(findWordAt([], 3)).toBe(0);
  });
  it("agrees with a linear scan on a long block", () => {
    const long = Array.from({ length: 500 }, (_, i) => [i * 0.38, i * 0.38 + 0.3] as [number, number]);
    for (const t of [0, 0.37, 0.38, 17.1, 189.9, 500]) {
      const linear = long.reduce((acc, [s], i) => (s <= t ? i : acc), 0);
      expect(findWordAt(long, t)).toBe(linear);
    }
  });
});

describe("lastAtOrBefore", () => {
  it("binary-searches sorted numbers", () => {
    const starts = [0, 450, 900, 1400];
    expect(lastAtOrBefore(starts, 0)).toBe(0);
    expect(lastAtOrBefore(starts, 449)).toBe(0);
    expect(lastAtOrBefore(starts, 450)).toBe(1);
    expect(lastAtOrBefore(starts, 10_000)).toBe(3);
  });
});

describe("ordinal ↔ position", () => {
  const blocks = [
    { wordStart: 0, wordCount: 3 },
    { wordStart: 3, wordCount: 1 },
    { wordStart: 4, wordCount: 5 },
  ];
  it("maps ordinals to block/word and back", () => {
    for (let ord = 0; ord < totalWords(blocks); ord++) {
      const pos = ordinalToPosition(blocks, ord);
      expect(positionToOrdinal(blocks, pos)).toBe(ord);
    }
    expect(ordinalToPosition(blocks, 3)).toEqual({ blockIndex: 1, wordIndex: 0 });
    expect(ordinalToPosition(blocks, 4)).toEqual({ blockIndex: 2, wordIndex: 0 });
  });
  it("clamps out-of-range input", () => {
    expect(ordinalToPosition(blocks, -5)).toEqual({ blockIndex: 0, wordIndex: 0 });
    expect(ordinalToPosition(blocks, 1e9)).toEqual({ blockIndex: 2, wordIndex: 4 });
    expect(positionToOrdinal(blocks, { blockIndex: 0, wordIndex: 99 })).toBe(2);
    expect(ordinalToPosition([], 3)).toEqual({ blockIndex: 0, wordIndex: 0 });
  });
});

describe("computeSkipTarget", () => {
  const blocks: SkipBlock[] = [
    { wordCount: 10, durationSec: 10 },
    { wordCount: 20, durationSec: 20 },
    { wordCount: 50, durationSec: null }, // not synthesised yet → 50 × 0.4 = 20 s estimate
    { wordCount: 5, durationSec: 5 },
  ];
  const spw = 0.4;

  it("stays within the block when possible", () => {
    expect(computeSkipTarget(blocks, { blockIndex: 1, time: 2 }, 15, spw)).toEqual({ blockIndex: 1, time: 17, exact: true });
    expect(computeSkipTarget(blocks, { blockIndex: 1, time: 18 }, -15, spw)).toEqual({ blockIndex: 1, time: 3, exact: true });
  });
  it("walks forward across blocks", () => {
    expect(computeSkipTarget(blocks, { blockIndex: 0, time: 8 }, 15, spw)).toEqual({ blockIndex: 1, time: 13, exact: true });
    const t = computeSkipTarget(blocks, { blockIndex: 1, time: 15 }, 15, spw);
    expect(t.blockIndex).toBe(2);
    expect(t.time).toBeCloseTo(10);
    expect(t.exact).toBe(false);
  });
  it("walks backward across blocks", () => {
    expect(computeSkipTarget(blocks, { blockIndex: 1, time: 5 }, -15, spw)).toEqual({ blockIndex: 0, time: 0, exact: true });
    expect(computeSkipTarget(blocks, { blockIndex: 3, time: 1 }, -15, spw)).toEqual({ blockIndex: 2, time: 6, exact: false });
  });
  it("clamps at document start and end", () => {
    expect(computeSkipTarget(blocks, { blockIndex: 0, time: 3 }, -15, spw)).toEqual({ blockIndex: 0, time: 0, exact: true });
    const end = computeSkipTarget(blocks, { blockIndex: 3, time: 2 }, 15, spw);
    expect(end.blockIndex).toBe(3);
    expect(end.time).toBeCloseTo(4.75);
  });
  it("estimates a word for unloaded blocks", () => {
    expect(estimateWord(50, 10, 0.4)).toBe(25);
    expect(estimateWord(50, 999, 0.4)).toBe(49);
    expect(estimateWord(50, -1, 0.4)).toBe(0);
  });
});
