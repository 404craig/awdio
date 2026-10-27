import { FileText, TriangleAlert, X } from "lucide-react";
import { useLibrary, type Upload } from "../../state/library";

export function UploadCard({ upload }: { upload: Upload }) {
  const dismiss = useLibrary((s) => s.dismissUpload);
  const failed = upload.phase === "error";
  const label = failed ? upload.error : upload.phase === "uploading" ? `Uploading… ${Math.round(upload.progress * 100)}%` : "Analysing structure…";
  return (
    <div
      className={`animate-rise-in flex items-center gap-4 rounded-card border bg-surface p-4 ${failed ? "border-[#F5C2B8] dark:border-[#5A2A22]" : "border-hairline"}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${failed ? "bg-[#FDECE8] text-[#C4320A] dark:bg-[#3A1D17] dark:text-[#FF8A5B]" : "bg-accent/10 text-accent"}`}
        aria-hidden
      >
        {failed ? <TriangleAlert size={19} /> : <FileText size={19} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{upload.name}</p>
        <p className={`mt-0.5 text-[13px] ${failed ? "text-[#C4320A] dark:text-[#FF8A5B]" : "text-muted"}`}>{label}</p>
        {!failed && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/[0.08]">
            <div
              className={`h-full rounded-full bg-accent transition-[width] duration-300 ${upload.phase === "analysing" ? "animate-pulse" : ""}`}
              style={{ width: `${Math.max(4, upload.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {failed && (
        <button type="button" onClick={() => dismiss(upload.id)} className="tap text-muted hover:bg-ink/5" aria-label="Dismiss">
          <X size={18} />
        </button>
      )}
    </div>
  );
}
