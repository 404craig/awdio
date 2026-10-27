/** EPUB parser: container.xml → OPF package → spine documents, in order. */
import JSZip from "jszip";
import type { Element } from "domhandler";
import { findAll, findElement, htmlBlocks, localName, parseMarkup, textOf } from "./html";
import { promoteTitle } from "./structure";
import { ParseError, type ParsedDocument, type ProgressFn, type RawBlock } from "./types";

const NAV_NAME = /(^|[_\-./])(toc|nav)([_\-.]|$)/i;
const CONTENT_TYPES = new Set(["application/xhtml+xml", "text/html", "application/xml", "text/xml"]);

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string[];
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new ParseError("parse_error", `This EPUB is missing ${path}.`);
  return file.async("string");
}

/** Resolve `href` against the directory of `base` (both zip paths). */
function resolvePath(base: string, href: string): string {
  const parts = base.split("/").slice(0, -1);
  for (const seg of decodeURIComponent(href.split("#")[0]).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const byName = (name: string) => (el: Element) => localName(el) === name;

function isNavigation(item: ManifestItem): boolean {
  const file = item.href.split("/").pop() ?? "";
  const stem = file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
  return item.properties.includes("nav") || NAV_NAME.test(stem);
}

export async function parseEpub(data: Uint8Array, onProgress?: ProgressFn): Promise<ParsedDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ParseError("parse_error", "This file couldn't be read as an EPUB.");
  }
  const container = parseMarkup(await readText(zip, "META-INF/container.xml"), true);
  const opfPath = findElement(container, byName("rootfile"))?.attribs["full-path"];
  if (!opfPath) throw new ParseError("parse_error", "This EPUB has no package document.");
  const opf = parseMarkup(await readText(zip, opfPath), true);

  const manifest = new Map<string, ManifestItem>();
  for (const el of findAll(opf, byName("item"))) {
    manifest.set(el.attribs.id, {
      href: resolvePath(opfPath, el.attribs.href ?? ""),
      mediaType: el.attribs["media-type"] ?? "",
      properties: (el.attribs.properties ?? "").split(/\s+/),
    });
  }
  const spine = findAll(opf, byName("itemref"))
    .map((el) => manifest.get(el.attribs.idref))
    .filter((item): item is ManifestItem => !!item && CONTENT_TYPES.has(item.mediaType) && !isNavigation(item));

  const blocks: RawBlock[] = [];
  for (let i = 0; i < spine.length; i++) {
    const file = zip.file(spine[i].href);
    if (file) blocks.push(...htmlBlocks(await file.async("string")));
    onProgress?.({ phase: "analysing", fraction: (i + 1) / spine.length });
  }
  promoteTitle(blocks);
  const title = findElement(opf, byName("title"));
  return { sourceType: "epub", blocks, metadataTitle: title ? textOf(title) : null };
}
