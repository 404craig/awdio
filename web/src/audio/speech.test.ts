import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateEstimator, type RateStorage } from "./estimator";
import { FakeSpeechSynthesis, FakeUtterance, type FakeSpeechOptions } from "./fakeSpeech";
import { SpeechEngine, type SpeechDocument, type SpeechError } from "./speech";
import type { Position } from "./timeline";

const memory = (): RateStorage => {
  let rates = {};
  return { load: () => rates, save: (r) => (rates = r) };
};

const DOC: SpeechDocument = {
  title: "Test",
  blocks: [
    { kind: "title", text: "A Short Title" },
    { kind: "paragraph", text: "The first sentence is here. And the second sentence follows it." },
    { kind: "paragraph", text: "Last block of the test document." },
  ],
};

function setup(opts: FakeSpeechOptions = {}) {
  const synth = new FakeSpeechSynthesis({ charsPerSecond: 20, ...opts });
  const estimator = new RateEstimator(memory());
  const engine = new SpeechEngine({
    synth: () => synth,
    createUtterance: (text) => new FakeUtterance(text),
    estimator,
    now: () => Date.now(),
  });
  const positions: Position[] = [];
  const blocks: number[] = [];
  const errors: SpeechError[] = [];
  let finished = 0;
  engine.on("position", (p) => positions.push(p));
  engine.on("blockchange", ({ blockIndex }) => blocks.push(blockIndex));
  engine.on("error", (e) => errors.push(e));
  engine.on("finished", () => finished++);
  engine.load(DOC, { start: { blockIndex: 0, wordIndex: 0 }, rate: 1, voice: synth.getVoices()[1] });
  return { synth, engine, estimator, positions, blocks, errors, finished: () => finished };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SpeechEngine", () => {
  it("speaks one utterance per sentence and walks through every block", () => {
    const t = setup();
    t.engine.play();
    expect(t.synth.spoken.map((u) => u.text)).toEqual(["A Short Title"]);
    vi.advanceTimersByTime(60_000);
    expect(t.synth.spoken.map((u) => u.text)).toEqual([
      "A Short Title",
      "The first sentence is here.",
      "And the second sentence follows it.",
      "Last block of the test document.",
    ]);
    expect(t.blocks).toEqual([1, 2]);
    expect(t.finished()).toBe(1);
    expect(t.engine.playing).toBe(false);
    expect(t.errors).toEqual([]);
  });

  it("uses the chosen voice and rate for every utterance", () => {
    const t = setup();
    t.engine.setRate(1.5);
    t.engine.play();
    vi.advanceTimersByTime(60_000);
    for (const u of t.synth.spoken) {
      expect(u.voice?.name).toBe("Serena (Premium)");
      expect(u.lang).toBe("en-GB");
      expect(u.rate).toBe(1.5);
    }
  });

  it("pauses after a heading before the next block", () => {
    const t = setup();
    t.engine.play();
    // "A Short Title" = 13 chars at 20 cps ≈ 650 ms, plus the fake's 30 ms start delay.
    vi.advanceTimersByTime(700);
    expect(t.synth.spoken).toHaveLength(1);
    expect(t.engine.position.blockIndex).toBe(0);
    vi.advanceTimersByTime(520);
    expect(t.synth.spoken).toHaveLength(2);
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 0 });
  });

  it("maps boundary char indices to word indices", () => {
    const t = setup();
    t.engine.seek(1, 0);
    t.engine.play();
    vi.advanceTimersByTime(30 + ("The first ".length * 1000) / 20 + 5);
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 2 });
    // Second sentence: word indices continue from the block's start.
    vi.advanceTimersByTime(("sentence is here.".length * 1000) / 20 + 30 + ("And the ".length * 1000) / 20 + 5);
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 7 });
  });

  it("estimates the word from the speaking rate when there are no boundary events", () => {
    const t = setup({ boundaries: false });
    t.engine.seek(1, 0);
    t.engine.play();
    vi.advanceTimersByTime(1030);
    // 1 s at the default estimate of 15 cps = 15 chars → "sentence" (the fake, at 20 cps, is on "is").
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 2 });
    vi.advanceTimersByTime(340); // just before the fake finishes the sentence
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 3 });
    const seen = t.positions.filter((p) => p.blockIndex === 1).map((p) => p.wordIndex);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen); // never backwards
  });

  it("never moves the highlight past the sentence being spoken", () => {
    const t = setup({ boundaries: false, charsPerSecond: 5 });
    t.estimator.record(t.synth.getVoices()[1].voiceURI, 100, 1, 1); // estimator believes 100 cps
    t.engine.seek(1, 0);
    t.engine.play();
    vi.advanceTimersByTime(2000);
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 4 }); // "here." ends sentence one
  });

  it("seeks mid-sentence by speaking from exactly that word", () => {
    const t = setup();
    t.engine.play();
    t.engine.seek(1, 2);
    expect(t.synth.spoken[t.synth.spoken.length - 1].text).toBe("sentence is here.");
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 2 });
    vi.advanceTimersByTime(60_000);
    expect(t.finished()).toBe(1);
  });

  it("seeking while paused only moves the position", () => {
    const t = setup();
    t.engine.seek(2, 3);
    expect(t.synth.spoken).toHaveLength(0);
    expect(t.engine.position).toEqual({ blockIndex: 2, wordIndex: 3 });
    t.engine.play();
    expect(t.synth.spoken[0].text).toBe("the test document.");
  });

  it("pause cancels speech and play resumes from the current word", () => {
    const t = setup();
    t.engine.seek(1, 0);
    t.engine.play();
    vi.advanceTimersByTime(30 + ("The first sentence ".length * 1000) / 20 + 5);
    t.engine.pause();
    expect(t.synth.speaking).toBe(false);
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 3 });
    vi.advanceTimersByTime(5000);
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 3 });
    t.engine.play();
    expect(t.synth.spoken[t.synth.spoken.length - 1].text).toBe("is here.");
    expect(t.errors).toEqual([]);
  });

  it("skips by estimated seconds across blocks", () => {
    const t = setup();
    // 15 s at the default 15 cps = 225 characters: beyond the end, so it clamps to the last block.
    t.engine.skip(15);
    expect(t.engine.position.blockIndex).toBe(2);
    t.engine.skip(-1); // 15 characters back from "document."'s neighbourhood
    expect(t.engine.position.blockIndex).toBe(2);
    t.engine.skip(-15);
    expect(t.engine.position).toEqual({ blockIndex: 0, wordIndex: 0 });
  });

  it("next/previous paragraph", () => {
    const t = setup();
    t.engine.nextBlock();
    t.engine.nextBlock();
    t.engine.nextBlock();
    expect(t.engine.position.blockIndex).toBe(2);
    t.engine.prevBlock();
    expect(t.engine.position).toEqual({ blockIndex: 1, wordIndex: 0 });
  });

  it("restarts the sentence at the current word when the speed changes", () => {
    const t = setup();
    t.engine.seek(1, 6);
    t.engine.play();
    t.engine.setRate(2);
    const last = t.synth.spoken[t.synth.spoken.length - 1];
    expect(last.rate).toBe(2);
    expect(last.text).toBe("the second sentence follows it.");
  });

  it("reports a missing voice instead of throwing", () => {
    const t = setup();
    t.engine.setVoice(null);
    t.engine.play();
    expect(t.errors.map((e) => e.code)).toEqual(["no_voice"]);
    expect(t.engine.playing).toBe(false);
  });

  it("learns the speaking rate from finished utterances", () => {
    const t = setup({ charsPerSecond: 25 });
    t.engine.play();
    vi.advanceTimersByTime(60_000);
    expect(t.engine.charsPerSecond()).toBeGreaterThan(20);
    expect(t.engine.charsPerSecond()).toBeLessThan(27);
  });

  it("resumes on visibility when the utterance chain was dropped", () => {
    const t = setup();
    t.engine.seek(1, 0);
    t.engine.play();
    vi.advanceTimersByTime(100);
    const spoken = t.synth.spoken.length;
    t.synth.dropSilently();
    t.engine.resync();
    expect(t.synth.spoken.length).toBe(spoken + 1);
  });

  it("previews a voice and pauses reading", () => {
    const t = setup();
    t.engine.play();
    const done = vi.fn();
    t.engine.previewVoice(t.synth.getVoices()[0], "Hello there, this is Daniel.", done);
    expect(t.engine.playing).toBe(false);
    expect(t.synth.spoken[t.synth.spoken.length - 1].voice?.name).toBe("Daniel");
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
