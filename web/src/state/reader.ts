import { create } from "zustand";
import type { Document } from "../api";
import type { BufferingReason } from "../audio/engine";
import { engine } from "../audio/instance";
import { positionToOrdinal, type Position } from "../audio/timeline";
import { buildDocIndex, type DocIndex } from "../lib/docIndex";
import { nextCycleSpeed, stepSpeed } from "../lib/format";
import { useSettings } from "./settings";
import { useUi } from "./ui";

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

/** Opens a document in the reader and wires the engine to the store. Returns the teardown. */
export function openReader(doc: Document): () => void {
  const index = buildDocIndex(doc);
  const start: Position = doc.progress
    ? {
        blockIndex: Math.min(doc.progress.blockIndex, index.blocks.length - 1),
        wordIndex: doc.progress.wordIndex,
      }
    : { blockIndex: 0, wordIndex: 0 };
  set({ ...initial, index, position: start, viewPage: index.pageOfBlock[start.blockIndex] });

  const offs = [
    engine.on("position", (position) => set({ position })),
    engine.on("state", ({ playing }) => set({ playing })),
    engine.on("buffering", ({ reason }) => set({ buffering: reason })),
    engine.on("finished", () => useUi.getState().showToast("Finished. Nicely done.")),
    engine.on("error", (e) => useUi.getState().showToast(e.message, "error")),
    useSettings.subscribe((s, prev) => {
      if (s.settings.speed !== prev.settings.speed) engine.setRate(s.settings.speed);
      if (s.settings.engine !== prev.settings.engine || s.settings.voiceId !== prev.settings.voiceId) {
        engine.setVoice({ engine: s.settings.engine, voiceId: s.settings.voiceId });
      }
    }),
  ];

  const { settings } = useSettings.getState();
  engine.load(
    { id: doc.id, title: doc.title, blocks: index.blocks },
    {
      voice: { engine: settings.engine, voiceId: settings.voiceId },
      rate: settings.speed,
      start,
      secondsPerWord: doc.wordCount > 0 ? doc.estimatedSeconds / doc.wordCount : undefined,
    },
  );

  return () => {
    offs.forEach((off) => off());
    engine.unload();
    set(initial);
  };
}

const markSeek = () => set({ attached: true, seekSeq: get().seekSeq + 1 });

export const player = {
  toggle: () => engine.toggle(),
  /** Seek to a word. `play` starts playback (called inside the gesture for iOS). */
  seekTo(pos: Position, opts: { play?: boolean } = {}) {
    set({ attached: true });
    engine.seek(pos.blockIndex, pos.wordIndex);
    if (opts.play && !engine.playing) engine.play();
    markSeek();
  },
  skip(seconds: number) {
    set({ attached: true });
    engine.skip(seconds);
    markSeek();
  },
  next() {
    set({ attached: true });
    engine.nextBlock();
    markSeek();
  },
  prev() {
    set({ attached: true });
    engine.prevBlock();
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
  secondsPerWord: () => engine.secondsPerWord(),
  pause: () => engine.pause(),
};
