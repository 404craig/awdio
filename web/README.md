# awdio · web

React 18 + TypeScript (strict) + Tailwind v3 progressive web app. Everything runs on the
phone: parsing in a Web Worker, storage in IndexedDB, speech with the Web Speech API. No
server, no API. Designed for the iPhone (393 × 852); larger screens must just not break.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite on :5173 |
| `npm run build` | Typecheck, then build to `dist/` (`BASE_PATH=/awdio/` for GitHub Pages) |
| `npm run preview` | Serve the built `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: parsers, structure, sentences, estimator, voices, timeline, IndexedDB layer, speech engine |
| `npm run perf` | Build, then Playwright budget checks on the 26k-word demo book at phone size |
| `npm run screenshots` | Build, then phone screenshots of the key screens → `screenshots/` |
| `npm run e2e` | Build, then `e2e/on-device.mjs`: upload a PDF through the UI, play, scrub, reload, resume; zero-voices check |
| `npm run icons` | Regenerate the PWA icons in `public/icons/` |

The Playwright scripts use the globally installed `playwright` package and its Chromium.

URL switches (work in dev and in production):

- `?demo=1` adds three public-domain sample documents (`public/demo/`) to IndexedDB.
- `?fakeSpeech=1` replaces `speechSynthesis` with `src/audio/fakeSpeech.ts`, which "speaks" by
  timing characters and sends word boundaries. Options: `fakeCps=40` (characters per second),
  `fakeBoundaries=0` (no boundary events, to exercise the estimator), `fakeVoices=standard`
  (no Enhanced/Premium voices, shows the voice tip) or `fakeVoices=none`. Scripts can set
  `window.__awdioFakeSpeech = { … }` before load instead.

## Brand

Tokens follow docs/SPEC.md §7: CSS variables per `data-theme` (light / dark / sepia) in
`src/styles/index.css`, mapped to Tailwind colours. Outfit is the UI font; Literata (serif) and
Inter (sans) are for reading text. Electric Blue (`accent`) is only used for live states: the playing
play button, timeline/progress fills, the current-word pill, toggles, focus and selection. Icons
are generated from `public/brand/mark.svg` by `npm run icons`.

## Structure

```
src/
  types.ts      the on-device data model (docs/DATA.md)
  parsing/      pdf/epub/docx/html/text/markdown parsers, structure.ts, worker.ts + client.ts (Web Worker), testing/fixtures.ts
  data/         db.ts: IndexedDB (documents, structures, progress, settings), persistent storage
  audio/        speech.ts (SpeechEngine), sentences.ts, estimator.ts, voices.ts, timeline.ts, lockScreen.ts,
                silence.ts, fakeSpeech.ts, instance.ts (the app's engine)
  state/        zustand stores: settings, voices, library, reader (+ player actions), ui (sheet, toast)
  lib/          docIndex.ts (flat lookups over a document), format.ts
  hooks/        theme, progress saving, listening time, keyboard shortcuts, focus trap, media queries
  components/   brand/, reader/ (column, pages, player, timeline, top bar, overlays, voice tip banner),
                library/, settings/ (sheet, voice picker), tips/ (voice tip, Add to Home Screen), shared primitives
  screens/      Library, Reader
  demo/         seed.ts (?demo=1)
scripts/        harness.mjs (preview server + phone Chromium), perf, screenshots, icons
e2e/            on-device.mjs
```

## How speech and follow-along work

**SpeechEngine** (`src/audio/speech.ts`) speaks one `SpeechSynthesisUtterance` per sentence
(`sentences.ts`) with the chosen voice, its language and `rate` = speed, and starts the next
from `end`; titles and headings are followed by ~500 ms of silence. It keeps a reference to the
active utterance and ignores events from cancelled ones. The spoken word comes from `boundary`
events (`charIndex` → word via `estimator.ts`) when the voice sends them; otherwise a measured
characters-per-second estimate animates the highlight. It never moves backwards and never past
the sentence. Pause cancels speech and keeps the word; play, seek, speed and voice changes
speak again from the current word. ±15 s skips convert seconds to characters with the
estimator. The first `speak()` runs inside the play tap (iOS), together with a looping silent
`<audio>` and Media Session metadata/handlers for the lock screen (`lockScreen.ts`). When the
app becomes visible again it resumes speech that iOS dropped while locked.

**Voices** (`src/audio/voices.ts`, `src/state/voices.ts`): grouped by language, British English
first, Premium/Enhanced labelled "Better quality". `voiceURI: null` means "best available"
(best en-GB, else en-US), so a newly installed better voice is used automatically; an explicit
pick sticks. No voices → "No voices available on this device".

**Reader** (`src/components/reader/`) renders each word as
`<span data-b={block} data-w={word}>`. The highlight is imperative: `highlight.ts` keeps a map
of block elements and toggles `is-active` / `is-current` classes, so React never re-renders per
word. The pill is a background plus box-shadow, so nothing reflows. Only pages
`[centre − 2, centre + 3]` are rendered; the rest are placeholders sized from measured heights
or `words × measured px-per-word`. The window follows playback (or the scroll position once
detached) with hysteresis, and anchors scroll on the element under the reading line so swaps
don't jump. Auto-scroll keeps the word between 25 % and 60 % of the viewport. Wheel, touch or
scrollbar input detaches it, and "Back to reading" re-attaches. Tap a word to play from it.
Press and hold for 350 ms, then drag, to scrub word by word with a floating page label.

The timeline is word-ordinal based (docs/DECISIONS.md D3). Releasing a drag seeks to the
start of the target block. Progress is saved to IndexedDB at most every 5 s while playing,
and immediately on pause, seek, app hide and unmount.
