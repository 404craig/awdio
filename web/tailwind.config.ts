import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        raised: token("raised"),
        ink: token("ink"),
        muted: token("muted"),
        hairline: token("hairline"),
        accent: token("accent"),
        "accent-ink": token("accent-ink"),
        "on-accent": token("on-accent"),
        primary: token("primary"),
        "on-primary": token("on-primary"),
        danger: token("danger"),
        track: "var(--track)",
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["Literata", "Georgia", "serif"],
        "reading-sans": ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
        sheet: "20px",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(var(--shadow-color) / 0.02), 0 2px 12px rgb(var(--shadow-color) / 0.02)",
        lift: "0 2px 8px rgb(var(--shadow-color) / 0.04), 0 16px 40px rgb(var(--shadow-color) / 0.08)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      transitionDuration: {
        DEFAULT: "180ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
