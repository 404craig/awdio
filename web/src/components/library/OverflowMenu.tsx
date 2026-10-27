import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

export interface MenuItem {
  label: string;
  icon: ReactNode;
  onSelect(): void;
  destructive?: boolean;
}

export function OverflowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="tap -mr-2 -mt-2 text-muted hover:bg-ink/5 hover:text-ink"
      >
        <Ellipsis size={20} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="animate-rise-in absolute right-0 top-10 z-20 min-w-[200px] overflow-hidden rounded-card border border-hairline bg-surface py-1.5 shadow-lift"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-[15px] outline-none transition-colors hover:bg-ink/[0.04] focus-visible:bg-ink/[0.05] ${
                item.destructive ? "text-[#D92D20] dark:text-[#FF6B5E]" : "text-ink"
              }`}
            >
              <span className={item.destructive ? "" : "text-muted"} aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
