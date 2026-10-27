import { Monitor, Moon, Sun, Coffee } from "lucide-react";
import type { ReadingFont, Theme } from "../../api";
import { formatSpeed, SPEED_MAX, SPEED_MIN, SPEED_STEP } from "../../lib/format";
import { useSettings } from "../../state/settings";
import { useUi, type SettingsTab } from "../../state/ui";
import { Segmented } from "../Segmented";
import { Sheet } from "../Sheet";
import { Slider } from "../Slider";
import { Switch } from "../Switch";
import { VoicePicker } from "./VoicePicker";

const SPEED_MARKS = [0.5, 1, 1.5, 2, 2.5, 3].map((value) => ({ value, label: formatSpeed(value) }));

export function SettingsSheet() {
  const tab = useUi((s) => s.settingsTab);
  const open = useUi((s) => s.openSettings);
  const close = useUi((s) => s.closeSettings);
  if (!tab) return null;
  return (
    <Sheet
      title="Settings"
      onClose={close}
      header={
        <Segmented<SettingsTab>
          label="Settings section"
          value={tab}
          onChange={open}
          options={[
            { value: "listen", label: "Listening" },
            { value: "read", label: "Reading" },
          ]}
        />
      }
    >
      {tab === "listen" ? <ListeningSettings /> : <ReadingSettings />}
    </Sheet>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h3>;
}

function ListeningSettings() {
  const { speed, autoScroll } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  return (
    <div className="space-y-8 pt-3">
      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <SectionTitle>Speed</SectionTitle>
          <span className="text-[15px] font-semibold tabular-nums">{formatSpeed(speed)}</span>
        </div>
        <Slider
          label="Playback speed"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={speed}
          valueText={formatSpeed(speed)}
          onChange={(v) => void update({ speed: v })}
          marks={SPEED_MARKS}
        />
      </section>
      <section>
        <Switch
          label="Follow along"
          description="Keep the spoken word in view while listening."
          checked={autoScroll}
          onChange={(v) => void update({ autoScroll: v })}
        />
      </section>
      <section>
        <SectionTitle>Voice</SectionTitle>
        <VoicePicker />
      </section>
    </div>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "sepia", label: "Sepia", icon: Coffee },
];

const FONTS: { value: ReadingFont; name: string; family: string }[] = [
  { value: "serif", name: "Literata", family: "font-serif" },
  { value: "sans", name: "Inter", family: "font-sans" },
];

function ReadingSettings() {
  const { theme, font, textSize } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  return (
    <div className="space-y-8 pt-3">
      <section>
        <SectionTitle>Theme</SectionTitle>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={(v) => void update({ theme: v })}
          options={THEMES.map(({ value, label, icon: Icon }) => ({
            value,
            label: (
              <>
                <Icon size={15} aria-hidden className="hidden min-[380px]:block" />
                {label}
              </>
            ),
          }))}
        />
      </section>
      <section>
        <SectionTitle>Font</SectionTitle>
        <div role="radiogroup" aria-label="Reading font" className="grid grid-cols-2 gap-3">
          {FONTS.map((f) => {
            const selected = font === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void update({ font: f.value })}
                className={`flex min-h-[84px] flex-col items-start justify-center rounded-card border px-4 py-3 text-left transition duration-150 ${
                  selected ? "border-accent bg-accent/[0.06] ring-1 ring-accent" : "border-hairline hover:bg-ink/[0.025]"
                }`}
              >
                <span className={`${f.family} text-[26px] leading-none`}>Aa</span>
                <span className="mt-2 text-[13px] font-medium text-muted">{f.name}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <SectionTitle>Text size</SectionTitle>
          <span className="text-[15px] font-semibold tabular-nums">{textSize}px</span>
        </div>
        <Slider
          label="Text size"
          min={15}
          max={26}
          step={1}
          value={textSize}
          valueText={`${textSize} pixels`}
          onChange={(v) => void update({ textSize: v })}
          start={<span className="w-4 text-center text-[13px] font-medium text-muted" aria-hidden>A</span>}
          end={<span className="w-4 text-center text-[20px] font-medium text-muted" aria-hidden>A</span>}
        />
        <p className="reading mt-4 rounded-card bg-bg p-4 text-ink" style={{ lineHeight: 1.6 }}>
          Alice was beginning to get very tired of sitting by her sister on the bank.
        </p>
      </section>
    </div>
  );
}
