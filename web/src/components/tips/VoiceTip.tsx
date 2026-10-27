import { Sparkles } from "lucide-react";
import { TipCard } from "./TipCard";

const PATH = ["Settings", "Accessibility", "Spoken Content", "Voices", "English"];

/** How to install a better (free) system voice on iPhone. */
export function VoiceTip({ onDismiss, className }: { onDismiss?: () => void; className?: string }) {
  return (
    <TipCard icon={<Sparkles size={16} />} title="Want a more natural voice? It's free." onDismiss={onDismiss} className={className}>
      On your iPhone: <span className="text-ink">{PATH.join(" → ")}</span> → download an Enhanced or Premium voice (for example
      Serena, Jamie or Daniel). awdio will use it automatically.
    </TipCard>
  );
}
