# Decisions

## D1 — Text-to-speech: source the voice model, don't write one

Writing a state-of-the-art neural TTS model from scratch is not achievable in
this project (it requires large curated speech corpora, weeks of GPU training
and a research team to reach "human-like with proper emphasis"). awdio
therefore *integrates* voice models through a small engine interface and ships
one engine:

| Engine | Where it runs | Cost | Quality | Word timestamps | Privacy |
|---|---|---|---|---|---|
| Kokoro-82M (`kokoro`) | locally, CPU | free, Apache-2.0 | very natural for its size; top of open-weights TTS leaderboards among small models; ~24 kHz | yes, native (duration predictor) | text never leaves the machine |

**Free-only (user decision).** An optional ElevenLabs cloud engine (user's own
API key, `/with-timestamps` alignment) was built first and then removed: the
user chose to keep awdio free and fully local, so nothing ever costs money or
leaves the machine. The engine interface and registry stay, so another *local*
engine can be added later; the API keeps `engine`/`voiceId` (currently always
`kokoro`). British Kokoro voices are listed first because the user is in the
UK; `af_heart` stays the default as the highest-graded voice.

Considered and rejected:
- Browser Web Speech API: robotic, voice set depends on OS, word-boundary
  events unreliable across browsers (none on iOS). Fails the quality bar.
- Piper: fast and offline but noticeably synthetic; no timestamps.
- Chatterbox / Orpheus / XTTS / F5-TTS / Dia: expressive open models, but they
  need a GPU for anything near real time and emit no timestamps, so word
  sync would require a separate forced-alignment pass (whisper-timestamped
  or similar). Too heavy for a personal CPU box; good v2 candidates behind
  the same engine interface.
- Cloud voices (ElevenLabs, OpenAI `gpt-4o-mini-tts`, Azure Neural, Google
  Chirp): excellent, but paid and they send the text to a third party. Out of
  scope since awdio is free-only (see above).

The engine interface (`server/awdio/tts/base.py`) is deliberately tiny so a
local engine from the list above can be added later.

## D2 — No login; guest access only (optional access PIN)

Progress is stored server-side in SQLite keyed by document. Because awdio is
single-user and self-hosted, that already gives "pick up where I left off on
any device" without an account. Per the brief, a login is therefore not
required, so awdio is guest-only. For the case where the user hosts it on a
reachable address, a single optional access PIN (`AWDIO_ACCESS_PIN`) gates the
whole app. It is not an account system.

## D3 — Word-indexed timeline

Scrubbing is defined over word ordinals rather than seconds, so it is exact
before any audio exists and does not change when the voice or speed changes.
Durations are only used for the "time left" estimate.

## D4 — Per-paragraph synthesis with on-disk cache and prefetch

Synthesising per block keeps time-to-first-audio low, makes seeking cheap
(just load that block), gives natural pauses between paragraphs, and lets the
cache be keyed by `(document, engine, voice, block)`. A background "prepare"
job can synthesise the whole document.

## D5 — Structure analysis is heuristic and local

Titles/paragraphs come from format signals (PDF font sizes and spacing, DOCX
styles, EPUB/MD headings). No language model reads the document. This keeps
the "no judgement on the material" promise literally true and keeps content
private.

## D6 — Python backend, React frontend

The only mature path to local TTS with native word timestamps is the Python
`kokoro` package, so the backend is Python (FastAPI). Document parsing
libraries are also strongest in Python (PyMuPDF, python-docx, ebooklib). The
frontend is React + TypeScript for a polished, touch-first UI. The server
serves the built frontend so the app runs as one process.
