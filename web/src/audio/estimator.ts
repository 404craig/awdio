/**
 * Speaking-rate estimator: how many characters a voice speaks per second at rate 1. Measured
 * from each utterance's start→end wall time and persisted per voice. It drives the time-left
 * figures, ±15 s skips and the word highlight when the browser sends no boundary events.
 */
import { lastAtOrBefore } from "./timeline";

export const DEFAULT_CHARS_PER_SECOND = 15;
const STORAGE_KEY = "awdio.voiceRates";
const MIN_SAMPLE_CHARS = 20;
const MAX_WEIGHT = 20;
/** Plausible range at rate 1; anything outside is a glitch (an interrupted or stalled utterance). */
const PLAUSIBLE = [4, 60] as const;

interface Rate {
  cps: number;
  samples: number;
}

export interface RateStorage {
  load(): Record<string, Rate>;
  save(rates: Record<string, Rate>): void;
}

const localRateStorage: RateStorage = {
  load() {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, Rate>) : {};
    } catch {
      return {};
    }
  },
  save(rates) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
    } catch {
      /* storage full or unavailable: estimates just stay in memory */
    }
  },
};

const memoryStorage = (): RateStorage => {
  let rates: Record<string, Rate> = {};
  return { load: () => rates, save: (r) => (rates = r) };
};

export class RateEstimator {
  private rates: Record<string, Rate>;

  constructor(private readonly storage: RateStorage = typeof localStorage === "undefined" ? memoryStorage() : localRateStorage) {
    this.rates = storage.load();
  }

  /** Characters per second at rate 1 for `voiceKey`. */
  charsPerSecond(voiceKey: string): number {
    return this.rates[voiceKey]?.cps ?? DEFAULT_CHARS_PER_SECOND;
  }

  /** Records one utterance: `chars` spoken in `seconds` of wall time at `rate`. */
  record(voiceKey: string, chars: number, seconds: number, rate: number): void {
    if (chars < MIN_SAMPLE_CHARS || seconds <= 0 || rate <= 0) return;
    const sample = chars / seconds / rate;
    if (sample < PLAUSIBLE[0] || sample > PLAUSIBLE[1]) return;
    const prev = this.rates[voiceKey];
    const weight = Math.min(prev?.samples ?? 0, MAX_WEIGHT);
    const cps = prev ? (prev.cps * weight + sample) / (weight + 1) : sample;
    this.rates = { ...this.rates, [voiceKey]: { cps, samples: (prev?.samples ?? 0) + 1 } };
    this.storage.save(this.rates);
  }
}

/** Character offset of each word in `words.join(" ")`. */
export function wordOffsets(words: readonly string[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const w of words) {
    offsets.push(at);
    at += w.length + 1;
  }
  return offsets;
}

/** The word containing (or last starting before) `charIndex`. */
export const wordAtChar = (offsets: readonly number[], charIndex: number) => lastAtOrBefore(offsets, charIndex);

/** Word an utterance has probably reached `seconds` after word `fromWord` began, from the measured speaking rate. */
export function estimatedWordFrom(offsets: readonly number[], fromWord: number, seconds: number, charsPerSecond: number, rate: number): number {
  return wordAtChar(offsets, (offsets[fromWord] ?? 0) + Math.max(0, seconds) * charsPerSecond * rate);
}
