import type { CSSProperties, ReactNode } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(value: number): void;
  label: string;
  valueText?: string;
  start?: ReactNode;
  end?: ReactNode;
  /** Values that get a small tick under the track. */
  marks?: { value: number; label: string }[];
}

export function Slider({ value, min, max, step, onChange, label, valueText, start, end, marks }: Props) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center gap-3">
        {start}
        <input
          type="range"
          className="range flex-1"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ "--fill": `${fill}%` } as CSSProperties}
        />
        {end}
      </div>
      {marks && (
        <div className="relative mx-[11px] mt-1 h-4 text-[11px] font-medium tabular-nums text-muted" aria-hidden>
          {marks.map((m) => (
            <span
              key={m.value}
              className="absolute -translate-x-1/2"
              style={{ left: `${((m.value - min) / (max - min)) * 100}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
