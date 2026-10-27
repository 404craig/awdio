import { WORDMARK_PATH, WORDMARK_VIEWBOX } from "./paths";

/** The "awdio" wordmark (never set in a font). Sized by height; colour follows `currentColor`. */
export function Wordmark({ className = "h-[22px] sm:h-[26px]" }: { className?: string }) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} fill="currentColor" role="img" aria-label="awdio" className={`block w-auto shrink-0 ${className}`}>
      <path fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}
