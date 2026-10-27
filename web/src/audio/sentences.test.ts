import { describe, expect, it } from "vitest";
import { estimatedWordFrom, RateEstimator, wordAtChar, wordOffsets, type RateStorage } from "./estimator";
import { sentenceRanges, splitSentences } from "./sentences";

describe("sentences", () => {
  it("splits on terminal punctuation followed by a capital", () => {
    expect(splitSentences("It was late. The rabbit ran on! Would she follow it down?")).toEqual([
      "It was late. The rabbit ran on!",
      "Would she follow it down?",
    ]);
  });

  it("does not split after abbreviations, initials or dotted acronyms", () => {
    expect(splitSentences("Mr. Bennet met Dr. Jones in the U.S. last May. They talked for hours about the weather.")).toHaveLength(2);
    expect(splitSentences("The book by J. K. Rowling was long and well loved. Everyone read it.")).toHaveLength(1);
  });

  it("covers every word exactly once", () => {
    const words = "One two three. Four five six seven. Eight; nine ten eleven twelve thirteen.".split(" ");
    const ranges = sentenceRanges(words);
    expect(ranges.reduce((n, r) => n + r.count, 0)).toBe(words.length);
    ranges.forEach((r, i) => i > 0 && expect(r.start).toBe(ranges[i - 1].start + ranges[i - 1].count));
  });

  it("splits very long sentences at clause boundaries", () => {
    const clause = "and the words went on and on without a single stop";
    const text = `${clause}; ${clause}; ${clause}; ${clause}.`;
    expect(splitSentences(text).length).toBeGreaterThan(1);
  });
});

describe("estimator and boundary mapping", () => {
  const words = ["Alice", "was", "beginning", "to", "get"];
  const offsets = wordOffsets(words);

  it("maps a boundary charIndex to its word", () => {
    expect(offsets).toEqual([0, 6, 10, 20, 23]);
    expect(wordAtChar(offsets, 0)).toBe(0);
    expect(wordAtChar(offsets, 6)).toBe(1);
    expect(wordAtChar(offsets, 9)).toBe(1); // the space after "was"
    expect(wordAtChar(offsets, 21)).toBe(3);
    expect(wordAtChar(offsets, 999)).toBe(4);
  });

  it("estimates forward from the last real boundary", () => {
    expect(estimatedWordFrom(offsets, 0, 0, 15, 1)).toBe(0);
    expect(estimatedWordFrom(offsets, 0, 0.7, 15, 1)).toBe(2); // 10.5 chars
    expect(estimatedWordFrom(offsets, 2, 0.7, 15, 1)).toBe(3); // from "beginning"
    expect(estimatedWordFrom(offsets, 0, 0.7, 15, 2)).toBe(3); // twice the speed
  });

  it("learns a voice's rate and ignores implausible samples", () => {
    let saved = {};
    const storage: RateStorage = { load: () => saved, save: (r) => (saved = r) };
    const est = new RateEstimator(storage);
    expect(est.charsPerSecond("v")).toBe(15);
    est.record("v", 200, 10, 1); // 20 cps
    expect(est.charsPerSecond("v")).toBeCloseTo(20);
    est.record("v", 200, 5, 2); // 20 cps at 2x
    expect(est.charsPerSecond("v")).toBeCloseTo(20);
    est.record("v", 200, 0.5, 1); // 400 cps: a glitch
    expect(est.charsPerSecond("v")).toBeCloseTo(20);
    est.record("v", 5, 10, 1); // too short to trust
    expect(new RateEstimator(storage).charsPerSecond("v")).toBeCloseTo(20); // persisted
  });
});
