# awdio

Listen to your own documents on your iPhone, read aloud by the phone's own
voices, with the text following along word by word. No server, no account,
nothing to pay for.

- Add a PDF, EPUB, DOCX, TXT or Markdown file. awdio works out titles,
  paragraphs and pages on the phone. It never judges or summarises the
  content; it only lays it out.
- Play, pause, skip 15 s, jump paragraphs, change speed, pick a voice.
- Drag the timeline to any page; tap any word to start there; press and hold
  on the text and drag to scrub word by word.
- The word being spoken is highlighted and the page scrolls with the reading.
- Your place is saved per document and picked up when you come back.

## Use it on your iPhone

1. Open the site in **Safari** (for this repository:
   `https://<your-github-user>.github.io/awdio/`).
2. Tap **Share**, then **Add to Home Screen**. Open awdio from the Home Screen:
   it runs full screen, works offline and shows controls on the lock screen.
3. Tap **Choose a file** and pick a document from Files or iCloud Drive.
4. Tap **Start listening**.

To try it without a document of your own, open the site with `?demo=1` at the
end of the address: three public-domain samples are added to your library.

### Get a better voice (free)

Want a more natural voice? It's free. On your iPhone: Settings →
Accessibility → Spoken Content → Voices → English → download an Enhanced or
Premium voice (for example Serena, Jamie or Daniel). awdio will use it
automatically. You can still choose any installed voice in awdio's settings.

## Privacy

Your documents never leave the phone. The file is read and analysed in the
browser, and the document, your place in it and your settings are stored in
the browser's storage on this device (details in [docs/DATA.md](docs/DATA.md)).
Speech uses the voices installed on the phone. The site is static: after it
has loaded once there is nothing to talk to. Deleting a document in awdio
removes it from the phone; clearing Safari's website data removes everything.

## Offline

After the first visit the app is cached by a service worker: it opens, plays
your documents and adds new ones without a connection. A new version is
picked up automatically the next time it starts online.

## Deploy your own copy (GitHub Pages)

1. Push this repository to GitHub (the workflow builds on pushes to `main`,
   `master` or `claude/awdio-build`).
2. One time only: in the repository on GitHub go to **Settings → Pages →
   Build and deployment → Source: GitHub Actions**.
3. The **Deploy to GitHub Pages** workflow (`.github/workflows/pages.yml`)
   tests, builds with `BASE_PATH=/awdio/` and publishes `web/dist`. If you
   rename the repository, change `BASE_PATH` in the workflow to match.

## Local development

Requirements: Node 20+.

```bash
make setup      # npm install in web/
make dev        # http://localhost:5173  (add ?demo=1 for sample documents)
make test       # typecheck + unit tests
make build      # production build in web/dist
make preview    # serve the production build on http://localhost:4173
```

Desktop browsers have their own voices, so the app is usable on a laptop for
development; use the browser's device toolbar at iPhone size. Add
`?fakeSpeech=1` to use a simulated voice (what the automated checks use).
More in [web/README.md](web/README.md).

## Layout

- `web/` the app (React + TypeScript + Vite PWA).
- `docs/` [specification](docs/SPEC.md), [architecture](docs/ARCHITECTURE.md),
  [data](docs/DATA.md), [decisions](docs/DECISIONS.md), brand assets.
