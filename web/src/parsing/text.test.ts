import { describe, expect, it } from "vitest";
import { detectSourceType, parseFile } from "./index";
import { stripInlineMarkdown } from "./markdown";
import { blocksOf, documentInvariantErrors } from "./testing/fixtures";

const encode = (s: string) => new TextEncoder().encode(s);

const TXT = `PRIDE AND PREJUDICE

Chapter 1

It is a truth universally acknowledged, that a single man
in possession of a good fortune, must be in want of a wife.

CHAPTER 2.
Mr. Bennet's Visit

Mr. Bennet was among the earliest of those who waited on
Mr. Bingley.
`;

const MD = `---
title: front matter is skipped
---
# Pride and Prejudice

By *Jane* Austen

## Chapter 1

It is a **truth** universally acknowledged, that a single man in possession
of a good fortune, must be in want of a wife.

> I hope Mr. Bingley will like it,
> Lizzy.

- Jane Bennet
- Elizabeth Bennet
1. Mary Bennet

Chapter 2
---------

\`\`\`
code is read as text
\`\`\`

See the [novel](https://example.org) and chapter_one.
`;

describe("TXT parser", () => {
  it("finds the title, chapter headings and joins wrapped lines", async () => {
    const doc = await parseFile("pride.txt", encode(TXT));
    expect(documentInvariantErrors(doc)).toEqual([]);
    const blocks = blocksOf(doc);
    expect(doc.title).toBe("PRIDE AND PREJUDICE");
    expect(blocks.map((b) => [b.kind, b.level])).toEqual([
      ["title", 1],
      ["heading", 1],
      ["paragraph", null],
      ["heading", 1],
      ["paragraph", null],
    ]);
    expect(blocks[3].text).toBe("CHAPTER 2. Mr. Bennet's Visit");
    expect(blocks[2].text).toBe("It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.");
  });

  it("falls back to the prettified file name for the title", async () => {
    const doc = await parseFile("my_reading-notes.txt", encode("just a plain paragraph of notes, nothing more.\n"));
    expect(doc.title).toBe("My reading notes");
  });

  it("decodes Windows-1252 and rejects binary data", async () => {
    const doc = await parseFile("legacy.txt", new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x6f, 0x6b, 0x94]));
    expect(blocksOf(doc)[0].text).toBe("Café “ok”");
    await expect(parseFile("x.txt", new Uint8Array([1, 0, 2]))).rejects.toMatchObject({ code: "parse_error" });
    await expect(parseFile("empty.txt", encode("  \n\n "))).rejects.toMatchObject({ code: "no_text" });
  });
});

describe("Markdown parser", () => {
  it("parses headings, quotes, lists and strips inline markup", async () => {
    const doc = await parseFile("pride.md", encode(MD));
    expect(documentInvariantErrors(doc)).toEqual([]);
    const blocks = blocksOf(doc);
    expect([blocks[0].kind, blocks[0].text]).toEqual(["title", "Pride and Prejudice"]);
    expect(blocks[1].text).toBe("By Jane Austen");
    expect(blocks.filter((b) => b.kind === "heading").map((b) => [b.text, b.level])).toEqual([
      ["Chapter 1", 2],
      ["Chapter 2", 2],
    ]);
    expect(blocks.filter((b) => b.kind === "quote").map((b) => b.text)).toEqual(["I hope Mr. Bingley will like it, Lizzy."]);
    expect(blocks.filter((b) => b.kind === "list_item").map((b) => b.text)).toEqual(["Jane Bennet", "Elizabeth Bennet", "1. Mary Bennet"]);
    expect(blocks.some((b) => b.text.includes("front matter"))).toBe(false);
    expect(blocks[blocks.length - 1].text).toBe("See the novel and chapter_one.");
  });

  it("strips nested emphasis but keeps intra-word underscores", () => {
    expect(stripInlineMarkdown("***bold italic*** and **_mixed_** in snake_case_name `code`")).toBe(
      "bold italic and mixed in snake_case_name code",
    );
  });
});

describe("type detection", () => {
  it("uses the extension, then the MIME type", () => {
    expect(detectSourceType("Book.EPUB")).toBe("epub");
    expect(detectSourceType("notes.markdown")).toBe("md");
    expect(detectSourceType("download", "application/pdf")).toBe("pdf");
    expect(detectSourceType("image.png", "image/png")).toBeNull();
  });
});
