import { create } from "zustand";
import { getSettings, getVoices, putSettings, type EngineInfo, type Settings, type SettingsUpdate } from "../api";

const STORAGE_KEY = "awdio.settings";

export const DEFAULT_SETTINGS: Settings = {
  engine: "kokoro",
  voiceId: "af_heart",
  speed: 1,
  font: "serif",
  textSize: 19,
  theme: "system",
  autoScroll: true,
  elevenLabsConfigured: false,
  elevenLabsModelId: "eleven_multilingual_v2",
};

function cached(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  engines: EngineInfo[] | null;
  load(): Promise<void>;
  loadVoices(): Promise<void>;
  /** Optimistic: applies locally, then PUTs; reverts on failure. */
  update(patch: Omit<SettingsUpdate, "elevenLabsApiKey">): Promise<void>;
  /** Throws ApiError (e.g. invalid_api_key) for the caller to show inline. */
  saveApiKey(key: string): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: cached(),
  loaded: false,
  engines: null,

  async load() {
    try {
      const settings = await getSettings();
      persist(settings);
      set({ settings, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async loadVoices() {
    try {
      const { engines } = await getVoices();
      set({ engines });
    } catch {
      /* the sheet shows its own empty state */
    }
  },

  async update(patch) {
    const before = get().settings;
    const next = { ...before, ...patch };
    set({ settings: next });
    persist(next);
    try {
      const saved = await putSettings(patch);
      // Keep any newer local edits made while this request was in flight.
      const current = get().settings;
      const merged = { ...saved, ...diff(next, current) };
      set({ settings: merged });
      persist(merged);
    } catch {
      set({ settings: before });
      persist(before);
    }
  },

  async saveApiKey(key) {
    const saved = await putSettings({ elevenLabsApiKey: key });
    set({ settings: saved });
    persist(saved);
    await get().loadVoices();
  },
}));

function diff(base: Settings, current: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  (Object.keys(current) as (keyof Settings)[]).forEach((k) => {
    if (current[k] !== base[k]) Object.assign(out, { [k]: current[k] });
  });
  return out;
}
