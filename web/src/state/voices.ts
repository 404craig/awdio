import { create } from "zustand";
import { systemSynth } from "../audio/instance";
import { describeVoices, effectiveVoice, type VoiceInfo } from "../audio/voices";
import { useSettings } from "./settings";

/** Browsers load voices asynchronously; with none after this long, the device has none. */
const SETTLE_MS = 2500;

interface VoicesState {
  voices: VoiceInfo[];
  status: "loading" | "ready" | "unsupported";
  /** Starts listening for the device's voices (idempotent). */
  load(): void;
  /** Re-reads the voice list now (iOS often has it by the time the user taps play). */
  refresh(): void;
}

let started = false;

export const useVoices = create<VoicesState>((set, get) => ({
  voices: [],
  status: "loading",
  load() {
    if (started) return;
    started = true;
    const synth = systemSynth();
    if (!synth) {
      set({ status: "unsupported" });
      return;
    }
    // Fires on first load and again whenever the user installs a voice in iOS Settings.
    synth.addEventListener("voiceschanged", () => get().refresh());
    get().refresh();
    setTimeout(() => set({ status: "ready" }), SETTLE_MS);
  },
  refresh() {
    const synth = systemSynth();
    if (!synth) return;
    const voices = describeVoices(synth.getVoices());
    const current = get().voices;
    const same = voices.length === current.length && voices.every((v, i) => v.id === current[i].id);
    if (voices.length > 0) set(same ? { status: "ready" } : { voices, status: "ready" });
    else if (!same) set({ voices });
  },
}));

/** The platform voice object for an id (what utterances need). */
export function platformVoice(id: string | undefined): SpeechSynthesisVoice | null {
  if (!id) return null;
  return systemSynth()?.getVoices().find((v) => v.voiceURI === id) ?? null;
}

/** The voice that will speak: the user's explicit pick while installed, else the best available. */
export function useActiveVoice(): VoiceInfo | null {
  const voices = useVoices((s) => s.voices);
  const chosen = useSettings((s) => s.settings.voiceURI);
  return effectiveVoice(voices, chosen);
}

export const activeVoice = (): VoiceInfo | null =>
  effectiveVoice(useVoices.getState().voices, useSettings.getState().settings.voiceURI);
