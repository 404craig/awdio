import { describe, expect, it } from "vitest";
import { parseFile } from "./index";
import { ParseError } from "./types";
import {
  ALICE_BULLETS,
  ALICE_HEADINGS,
  ALICE_PARAGRAPHS,
  ALICE_TITLE,
  COLUMN_LEFT,
  COLUMN_RIGHT,
  HYPHENATED_WORD,
  RUNNING_HEADER,
  blocksOf,
  documentInvariantErrors,
  makeAlicePdf,
  makeBlankPdf,
  makeTwoColumnPdf,
} from "./testing/fixtures";

const alice = makeAlicePdf().then((bytes) => parseFile("alice.pdf", bytes));

describe("PDF parser", () => {
  it("satisfies the document invariants", async () => {
    expect(documentInvariantErrors(await alice)).toEqual([]);
  });

  it("finds the title, headings by size rank, paragraphs and bullets", async () => {
    const doc = await alice;
    expect(doc.title).toBe(ALICE_TITLE); // the junk metadata title "alice.pdf" is ignored
    const blocks = blocksOf(doc);
    expect([blocks[0].kind, blocks[0].text]).toEqual(["title", ALICE_TITLE]);
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings.map((b) => b.text)).toEqual(ALICE_HEADINGS);
    expect(new Set(headings.map((b) => b.level))).toEqual(new Set([2]));
    const paragraphs = blocks.filter((b) => b.kind === "paragraph").map((b) => b.text);
    expect(paragraphs).toEqual([...ALICE_PARAGRAPHS.slice(0, 3), "She saw, one after another:", ALICE_PARAGRAPHS[3]]);
    expect(blocks.filter((b) => b.kind === "list_item").map((b) => b.text)).toEqual(ALICE_BULLETS);
  });

  it("removes the running header and page numbers", async () => {
    const texts = blocksOf(await alice).map((b) => b.text);
    expect(texts.filter((t) => t === RUNNING_HEADER)).toHaveLength(1); // only the real title remains
    expect(texts.some((t) => /^(\d+|i)$/.test(t))).toBe(false);
  });

  it("repairs line-end hyphenation", async () => {
    const first = blocksOf(await alice)[2].text;
    expect(first.split(HYPHENATED_WORD)).toHaveLength(3);
    expect(first).not.toContain("conver-");
  });

  it("keeps printed page labels and joins a paragraph across a page break", async () => {
    const doc = await alice;
    expect(doc.pages.map((p) => p.label)).toEqual(["i", "1", "2"]);
    const crossing = blocksOf(doc).find((b) => b.text.startsWith("There was nothing"));
    expect(doc.pages[0].blocks).toContain(crossing);
  });

  it("reads two-column pages column by column", async () => {
    const doc = await parseFile("columns.pdf", await makeTwoColumnPdf());
    const paragraphs = blocksOf(doc).filter((b) => b.kind === "paragraph").map((b) => b.text);
    const page = [...COLUMN_LEFT, ...COLUMN_RIGHT];
    expect(paragraphs).toEqual([...page, ...page]);
    expect(blocksOf(doc)[0]).toMatchObject({ kind: "title", text: "Two Column Study Part 1" });
  });

  it("reports PDFs without a text layer", async () => {
    await expect(parseFile("scan.pdf", await makeBlankPdf())).rejects.toMatchObject({ code: "no_text" });
  });

  it("rejects files that are not PDFs", async () => {
    const error = await parseFile("broken.pdf", new TextEncoder().encode("not really a pdf")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).code).toBe("parse_error");
  });
});
