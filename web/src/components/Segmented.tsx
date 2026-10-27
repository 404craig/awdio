import type { ReactNode } from "react";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange(value: T): void;
  label: string;
  className?: string;
}

export function Segmented<T extends string>({ value, options, onChange, label, className = "" }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex rounded-full bg-ink/[0.06] p-1 ${className}`}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={`flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition duration-150 ease-out ${
              selected ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
