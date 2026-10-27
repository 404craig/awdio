import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
  header?: ReactNode;
}

const DISMISS_DRAG_PX = 90;

/** Bottom sheet on phones, right-hand side panel on wider screens. */
export function Sheet({ title, onClose, children, header }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery("(min-width: 768px)");
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  useFocusTrap(panelRef, onClose);

  const onHandleDown = (e: ReactPointerEvent) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (dragStart.current !== null) setDrag(Math.max(0, e.clientY - dragStart.current));
  };
  const onHandleUp = () => {
    if (drag > DISMISS_DRAG_PX) onClose();
    dragStart.current = null;
    setDrag(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-40" data-no-detach>
      <div className="animate-fade-in absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          wide
            ? "animate-panel-in absolute bottom-3 right-3 top-3 flex w-[420px] flex-col overflow-hidden rounded-sheet border border-hairline bg-surface shadow-lift outline-none"
            : "animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-sheet bg-surface shadow-lift outline-none"
        }
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        {!wide && (
          <div
            className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            aria-hidden
          >
            <span className="h-[5px] w-9 rounded-full bg-ink/15" />
          </div>
        )}
        <div className={`flex shrink-0 items-center justify-between px-5 ${wide ? "pt-4" : "pt-1"}`}>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
          <button type="button" onClick={onClose} className="tap -mr-2 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        {header && <div className="shrink-0 px-5 pb-1 pt-3">{header}</div>}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(24px+var(--safe-bottom))] pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
