import type { Block, Document, Page } from "../api/types";
import { lastAtOrBefore, ordinalToPosition, type Position } from "../audio/timeline";

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
  return {
    doc,
    pages: doc.pages,
    blocks,
    pageOfBlock,
    pageStartOrdinal,
    pageWordCount,
    totalWords: last ? last.wordStart + last.wordCount : 0,
  };
}

export const pageOfOrdinal = (index: DocIndex, ordinal: number) => lastAtOrBefore(index.pageStartOrdinal, ordinal);

export const positionAt = (index: DocIndex, ordinal: number): Position => ordinalToPosition(index.blocks, ordinal);

/** Synthetic labels look like "3 · 2" or "Ch. 3 · 2" (chapter · page within chapter). */
const CHAPTER_LABEL = /^(?:ch\.?\s*)?(\d+)\s*·\s*\d+$/i;

/** The page's printed number ("12", "xii") or its 1-based position for synthetic labels. */
export function pageNumber(page: Page): string {
  const label = page.label.trim();
  return label && !CHAPTER_LABEL.test(label) ? label : String(page.index + 1);
}

export const pageName = (page: Page) => `Page ${pageNumber(page)}`;

/** "Ch. 3" for synthetic chapter labels, otherwise null. */
export function chapterOf(page: Page): string | null {
  const m = CHAPTER_LABEL.exec(page.label.trim());
  return m ? `Ch. ${m[1]}` : null;
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
