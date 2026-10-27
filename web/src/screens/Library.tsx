import { useEffect, useRef, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { EmptyState } from "../components/library/EmptyState";
import { DocumentCard } from "../components/library/DocumentCard";
import { UploadCard } from "../components/library/UploadCard";
import { Mark } from "../components/brand/Mark";
import { Wordmark } from "../components/brand/Wordmark";
import { formatDuration } from "../lib/format";
import { ACCEPTED_EXTENSIONS, useLibrary } from "../state/library";
import { useUi } from "../state/ui";

function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onFiles);
  handler.current = onFiles;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      handler.current([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  return dragging;
}

export function Library() {
  const { docs, loaded, loadError, uploads, load, upload } = useLibrary();
  const openSettings = useUi((s) => s.openSettings);
  const input = useRef<HTMLInputElement>(null);
  const dragging = useFileDrop((files) => files.forEach((f) => void upload(f)));

  useEffect(() => {
    window.scrollTo(0, 0);
    void load();
  }, [load]);

  const choose = () => input.current?.click();
  const total = docs.reduce((sum, d) => sum + d.estimatedSeconds, 0);
  const empty = loaded && !loadError && docs.length === 0 && uploads.length === 0;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-5 sm:px-8" style={{ paddingTop: "calc(var(--safe-top) + 16px)", minHeight: "calc(var(--safe-top) + 60px)" }}>
        <Wordmark />
        <div className="-mr-2 flex items-center gap-1">
          {!empty && (
            <button type="button" className="btn-secondary h-10 gap-1.5 px-4 text-[14px]" onClick={choose}>
              <Plus size={17} strokeWidth={2.25} aria-hidden /> Add
            </button>
          )}
          <button type="button" className="tap text-ink hover:bg-ink/5" aria-label="Settings" onClick={() => openSettings("listen")}>
            <Settings size={21} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
        {!empty && (
          <div className="mb-7 sm:mb-9">
            <h1 className="text-[36px] font-light leading-tight tracking-[-0.03em] sm:text-[44px]">Library</h1>
            {docs.length > 0 && (
              <p className="label mt-2">
                {docs.length} {docs.length === 1 ? "document" : "documents"} · {formatDuration(total)} of listening
              </p>
            )}
          </div>
        )}

        {loadError && (
          <div className="rounded-card border border-hairline bg-surface p-5 text-[15px]">
            <p className="font-medium">{loadError}</p>
            <button type="button" className="btn-secondary mt-3 h-10" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {uploads.map((u) => (
              <UploadCard key={u.id} upload={u} />
            ))}
          </div>
        )}

        {empty ? (
          <EmptyState onChoose={choose} dragging={dragging} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((d) => (
              <DocumentCard key={d.id} doc={d} />
            ))}
            {!loaded && [0, 1, 2].map((i) => <div key={i} className="h-[148px] animate-pulse rounded-card bg-ink/[0.04]" />)}
          </div>
        )}
      </main>

      <input
        ref={input}
        type="file"
        className="hidden"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => {
          [...(e.target.files ?? [])].forEach((f) => void upload(f));
          e.target.value = "";
        }}
      />

      {dragging && !empty && (
        <div className="animate-fade-in pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/80 p-6 backdrop-blur-sm">
          <div className="flex w-full max-w-[520px] flex-col items-center rounded-sheet border border-dashed border-accent bg-surface/80 px-6 py-16 text-center">
            <Mark className="h-6 text-accent-ink" />
            <p className="mt-5 text-[20px] font-light tracking-[-0.01em]">Drop to add to your library</p>
          </div>
        </div>
      )}
    </div>
  );
}
