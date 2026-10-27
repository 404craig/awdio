/** Circular arrow with "15", like the system podcast controls. */
export function SkipIcon({ direction, size = 28 }: { direction: "back" | "forward"; size?: number }) {
  const flip = direction === "forward";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden>
      <g transform={flip ? "translate(28 0) scale(-1 1)" : undefined} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.2 10.5A10 10 0 1 1 4 15" />
        <path d="M4.6 5.2v5.6h5.6" />
      </g>
      <text x="14.6" y="18.4" textAnchor="middle" fontSize="8.6" fontWeight="600" fill="currentColor" fontFamily="Inter, system-ui, sans-serif">
        15
      </text>
    </svg>
  );
}
