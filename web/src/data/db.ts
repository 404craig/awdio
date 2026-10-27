/**
 * On-device storage (docs/DATA.md): one IndexedDB database, four object stores. Nothing here
 * ever leaves the phone. All functions are async and safe to call before the app renders.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Document, DocumentSummary, Page, Progress, Settings } from "../types";

const DB_NAME = "awdio";
const DB_VERSION = 1;
const SETTINGS_KEY = "settings";

interface Structure {
  id: string;
  pages: Page[];
}

interface AwdioDB extends DBSchema {
  documents: { key: string; value: DocumentSummary };
  structures: { key: string; value: Structure };
  progress: { key: string; value: Progress };
  settings: { key: string; value: Partial<Settings> };
}

let connection: Promise<IDBPDatabase<AwdioDB>> | null = null;

function db(): Promise<IDBPDatabase<AwdioDB>> {
  connection ??= openDB<AwdioDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore("documents", { keyPath: "id" });
      database.createObjectStore("structures", { keyPath: "id" });
      database.createObjectStore("progress");
      database.createObjectStore("settings");
    },
    blocking() {
      // A newer version of the app opened the database in another tab: let it upgrade.
      void connection?.then((c) => c.close());
      connection = null;
    },
  });
  return connection;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  return (await db()).getAll("documents");
}

export async function listProgress(): Promise<Map<string, Progress>> {
  const d = await db();
  const tx = d.transaction("progress");
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  return new Map(keys.map((k, i) => [k, values[i]]));
}

export async function addDocument(doc: Document): Promise<void> {
  const { pages, ...summary } = doc;
  const tx = (await db()).transaction(["documents", "structures"], "readwrite");
  await Promise.all([tx.objectStore("documents").put(summary), tx.objectStore("structures").put({ id: doc.id, pages }), tx.done]);
}

export async function getDocument(id: string): Promise<Document | null> {
  const tx = (await db()).transaction(["documents", "structures"]);
  const [summary, structure] = await Promise.all([tx.objectStore("documents").get(id), tx.objectStore("structures").get(id)]);
  return summary && structure ? { ...summary, pages: structure.pages } : null;
}

export async function updateDocument(id: string, patch: Partial<Pick<DocumentSummary, "title" | "lastOpenedAt">>): Promise<DocumentSummary | null> {
  const tx = (await db()).transaction("documents", "readwrite");
  const current = await tx.store.get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  await Promise.all([tx.store.put(next), tx.done]);
  return next;
}

/** Removes the document, its page structure and the reading position, atomically. */
export async function deleteDocument(id: string): Promise<void> {
  const tx = (await db()).transaction(["documents", "structures", "progress"], "readwrite");
  await Promise.all([
    tx.objectStore("documents").delete(id),
    tx.objectStore("structures").delete(id),
    tx.objectStore("progress").delete(id),
    tx.done,
  ]);
}

export async function getProgress(id: string): Promise<Progress | null> {
  return (await (await db()).get("progress", id)) ?? null;
}

export async function putProgress(id: string, progress: Progress): Promise<void> {
  await (await db()).put("progress", progress, id);
}

export async function loadSettings(): Promise<Partial<Settings> | null> {
  return (await (await db()).get("settings", SETTINGS_KEY)) ?? null;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put("settings", settings, SETTINGS_KEY);
}

/** Asks the browser not to evict this origin's storage under pressure (no prompt on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function newDocumentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
