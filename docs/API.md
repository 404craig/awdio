# awdio HTTP API contract (v1)

All endpoints are under `/api`. JSON unless stated. Errors are
`{ "error": { "code": string, "message": string } }` with a 4xx/5xx status.
Field names are camelCase. Times are ISO-8601 UTC strings. Durations are
seconds as floats.

The frontend is served from `/` by the same server in production; in dev,
Vite proxies `/api` to `http://localhost:8000`.

## Access PIN (only when `AWDIO_ACCESS_PIN` is set)

- `GET /api/config` → `{ "accessPinRequired": bool, "unlocked": bool, "version": string }`
- `POST /api/unlock` body `{ "pin": string }` → 204 and sets an HttpOnly cookie
  `awdio_session` (valid 180 days); 401 on a wrong PIN (rate-limited: 5 wrong
  attempts → 60 s lockout).
- When a PIN is required and the cookie is missing/invalid, every other
  `/api/*` route returns 401 `{ error: { code: "locked" } }`.

## Health

- `GET /api/health` → `{ "status": "ok", "engines": [{ "id": "kokoro", "ready": bool }, { "id": "elevenlabs", "ready": bool }] }`
  `ready` for kokoro means the model is loaded (it loads in the background on
  startup); for elevenlabs it means an API key is configured.

## Documents

### Types

```ts
type SourceType = "pdf" | "epub" | "docx" | "txt" | "md";

interface Progress {
  blockIndex: number;      // global block index
  wordIndex: number;       // word index within that block
  wordOrdinal: number;     // global word ordinal (derived by server)
  percent: number;         // 0..100, derived by server
  updatedAt: string;
}

interface PrepareStatus {
  status: "idle" | "running" | "done" | "error";
  done: number;            // blocks synthesised for the current engine/voice
  total: number;           // total blocks
  engine?: string; voiceId?: string; error?: string;
}

interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  wordCount: number;
  blockCount: number;
  pageCount: number;
  createdAt: string;
  lastOpenedAt: string | null;
  estimatedSeconds: number;   // wordCount × measured or default seconds-per-word
  progress: Progress | null;
  prepare: PrepareStatus;
}

interface Block {
  index: number;                         // GLOBAL, 0-based
  kind: "title" | "heading" | "paragraph" | "list_item" | "quote";
  level: number | null;                  // heading level 1..6 for heading/title
  text: string;                          // single-spaced, trimmed, no newlines/tabs
  wordCount: number;                     // == text.split(" ").length
  wordStart: number;                     // global ordinal of this block's first word
}

interface Page {
  index: number;                         // 0-based
  label: string;                         // "12" or "Ch. 3 · 2"
  blocks: Block[];
}

interface Document extends DocumentSummary {
  pages: Page[];
}
```

Tokenisation rule (both sides must agree): words of a block are
`block.text.split(" ")`. The server guarantees `text` contains single spaces
only, no leading/trailing whitespace, and is non-empty.

### Endpoints

- `GET /api/documents` → `DocumentSummary[]` sorted by `lastOpenedAt` desc then `createdAt` desc.
- `POST /api/documents` multipart form, field `file` (≤ 50 MB; extension or
  MIME decides the parser) → 201 `DocumentSummary`. Parsing is synchronous.
  415 for unsupported types, 422 if no readable text was found
  (`code: "no_text"`, e.g. scanned PDF).
- `GET /api/documents/{id}` → `Document`. Also sets `lastOpenedAt = now`.
  Response is gzip-compressed when the client accepts it.
- `PATCH /api/documents/{id}` body `{ "title": string }` → `DocumentSummary`.
- `DELETE /api/documents/{id}` → 204. Removes upload, parsed JSON and audio cache.
- `GET /api/documents/{id}/progress` → `Progress | null`
- `PUT /api/documents/{id}/progress` body
  `{ "blockIndex": number, "wordIndex": number }` → `Progress`.
  Out-of-range indices are clamped.

## Audio

- `GET /api/documents/{id}/blocks/{blockIndex}/audio?engine=kokoro&voice=af_heart`
  Synthesises the block if not cached (blocking; typical < 2 s per paragraph
  on CPU) and returns
  ```ts
  interface BlockAudio {
    blockIndex: number;
    engine: string; voiceId: string;
    url: string;                 // e.g. "/api/audio/<cacheKey>.wav" (GET returns the file, long Cache-Control)
    durationSec: number;
    timings: [number, number][]; // one [start, end] per word, length == wordCount, monotonic, no gaps-of-unknown (server interpolates)
    format: "wav" | "mp3";
  }
  ```
  400 if the engine/voice is unknown, 503 `{ code: "engine_not_ready" }` while
  the local model is still loading, 502 `{ code: "engine_error" }` on cloud failure.
- `GET /api/audio/{cacheKey}.{ext}` → the audio file (supports Range).
- `POST /api/documents/{id}/prepare?engine&voice` → 202 `PrepareStatus`. Starts
  (or returns the existing) background synthesis of all blocks for that
  engine/voice, in document order, at lower priority than on-demand requests.
- `GET /api/documents/{id}/prepare?engine&voice` → `PrepareStatus`.
- `DELETE /api/documents/{id}/prepare` → 204 cancels a running job.

## Voices

```ts
interface Voice {
  id: string;            // e.g. "af_heart" or an ElevenLabs voice_id
  engine: "kokoro" | "elevenlabs";
  name: string;          // "Heart"
  accent: string;        // "American", "British", … (ElevenLabs: from labels, else "Unknown")
  gender: "female" | "male" | "neutral";
  quality?: string;      // kokoro grade like "A", optional
}
interface EngineInfo {
  id: "kokoro" | "elevenlabs";
  name: string;              // "Kokoro (on this device)" / "ElevenLabs (cloud)"
  ready: boolean;
  configured: boolean;       // elevenlabs: API key present
  description: string;       // one line for the settings UI
  voices: Voice[];
}
```

- `GET /api/voices` → `{ "engines": EngineInfo[] }`
- `GET /api/voices/{engine}/{voiceId}/preview` → audio file of a fixed sample
  sentence (cached). Same formats as block audio.

## Settings (single user)

```ts
interface Settings {
  engine: "kokoro" | "elevenlabs";
  voiceId: string;
  speed: number;            // 0.5..3, step 0.25
  font: "serif" | "sans";
  textSize: number;         // px, 15..26
  theme: "system" | "light" | "dark" | "sepia";
  autoScroll: boolean;
  elevenLabsConfigured: boolean;   // read-only
  elevenLabsModelId: string;       // default "eleven_multilingual_v2"
}
```

- `GET /api/settings` → `Settings`
- `PUT /api/settings` body: any subset of the writable fields plus optional
  `elevenLabsApiKey: string` (write-only; empty string clears it) → `Settings`.
  Keys are validated by calling the ElevenLabs voices endpoint; 400
  `{ code: "invalid_api_key" }` if rejected.

## Defaults

- engine `kokoro`, voice `af_heart`, speed 1.0, font serif, textSize 19,
  theme system, autoScroll true.
