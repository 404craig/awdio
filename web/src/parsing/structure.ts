/**
 * Shared structure heuristics: text normalisation, heading fallback, titles and paging.
 * Pure functions; every format parser ends in `finalize()`.
 */
import type { Block, Page } from "../types";
import { ParseError, type ParsedDocument, type RawBlock, type StructuredDocument } from "./types";

const PAGE_TARGET_WORDS = 450;
const CHAPTER_BREAK_MIN_WORDS = 150;
const MAX_HEADING_WORDS = 12;

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
const LIGATURE_RE = /[ﬀ-ﬆ]/g;
const INVISIBLE = /[­​‌‍⁠﻿‎‏]/g;
/** "exam-\nple" → "example" only when both halves are lower-case letters. */
const LINE_HYPHEN_LOWER = /\b([A-Za-z][a-z]*)-[ \t]*\n\s*([a-z]+)\b/g;
/** Any other hyphen at a line end is a real hyphen: keep it, drop the break ("Good-\nBye"). */
const LINE_HYPHEN_OTHER = /(\w)-[ \t]*\n\s*(?=\w)/g;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const WHITESPACE = /\s+/g;
const HEADING_WORDS = /^(chapter|part|book|section|prologue|epilogue|appendix)\b/i;
const SMALL_WORDS = new Set(
  "a an and as at but by for from in into nor of on or the to with vs via over up upon".split(" "),
);
const LETTER = /\p{L}/u;
const UPPER = /\p{Lu}/u;

/** NFC, strip invisible characters, repair line-end hyphenation, collapse whitespace. */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(LIGATURE_RE, (ch) => LIGATURES[ch] ?? ch)
    .replace(INVISIBLE, "")
    .replace(LINE_HYPHEN_LOWER, "$1$2")
    .replace(LINE_HYPHEN_OTHER, "$1-")
    .replace(CONTROL, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

const endsWithClausePunctuation = (line: string) => ".,;:".includes(line[line.length - 1]);

/**
 * Short line starting with chapter/part/book/…; a terminal period is allowed only on very short
 * lines such as "CHAPTER I." so that prose like "Part of it was mine." is not a heading.
 */
export function isChapterLine(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_HEADING_WORDS || !HEADING_WORDS.test(line)) return false;
  return !endsWithClausePunctuation(line) || words.length <= 3;
}

function isTitleCase(words: string[]): boolean {
  const alpha = words.map((w) => w.replace(/^["'“”‘’()[\]!?]+|["'“”‘’()[\]!?]+$/g, "")).filter((w) => w && LETTER.test(w[0]));
  if (alpha.length === 0 || !UPPER.test(alpha[0][0])) return false;
  return alpha.every((w) => UPPER.test(w[0]) || SMALL_WORDS.has(w.toLowerCase()));
}

function looksLikeHeading(line: string, words: string[]): boolean {
  if (endsWithClausePunctuation(line)) return false;
  const letters = [...line].filter((ch) => LETTER.test(ch));
  if (letters.length === 0) return false;
  if (letters.length >= 2 && letters.every((ch) => UPPER.test(ch))) return true;
  return words.length >= 2 && isTitleCase(words);
}

/**
 * Heading rule for text without layout cues; `line` is already its own paragraph.
 * Chapter-like lines are level 1, other ALL CAPS / Title Case lines level 2; null: not a heading.
 */
export function fallbackHeadingLevel(line: string): number | null {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_HEADING_WORDS) return null;
  if (isChapterLine(line)) return 1;
  return looksLikeHeading(line, words) ? 2 : null;
}

/** A leading heading whose level is not repeated later becomes the document's title block. */
export function promoteTitle(blocks: RawBlock[]): void {
  const first = blocks.find((b) => normalizeText(b.text));
  if (!first || first.kind !== "heading" || first.level == null) return;
  const level = first.level;
  const later = blocks.filter((b) => b !== first && (b.kind === "heading" || b.kind === "title") && b.level != null);
  if (later.every((b) => (b.level ?? 0) > level)) {
    first.kind = "title";
    first.level = 1;
  }
}

/** "my_reading-notes.txt" → "My reading notes". */
export function prettifyFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[_\-.]+/g, " ").replace(WHITESPACE, " ").trim();
  if (!stem) return "Untitled";
  const isLower = stem === stem.toLowerCase() && stem !== stem.toUpperCase();
  return isLower ? stem[0].toUpperCase() + stem.slice(1) : stem;
}

function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = normalizeText(title);
  return t && !["untitled", "unknown"].includes(t.toLowerCase()) ? t : null;
}

interface Built {
  block: Block;
  page: number | undefined;
}

/** Normalise block text, drop empty blocks, assign global indices and word ordinals, build pages. */
export function finalize(parsed: ParsedDocument, fileName: string): StructuredDocument {
  const built: Built[] = [];
  let ordinal = 0;
  let charCount = 0;
  for (const raw of parsed.blocks) {
    const text = normalizeText(raw.text);
    if (!text) continue;
    const wordCount = text.split(" ").length;
    const isHeading = raw.kind === "title" || raw.kind === "heading";
    const level = isHeading ? Math.min(Math.max(raw.level ?? 1, 1), 6) : null;
    built.push({ block: { index: built.length, kind: raw.kind, level, text, wordCount, wordStart: ordinal }, page: raw.page });
    ordinal += wordCount;
    charCount += text.length;
  }
  if (built.length === 0) throw new ParseError("no_text", "No readable text found.");

  const pages = parsed.sourceType === "pdf" ? realPages(built, parsed.pageLabels ?? []) : syntheticPages(built.map((b) => b.block));
  const titleBlock = built.find((b) => b.block.kind === "title")?.block.text;
  return {
    title: cleanTitle(parsed.metadataTitle) ?? titleBlock ?? prettifyFileName(fileName),
    sourceType: parsed.sourceType,
    pages,
    wordCount: ordinal,
    charCount,
    blockCount: built.length,
  };
}

function realPages(built: Built[], labels: string[]): Page[] {
  const byPage = new Map<number, Block[]>();
  for (const { block, page } of built) {
    const key = page ?? 0;
    const list = byPage.get(key);
    if (list) list.push(block);
    else byPage.set(key, [block]);
  }
  return [...byPage.keys()]
    .sort((a, b) => a - b)
    .map((real, i) => ({ index: i, label: labels[real] || String(real + 1), blocks: byPage.get(real) ?? [] }));
}

/** Level of the headings that delimit chapters: the top heading level, if it is 1 or 2. */
function chapterLevel(blocks: Block[]): number | null {
  const levels = blocks.filter((b) => b.kind === "heading" && b.level !== null).map((b) => b.level as number);
  if (levels.length === 0) return null;
  const top = Math.min(...levels);
  return top <= 2 ? top : null;
}

/**
 * Pages of ≥ 450 words that never split a block; a title or level 1–2 heading starts a new page
 * when the current one already holds > 150 words. Labels: "Ch. 3 · 2", or plain numbers.
 */
export function syntheticPages(blocks: Block[]): Page[] {
  const level = chapterLevel(blocks);
  const groups: Block[][] = [];
  const chapters: number[] = [];
  let chapter = 0;
  let words = 0;
  for (const block of blocks) {
    const startsChapter = level !== null && block.kind === "heading" && block.level === level;
    const major = block.kind === "title" || (block.kind === "heading" && (block.level ?? 9) <= 2);
    if (groups.length && (words >= PAGE_TARGET_WORDS || (major && words > CHAPTER_BREAK_MIN_WORDS))) {
      groups.push([]);
      chapters.push(startsChapter ? chapter + 1 : chapter);
      words = 0;
    } else if (!groups.length) {
      groups.push([]);
      chapters.push(startsChapter ? 1 : 0);
    }
    if (startsChapter) {
      chapter += 1;
      // Front matter (a title) sharing its page with chapter 1: label it as that chapter.
      if (chapters[chapters.length - 1] === 0) chapters[chapters.length - 1] = chapter;
    }
    groups[groups.length - 1].push(block);
    words += block.wordCount;
  }
  const within = new Map<number, number>();
  return groups.map((group, i) => {
    const ch = chapters[i];
    const n = (within.get(ch) ?? 0) + 1;
    within.set(ch, n);
    return { index: i, label: ch > 0 ? `Ch. ${ch} · ${n}` : String(n), blocks: group };
  });
}
