import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { getDocument, isApiError, type Document } from "../api";
import { BackToReading, ScrubLabel } from "../components/reader/Overlays";
import { Player } from "../components/reader/Player";
import { ReaderColumn } from "../components/reader/ReaderColumn";
import { TopBar } from "../components/reader/TopBar";
import { useProgressSaver } from "../hooks/useProgressSaver";
import { useReaderShortcuts } from "../hooks/useReaderShortcuts";
import { pageName } from "../lib/docIndex";
import { openReader, useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { useUi } from "../state/ui";

export function Reader() {
  const { id = "" } = useParams();
  const restart = (useLocation().state as { restart?: boolean } | null)?.restart === true;
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);
  const index = useReader((s) => s.index);
  const loadVoices = useSettings((s) => s.loadVoices);

  useEffect(() => {
    const ac = new AbortController();
    setDoc(null);
    setError(null);
    getDocument(id, ac.signal)
      .then(setDoc)
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(isApiError(e) && e.status === 404 ? "This document no longer exists." : "Couldn't open this document.");
      });
    return () => ac.abort();
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    const close = openReader(doc, { restart });
    const index = useReader.getState().index;
    if (!restart && doc.progress && doc.progress.wordOrdinal > 0 && index) {
      const page = index.pages[index.pageOfBlock[useReader.getState().position.blockIndex]];
      useUi.getState().showToast(`Resumed at ${pageName(page).replace(/^Page/, "page")}`);
    }
    return close;
  }, [doc]);

  useEffect(() => {
    void loadVoices();
    window.history.scrollRestoration = "manual";
  }, [loadVoices]);

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
