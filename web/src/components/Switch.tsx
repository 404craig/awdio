interface Props {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  description?: string;
}

export function Switch({ checked, onChange, label, description }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ease-out ${checked ? "bg-accent" : "bg-ink/[0.14]"}`}
      >
        <span
          className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-out ${
            checked ? "translate-x-[23px]" : "translate-x-[3px]"
          }`}
        />
      </span>
    </button>
  );
}
