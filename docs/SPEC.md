# awdio — product & UX specification

awdio is a personal, self-hosted "listen to your documents" app in the spirit of
Speechify / ElevenReader, without the faff. One user, private documents, no
accounts. Upload a document, awdio works out its structure (titles, paragraphs,
pages) and reads it aloud with a state-of-the-art neural voice while the screen
follows along word by word. Progress is saved per document and resumed later.

Design bar: Apple / Airbnb / Shopify. Calm, spacious, obvious. Mobile-first
(finger scrubbing is a core interaction), but excellent on desktop.

## 1. Scope

In scope
- Upload: PDF, EPUB, DOCX, TXT, Markdown. Max 50 MB.
- Structure analysis: headings, paragraphs, list items, block quotes, pages.
  Purely layout analysis. awdio never summarises, classifies, rates, filters or
  comments on the content of a document. Nothing about the content is sent to
  any third party unless the user explicitly chooses the cloud voice engine.
- Playback: play / pause, previous / next paragraph, skip back / forward 15 s,
  speed 0.5x–3.0x in 0.25 steps (pitch preserved), voice selection, resume.
- Follow-along: the current word is highlighted and the current paragraph is
  gently tinted; the view auto-scrolls to keep the current line in view; the
  user can scroll away freely and tap "Back to reading" to re-attach.
- Scrubbing: (a) a document-wide timeline the user drags with a finger; while
  dragging it shows "Page N · 42%" and a snippet, and seeks on release;
  (b) tap any word on the page to start reading from it; (c) press-and-hold
  on the text then drag to scrub word by word (live preview highlight, seek on
  release).
- Progress: saved automatically (server-side) per document: current block,
  word, and the chosen voice/speed. Library shows % complete and "Continue".
- Library: list of uploaded documents, upload (drag-and-drop or button),
  rename, delete, sort by last opened.
- Settings: voice (grouped by engine and accent, with a short preview),
  speed, reading font (serif / sans), text size, theme (light / dark / sepia,
  default follows system), auto-scroll on/off.
- Whole-document pre-synthesis ("Prepare audio") with a progress indicator so
  long books play without any waiting.
- Lock-screen / hardware media controls via the Media Session API.
- Installable as a PWA (manifest + icons; no offline caching of audio required).

Out of scope (deliberately)
- Accounts, multi-user, sharing, sync services. Progress persists because the
  server stores it, so it already follows the user across devices.
  An optional single access PIN (env `AWDIO_ACCESS_PIN`, off by default) gates
  the whole app with one PIN screen when the user deploys it somewhere public.
  This is not a login system.
- OCR of scanned PDFs (v2 candidate).
- Highlighting/notes/bookmarks beyond the auto-saved position (v2 candidate).
- Voice cloning.

## 2. Architecture (summary; details in ARCHITECTURE.md and API.md)

- `server/` Python 3.11+ FastAPI service: parsing, structure analysis, TTS
  synthesis with word timestamps, audio cache, SQLite persistence. Serves the
  built frontend in production so the whole app is one process.
- `web/` Vite + React 18 + TypeScript + Tailwind single-page app.
- `data/` runtime data (uploads, parsed documents, audio cache, SQLite).

TTS engines (see DECISIONS.md for why):
- `kokoro` (default): Kokoro-82M, Apache-2.0 open weights, runs locally on
  CPU, returns per-token timestamps. Private and free.
- `elevenlabs` (optional): best-in-class expressiveness; user supplies an API
  key in Settings; uses the with-timestamps endpoint for word alignment.

Both engines expose the same contract: text in → audio file + word timings out.

## 3. Document model

A parsed document is a tree of pages → blocks → words.

```
Document
  id            string (uuid)
  title         string
  sourceType    "pdf" | "epub" | "docx" | "txt" | "md"
  wordCount     int
  pages: Page[]
Page
  index         int (0-based)
  label         string   e.g. "12" for real PDF pages, "Ch. 3 · 2" for synthetic
  blocks: Block[]
Block
  index         int (0-based, GLOBAL across the whole document)
  kind          "title" | "heading" | "paragraph" | "list_item" | "quote"
  level         int | null  (heading level 1..6)
  text          string      (clean, single-spaced, hyphenation repaired)
  words: Word[]
Word
  index         int (0-based within the block)
  text          string   the token exactly as rendered, incl. trailing punctuation
  start         int      char offset of the token in block.text
  end           int
```

Rules
- Block indices are global so the timeline is "block index + word index".
- Words are whitespace-delimited tokens of `block.text`. Punctuation stays
  attached (so "Hello," is one word). This makes rendering trivial: join words
  with single spaces to reproduce `text`.
- Pages: PDFs keep their real pages. Other formats get synthetic pages of
  roughly 400–500 words, never splitting a block; a level 1–2 heading starts a
  new page when the current page already holds >150 words.
- Structure heuristics per format are specified in ARCHITECTURE.md.

## 4. Timeline & seeking

The document timeline is word-indexed, not time-indexed: position = global
word ordinal (sum of words in all earlier blocks + word index). This is exact
regardless of which blocks have been synthesised. Estimated time remaining
uses the measured average seconds-per-word of synthesised blocks (fallback
0.38 s/word ≈ 160 wpm) divided by the playback rate.

Seeking to (block b, word w): the player loads block b's audio and starts at
the word's start timestamp.

## 5. Playback engine (client)

- One `HTMLAudioElement`, `preservesPitch = true`, `playbackRate` = speed.
  Block audio is fetched as a Blob (so prefetching never touches the element)
  and swapped in via object URL. On `ended` the next block starts
  immediately. Keep the next 3 blocks prefetched (fetching triggers server
  synthesis). LRU cache of ~40 blobs in memory.
- Word tracking: `requestAnimationFrame` loop reads `audio.currentTime`,
  binary-searches the block's timings, and updates the active word by
  toggling a class directly on the DOM span (no React re-render per tick).
  Progress saving is debounced (every 5 s while playing, and immediately on
  pause, seek, page hide, and unmount).
- Headings: a short deliberate pause after headings is produced by the
  server (silence padding), not the client.
- Media Session: title/author/artwork, play, pause, seekbackward, seekforward,
  previoustrack / nexttrack (paragraphs).
- iOS: the first `play()` must happen inside the user gesture handler.

## 6. Screens

### Library (`/`)
- Header: "awdio" wordmark, Settings gear.
- Empty state: large dashed drop zone with a short friendly line
  ("Drop a PDF, EPUB, DOCX or text file here") and a button.
- Document cards (responsive grid, 1 col on phones): title, format pill,
  "~2 h 10 m" estimated length, thin progress bar with %, "Continue" /
  "Start listening" primary action, overflow menu (Rename, Prepare audio,
  Delete with confirm).
- Upload shows an inline progress card ("Uploading… / Analysing structure…").

### Reader (`/d/:id`)
- Top bar (translucent, blur): back chevron, truncated title, page indicator
  ("p. 12 / 240"), aA (display settings) button, voice button.
- Reading column: max width 680 px, generous side gutters, 19 px default,
  line-height 1.7, serif reading font (Literata) with a sans option (Inter).
  Pages rendered in one continuous scroll; subtle page dividers with the page
  label. Headings use clear hierarchy. Block kinds styled distinctly but
  quietly (quote: left rule; list item: bullet).
- Current word: rounded accent pill (accent at ~22% opacity, 4 px radius,
  no weight change so nothing shifts). Current block: very light tint.
- Tap a word → seek. Press-and-hold (350 ms) + drag → scrub mode (haptic-ish
  scale on the floating label; preview highlight follows the finger; seek on
  release).
- "Back to reading" floating chip appears when the user scrolls the current
  word out of view while playing.
- Player (bottom sheet, always visible, blur backdrop, safe-area aware):
  row 1: timeline scrubber (thick 6 px track, large thumb hit area ≥ 44 px,
  page tick marks every N pages, "Page 12" label and snippet bubble while
  dragging; left: elapsed-ish "34%", right: "~1 h 20 m left").
  row 2: previous paragraph · back 15 s · PLAY/PAUSE (64 px) · forward 15 s
  · next paragraph. Speed chip ("1.25x") on the left, voice chip on the right.
- Large documents: only pages within a window around the current page are
  rendered (see ARCHITECTURE.md "virtualisation").

### Settings sheet (from reader and library)
- Voice: list grouped by engine → accent; tap to select; small play icon to
  preview a fixed sample sentence. ElevenLabs section shows an API key field
  (masked) when not configured, with a link to where to get one, and a
  "Voices are fetched from your account" note once configured.
- Speed slider with snap points; text size slider; font toggle; theme
  segmented control; auto-scroll toggle.

### Access PIN (`/unlock`) — only when `AWDIO_ACCESS_PIN` is set
- Centered card, 4–8 digit PIN input, remembers device with a cookie.

## 7. Visual design tokens (frontend starting point; refine, don't bloat)

- Font: UI — Inter (self-hosted via @fontsource); reading — Literata.
- Colours (light): background #FAFAF8, surface #FFFFFF, text #1A1A1A,
  muted #6B6B6B, hairline #E8E6E1, accent #E8590C (ember), accent-soft
  rgba(232,89,12,0.18). Dark: background #111111, surface #1C1C1E, text
  #F2F2F2, muted #9A9A9A, hairline #2A2A2A. Sepia: background #F5ECD9,
  surface #FBF4E4, text #3B2F1E.
- Radii: 12 px cards, 16 px sheets, 999 px pills. Shadows: soft, low-alpha.
- Motion: 160–220 ms ease-out; respect `prefers-reduced-motion`.
- Touch targets ≥ 44 px. Keyboard: Space play/pause, ←/→ 15 s, ↑/↓ paragraph,
  [ ] speed.

## 8. Quality bar / acceptance

- Upload a 300-page PDF, a DOCX, an EPUB, a TXT and a MD file; each shows a
  sensible title, headings and paragraphs; no text duplicated or lost (spot
  check), page labels correct for the PDF.
- Press play within 3 seconds of opening a fresh document on a 4-core CPU
  (first paragraph synthesised on demand while the rest prefetches).
- Word highlight never drifts more than ~1 word from what is heard.
- Scrub the timeline to page 200, release: audio starts at that page's first
  word within 2 s; page indicator and scroll position match.
- Close the tab mid-paragraph; reopen; "Continue" resumes within the same
  sentence with the same voice and speed.
- Lighthouse-ish sanity: no layout shift on highlight; 60 fps scrolling.
- Works on iOS Safari and Android Chrome (touch) and desktop Chrome/Safari.
