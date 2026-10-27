import { describe, expect, it } from "vitest";
import { formatDuration, formatPercent, formatSpeed, nextCycleSpeed, stepSpeed } from "./format";
import { chapterOf, pageName, pageNumber, tickStep } from "./docIndex";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(7800)).toBe("~2 h 10 m");
    expect(formatDuration(3600)).toBe("~1 h");
    expect(formatDuration(20)).toBe("~1 m");
    expect(formatDuration(45 * 60, false)).toBe("45 m");
  });
  it("formats speed and percent", () => {
    expect(formatSpeed(1)).toBe("1x");
    expect(formatSpeed(1.25)).toBe("1.25x");
    expect(formatPercent(0.341)).toBe("34%");
    expect(formatPercent(2)).toBe("100%");
  });
  it("cycles and steps speeds", () => {
    expect(nextCycleSpeed(1)).toBe(1.25);
    expect(nextCycleSpeed(2.5)).toBe(0.75);
    expect(nextCycleSpeed(0.5)).toBe(0.75);
    expect(nextCycleSpeed(2.75)).toBe(0.75);
    expect(stepSpeed(3, 1)).toBe(3);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
    expect(stepSpeed(1, 1)).toBe(1.25);
  });
  it("chooses timeline tick spacing", () => {
    expect(tickStep(12)).toBe(1);
    expect(tickStep(60)).toBe(5);
    expect(tickStep(240)).toBe(10);
  });
});

describe("page naming", () => {
  const page = (index: number, label: string) => ({ index, label, blocks: [] });
  it("uses printed labels and falls back to the position for chapter labels", () => {
    expect(pageName(page(13, "12"))).toBe("Page 12");
    expect(pageName(page(2, "xii"))).toBe("Page xii");
    expect(pageName(page(35, "8 · 2"))).toBe("Page 36");
    expect(pageNumber(page(35, "Ch. 8 · 2"))).toBe("36");
    expect(chapterOf(page(35, "Ch. 8 · 2"))).toBe("Ch. 8");
    expect(chapterOf(page(13, "12"))).toBeNull();
  });
});
