import { useState, type FormEvent } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { isApiError } from "../../api";
import { useSettings } from "../../state/settings";

export function ElevenLabsKey() {
  const saveApiKey = useSettings((s) => s.saveApiKey);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await saveApiKey(key.trim());
      setKey("");
    } catch (err) {
      setError(isApiError(err, "invalid_api_key") ? "ElevenLabs didn't accept that key." : "Couldn't save the key. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 rounded-card border border-hairline p-4">
      <label htmlFor="eleven-key" className="flex items-center gap-2 text-[14px] font-medium">
        <KeyRound size={16} className="text-muted" aria-hidden />
        API key
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="eleven-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk_…"
          className="h-11 min-w-0 flex-1 rounded-full border border-hairline bg-bg px-4 text-[15px] outline-none transition focus:border-accent"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "eleven-key-error" : undefined}
        />
        <button type="submit" className="btn-primary px-4" disabled={saving || !key.trim()}>
          {saving ? "Checking…" : "Save"}
        </button>
      </div>
      {error && (
        <p id="eleven-key-error" className="mt-2 text-[13px] text-[#C4320A] dark:text-[#FF8A5B]">
          {error}
        </p>
      )}
      <a
        href="https://elevenlabs.io/app/settings/api-keys"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex min-h-[32px] items-center gap-1 text-[13px] font-medium text-accent hover:underline"
      >
        Get a key from your ElevenLabs account
        <ExternalLink size={13} aria-hidden />
      </a>
    </form>
  );
}
