import type { CSSProperties } from "react";
import type { SourceType } from "../../api";
import { SOURCE_LABEL } from "../../lib/format";

const HUES = [186, 148, 210, 268, 42, 340, 24];

function hueFor(seed: string): number {
  let h = 2166136261; // FNV-1a: stable per document id, well spread
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return HUES[h % HUES.length];
}

export function Cover({ id, title, sourceType }: { id: string; title: string; sourceType: SourceType }) {
  const initial = title.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase() || "a";
  return (
    <div
      className="cover relative flex h-[92px] w-[68px] shrink-0 flex-col justify-between overflow-hidden rounded-[10px] p-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.04)]"
      style={{ "--h": hueFor(id) } as CSSProperties}
      aria-hidden
    >
      <span className="absolute inset-y-0 left-[5px] w-px bg-current opacity-[0.12]" />
      <span className="pl-1.5 font-serif text-[30px] font-semibold leading-none">{initial}</span>
      <span className="pl-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] opacity-70">{SOURCE_LABEL[sourceType]}</span>
    </div>
  );
}
