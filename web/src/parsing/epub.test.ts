import { describe, expect, it } from "vitest";
import { parseFile } from "./index";
import { PRIDE_LIST, PRIDE_PARAGRAPHS, PRIDE_QUOTE, PRIDE_TITLE, blocksOf, documentInvariantErrors, makePrideEpub } from "./testing/fixtures";

const pride = makePrideEpub().then((bytes) => parseFile("pride.epub", bytes));

describe("EPUB parser", () => {
  it("satisfies the document invariants", async () => {
    expect(documentInvariantErrors(await pride)).toEqual([]);
  });

  it("reads chapters in spine order with the package title", async () => {
    const doc = await pride;
    expect(doc.title).toBe(PRIDE_TITLE);
    const blocks = blocksOf(doc);
    expect(blocks.filter((b) => b.kind === "heading").map((b) => [b.text, b.level])).toEqual([
      ["Chapter 1", 1],
      ["Chapter 2", 1],
    ]);
    expect(blocks.filter((b) => b.kind === "paragraph").map((b) => b.text)).toEqual([...PRIDE_PARAGRAPHS, "Kitty and Lydia"]);
    expect(blocks.filter((b) => b.kind === "quote").map((b) => b.text)).toEqual([PRIDE_QUOTE]);
    expect(blocks.filter((b) => b.kind === "list_item").map((b) => b.text)).toEqual(PRIDE_LIST);
  });

  it("skips navigation documents, scripts and head titles", async () => {
    const texts = blocksOf(await pride).map((b) => b.text);
    expect(texts).not.toContain("Chapter 1 Chapter 2");
    expect(texts.some((t) => t.includes("hidden") || t === "One" || t === "Contents")).toBe(false);
  });

  it("pages by chapter", async () => {
    expect((await pride).pages[0].label).toBe("Ch. 1 · 1");
  });

  it("rejects files that are not EPUBs", async () => {
    await expect(parseFile("broken.epub", new TextEncoder().encode("nope"))).rejects.toMatchObject({ code: "parse_error" });
  });
});
