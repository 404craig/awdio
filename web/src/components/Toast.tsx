import { useEffect } from "react";
import { useUi } from "../state/ui";

const DURATION_MS = 3200;

export function Toast() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ top: "calc(var(--safe-top) + var(--topbar-h) + 12px)" }}
      role="status"
      aria-live="polite"
    >
      {toast && (
        <div
          key={toast.id}
          className={`glass animate-rise-in pointer-events-auto rounded-full border border-hairline px-4 py-2 text-[14px] font-normal tracking-[0.01em] shadow-lift ${
            toast.tone === "error" ? "text-danger" : "text-ink"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
