import { useEffect } from "react";
import { positionToOrdinal, type Position } from "../audio/timeline";
import { putProgress } from "../data/db";
import { useLibrary } from "../state/library";
import { useReader } from "../state/reader";

const SAVE_INTERVAL_MS = 5000;
const keyOf = (p: Position) => `${p.blockIndex}:${p.wordIndex}`;

/**
 * Saves the reading position to IndexedDB: at most every 5 s while playing, and immediately
 * on pause, seek, app hide and unmount (docs/SPEC.md §5).
 */
export function useProgressSaver(docId: string | undefined): void {
  useEffect(() => {
    if (!docId) return;
    let latest = useReader.getState().position;
    // Kept here: the reader's own teardown may clear the store before this effect's cleanup runs.
    let index = useReader.getState().index;
    let lastSaved = keyOf(latest);
    let timer: number | undefined;

    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      const key = keyOf(latest);
      if (key === lastSaved || !index || index.doc.id !== docId) return;
      lastSaved = key;
      const progress = { ...latest, wordOrdinal: positionToOrdinal(index.blocks, latest), updatedAt: new Date().toISOString() };
      useLibrary.getState().patch(docId, { progress });
      putProgress(docId, progress).catch(() => {
        lastSaved = "";
      });
    };

    const unsub = useReader.subscribe((s, prev) => {
      if (!s.index || s.index.doc.id !== docId) return;
      index = s.index;
      latest = s.position;
      if (s.seekSeq !== prev.seekSeq || (prev.playing && !s.playing)) save();
      else if (s.position !== prev.position && s.playing && timer === undefined) {
        timer = window.setTimeout(save, SAVE_INTERVAL_MS);
      }
    });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      unsub();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [docId]);
}
