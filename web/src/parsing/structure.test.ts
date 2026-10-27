import { describe, expect, it } from "vitest";
import type { Block } from "../types";
import { fallbackHeadingLevel, finalize, isChapterLine, normalizeText, prettifyFileName, syntheticPages } from "./structure";
import { documentInvariantErrors } from "./testing/fixtures";
import type { RawBlock } from "./types";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function blocks(spec: [Block["kind"], number, number?][]): Block[] {
  let start = 0;
  return spec.map(([kind, count, level], index) => {
    const block: Block = { index, kind, level: level ?? (kind === "heading" || kind === "title" ? 1 : null), text: words(count), wordCount: count, wordStart: start };
    start += count;
    return block;
  });
}

describe("normalizeText", () => {
  it("collapses whitespace, NFC-normalises and strips invisible characters", () => {
    expect(normalizeText("  Café  au\tlait ​\n")).toBe("Café au lait");
    expect(normalizeText("ﬁne ﬂour")).toBe("fine flour");
  });
  it("repairs hyphenation only between lower-case halves", () => {
    expect(normalizeText("exam-\nple")).toBe("example");
    expect(normalizeText("Good-\nBye")).toBe("Good-Bye");
    expect(normalizeText("well-known")).toBe("well-known");
  });
});

describe("heading fallback", () => {
  it("recognises chapter lines but not prose", () => {
    expect(isChapterLine("CHAPTER I.")).toBe(true);
    expect(isChapterLine("Part of it was mine.")).toBe(false);
    expect(fallbackHeadingLevel("Chapter 3")).toBe(1);
    expect(fallbackHeadingLevel("THE GARDEN PARTY")).toBe(2);
    expect(fallbackHeadingLevel("The Pool of Tears")).toBe(2);
    expect(fallbackHeadingLevel("She went home.")).toBeNull();
  });
});

describe("synthetic paging", () => {
  it("fills pages to ≥ 450 words without splitting blocks", () => {
    const pages = syntheticPages(blocks([["paragraph", 300], ["paragraph", 300], ["paragraph", 300], ["paragraph", 10]]));
    expect(pages.map((p) => p.blocks.length)).toEqual([2, 2]);
    expect(pages.map((p) => p.label)).toEqual(["1", "2"]);
  });

  it("starts a chapter page at a level 1–2 heading once the page has > 150 words", () => {
    const pages = syntheticPages(
      blocks([["title", 3], ["heading", 2], ["paragraph", 200], ["heading", 2], ["paragraph", 500], ["paragraph", 20], ["heading", 2], ["paragraph", 40]]),
    );
    expect(pages.map((p) => p.label)).toEqual(["Ch. 1 · 1", "Ch. 2 · 1", "Ch. 2 · 2"]);
    expect(pages[2].blocks.map((b) => b.kind)).toEqual(["paragraph", "heading", "paragraph"]);
  });
});

describe("finalize", () => {
  const raw: RawBlock[] = [
    { kind: "heading", text: "  A   Title ", level: 1 },
    { kind: "paragraph", text: "First line\nsecond line." },
    { kind: "paragraph", text: "   " },
    { kind: "list_item", text: "item", level: 3 },
  ];

  it("normalises, drops empty blocks and assigns indices and ordinals", () => {
    const doc = finalize({ sourceType: "txt", blocks: raw }, "notes.txt");
    expect(documentInvariantErrors(doc)).toEqual([]);
    expect(doc.pages[0].blocks.map((b) => [b.index, b.text, b.wordStart, b.level])).toEqual([
      [0, "A Title", 0, 1],
      [1, "First line second line.", 2, null],
      [2, "item", 6, null],
    ]);
    expect(doc.charCount).toBe("A Title".length + "First line second line.".length + "item".length);
  });

  it("prefers metadata, then a title block, then the file name", () => {
    expect(finalize({ sourceType: "txt", blocks: raw, metadataTitle: "Meta" }, "x.txt").title).toBe("Meta");
    expect(finalize({ sourceType: "txt", blocks: [{ kind: "title", text: "Block title" }], metadataTitle: "untitled" }, "x.txt").title).toBe("Block title");
    expect(prettifyFileName("my_reading-notes.v2.txt")).toBe("My reading notes v2");
    expect(prettifyFileName("ReadMe.md")).toBe("ReadMe");
  });

  it("keeps real PDF pages and their labels", () => {
    const doc = finalize(
      { sourceType: "pdf", blocks: [{ kind: "paragraph", text: "a", page: 0 }, { kind: "paragraph", text: "b", page: 2 }], pageLabels: ["i", "1", "2"] },
      "x.pdf",
    );
    expect(doc.pages.map((p) => [p.index, p.label])).toEqual([[0, "i"], [1, "2"]]);
  });

  it("reports documents without text", () => {
    expect(() => finalize({ sourceType: "txt", blocks: [{ kind: "paragraph", text: " " }] }, "x.txt")).toThrow(/No readable text/);
  });
});
