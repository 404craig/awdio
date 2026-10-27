import { describe, expect, it } from "vitest";
import { formatDuration, formatPercent, formatSpeed, nextCycleSpeed, stepSpeed } from "./format";
import { tickStep } from "./docIndex";

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
