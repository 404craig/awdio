# awdio server

FastAPI service that turns uploaded documents into structured text (pages → blocks → words) and reads them
aloud with word-level timings. It implements the contract in [`../docs/API.md`](../docs/API.md) and serves the
built web app (`../web/dist`) from `/` in production.

## Setup and run

Requires Python ≥ 3.11 and [uv](https://docs.astral.sh/uv/). `ffmpeg` is optional (MP3 cache, ElevenLabs padding).

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
| `ELEVENLABS_API_KEY` | unset | seeds the ElevenLabs key on first start (it can also be set in Settings) |
| `AWDIO_WEB_DIST` | `../web/dist` | where the built frontend lives |
| `AWDIO_HOST` / `AWDIO_PORT` | `127.0.0.1` / `8000` | used by `python -m awdio` |

## How the pieces fit

```
awdio/
  main.py          create_app(): routers, PIN middleware, gzip, CORS (localhost:5173), static SPA; lifespan builds Services
  services.py      the long-lived objects (db, settings, library, engines, cache, worker, prepare, PIN gate)
  config.py db.py  env config; sqlite (WAL) tables documents/progress/settings/synth_stats/audio_cache
  library.py       uploads → parser → data/docs/<id>/document.json (+ small in-memory LRU)
  settings.py      user settings with defaults; the ElevenLabs key is stored here, never returned or logged
  auth.py          optional PIN: HMAC session cookie (180 days), 5 wrong attempts → 60 s lockout
  api/             health, auth (config/unlock), documents, audio (+ prepare), voices, settings, static
  parsing/         pdf (PyMuPDF), epub (ebooklib+bs4), docx (python-docx), text (txt+md);
                   structure.py: normalisation, hyphenation repair, heading fallback, titles, paging
  tts/             base.py engine protocol; kokoro_engine.py (local), elevenlabs_engine.py (cloud);
                   alignment.py tokens/characters → word timings; worker.py single synthesis thread with
                   priorities (warm > on-demand > prefetch > prepare); service.py cache-or-synthesise;
                   cache.py <key>.wav|mp3 + <key>.json; prepare.py whole-document background jobs
```

Synthesis is per block. A block's audio is cached under `sha1(engine|voice|doc|block|text)[:24]`, padded with
0.5 s of silence after titles/headings and 0.15 s after other blocks. Word timings always have exactly one
`[start, end]` per `text.split(" ")` word, monotonic and within the audio duration: engine timestamps are mapped
onto words by character offsets, and words without timestamps are interpolated by character length.
`estimatedSeconds` uses the measured seconds-per-word of synthesised blocks (default 0.38).

Optional query parameter beyond the contract: `GET …/blocks/{i}/audio?prefetch=true` queues the request at
prefetch priority, so a user's on-demand request (e.g. after a seek) is served before background prefetches.

Nothing here logs document text or API keys; Kokoro's own logger is disabled for that reason.
