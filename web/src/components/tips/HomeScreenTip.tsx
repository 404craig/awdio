import { Share } from "lucide-react";
import { useSettings } from "../../state/settings";
import { TipCard } from "./TipCard";

/** iPhone Safari, not yet installed: suggest Add to Home Screen (full screen, offline, lock-screen controls). */
function shouldSuggest(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  return iOS && safari && !standalone;
}

export function HomeScreenTip() {
  const dismissed = useSettings((s) => s.settings.homeScreenTipDismissed);
  const update = useSettings((s) => s.update);
  if (dismissed || !shouldSuggest()) return null;
  return (
    <TipCard
      icon={<Share size={15} />}
      title="Add awdio to your Home Screen"
      onDismiss={() => void update({ homeScreenTipDismissed: true })}
      className="mb-5"
    >
      Tap Share, then Add to Home Screen.
    </TipCard>
  );
}
