import { create } from "zustand";
import { speech } from "../audio/instance";
import type { BufferingReason } from "../audio/speech";
import { positionToOrdinal, type Position } from "../audio/timeline";
import { buildDocIndex, charsBefore, type DocIndex } from "../lib/docIndex";
import { nextCycleSpeed, stepSpeed } from "../lib/format";
import type { Document, Progress } from "../types";
import { useSettings } from "./settings";
import { useUi } from "./ui";
import { activeVoice, platformVoice, useVoices } from "./voices";

interface ReaderState {
  index: DocIndex | null;
  position: Position;
  playing: boolean;
  buffering: BufferingReason | null;
  /** Auto-scroll follows playback. Any user scroll detaches. */
  attached: boolean;
  /** Timeline drag target as a global word ordinal. */
  scrub: { ordinal: number } | null;
  /** Press-and-hold scrub inside the text: finger position and target page. */
  textScrub: { x: number; y: number; page: number } | null;
  /** Page currently in view (drives the top-bar indicator and the render window). */
  viewPage: number;
  /** Where the active word is relative to the viewport while detached. */
  activeOffscreen: "above" | "below" | null;
  /** Increments on every user seek, so progress can be saved immediately. */
  seekSeq: number;
}

const initial: ReaderState = {
  index: null,
  position: { blockIndex: 0, wordIndex: 0 },
  playing: false,
  buffering: null,
  attached: true,
  scrub: null,
  textScrub: null,
  viewPage: 0,
  activeOffscreen: null,
  seekSeq: 0,
};

export const useReader = create<ReaderState>(() => initial);

const set = useReader.setState;
const get = useReader.getState;

export const selectOrdinal = (s: ReaderState) => (s.index ? positionToOrdinal(s.index.blocks, s.position) : 0);
export const selectPlaybackPage = (s: ReaderState) => (s.index ? s.index.pageOfBlock[s.position.blockIndex] : 0);

const currentPlatformVoice = () => platformVoice(activeVoice()?.id);

/** Opens a document in the reader and wires the speech engine to the store. Returns the teardown. */
export function openReader(doc: Document, progress: Progress | null, opts: { restart?: boolean } = {}): () => void {
  const index = buildDocIndex(doc);
  const start: Position =
    progress && !opts.restart
      ? { blockIndex: Math.min(progress.blockIndex, index.blocks.length - 1), wordIndex: progress.wordIndex }
      : { blockIndex: 0, wordIndex: 0 };
  set({ ...initial, index, position: start, viewPage: index.pageOfBlock[start.blockIndex] });

  const offs = [
    speech.on("position", (position) => set({ position })),
    speech.on("state", ({ playing }) => set({ playing })),
    speech.on("buffering", ({ reason }) => set({ buffering: reason })),
    speech.on("finished", () => useUi.getState().showToast("Finished. Nicely done.")),
    speech.on("error", (e) => useUi.getState().showToast(e.message, "error")),
    useSettings.subscribe((s, prev) => {
      if (s.settings.speed !== prev.settings.speed) speech.setRate(s.settings.speed);
      if (s.settings.voiceURI !== prev.settings.voiceURI) speech.setVoice(currentPlatformVoice());
    }),
    // A newly installed (better) voice takes over unless the user picked one explicitly.
    useVoices.subscribe((s, prev) => {
      if (s.voices !== prev.voices) speech.setVoice(currentPlatformVoice());
    }),
  ];

  speech.load(
    { title: doc.title, blocks: index.blocks },
    { start, rate: useSettings.getState().settings.speed, voice: currentPlatformVoice() },
  );

  return () => {
    offs.forEach((off) => off());
    speech.unload();
    set(initial);
  };
}

const markSeek = () => set({ attached: true, seekSeq: get().seekSeq + 1 });

/** Why playback can't start on this device, or null when it can. */
function unavailableReason(): string | null {
  const { status, voices } = useVoices.getState();
  if (status === "unsupported") return "This browser can't read aloud. Try Safari on iPhone.";
  if (status === "ready" && voices.length === 0) return "No voices available on this device.";
  return null;
}

export const player = {
  /** Play/pause. Speaks synchronously inside the tap, as iOS requires. */
  toggle() {
    if (speech.playing) return speech.pause();
    useVoices.getState().refresh();
    const reason = unavailableReason();
    if (reason) return useUi.getState().showToast(reason, "error");
    speech.setVoice(currentPlatformVoice());
    speech.play();
  },
  /** Seek to a word. `play` starts playback (called inside the gesture for iOS). */
  seekTo(pos: Position, opts: { play?: boolean } = {}) {
    set({ attached: true });
    speech.seek(pos.blockIndex, pos.wordIndex);
    if (opts.play && !speech.playing && !unavailableReason()) speech.play();
    markSeek();
  },
  skip(seconds: number) {
    set({ attached: true });
    speech.skip(seconds);
    markSeek();
  },
  next() {
    set({ attached: true });
    speech.nextBlock();
    markSeek();
  },
  prev() {
    set({ attached: true });
    speech.prevBlock();
    markSeek();
  },
  cycleSpeed() {
    const { settings, update } = useSettings.getState();
    void update({ speed: nextCycleSpeed(settings.speed) });
  },
  stepSpeed(dir: 1 | -1) {
    const { settings, update } = useSettings.getState();
    void update({ speed: stepSpeed(settings.speed, dir) });
  },
  /** Estimated listening time from `ordinal` to the end at the current speed. */
  secondsLeft(index: DocIndex, ordinal: number, speed: number): number {
    return (index.totalChars - charsBefore(index, ordinal)) / (speech.charsPerSecond() * speed);
  },
  pause: () => speech.pause(),
};
