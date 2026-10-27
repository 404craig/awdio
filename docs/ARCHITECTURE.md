# Architecture

awdio is a static web app. Everything that matters (parsing, storage, speech)
runs in the phone's browser; GitHub Pages only serves the files once, after
which the service worker serves them offline.

```
awdio/
  web/                         Vite + React 18 + TypeScript (strict) + Tailwind v3, zustand, react-router
    index.html                 iOS meta tags; applies the mirrored theme before first paint
    vite.config.ts             base = $BASE_PATH (default "/"), vite-plugin-pwa (manifest + Workbox precache), 404.html SPA fallback
    public/
      icons/, brand/           PWA icons, wordmark and wave mark
      demo/                    public-domain sample texts for ?demo=1 (not precached)
    src/
      types.ts                 Document / Page / Block / Progress / Settings (docs/DATA.md)
      parsing/                 format parsers, structure.ts (normalising, paging), worker.ts + client.ts + protocol.ts
      data/db.ts               IndexedDB via idb: documents, structures, progress, settings
      audio/
        speech.ts              SpeechEngine (Web Speech API, sentences, word tracking, lock screen hooks)
        sentences.ts           sentence splitting as word ranges
        estimator.ts           speaking-rate estimator (chars/s per voice) + charIndex → word mapping
        voices.ts              describe / rank / group system voices, default choice
        timeline.ts            pure word-ordinal and character-position maths
        lockScreen.ts          Media Session + silent keep-alive <audio>
        silence.ts             silent WAV data URL generator
        fakeSpeech.ts          fake speechSynthesis for tests, perf, screenshots, e2e (?fakeSpeech=1)
        instance.ts            the app's single engine, wired to the browser
      state/                   zustand stores: settings, voices, library, reader (+ player actions), ui
      components/, screens/, hooks/, lib/, styles/
      demo/seed.ts             ?demo=1: three sample documents into IndexedDB
    scripts/                   harness.mjs (preview server + phone Chromium), perf.mjs, screenshots.mjs, icons.mjs
    e2e/on-device.mjs          end-to-end test (npm run e2e)
  .github/workflows/pages.yml  build with BASE_PATH=/awdio/ and deploy to GitHub Pages
  docs/                        SPEC, ARCHITECTURE, DATA, DECISIONS, brand/
```

## Adding a document

1. The library's file input (or a drop) gives a `File`. Files over 50 MB are
   refused before reading.
2. `parsing/client.ts` reads it as an `ArrayBuffer` ("Reading file…") and
   transfers it to a fresh module Web Worker (`parsing/worker.ts`), so even a
   300-page PDF never blocks the UI. The worker posts progress ("Analysing
   structure…", with a fraction for PDFs and EPUBs) and finally the
   `StructuredDocument`, or a typed error (`unsupported`, `no_text`,
   `parse_error`, `too_large`) shown in the upload card. The worker is
   terminated afterwards.
3. Format parsers are loaded on demand inside the worker:
   - PDF: pdf.js (legacy build). pdf.js cannot spawn its own worker from inside
     ours, and its fallback would load the pdf.js worker into our scope and
     take over `self.onmessage`, so `pdf.ts` hands it an explicit nested
     worker (`GlobalWorkerOptions.workerPort`). Text items → visual lines →
     `pdfLayout.ts` heuristics.
   - EPUB: JSZip + htmlparser2, spine order.
   - DOCX: mammoth (browser bundle) → HTML → the shared HTML walker.
   - TXT / Markdown: own parsers.
4. `structure.finalize()` normalises text, repairs hyphenation, drops empty
   blocks, assigns global block indices and `wordStart`, builds pages and
   picks the title (metadata, then the title block, then the file name).
5. The library store gives it a uuid and timestamps and writes it to IndexedDB
   (`documents` + `structures` in one transaction), then asks for persistent
   storage (`navigator.storage.persist()`), which stops the browser from
   evicting it under storage pressure where supported.

### Structure heuristics (`parsing/`)
Shared
- Normalise: NFC, collapse whitespace, strip control characters, join
  line-end hyphenation ("exam-\nple" → "example") only when both sides are
  lowercase letters.
- Heading fallback (TXT and PDFs without font cues): ≤ 12 words, no terminal
  period, and `chapter|part|book|section|prologue|epilogue|appendix …` or
  ALL CAPS / Title Case surrounded by blank lines.
- Pages: PDF → real pages with printed labels where the PDF has them. Others →
  ≥ 450 words per page, never splitting a block; a title or level 1–2 heading
  starts a new page when the current one holds > 150 words. Labels
  "Ch. 3 · 2" when the document has chapters, else 1-based numbers.

PDF
- Body size = character-weighted mode of font sizes; headings ≥ 1.15 × body
  (level by size rank, max 3) or short bold lines on their own.
- Running headers/footers (same text near the same y on ≥ 40 % of pages and
  ≥ 3 pages) and bare page numbers are dropped.
- Lines → paragraphs on vertical gaps, indents after sentence ends, or size
  changes. Two-column pages are read column by column. Bullets → list items.

EPUB / DOCX
- h1–h6 → headings; p/li/blockquote → paragraph/list item/quote; DOCX styles
  Title / Heading N / List / Quote via mammoth's mapping; tables cell by cell.

Markdown
- ATX and setext headings, `>` quotes, lists; inline markup stripped (links
  keep their text).

## Storage (`data/db.ts`)

See docs/DATA.md for the schema. The library loads only `documents` and
`progress` (small); `structures` are read when a document is opened. Settings
are written to IndexedDB and mirrored to `localStorage["awdio.settings"]`,
which `index.html` reads synchronously so the theme, font and text size are
right on the first frame.

## Speech (`audio/speech.ts`)

`SpeechEngine` is plain TypeScript with injected platform pieces
(`synth()`, `createUtterance()`, the estimator, a `LockScreen`, a clock), so it
is unit-tested with `FakeSpeechSynthesis` and fake timers.

Public interface (consumed by `state/reader.ts`, unchanged from the old audio
engine): events `position`, `state`, `blockchange`, `buffering`, `finished`,
`error`; methods `load`, `unload`, `play`, `pause`, `toggle`, `seek`, `skip`,
`nextBlock`, `prevBlock`, `setRate`, `setVoice`, `previewVoice`,
`stopPreview`, `resync`, `charsPerSecond`.

- Speaking: `speakFrom(block, word)` finds the sentence containing `word`
  (`sentences.ts`), speaks `words[word … sentenceEnd]` as one utterance with
  the voice, its `lang` and `rate`, and keeps the utterance in `active` (a
  strong reference: Safari and Chrome may otherwise collect it and never fire
  `end`). Every handler checks it still belongs to `active`, so events from
  cancelled utterances are ignored; `active` is cleared *before* `cancel()`
  because Chrome fires the cancelled utterance's `error` synchronously.
- `end` → next sentence of the block, or the next block (after 500 ms when the
  block was a title/heading and the page is visible), or `finished`.
  The utterance's measured duration is fed to the estimator.
- Word tracking: `boundary` (name `word`) → `wordAtChar(offsets, charIndex)`.
  Once a voice has sent boundaries, estimates only take over if none arrive
  for 1.2 s. Otherwise a 60 ms ticker estimates forward from the last anchor
  (utterance start or last boundary) with `chars/s × rate`. The highlight
  never moves backwards and never past the sentence being spoken.
- `pause()` cancels speech (iOS `speechSynthesis.pause()` is unreliable) and
  keeps the position; `play()` speaks again from the current word, inside the
  tap. `seek()` while playing = cancel + speak from that word. `setRate()` /
  `setVoice()` while playing restart the sentence at the current word.
- `skip(±s)`: global character position ± `s × chars/s × rate` →
  `blockAtChar` → word. `prevBlock()` restarts the block when more than 2 s in.
- Robustness: no `start` within 4 s → speak again once, then an error.
  `interrupted` / `canceled` errors we did not cause (a phone call, another
  app) pause in place. `not-allowed` → "Tap play to start listening".
  `resync()` (on `visibilitychange` → visible) restarts from the current word
  if speech was dropped while the phone was locked.
- Voice preview speaks a sample sentence with another voice, pausing reading.

### Rate estimator (`audio/estimator.ts`)
Characters per second at 1x per `voiceURI`, a running mean (weight capped at
20 samples) of `chars / seconds / rate` for utterances ≥ 20 characters, with
implausible samples (< 4 or > 60 chars/s) discarded; stored in
`localStorage["awdio.voiceRates"]`. Default 15 chars/s.

### Voices (`audio/voices.ts`, `state/voices.ts`)
`speechSynthesis.getVoices()` is read at start and on every `voiceschanged`
(which iOS also fires after the user installs a voice). Names containing
"Premium"/"Enhanced" rank above standard ones and are labelled "Better
quality"; Apple's novelty voices are hidden. Default: best en-GB, else en-US,
else any English. Settings store `voiceURI: null` for "best available", so a
newly installed better voice is used automatically; an explicit pick sticks
while that voice exists. If no voices appear within 2.5 s the device has none:
the picker shows "No voices available on this device" and play shows a toast.

### Lock screen (`audio/lockScreen.ts`)
In the same tap as the first `speak()`, a looping 2 s silent WAV (generated as
a data URL, nothing to fetch) starts playing in an `<audio>` element, which
gives the page an audio session so iOS shows the Now Playing card and keeps the
page alive when locked. It is paused on pause/finish. Media Session metadata
(document title, awdio, icons) and handlers: play, pause, seekbackward,
seekforward (15 s), previoustrack / nexttrack (paragraphs), seekto; position
state from the estimator.

## Web app

### State
- `settings`: Settings from IndexedDB (mirror for first paint), updated
  optimistically.
- `voices`: the device's voices and a loading/ready/unsupported status.
- `library`: summaries + progress, upload cards, rename/delete.
- `reader` (per open document): `DocIndex`, position `{ blockIndex,
  wordIndex }`, `playing`, `buffering`, `attached` (auto-scroll follows),
  timeline `scrub`, text scrub, view page, seek counter. `player` actions wrap
  the engine and refuse to play (with a toast) when there are no voices.

### Reader rendering & virtualisation
- Each word is a `<span data-b={blockIndex} data-w={wordIndex}>`; a module-level
  map `blockIndex → HTMLElement`; active classes are toggled imperatively
  (`highlight.ts`), so React never re-renders per word. The pill is a
  background plus box-shadow, so nothing reflows.
- Pages outside `[centre − 2, centre + 3]` render as placeholders sized from
  measured heights or `words × measured px-per-word`. The window follows
  playback, or the scroll position once detached, with hysteresis, and
  anchors scroll on the element under the reading line so swaps don't jump.
- Auto-scroll keeps the active word between 25 % and 60 % of the viewport
  (landing at ~35 %). Touch, wheel or scrollbar input detaches; "Back to
  reading" re-attaches.
- Timeline: pointer events on a full-width track; ordinal ↔ position by
  binary search over `wordStart`; the bubble shows the page label and the
  first ~8 words of the target block; release seeks to that block's start.
- Press-and-hold 350 ms within 8 px enters text scrub; the word under the
  finger is previewed with a floating page label; release seeks. A plain tap
  seeks immediately.
- Progress (`hooks/useProgressSaver.ts`) is written to IndexedDB at most every
  5 s while playing and immediately on pause, seek, `visibilitychange` →
  hidden, `pagehide` and unmount.

## PWA and hosting

- `vite-plugin-pwa` (`registerType: "autoUpdate"`, Workbox `generateSW`)
  precaches the HTML, JS (including the parsing worker, pdf.js and its worker,
  mammoth), CSS, fonts, icons and the manifest (~3 MB). Navigation falls back
  to `index.html`, so deep links work offline. A new deploy is picked up on
  the next launch.
- Manifest: `display: standalone`, portrait, brand colours, the existing
  icons (any + maskable), `scope`/`start_url` = the base path. `index.html`
  carries `apple-mobile-web-app-*` tags, `apple-touch-icon` and `viewport-fit
  = cover`; the layout uses safe-area insets.
- `base` = `$BASE_PATH` (default `/`); the router basename and asset/demo URLs
  derive from `import.meta.env.BASE_URL`. The build copies `index.html` to
  `404.html`, which GitHub Pages serves for deep links on first load.
- `.github/workflows/pages.yml`: on push to `main`, `master` or
  `claude/awdio-build`, `npm ci`, `npm test`, build with `BASE_PATH=/awdio/`,
  then `configure-pages` → `upload-pages-artifact` → `deploy-pages`.

## Testing

- Unit (Vitest, Node): parsers with fixtures generated at test time (pdf-lib,
  docx, JSZip), structure, sentences, estimator and boundary mapping, voices,
  timeline maths, IndexedDB layer (fake-indexeddb), and the speech engine
  against `FakeSpeechSynthesis` with fake timers (sentence chaining, block
  transitions, heading pause, seek/skip, pause/resume, rate changes, missing
  voice, resync, preview).
- `scripts/harness.mjs` serves the production build (`vite preview`) and
  drives Chromium at 393 × 852 with an iPhone user agent.
  `npm run perf` (budgets on the 26k-word demo book), `npm run screenshots`,
  `npm run e2e` (upload a generated PDF through the UI → play → cross blocks →
  scrub → reload → resume; then without the fake: zero voices, no errors).
- Not verifiable here: real iOS voices, `boundary` timing on iOS, lock-screen
  behaviour, Add to Home Screen. See the README's checklist.
