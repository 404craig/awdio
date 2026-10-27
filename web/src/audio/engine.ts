/**
 * AudioEngine: one HTMLAudioElement playing per-block audio with word tracking.
 * See docs/ARCHITECTURE.md "AudioEngine". Pure TypeScript, no React.
 */
import { ApiError, isApiError } from "../api/client";
import type { Block, BlockAudio } from "../api/types";
import { LruCache } from "./lru";
import { silentWavDataUri } from "./silence";
import { computeSkipTarget, estimateWord, findWordAt, type Position } from "./timeline";

export interface EngineDeps {
  fetchBlockAudio(
    docId: string,
    blockIndex: number,
    engine: string,
    voiceId: string,
    opts: { prefetch: boolean; signal: AbortSignal },
  ): Promise<BlockAudio>;
  fetchAudioFile(url: string, signal: AbortSignal): Promise<Blob>;
  /** Resolves once the TTS engine reports ready (polls /api/health). */
  waitForEngine(engine: string, signal: AbortSignal): Promise<void>;
}

export interface EngineDocument {
  id: string;
  title: string;
  blocks: Pick<Block, "wordCount">[];
}

export interface Voice {
  engine: string;
  voiceId: string;
}

export type BufferingReason = "loading" | "voice";

export interface EngineEventMap {
  position: Position;
  state: { playing: boolean };
  blockchange: { blockIndex: number };
  buffering: { reason: BufferingReason | null };
  finished: undefined;
  error: ApiError;
}

type Listener<T> = (payload: T) => void;
type ListenerSets = { [K in keyof EngineEventMap]: Set<Listener<EngineEventMap[K]>> };

interface Entry {
  audio: BlockAudio;
  url: string;
}

type Target = { word: number } | { time: number };

const CACHE_SIZE = 40;
const PREFETCH_AHEAD = 3;
const DEFAULT_SECONDS_PER_WORD = 0.38;
const RESTART_THRESHOLD_SEC = 2;
const ARTWORK = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
];

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export class AudioEngine {
  private readonly el: HTMLAudioElement;
  private readonly listeners: ListenerSets = {
    position: new Set(),
    state: new Set(),
    blockchange: new Set(),
    buffering: new Set(),
    finished: new Set(),
    error: new Set(),
  };
  private readonly cache = new LruCache<number, Entry>(CACHE_SIZE, (_k, e) => URL.revokeObjectURL(e.url));
  private readonly pending = new Map<number, { promise: Promise<Entry>; prefetch: boolean }>();
  private readonly prefetchFailed = new Set<number>();
  private session = new AbortController();
  private doc: EngineDocument | null = null;
  private voice: Voice = { engine: "kokoro", voiceId: "af_heart" };
  private pos: Position = { blockIndex: 0, wordIndex: 0 };
  /** Block whose blob is attached to the element (−1: none or the priming clip). */
  private attached = -1;
  private wantPlay = false;
  private finished = false;
  private token = 0;
  private raf = 0;
  private prefetching = false;
  private primed = false;
  private bufferingReason: BufferingReason | null = null;
  private rate = 1;
  private measured = { seconds: 0, words: 0 };
  private fallbackSpw = DEFAULT_SECONDS_PER_WORD;

  constructor(private readonly deps: EngineDeps) {
    this.el = new Audio();
    this.el.preload = "auto";
    this.setPreservesPitch();
    this.el.addEventListener("ended", this.onEnded);
    this.el.addEventListener("pause", this.onExternalPause);
    this.el.addEventListener("timeupdate", this.onTimeUpdate);
    this.el.addEventListener("error", this.onMediaError);
  }

  // ---- events -------------------------------------------------------------

  on<K extends keyof EngineEventMap>(type: K, fn: Listener<EngineEventMap[K]>): () => void {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  private emit<K extends keyof EngineEventMap>(type: K, payload: EngineEventMap[K]): void {
    this.listeners[type].forEach((fn) => fn(payload));
  }

  // ---- public API -----------------------------------------------------------

  get position(): Position {
    return this.pos;
  }

  get playing(): boolean {
    return this.wantPlay;
  }

  /** Measured average seconds per word (at 1x) across synthesised blocks. */
  secondsPerWord(): number {
    return this.measured.words > 0 ? this.measured.seconds / this.measured.words : this.fallbackSpw;
  }

  load(doc: EngineDocument, opts: { voice: Voice; rate: number; start: Position; secondsPerWord?: number }): void {
    this.reset();
    this.doc = doc;
    this.voice = { ...opts.voice };
    this.fallbackSpw = opts.secondsPerWord && opts.secondsPerWord > 0 ? opts.secondsPerWord : DEFAULT_SECONDS_PER_WORD;
    this.measured = { seconds: 0, words: 0 };
    this.setRate(opts.rate);
    this.setupMediaSession(doc.title);
    // Fetch the current block (on demand) and start prefetching right away, so play is instant.
    void this.activate(this.clampBlock(opts.start.blockIndex), { word: opts.start.wordIndex }, true);
    this.prefetch();
  }

  unload(): void {
    this.reset();
    this.doc = null;
    this.clearMediaSession();
  }

  play(): void {
    if (!this.doc) return;
    this.setWantPlay(true);
    if (this.finished) {
      this.finished = false;
      void this.activate(0, { time: 0 });
      return;
    }
    if (this.attached === this.pos.blockIndex && this.bufferingReason === null) {
      // Called synchronously inside the user's gesture: satisfies iOS autoplay rules.
      this.primed = true;
      this.el.play().catch(this.onPlayRejected);
      this.startTick();
      return;
    }
    this.primeInGesture();
    void this.activate(this.pos.blockIndex, { word: this.pos.wordIndex });
  }

  pause(): void {
    this.setWantPlay(false);
    this.el.pause();
    this.stopTick();
    this.updatePositionState();
  }

  toggle(): void {
    if (this.wantPlay) this.pause();
    else this.play();
  }

  seek(blockIndex: number, wordIndex: number): void {
    if (!this.doc) return;
    this.finished = false;
    void this.activate(this.clampBlock(blockIndex), { word: wordIndex });
  }

  skip(seconds: number): void {
    const doc = this.doc;
    if (!doc) return;
    const spw = this.secondsPerWord();
    const blocks = doc.blocks.map((b, i) => ({ wordCount: b.wordCount, durationSec: this.cache.peek(i)?.audio.durationSec ?? null }));
    const target = computeSkipTarget(blocks, { blockIndex: this.pos.blockIndex, time: this.currentBlockTime() }, seconds, spw);
    this.finished = false;
    void this.activate(target.blockIndex, { time: target.time });
  }

  nextBlock(): void {
    if (!this.doc || this.pos.blockIndex >= this.doc.blocks.length - 1) return;
    void this.activate(this.pos.blockIndex + 1, { time: 0 });
  }

  prevBlock(): void {
    if (!this.doc) return;
    const restart = this.currentBlockTime() > RESTART_THRESHOLD_SEC || this.pos.blockIndex === 0;
    void this.activate(restart ? this.pos.blockIndex : this.pos.blockIndex - 1, { time: 0 });
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
    this.updatePositionState();
  }

  setVoice(voice: Voice): void {
    if (voice.engine === this.voice.engine && voice.voiceId === this.voice.voiceId) return;
    this.voice = { ...voice };
    this.newSession();
    this.measured = { seconds: 0, words: 0 };
    if (this.doc) void this.activate(this.pos.blockIndex, { word: this.pos.wordIndex });
  }

  // ---- loading & playback ---------------------------------------------------

  private reset(): void {
    this.token += 1;
    this.setWantPlay(false);
    this.stopTick();
    this.el.pause();
    this.newSession();
    this.finished = false;
    this.setBuffering(null);
  }

  private newSession(): void {
    this.session.abort();
    this.session = new AbortController();
    this.pending.clear();
    this.prefetchFailed.clear();
    this.prefetching = false;
    this.cache.clear();
    this.attached = -1;
    this.el.removeAttribute("src");
  }

  private clampBlock(index: number): number {
    const max = (this.doc?.blocks.length ?? 1) - 1;
    return Math.min(Math.max(0, index), max);
  }

  /** Make `blockIndex` current at `target`; plays when wanted. Latest call wins. */
  private async activate(blockIndex: number, target: Target, quiet = false): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const token = ++this.token;
    const wordCount = doc.blocks[blockIndex].wordCount;
    let entry = this.cache.get(blockIndex);
    const wordFor = (e: Entry | undefined) => {
      if ("word" in target) return Math.min(Math.max(0, target.word), wordCount - 1);
      return e ? findWordAt(e.audio.timings, target.time) : estimateWord(wordCount, target.time, this.secondsPerWord());
    };
    this.setPos({ blockIndex, wordIndex: wordFor(entry) }, quiet);

    if (!entry) {
      this.stopTick();
      if (this.bufferingReason !== "voice") this.setBuffering("loading");
      if (this.attached !== blockIndex) this.el.pause();
      try {
        entry = await this.getEntry(blockIndex, false);
      } catch (e) {
        if (token === this.token && !isAbort(e)) this.fail(e);
        return;
      }
      if (token !== this.token) return;
      this.setPos({ blockIndex, wordIndex: wordFor(entry) }, true);
    }
    this.setBuffering(null);

    const timings = entry.audio.timings;
    const time =
      "word" in target
        ? (timings[this.pos.wordIndex]?.[0] ?? 0)
        : Math.min(Math.max(0, target.time), Math.max(0, entry.audio.durationSec - 0.05));
    try {
      await this.attach(blockIndex, entry, time);
    } catch (e) {
      if (token === this.token) this.fail(e);
      return;
    }
    if (token !== this.token) return;
    if (this.wantPlay) {
      this.el.play().catch(this.onPlayRejected);
      this.startTick();
    }
    this.updatePositionState();
    this.prefetch();
  }

  private async attach(blockIndex: number, entry: Entry, time: number): Promise<void> {
    if (this.attached !== blockIndex) {
      this.attached = blockIndex;
      this.el.src = entry.url;
    }
    if (this.el.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          this.el.removeEventListener("loadedmetadata", done);
          this.el.removeEventListener("error", failed);
          resolve();
        };
        const failed = () => {
          this.el.removeEventListener("loadedmetadata", done);
          this.el.removeEventListener("error", failed);
          reject(new ApiError(0, "media_error", "This audio could not be played"));
        };
        this.el.addEventListener("loadedmetadata", done);
        this.el.addEventListener("error", failed);
      });
    }
    this.el.currentTime = time;
  }

  /**
   * BlockAudio JSON + audio blob for a block, deduplicated. An on-demand request for a block
   * that is only being prefetched issues its own (higher priority) request.
   */
  private getEntry(blockIndex: number, prefetch: boolean): Promise<Entry> {
    const hit = this.cache.get(blockIndex);
    if (hit) return Promise.resolve(hit);
    const inflight = this.pending.get(blockIndex);
    if (inflight && (prefetch || !inflight.prefetch)) return inflight.promise;
    const doc = this.doc;
    if (!doc) return Promise.reject(new DOMException("No document", "AbortError"));
    const { signal } = this.session;
    const voice = this.voice;
    const promise = (async (): Promise<Entry> => {
      for (;;) {
        try {
          const audio = await this.deps.fetchBlockAudio(doc.id, blockIndex, voice.engine, voice.voiceId, { prefetch, signal });
          const blob = await this.deps.fetchAudioFile(audio.url, signal);
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          const existing = this.cache.peek(blockIndex);
          if (existing) return existing; // a parallel request for the same block won
          const entry: Entry = { audio, url: URL.createObjectURL(blob) };
          this.cache.set(blockIndex, entry, (k) => k === this.pos.blockIndex || k === this.attached);
          this.measured.seconds += audio.durationSec;
          this.measured.words += doc.blocks[blockIndex].wordCount;
          return entry;
        } catch (e) {
          if (!isApiError(e, "engine_not_ready")) throw e;
          if (blockIndex === this.pos.blockIndex) this.setBuffering("voice");
          await this.deps.waitForEngine(voice.engine, signal);
          if (blockIndex === this.pos.blockIndex && this.bufferingReason) this.setBuffering("loading");
        }
      }
    })();
    this.pending.set(blockIndex, { promise, prefetch });
    promise
      .finally(() => {
        if (this.pending.get(blockIndex)?.promise === promise) this.pending.delete(blockIndex);
      })
      .catch(() => {});
    return promise;
  }

  /** Keep the next blocks fetched, one request in flight. */
  private prefetch(): void {
    const doc = this.doc;
    if (!doc || this.prefetching) return;
    let next = -1;
    for (let i = this.pos.blockIndex + 1; i <= this.pos.blockIndex + PREFETCH_AHEAD && i < doc.blocks.length; i++) {
      if (!this.cache.has(i) && !this.pending.has(i) && !this.prefetchFailed.has(i)) {
        next = i;
        break;
      }
    }
    if (next < 0) return;
    const session = this.session;
    this.prefetching = true;
    this.getEntry(next, true)
      .catch(() => {
        if (session === this.session) this.prefetchFailed.add(next);
      })
      .finally(() => {
        if (session !== this.session) return;
        this.prefetching = false;
        this.prefetch();
      });
  }

  /** iOS: the element must start playing inside the gesture, before audio is fetched. */
  private primeInGesture(): void {
    if (this.primed) return;
    this.primed = true;
    this.attached = -1; // the fetched blob is re-attached from the cache when ready
    this.el.src = silentWavDataUri();
    this.el.play().catch(() => {});
  }

  private currentBlockTime(): number {
    if (this.attached === this.pos.blockIndex) return this.el.currentTime;
    const entry = this.cache.peek(this.pos.blockIndex);
    return entry?.audio.timings[this.pos.wordIndex]?.[0] ?? this.pos.wordIndex * this.secondsPerWord();
  }

  // ---- ticking ----------------------------------------------------------------

  private startTick(): void {
    if (this.raf) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.sync();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopTick(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private sync(): void {
    if (this.attached !== this.pos.blockIndex || this.bufferingReason) return;
    const entry = this.cache.peek(this.attached);
    if (!entry) return;
    const word = findWordAt(entry.audio.timings, this.el.currentTime);
    if (word !== this.pos.wordIndex) this.setPos({ blockIndex: this.pos.blockIndex, wordIndex: word });
  }

  // ---- element events -----------------------------------------------------

  private readonly onEnded = () => {
    const doc = this.doc;
    if (!doc || this.attached < 0 || this.attached !== this.pos.blockIndex) return;
    if (this.pos.blockIndex >= doc.blocks.length - 1) {
      this.finished = true;
      this.setWantPlay(false);
      this.stopTick();
      this.emit("finished", undefined);
      return;
    }
    void this.activate(this.pos.blockIndex + 1, { time: 0 });
  };

  /** Pauses we did not ask for (OS interruption, headphones unplugged). */
  private readonly onExternalPause = () => {
    if (this.attached < 0 || this.el.ended || !this.wantPlay || this.bufferingReason) return;
    this.setWantPlay(false);
    this.stopTick();
  };

  /** rAF does not run in background tabs; timeupdate keeps position (and saving) alive. */
  private readonly onTimeUpdate = () => {
    if (document.hidden) this.sync();
  };

  private readonly onMediaError = () => {
    if (this.attached < 0 || !this.el.getAttribute("src")) return;
    this.fail(new ApiError(0, "media_error", "This audio could not be played"));
  };

  private readonly onPlayRejected = (e: unknown) => {
    if (isAbort(e)) return;
    this.setWantPlay(false);
    this.stopTick();
  };

  private fail(e: unknown): void {
    this.setBuffering(null);
    this.setWantPlay(false);
    this.stopTick();
    this.emit("error", e instanceof ApiError ? e : new ApiError(0, "unknown", e instanceof Error ? e.message : "Playback failed"));
  }

  // ---- state helpers --------------------------------------------------------

  private setPos(pos: Position, quiet = false): void {
    const blockChanged = pos.blockIndex !== this.pos.blockIndex;
    if (!blockChanged && pos.wordIndex === this.pos.wordIndex && quiet) return;
    this.pos = pos;
    if (blockChanged) this.emit("blockchange", { blockIndex: pos.blockIndex });
    this.emit("position", pos);
  }

  private setWantPlay(playing: boolean): void {
    if (this.wantPlay === playing) return;
    this.wantPlay = playing;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    this.emit("state", { playing });
  }

  private setBuffering(reason: BufferingReason | null): void {
    if (this.bufferingReason === reason) return;
    this.bufferingReason = reason;
    this.emit("buffering", { reason });
  }

  private setPreservesPitch(): void {
    const el = this.el as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
    el.mozPreservesPitch = true;
  }

  // ---- Media Session ----------------------------------------------------------

  private setupMediaSession(title: string): void {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (typeof MediaMetadata !== "undefined") {
      ms.metadata = new MediaMetadata({ title, artist: "awdio", artwork: ARTWORK });
    }
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => this.play()],
      ["pause", () => this.pause()],
      ["seekbackward", (d) => this.skip(-(d.seekOffset ?? 15))],
      ["seekforward", (d) => this.skip(d.seekOffset ?? 15)],
      ["previoustrack", () => this.prevBlock()],
      ["nexttrack", () => this.nextBlock()],
      ["seekto", (d) => d.seekTime !== undefined && void this.activate(this.pos.blockIndex, { time: d.seekTime })],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported by this browser */
      }
    }
  }

  private clearMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    const actions: MediaSessionAction[] = ["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack", "seekto"];
    for (const action of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        /* unsupported */
      }
    }
    navigator.mediaSession.metadata = null;
  }

  private updatePositionState(): void {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const entry = this.attached >= 0 ? this.cache.peek(this.attached) : undefined;
    if (!entry || !(entry.audio.durationSec > 0)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: entry.audio.durationSec,
        playbackRate: this.rate,
        position: Math.min(this.el.currentTime, entry.audio.durationSec),
      });
    } catch {
      /* invalid state while the element is switching sources */
    }
  }
}
