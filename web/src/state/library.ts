import { create } from "zustand";
import {
  cancelPrepare,
  deleteDocument,
  getPrepare,
  isApiError,
  listDocuments,
  renameDocument,
  startPrepare,
  uploadDocument,
  type DocumentSummary,
  type PrepareStatus,
} from "../api";
import { useSettings } from "./settings";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".pdf", ".epub", ".docx", ".txt", ".md", ".markdown"];
const PREPARE_POLL_MS = 2000;

export interface Upload {
  id: number;
  name: string;
  phase: "uploading" | "analysing" | "error";
  progress: number;
  error?: string;
}

interface LibraryState {
  docs: DocumentSummary[];
  loaded: boolean;
  loadError: string | null;
  uploads: Upload[];
  load(): Promise<void>;
  upload(file: File): Promise<void>;
  dismissUpload(id: number): void;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  prepare(id: string): Promise<void>;
  stopPrepare(id: string): Promise<void>;
}

let uploadSeq = 0;
const polling = new Set<string>();

export function sortDocuments(docs: DocumentSummary[]): DocumentSummary[] {
  return [...docs].sort(
    (a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") || b.createdAt.localeCompare(a.createdAt),
  );
}

function uploadErrorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.status === 415) return "That file type isn't supported. Try PDF, EPUB, DOCX, TXT or Markdown.";
    if (e.code === "no_text") return "No readable text found. Scanned PDFs aren't supported yet.";
    if (e.status === 413) return "That file is larger than 50 MB.";
    return e.message;
  }
  return "Upload failed";
}

export const useLibrary = create<LibraryState>((set, get) => {
  const patchDoc = (id: string, patch: Partial<DocumentSummary>) =>
    set({ docs: get().docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) });

  const voice = () => {
    const { engine, voiceId } = useSettings.getState().settings;
    return { engine, voiceId };
  };

  const poll = (id: string) => {
    if (polling.has(id)) return;
    polling.add(id);
    const tick = async () => {
      const doc = get().docs.find((d) => d.id === id);
      if (!doc || doc.prepare.status !== "running") {
        polling.delete(id);
        return;
      }
      try {
        const { engine, voiceId } = voice();
        patchDoc(id, { prepare: await getPrepare(id, engine, voiceId) });
      } catch {
        /* transient; try again */
      }
      setTimeout(() => void tick(), PREPARE_POLL_MS);
    };
    setTimeout(() => void tick(), PREPARE_POLL_MS);
  };

  const setPrepare = (id: string, prepare: PrepareStatus) => {
    patchDoc(id, { prepare });
    if (prepare.status === "running") poll(id);
  };

  return {
    docs: [],
    loaded: false,
    loadError: null,
    uploads: [],

    async load() {
      try {
        const docs = sortDocuments(await listDocuments());
        set({ docs, loaded: true, loadError: null });
        docs.filter((d) => d.prepare.status === "running").forEach((d) => poll(d.id));
      } catch (e) {
        set({ loaded: true, loadError: isApiError(e) ? e.message : "Couldn't load your library" });
      }
    },

    async upload(file) {
      const id = ++uploadSeq;
      const update = (patch: Partial<Upload>) =>
        set({ uploads: get().uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
      set({ uploads: [...get().uploads, { id, name: file.name, phase: "uploading", progress: 0 }] });
      if (file.size > MAX_UPLOAD_BYTES) {
        update({ phase: "error", error: "That file is larger than 50 MB." });
        return;
      }
      try {
        const doc = await uploadDocument(file, {
          onProgress: (progress) => update({ progress }),
          onUploaded: () => update({ phase: "analysing", progress: 1 }),
        });
        set({ uploads: get().uploads.filter((u) => u.id !== id), docs: sortDocuments([doc, ...get().docs]) });
      } catch (e) {
        update({ phase: "error", error: uploadErrorMessage(e) });
      }
    },

    dismissUpload(id) {
      set({ uploads: get().uploads.filter((u) => u.id !== id) });
    },

    async rename(id, title) {
      const before = get().docs.find((d) => d.id === id);
      if (!before || !title.trim() || title.trim() === before.title) return;
      patchDoc(id, { title: title.trim() });
      try {
        const saved = await renameDocument(id, title.trim());
        patchDoc(id, { title: saved.title });
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

    async prepare(id) {
      const { engine, voiceId } = voice();
      const doc = get().docs.find((d) => d.id === id);
      if (doc) patchDoc(id, { prepare: { ...doc.prepare, status: "running", engine, voiceId } });
      try {
        setPrepare(id, await startPrepare(id, engine, voiceId));
      } catch (e) {
        patchDoc(id, {
          prepare: { status: "error", done: 0, total: doc?.blockCount ?? 0, error: isApiError(e) ? e.message : "Failed" },
        });
      }
    },

    async stopPrepare(id) {
      try {
        await cancelPrepare(id);
        const doc = get().docs.find((d) => d.id === id);
        if (doc) patchDoc(id, { prepare: { ...doc.prepare, status: "idle" } });
      } catch {
        /* leave the ring; the next poll corrects it */
      }
    },
  };
});
