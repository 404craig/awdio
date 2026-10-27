import { CloudUpload } from "lucide-react";

export function EmptyState({ onChoose, dragging }: { onChoose(): void; dragging: boolean }) {
  return (
    <div
      className={`flex flex-col items-center rounded-[20px] border-2 border-dashed px-6 py-16 text-center transition-colors duration-200 sm:py-24 ${
        dragging ? "border-accent bg-accent/[0.05]" : "border-ink/[0.14]"
      }`}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent" aria-hidden>
        <CloudUpload size={28} strokeWidth={1.75} />
      </div>
      <h2 className="mt-6 text-[20px] font-semibold tracking-[-0.01em]">Your library is empty</h2>
      <p className="mt-2 max-w-[300px] text-pretty text-[15px] leading-relaxed text-muted">Drop a PDF, EPUB, DOCX or text file here and awdio will read it to you.</p>
      <button type="button" className="btn-primary mt-7" onClick={onChoose}>
        Choose a file
      </button>
      <p className="mt-4 text-[12px] text-muted">Up to 50 MB · Stays on your server</p>
    </div>
  );
}
