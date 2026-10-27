import { create } from "zustand";

export type SettingsTab = "listen" | "read";

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface UiState {
  settingsTab: SettingsTab | null;
  toast: Toast | null;
  openSettings(tab: SettingsTab): void;
  closeSettings(): void;
  showToast(text: string, tone?: Toast["tone"]): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  settingsTab: null,
  toast: null,
  openSettings: (tab) => set({ settingsTab: tab }),
  closeSettings: () => set({ settingsTab: null }),
  showToast: (text, tone = "info") => set({ toast: { id: ++toastSeq, text, tone } }),
  dismissToast: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },
}));
