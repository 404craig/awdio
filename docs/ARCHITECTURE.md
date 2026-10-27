# Architecture

```
awdio/
  server/                 Python 3.11+ (FastAPI, uvicorn), package `awdio`
    awdio/
      main.py             app factory, static serving of ../web/dist, lifespan (warm Kokoro)
      config.py           env: AWDIO_DATA_DIR (default ./data), AWDIO_ACCESS_PIN, AWDIO_AUDIO_FORMAT (wav|mp3), AWDIO_TTS_THREADS, AWDIO_HOST/PORT
      db.py               sqlite3 (stdlib) schema + small repo functions
      api/                routers: documents, audio, voices, settings, auth, health
      parsing/            base.py (ParsedDocument builders), pdf.py, epub.py, docx.py, text.py, structure.py (shared heuristics, paging, tokenisation)
      tts/                base.py (Engine protocol), kokoro_engine.py, cache.py, registry.py, prepare.py (background job), audio_io.py (wav/mp3 writing, silence padding)
    tests/                pytest; fixtures generated at test time (PDF via PyMuPDF, DOCX via python-docx, EPUB via ebooklib) from public-domain text
    pyproject.toml        deps: fastapi, uvicorn[standard], python-multipart, pymupdf, python-docx, ebooklib, beautifulsoup4, lxml, kokoro, soundfile, numpy, httpx
  web/                    Vite + React 18 + TypeScript + Tailwind v3, zustand, react-router, lucide-react, @fontsource/inter, @fontsource/literata
    src/
      api/                typed client for docs/API.md
      audio/              AudioEngine (playback, prefetch, timings, media session)
      state/              zustand stores (library, reader, settings)
      components/, screens/, styles/
  docs/                   this folder
  data/                   runtime (gitignored): uploads/, docs/<id>/document.json, audio/<engine>/<voice>/<docid>/<block>.wav, awdio.sqlite
  Makefile, README.md, Dockerfile
```

## Server

### Request flow
1. Upload → save original to `data/uploads/<id>.<ext>` → parser → `ParsedDocument`
   → `structure.finalize()` (normalise whitespace, repair hyphenation, drop
   empty blocks, assign global block indices and `wordStart`, build pages) →
   write `data/docs/<id>/document.json` → insert row in `documents`.
2. Reader loads `GET /api/documents/{id}` (whole structure, gzip).
3. Player asks for block audio → `tts/cache.get_or_synthesize(doc, block, engine, voice)`.
   Synthesis runs in a single worker thread (the local model is CPU-bound and
   not thread-safe); requests queue with priority: on-demand (user is
   waiting) > prefetch > prepare job. Use a `PriorityQueue` + one worker
   thread; API handlers await a future.
4. Progress writes are tiny UPSERTs.

### Structure heuristics (`parsing/`)
Shared
- Normalise: NFC, collapse whitespace, strip control chars, convert
  line-end hyphenation ("exam-\nple" → "example") only when the joined word is
  lowercase-alphabetic on both sides.
- Tokenise words = `text.split(" ")` after normalisation.
- Heading detection fallback (TXT/MD/PDF without font cues): a line is a
  heading if it is ≤ 12 words, has no terminal period, and matches
  `^(chapter|part|book|section|prologue|epilogue|appendix)\b` (case-insens.)
  or is ALL CAPS / Title Case and surrounded by blank lines.
- Pages: PDF → real pages. Others → accumulate blocks until ≥ 450 words
  (never split a block); a title/level-1/2 heading starts a new page if the
  current page already has > 150 words. Labels: PDF uses the printed page
  number if PyMuPDF exposes labels, else 1-based index; others use
  "<chapter ordinal>.<page-within-chapter>" shown as e.g. "3 · 2", or plain
  1-based numbers when there are no chapters.

PDF (PyMuPDF `page.get_text("dict")`)
- Collect spans with font size, bold flag, bbox, page.
- Body size = mode of span font sizes weighted by character count.
- Running headers/footers: lines whose normalised text appears on ≥ 40 % of
  pages (and ≥ 3 pages) at roughly the same y → drop. Also drop lines that are
  just a page number.
- Lines → paragraphs: start a new block when vertical gap > 0.6 × line height,
  or the previous line ended with sentence punctuation and this line is
  indented, or font size class changes.
- Heading: size ≥ 1.15 × body (level by size rank: largest = 1, next = 2, …,
  max 3), or bold line ≤ 12 words that is its own block. First heading of
  size rank 1 on the first two pages = `title` (also used as the document
  title if PDF metadata has none).
- Two-column detection: if spans cluster into two x-ranges with a clear gap on
  > 50 % of pages, read column by column. (Keep simple; correctness over cleverness.)
- Bullets: lines starting with •, –, -, *, or `\d+[.)]` followed by space → list_item.

EPUB (ebooklib + BeautifulSoup, documents in spine order)
- h1..h6 → heading with level; `<title>` of the package → document title;
  p/li/blockquote → paragraph/list_item/quote; skip nav/toc documents and
  `<script>/<style>`; keep `<br>` as space.

DOCX (python-docx)
- Paragraph style names: Title → title; "Heading N" → heading level N;
  "List …" or numbering → list_item; "Quote"/"Intense Quote" → quote; else
  paragraph. Tables: each cell becomes a paragraph (row by row).

TXT / MD
- MD: ATX headings (#), setext underlines, `>` quotes, `-`/`*`/`1.` lists;
  strip inline markup (`**`, `_`, backticks, links keep their text).
- TXT: paragraphs split on blank lines; single newlines inside a paragraph
  are joined with a space; heading fallback rule above.

### TTS engine interface (`tts/base.py`)
```python
@dataclass
class SynthResult:
    audio: np.ndarray          # float32 mono
    sample_rate: int
    word_timings: list[tuple[float, float]]   # one per word of the input text

class Engine(Protocol):
    id: str
    def ready(self) -> bool: ...
    def voices(self) -> list[Voice]: ...
    def synthesize(self, text: str, voice_id: str, *, context: SynthContext) -> SynthResult: ...
```
`SynthContext` carries `kind` (block kind) and optional `previous_text` /
`next_text` for engines that use them (Kokoro does not).

Kokoro engine
- `KPipeline(lang_code=voice[0] == 'b' and 'b' or 'a', repo_id='hexgrad/Kokoro-82M')`,
  one pipeline per lang code, created lazily in the worker thread; warm the
  default one at startup in a background thread (takes ~10–15 s).
- Call `pipeline(text, voice=voice_id, speed=1.0)`; it may yield several
  results (chunks) — concatenate audio and add the running offset to
  timestamps. Each result has `graphemes` (the chunk text) and `tokens`
  with `.text`, `.whitespace`, `.start_ts`, `.end_ts` (either may be None).
- Map tokens → words by character offsets: locate each chunk's `graphemes`
  in the block text (str.find from the last position; fall back to
  proportional-by-character estimates if it cannot be found), accumulate
  token char spans from `.text` + `.whitespace`, then each word's span
  [start, end) collects the min start_ts / max end_ts of overlapping tokens
  with timings. Words left without timing get linear interpolation between
  their timed neighbours (by character length). Enforce monotonic
  non-overlapping timings; final word ends at audio end.
- Padding: append 0.5 s silence after title/heading blocks, 0.15 s after
  everything else.
- Voices: ship the curated list (id, name, accent, gender, grade) for
  British (bf_*, bm_*, listed first) and American (af_*, am_*) voices from the
  Kokoro VOICES.md. Default `af_heart` (highest grade).
- Weights and voices already in the Hugging Face cache are loaded from disk
  without contacting the Hub (works offline); torch uses cores − 1 threads
  (`AWDIO_TTS_THREADS`) because it slows down sharply when anything else
  needs a core.

### Cache (`tts/cache.py`)
- Key = sha1(f"{engine}|{voice}|{doc_id}|{block_index}|{text}")[:24].
- Files: `data/audio/<key>.<ext>` + `<key>.json` (durationSec, timings).
- Audio format: WAV 16-bit at the engine's sample rate by default; `mp3`
  via ffmpeg when `AWDIO_AUDIO_FORMAT=mp3` and ffmpeg is on PATH.

### DB (sqlite, `data/awdio.sqlite`, WAL mode)
```
documents(id TEXT PK, title, source_type, filename, word_count, block_count, page_count, created_at, last_opened_at)
progress(doc_id TEXT PK REFERENCES documents ON DELETE CASCADE, block_index, word_index, updated_at)
settings(key TEXT PK, value TEXT)          -- json-encoded values (plus the PIN session secret)
synth_stats(engine, voice, seconds REAL, words INTEGER)  -- running totals for the time estimate
```

## Web app

### State
- `settingsStore`: Settings from the server, optimistic updates.
- `libraryStore`: documents list, upload progress.
- `readerStore` (per open document): document, position `{ blockIndex,
  wordIndex }`, `isPlaying`, `isBuffering`, `attached` (auto-scroll
  follows), `scrub` (null | { blockIndex, wordIndex, pageIndex }).

### AudioEngine (`src/audio/engine.ts`)
- Pure TypeScript class, no React. Emits `position`, `state`, `blockchange`,
  `error`.
- `load(doc, engine, voiceId)`, `play()`, `pause()`, `seek(blockIndex,
  wordIndex)`, `setRate(r)`, `skip(seconds)`, `nextBlock()`, `prevBlock()`.
- Fetches `BlockAudio` JSON then the audio file as a Blob; `Map<blockIndex,
  {audio: BlockAudio, blobUrl}>` LRU 40. Prefetch next 3 blocks
  sequentially (one in flight at a time so the server queue stays short).
- On `ended` → load next block, `currentTime = 0`, `play()`. Last block →
  pause and emit `finished`.
- rAF tick: `t = audio.currentTime`; binary search timings for the word whose
  start ≤ t; if changed, emit `position`.
- `skip(±15)`: convert to a target by walking timings across blocks.
- Media Session metadata + action handlers; `navigator.mediaSession.setPositionState`
  per block.

### Reader rendering & virtualisation
- Each word is a `<span data-b={blockIndex} data-w={wordIndex}>`; a module-level
  map `blockIndex → HTMLElement` and `querySelector` by data attrs for the
  active word; active classes toggled imperatively.
- Pages outside the window `[currentPage − 2, currentPage + 3]` render as a
  placeholder `<div style={{height: estimated}}>` where estimated height =
  `wordCount × avgPxPerWord` (measured from rendered pages, default 1.9 px
  per word at 19 px text). This keeps a 1,000-page book smooth. The window
  follows the playback position and also the scroll position (so the user can
  read ahead); hysteresis to avoid thrash.
- Auto-scroll: when attached and the active word's rect leaves the band
  between 25 % and 60 % of the viewport, smooth-scroll so it sits at ~35 %.
  Any user-initiated scroll (wheel/touch) detaches; "Back to reading" chip
  re-attaches.
- Scrubber: pointer events on a full-width track; position ↔ global word
  ordinal; `ordinal → (page, block, word)` via binary search over the
  blocks' `wordStart`. While dragging show the bubble with page label and
  the first ~8 words of the target block.

### Press-and-hold scrub in text
- `pointerdown` on a word starts a 350 ms timer; if the pointer stays within
  8 px, enter scrub mode (prevent native selection via `user-select: none`
  on the column while scrubbing; `touch-action: none` only while scrubbing).
  Moving highlights the word under the pointer (`document.elementFromPoint`)
  and a floating label shows "Page N"; release seeks there. A plain tap
  (< 350 ms) seeks immediately.

## Dev & prod
- `make dev`: runs uvicorn (reload) on :8000 and Vite on :5173 (proxy /api).
- `make build`: `npm run build` → `web/dist`; server serves it at `/` with
  SPA fallback.
- `make run`: production, one process on :8000.
- `Dockerfile`: multi-stage (node build → python runtime with ffmpeg),
  volume at /data.
- First run downloads Kokoro weights (~330 MB) to the Hugging Face cache; the
  health endpoint reports `ready: false` until loaded and the UI shows
  "Preparing voice…" instead of failing.
