import { useEffect } from "react";
import { putProgress } from "../api";
import type { Position } from "../audio/timeline";
import { useReader } from "../state/reader";

const SAVE_INTERVAL_MS = 5000;
const keyOf = (p: Position) => `${p.blockIndex}:${p.wordIndex}`;

/**
 * Saves the reading position: at most every 5 s while playing, and immediately on
 * pause, seek, tab hide and unmount (docs/SPEC.md §5).
 */
export function useProgressSaver(docId: string | undefined): void {
  useEffect(() => {
    if (!docId) return;
    let latest = useReader.getState().position;
    let lastSaved = keyOf(latest);
    let timer: number | undefined;

    const save = (keepalive = false) => {
      clearTimeout(timer);
      timer = undefined;
      const key = keyOf(latest);
      if (key === lastSaved) return;
      lastSaved = key;
      putProgress(docId, latest, keepalive).catch(() => {
        lastSaved = "";
      });
    };

    const unsub = useReader.subscribe((s, prev) => {
      if (!s.index || s.index.doc.id !== docId) return;
      latest = s.position;
      if (s.seekSeq !== prev.seekSeq || (prev.playing && !s.playing)) save();
      else if (s.position !== prev.position && s.playing && timer === undefined) {
        timer = window.setTimeout(save, SAVE_INTERVAL_MS);
      }
    });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save(true);
    };
    const onPageHide = () => save(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      save(true);
    };
  }, [docId]);
}
