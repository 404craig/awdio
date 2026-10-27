import { ALargeSmall, AudioLines, ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { pageNumber, pageOfOrdinal, type DocIndex } from "../../lib/docIndex";
import { useReader } from "../../state/reader";
import { useUi } from "../../state/ui";

export function TopBar({ index }: { index: DocIndex }) {
  const page = useReader((s) => (s.scrub ? pageOfOrdinal(index, s.scrub.ordinal) : s.textScrub ? s.textScrub.page : s.viewPage));
  const openSettings = useUi((s) => s.openSettings);
  return (
    <header className="glass fixed inset-x-0 top-0 z-30 border-b border-hairline/70" style={{ paddingTop: "var(--safe-top)" }}>
      <div className="mx-auto flex h-14 max-w-[960px] items-center gap-1 px-1.5 sm:px-4">
        <Link to="/" className="tap text-ink hover:bg-ink/5" aria-label="Back to library">
          <ChevronLeft size={24} strokeWidth={2} />
        </Link>
        <div className="min-w-0 flex-1 px-1 leading-tight">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{index.doc.title}</h1>
          <p className="text-[12px] font-medium tabular-nums text-muted" aria-live="polite">
            p. {pageNumber(index.pages[page])} / {index.pages.length}
          </p>
        </div>
        <button type="button" className="tap text-ink hover:bg-ink/5" aria-label="Reading settings" title="Display" onClick={() => openSettings("read")}>
          <ALargeSmall size={22} strokeWidth={1.75} />
        </button>
        <button type="button" className="tap text-ink hover:bg-ink/5" aria-label="Voice settings" title="Voice" onClick={() => openSettings("listen")}>
          <AudioLines size={20} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
