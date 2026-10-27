import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { pageName, pageOfOrdinal, positionAt, snippet, tickStep } from "../../lib/docIndex";
import { formatDuration, formatPercent } from "../../lib/format";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { Mark } from "../brand/Mark";
import { player, selectOrdinal, useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import type { DocIndex } from "../../lib/docIndex";

const BUBBLE_W = 264;

/** Document-wide scrubber over global word ordinals. Seeks to the target block on release. */
export function Timeline({ index }: { index: DocIndex }) {
  const ordinal = useReader(selectOrdinal);
  const scrub = useReader((s) => s.scrub);
  const voiceLoading = useReader((s) => s.buffering === "voice");
  const slowAudio = useDelayedFlag(useReader((s) => s.buffering === "loading"), 1500);
  const speed = useSettings((s) => s.settings.speed);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const maxOrdinal = Math.max(1, index.totalWords - 1);
  const shown = scrub?.ordinal ?? ordinal;
  const fraction = shown / maxOrdinal;
  const page = index.pages[pageOfOrdinal(index, shown)];
  const remaining = ((index.totalWords - shown) * player.secondsPerWord()) / speed;

  const ordinalAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.round(Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * maxOrdinal);
  };

  const commit = (target: number) => {
    const pos = positionAt(index, target);
    player.seekTo({ blockIndex: pos.blockIndex, wordIndex: 0 });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setTrackWidth(e.currentTarget.getBoundingClientRect().width);
    useReader.setState({ scrub: { ordinal: ordinalAt(e.clientX) } });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (useReader.getState().scrub) useReader.setState({ scrub: { ordinal: ordinalAt(e.clientX) } });
  };
  const onPointerUp = () => {
    const current = useReader.getState().scrub;
    if (!current) return;
    useReader.setState({ scrub: null });
    commit(current.ordinal);
  };
  const onPointerCancel = () => useReader.setState({ scrub: null });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 0.01, ArrowUp: 0.01, ArrowLeft: -0.01, ArrowDown: -0.01, PageUp: 0.1, PageDown: -0.1 }[e.key];
    let target: number | null = step === undefined ? null : ordinal + step * maxOrdinal;
    if (e.key === "Home") target = 0;
    if (e.key === "End") target = maxOrdinal;
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    commit(Math.min(Math.max(Math.round(target), 0), maxOrdinal));
  };

  const step = tickStep(index.pages.length);
  const ticks: number[] = [];
  for (let p = step; p < index.pages.length; p += step) ticks.push(index.pageStartOrdinal[p] / maxOrdinal);

  const bubbleWidth = Math.min(BUBBLE_W, trackWidth);
  const bubbleLeft = Math.min(Math.max(fraction * trackWidth - bubbleWidth / 2, -4), trackWidth - bubbleWidth + 4);
  const targetBlock = scrub ? index.blocks[positionAt(index, scrub.ordinal).blockIndex] : null;

  return (
    <div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Position in document"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuetext={`${pageName(page)}, ${formatPercent(fraction)}`}
        data-scrubber
        className="group relative h-11 cursor-pointer touch-none select-none rounded-full focus-visible:outline-offset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-track">
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${fraction * 100}%` }} />
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-ink/[0.14]" style={{ left: `${t * 100}%` }} />
          ))}
        </div>
        <div
          className={`absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FBFAF7] shadow-[0_1px_3px_rgb(0_0_0/0.25),0_0_0_0.5px_rgb(0_0_0/0.08)] transition-transform duration-150 ease-out ${
            scrub ? "scale-[1.35]" : "group-hover:scale-110"
          }`}
          style={{ left: `${fraction * 100}%` }}
          aria-hidden
        />
        {scrub && targetBlock && trackWidth > 0 && (
          <div
            className="animate-rise-in pointer-events-none absolute bottom-[calc(100%+6px)] rounded-card border border-hairline bg-raised px-3.5 py-2.5 shadow-lift"
            style={{ left: bubbleLeft, width: bubbleWidth }}
            aria-hidden
          >
            <div className="flex items-baseline justify-between gap-2 text-[13px] font-medium tabular-nums">
              <span className="truncate">{pageName(page)}</span>
              <span className="text-accent-ink">{formatPercent(fraction)}</span>
            </div>
            <div className="mt-1 line-clamp-2 font-serif text-[13px] leading-snug text-muted">{snippet(targetBlock)}</div>
          </div>
        )}
      </div>
      <div className="-mt-1.5 flex items-center justify-between text-[12px] font-normal tabular-nums tracking-[0.02em] text-muted">
        <span>{formatPercent(fraction)}</span>
        {voiceLoading || slowAudio ? (
          <span className="flex items-center gap-1.5 text-accent-ink" role="status">
            <Mark animated className="h-2.5" />
            {voiceLoading ? "Preparing voice…" : "Preparing audio…"}
          </span>
        ) : (
          <span>{remaining > 1 ? `${formatDuration(remaining)} left` : "Done"}</span>
        )}
      </div>
    </div>
  );
}
