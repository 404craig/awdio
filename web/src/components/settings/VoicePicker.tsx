import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Play, Square } from "lucide-react";
import { voicePreviewUrl, type EngineInfo, type Voice } from "../../api";
import { player } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { ElevenLabsKey } from "./ElevenLabsKey";

const GENDER: Record<Voice["gender"], string> = { female: "Female", male: "Male", neutral: "Neutral" };

function groupByAccent(voices: Voice[]): [string, Voice[]][] {
  const groups = new Map<string, Voice[]>();
  voices.forEach((v) => groups.set(v.accent, [...(groups.get(v.accent) ?? []), v]));
  return [...groups];
}

export function VoicePicker() {
  const engines = useSettings((s) => s.engines);
  const loadVoices = useSettings((s) => s.loadVoices);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void loadVoices();
    return () => preview.current?.pause();
  }, [loadVoices]);

  const togglePreview = (voice: Voice) => {
    const key = `${voice.engine}/${voice.id}`;
    const audio = (preview.current ??= new Audio());
    if (previewing === key) {
      audio.pause();
      setPreviewing(null);
      return;
    }
    player.pause();
    audio.src = voicePreviewUrl(voice.engine, voice.id);
    audio.onended = () => setPreviewing(null);
    audio.play().catch(() => setPreviewing(null));
    setPreviewing(key);
  };

  if (!engines) {
    return (
      <div className="flex items-center gap-2 py-6 text-[14px] text-muted">
        <LoaderCircle size={16} className="animate-spin" aria-hidden /> Loading voices…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {engines.map((e) => (
        <EngineSection key={e.id} engine={e} previewing={previewing} onPreview={togglePreview} />
      ))}
    </div>
  );
}

interface SectionProps {
  engine: EngineInfo;
  previewing: string | null;
  onPreview(voice: Voice): void;
}

function EngineSection({ engine, previewing, onPreview }: SectionProps) {
  const current = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const saveApiKey = useSettings((s) => s.saveApiKey);

  return (
    <section aria-labelledby={`engine-${engine.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`engine-${engine.id}`} className="text-[15px] font-semibold">
            {engine.name}
          </h3>
          <p className="mt-0.5 text-pretty text-[13px] leading-snug text-muted">{engine.description}</p>
        </div>
        {engine.id === "kokoro" && !engine.ready && (
          <span className="pill mt-0.5 shrink-0 bg-ink/[0.06] normal-case tracking-normal text-muted">Loading model…</span>
        )}
      </div>

      {engine.id === "elevenlabs" && !engine.configured ? (
        <ElevenLabsKey />
      ) : (
        <>
          {engine.id === "elevenlabs" && (
            <p className="mt-2 text-[13px] text-muted">
              Voices are fetched from your account.{" "}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => void saveApiKey("").catch(() => {})}
              >
                Remove key
              </button>
            </p>
          )}
          {groupByAccent(engine.voices).map(([accent, voices]) => (
            <div key={accent} className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{accent}</div>
              <ul role="radiogroup" aria-label={`${engine.name} · ${accent} voices`} className="overflow-hidden rounded-card border border-hairline">
                {voices.map((v) => {
                  const selected = current.engine === v.engine && current.voiceId === v.id;
                  const key = `${v.engine}/${v.id}`;
                  return (
                    <li key={v.id} className="flex items-center border-b border-hairline last:border-b-0">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => void update({ engine: v.engine, voiceId: v.id })}
                        className="flex min-h-[52px] flex-1 items-center gap-3 pl-4 text-left transition-colors hover:bg-ink/[0.025]"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                            selected ? "border-accent bg-accent text-on-accent" : "border-ink/20"
                          }`}
                          aria-hidden
                        >
                          {selected && <Check size={13} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium">{v.name}</span>
                          <span className="block text-[12px] text-muted">
                            {GENDER[v.gender]}
                            {v.quality ? ` · Grade ${v.quality}` : ""}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onPreview(v)}
                        className="tap mr-1 text-muted hover:text-ink"
                        aria-label={previewing === key ? `Stop preview of ${v.name}` : `Preview ${v.name}`}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06]">
                          {previewing === key ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
