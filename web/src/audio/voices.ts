/**
 * System voices: description, ranking, grouping and the default choice. Pure functions over
 * `speechSynthesis.getVoices()` results, so they are unit-tested without a browser.
 */

export type VoiceQuality = "premium" | "enhanced" | "standard";

export interface VoiceInfo {
  /** `voiceURI`, stable across sessions; what settings store. */
  id: string;
  /** Display name without the quality suffix: "Serena". */
  name: string;
  /** BCP 47 tag, normalised: "en-GB". */
  lang: string;
  quality: VoiceQuality;
  local: boolean;
}

export interface VoiceGroup {
  lang: string;
  label: string;
  voices: VoiceInfo[];
}

type RawVoice = Pick<SpeechSynthesisVoice, "voiceURI" | "name" | "lang" | "localService">;

/** Apple's novelty voices: fun, but not for reading a document aloud. */
const NOVELTY = new Set(
  "Albert,Bad News,Bahh,Bells,Boing,Bubbles,Cellos,Good News,Jester,Organ,Superstar,Trinoids,Whisper,Wobble,Zarvox".split(","),
);
const QUALITY_RANK: Record<VoiceQuality, number> = { premium: 2, enhanced: 1, standard: 0 };
const PREFERRED_LANGS = ["en-GB", "en-US"];

export function qualityOf(name: string): VoiceQuality {
  if (/premium/i.test(name)) return "premium";
  if (/enhanced/i.test(name)) return "enhanced";
  return "standard";
}

export const isBetterQuality = (v: VoiceInfo) => v.quality !== "standard";

export function normalizeLang(lang: string): string {
  const [language = "", region = ""] = lang.replace(/_/g, "-").split("-");
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

export function describeVoices(raw: readonly RawVoice[]): VoiceInfo[] {
  const seen = new Set<string>();
  const out: VoiceInfo[] = [];
  for (const v of raw) {
    const name = v.name.replace(/\s*\((premium|enhanced)\)\s*/i, " ").trim();
    if (seen.has(v.voiceURI) || NOVELTY.has(name)) continue;
    seen.add(v.voiceURI);
    out.push({ id: v.voiceURI, name, lang: normalizeLang(v.lang), quality: qualityOf(v.name), local: v.localService });
  }
  return out;
}

const byQualityThenName = (a: VoiceInfo, b: VoiceInfo) =>
  QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] || Number(b.local) - Number(a.local) || a.name.localeCompare(b.name);

/** Best en-GB voice (Premium > Enhanced > other), else best en-US, else any English, else the first. */
export function pickDefaultVoice(voices: readonly VoiceInfo[]): VoiceInfo | null {
  for (const lang of PREFERRED_LANGS) {
    const best = voices.filter((v) => v.lang === lang).sort(byQualityThenName)[0];
    if (best) return best;
  }
  return voices.filter((v) => v.lang.startsWith("en")).sort(byQualityThenName)[0] ?? voices[0] ?? null;
}

/** The voice to speak with: the user's explicit pick while it exists, otherwise the best available. */
export function effectiveVoice(voices: readonly VoiceInfo[], chosen: string | null): VoiceInfo | null {
  return (chosen ? voices.find((v) => v.id === chosen) : undefined) ?? pickDefaultVoice(voices);
}

let displayNames: Intl.DisplayNames | null | undefined;

export function languageLabel(lang: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en-GB"], { type: "language" });
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/** Groups by language: British English first, then American English, then the rest by name. */
export function groupVoices(voices: readonly VoiceInfo[]): VoiceGroup[] {
  const groups = new Map<string, VoiceInfo[]>();
  for (const v of voices) groups.set(v.lang, [...(groups.get(v.lang) ?? []), v]);
  const rank = (lang: string) => {
    const i = PREFERRED_LANGS.indexOf(lang);
    return i >= 0 ? i : PREFERRED_LANGS.length;
  };
  return [...groups]
    .map(([lang, list]) => ({ lang, label: languageLabel(lang), voices: [...list].sort(byQualityThenName) }))
    .sort((a, b) => rank(a.lang) - rank(b.lang) || a.label.localeCompare(b.label));
}

/** True when no English voice of better quality is installed (the tip banner's condition). */
export const onlyStandardVoices = (voices: readonly VoiceInfo[]) =>
  voices.length > 0 && !voices.some((v) => v.lang.startsWith("en") && isBetterQuality(v));
