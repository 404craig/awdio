import { describe, expect, it } from "vitest";
import { FAKE_VOICES } from "./fakeSpeech";
import { describeVoices, effectiveVoice, groupVoices, onlyStandardVoices, pickDefaultVoice } from "./voices";

const raw = (name: string, lang: string, uri = `${lang}.${name}`) => ({ name, lang, voiceURI: uri, localService: true });

describe("voices", () => {
  it("labels quality from the name and strips the suffix", () => {
    const [v] = describeVoices([raw("Serena (Premium)", "en_GB")]);
    expect(v).toMatchObject({ name: "Serena", lang: "en-GB", quality: "premium" });
    expect(describeVoices([raw("Ava (Enhanced)", "en-US")])[0].quality).toBe("enhanced");
    expect(describeVoices([raw("Bubbles", "en-US")])).toEqual([]); // novelty voices are hidden
  });

  it("defaults to the best British voice, then American", () => {
    const voices = describeVoices([raw("Daniel", "en-GB"), raw("Ava (Enhanced)", "en-US"), raw("Jamie (Enhanced)", "en-GB"), raw("Serena (Premium)", "en-GB")]);
    expect(pickDefaultVoice(voices)?.name).toBe("Serena");
    expect(pickDefaultVoice(voices.filter((v) => v.name !== "Serena"))?.name).toBe("Jamie");
    expect(pickDefaultVoice(describeVoices([raw("Samantha", "en-US"), raw("Thomas", "fr-FR")]))?.name).toBe("Samantha");
    expect(pickDefaultVoice([])).toBeNull();
  });

  it("switches to a newly installed better voice unless one was picked explicitly", () => {
    const before = describeVoices([raw("Daniel", "en-GB")]);
    const after = describeVoices([raw("Daniel", "en-GB"), raw("Serena (Premium)", "en-GB")]);
    expect(effectiveVoice(before, null)?.name).toBe("Daniel");
    expect(effectiveVoice(after, null)?.name).toBe("Serena");
    expect(effectiveVoice(after, "en-GB.Daniel")?.name).toBe("Daniel");
    expect(effectiveVoice(after, "uninstalled")?.name).toBe("Serena");
  });

  it("groups British English first, then American, then other languages", () => {
    const groups = groupVoices(describeVoices(FAKE_VOICES.map((v) => raw(v.name, v.lang))));
    expect(groups.map((g) => g.lang).slice(0, 2)).toEqual(["en-GB", "en-US"]);
    expect(groups[0].voices.map((v) => v.name)).toEqual(["Serena", "Daniel"]); // better quality first
    expect(groups.map((g) => g.lang)).toContain("fr-FR");
  });

  it("knows when only standard voices are installed", () => {
    expect(onlyStandardVoices(describeVoices([raw("Daniel", "en-GB"), raw("Thomas (Enhanced)", "fr-FR")]))).toBe(true);
    expect(onlyStandardVoices(describeVoices([raw("Daniel", "en-GB"), raw("Serena (Premium)", "en-GB")]))).toBe(false);
    expect(onlyStandardVoices([])).toBe(false);
  });
});
