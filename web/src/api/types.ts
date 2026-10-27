/** Types mirroring docs/API.md (v1). Keep in sync with the server contract. */

export type SourceType = "pdf" | "epub" | "docx" | "txt" | "md";
/** Local TTS engines; only Kokoro for now (awdio is free-only, see docs/DECISIONS.md D1). */
export type EngineId = "kokoro";
export type BlockKind = "title" | "heading" | "paragraph" | "list_item" | "quote";

export interface AppConfig {
  accessPinRequired: boolean;
  unlocked: boolean;
  version: string;
}

export interface Health {
  status: "ok";
  engines: { id: EngineId; ready: boolean }[];
}

export interface Progress {
  blockIndex: number;
  wordIndex: number;
  wordOrdinal: number;
  percent: number;
  updatedAt: string;
}

export interface PrepareStatus {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  engine?: string;
  voiceId?: string;
  error?: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  wordCount: number;
  blockCount: number;
  pageCount: number;
  createdAt: string;
  lastOpenedAt: string | null;
  estimatedSeconds: number;
  progress: Progress | null;
  prepare: PrepareStatus;
}

export interface Block {
  index: number;
  kind: BlockKind;
  level: number | null;
  text: string;
  wordCount: number;
  wordStart: number;
}

export interface Page {
  index: number;
  label: string;
  blocks: Block[];
}

export interface Document extends DocumentSummary {
  pages: Page[];
}

export interface BlockAudio {
  blockIndex: number;
  engine: string;
  voiceId: string;
  url: string;
  durationSec: number;
  timings: [number, number][];
  format: "wav" | "mp3";
}

export interface Voice {
  id: string;
  engine: EngineId;
  name: string;
  accent: string;
  gender: "female" | "male" | "neutral";
  quality?: string;
}

export interface EngineInfo {
  id: EngineId;
  name: string;
  ready: boolean;
  description: string;
  voices: Voice[];
}

export type Theme = "system" | "light" | "dark" | "sepia";
export type ReadingFont = "serif" | "sans";

export interface Settings {
  engine: EngineId;
  voiceId: string;
  speed: number;
  font: ReadingFont;
  textSize: number;
  theme: Theme;
  autoScroll: boolean;
}

export type SettingsUpdate = Partial<Settings>;

export interface ProgressUpdate {
  blockIndex: number;
  wordIndex: number;
}

export interface ErrorBody {
  error: { code: string; message: string };
}
