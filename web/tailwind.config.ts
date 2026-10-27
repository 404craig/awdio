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
        ink: token("ink"),
        muted: token("muted"),
        hairline: token("hairline"),
        accent: token("accent"),
        "on-accent": token("on-accent"),
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["Literata", "Georgia", "serif"],
      },
      borderRadius: {
        card: "12px",
        sheet: "16px",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px rgb(0 0 0 / 0.05)",
        lift: "0 2px 6px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.10)",
        sheet: "0 -1px 0 rgb(var(--c-hairline)), 0 -8px 32px rgb(0 0 0 / 0.06)",
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
