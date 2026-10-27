/**
 * A stand-in for the Web Speech API that "speaks" by timing characters. Used by unit tests,
 * the perf and screenshot scripts and the e2e test (headless browsers have no voices).
 * Enabled in the app with `?fakeSpeech=1` (options: `fakeCps`, `fakeBoundaries=0`,
 * `fakeVoices=standard|none`) or by setting `window.__awdioFakeSpeech` before load.
 */

export interface FakeVoiceSpec {
  name: string;
  lang: string;
  voiceURI?: string;
}

export interface FakeSpeechOptions {
  /** Characters spoken per second at rate 1. */
  charsPerSecond?: number;
  /** Send word `boundary` events (Safari and most local voices do; some voices don't). */
  boundaries?: boolean;
  voices?: FakeVoiceSpec[];
  startDelayMs?: number;
}

export const FAKE_VOICES: FakeVoiceSpec[] = [
  { name: "Daniel", lang: "en-GB" },
  { name: "Serena (Premium)", lang: "en-GB" },
  { name: "Samantha", lang: "en-US" },
  { name: "Ava (Enhanced)", lang: "en-US" },
  { name: "Moira", lang: "en-IE" },
  { name: "Thomas", lang: "fr-FR" },
  { name: "Anna", lang: "de-DE" },
];

export const STANDARD_FAKE_VOICES = FAKE_VOICES.filter((v) => !/\((premium|enhanced)\)/i.test(v.name));

function voiceOf(spec: FakeVoiceSpec, index: number): SpeechSynthesisVoice {
  const quality = /premium/i.test(spec.name) ? "premium" : /enhanced/i.test(spec.name) ? "enhanced" : "compact";
  const base = spec.name.replace(/\s*\(.*\)$/, "");
  return {
    name: spec.name,
    lang: spec.lang,
    voiceURI: spec.voiceURI ?? `com.apple.voice.${quality}.${spec.lang}.${base}`,
    localService: true,
    default: index === 0,
  };
}

class FakeSpeechEvent extends Event implements SpeechSynthesisEvent {
  constructor(
    type: string,
    readonly utterance: SpeechSynthesisUtterance,
    readonly charIndex = 0,
    readonly charLength = 0,
    readonly elapsedTime = 0,
    readonly name = "",
  ) {
    super(type);
  }
}

class FakeSpeechErrorEvent extends FakeSpeechEvent implements SpeechSynthesisErrorEvent {
  constructor(
    utterance: SpeechSynthesisUtterance,
    readonly error: SpeechSynthesisErrorCode,
  ) {
    super("error", utterance);
  }
}

export class FakeUtterance extends EventTarget implements SpeechSynthesisUtterance {
  lang = "";
  pitch = 1;
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onboundary: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;
  onend: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;
  onerror: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisErrorEvent) => unknown) | null = null;
  onmark: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;
  onpause: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;
  onresume: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;
  onstart: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => unknown) | null = null;

  constructor(public text = "") {
    super();
  }
}

type Handler = "onstart" | "onend" | "onboundary";

export class FakeSpeechSynthesis extends EventTarget implements SpeechSynthesis {
  onvoiceschanged: ((this: SpeechSynthesis, ev: Event) => unknown) | null = null;
  paused = false;
  /** Every utterance passed to speak(), for assertions. */
  readonly spoken: SpeechSynthesisUtterance[] = [];
  private voices: SpeechSynthesisVoice[];
  private queue: SpeechSynthesisUtterance[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly cps: number;
  private readonly boundaries: boolean;
  private readonly startDelayMs: number;

  constructor(opts: FakeSpeechOptions = {}) {
    super();
    this.cps = opts.charsPerSecond ?? 15;
    this.boundaries = opts.boundaries ?? true;
    this.startDelayMs = opts.startDelayMs ?? 30;
    this.voices = (opts.voices ?? FAKE_VOICES).map(voiceOf);
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  getVoices(): SpeechSynthesisVoice[] {
    return [...this.voices];
  }

  /** Simulates installing a voice (Settings → Accessibility → Spoken Content). */
  setVoices(voices: FakeVoiceSpec[]): void {
    this.voices = voices.map(voiceOf);
    const event = new Event("voiceschanged");
    this.onvoiceschanged?.call(this, event);
    this.dispatchEvent(event);
  }

  speak(utterance: SpeechSynthesisUtterance): void {
    this.spoken.push(utterance);
    this.queue.push(utterance);
    if (!this.current) this.next();
  }

  cancel(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const interrupted = this.current;
    const dropped = this.queue;
    this.current = null;
    this.queue = [];
    if (interrupted) this.fireError(interrupted, "interrupted");
    dropped.forEach((u) => this.fireError(u, "canceled"));
  }

  /** Simulates iOS silently dropping speech while the phone is locked: no `end`, no `error`. */
  dropSilently(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.current = null;
    this.queue = [];
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  private next(): void {
    const utterance = this.queue.shift() ?? null;
    this.current = utterance;
    if (!utterance) return;
    const msPerChar = 1000 / (this.cps * (utterance.rate || 1));
    const at = (ms: number, fn: () => void) => this.timers.push(setTimeout(fn, ms));
    const start = this.startDelayMs;
    at(start, () => this.fire(utterance, "onstart", new FakeSpeechEvent("start", utterance)));
    if (this.boundaries) {
      let offset = 0;
      for (const word of utterance.text.split(" ")) {
        const charIndex = offset;
        at(start + charIndex * msPerChar, () =>
          this.fire(utterance, "onboundary", new FakeSpeechEvent("boundary", utterance, charIndex, word.length, 0, "word")),
        );
        offset += word.length + 1;
      }
    }
    at(start + utterance.text.length * msPerChar, () => {
      this.timers = [];
      this.current = null;
      this.fire(utterance, "onend", new FakeSpeechEvent("end", utterance));
      if (!this.current) this.next();
    });
  }

  private fire(utterance: SpeechSynthesisUtterance, handler: Handler, event: SpeechSynthesisEvent): void {
    utterance[handler]?.call(utterance, event);
    utterance.dispatchEvent(event);
  }

  private fireError(utterance: SpeechSynthesisUtterance, error: SpeechSynthesisErrorCode): void {
    const event = new FakeSpeechErrorEvent(utterance, error);
    utterance.onerror?.call(utterance, event);
    utterance.dispatchEvent(event);
  }
}

declare global {
  interface Window {
    __awdioFakeSpeech?: FakeSpeechOptions | boolean;
  }
}

function requestedOptions(): FakeSpeechOptions | null {
  const params = new URLSearchParams(window.location.search);
  const global = window.__awdioFakeSpeech;
  if (params.get("fakeSpeech") !== "1" && !global) return null;
  const opts: FakeSpeechOptions = typeof global === "object" ? { ...global } : {};
  const cps = Number(params.get("fakeCps"));
  if (cps > 0) opts.charsPerSecond = cps;
  if (params.get("fakeBoundaries") === "0") opts.boundaries = false;
  const voices = params.get("fakeVoices");
  if (voices === "standard") opts.voices = STANDARD_FAKE_VOICES;
  if (voices === "none") opts.voices = [];
  return opts;
}

/** Replaces the browser's speech API with the fake when requested. Call before anything speaks. */
export function installFakeSpeechIfRequested(): FakeSpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const opts = requestedOptions();
  if (!opts) return null;
  const synth = new FakeSpeechSynthesis(opts);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
  return synth;
}
