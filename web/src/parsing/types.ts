import type { BlockKind, Page, SourceType } from "../types";

/** A block as a format parser emits it; `text` may still hold raw whitespace and line breaks. */
export interface RawBlock {
  kind: BlockKind;
  text: string;
  level?: number | null;
  /** Real page index (PDF only). */
  page?: number;
}

export interface ParsedDocument {
  sourceType: SourceType;
  blocks: RawBlock[];
  metadataTitle?: string | null;
  /** PDF only: printed label per real page. */
  pageLabels?: string[];
}

export interface StructuredDocument {
  title: string;
  sourceType: SourceType;
  pages: Page[];
  wordCount: number;
  charCount: number;
  blockCount: number;
}

export type ParseErrorCode = "unsupported" | "no_text" | "parse_error" | "too_large";

export class ParseError extends Error {
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.name = "ParseError";
    this.code = code;
  }
}

/** Reported while a file is parsed; `fraction` is 0–1 when known. */
export interface ParseProgress {
  phase: "reading" | "analysing";
  fraction: number | null;
}

export type ProgressFn = (progress: ParseProgress) => void;
