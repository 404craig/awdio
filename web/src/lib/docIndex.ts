import { blockCharStarts, lastAtOrBefore, ordinalToPosition, type Position } from "../audio/timeline";
import type { Block, Document, Page } from "../types";

/** Flat lookup tables over a parsed document, built once per open. */
export interface DocIndex {
  doc: Document;
  pages: Page[];
  /** Blocks by global index. */
  blocks: Block[];
  pageOfBlock: Int32Array;
  pageStartOrdinal: number[];
  pageWordCount: number[];
  totalWords: number;
  /** Spoken-character start of each block, and the total: time estimates are per character. */
  blockCharStart: number[];
  totalChars: number;
}

export function buildDocIndex(doc: Document): DocIndex {
  const blocks: Block[] = [];
  const pageStartOrdinal: number[] = [];
  const pageWordCount: number[] = [];
  for (const page of doc.pages) {
    pageStartOrdinal.push(page.blocks[0]?.wordStart ?? (blocks.length ? blocks[blocks.length - 1].wordStart : 0));
    let words = 0;
    for (const block of page.blocks) {
      blocks[block.index] = block;
      words += block.wordCount;
    }
    pageWordCount.push(words);
  }
  const pageOfBlock = new Int32Array(blocks.length);
  doc.pages.forEach((page) => page.blocks.forEach((b) => (pageOfBlock[b.index] = page.index)));
  const last = blocks[blocks.length - 1];
  const blockCharStart = blockCharStarts(blocks.map((b) => b.text));
  return {
    doc,
    pages: doc.pages,
    blocks,
    pageOfBlock,
    pageStartOrdinal,
    pageWordCount,
    totalWords: last ? last.wordStart + last.wordCount : 0,
    blockCharStart,
    totalChars: last ? blockCharStart[blockCharStart.length - 1] + last.text.length : 0,
  };
}

/** Approximate spoken characters before a global word ordinal (interpolated within its block). */
export function charsBefore(index: DocIndex, ordinal: number): number {
  const pos = ordinalToPosition(index.blocks, ordinal);
  const block = index.blocks[pos.blockIndex];
  if (!block) return 0;
  return index.blockCharStart[pos.blockIndex] + (block.text.length * pos.wordIndex) / Math.max(1, block.wordCount);
}

export const pageOfOrdinal = (index: DocIndex, ordinal: number) => lastAtOrBefore(index.pageStartOrdinal, ordinal);

export const positionAt = (index: DocIndex, ordinal: number): Position => ordinalToPosition(index.blocks, ordinal);

/** Synthetic labels look like "Ch. 3 · 2" (chapter · page within chapter); PDFs use printed numbers. */
const CHAPTER_LABEL = /^(?:ch\.?\s*)?\d+\s*·\s*\d+$/i;

const labelOf = (page: Page) => page.label.trim() || String(page.index + 1);

/** "Page 12" / "Page xii" for printed labels; synthetic chapter labels verbatim ("Ch. 3 · 2"). */
export function pageName(page: Page): string {
  const label = labelOf(page);
  return CHAPTER_LABEL.test(label) ? label : `Page ${label}`;
}

/** Left side of the "p. 12 / 240" indicator. */
export function pageIndicator(page: Page): string {
  const label = labelOf(page);
  return CHAPTER_LABEL.test(label) ? label : `p. ${label}`;
}

/** First `n` words of a block with an ellipsis when truncated. */
export function snippet(block: Block, n = 8): string {
  const words = block.text.split(" ");
  return words.length <= n ? block.text : `${words.slice(0, n).join(" ")}…`;
}

/** Tick spacing in pages so the timeline shows at most `maxTicks` marks. */
export function tickStep(pageCount: number, maxTicks = 24): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return steps.find((s) => pageCount / s <= maxTicks) ?? Math.ceil(pageCount / maxTicks);
}
