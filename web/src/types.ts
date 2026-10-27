/** On-device data model (docs/DATA.md). Everything lives in IndexedDB on the phone. */

export type SourceType = "pdf" | "epub" | "docx" | "txt" | "md";
export type BlockKind = "title" | "heading" | "paragraph" | "list_item" | "quote";

/**
 * One readable unit. `index` is global across the document; `text` is single-spaced, so its
 * words are exactly `text.split(" ")` and `wordStart` is the global ordinal of the first word.
 */
export interface Block {
  index: number;
  kind: BlockKind;
  /** Heading level 1–6 for titles and headings, otherwise null. */
  level: number | null;
  text: string;
  wordCount: number;
  wordStart: number;
}

export interface Page {
  index: number;
  /** Printed label for PDFs ("12", "xii"); "Ch. 3 · 2" or "4" for synthetic pages. */
  label: string;
  blocks: Block[];
}

/** What the library lists. Small: the page structure is stored separately. */
export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  fileName: string;
  wordCount: number;
  /** Characters including the spaces between blocks' words; drives the time estimate. */
  charCount: number;
  blockCount: number;
  pageCount: number;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface Document extends DocumentSummary {
  pages: Page[];
}

export interface Progress {
  blockIndex: number;
  wordIndex: number;
  /** Global word ordinal of the position, so the library can show % without loading pages. */
  wordOrdinal: number;
  updatedAt: string;
}

export type Theme = "system" | "light" | "dark" | "sepia";
export type ReadingFont = "serif" | "sans";

export interface Settings {
  /** `voiceURI` of a voice the user picked explicitly; null means "best available". */
  voiceURI: string | null;
  speed: number;
  font: ReadingFont;
  textSize: number;
  theme: Theme;
  autoScroll: boolean;
  /** One-time tips the user has dismissed. */
  voiceTipDismissed: boolean;
  homeScreenTipDismissed: boolean;
}
