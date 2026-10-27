/**
 * Conservative sentence splitting of single-spaced block text. Each block is spoken one
 * sentence per utterance, so sentences are expressed as word ranges of the block.
 */

const MIN_SENTENCE_WORDS = 4;
/** Longer sentences are also split after ";" / ":" so no single utterance gets very long. */
const LONG_SENTENCE_WORDS = 40;
const MIN_CLAUSE_WORDS = 8;

/** Words that end with a period without ending a sentence (lower case, final period removed). */
const ABBREVIATIONS = new Set(
  (
    "mr mrs ms mx dr prof st sr jr rev hon gen col capt lt sgt mt ft no nos vol vols fig figs ch chap sec pp p ed eds " +
    "est vs etc cf approx ca inc ltd co corp dept univ assn ave rd blvd jan feb mar apr jun jul aug sep sept oct nov dec"
  ).split(" "),
);
const CLOSERS = "\"'”’)]»";
const TERMINAL = /[.!?…]+["'”’)\]»]*$/;
const STARTS_SENTENCE = /^["'“‘([«]*[A-Z0-9À-Ý]/;

export interface Sentence {
  /** Index of the first word within the block. */
  start: number;
  /** Number of words. */
  count: number;
}

const stripClosers = (word: string) => {
  let end = word.length;
  while (end > 0 && CLOSERS.includes(word[end - 1])) end--;
  return word.slice(0, end);
};

function endsSentence(word: string): boolean {
  if (!TERMINAL.test(word)) return false;
  const core = stripClosers(word);
  if (!core.endsWith(".") || core.endsWith("..")) return true; // ! ? … and ellipses end sentences
  const stem = core.slice(0, -1).replace(/^["'“‘([«]+/, "");
  if (stem.includes(".")) return false; // U.S. i.e. e.g.
  if (stem.length === 1 && /\p{L}/u.test(stem)) return false; // an initial: J. K. Rowling
  return !ABBREVIATIONS.has(stem.toLowerCase());
}

function splitLong(start: number, words: string[]): Sentence[] {
  if (words.length <= LONG_SENTENCE_WORDS) return [{ start, count: words.length }];
  const parts: Sentence[] = [{ start, count: 0 }];
  words.forEach((word, i) => {
    const part = parts[parts.length - 1];
    part.count += 1;
    const remaining = words.length - i - 1;
    if (/[;:]$/.test(stripClosers(word)) && part.count >= MIN_CLAUSE_WORDS && remaining >= MIN_CLAUSE_WORDS) {
      parts.push({ start: start + i + 1, count: 0 });
    }
  });
  return parts;
}

/**
 * Sentences of `words` (a block's `text.split(" ")`) as word ranges covering every word once.
 * Fragments under 4 words merge into a neighbour; a period after an abbreviation, an initial,
 * a decimal number or a dotted acronym never splits.
 */
export function sentenceRanges(words: string[]): Sentence[] {
  const groups: Sentence[] = [{ start: 0, count: 0 }];
  words.forEach((word, i) => {
    groups[groups.length - 1].count += 1;
    if (i + 1 < words.length && endsSentence(word) && STARTS_SENTENCE.test(words[i + 1])) groups.push({ start: i + 1, count: 0 });
  });
  const merged: Sentence[] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && last.count < MIN_SENTENCE_WORDS) last.count += g.count;
    else merged.push({ ...g });
  }
  if (merged.length > 1 && merged[merged.length - 1].count < MIN_SENTENCE_WORDS) {
    const tail = merged.pop() as Sentence;
    merged[merged.length - 1].count += tail.count;
  }
  return merged.flatMap((s) => splitLong(s.start, words.slice(s.start, s.start + s.count)));
}

/** Sentence strings, for tests and debugging. */
export function splitSentences(text: string): string[] {
  const words = text.split(" ");
  return sentenceRanges(words).map((s) => words.slice(s.start, s.start + s.count).join(" "));
}
