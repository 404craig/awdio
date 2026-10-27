import { create } from "zustand";
import { loadSettings, saveSettings } from "../data/db";
import type { Settings } from "../types";

/** Mirrored here so index.html can apply theme and reading prefs before first paint. */
const MIRROR_KEY = "awdio.settings";

export const DEFAULT_SETTINGS: Settings = {
  voiceURI: null,
  speed: 1,
  font: "serif",
  textSize: 19,
  theme: "system",
  autoScroll: true,
  voiceTipDismissed: false,
  homeScreenTipDismissed: false,
};

const withDefaults = (partial: Partial<Settings> | null): Settings => ({ ...DEFAULT_SETTINGS, ...(partial ?? {}) });

function mirrored(): Settings {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return withDefaults(raw ? (JSON.parse(raw) as Partial<Settings>) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function mirror(settings: Settings): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(settings));
  } catch {
    /* private mode or storage full: IndexedDB still has it */
  }
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<Settings>): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: mirrored(),
  loaded: false,

  async load() {
    try {
      const stored = await loadSettings();
      const settings = stored ? withDefaults(stored) : get().settings;
      mirror(settings);
      set({ settings, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    mirror(settings);
    try {
      await saveSettings(settings);
    } catch {
      /* the mirror keeps it for this device; nothing else to do */
    }
  },
}));
