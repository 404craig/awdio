import { ArrowDown, ArrowUp } from "lucide-react";
import type { DocIndex } from "../../lib/docIndex";
import { pageName } from "../../lib/docIndex";
import { useReader } from "../../state/reader";

/** "Back to reading" chip, shown while playing when the spoken word has scrolled out of view. */
export function BackToReading() {
  const offscreen = useReader((s) => s.activeOffscreen);
  const playing = useReader((s) => s.playing);
  if (!offscreen || !playing) return null;
  const Icon = offscreen === "above" ? ArrowUp : ArrowDown;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center" style={{ bottom: "calc(var(--player-h, 180px) + 14px)" }}>
      <button
        type="button"
        onClick={() => useReader.setState({ attached: true })}
        className="glass animate-rise-in pointer-events-auto flex h-11 items-center gap-2 rounded-full border border-hairline px-4 text-[14px] font-medium tracking-[0.01em] text-ink shadow-lift active:scale-[0.97]"
      >
        <Icon size={16} strokeWidth={2.25} className="text-accent-ink" aria-hidden />
        Back to reading
      </button>
    </div>
  );
}

/** Floating "Page N" label that follows the finger during press-and-hold scrubbing. */
export function ScrubLabel({ index }: { index: DocIndex }) {
  const scrub = useReader((s) => s.textScrub);
  if (!scrub) return null;
  const x = Math.min(Math.max(scrub.x, 72), window.innerWidth - 72);
  return (
    <div className="pointer-events-none fixed z-40" style={{ left: x, top: Math.max(scrub.y - 76, 8) }} aria-live="polite">
      <div
        key={scrub.page}
        className="animate-pop-in whitespace-nowrap rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium tracking-[0.02em] text-bg shadow-lift"
      >
        {pageName(index.pages[scrub.page])}
      </div>
    </div>
  );
}
