import type { Block, BlockKind, Document, DocumentSummary, EngineInfo, Settings, SourceType } from "../src/api/types";
import { ALICE_CHAPTERS, ALICE_LIST, ALICE_PARAGRAPHS, ALICE_QUOTES, AUSTEN_PARAGRAPHS, NOTES_BLOCKS } from "./corpus";

export const SECONDS_PER_WORD = 0.38;

interface RawBlock {
  kind: BlockKind;
  level?: number;
  text: string;
  /** Start a new page before this block (PDF-like fixed pages). */
  pageBreak?: boolean;
  chapter?: boolean;
}

/** Applies the synthetic paging rules from docs/ARCHITECTURE.md to raw blocks. */
export function buildDocument(
  meta: Pick<DocumentSummary, "id" | "title" | "sourceType" | "createdAt" | "lastOpenedAt">,
  raw: RawBlock[],
  mode: "synthetic" | "fixed",
): Document {
  const pages: Document["pages"] = [];
  let current: Block[] = [];
  let currentWords = 0;
  let wordStart = 0;
  let chapter = 0;
  let pageInChapter = 0;
  const flush = () => {
    if (!current.length) return;
    pageInChapter += 1;
    const index = pages.length;
    const label = mode === "fixed" || chapter === 0 ? String(index + 1) : `Ch. ${chapter} · ${pageInChapter}`;
    pages.push({ index, label, blocks: current });
    current = [];
    currentWords = 0;
  };
  raw.forEach((r, i) => {
    const text = r.text.replace(/\s+/g, " ").trim();
    const wordCount = text.split(" ").length;
    const majorHeading = r.kind === "title" || (r.kind === "heading" && (r.level ?? 1) <= 2);
    if (mode === "fixed" ? r.pageBreak && current.length : (majorHeading && currentWords > 150) || currentWords >= 450) {
      flush();
    }
    if (r.chapter) {
      chapter += 1;
      pageInChapter = 0;
    }
    current.push({
      index: i,
      kind: r.kind,
      level: r.kind === "heading" || r.kind === "title" ? (r.level ?? 1) : null,
      text,
      wordCount,
      wordStart,
    });
    wordStart += wordCount;
    currentWords += wordCount;
  });
  flush();
  return {
    ...meta,
    wordCount: wordStart,
    blockCount: raw.length,
    pageCount: pages.length,
    estimatedSeconds: wordStart * SECONDS_PER_WORD,
    progress: null,
    prepare: { status: "idle", done: 0, total: raw.length },
    pages,
  };
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function aliceBlocks(): RawBlock[] {
  const blocks: RawBlock[] = [{ kind: "title", level: 1, text: "Alice’s Adventures in Wonderland" }];
  blocks.push({ kind: "paragraph", text: "by Lewis Carroll" });
  let p = 0;
  ALICE_CHAPTERS.forEach((name, c) => {
    blocks.push({ kind: "heading", level: 1, text: `Chapter ${ROMAN[c]}. ${name}`, chapter: true });
    let words = 0;
    let n = 0;
    while (words < 2050) {
      const text = ALICE_PARAGRAPHS[p % ALICE_PARAGRAPHS.length];
      p += 1;
      n += 1;
      blocks.push({ kind: "paragraph", text });
      words += text.split(" ").length;
      if (n === 6 && c % 3 === 0) blocks.push({ kind: "quote", text: ALICE_QUOTES[c % ALICE_QUOTES.length] });
      if (n === 9 && c % 4 === 1) {
        blocks.push({ kind: "paragraph", text: "On the little glass table she found, one after another:" });
        ALICE_LIST.forEach((item) => blocks.push({ kind: "list_item", text: item }));
      }
      if (n === 12 && c % 2 === 0) blocks.push({ kind: "heading", level: 3, text: "A short interlude" });
    }
  });
  return blocks;
}

function austenBlocks(): RawBlock[] {
  const blocks: RawBlock[] = [{ kind: "title", level: 1, text: "Pride and Prejudice", pageBreak: true }];
  for (let page = 0; page < 8; page++) {
    if (page % 3 === 0) blocks.push({ kind: "heading", level: 2, text: `Chapter ${page / 3 + 1}`, pageBreak: page > 0 });
    AUSTEN_PARAGRAPHS.forEach((text, i) =>
      blocks.push({ kind: "paragraph", text, pageBreak: i === 0 && page % 3 !== 0 }),
    );
  }
  return blocks;
}

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export function initialDocuments(): Document[] {
  const alice = buildDocument(
    { id: "alice", title: "Alice’s Adventures in Wonderland", sourceType: "epub", createdAt: iso(60 * 24 * 9), lastOpenedAt: iso(42) },
    aliceBlocks(),
    "synthetic",
  );
  const austen = buildDocument(
    { id: "pride", title: "Pride and Prejudice — opening chapters", sourceType: "pdf", createdAt: iso(60 * 24 * 20), lastOpenedAt: iso(60 * 26) },
    austenBlocks(),
    "fixed",
  );
  const notes = buildDocument(
    { id: "notes", title: "Garden planning notes", sourceType: "docx", createdAt: iso(60 * 3), lastOpenedAt: null },
    NOTES_BLOCKS.map((b) => ({ ...b })),
    "synthetic",
  );
  austen.prepare = { status: "done", done: austen.blockCount, total: austen.blockCount, engine: "kokoro", voiceId: "af_heart" };
  return [alice, austen, notes];
}

/** Turn uploaded plain text / markdown into raw blocks. */
export function blocksFromText(text: string, title: string): RawBlock[] {
  const out: RawBlock[] = [{ kind: "title", level: 1, text: title }];
  for (const chunk of text.split(/\n\s*\n/)) {
    const line = chunk.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const md = /^(#{1,6})\s+(.*)$/.exec(line);
    if (md) out.push({ kind: "heading", level: md[1].length, text: md[2] });
    else if (/^[-*]\s+/.test(line)) out.push({ kind: "list_item", text: line.replace(/^[-*]\s+/, "") });
    else if (/^>\s*/.test(line)) out.push({ kind: "quote", text: line.replace(/^>\s*/, "") });
    else out.push({ kind: "paragraph", text: line });
  }
  if (out.length === 1) out.push({ kind: "paragraph", text: ALICE_PARAGRAPHS[0] });
  return out;
}

export function fallbackBlocks(title: string): RawBlock[] {
  return [{ kind: "title", level: 1, text: title }, ...ALICE_PARAGRAPHS.slice(0, 6).map((text) => ({ kind: "paragraph" as const, text }))];
}

export const SUPPORTED: Record<string, SourceType> = {
  pdf: "pdf",
  epub: "epub",
  docx: "docx",
  txt: "txt",
  md: "md",
  markdown: "md",
};

export const defaultSettings = (): Settings => ({
  engine: "kokoro",
  voiceId: "af_heart",
  speed: 1,
  font: "serif",
  textSize: 19,
  theme: "system",
  autoScroll: true,
  elevenLabsConfigured: false,
  elevenLabsModelId: "eleven_multilingual_v2",
});

export function engines(kokoroReady: boolean, elevenConfigured: boolean): EngineInfo[] {
  const k = (id: string, name: string, accent: string, gender: "female" | "male", quality: string) => ({
    id,
    engine: "kokoro" as const,
    name,
    accent,
    gender,
    quality,
  });
  return [
    {
      id: "kokoro",
      name: "Kokoro (on this device)",
      ready: kokoroReady,
      configured: true,
      description: "Private and free. Runs on your server; text never leaves it.",
      voices: [
        k("af_heart", "Heart", "American", "female", "A"),
        k("af_bella", "Bella", "American", "female", "A-"),
        k("af_nicole", "Nicole", "American", "female", "B-"),
        k("am_michael", "Michael", "American", "male", "C+"),
        k("am_fenrir", "Fenrir", "American", "male", "C+"),
        k("bf_emma", "Emma", "British", "female", "B-"),
        k("bf_isabella", "Isabella", "British", "female", "C"),
        k("bm_george", "George", "British", "male", "C"),
        k("bm_fable", "Fable", "British", "male", "C"),
      ],
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs (cloud)",
      ready: elevenConfigured,
      configured: elevenConfigured,
      description: "Most expressive. Uses your own API key; text is sent to ElevenLabs.",
      voices: elevenConfigured
        ? [
            { id: "21m00Tcm4TlvDq8ikWAM", engine: "elevenlabs", name: "Rachel", accent: "American", gender: "female" },
            { id: "JBFqnCBsd6RMkjVDRZzb", engine: "elevenlabs", name: "George", accent: "British", gender: "male" },
          ]
        : [],
    },
  ];
}
