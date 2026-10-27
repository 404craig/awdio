/**
 * PDF layout heuristics over visual lines: body size, running headers/footers, reading order
 * (incl. two columns), paragraphs and headings. Pure: rows in, raw blocks out.
 */
import type { BlockKind } from "../types";
import type { RawBlock } from "./types";

/** One visual line of text in top-left page coordinates. */
export interface Row {
  page: number;
  text: string;
  size: number;
  bold: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 = left/single, 1 = right, −1 = spans both columns. */
  column: number;
}

export interface PageBox {
  width: number;
  height: number;
}

const MARGIN_BAND = 0.12; // top/bottom share of the page where running headers/footers live
const RUNNING_MIN_SHARE = 0.4; // a running line appears on ≥ 40 % of pages …
const RUNNING_MIN_PAGES = 3; // … and on ≥ 3 pages
const RUNNING_Y_TOLERANCE = 0.03; // share of page height
const HEADING_RATIO = 1.15;
const SMALL_RATIO = 0.85;
const MAX_HEADING_LEVEL = 3;
const MAX_HEADING_WORDS = 30;
const BOLD_HEADING_WORDS = 12;

const SENTENCE_END = /[.!?:"”’)…]$/;
const GLYPH_BULLET = /^\s*[•◦▪▫‣⁃∙●○■□–*\-]\s+/;
const NUMBER_BULLET = /^\s*\d+[.)]\s+/;
const PAGE_NUMBER =
  /^[-–—\s]*(page\s*)?(\d+|(?=[ivxlcdm])m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3}))(\s*(of|\/)\s*\d+)?[-–—\s]*$/i;

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;
const centre = (r: Row) => (r.y0 + r.y1) / 2;
const byReadingOrder = (a: Row, b: Row) => centre(a) - centre(b) || a.x0 - b.x0;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** First quartile, matching Python's statistics.quantiles(n=4)[0] ("exclusive" method). */
function firstQuartile(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length + 1) / 4;
  const j = Math.floor(pos);
  if (j < 1) return s[0];
  if (j >= s.length) return s[s.length - 1];
  return s[j - 1] + (pos - j) * (s[j] - s[j - 1]);
}

/** Body font size: the mode of row sizes weighted by character count. */
export function bodySize(rows: Row[]): number {
  const weight = new Map<number, number>();
  for (const r of rows) weight.set(r.size, (weight.get(r.size) ?? 0) + r.text.length);
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight) [best, bestWeight] = [size, w];
  }
  return best;
}

// ---- running headers / footers ---------------------------------------------------------------

const runningKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const inMargin = (r: Row, height: number) => r.y1 < height * MARGIN_BAND || r.y0 > height * (1 - MARGIN_BAND);

export function dropRunningLines(pages: Row[][], boxes: PageBox[], body: number): Row[][] {
  const candidates = new Map<string, { page: number; y: number }[]>();
  for (const rows of pages) {
    for (const r of rows) {
      const { height } = boxes[r.page];
      if (!inMargin(r, height) || r.size >= body * HEADING_RATIO) continue;
      const key = runningKey(r.text);
      const hits = candidates.get(key) ?? [];
      hits.push({ page: r.page, y: centre(r) / height });
      candidates.set(key, hits);
    }
  }
  const needed = Math.max(RUNNING_MIN_PAGES, RUNNING_MIN_SHARE * pages.length);
  const running = new Map<string, number>();
  for (const [key, hits] of candidates) {
    const mid = median(hits.map((h) => h.y));
    const onPages = new Set(hits.filter((h) => Math.abs(h.y - mid) <= RUNNING_Y_TOLERANCE).map((h) => h.page));
    if (onPages.size >= needed) running.set(key, mid);
  }
  const keep = (r: Row) => {
    const { height } = boxes[r.page];
    if (!inMargin(r, height)) return true;
    if (PAGE_NUMBER.test(r.text.trim())) return false;
    const mid = running.get(runningKey(r.text));
    return mid === undefined || Math.abs(centre(r) / height - mid) > RUNNING_Y_TOLERANCE;
  };
  return pages.map((rows) => rows.filter(keep));
}

// ---- reading order ---------------------------------------------------------------------------

function isTwoColumn(rows: Row[], width: number, body: number): boolean {
  const bodyRows = rows.filter((r) => Math.abs(r.size - body) < 0.6);
  if (bodyRows.length < 6) return false;
  const mid = width / 2;
  const slack = width * 0.02;
  const left = bodyRows.filter((r) => r.x1 < mid + slack).length;
  const right = bodyRows.filter((r) => r.x0 > mid - slack).length;
  const spanning = bodyRows.length - left - right;
  return left >= 3 && right >= 3 && spanning <= 0.2 * bodyRows.length;
}

/** Join fragments that sit on the same visual line (separately drawn spans, list numbers). */
export function mergeRows(rows: Row[]): Row[] {
  const merged: Row[] = [];
  for (const r of rows) {
    const prev = merged[merged.length - 1];
    const c = centre(r);
    if (prev && prev.y0 <= c && c <= prev.y1 && r.x0 >= prev.x0) {
      const sep = r.x0 > prev.x1 + 0.15 * r.size ? " " : "";
      const dominant = prev.text.length >= r.text.length ? prev : r;
      merged[merged.length - 1] = {
        page: prev.page,
        text: prev.text + sep + r.text,
        size: dominant.size,
        bold: prev.bold && r.bold,
        x0: prev.x0,
        y0: Math.min(prev.y0, r.y0),
        x1: Math.max(prev.x1, r.x1),
        y1: Math.max(prev.y1, r.y1),
        column: prev.column,
      };
    } else {
      merged.push(r);
    }
  }
  return merged;
}

/** Spanning rows (titles, footnotes) split the page into bands; each band reads left, then right. */
function twoColumnOrder(rows: Row[], width: number): Row[] {
  const mid = width / 2;
  const slack = width * 0.02;
  const classified = rows.map((r) => ({ ...r, column: r.x1 < mid + slack ? 0 : r.x0 > mid - slack ? 1 : -1 }));
  const out: Row[] = [];
  let band: Row[] = [];
  const flush = () => {
    out.push(...mergeRows(band.filter((r) => r.column === 0).sort(byReadingOrder)));
    out.push(...mergeRows(band.filter((r) => r.column === 1).sort(byReadingOrder)));
    band = [];
  };
  for (const r of classified.sort((a, b) => centre(a) - centre(b))) {
    if (r.column === -1) {
      flush();
      out.push(r);
    } else {
      band.push(r);
    }
  }
  flush();
  return out;
}

export function orderPages(pages: Row[][], boxes: PageBox[], body: number): Row[][] {
  const flags = pages.map((rows, i) => isTwoColumn(rows, boxes[i].width, body));
  const textPages = pages.filter((rows) => rows.length > 0).length;
  const twoColumnDoc = textPages > 0 && flags.filter(Boolean).length > 0.5 * textPages;
  return pages.map((rows, i) =>
    twoColumnDoc && flags[i] ? twoColumnOrder(rows, boxes[i].width) : mergeRows([...rows].sort(byReadingOrder)),
  );
}

// ---- blocks ----------------------------------------------------------------------------------

interface LayoutBlock {
  kind: BlockKind;
  page: number;
  sizeClass: number;
  bold: boolean;
  rows: Row[];
}

/** Distinct heading font sizes, largest first; position + 1 is the heading level. */
export function headingSizes(rows: Row[], body: number): number[] {
  return [...new Set(rows.filter((r) => r.size >= body * HEADING_RATIO).map((r) => r.size))].sort((a, b) => b - a);
}

function sizeClassOf(row: Row, body: number, headings: number[]): number {
  const i = headings.indexOf(row.size);
  if (i >= 0) return i + 1;
  return row.size < body * SMALL_RATIO ? -1 : 0;
}

/** Typical whitespace between consecutive lines of one paragraph (low percentile of observed gaps). */
function normalGap(pages: Row[][], body: number): number {
  const gaps: number[] = [];
  for (const rows of pages) {
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]];
      if (a.column !== b.column || Math.abs(a.size - body) >= 0.6 || Math.abs(b.size - body) >= 0.6) continue;
      const gap = b.y0 - a.y1;
      if (gap >= -body && gap <= 2 * body) gaps.push(gap);
    }
  }
  return gaps.length < 4 ? 0 : firstQuartile(gaps);
}

function continues(
  block: LayoutBlock,
  row: Row,
  prev: Row | undefined,
  style: { sizeClass: number; bold: boolean },
  indented: boolean,
  gapNormal: number,
): boolean {
  if (block.sizeClass !== style.sizeClass || block.bold !== style.bold) return false;
  const last = block.rows[block.rows.length - 1];
  const endsSentence = SENTENCE_END.test(last.text);
  if (!prev || row.y0 < last.y0 - 1) {
    // New page or new column: a soft break.
    return !endsSentence && !indented && block.kind !== "list_item";
  }
  const gap = row.y0 - last.y1;
  if (gap - gapNormal > 0.5 * last.size) return false;
  if (block.kind === "list_item") return row.x0 > block.rows[0].x0 + 1;
  return !(endsSentence && indented);
}

function buildBlocks(pages: Row[][], body: number, headings: number[]): LayoutBlock[] {
  const gapNormal = normalGap(pages, body);
  const blocks: LayoutBlock[] = [];
  for (const rows of pages) {
    const columnLeft = new Map<number, number>();
    for (const r of rows) columnLeft.set(r.column, Math.min(columnLeft.get(r.column) ?? r.x0, r.x0));
    let current = blocks[blocks.length - 1];
    rows.forEach((source, i) => {
      const row = { ...source };
      const style = { sizeClass: sizeClassOf(row, body, headings), bold: row.bold };
      const prev = i > 0 ? rows[i - 1] : undefined;
      const indented = row.x0 - (columnLeft.get(row.column) ?? row.x0) > 0.8 * body;
      const lastText = current ? current.rows[current.rows.length - 1].text : "";
      const bullet =
        GLYPH_BULLET.test(row.text) ||
        (NUMBER_BULLET.test(row.text) && !indented && (!current || current.kind === "list_item" || SENTENCE_END.test(lastText)));
      if (bullet) {
        row.text = row.text.replace(GLYPH_BULLET, "");
        current = { kind: "list_item", page: row.page, ...style, rows: [row] };
        blocks.push(current);
        return;
      }
      if (current && continues(current, row, prev, style, indented, gapNormal)) {
        current.rows.push(row);
        return;
      }
      current = { kind: "paragraph", page: row.page, ...style, rows: [row] };
      blocks.push(current);
    });
  }
  return blocks;
}

function classify(blocks: LayoutBlock[], headings: number[]): RawBlock[] {
  let titleAssigned = false;
  const boldLevel = Math.min(headings.length + 1, MAX_HEADING_LEVEL);
  return blocks.map((b) => {
    const text = b.rows.map((r) => r.text).join("\n");
    const words = b.rows.reduce((n, r) => n + wordsIn(r.text), 0);
    let kind: BlockKind = b.kind;
    let level: number | null = null;
    if (kind === "paragraph" && b.sizeClass >= 1 && words <= MAX_HEADING_WORDS) {
      kind = "heading";
      level = Math.min(b.sizeClass, MAX_HEADING_LEVEL);
      if (b.sizeClass === 1 && !titleAssigned && b.page <= 1) {
        kind = "title";
        level = 1;
      }
    } else if (kind === "paragraph" && b.bold && b.sizeClass === 0 && b.rows.length <= 2 && words <= BOLD_HEADING_WORDS) {
      kind = "heading";
      level = boldLevel;
    }
    if (kind === "title" || (kind === "heading" && b.sizeClass === 1)) titleAssigned = true;
    return { kind, text, level, page: b.page };
  });
}

/** The whole pipeline: rows per page → raw blocks with real page indices. */
export function layoutBlocks(pages: Row[][], boxes: PageBox[]): RawBlock[] {
  const all = pages.flat();
  if (all.length === 0) return [];
  const body = bodySize(all);
  const ordered = orderPages(dropRunningLines(pages, boxes, body), boxes, body);
  const headings = headingSizes(ordered.flat(), body);
  return classify(buildBlocks(ordered, body, headings), headings);
}
