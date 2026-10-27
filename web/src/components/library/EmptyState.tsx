import { Mark } from "../brand/Mark";

export function EmptyState({ onChoose, dragging }: { onChoose(): void; dragging: boolean }) {
  return (
    <div
      className={`flex flex-col items-center rounded-sheet border border-dashed px-6 py-16 text-center transition-colors duration-200 sm:py-24 ${
        dragging ? "border-accent bg-accent/[0.05]" : "border-ink/20"
      }`}
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-primary text-on-primary" aria-hidden>
        <Mark className="h-[22px]" />
      </div>
      <p className="label mt-8">Your library is empty</p>
      <h2 className="mt-3 max-w-[320px] text-balance text-[26px] font-light leading-tight tracking-[-0.02em]">Add something to listen to.</h2>
      <p className="mt-3 max-w-[300px] text-pretty text-[15px] leading-relaxed text-muted">Drop a PDF, EPUB, DOCX or text file here and awdio will read it to you.</p>
      <button type="button" className="btn-primary mt-8" onClick={onChoose}>
        Choose a file
      </button>
      <p className="label mt-5">Up to 50 MB · Stays on your server</p>
    </div>
  );
}
