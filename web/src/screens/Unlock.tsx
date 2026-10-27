import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { isApiError, unlock } from "../api";
import { Wordmark } from "../components/brand/Wordmark";
import { useSettings } from "../state/settings";

export function Unlock() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pin);
      void useSettings.getState().load();
      navigate(from === "/unlock" ? "/" : from, { replace: true });
    } catch (err) {
      setPin("");
      setAttempt((a) => a + 1);
      setError(
        isApiError(err, "too_many_attempts") || (isApiError(err) && err.status === 429)
          ? "Too many attempts. Try again in a minute."
          : "That PIN didn't work.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-sheet border border-hairline bg-surface px-7 pb-8 pt-10 text-center">
        <Wordmark className="mx-auto h-[28px]" />
        <div className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink" aria-hidden>
          <Lock size={20} strokeWidth={1.6} />
        </div>
        <h1 className="mt-4 text-[20px] font-light tracking-[-0.01em]">Enter your PIN</h1>
        <p className="label mt-2">This awdio is private</p>
        <div key={attempt} className={attempt ? "animate-shake" : ""}>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="current-password"
            maxLength={8}
            aria-label="PIN"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "pin-error" : undefined}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="mt-7 h-14 w-full rounded-card border border-hairline bg-bg text-center text-[26px] tracking-[0.5em] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <p id="pin-error" className="mt-3 min-h-[20px] text-[13px] text-danger" role="alert">
          {error}
        </p>
        <button type="submit" className="btn-primary mt-2 w-full" disabled={pin.length < 4 || busy}>
          {busy ? "Checking…" : "Unlock"}
        </button>
        <p className="label mt-5">This device will be remembered</p>
      </form>
    </div>
  );
}
