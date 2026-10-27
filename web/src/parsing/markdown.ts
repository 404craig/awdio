/** Markdown parser: ATX/setext headings, lists, quotes, inline markup stripped. */
import { promoteTitle } from "./structure";
import type { ParsedDocument, RawBlock } from "./types";

const ATX = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;
const REF_DEF = /^ {0,3}\[[^\]]+\]:\s*\S+/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\](\([^)]*\)|\[[^\]]*\])/g;
const AUTOLINK = /<((?:https?|mailto):[^>]+)>/g;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/g;
const STRIKE = /~~(.+?)~~/g;
const CODE = /`+([^`]*)`+/g;
/** Emphasis markers; the flanking rules are checked in code (no regex lookbehind, for older Safari). */
const EMPHASIS = /(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1/g;
const WORDISH = /[\p{L}\p{N}_*]/u;

function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS, (match: string, _marker: string, inner: string, offset: number, all: string) => {
    const before = all[offset - 1];
    const after = all[offset + match.length];
    const flanked = (before === undefined || !WORDISH.test(before)) && (after === undefined || !WORDISH.test(after));
    return flanked ? inner : match;
  });
}

export function stripInlineMarkdown(text: string): string {
  let out = text
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(AUTOLINK, "$1")
    .replace(CODE, "$1")
    .replace(HTML_TAG, "")
    .replace(STRIKE, "$1");
  for (let i = 0; i < 3; i++) out = stripEmphasis(out); // nested: ***bold italic***, **_mixed_**
  return out.replace(/\\/g, "");
}

function skipFrontMatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") return lines.slice(i + 1);
  }
  return lines;
}

export function parseMarkdown(source: string): ParsedDocument {
  const lines = skipFrontMatter(source.split("\n"));
  const blocks: RawBlock[] = [];
  let buf: string[] = [];
  let bufKind: RawBlock["kind"] = "paragraph";

  const flush = () => {
    const text = stripInlineMarkdown(buf.join("\n")).trim();
    if (text) blocks.push({ kind: bufKind, text });
    buf = [];
    bufKind = "paragraph";
  };

  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) {
      buf.push(line);
      return;
    }
    if (!line.trim()) {
      flush();
      return;
    }
    const atx = ATX.exec(line);
    if (atx) {
      flush();
      blocks.push({ kind: "heading", text: stripInlineMarkdown(atx[2]), level: atx[1].length });
      return;
    }
    const next = lines[i + 1] ?? "";
    if (bufKind === "paragraph" && buf.length === 0 && SETEXT.test(next) && !LIST.test(line)) {
      blocks.push({ kind: "heading", text: stripInlineMarkdown(line.trim()), level: next.trim().startsWith("=") ? 1 : 2 });
      return;
    }
    if (SETEXT.test(line) && blocks[blocks.length - 1]?.kind === "heading" && buf.length === 0) return; // setext underline
    if (HR.test(line) || REF_DEF.test(line) || TABLE_SEP.test(line)) {
      flush();
      return;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      if (bufKind !== "quote") {
        flush();
        bufKind = "quote";
      }
      buf.push(quote[1]);
      return;
    }
    const item = LIST.exec(line);
    if (item) {
      flush();
      bufKind = "list_item";
      buf.push("-*+".includes(item[2]) ? item[3] : `${item[2]} ${item[3]}`);
      return;
    }
    if (line.trimStart().startsWith("|")) {
      flush();
      const cells = line.trim().replace(/^\|+|\|+$/g, "").split("|");
      buf.push(cells.map((c) => c.trim()).join(" "));
      flush();
      return;
    }
    if (bufKind === "quote") flush();
    buf.push(line.trim());
  });
  flush();
  promoteTitle(blocks);
  return { sourceType: "md", blocks };
}
