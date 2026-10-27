# awdio server

FastAPI service that turns uploaded documents into structured text (pages → blocks → words) and reads them
aloud with word-level timings. It implements the contract in [`../docs/API.md`](../docs/API.md) and serves the
built web app (`../web/dist`) from `/` in production.

## Setup and run

Requires Python ≥ 3.11 and [uv](https://docs.astral.sh/uv/). `ffmpeg` is optional (MP3 cache).

```sh
cd server
uv sync                                                    # installs deps incl. CPU-only torch
uv run uvicorn awdio.main:app --reload --port 8000         # dev (or `make server` from the repo root)
uv run uvicorn awdio.main:app --host 0.0.0.0 --port 8000   # production (or `uv run python -m awdio`)
uv run pytest -q                                           # tests (no model needed)
AWDIO_TEST_KOKORO=1 uv run pytest -q -s tests/test_kokoro_integration.py   # real Kokoro synthesis
```

The first start downloads the Kokoro-82M weights (~330 MB) into the Hugging Face cache; until they are loaded
`GET /api/health` reports `kokoro.ready: false` and block audio returns `503 engine_not_ready`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `AWDIO_DATA_DIR` | `./data` | uploads, parsed documents, audio cache, `awdio.sqlite` |
| `AWDIO_ACCESS_PIN` | unset | 4–8 digits; when set, every `/api/*` route except config/unlock needs the unlock cookie |
| `AWDIO_AUDIO_FORMAT` | `wav` | `wav` (16-bit) or `mp3` (needs ffmpeg; falls back to wav with a warning) |
| `AWDIO_AUTO_PREPARE` | `1` | after an upload, prepare all audio with the saved voice (local engines only; `0` disables) |
| `AWDIO_TTS_THREADS` | cores − 1 (on ≥ 4 cores) | torch threads for Kokoro; one core is left free because torch slows down sharply when another process (e.g. the browser on the same machine) needs a core |
| `AWDIO_WEB_DIST` | `../web/dist` | where the built frontend lives |
| `AWDIO_HOST` / `AWDIO_PORT` | `127.0.0.1` / `8000` | used by `python -m awdio` |

## How the pieces fit

```
awdio/
  main.py          create_app(): routers, PIN middleware, gzip, CORS (localhost:5173), static SPA; lifespan builds Services
  services.py      the long-lived objects (db, settings, library, engines, cache, worker, prepare, PIN gate)
  config.py db.py  env config; sqlite (WAL) tables documents/progress/settings/synth_stats/audio_cache
  library.py       uploads → parser → data/docs/<id>/document.json (+ small in-memory LRU)
  settings.py      user settings with defaults (settings left by the removed cloud engine are dropped on start)
  auth.py          optional PIN: HMAC session cookie (180 days), 5 wrong attempts → 60 s lockout
  api/             health, auth (config/unlock), documents, audio (+ prepare), voices, settings, static
  parsing/         pdf (PyMuPDF), epub (ebooklib+bs4), docx (python-docx), text (txt+md);
                   structure.py: normalisation, hyphenation repair, heading fallback, titles, paging
  tts/             base.py engine protocol; kokoro_engine.py (the one engine; awdio is free-only);
                   alignment.py tokens/characters → word timings; sentences.py sentence splitter; worker.py
                   single synthesis thread with priorities and pre-emption; service.py cache-or-synthesise;
                   cache.py <key>.wav|mp3 + <key>.json; prepare.py whole-document background jobs
```

Synthesis is per block. A block's audio is cached under `sha1(engine|voice|doc|block|text)[:24]`, padded with
0.5 s of silence after titles/headings and 0.15 s after other blocks. Word timings always have exactly one
`[start, end]` per `text.split(" ")` word, monotonic and within the audio duration: engine timestamps are mapped
onto words by character offsets, and words without timestamps are interpolated by character length.
`estimatedSeconds` uses the measured seconds-per-word of synthesised blocks (default 0.38).

### Scheduling, pre-emption and latency

All synthesis runs on one worker thread, by priority: warm-up > on-demand (the listener is waiting) >
prefetch (`?prefetch=true`) > prepare. Kokoro synthesises a block sentence by sentence (a conservative splitter
that keeps "Dr.", "3.50", initials and "U.S." intact and merges fragments under 4 words) and the worker checks
between sentences whether more urgent work is waiting. If it is, the current job is parked, keeping the audio
made so far, the urgent block runs, and the parked job resumes where it stopped. A seek therefore waits for at
most one sentence of someone else's work plus the synthesis of its own block.

Uploads are prepared automatically in document order (cached blocks are skipped) with the saved voice.
Changing the voice starts nothing.

Cold start caveat: Kokoro on a 4-core CPU runs at roughly 0.45x real time (slower when the CPU is busy), and a
block's audio is only returned once the whole block is done, so an uncached 57-word paragraph takes about 8 s.
Titles and headings take about 1 s. Once playback is going, prefetching keeps ahead because synthesis is faster
than real time; auto-prepare hides the rest for freshly uploaded documents.

Optional query parameter beyond the contract: `GET …/blocks/{i}/audio?prefetch=true` queues the request at
prefetch priority, so a user's on-demand request (e.g. after a seek) is served before background prefetches.

Nothing here logs document text; Kokoro's own logger is disabled for that reason.
