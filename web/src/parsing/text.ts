/** Plain-text decoding and the TXT parser. */
import { fallbackHeadingLevel, isChapterLine, normalizeText } from "./structure";
import { ParseError, type ParsedDocument, type RawBlock } from "./types";

const BLANK_SPLIT = /\n[ \t]*\n+/;
/** Windows-1252 bytes 0x80–0x9F (some decoders treat the label as Latin-1 and leave C1 controls). */
const CP1252_C1 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** UTF-8 (BOM stripped), falling back to Windows-1252; line endings normalised to "\n". */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.subarray(0, 4096).includes(0)) throw new ParseError("parse_error", "This file looks binary, not text.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes).replace(/[\u0080-\u009f]/g, (ch) => CP1252_C1[ch.charCodeAt(0) - 0x80]);
  }
  return text.replace(/\r\n?/g, "\n");
}

export function parseTxt(text: string): ParsedDocument {
  const blocks: RawBlock[] = [];
  for (const para of text.split(BLANK_SPLIT)) {
    const lines = para
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const joined = normalizeText(lines.join("\n"));
    const level = lines.length === 1 ? fallbackHeadingLevel(joined) : null;
    if (level !== null) {
      blocks.push({ kind: "heading", text: joined, level });
    } else if (lines.length === 2 && isChapterLine(lines[0]) && joined.split(" ").length <= 12) {
      blocks.push({ kind: "heading", text: joined, level: 1 }); // "CHAPTER I." / "Down the Rabbit-Hole"
    } else {
      blocks.push({ kind: "paragraph", text: lines.join("\n") });
    }
  }
  const first = blocks[0];
  if (first && first.kind === "heading" && !isChapterLine(first.text)) {
    first.kind = "title";
    first.level = 1;
  }
  return { sourceType: "txt", blocks };
}
