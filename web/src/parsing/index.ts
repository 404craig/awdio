/** Parse a file's bytes into an awdio document. Format parsers load on demand. */
import type { SourceType } from "../types";
import { finalize } from "./structure";
import { ParseError, type ParsedDocument, type ProgressFn, type StructuredDocument } from "./types";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".pdf", ".epub", ".docx", ".txt", ".md", ".markdown"];

const BY_EXTENSION: Record<string, SourceType> = { pdf: "pdf", epub: "epub", docx: "docx", txt: "txt", text: "txt", md: "md", markdown: "md" };
const BY_MIME: Record<string, SourceType> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};

export function detectSourceType(fileName: string, mime = ""): SourceType | null {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
  return BY_EXTENSION[ext] ?? BY_MIME[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

export interface ParseOptions {
  mime?: string;
  onProgress?: ProgressFn;
  /** URL of the pdf.js worker script (browser builds). */
  pdfWorkerSrc?: string;
}

async function parseBytes(type: SourceType, data: Uint8Array, opts: ParseOptions): Promise<ParsedDocument> {
  switch (type) {
    case "pdf":
      return (await import("./pdf")).parsePdf(data, { onProgress: opts.onProgress, workerSrc: opts.pdfWorkerSrc });
    case "epub":
      return (await import("./epub")).parseEpub(data, opts.onProgress);
    case "docx":
      return (await import("./docx")).parseDocx(data);
    case "txt":
    case "md": {
      const { decodeText, parseTxt } = await import("./text");
      const text = decodeText(data);
      return type === "md" ? (await import("./markdown")).parseMarkdown(text) : parseTxt(text);
    }
  }
}

export async function parseFile(fileName: string, data: Uint8Array, opts: ParseOptions = {}): Promise<StructuredDocument> {
  const type = detectSourceType(fileName, opts.mime);
  if (!type) throw new ParseError("unsupported", "That file type isn't supported. Try PDF, EPUB, DOCX, TXT or Markdown.");
  if (data.byteLength > MAX_FILE_BYTES) throw new ParseError("too_large", "That file is larger than 50 MB.");
  opts.onProgress?.({ phase: "analysing", fraction: null });
  const parsed = await parseBytes(type, data, opts);
  return finalize(parsed, fileName);
}

export { ParseError } from "./types";
export type { ParseErrorCode, ParseProgress, StructuredDocument } from "./types";
