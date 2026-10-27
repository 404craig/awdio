import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Headphones, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { useListeningTime } from "../../hooks/useListeningTime";
import { FINISHED_PERCENT, formatDuration, SOURCE_LABEL } from "../../lib/format";
import { useLibrary, type LibraryItem } from "../../state/library";
import { ConfirmDialog } from "../ConfirmDialog";
import { Cover } from "./Cover";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";

export function DocumentCard({ doc }: { doc: LibraryItem }) {
  const navigate = useNavigate();
  const { rename, remove } = useLibrary();
  const listeningTime = useListeningTime();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const ordinal = doc.progress?.wordOrdinal ?? 0;
  const exactPercent = doc.wordCount > 0 ? (ordinal / doc.wordCount) * 100 : 0;
  const finished = !!doc.progress && (exactPercent >= FINISHED_PERCENT || ordinal >= doc.wordCount - 1);
  const percent = finished ? 100 : Math.floor(exactPercent);
  const started = ordinal > 0;
  const total = listeningTime(doc.charCount);
  const remaining = total * (1 - exactPercent / 100);

  const items: MenuItem[] = [
    { label: "Rename", icon: <Pencil size={17} />, onSelect: () => setEditing(true) },
    { label: "Delete", icon: <Trash2 size={17} />, onSelect: () => setConfirming(true), destructive: true },
  ];

  return (
    <article className="flex gap-4 rounded-card border border-hairline bg-surface p-4 transition-colors duration-200 hover:border-ink/15 sm:p-5">
      <Link to={`/d/${doc.id}`} tabIndex={-1} aria-hidden className="shrink-0">
        <Cover id={doc.id} title={doc.title} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="label">
              {SOURCE_LABEL[doc.sourceType]} · {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
            </p>
            {editing ? (
              <RenameField
                initial={doc.title}
                onDone={(title) => {
                  setEditing(false);
                  if (title !== null) void rename(doc.id, title);
                }}
              />
            ) : (
              <h2 className="mt-1 text-[17px] font-normal leading-snug tracking-[-0.01em]">
                <Link to={`/d/${doc.id}`} className="line-clamp-2 rounded-sm hover:underline hover:decoration-ink/30 hover:underline-offset-4">
                  {doc.title}
                </Link>
              </h2>
            )}
          </div>
          <OverflowMenu label={`More actions for ${doc.title}`} items={items} />
        </div>
        <p className="mt-1 text-[13px] text-muted">
          {formatDuration(started && !finished ? remaining : total)}
          {started && !finished ? " left" : ""}
        </p>

        <div className="mt-3 flex items-center gap-3" aria-label={finished ? "Finished" : `${percent}% listened`}>
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-track">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <span className={`label text-right tabular-nums ${finished ? "" : "w-9"}`}>{finished ? "Finished" : `${percent}%`}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {finished ? (
            <button type="button" className="btn-secondary h-10 px-4 text-[14px]" onClick={() => navigate(`/d/${doc.id}`, { state: { restart: true } })}>
              <RotateCcw size={15} aria-hidden /> Listen again
            </button>
          ) : (
            <button type="button" className="btn-primary h-10 px-4 text-[14px]" onClick={() => navigate(`/d/${doc.id}`)}>
              {started ? <Play size={14} fill="currentColor" strokeWidth={0} aria-hidden /> : <Headphones size={15} aria-hidden />}
              {started ? "Continue" : "Start listening"}
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Delete “${doc.title}”?`}
          body="This removes the document and your place in it from this device. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void remove(doc.id);
          }}
        />
      )}
    </article>
  );
}


function RenameField({ initial, onDone }: { initial: string; onDone(title: string | null): void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      aria-label="Document title"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(value);
        if (e.key === "Escape") onDone(null);
      }}
      className="-ml-2 mt-1 h-9 w-full min-w-0 rounded-lg border border-accent bg-bg px-2 text-[17px] font-normal outline-none ring-2 ring-accent/20"
    />
  );
}
