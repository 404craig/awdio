# Data on the device

Everything awdio knows lives in this browser's storage on this phone. Nothing is
sent anywhere: there is no backend. Clearing Safari's website data for the site
(or deleting the Home Screen app's data) removes it all.

## IndexedDB: database `awdio`, version 1

| Store | Key | Value | Written when |
|---|---|---|---|
| `documents` | `id` (in-line) | `DocumentSummary` | a file is added; renamed; opened (`lastOpenedAt`) |
| `structures` | `id` (in-line) | `{ id, pages: Page[] }` | a file is added |
| `progress` | document id (out-of-line) | `Progress` | while listening (≤ every 5 s), on pause, seek, app hide, leaving the reader |
| `settings` | `"settings"` (out-of-line) | `Settings` | any settings change |

Types are in `web/src/types.ts`:

```ts
interface DocumentSummary {
  id: string;                 // crypto.randomUUID()
  title: string;
  sourceType: "pdf" | "epub" | "docx" | "txt" | "md";
  fileName: string;
  wordCount: number;
  charCount: number;          // drives time estimates
  blockCount: number;
  pageCount: number;
  createdAt: string;          // ISO 8601
  lastOpenedAt: string | null;
}

interface Page { index: number; label: string; blocks: Block[] }
interface Block {
  index: number;              // global across the document
  kind: "title" | "heading" | "paragraph" | "list_item" | "quote";
  level: number | null;       // 1–6 for titles/headings
  text: string;               // single-spaced: words are text.split(" ")
  wordCount: number;
  wordStart: number;          // global ordinal of the first word
}

interface Progress {
  blockIndex: number;
  wordIndex: number;
  wordOrdinal: number;        // global word ordinal, so the library shows % without loading pages
  updatedAt: string;
}

interface Settings {
  voiceURI: string | null;    // explicit voice pick; null = best available (follows new installs)
  speed: number;              // 0.5–3
  font: "serif" | "sans";
  textSize: number;           // px, 15–26
  theme: "system" | "light" | "dark" | "sepia";
  autoScroll: boolean;        // "Follow along"
  voiceTipDismissed: boolean;
  homeScreenTipDismissed: boolean;
}
```

The library reads `documents` and `progress` only; `structures` (the bulk:
a 300-page book is a few MB of JSON) is read when a document is opened.
Deleting a document removes its rows from `documents`, `structures` and
`progress` in one transaction. The original file is never stored.

## localStorage

| Key | Value | Why |
|---|---|---|
| `awdio.settings` | JSON copy of `Settings` | read synchronously by `index.html` so theme, font and text size apply before first paint |
| `awdio.voiceRates` | `{ [voiceURI]: { cps, samples } }` | measured speaking rate per voice (time estimates, skips, highlight without boundary events) |

## Persistence

After the first document is added awdio calls `navigator.storage.persist()`.
Where granted, the browser will not evict the data under storage pressure.
Safari may still evict data of sites that have not been used for a long time
unless awdio is added to the Home Screen, which is one more reason to install
it.

## Schema changes

Bump `DB_VERSION` in `web/src/data/db.ts` and migrate in `upgrade()`; an open
tab running the old version closes its connection when it is blocked.
