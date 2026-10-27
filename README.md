# awdio

Listen to your own documents, read aloud by a natural neural voice, with the
text following along word by word. Personal, self-hosted, no accounts.

- Upload PDF, EPUB, DOCX, TXT or Markdown. awdio works out titles, paragraphs
  and pages. It never judges or summarises the content; it only lays it out.
- Play, pause, skip, change speed (pitch preserved), pick a voice.
- Drag the timeline with a finger to any page; tap any word to start there;
  press-and-hold on the text and drag to scrub word by word.
- The screen highlights the word being spoken and scrolls with the reading.
- Progress is saved per document and resumes on any device that opens awdio.

## Voices

awdio is free and fully local: voices come from Kokoro-82M (open weights,
Apache-2.0), running on your machine's CPU with native word timestamps. Your
text never leaves the machine and nothing costs money. British voices are
listed first; the default is Heart (`af_heart`), the highest-graded voice.
Why Kokoro and not others is in `docs/DECISIONS.md`.

## Run it

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
make setup      # installs server and web dependencies
make dev        # API on http://localhost:8000, UI on http://localhost:5173
```

Production (single process, serves the built UI):

```bash
make run        # builds web/dist, then serves everything on http://localhost:8000
```

The first start downloads the Kokoro weights (about 330 MB) into the
Hugging Face cache; the UI shows "Preparing voice…" until the model is loaded.

Optional environment variables are listed in `.env.example`. Setting
`AWDIO_ACCESS_PIN` puts a single PIN screen in front of the app for when you
host it somewhere reachable.

Docker:

```bash
docker build -t awdio . && docker run -p 8000:8000 -v awdio-data:/data awdio
```

## Layout

- `server/` FastAPI service: parsing, structure analysis, TTS, cache, SQLite.
- `web/` React + TypeScript app.
- `docs/` specification (`SPEC.md`), API contract (`API.md`), architecture and decisions.
