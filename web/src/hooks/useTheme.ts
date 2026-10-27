import { useEffect } from "react";
import { useSettings } from "../state/settings";
import { useMediaQuery } from "./useMediaQuery";

const THEME_COLOR: Record<string, string> = { light: "#FAFAF8", dark: "#111111", sepia: "#F5ECD9" };

/** Applies theme, reading font and text size to <html> as data attributes / CSS variables. */
export function useTheme(): void {
  const { theme, font, textSize } = useSettings((s) => s.settings);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.font = font;
    root.style.setProperty("--reading-size", `${textSize}px`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
  }, [resolved, font, textSize]);
}
