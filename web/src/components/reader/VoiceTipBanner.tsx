import { onlyStandardVoices } from "../../audio/voices";
import { useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { useVoices } from "../../state/voices";
import { VoiceTip } from "../tips/VoiceTip";

/**
 * One-time banner above the player while the device only has standard-quality voices.
 * Steps aside for the "Back to reading" chip, which uses the same spot.
 */
export function VoiceTipBanner() {
  const voices = useVoices((s) => s.voices);
  const dismissed = useSettings((s) => s.settings.voiceTipDismissed);
  const update = useSettings((s) => s.update);
  const chipShown = useReader((s) => s.playing && s.activeOffscreen !== null);
  if (dismissed || chipShown || !onlyStandardVoices(voices)) return null;
  return (
    <div data-no-detach className="animate-rise-in fixed inset-x-0 z-20 px-3" style={{ bottom: "calc(var(--player-h, 180px) + 10px)" }}>
      <VoiceTip className="mx-auto max-w-[560px] shadow-lift" onDismiss={() => void update({ voiceTipDismissed: true })} />
    </div>
  );
}
