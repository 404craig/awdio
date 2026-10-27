/**
 * SpeechEngine: reads a document aloud with the device's own voices (Web Speech API), one
 * utterance per sentence, and reports the spoken word. See docs/ARCHITECTURE.md "Speech".
 * Pure TypeScript, no React; the platform pieces (synthesis, lock screen) are injected.
 */
import type { BlockKind } from "../types";
import { estimatedWordFrom, wordAtChar, wordOffsets, type RateEstimator } from "./estimator";
import { sentenceRanges, type Sentence } from "./sentences";
import { blockAtChar, blockCharStarts, type Position } from "./timeline";

export interface SpeechBlock {
  kind: BlockKind;
  text: string;
}

export interface SpeechDocument {
  title: string;
  blocks: readonly SpeechBlock[];
}

export type SpeechErrorCode = "unsupported" | "no_voice" | "not_allowed" | "failed";

export class SpeechError extends Error {
  constructor(
    readonly code: SpeechErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

export type BufferingReason = "starting";

export interface SpeechEventMap {
  position: Position;
  state: { playing: boolean };
  blockchange: { blockIndex: number };
  buffering: { reason: BufferingReason | null };
  finished: undefined;
  error: SpeechError;
}

export interface LockScreenHandlers {
  play(): void;
  pause(): void;
  skip(seconds: number): void;
  previous(): void;
  next(): void;
  seekTo(seconds: number): void;
}

/** Lock-screen / Control Centre integration (Media Session + a silent keep-alive track). */
export interface LockScreen {
  activate(title: string, handlers: LockScreenHandlers): void;
  deactivate(): void;
  /** Must be called synchronously inside the play gesture on iOS. */
  keepAlive(on: boolean): void;
  setPlaying(playing: boolean): void;
  setPosition(state: { duration: number; position: number; rate: number } | null): void;
}

export interface SpeechDeps {
  /** The platform's synthesiser, or null where the Web Speech API is missing. */
  synth(): SpeechSynthesis | null;
  createUtterance(text: string): SpeechSynthesisUtterance;
  estimator: RateEstimator;
  lockScreen?: LockScreen;
  now?: () => number;
  /** Whether the page is in the background (skips timed pauses, which get throttled there). */
  hidden?: () => boolean;
}

interface BlockInfo {
  words: string[];
  offsets: number[];
  sentences: Sentence[];
}

/** The utterance being spoken. Holding it here also stops Safari/Chrome from garbage-collecting it mid-speech. */
interface Active {
  utterance: SpeechSynthesisUtterance;
  blockIndex: number;
  /** First word of the block the utterance speaks, and the word after its last. */
  firstWord: number;
  endWord: number;
  /** Character offset of each spoken word inside `utterance.text`. */
  offsets: number[];
  startedAt: number | null;
  /** Last real boundary (or the start): estimation runs forward from here. */
  anchorAt: number;
  anchorWord: number;
  retried: boolean;
}

type Listener<T> = (payload: T) => void;
type ListenerSets = { [K in keyof SpeechEventMap]: Set<Listener<SpeechEventMap[K]>> };

const HEADING_PAUSE_MS = 500;
const TICK_MS = 60;
/** With boundary events, estimation only takes over when they stop arriving for this long. */
const BOUNDARY_GRACE_MS = 1200;
/** No `start` after this long: speak again once, then give up with an error. */
const START_TIMEOUT_MS = 4000;
const RESTART_THRESHOLD_SEC = 2;

const noopLockScreen: LockScreen = {
  activate() {},
  deactivate() {},
  keepAlive() {},
  setPlaying() {},
  setPosition() {},
};

const isHeading = (kind: BlockKind) => kind === "title" || kind === "heading";

export class SpeechEngine {
  private readonly listeners: ListenerSets = {
    position: new Set(),
    state: new Set(),
    blockchange: new Set(),
    buffering: new Set(),
    finished: new Set(),
    error: new Set(),
  };
  private readonly lockScreen: LockScreen;
  private readonly now: () => number;
  private doc: SpeechDocument | null = null;
  private infos: (BlockInfo | undefined)[] = [];
  private charStarts: number[] = [];
  private totalChars = 0;
  private pos: Position = { blockIndex: 0, wordIndex: 0 };
  private voice: SpeechSynthesisVoice | null = null;
  private rate = 1;
  private wantPlay = false;
  private finished = false;
  private bufferingReason: BufferingReason | null = null;
  private active: Active | null = null;
  private preview: { utterance: SpeechSynthesisUtterance; onDone: () => void } | null = null;
  /** The current voice has sent word boundaries, so they (not estimates) drive the highlight. */
  private boundaryVoice = false;
  private gapTimer: ReturnType<typeof setTimeout> | undefined;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: SpeechDeps) {
    this.lockScreen = deps.lockScreen ?? noopLockScreen;
    this.now = deps.now ?? (() => performance.now());
  }

  // ---- events -------------------------------------------------------------------

  on<K extends keyof SpeechEventMap>(type: K, fn: Listener<SpeechEventMap[K]>): () => void {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  private emit<K extends keyof SpeechEventMap>(type: K, payload: SpeechEventMap[K]): void {
    this.listeners[type].forEach((fn) => fn(payload));
  }

  // ---- public API -------------------------------------------------------------------

  get position(): Position {
    return this.pos;
  }

  get playing(): boolean {
    return this.wantPlay;
  }

  /** Characters per second at 1x for the current voice (measured, or a default). */
  charsPerSecond(): number {
    return this.deps.estimator.charsPerSecond(this.voiceKey());
  }

  load(doc: SpeechDocument, opts: { start: Position; rate: number; voice: SpeechSynthesisVoice | null }): void {
    this.unload();
    this.doc = doc;
    this.infos = new Array(doc.blocks.length);
    this.charStarts = blockCharStarts(doc.blocks.map((b) => b.text));
    const last = doc.blocks[doc.blocks.length - 1];
    this.totalChars = last ? this.charStarts[this.charStarts.length - 1] + last.text.length : 0;
    this.rate = opts.rate;
    this.setVoice(opts.voice);
    this.setPos(this.clamp(opts.start.blockIndex, opts.start.wordIndex));
    this.lockScreen.activate(doc.title, {
      play: () => this.play(),
      pause: () => this.pause(),
      skip: (seconds) => this.skip(seconds),
      previous: () => this.prevBlock(),
      next: () => this.nextBlock(),
      seekTo: (seconds) => this.seekToTime(seconds),
    });
  }

  unload(): void {
    this.stopPreview();
    this.halt();
    this.setWantPlay(false);
    this.finished = false;
    if (this.doc) this.lockScreen.deactivate();
    this.doc = null;
  }

  /** Starts speaking. Call synchronously inside the user's tap: iOS only allows speech from a gesture. */
  play(): void {
    if (!this.doc) return;
    if (this.finished) {
      this.finished = false;
      this.setPos({ blockIndex: 0, wordIndex: 0 });
    }
    this.stopPreview();
    this.setWantPlay(true);
    this.lockScreen.keepAlive(true);
    this.speakFrom(this.pos.blockIndex, this.pos.wordIndex, true);
  }

  pause(): void {
    this.halt();
    this.setWantPlay(false);
    this.updateLockScreenPosition();
  }

  toggle(): void {
    if (this.wantPlay) this.pause();
    else this.play();
  }

  /** Jumps to a word; speaking continues from exactly that word when playing. */
  seek(blockIndex: number, wordIndex: number): void {
    if (!this.doc) return;
    this.finished = false;
    const target = this.clamp(blockIndex, wordIndex);
    if (this.wantPlay) this.speakFrom(target.blockIndex, target.wordIndex, true);
    else this.setPos(target);
    this.updateLockScreenPosition();
  }

  /** ±seconds of listening at the current speed, converted to characters with the measured rate. */
  skip(seconds: number): void {
    if (!this.doc) return;
    this.seekToChar(this.charAt(this.pos) + seconds * this.charsPerSecond() * this.rate);
  }

  nextBlock(): void {
    if (!this.doc || this.pos.blockIndex >= this.doc.blocks.length - 1) return;
    this.seek(this.pos.blockIndex + 1, 0);
  }

  /** Restarts the paragraph, or goes to the previous one when already near its start. */
  prevBlock(): void {
    if (!this.doc) return;
    const intoBlock = this.info(this.pos.blockIndex).offsets[this.pos.wordIndex] / (this.charsPerSecond() * this.rate);
    const restart = intoBlock > RESTART_THRESHOLD_SEC || this.pos.blockIndex === 0;
    this.seek(restart ? this.pos.blockIndex : this.pos.blockIndex - 1, 0);
  }

  /** Utterance rate is fixed once speaking starts, so a change restarts the sentence at the current word. */
  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    this.restartIfSpeaking();
    this.updateLockScreenPosition();
  }

  setVoice(voice: SpeechSynthesisVoice | null): void {
    if (voice?.voiceURI === this.voice?.voiceURI) {
      this.voice = voice;
      return;
    }
    this.voice = voice;
    this.boundaryVoice = false;
    this.restartIfSpeaking();
  }

  /** Speaks a sample with `voice`; pauses reading first. `onDone` runs when it ends or is stopped. */
  previewVoice(voice: SpeechSynthesisVoice, text: string, onDone: () => void): void {
    const synth = this.deps.synth();
    if (!synth) return onDone();
    if (this.wantPlay) this.pause();
    this.stopPreview();
    const utterance = this.deps.createUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = this.rate;
    const preview = { utterance, onDone };
    const done = () => {
      if (this.preview !== preview) return;
      this.preview = null;
      onDone();
    };
    utterance.onend = done;
    utterance.onerror = done;
    this.preview = preview;
    synth.speak(utterance);
  }

  stopPreview(): void {
    const preview = this.preview;
    if (!preview) return;
    this.preview = null;
    this.deps.synth()?.cancel();
    preview.onDone();
  }

  /**
   * Call when the page becomes visible again. iOS can drop the utterance chain while the
   * phone is locked (an `end` that never arrives); if nothing is speaking, carry on from
   * the current word.
   */
  resync(): void {
    const synth = this.deps.synth();
    if (!this.wantPlay || !synth || this.gapTimer !== undefined) return;
    const active = this.active;
    if (active && active.startedAt !== null && !synth.speaking && !synth.pending) {
      this.speakFrom(this.pos.blockIndex, this.pos.wordIndex, true);
      return;
    }
    this.tick();
  }

  // ---- speaking -------------------------------------------------------------------

  private speakFrom(blockIndex: number, wordIndex: number, interrupt: boolean): void {
    const doc = this.doc;
    if (!doc) return;
    this.clearTimers();
    const synth = this.deps.synth();
    if (!synth) return this.fail(new SpeechError("unsupported", "This browser can't speak text aloud."));
    const voice = this.voice;
    if (!voice) return this.fail(new SpeechError("no_voice", "No voices are available on this device."));
    if (interrupt) this.cancelActive(synth);

    const info = this.info(blockIndex);
    const sentence = info.sentences.find((s) => wordIndex < s.start + s.count) ?? info.sentences[info.sentences.length - 1];
    const endWord = sentence.start + sentence.count;
    const words = info.words.slice(wordIndex, endWord);
    const utterance = this.deps.createUtterance(words.join(" "));
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = this.rate;

    const at = this.now();
    const active: Active = {
      utterance,
      blockIndex,
      firstWord: wordIndex,
      endWord,
      offsets: wordOffsets(words),
      startedAt: null,
      anchorAt: at,
      anchorWord: 0,
      retried: false,
    };
    const current = () => this.active === active;
    utterance.onstart = () => current() && this.onStart(active);
    utterance.onboundary = (e) => current() && this.onBoundary(active, e);
    utterance.onend = () => current() && this.onEnd(active);
    utterance.onerror = (e) => current() && this.onError(e);
    this.active = active;

    this.setPos({ blockIndex, wordIndex });
    this.setBuffering("starting");
    this.startTimer = setTimeout(() => this.onStartTimeout(active), START_TIMEOUT_MS);
    synth.speak(utterance);
  }

  private onStart(active: Active): void {
    clearTimeout(this.startTimer);
    this.startTimer = undefined;
    active.startedAt = active.anchorAt = this.now();
    this.setBuffering(null);
    this.startTick();
    this.updateLockScreenPosition();
  }

  private onBoundary(active: Active, e: SpeechSynthesisEvent): void {
    if (e.name && e.name !== "word") return; // Safari also sends sentence boundaries
    if (active.startedAt === null) this.onStart(active);
    this.boundaryVoice = true;
    const rel = Math.min(wordAtChar(active.offsets, e.charIndex), active.offsets.length - 1);
    active.anchorAt = this.now();
    active.anchorWord = rel;
    this.advanceTo(active.firstWord + rel);
  }

  private onEnd(active: Active): void {
    const doc = this.doc;
    if (!doc) return;
    if (active.startedAt !== null) {
      this.deps.estimator.record(this.voiceKey(), active.utterance.text.length, (this.now() - active.startedAt) / 1000, this.rate);
    }
    this.active = null;
    this.stopTick();
    const info = this.info(active.blockIndex);
    if (active.endWord < info.words.length) return this.speakFrom(active.blockIndex, active.endWord, false);

    const next = active.blockIndex + 1;
    if (next >= doc.blocks.length) return this.finish();
    if (isHeading(doc.blocks[active.blockIndex].kind) && !this.deps.hidden?.()) {
      this.gapTimer = setTimeout(() => {
        this.gapTimer = undefined;
        this.speakFrom(next, 0, false);
      }, HEADING_PAUSE_MS);
      return;
    }
    this.speakFrom(next, 0, false);
  }

  private onError(e: SpeechSynthesisErrorEvent): void {
    this.active = null;
    if (e.error === "interrupted" || e.error === "canceled") {
      // Something else took the audio (a call, another app): stop where we are.
      this.halt();
      this.setWantPlay(false);
      return;
    }
    if (e.error === "not-allowed") return this.fail(new SpeechError("not_allowed", "Tap play to start listening."));
    this.fail(new SpeechError("failed", "The voice stopped unexpectedly. Tap play to carry on."));
  }

  private onStartTimeout(active: Active): void {
    if (this.active !== active || active.startedAt !== null) return;
    if (active.retried) return this.fail(new SpeechError("failed", "The voice didn't start. Tap play to try again."));
    this.speakFrom(this.pos.blockIndex, this.pos.wordIndex, true);
    if (this.active) this.active.retried = true;
  }

  private finish(): void {
    this.halt();
    this.finished = true;
    this.setWantPlay(false);
    this.emit("finished", undefined);
  }

  private fail(error: SpeechError): void {
    this.halt();
    this.setWantPlay(false);
    this.emit("error", error);
  }

  /** Stops speech and timers; keeps the position. */
  private halt(): void {
    this.clearTimers();
    const synth = this.deps.synth();
    if (this.active && synth) this.cancelActive(synth);
    this.active = null;
    this.stopTick();
    this.setBuffering(null);
  }

  private cancelActive(synth: SpeechSynthesis): void {
    // Forget it first: Chrome fires the cancelled utterance's `error` synchronously.
    this.active = null;
    if (synth.speaking || synth.pending) synth.cancel();
  }

  private restartIfSpeaking(): void {
    if (this.wantPlay && this.doc) this.speakFrom(this.pos.blockIndex, this.pos.wordIndex, true);
  }

  private clearTimers(): void {
    clearTimeout(this.gapTimer);
    clearTimeout(this.startTimer);
    this.gapTimer = this.startTimer = undefined;
  }

  // ---- word tracking without (or between) boundary events -------------------------

  private startTick(): void {
    if (this.tickTimer === undefined) this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTick(): void {
    clearInterval(this.tickTimer);
    this.tickTimer = undefined;
  }

  private tick(): void {
    const active = this.active;
    if (!active || active.startedAt === null) return;
    const since = this.now() - active.anchorAt;
    if (this.boundaryVoice && since < BOUNDARY_GRACE_MS) return;
    const rel = estimatedWordFrom(active.offsets, active.anchorWord, since / 1000, this.charsPerSecond(), this.rate);
    this.advanceTo(active.firstWord + rel);
  }

  /** Moves the highlight forward within the active sentence; never backwards, never past it. */
  private advanceTo(wordIndex: number): void {
    const active = this.active;
    if (!active || active.blockIndex !== this.pos.blockIndex) return;
    const word = Math.min(wordIndex, active.endWord - 1);
    if (word > this.pos.wordIndex) this.setPos({ blockIndex: active.blockIndex, wordIndex: word });
  }

  // ---- positions ----------------------------------------------------------------------

  private info(blockIndex: number): BlockInfo {
    let info = this.infos[blockIndex];
    if (!info) {
      const words = (this.doc?.blocks[blockIndex]?.text ?? "").split(" ");
      info = { words, offsets: wordOffsets(words), sentences: sentenceRanges(words) };
      this.infos[blockIndex] = info;
    }
    return info;
  }

  private clamp(blockIndex: number, wordIndex: number): Position {
    const blocks = this.doc?.blocks.length ?? 1;
    const b = Math.min(Math.max(0, blockIndex), blocks - 1);
    const words = this.info(b).words.length;
    return { blockIndex: b, wordIndex: Math.min(Math.max(0, wordIndex), words - 1) };
  }

  private charAt(pos: Position): number {
    return (this.charStarts[pos.blockIndex] ?? 0) + (this.info(pos.blockIndex).offsets[pos.wordIndex] ?? 0);
  }

  private seekToChar(char: number): void {
    const { blockIndex, char: inBlock } = blockAtChar(this.charStarts, this.totalChars, char);
    this.seek(blockIndex, wordAtChar(this.info(blockIndex).offsets, inBlock));
  }

  private seekToTime(seconds: number): void {
    this.seekToChar(seconds * this.charsPerSecond() * this.rate);
  }

  private voiceKey(): string {
    return this.voice?.voiceURI ?? "default";
  }

  private setPos(pos: Position): void {
    if (pos.blockIndex === this.pos.blockIndex && pos.wordIndex === this.pos.wordIndex) return;
    const blockChanged = pos.blockIndex !== this.pos.blockIndex;
    this.pos = pos;
    if (blockChanged) this.emit("blockchange", { blockIndex: pos.blockIndex });
    this.emit("position", pos);
  }

  private setWantPlay(playing: boolean): void {
    if (!playing) this.lockScreen.keepAlive(false);
    if (this.wantPlay === playing) return;
    this.wantPlay = playing;
    this.lockScreen.setPlaying(playing);
    this.emit("state", { playing });
  }

  private setBuffering(reason: BufferingReason | null): void {
    if (this.bufferingReason === reason) return;
    this.bufferingReason = reason;
    this.emit("buffering", { reason });
  }

  private updateLockScreenPosition(): void {
    if (!this.doc || this.totalChars === 0) return this.lockScreen.setPosition(null);
    const cps = this.charsPerSecond() * this.rate;
    this.lockScreen.setPosition({ duration: this.totalChars / cps, position: this.charAt(this.pos) / cps, rate: this.rate });
  }
}
