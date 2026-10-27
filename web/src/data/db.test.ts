import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Document } from "../types";
import { addDocument, deleteDocument, getDocument, getProgress, listDocuments, listProgress, loadSettings, putProgress, saveSettings, updateDocument } from "./db";
import { DEFAULT_SETTINGS } from "../state/settings";

const doc = (id: string): Document => ({
  id,
  title: `Doc ${id}`,
  sourceType: "txt",
  fileName: `${id}.txt`,
  wordCount: 3,
  charCount: 13,
  blockCount: 1,
  pageCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastOpenedAt: null,
  pages: [{ index: 0, label: "1", blocks: [{ index: 0, kind: "paragraph", level: null, text: "One two three", wordCount: 3, wordStart: 0 }] }],
});

describe("on-device storage", () => {
  it("stores summaries separately from page structure", async () => {
    await addDocument(doc("a"));
    await addDocument(doc("b"));
    const list = await listDocuments();
    expect(list.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect("pages" in list[0]).toBe(false);
    expect((await getDocument("a"))?.pages[0].blocks[0].text).toBe("One two three");
    expect(await getDocument("missing")).toBeNull();
  });

  it("renames and records when a document was opened", async () => {
    await updateDocument("a", { title: "Renamed", lastOpenedAt: "2026-02-02T00:00:00.000Z" });
    expect(await getDocument("a")).toMatchObject({ title: "Renamed", lastOpenedAt: "2026-02-02T00:00:00.000Z" });
    expect(await updateDocument("missing", { title: "x" })).toBeNull();
  });

  it("saves the reading position per document", async () => {
    const progress = { blockIndex: 0, wordIndex: 2, wordOrdinal: 2, updatedAt: "2026-02-02T00:00:00.000Z" };
    await putProgress("a", progress);
    expect(await getProgress("a")).toEqual(progress);
    expect((await listProgress()).get("a")).toEqual(progress);
    expect(await getProgress("b")).toBeNull();
  });

  it("deletes a document with its structure and position", async () => {
    await deleteDocument("a");
    expect(await getDocument("a")).toBeNull();
    expect(await getProgress("a")).toBeNull();
    expect((await listDocuments()).map((d) => d.id)).toEqual(["b"]);
  });

  it("keeps settings as a single record", async () => {
    expect(await loadSettings()).toBeNull();
    await saveSettings({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect((await loadSettings())?.theme).toBe("dark");
  });
});
