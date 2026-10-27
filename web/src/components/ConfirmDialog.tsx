import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onCancel);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="animate-fade-in absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onCancel} aria-hidden />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        tabIndex={-1}
        className="animate-rise-in relative w-full max-w-[380px] rounded-sheet bg-surface p-6 shadow-lift outline-none"
      >
        <h2 id="confirm-title" className="text-[19px] font-medium tracking-[-0.015em]">
          {title}
        </h2>
        <p id="confirm-body" className="mt-2 text-[15px] leading-relaxed text-muted">
          {body}
        </p>
        <div className="mt-6 flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-[#D92D20] px-5 text-[15px] font-medium text-white transition hover:opacity-90 active:scale-[0.98]"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
