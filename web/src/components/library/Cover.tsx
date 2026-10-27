import { Mark } from "../brand/Mark";

const VARIANTS = ["cover-ivory", "cover-black", "cover-silver"] as const;

function variantFor(seed: string): string {
  let h = 2166136261; // FNV-1a: stable per document id
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return VARIANTS[(h >>> 16) % VARIANTS.length]; // upper bits mix best
}

/** A quiet typographic "object" in the brand materials: near-black, ivory or brushed silver. */
export function Cover({ id, title }: { id: string; title: string }) {
  const initial = title.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase() || "a";
  return (
    <div
      className={`${variantFor(id)} relative flex h-[96px] w-[72px] shrink-0 flex-col justify-between overflow-hidden rounded-[10px] p-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06),0_0_0_1px_rgb(var(--c-hairline))]`}
      aria-hidden
    >
      <span className="text-[32px] font-light leading-none tracking-[-0.02em]">{initial}</span>
      <Mark className="h-[9px] self-end opacity-70" />
    </div>
  );
}
