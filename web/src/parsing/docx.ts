/** DOCX parser: mammoth turns paragraph styles into HTML, which becomes blocks. */
import JSZip from "jszip";
import mammoth from "mammoth/mammoth.browser.js";
import { findElement, htmlBlocks, localName, parseMarkup, textOf } from "./html";
import { isChapterLine } from "./structure";
import { ParseError, type ParsedDocument } from "./types";

const STYLE_MAP = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
];

async function coreTitle(data: Uint8Array): Promise<string | null> {
  try {
    const core = (await JSZip.loadAsync(data)).file("docProps/core.xml");
    if (!core) return null;
    const title = findElement(parseMarkup(await core.async("string"), true), (el) => localName(el) === "title");
    return title ? textOf(title) : null;
  } catch {
    return null;
  }
}

export async function parseDocx(data: Uint8Array): Promise<ParsedDocument> {
  let html: string;
  try {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    html = (await mammoth.convertToHtml({ arrayBuffer: buffer }, {
      styleMap: STYLE_MAP,
      ignoreEmptyParagraphs: true,
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })), // text only: skip image data
    })).value;
  } catch {
    throw new ParseError("parse_error", "This file couldn't be read as a Word document.");
  }
  const blocks = htmlBlocks(html);
  if (!blocks.some((b) => b.kind === "title" || b.kind === "heading")) {
    for (const b of blocks) {
      if (b.kind === "paragraph" && isChapterLine(b.text.trim())) {
        b.kind = "heading";
        b.level = 1;
      }
    }
  }
  const metadataTitle = blocks.some((b) => b.kind === "title") ? null : await coreTitle(data);
  return { sourceType: "docx", blocks, metadataTitle };
}
