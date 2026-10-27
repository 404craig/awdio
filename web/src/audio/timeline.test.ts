import { describe, expect, it } from "vitest";
import { blockAtChar, blockCharStarts, lastAtOrBefore, ordinalToPosition, positionToOrdinal, totalWords } from "./timeline";

describe("lastAtOrBefore", () => {
  it("binary-searches sorted numbers", () => {
    const starts = [0, 450, 900, 1400];
    expect(lastAtOrBefore(starts, 0)).toBe(0);
    expect(lastAtOrBefore(starts, 449)).toBe(0);
    expect(lastAtOrBefore(starts, 450)).toBe(1);
    expect(lastAtOrBefore(starts, 10_000)).toBe(3);
    expect(lastAtOrBefore([], 3)).toBe(0);
  });
});

describe("word ordinals", () => {
  const blocks = [
    { wordStart: 0, wordCount: 5 },
    { wordStart: 5, wordCount: 1 },
    { wordStart: 6, wordCount: 10 },
  ];
  it("round-trips positions and ordinals", () => {
    expect(totalWords(blocks)).toBe(16);
    for (let ordinal = 0; ordinal < 16; ordinal++) {
      expect(positionToOrdinal(blocks, ordinalToPosition(blocks, ordinal))).toBe(ordinal);
    }
    expect(ordinalToPosition(blocks, 5)).toEqual({ blockIndex: 1, wordIndex: 0 });
  });
  it("clamps out-of-range values", () => {
    expect(ordinalToPosition(blocks, -3)).toEqual({ blockIndex: 0, wordIndex: 0 });
    expect(ordinalToPosition(blocks, 99)).toEqual({ blockIndex: 2, wordIndex: 9 });
    expect(positionToOrdinal(blocks, { blockIndex: 0, wordIndex: 42 })).toBe(4);
    expect(ordinalToPosition([], 3)).toEqual({ blockIndex: 0, wordIndex: 0 });
  });
});

describe("character positions", () => {
  const texts = ["Hello there.", "Hi.", "A longer third block."];
  const starts = blockCharStarts(texts);
  const total = starts[2] + texts[2].length;
  it("lays blocks out with one separator between them", () => {
    expect(starts).toEqual([0, 13, 17]);
  });
  it("maps a global character to its block, clamped", () => {
    expect(blockAtChar(starts, total, 14)).toEqual({ blockIndex: 1, char: 1 });
    expect(blockAtChar(starts, total, -50)).toEqual({ blockIndex: 0, char: 0 });
    expect(blockAtChar(starts, total, 10_000)).toEqual({ blockIndex: 2, char: texts[2].length - 1 });
  });
});
