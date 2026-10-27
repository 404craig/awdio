# awdio — product & UX specification

awdio is a personal "listen to your documents" app in the spirit of
Speechify / ElevenReader, without the faff, that lives entirely on the user's
iPhone. Open a link, Add to Home Screen, pick a private document: awdio works
out its structure (titles, paragraphs, pages) and reads it aloud with the
phone's own installed voices while the screen follows along word by word.
Progress is saved per document and resumed later. There is no server, no
account and nothing to pay for.

Design bar: Apple / Airbnb / Shopify. Calm, spacious, obvious. Mobile only:
designed, tested and screenshotted at iPhone size (393 × 852); finger
scrubbing is a core interaction. Larger screens must simply not break.

## 1. Scope

In scope
- Add a document from the phone: PDF, EPUB, DOCX, TXT, Markdown, max 50 MB,
  through the file picker (Files, iCloud Drive, downloads; drag-and-drop where
  the browser supports it).
- Structure analysis on the device: headings, paragraphs, list items, block
  quotes, pages. Purely layout analysis. awdio never summarises, classifies,
  rates, filters or comments on the content of a document. Documents never
  leave the phone: there is no backend to send them to.
- Playback with the system voices (Web Speech API): play / pause, previous /
  next paragraph, skip back / forward 15 s, speed 0.5x–3.0x in 0.25 steps,
  voice selection, resume.
- Follow-along: the current word is highlighted and the current paragraph is
  gently tinted; the view auto-scrolls to keep the current line in view; the
  user can scroll away freely and tap "Back to reading" to re-attach.
- Scrubbing: (a) a document-wide timeline the user drags with a finger; while
  dragging it shows "Page N · 42%" and a snippet, and seeks on release;
  (b) tap any word on the page to start reading from it; (c) press-and-hold
  on the text then drag to scrub word by word (live preview highlight, seek on
  release).
- Progress: saved automatically on the device per document (block, word).
  Library shows % complete and "Continue". Voice and speed are app-wide
  settings, also stored on the device.
- Library: documents on this phone, add (file picker), rename, delete (removes
  the document, its structure and its position), sorted by last opened.
- Settings: voice (grouped by language, British English first, better-quality
  voices labelled, preview), speed, reading font (serif / sans), text size,
  theme (light / dark / sepia, default follows system), follow-along on/off.
- Voice guidance: when only standard-quality voices are installed, a tip in
  Settings and a one-time banner in the reader explain how to download a free
  Enhanced or Premium voice in iOS Settings; awdio switches to it by itself.
- Lock screen / Control Centre controls on iOS (Media Session + a silent
  keep-alive track started inside the play gesture).
- Installable PWA that works offline once loaded: app shell, parsers and
  fonts are precached by a service worker. First-run tip in iPhone Safari:
  "Add awdio to your Home Screen".

Out of scope (deliberately)
- Accounts, sync, sharing. Everything lives in this browser's storage on this
  phone; another device starts with an empty library. (See DECISIONS.md D2.)
- Cloud or self-hosted neural voices (see DECISIONS.md D1).
- OCR of scanned PDFs (v2 candidate).
- Highlighting/notes/bookmarks beyond the auto-saved position (v2 candidate).

## 2. Architecture (summary; details in ARCHITECTURE.md and DATA.md)

A static single-page app (`web/`: Vite + React 18 + TypeScript + Tailwind),
hosted on GitHub Pages, everything else on the phone:

- Parsing: a short-lived Web Worker per file (pdf.js, JSZip + htmlparser2 for
  EPUB, mammoth for DOCX, own TXT/Markdown parsers) → structured document.
- Storage: IndexedDB (`documents`, `structures`, `progress`, `settings`),
  persistent storage requested. Settings are mirrored to localStorage so the
  theme applies before first paint.
- Speech: `SpeechEngine` over `speechSynthesis`, one utterance per sentence,
  word tracking from `boundary` events or a measured speaking-rate estimate.
- Offline: `vite-plugin-pwa` (Workbox) precaches the build; the manifest makes
  it a standalone Home Screen app.

## 3. Document model

A parsed document is pages → blocks; words are derived from block text.

```
DocumentSummary   (IndexedDB "documents"; what the library lists)
  id            string (uuid)
  title         string
  sourceType    "pdf" | "epub" | "docx" | "txt" | "md"
  fileName      string
  wordCount, charCount, blockCount, pageCount   int
  createdAt, lastOpenedAt                       ISO strings (lastOpenedAt may be null)
Structure         (IndexedDB "structures", keyed by document id)
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
  wordCount     int
  wordStart     int         global ordinal of the block's first word
```

Rules
- Block indices are global so a position is "block index + word index".
- Words are `text.split(" ")`. Punctuation stays attached (so "Hello," is one
  word); joining words with single spaces reproduces `text`.
- Pages: PDFs keep their real pages and printed labels. Other formats get
  synthetic pages of roughly 450 words, never splitting a block; a level 1–2
  heading starts a new page when the current page already holds > 150 words.
- The original file is not kept: only the structure is stored.

## 4. Timeline & seeking

The document timeline is word-indexed, not time-indexed: position = global
word ordinal. This is exact for any voice and speed. Durations come from the
speaking-rate estimator: characters per second at 1x, measured per voice from
each utterance's start → end time (default 15 chars/s until measured), divided
by the speed. They drive "~1 h 20 m left", the library's lengths and ±15 s
skips (15 s × rate × speed in characters, across block boundaries).

Seeking to (block b, word w): cancel the current utterance and speak from word
w to the end of the sentence that contains it, then carry on normally.

## 5. Speech engine (client)

- Each block is split into sentences (abbreviations, initials, decimals and
  dotted acronyms never split; very long sentences split at ; and :). One
  `SpeechSynthesisUtterance` per sentence with the chosen voice, its language
  and `rate` = speed; the next is spoken from the previous one's `end`. About
  500 ms of silence after titles and headings (skipped while the app is in
  the background, where timers are throttled).
- Word tracking: `boundary` events (charIndex → word) when the voice sends
  them; otherwise the estimator animates the highlight from the utterance's
  start. The highlight never moves backwards or past the current sentence, and
  snaps to real boundaries when they arrive. The active word is toggled with a
  class directly on the DOM span (no React re-render per word).
- Speed or voice change while speaking: restart the current sentence at the
  current word with the new setting (an utterance's rate is fixed).
- The active utterance is always referenced from the engine (Safari and
  Chrome otherwise garbage-collect it and drop its `end` event). Stale events
  from cancelled utterances are ignored.
- iOS: the first `speak()` runs synchronously inside the play tap, together
  with a silent looping `<audio>` (generated WAV data URL) that keeps the
  audio session alive on the lock screen; it stops on pause. Media Session:
  title, artwork, play, pause, seek backward/forward 15 s, previous/next
  paragraph. On returning to the foreground, if speech was dropped while
  locked, it carries on from the current word.
- Progress saving: at most every 5 s while playing, and immediately on pause,
  seek, app hide and leaving the reader.
- Voices: default = the best en-GB voice (Premium > Enhanced > standard), else
  en-US, else any English. A newly installed better voice is picked up
  automatically unless the user chose a voice explicitly. Zero voices → "No
  voices available on this device", never a crash; the text is still readable.

## 6. Screens

### Library (`/`)
- Header: "awdio" wordmark, Add, Settings gear.
- First run in iPhone Safari (not yet installed): dismissible tip "Add awdio
  to your Home Screen: tap Share, then Add to Home Screen."
- Empty state: large dashed card with a short friendly line ("Choose a PDF,
  EPUB, DOCX or text file") and a button; "Up to 50 MB · Stays on this device".
- Document cards (one column on the phone): title, format pill,
  "~2 h 10 m" estimated length (from the estimator), thin progress bar with %,
  "Continue" / "Start listening" / "Listen again" primary action, overflow
  menu (Rename, Delete with confirm).
- Adding a file shows an inline card ("Reading file…" → "Analysing
  structure…", with a percentage when the parser knows it); errors are shown
  in the card in plain words.

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
- Only standard voices installed: a one-time dismissible banner above the
  player with the voice tip (§1 Voice guidance).
- Player (bottom sheet, always visible, blur backdrop, safe-area aware):
  row 1: timeline scrubber (thick 6 px track, large thumb hit area ≥ 44 px,
  page tick marks every N pages, "Page 12" label and snippet bubble while
  dragging; left: "34%", right: "~1 h 20 m left", or "Starting voice…" when
  the voice takes more than 1.5 s to start).
  row 2: previous paragraph · back 15 s · PLAY/PAUSE (64 px) · forward 15 s
  · next paragraph. Speed chip ("1.25x") on the left, voice chip on the right.
- Large documents: only pages within a window around the current page are
  rendered (see ARCHITECTURE.md "virtualisation").

### Settings sheet (from reader and library)
- Listening: speed slider with snap points; follow-along toggle; voice:
  "Best available" (the default, names the voice in use), then the installed
  voices grouped by language (British English, American English, other
  English, then "Other languages" collapsed); Premium/Enhanced voices are
  labelled "Better quality"; a play icon previews a sample sentence. When only
  standard voices exist the voice tip card is shown above the list:
  "Want a more natural voice? It's free. On your iPhone: Settings →
  Accessibility → Spoken Content → Voices → English → download an Enhanced or
  Premium voice (for example Serena, Jamie or Daniel). awdio will use it
  automatically." No voices: a friendly "No voices available on this device".
- Reading: theme segmented control, font, text size slider with a sample.

## 7. Brand & visual design tokens

Brand (see `docs/brand/moodboard.png` and `docs/brand/wordmark-original.png`):
lowercase geometric wordmark "awdio" whose "w" is a wave; the wave "w" alone is
the app mark. Tagline: "Sound, beautifully simple." Mood: near-black and warm
ivory, brushed silver, one electric blue accent, lots of air, large soft
radii, thin tracking-wide uppercase labels for metadata.

Assets (vectorised from the supplied logo): `web/public/brand/wordmark.svg`
(fill = currentColor, viewBox 2041×409) and `web/public/brand/mark.svg`
(stroke = currentColor wave "w"). Use the wordmark SVG inline for the header
(never set it in a font) and the mark for app icons, favicon, empty states and
the loading state.

- Fonts: UI — Outfit (geometric, echoes the wordmark; self-hosted via
  @fontsource/outfit) for chrome, headings, buttons and labels; reading —
  Literata (serif) with Inter as the sans option. Weights: Light 300, Regular
  400, Medium 500, Semibold 600.
- Colours
  - Near Black `#111214`, Warm Ivory `#F3F1EB`, Brushed Silver `#B8BCC2`,
    Electric Blue `#305CFF`.
  - Light theme: background `#F3F1EB`, surface `#FBFAF7`, surface-2 `#ECEAE3`,
    text `#111214`, muted `#6F7378`, hairline `#DEDCD5`, accent `#305CFF`,
    accent-soft `rgba(48,92,255,0.16)`, on-accent `#F3F1EB`.
  - Dark theme (the brand's primary mood): background `#111214`, surface
    `#1A1B1E`, surface-2 `#232428`, text `#F3F1EB`, muted `#B8BCC2`, hairline
    `#2C2D31`, accent `#305CFF` (use `#4A72FF` for text on dark for contrast),
    accent-soft `rgba(74,114,255,0.22)`.
  - Sepia theme: background `#F1E9D8`, surface `#F8F2E4`, text `#2F2A22`,
    accent stays Electric Blue.
  - Reading highlight: current word pill in accent-soft; current block tint at
    4–5 % of the text colour. Never change font weight on highlight.
- Primary buttons: Near Black on light (ivory text), Warm Ivory on dark
  (near-black text). Electric Blue is reserved for the active/"live" state:
  the play button while playing, the timeline progress, the current-word pill,
  toggles, focus rings, selected items. Progress bars: accent on a silver track.
- Radii: 14 px cards, 20 px sheets, 999 px pills. Shadows: very soft, 1–2 %
  alpha, mostly rely on surface contrast. Hairlines over shadows.
- Metadata labels: 11–12 px uppercase, letter-spacing 0.12em, muted (as on
  the moodboard: "PREMIUM WIRELESS HEADPHONES").
- Motion: 160–220 ms ease-out; respect `prefers-reduced-motion`.
- Touch targets ≥ 44 px. Keyboard: Space play/pause, ←/→ 15 s, ↑/↓ paragraph,
  [ ] speed.

## 8. Quality bar / acceptance (on the phone)

- On an iPhone: open the link in Safari, Add to Home Screen, open it from the
  Home Screen (standalone, brand icon, no browser chrome).
- Add a 300-page PDF, a DOCX, an EPUB, a TXT and a MD file from Files; each
  shows a sensible title, headings and paragraphs; no text duplicated or lost
  (spot check); page labels correct for the PDF. Nothing is uploaded anywhere.
- Tap play: speech starts within a second with the best installed voice; the
  highlight follows the spoken word and never runs ahead of the sentence.
- Scrub the timeline to page 200, release: speech carries on from that page's
  first word; page indicator and scroll position match.
- Lock the phone mid-paragraph: speech continues to the next paragraphs; the
  lock screen shows awdio with play/pause and skip controls.
- Close the app mid-paragraph; reopen; "Continue" resumes at the same word.
- Airplane mode after the first visit: the app opens, existing documents play,
  new documents can be added.
- Install an Enhanced/Premium voice in iOS Settings: awdio uses it next time
  without being told (unless a voice was chosen explicitly).
- No layout shift on highlight; 60 fps scrolling and highlighting at 3x.
- Automated stand-ins (headless Chromium at 393 × 852 with the fake speech
  engine): `npm test`, `npm run perf`, `npm run e2e`, `npm run screenshots`.
