export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-semibold tracking-[-0.03em] text-ink ${className}`} aria-label="awdio">
      awdio
      <span className="ml-[0.06em] inline-block h-[0.22em] w-[0.22em] rounded-full bg-accent" aria-hidden />
    </span>
  );
}
