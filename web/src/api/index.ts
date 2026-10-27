import { errorFromXhr, request, requestBlob, ApiError } from "./client";
import type {
  AppConfig,
  BlockAudio,
  Document,
  DocumentSummary,
  EngineInfo,
  Health,
  PrepareStatus,
  Progress,
  ProgressUpdate,
  Settings,
  SettingsUpdate,
} from "./types";

export { ApiError, isApiError, setLockedHandler } from "./client";
export type * from "./types";

const enc = encodeURIComponent;
const voiceQuery = (engine: string, voice: string) => `engine=${enc(engine)}&voice=${enc(voice)}`;

// Access PIN
export const getConfig = () => request<AppConfig>("/config");
export const unlock = (pin: string) => request<void>("/unlock", { method: "POST", body: { pin } });

// Health
export const getHealth = (signal?: AbortSignal) => request<Health>("/health", { signal });

// Documents
export const listDocuments = () => request<DocumentSummary[]>("/documents");
export const getDocument = (id: string, signal?: AbortSignal) =>
  request<Document>(`/documents/${enc(id)}`, { signal });
export const renameDocument = (id: string, title: string) =>
  request<DocumentSummary>(`/documents/${enc(id)}`, { method: "PATCH", body: { title } });
export const deleteDocument = (id: string) => request<void>(`/documents/${enc(id)}`, { method: "DELETE" });

export interface UploadHandlers {
  onProgress?: (fraction: number) => void;
  /** Called once the bytes are sent and the server is parsing. */
  onUploaded?: () => void;
  signal?: AbortSignal;
}

/** Multipart upload via XHR so we can report upload progress. */
export function uploadDocument(file: File, handlers: UploadHandlers = {}): Promise<DocumentSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) handlers.onProgress?.(e.loaded / e.total);
    };
    xhr.upload.onload = () => handlers.onUploaded?.();
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as DocumentSummary);
        } catch {
          reject(new ApiError(xhr.status, "bad_response", "The server sent an unexpected response"));
        }
      } else {
        reject(errorFromXhr(xhr));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "Can't reach the awdio server"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    handlers.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

// Progress
export const getProgress = (id: string) => request<Progress | null>(`/documents/${enc(id)}/progress`);
export const putProgress = (id: string, body: ProgressUpdate, keepalive = false) =>
  request<Progress>(`/documents/${enc(id)}/progress`, { method: "PUT", body, keepalive });

// Audio
/** `prefetch` lowers server priority so on-demand requests (the block the user waits for) go first. */
export const getBlockAudio = (
  id: string,
  blockIndex: number,
  engine: string,
  voice: string,
  opts: { prefetch?: boolean; signal?: AbortSignal } = {},
) =>
  request<BlockAudio>(
    `/documents/${enc(id)}/blocks/${blockIndex}/audio?${voiceQuery(engine, voice)}${opts.prefetch ? "&prefetch=true" : ""}`,
    { signal: opts.signal },
  );
export const getAudioFile = (url: string, signal?: AbortSignal) => requestBlob(url, signal);

export const startPrepare = (id: string, engine: string, voice: string) =>
  request<PrepareStatus>(`/documents/${enc(id)}/prepare?${voiceQuery(engine, voice)}`, { method: "POST" });
export const getPrepare = (id: string, engine: string, voice: string) =>
  request<PrepareStatus>(`/documents/${enc(id)}/prepare?${voiceQuery(engine, voice)}`);
export const cancelPrepare = (id: string) => request<void>(`/documents/${enc(id)}/prepare`, { method: "DELETE" });

// Voices
export const getVoices = () => request<{ engines: EngineInfo[] }>("/voices");
export const voicePreviewUrl = (engine: string, voiceId: string) =>
  `/api/voices/${enc(engine)}/${enc(voiceId)}/preview`;

// Settings
export const getSettings = () => request<Settings>("/settings");
export const putSettings = (body: SettingsUpdate) => request<Settings>("/settings", { method: "PUT", body });
