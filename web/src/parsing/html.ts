/**
 * HTML/XHTML → blocks, shared by EPUB chapters and DOCX (via mammoth's HTML).
 * Uses htmlparser2 rather than DOMParser because DOMParser does not exist inside Web Workers.
 */
import { parseDocument } from "htmlparser2";
import { isTag, isText, type AnyNode, type Element } from "domhandler";
import type { BlockKind } from "../types";
import type { RawBlock } from "./types";

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCK_TAGS = new Set([
  ...HEADINGS,
  ..."p div section article main aside header footer figure figcaption li ul ol dl dt dd blockquote pre table thead tbody tfoot tr td th caption hr body".split(
    " ",
  ),
]);
const SKIP_TAGS = new Set(["script", "style", "nav", "head", "svg", "math", "title"]);

export function parseMarkup(source: string, xml = false): AnyNode[] {
  return parseDocument(source, { xmlMode: xml, recognizeSelfClosing: true, decodeEntities: true }).children;
}

/** Depth-first search for the first element matching `test`. */
export function findElement(nodes: AnyNode[], test: (el: Element) => boolean): Element | null {
  for (const node of nodes) {
    if (!isTag(node)) continue;
    if (test(node)) return node;
    const hit = findElement(node.children, test);
    if (hit) return hit;
  }
  return null;
}

export function findAll(nodes: AnyNode[], test: (el: Element) => boolean, out: Element[] = []): Element[] {
  for (const node of nodes) {
    if (!isTag(node)) continue;
    if (test(node)) out.push(node);
    findAll(node.children, test, out);
  }
  return out;
}

/** Text of a node; `<br>` counts as a space and skipped tags contribute nothing. */
export function textOf(node: AnyNode): string {
  if (isText(node)) return node.data;
  if (!isTag(node)) return "";
  const name = node.name.toLowerCase();
  if (name === "br") return " ";
  if (SKIP_TAGS.has(name)) return "";
  return node.children.map(textOf).join("");
}

export const localName = (el: Element) => el.name.toLowerCase().replace(/^.*:/, "");

const hasBlockDescendant = (el: Element): boolean =>
  el.children.some((c) => isTag(c) && !SKIP_TAGS.has(localName(c)) && (BLOCK_TAGS.has(localName(c)) || hasBlockDescendant(c)));

function emitBlock(el: Element, kind: BlockKind | null, out: RawBlock[]): void {
  const name = localName(el);
  if (HEADINGS.has(name)) {
    const isTitle = /(^|\s)title(\s|$)/.test(el.attribs.class ?? "");
    out.push(isTitle ? { kind: "title", text: textOf(el), level: 1 } : { kind: "heading", text: textOf(el), level: Number(name[1]) });
    return;
  }
  let next = kind;
  if (name === "li") next = "list_item";
  else if (name === "blockquote") next = "quote";
  if (hasBlockDescendant(el)) walk(el.children, next, out);
  else out.push({ kind: next ?? "paragraph", text: textOf(el) });
}

/** One block per leaf block element; loose inline text between block children is its own paragraph. */
function walk(nodes: AnyNode[], kind: BlockKind | null, out: RawBlock[]): void {
  let inline = "";
  const flush = () => {
    if (inline.trim()) out.push({ kind: kind ?? "paragraph", text: inline });
    inline = "";
  };
  for (const node of nodes) {
    if (isTag(node)) {
      const name = localName(node);
      if (SKIP_TAGS.has(name)) continue;
      if (BLOCK_TAGS.has(name)) {
        flush();
        emitBlock(node, kind, out);
      } else if (hasBlockDescendant(node)) {
        flush();
        walk(node.children, kind, out); // a wrapper such as <html> or a <span> around paragraphs
      } else {
        inline += textOf(node);
      }
    } else if (isText(node)) {
      inline += node.data;
    }
  }
  flush();
}

/** Blocks of an HTML document (its `<body>` when present). */
export function htmlBlocks(source: string): RawBlock[] {
  const nodes = parseMarkup(source);
  const body = findElement(nodes, (el) => localName(el) === "body");
  const out: RawBlock[] = [];
  walk(body ? body.children : nodes, null, out);
  return out;
}
