import { describe, expect, it } from "vitest";
import { parseFile } from "./index";
import { PRIDE_LIST, PRIDE_PARAGRAPHS, PRIDE_QUOTE, PRIDE_TITLE, blocksOf, documentInvariantErrors, makePrideDocx } from "./testing/fixtures";

const pride = makePrideDocx().then((bytes) => parseFile("pride.docx", bytes));

describe("DOCX parser", () => {
  it("satisfies the document invariants", async () => {
    expect(documentInvariantErrors(await pride)).toEqual([]);
  });

  it("maps paragraph styles to blocks", async () => {
    const doc = await pride;
    expect(doc.title).toBe(PRIDE_TITLE);
    const blocks = blocksOf(doc);
    expect([blocks[0].kind, blocks[0].text]).toEqual(["title", PRIDE_TITLE]);
    expect(blocks.filter((b) => b.kind === "heading").map((b) => [b.text, b.level])).toEqual([
      ["Chapter 1", 1],
      ["Chapter 2", 1],
    ]);
    expect(blocks.filter((b) => b.kind === "paragraph").map((b) => b.text).slice(0, 3)).toEqual(PRIDE_PARAGRAPHS);
    expect(blocks.filter((b) => b.kind === "quote").map((b) => b.text)).toEqual([PRIDE_QUOTE]);
    expect(blocks.filter((b) => b.kind === "list_item").map((b) => b.text)).toEqual(PRIDE_LIST);
    expect(blocks.slice(-2).map((b) => b.text)).toEqual(["Longbourn", "Netherfield"]); // table cells, row by row
  });

  it("rejects files that are not Word documents", async () => {
    await expect(parseFile("broken.docx", new TextEncoder().encode("nope"))).rejects.toMatchObject({ code: "parse_error" });
  });
});
