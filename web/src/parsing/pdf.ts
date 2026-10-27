/** PDF parser: pdf.js text items → visual lines → layout heuristics (pdfLayout.ts). */
import { getDocument, GlobalWorkerOptions, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { layoutBlocks, type PageBox, type Row } from "./pdfLayout";
import { ParseError, type ParsedDocument, type ProgressFn } from "./types";

const BOLD_NAME = /bold|black|heavy|semibold|demi/i;
const JUNK_TITLE = /(^microsoft (word|powerpoint) - )|(\.(docx?|pdf|tex|indd|odt|rtf)$)/i;
/** Fragments further apart than this (in font sizes) are separate lines, e.g. two columns. */
const MAX_JOIN_GAP = 1.5;

interface Item {
  text: string;
  x: number;
  baseline: number;
  width: number;
  size: number;
  bold: boolean;
  eol: boolean;
}

/** Font weight per pdf.js font id. Fonts only reach `commonObjs` once a page's operator list is built. */
class FontWeights {
  private readonly bold = new Map<string, boolean>();

  async load(page: PDFPageProxy, fontNames: Iterable<string>): Promise<void> {
    const missing = [...new Set(fontNames)].filter((n) => !this.bold.has(n));
    if (missing.length === 0) return;
    if (missing.some((n) => !page.commonObjs.has(n))) {
      try {
        await page.getOperatorList();
      } catch {
        /* weights stay unknown: treated as regular */
      }
    }
    for (const name of missing) {
      let isBold = false;
      if (page.commonObjs.has(name)) {
        const font = page.commonObjs.get(name) as { name?: string; bold?: boolean; black?: boolean } | null;
        isBold = !!font && (font.bold === true || font.black === true || BOLD_NAME.test(font.name ?? ""));
      }
      this.bold.set(name, isBold);
    }
  }

  isBold(name: string): boolean {
    return this.bold.get(name) ?? false;
  }
}

const isTextItem = (item: unknown): item is TextItem => typeof item === "object" && item !== null && "str" in item;

function weightedSize(items: Item[]): number {
  const weight = new Map<number, number>();
  for (const it of items) weight.set(it.size, (weight.get(it.size) ?? 0) + it.text.trim().length);
  return [...weight].sort((a, b) => b[1] - a[1])[0][0];
}

function toRow(page: number, items: Item[]): Row | null {
  const visible = items.filter((it) => it.text.trim());
  if (visible.length === 0) return null;
  let text = "";
  let prevEnd = -Infinity;
  for (const it of items) {
    const gapped = it.x > prevEnd + 0.15 * it.size;
    if (text && gapped && !/\s$/.test(text) && !/^\s/.test(it.text)) text += " ";
    text += it.text;
    prevEnd = Math.max(prevEnd, it.x + it.width);
  }
  const size = weightedSize(visible);
  const baseline = Math.max(...visible.map((it) => it.baseline));
  return {
    page,
    text: text.replace(/\s+/g, " ").trim(),
    size,
    bold: visible.every((it) => it.bold),
    x0: Math.min(...visible.map((it) => it.x)),
    x1: Math.max(...visible.map((it) => it.x + it.width)),
    y0: baseline - 0.8 * size,
    y1: baseline + 0.2 * size,
    column: 0,
  };
}

/** Group a page's text items (content-stream order) into visual lines. */
function itemsToRows(page: number, items: Item[]): Row[] {
  const rows: Row[] = [];
  let current: Item[] = [];
  const close = () => {
    const row = toRow(page, current);
    if (row) rows.push(row);
    current = [];
  };
  for (const it of items) {
    const last = current[current.length - 1];
    if (last && it.text.trim()) {
      const sameLine = Math.abs(it.baseline - last.baseline) < 0.5 * Math.max(it.size, last.size);
      const end = last.x + last.width;
      const near = it.x >= end - 0.5 * it.size && it.x - end < MAX_JOIN_GAP * Math.max(it.size, last.size);
      if (!sameLine || !near) close();
    }
    if (it.text) current.push(it);
    if (it.eol) close();
  }
  close();
  return rows;
}

async function pageRows(page: PDFPageProxy, index: number, fonts: FontWeights): Promise<{ rows: Row[]; box: PageBox }> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const textItems = content.items.filter(isTextItem);
  await fonts.load(page, textItems.filter((t) => t.str.trim()).map((t) => t.fontName));
  const items: Item[] = [];
  for (const t of textItems) {
    const m = Util.transform(viewport.transform, t.transform);
    if (Math.abs(m[1]) > 0.1 * Math.abs(m[0]) + 1e-6) continue; // rotated or vertical text
    const size = Math.round(Math.hypot(m[2], m[3]) * 2) / 2;
    if (size <= 0 && t.str.trim()) continue;
    items.push({ text: t.str, x: m[4], baseline: m[5], width: t.width, size, bold: fonts.isBold(t.fontName), eol: t.hasEOL });
  }
  return { rows: itemsToRows(index, items), box: { width: viewport.width, height: viewport.height } };
}

async function open(data: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    return await getDocument({ data, disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") throw new ParseError("parse_error", "This PDF is password-protected.");
    throw new ParseError("parse_error", "This file couldn't be read as a PDF.");
  }
}

export async function parsePdf(data: Uint8Array, opts: { onProgress?: ProgressFn; workerSrc?: string } = {}): Promise<ParsedDocument> {
  if (opts.workerSrc) GlobalWorkerOptions.workerSrc = opts.workerSrc;
  const pdf = await open(data);
  try {
    const fonts = new FontWeights();
    const pages: Row[][] = [];
    const boxes: PageBox[] = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const { rows, box } = await pageRows(page, i, fonts);
      pages.push(rows);
      boxes.push(box);
      page.cleanup();
      opts.onProgress?.({ phase: "analysing", fraction: (i + 1) / pdf.numPages });
    }
    if (!pages.some((rows) => rows.length)) {
      throw new ParseError("no_text", "No readable text found. Scanned PDFs aren't supported yet.");
    }
    const labels = (await pdf.getPageLabels().catch(() => null)) ?? [];
    const meta = await pdf.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: unknown };
    const title = typeof info.Title === "string" && !JUNK_TITLE.test(info.Title.trim()) ? info.Title : null;
    return {
      sourceType: "pdf",
      blocks: layoutBlocks(pages, boxes),
      metadataTitle: title,
      pageLabels: Array.from({ length: pdf.numPages }, (_, i) => labels[i] || String(i + 1)),
    };
  } finally {
    void pdf.destroy();
  }
}
