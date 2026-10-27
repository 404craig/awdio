import { useEffect, useRef } from "react";
import { AudioLines, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReactNode } from "react";
import type { DocIndex } from "../../lib/docIndex";
import { formatSpeed } from "../../lib/format";
import { player, useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { metrics } from "./metrics";
import { SkipIcon } from "./SkipIcon";
import { Timeline } from "./Timeline";

const LONG_PRESS_MS = 500;

/** Bottom player sheet: timeline + transport. Always visible, safe-area aware. */
export function Player({ index }: { index: DocIndex }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      metrics.playerHeight = el.offsetHeight;
      document.documentElement.style.setProperty("--player-h", `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-no-detach
      className="glass fixed inset-x-0 bottom-0 z-30 touch-none rounded-t-sheet border-t border-hairline/80 shadow-sheet"
      style={{ paddingBottom: "max(10px, var(--safe-bottom))" }}
    >
      <div className="mx-auto max-w-[720px] px-4 pt-1.5 sm:px-6">
        <Timeline index={index} />
        <Controls />
      </div>
    </div>
  );
}

function Controls() {
  return (
    <div className="mt-0.5 grid grid-cols-[1fr_auto_1fr] items-center">
      <div className="justify-self-start">
        <SpeedChip />
      </div>
      <div className="flex items-center gap-0.5 min-[380px]:gap-1.5 sm:gap-4">
        <IconButton label="Previous paragraph" onClick={player.prev}>
          <SkipBack size={19} fill="currentColor" strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Back 15 seconds" onClick={() => player.skip(-15)}>
          <SkipIcon direction="back" />
        </IconButton>
        <PlayButton />
        <IconButton label="Forward 15 seconds" onClick={() => player.skip(15)}>
          <SkipIcon direction="forward" />
        </IconButton>
        <IconButton label="Next paragraph" onClick={player.next}>
          <SkipForward size={19} fill="currentColor" strokeWidth={1.5} />
        </IconButton>
      </div>
      <div className="justify-self-end">
        <VoiceChip />
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="tap h-11 w-11 text-ink/85 hover:bg-ink/[0.05] hover:text-ink active:scale-95">
      {children}
    </button>
  );
}

function PlayButton() {
  const playing = useReader((s) => s.playing);
  const buffering = useReader((s) => s.buffering !== null);
  return (
    <button
      type="button"
      onClick={player.toggle}
      aria-label={playing ? "Pause" : "Play"}
      aria-busy={buffering || undefined}
      className="relative mx-0.5 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_6px_20px_-4px_rgb(var(--c-accent)/0.55)] transition duration-150 ease-out hover:brightness-105 active:scale-95"
    >
      {playing ? (
        <Pause size={26} fill="currentColor" strokeWidth={0} />
      ) : (
        <Play size={26} fill="currentColor" strokeWidth={0} className="ml-1" />
      )}
      {buffering && (
        <svg className="pointer-events-none absolute -inset-[5px] animate-spin [animation-duration:900ms]" viewBox="0 0 74 74" aria-hidden>
          <circle cx="37" cy="37" r="35.5" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="56 168" className="stroke-accent" />
        </svg>
      )}
    </button>
  );
}

function SpeedChip() {
  const speed = useSettings((s) => s.settings.speed);
  const openSettings = useUi((s) => s.openSettings);
  const timer = useRef(0);
  const longPressed = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  return (
    <button
      type="button"
      aria-label={`Speed ${formatSpeed(speed)}. Tap to change, press and hold for more.`}
      title="Speed (hold for more)"
      onPointerDown={() => {
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          openSettings("listen");
        }, LONG_PRESS_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (longPressed.current) longPressed.current = false;
        else player.cycleSpeed();
      }}
      className="group flex h-11 items-center"
    >
      <span className="flex h-8 min-w-[52px] items-center justify-center rounded-full bg-ink/[0.06] px-2.5 text-[13px] font-semibold tabular-nums transition-colors group-hover:bg-ink/10">
        {formatSpeed(speed)}
      </span>
    </button>
  );
}

function prettyVoiceId(id: string): string {
  const name = id.includes("_") ? id.split("_").slice(1).join(" ") : id;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function VoiceChip() {
  const { engine, voiceId } = useSettings((s) => s.settings);
  const engines = useSettings((s) => s.engines);
  const openSettings = useUi((s) => s.openSettings);
  const name = engines?.find((e) => e.id === engine)?.voices.find((v) => v.id === voiceId)?.name ?? prettyVoiceId(voiceId);
  return (
    <button type="button" onClick={() => openSettings("listen")} aria-label={`Voice: ${name}. Change voice`} title="Voice" className="group flex h-11 items-center">
      <span className="flex h-8 min-w-[40px] items-center justify-center gap-1.5 rounded-full bg-ink/[0.06] px-2.5 text-[13px] font-semibold transition-colors group-hover:bg-ink/10">
        <AudioLines size={15} aria-hidden />
        <span className="hidden max-w-[88px] truncate sm:inline">{name}</span>
      </span>
    </button>
  );
}
