# Decisions

## D1 — Voices: the phone's own system voices (Web Speech API)

**User requirement: no server and no paid services.** awdio must work by
opening a link on an iPhone, with private documents that never leave the
phone. That rules out anything that synthesises speech elsewhere, and on a
phone browser there is no practical way to run a neural TTS model locally. The
only voices that remain are the ones the device already has, through
`speechSynthesis`.

Honest comparison:

| Option | Runs where | Cost | Quality | Word timing | Privacy | Verdict |
|---|---|---|---|---|---|---|
| **System voices (Web Speech API)** | on the phone | free | standard iOS voices are clearly synthetic; the free **Enhanced/Premium** voices (Serena, Jamie, Daniel…) are good, though below the best neural voices | `boundary` events on iOS Safari and most local voices; estimated otherwise | text never leaves the phone | **chosen** |
| Kokoro-82M on a self-hosted server (previous awdio) | user's server, CPU | free, but needs a machine running | very natural for its size | native timestamps | private to the server | needs a server: ruled out |
| Kokoro / Piper in the browser (ONNX + WebAssembly/WebGPU) | on the phone | free | good (Kokoro) / synthetic (Piper) | Kokoro: yes | private | 80–300 MB model download, far slower than real time on iPhone CPUs, memory pressure kills the tab; not viable yet |
| Cloud TTS (ElevenLabs, OpenAI, Azure, Google) | third party | paid per character | excellent | yes (ElevenLabs, Azure) | text sent to a third party | paid and not private: ruled out |

Consequences:
- Quality depends on what is installed. awdio picks the best English voice
  automatically (British first, Premium > Enhanced > standard), and when only
  standard voices exist it says, in Settings and once in the reader, how to
  download a free better voice in iOS Settings → Accessibility → Spoken
  Content → Voices. A newly installed voice is used without any action.
- Word sync is event- or estimate-based rather than exact timestamps; the
  engine speaks one sentence per utterance so drift resets every sentence, and
  the highlight never runs ahead of the sentence being spoken.
- The engine interface (`SpeechEngine`'s injected `synth`/`createUtterance`)
  would let an in-browser neural voice slot in later if phones get fast enough.

## D2 — No login, no accounts, no sync

There is nothing to log in to: no server holds anything. Documents, positions
and settings live in IndexedDB on the phone (docs/DATA.md). The cost is that a
second device starts empty; that is acceptable for a personal reading app and
is the price of "documents never leave the phone". (The old optional access
PIN existed only to protect a self-hosted server and is gone with it.)

## D3 — Word-indexed timeline

Scrubbing is defined over word ordinals rather than seconds, so it is exact for
any voice and speed and needs no audio. Durations come only from the speaking-
rate estimator and are used for "time left", library lengths and ±15 s skips.

## D4 — One utterance per sentence

Speaking a whole block (or document) as one utterance would make seeking,
speed changes and pausing coarse, and long utterances are cut off or stall in
some browsers. Per-sentence utterances keep seeks precise (start at the exact
word), let speed/voice changes apply within a sentence, bound estimate drift,
and give natural pauses. Pause is implemented as cancel + re-speak from the
current word because `speechSynthesis.pause()` is unreliable on iOS.

## D5 — Structure analysis is heuristic and local

Titles/paragraphs come from format signals (PDF font sizes and spacing, DOCX
styles, EPUB/Markdown headings), computed in a Web Worker on the phone. No
language model reads the document. This keeps the "no judgement on the
material" promise literally true and keeps content private.

## D6 — Static PWA on GitHub Pages

A static build is free to host, needs no maintenance and cannot leak anything
because it never receives documents. GitHub Pages serves it over HTTPS (needed
for service workers and `crypto.randomUUID`); the service worker precaches the
app so it opens and works offline after the first visit; Add to Home Screen
gives a full-screen app with lock-screen controls. Deploys run from GitHub
Actions (`.github/workflows/pages.yml`).

## D7 — Mobile only

The user listens on an iPhone, so every screen is designed, tested and
screenshotted at 393 × 852. Larger screens reuse the same layout, centred;
they must not break but are not optimised.
