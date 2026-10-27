import { create } from "zustand";
import { addDocument, deleteDocument, listDocuments, listProgress, newDocumentId, requestPersistence, updateDocument } from "../data/db";
import { parseInWorker } from "../parsing/client";
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from "../parsing/index";
import { ParseError, type StructuredDocument } from "../parsing/types";
import type { Document, DocumentSummary, Progress } from "../types";

export { ACCEPTED_EXTENSIONS };

export interface LibraryItem extends DocumentSummary {
  progress: Progress | null;
}

export interface Upload {
  id: number;
  name: string;
  phase: "reading" | "analysing" | "error";
  /** 0–1 when the parser can tell, otherwise null. */
  progress: number | null;
  error?: string;
}

interface LibraryState {
  docs: LibraryItem[];
  loaded: boolean;
  loadError: string | null;
  uploads: Upload[];
  load(): Promise<void>;
  upload(file: File): Promise<void>;
  dismissUpload(id: number): void;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Keeps the list in step with the reader (opened time, position) without a reload. */
  patch(id: string, patch: Partial<LibraryItem>): void;
}

let uploadSeq = 0;

function sortDocuments<T extends DocumentSummary>(docs: T[]): T[] {
  return [...docs].sort(
    (a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || b.createdAt.localeCompare(a.createdAt),
  );
}

export function toDocument(parsed: StructuredDocument, fileName: string, id = newDocumentId()): Document {
  return {
    id,
    title: parsed.title,
    sourceType: parsed.sourceType,
    fileName,
    wordCount: parsed.wordCount,
    charCount: parsed.charCount,
    blockCount: parsed.blockCount,
    pageCount: parsed.pages.length,
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
    pages: parsed.pages,
  };
}

const uploadErrorMessage = (e: unknown) =>
  e instanceof ParseError ? e.message : "This file couldn't be added. Your phone may be out of storage.";

export const useLibrary = create<LibraryState>((set, get) => {
  const patchDoc = (id: string, patch: Partial<LibraryItem>) =>
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  return {
    docs: [],
    loaded: false,
    loadError: null,
    uploads: [],

    async load() {
      try {
        const [summaries, progress] = await Promise.all([listDocuments(), listProgress()]);
        const docs = summaries.map((d) => ({ ...d, progress: progress.get(d.id) ?? null }));
        set({ docs: sortDocuments(docs), loaded: true, loadError: null });
      } catch {
        set({ loaded: true, loadError: "Couldn't open your library on this device." });
      }
    },

    async upload(file) {
      const id = ++uploadSeq;
      const update = (patch: Partial<Upload>) => set({ uploads: get().uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
      set({ uploads: [...get().uploads, { id, name: file.name, phase: "reading", progress: null }] });
      if (file.size > MAX_FILE_BYTES) {
        update({ phase: "error", error: "That file is larger than 50 MB." });
        return;
      }
      try {
        const parsed = await parseInWorker(file, (p) => update({ phase: p.phase, progress: p.fraction }));
        const doc = toDocument(parsed, file.name);
        await addDocument(doc);
        void requestPersistence();
        const { pages: _pages, ...summary } = doc;
        set({ uploads: get().uploads.filter((u) => u.id !== id), docs: sortDocuments([{ ...summary, progress: null }, ...get().docs]) });
      } catch (e) {
        update({ phase: "error", error: uploadErrorMessage(e) });
      }
    },

    dismissUpload(id) {
      set({ uploads: get().uploads.filter((u) => u.id !== id) });
    },

    async rename(id, title) {
      const before = get().docs.find((d) => d.id === id);
      const next = title.trim();
      if (!before || !next || next === before.title) return;
      patchDoc(id, { title: next });
      try {
        await updateDocument(id, { title: next });
      } catch {
        patchDoc(id, { title: before.title });
      }
    },

    async remove(id) {
      const before = get().docs;
      set({ docs: before.filter((d) => d.id !== id) });
      try {
        await deleteDocument(id);
      } catch {
        set({ docs: before });
      }
    },

    patch(id, patch) {
      patchDoc(id, patch);
      if (patch.lastOpenedAt !== undefined) set({ docs: sortDocuments(get().docs) });
    },
  };
});
