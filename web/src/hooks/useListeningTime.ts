import { rateEstimator } from "../audio/instance";
import { useSettings } from "../state/settings";
import { useActiveVoice } from "../state/voices";

/** Seconds to listen to `chars` characters with the current voice and speed (measured rate, or a default). */
export function useListeningTime(): (chars: number) => number {
  const voice = useActiveVoice();
  const speed = useSettings((s) => s.settings.speed);
  const cps = rateEstimator.charsPerSecond(voice?.id ?? "default");
  return (chars) => chars / (cps * speed);
}
