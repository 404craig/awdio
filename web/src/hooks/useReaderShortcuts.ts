import { useEffect } from "react";
import { player } from "../state/reader";
import { useUi } from "../state/ui";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Space play/pause · ←/→ 15 s · ↑/↓ paragraph · [ ] speed (docs/SPEC.md §7). */
export function useReaderShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return;
      if (useUi.getState().settingsTab) return;
      const actions: Record<string, () => void> = {
        " ": () => !e.repeat && player.toggle(),
        ArrowLeft: () => player.skip(-15),
        ArrowRight: () => player.skip(15),
        ArrowUp: () => player.prev(),
        ArrowDown: () => player.next(),
        "[": () => player.stepSpeed(-1),
        "]": () => player.stepSpeed(1),
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    // Space on a focused button would also "click" it on keyup; the shortcut already handled it.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && e.target instanceof HTMLButtonElement && !useUi.getState().settingsTab) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
