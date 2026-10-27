import { MARK_PATH, MARK_VIEWBOX } from "./paths";

interface Props {
  className?: string;
  /** A soft pulse travels along the wave (static under prefers-reduced-motion). */
  animated?: boolean;
  label?: string;
}

/** The wave "w" app mark; stroke follows `currentColor`. */
export function Mark({ className = "h-6", animated = false, label }: Props) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={13}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block w-auto shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {animated ? (
        <>
          <path d={MARK_PATH} opacity={0.28} />
          <path d={MARK_PATH} pathLength={100} className="mark-pulse" />
        </>
      ) : (
        <path d={MARK_PATH} />
      )}
    </svg>
  );
}
