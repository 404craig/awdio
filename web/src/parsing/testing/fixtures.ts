/**
 * Test fixtures generated at test time (never shipped): PDF via pdf-lib, DOCX via docx, EPUB via jszip.
 * Text is public domain (Lewis Carroll, 1865; Jane Austen, 1813).
 */
import { Document as DocxDocument, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import JSZip from "jszip";
import { PDFDocument, PDFFont, PDFName, PDFNumber, StandardFonts, type PDFPage } from "pdf-lib";
import type { StructuredDocument } from "../types";

export const ALICE_TITLE = "Alice's Adventures in Wonderland";
export const RUNNING_HEADER = ALICE_TITLE;
export const ALICE_HEADINGS = ["CHAPTER I. Down the Rabbit-Hole", "CHAPTER II. The Pool of Tears"];
export const ALICE_PARAGRAPHS = [
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations?",
  "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
  "There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, Oh dear! Oh dear! I shall be late! But when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge. In another moment down went Alice after it, never once considering how in the world she was to get out again.",
  "Curiouser and curiouser! cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English); now I'm opening out like the largest telescope that ever was! Good-bye, feet!",
];
export const ALICE_BULLETS = ["the birds with draggled feathers", "the animals with their fur clinging close to them"];
export const HYPHENATED_WORD = "conversations";

// ---- PDF ----------------------------------------------------------------------------------------

const PAGE_W = 420;
const PAGE_H = 600;
const MARGIN = 50;
const BODY = 11;
const LEADING = 14.5;

interface Pen {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  pages: PDFPage[];
  regular: PDFFont;
  bold: PDFFont;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function newPage(pen: Pen): void {
  pen.page = pen.doc.addPage([PAGE_W, PAGE_H]);
  pen.pages.push(pen.page);
  pen.y = PAGE_H - MARGIN - 20;
}

function drawLines(pen: Pen, lines: string[], size: number, font: PDFFont, gapAfter: number): void {
  for (const line of lines) {
    if (pen.y < MARGIN + 30) newPage(pen);
    pen.page.drawText(line, { x: MARGIN, y: pen.y, size, font });
    pen.y -= size === BODY ? LEADING : size * 1.3;
  }
  pen.y -= gapAfter;
}

/** Roman numeral label for the first page, then decimal labels starting at 1. */
function setPageLabels(doc: PDFDocument): void {
  const roman = doc.context.obj({ S: PDFName.of("r") });
  const decimal = doc.context.obj({ S: PDFName.of("D"), St: PDFNumber.of(1) });
  const nums = doc.context.obj([PDFNumber.of(0), roman, PDFNumber.of(1), decimal]);
  doc.catalog.set(PDFName.of("PageLabels"), doc.context.obj({ Nums: nums }));
}

/**
 * Three pages: a title, two chapters with 16 pt headings, a paragraph that crosses a
 * page break, a hyphenated line end, two bullets, a running header and printed page numbers.
 */
export async function makeAlicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("alice.pdf"); // junk metadata title: the parser must fall back to the title block
  const pen: Pen = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: 0, pages: [], regular: await doc.embedFont(StandardFonts.TimesRoman), bold: await doc.embedFont(StandardFonts.TimesRomanBold) };
  pen.pages.push(pen.page);
  pen.y = PAGE_H - MARGIN - 20;
  const width = PAGE_W - 2 * MARGIN;

  drawLines(pen, [ALICE_TITLE], 22, pen.bold, 24);
  drawLines(pen, [ALICE_HEADINGS[0]], 16, pen.regular, 12);
  // First paragraph: force "conver-" / "sations" across a line end.
  const [head, tail] = ALICE_PARAGRAPHS[0].split(" conversations in it");
  const firstLines = wrap(head, pen.regular, BODY, width);
  firstLines[firstLines.length - 1] += " conver-";
  drawLines(pen, [...firstLines, ...wrap(`sations in it${tail}`, pen.regular, BODY, width)], BODY, pen.regular, 10);
  drawLines(pen, wrap(ALICE_PARAGRAPHS[1], pen.regular, BODY, width), BODY, pen.regular, 10);
  pen.y = MARGIN + 30 + 3 * LEADING; // the next paragraph starts near the bottom and continues overleaf
  drawLines(pen, wrap(ALICE_PARAGRAPHS[2], pen.regular, BODY, width), BODY, pen.regular, 10);
  drawLines(pen, ["She saw, one after another:"], BODY, pen.regular, 4);
  for (const bullet of ALICE_BULLETS) drawLines(pen, [`• ${bullet}`], BODY, pen.regular, 4);
  newPage(pen);
  drawLines(pen, [ALICE_HEADINGS[1]], 16, pen.regular, 12);
  drawLines(pen, wrap(ALICE_PARAGRAPHS[3], pen.regular, BODY, width), BODY, pen.regular, 10);

  pen.pages.forEach((page, i) => {
    page.drawText(RUNNING_HEADER, { x: MARGIN, y: PAGE_H - 30, size: 9, font: pen.regular });
    page.drawText(i === 0 ? "i" : String(i), { x: PAGE_W / 2, y: 25, size: 9, font: pen.regular });
  });
  setPageLabels(doc);
  return doc.save();
}

export const COLUMN_LEFT = ["The left column begins here and runs down the page in short lines.", "A second left paragraph keeps going for a while longer."];
export const COLUMN_RIGHT = ["The right column is read only after the left one has finished.", "Its second paragraph closes the page neatly."];

/** Two pages in two columns under a spanning title. */
export async function makeTwoColumnPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const colWidth = 150;
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawText(`Two Column Study Part ${p + 1}`, { x: MARGIN, y: PAGE_H - 70, size: 18, font: bold });
    [COLUMN_LEFT, COLUMN_RIGHT].forEach((paragraphs, col) => {
      let y = PAGE_H - 110;
      const x = col === 0 ? MARGIN : PAGE_W / 2 + 10;
      for (const para of paragraphs) {
        for (const line of wrap(para, font, BODY, colWidth)) {
          page.drawText(line, { x, y, size: BODY, font });
          y -= LEADING;
        }
        y -= 10;
      }
    });
  }
  return doc.save();
}

export async function makeBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]).drawRectangle({ x: 50, y: 50, width: 100, height: 100 });
  doc.setTitle("Scanned");
  return doc.save();
}

// ---- DOCX / EPUB ------------------------------------------------------------------------------

export const PRIDE_TITLE = "Pride and Prejudice";
export const PRIDE_PARAGRAPHS = [
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  "Mr. Bennet was among the earliest of those who waited on Mr. Bingley.",
];
export const PRIDE_QUOTE = "I hope Mr. Bingley will like it, Lizzy.";
export const PRIDE_LIST = ["Jane", "Elizabeth", "Mary"];

export async function makePrideDocx(): Promise<Uint8Array> {
  const doc = new DocxDocument({
    title: "Ignored because a Title paragraph exists",
    styles: { paragraphStyles: [{ id: "Quote", name: "Quote", basedOn: "Normal", run: { italics: true } }] },
    sections: [
      {
        children: [
          new Paragraph({ text: PRIDE_TITLE, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: "Chapter 1", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("It is a truth universally acknowledged, that a single man in possession of a "), new TextRun({ text: "good fortune", bold: true }), new TextRun(", must be in want of a wife.")] }),
          new Paragraph({ text: PRIDE_PARAGRAPHS[1] }),
          new Paragraph({ text: PRIDE_QUOTE, style: "Quote" }),
          new Paragraph({ text: "Chapter 2", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: PRIDE_PARAGRAPHS[2] }),
          ...PRIDE_LIST.map((name) => new Paragraph({ text: name, bullet: { level: 0 } })),
          new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Longbourn")] }), new TableCell({ children: [new Paragraph("Netherfield")] })] })] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

const xhtml = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><style>p{}</style></head><body>${body}</body></html>`;

export async function makePrideEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${PRIDE_TITLE}</dc:title></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest>
    <spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  zip.file("OEBPS/nav.xhtml", xhtml("Contents", `<nav epub:type="toc"><ol><li>Chapter 1</li><li>Chapter 2</li></ol></nav><p>Chapter 1 Chapter 2</p>`));
  zip.file(
    "OEBPS/text/chapter 1.xhtml",
    xhtml("One", `<h1>Chapter 1</h1><p>${PRIDE_PARAGRAPHS[0]}</p><p>${PRIDE_PARAGRAPHS[1]}</p><blockquote><p>${PRIDE_QUOTE}</p></blockquote><script>var hidden = 1;</script>`),
  );
  zip.file(
    "OEBPS/text/ch2.xhtml",
    xhtml("Two", `<section><h1>Chapter 2</h1><div><p>${PRIDE_PARAGRAPHS[2]}</p><p>Kitty<br/>and Lydia</p></div><ul>${PRIDE_LIST.map((n) => `<li>${n}</li>`).join("")}</ul></section>`),
  );
  zip.file("OEBPS/style.css", "p { margin: 0 }");
  return zip.generateAsync({ type: "uint8array" });
}

/** The contract every parsed document satisfies (docs/DATA.md). */
export function documentInvariantErrors(doc: StructuredDocument): string[] {
  const errors: string[] = [];
  let ordinal = 0;
  let index = 0;
  if (doc.pages.length === 0) errors.push("no pages");
  doc.pages.forEach((page, p) => {
    if (page.index !== p) errors.push(`page ${p} has index ${page.index}`);
    if (!page.label) errors.push(`page ${p} has no label`);
    if (page.blocks.length === 0) errors.push(`page ${p} is empty`);
    for (const block of page.blocks) {
      const t = block.text;
      if (!t || t !== t.trim() || t.includes("  ") || /[\n\t]/.test(t)) errors.push(`block ${index} text is not single-spaced`);
      if (block.index !== index) errors.push(`block ${index} has index ${block.index}`);
      if (block.wordCount !== t.split(" ").length) errors.push(`block ${index} wordCount`);
      if (block.wordStart !== ordinal) errors.push(`block ${index} wordStart`);
      const heading = block.kind === "title" || block.kind === "heading";
      if (heading ? !(block.level && block.level >= 1 && block.level <= 6) : block.level !== null) errors.push(`block ${index} level`);
      ordinal += block.wordCount;
      index += 1;
    }
  });
  if (doc.wordCount !== ordinal) errors.push("wordCount");
  if (doc.blockCount !== index) errors.push("blockCount");
  return errors;
}

export const blocksOf = (doc: StructuredDocument) => doc.pages.flatMap((p) => p.blocks);
