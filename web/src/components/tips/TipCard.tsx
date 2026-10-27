import type { ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** A small explanatory card (voice tip, Add to Home Screen). Dismissible when `onDismiss` is given. */
export function TipCard({ icon, title, children, onDismiss, className = "" }: Props) {
  return (
    <aside className={`flex gap-3 rounded-card border border-hairline bg-surface p-4 ${className}`} aria-label={title}>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/[0.1] text-accent-ink" aria-hidden>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-snug tracking-[-0.005em]">{title}</p>
        <div className="mt-1 text-pretty text-[13.5px] leading-relaxed text-muted">{children}</div>
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="tap -mr-2 -mt-2 h-10 w-10 shrink-0 text-muted hover:bg-ink/5" aria-label={`Dismiss: ${title}`}>
          <X size={17} />
        </button>
      )}
    </aside>
  );
}
