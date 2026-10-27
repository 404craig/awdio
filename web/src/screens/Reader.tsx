import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { BackToReading, ScrubLabel } from "../components/reader/Overlays";
import { Player } from "../components/reader/Player";
import { ReaderColumn } from "../components/reader/ReaderColumn";
import { TopBar } from "../components/reader/TopBar";
import { VoiceTipBanner } from "../components/reader/VoiceTipBanner";
import { getDocument, getProgress, updateDocument } from "../data/db";
import { useProgressSaver } from "../hooks/useProgressSaver";
import { useReaderShortcuts } from "../hooks/useReaderShortcuts";
import { pageName } from "../lib/docIndex";
import { useLibrary } from "../state/library";
import { openReader, useReader } from "../state/reader";
import { useUi } from "../state/ui";
import type { Document, Progress } from "../types";

interface Loaded {
  doc: Document;
  progress: Progress | null;
}

async function loadForReading(id: string): Promise<Loaded | null> {
  const [doc, progress] = await Promise.all([getDocument(id), getProgress(id)]);
  if (!doc) return null;
  const lastOpenedAt = new Date().toISOString();
  void updateDocument(id, { lastOpenedAt }).catch(() => {});
  useLibrary.getState().patch(id, { lastOpenedAt });
  return { doc, progress };
}

export function Reader() {
  const { id = "" } = useParams();
  const restart = (useLocation().state as { restart?: boolean } | null)?.restart === true;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const index = useReader((s) => s.index);
  const doc = loaded?.doc;

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    loadForReading(id)
      .then((result) => {
        if (cancelled) return;
        if (result) setLoaded(result);
        else setError("This document is no longer on this device.");
      })
      .catch(() => !cancelled && setError("Couldn't open this document."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!loaded) return;
    const { doc, progress } = loaded;
    const close = openReader(doc, progress, { restart });
    const index = useReader.getState().index;
    if (!restart && progress && progress.wordOrdinal > 0 && index) {
      const page = index.pages[index.pageOfBlock[useReader.getState().position.blockIndex]];
      useUi.getState().showToast(`Resumed at ${pageName(page).replace(/^Page/, "page")}`);
    }
    return close;
  }, [loaded]);

  useEffect(() => {
    window.history.scrollRestoration = "manual";
  }, []);

  useProgressSaver(doc?.id);
  useReaderShortcuts();

  useEffect(() => {
    if (doc) document.title = `${doc.title} · awdio`;
    return () => {
      document.title = "awdio";
    };
  }, [doc]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[17px] font-medium">{error}</p>
        <Link to="/" className="btn-secondary">
          <ChevronLeft size={18} aria-hidden /> Library
        </Link>
      </div>
    );
  }

  if (!index || index.doc.id !== id) return <ReaderSkeleton />;

  return (
    <>
      <TopBar index={index} />
      <main>
        <ReaderColumn key={index.doc.id} index={index} />
      </main>
      <VoiceTipBanner />
      <BackToReading />
      <ScrubLabel index={index} />
      <Player index={index} />
    </>
  );
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto max-w-[680px] px-6 pt-24 sm:px-10" aria-busy="true" aria-label="Loading document">
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-8 space-y-3">
        {[100, 96, 98, 88, 94, 60].map((w, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-ink/[0.05]" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
