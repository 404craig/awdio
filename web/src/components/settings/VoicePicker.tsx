import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, LoaderCircle, MicOff, Play, Square } from "lucide-react";
import { speech } from "../../audio/instance";
import { groupVoices, isBetterQuality, onlyStandardVoices, type VoiceGroup, type VoiceInfo } from "../../audio/voices";
import { useSettings } from "../../state/settings";
import { platformVoice, useActiveVoice, useVoices } from "../../state/voices";
import { VoiceTip } from "../tips/VoiceTip";

const SAMPLE = "Alice was beginning to get very tired of sitting by her sister on the bank.";

function usePreview() {
  const [previewing, setPreviewing] = useState<string | null>(null);
  useEffect(() => () => speech.stopPreview(), []);
  const toggle = (voice: VoiceInfo) => {
    if (previewing === voice.id) {
      speech.stopPreview();
      return;
    }
    const platform = platformVoice(voice.id);
    if (!platform) return;
    setPreviewing(voice.id);
    // Called inside the tap, so iOS lets it speak.
    speech.previewVoice(platform, SAMPLE, () => setPreviewing((id) => (id === voice.id ? null : id)));
  };
  return { previewing, toggle };
}

export function VoicePicker() {
  const { voices, status } = useVoices();
  const chosen = useSettings((s) => s.settings.voiceURI);
  const update = useSettings((s) => s.update);
  const active = useActiveVoice();
  const preview = usePreview();

  if (status === "unsupported" || (status === "ready" && voices.length === 0)) return <NoVoices unsupported={status === "unsupported"} />;
  if (voices.length === 0) {
    return (
      <div className="flex items-center gap-2 py-6 text-[14px] text-muted">
        <LoaderCircle size={16} className="animate-spin" aria-hidden /> Loading voices…
      </div>
    );
  }

  const groups = groupVoices(voices);
  const english = groups.filter((g) => g.lang.startsWith("en"));
  const others = groups.filter((g) => !g.lang.startsWith("en"));
  const select = (id: string | null) => void update({ voiceURI: id });
  const rowProps = { chosen, previewing: preview.previewing, onSelect: select, onPreview: preview.toggle };

  return (
    <div className="space-y-5">
      {onlyStandardVoices(voices) && <VoiceTip />}
      <ul role="radiogroup" aria-label="Voice choice" className="overflow-hidden rounded-card border border-hairline">
        <li className="flex items-center">
          <RadioButton selected={chosen === null} onClick={() => select(null)}>
            <span className="block text-[15px] font-normal">Best available</span>
            <span className="block text-[12px] tracking-[0.01em] text-muted">
              {active ? `Now ${active.name}` : "None installed"} · switches to better voices you install
            </span>
          </RadioButton>
        </li>
      </ul>
      {english.map((g) => (
        <Group key={g.lang} group={g} {...rowProps} />
      ))}
      {others.length > 0 && (
        <details className="group/more">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-card px-1 text-[15px] [&::-webkit-details-marker]:hidden">
            Other languages
            <ChevronDown size={18} className="text-muted transition-transform group-open/more:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2 space-y-5">
            {others.map((g) => (
              <Group key={g.lang} group={g} {...rowProps} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

interface RowProps {
  chosen: string | null;
  previewing: string | null;
  onSelect(id: string): void;
  onPreview(voice: VoiceInfo): void;
}

function Group({ group, chosen, previewing, onSelect, onPreview }: RowProps & { group: VoiceGroup }) {
  return (
    <div>
      <div className="label mb-1.5">{group.label}</div>
      <ul role="radiogroup" aria-label={`${group.label} voices`} className="overflow-hidden rounded-card border border-hairline">
        {group.voices.map((v) => (
          <li key={v.id} className="flex items-center border-b border-hairline last:border-b-0">
            <RadioButton selected={chosen === v.id} onClick={() => onSelect(v.id)}>
              <span className="block text-[15px] font-normal">{v.name}</span>
              {isBetterQuality(v) && <span className="block text-[12px] tracking-[0.01em] text-accent-ink">Better quality</span>}
            </RadioButton>
            <button
              type="button"
              onClick={() => onPreview(v)}
              className="tap mr-1 text-muted hover:text-ink"
              aria-label={previewing === v.id ? `Stop preview of ${v.name}` : `Preview ${v.name}`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/[0.06]">
                {previewing === v.id ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RadioButton({ selected, onClick, children }: { selected: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="flex min-h-[52px] flex-1 items-center gap-3 py-2 pl-4 pr-3 text-left transition-colors hover:bg-ink/[0.025]"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
          selected ? "border-accent bg-accent text-on-accent" : "border-ink/20"
        }`}
        aria-hidden
      >
        {selected && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

function NoVoices({ unsupported }: { unsupported: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-ink/20 px-5 py-8 text-center" role="status">
      <MicOff size={22} className="text-muted" aria-hidden />
      <p className="mt-3 text-[16px] font-medium">{unsupported ? "This browser can't read aloud" : "No voices available on this device"}</p>
      <p className="mt-1.5 max-w-[300px] text-pretty text-[13.5px] leading-relaxed text-muted">
        {unsupported
          ? "Open awdio in Safari on your iPhone to listen."
          : "On iPhone, add one in Settings → Accessibility → Spoken Content → Voices, then come back. You can still read here."}
      </p>
    </div>
  );
}
