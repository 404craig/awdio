import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AudioWaveform, CircleCheck, Headphones, Pencil, Play, Square, Trash2 } from "lucide-react";
import type { DocumentSummary } from "../../api";
import { formatDuration } from "../../lib/format";
import { useLibrary } from "../../state/library";
import { ConfirmDialog } from "../ConfirmDialog";
import { ProgressRing } from "../ProgressRing";
import { Cover } from "./Cover";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";

export function DocumentCard({ doc }: { doc: DocumentSummary }) {
  const navigate = useNavigate();
  const { rename, remove, prepare, stopPrepare } = useLibrary();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const percent = Math.round(doc.progress?.percent ?? 0);
  const started = (doc.progress?.wordOrdinal ?? 0) > 0;
  const preparing = doc.prepare.status === "running";
  const prepared = doc.prepare.status === "done";
  const remaining = doc.estimatedSeconds * (1 - percent / 100);

  const items: MenuItem[] = [{ label: "Rename", icon: <Pencil size={17} />, onSelect: () => setEditing(true) }];
  if (preparing) items.push({ label: "Stop preparing", icon: <Square size={16} />, onSelect: () => void stopPrepare(doc.id) });
  else if (!prepared) items.push({ label: "Prepare audio", icon: <AudioWaveform size={17} />, onSelect: () => void prepare(doc.id) });
  items.push({ label: "Delete", icon: <Trash2 size={17} />, onSelect: () => setConfirming(true), destructive: true });

  return (
    <article className="flex gap-4 rounded-card border border-hairline bg-surface p-4 shadow-soft transition-shadow duration-200 hover:shadow-lift">
      <Link to={`/d/${doc.id}`} tabIndex={-1} aria-hidden className="shrink-0">
        <Cover id={doc.id} title={doc.title} sourceType={doc.sourceType} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          {editing ? (
            <RenameField
              initial={doc.title}
              onDone={(title) => {
                setEditing(false);
                if (title !== null) void rename(doc.id, title);
              }}
            />
          ) : (
            <h2 className="min-w-0 flex-1 text-[16px] font-semibold leading-snug tracking-[-0.01em]">
              <Link to={`/d/${doc.id}`} className="line-clamp-2 rounded-sm hover:underline hover:decoration-ink/30 hover:underline-offset-2">
                {doc.title}
              </Link>
            </h2>
          )}
          <OverflowMenu label={`More actions for ${doc.title}`} items={items} />
        </div>
        <p className="mt-0.5 text-[13px] text-muted">
          {formatDuration(started ? remaining : doc.estimatedSeconds)}
          {started ? " left" : ""} · {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
        </p>

        <div className="mt-3 flex items-center gap-2.5" aria-label={`${percent}% listened`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-8 text-right text-[12px] font-medium tabular-nums text-muted">{percent}%</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <button type="button" className="btn-primary h-10 px-4 text-[14px]" onClick={() => navigate(`/d/${doc.id}`)}>
            {started ? <Play size={15} fill="currentColor" strokeWidth={0} aria-hidden /> : <Headphones size={16} aria-hidden />}
            {started ? "Continue" : "Start listening"}
          </button>
          <PrepareStatus doc={doc} />
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Delete “${doc.title}”?`}
          body="This removes the document, your place in it and any prepared audio. This can't be undone."
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

function PrepareStatus({ doc }: { doc: DocumentSummary }) {
  const { status, done, total } = doc.prepare;
  if (status === "running") {
    const value = total > 0 ? done / total : 0;
    return (
      <span className="flex items-center gap-2 text-[12px] font-medium tabular-nums text-muted">
        <ProgressRing value={value} size={18} label={`Preparing audio, ${Math.round(value * 100)}%`} />
        Preparing {Math.round(value * 100)}%
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <CircleCheck size={15} className="text-[#2F9E44]" aria-hidden /> Audio ready
      </span>
    );
  }
  if (status === "error") return <span className="text-[12px] font-medium text-[#C4320A]">Preparing failed</span>;
  return null;
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
      className="-ml-2 h-9 min-w-0 flex-1 rounded-lg border border-accent bg-bg px-2 text-[16px] font-semibold outline-none ring-2 ring-accent/20"
    />
  );
}
