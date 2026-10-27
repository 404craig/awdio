/**
 * `?demo=1`: puts three public-domain sample documents into IndexedDB (through the real
 * parser), for screenshots, perf checks and trying awdio without a file to hand.
 */
import { positionToOrdinal, ordinalToPosition } from "../audio/timeline";
import { addDocument, getDocument, putProgress } from "../data/db";
import { parseInWorker } from "../parsing/client";
import { toDocument } from "../state/library";
import type { Block } from "../types";

interface Sample {
  id: string;
  file: string;
  /** Where the sample reader has got to, as a fraction of its words (null: not started). */
  progress: number | null;
  /** Days ago it was last opened, so the library has a stable order. */
  openedDaysAgo: number | null;
}

const SAMPLES: Sample[] = [
  { id: "demo-alice", file: "alice.md", progress: 0.18, openedDaysAgo: 0 },
  { id: "demo-pride", file: "pride-and-prejudice.md", progress: null, openedDaysAgo: null },
  { id: "demo-notes", file: "garden-notes.md", progress: 1, openedDaysAgo: 3 },
];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function seedOne(sample: Sample): Promise<void> {
  if (await getDocument(sample.id)) return;
  const response = await fetch(`${import.meta.env.BASE_URL}demo/${sample.file}`);
  if (!response.ok) throw new Error(`demo file ${sample.file}: ${response.status}`);
  const file = new File([await response.blob()], sample.file, { type: "text/markdown" });
  const doc = toDocument(await parseInWorker(file, () => {}), sample.file, sample.id);
  doc.createdAt = daysAgo(7);
  doc.lastOpenedAt = sample.openedDaysAgo === null ? null : daysAgo(sample.openedDaysAgo);
  await addDocument(doc);
  if (sample.progress === null) return;
  const blocks: Block[] = doc.pages.flatMap((p) => p.blocks);
  const pos = ordinalToPosition(blocks, Math.round(sample.progress * doc.wordCount));
  // Resume at the start of a paragraph, as a real listener would have paused.
  const start = { blockIndex: pos.blockIndex, wordIndex: sample.progress >= 1 ? pos.wordIndex : 0 };
  await putProgress(sample.id, { ...start, wordOrdinal: positionToOrdinal(blocks, start), updatedAt: daysAgo(sample.openedDaysAgo ?? 0) });
}

export async function seedDemo(): Promise<void> {
  for (const sample of SAMPLES) await seedOne(sample);
}
