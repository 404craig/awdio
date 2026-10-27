# awdio · web

React 18 + TypeScript (strict) + Tailwind v3 single-page app for awdio. Talks to the
server only through the contract in [`docs/API.md`](../docs/API.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite on :5173, proxies `/api` to the real server on :8000 |
| `npm run dev:mock` | Vite with an in-process mock API (no server needed) |
| `npm run build` | Typecheck, then build to `web/dist` (served by the server in production) |
| `npm run preview` | Serve the built `dist` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (timeline maths, LRU, formatting) |
| `npm run screenshots` | Playwright captures of key screens → `screenshots/` (starts its own mock) |
| `npm run perf` | Playwright budget checks on the 25k-word mock book (starts its own mock) |
| `npm run icons` | Regenerates the PWA icons in `public/icons/` |

Mock knobs (`dev:mock` only): `MOCK_PIN=1234` turns on the access PIN, `MOCK_COLD=8` makes
the voice model "load" for 8 s (503 `engine_not_ready`), `MOCK_LATENCY=300` sets the
first-synthesis delay in ms. The mock serves three documents (one ≈ 60 pages / 25k words),
silent WAV block audio whose length is `wordCount × 0.38 s` with even word timings, voices,
settings, progress and a prepare job that advances over time.

## Brand

Tokens follow docs/SPEC.md §7: CSS variables per `data-theme` (light / dark / sepia) in
`src/styles/index.css`, mapped to Tailwind colours. Outfit is the UI font; Literata (serif) and
Inter (sans) are for reading text. Electric Blue (`accent`) is only used for live states: the playing
play button, timeline/progress fills, the current-word pill, toggles, focus and selection. Icons
are generated from `public/brand/mark.svg` by `npm run icons`.

## Structure

```
src/
  api/          types.ts (mirrors docs/API.md), client.ts (fetch + ApiError + 401 locked), index.ts (one function per endpoint)
  audio/        engine.ts (AudioEngine), timeline.ts (pure maths), lru.ts, silence.ts, instance.ts (singleton wiring)
  state/        zustand stores: settings, library, reader (+ player actions), ui (sheet, toast)
  lib/          docIndex.ts (flat lookups over a document), format.ts
  hooks/        theme, progress saving, keyboard shortcuts, focus trap, media queries
  components/   brand/ (inline wordmark + wave mark from public/brand), reader/ (column, pages, player, timeline, top bar, overlays), library/, settings/, shared primitives
  screens/      Library, Reader, Unlock
mock/           Vite middleware implementing the API for development
scripts/        screenshots, perf, icons
```

## How playback and follow-along work

**AudioEngine** (`src/audio/engine.ts`) owns a single `HTMLAudioElement` (`preservesPitch`,
`playbackRate` = speed). Each block's `BlockAudio` JSON and audio file are fetched as a Blob
and swapped in via an object URL, so prefetching never touches the element. On open it
fetches the current block on demand and prefetches the next three one at a time with
`prefetch=true` (lower server priority). Blobs live in a 40-entry LRU. On `ended` the next
block starts immediately. A `requestAnimationFrame` loop reads `currentTime` and
binary-searches the block's timings; it only emits `position` when the word changes.
Skips of ±15 s walk across block boundaries (estimating unsynthesised blocks from the
measured seconds per word). The first `play()` runs inside the user gesture (iOS), priming the
element with a tiny silent clip if audio isn't ready yet. A 503 `engine_not_ready` puts the
engine in a "voice" buffering state, polls `/api/health` and retries. Media Session metadata,
action handlers and position state are kept up to date.

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
start of the target block. Progress is saved at most every 5 s while playing, and
immediately on pause, seek, tab hide and unmount.
