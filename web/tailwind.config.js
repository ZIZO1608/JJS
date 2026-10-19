import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Colors come from CSS variables in src/styles.css (light + dark). */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(here, "index.html"), path.join(here, "src/**/*.{ts,tsx}")],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        sunken: v("sunken"),
        line: v("line"),
        ink: v("ink"),
        muted: v("muted"),
        faint: v("faint"),
        brand: v("brand"),
        good: v("good"),
        warn: v("warn"),
        bad: v("bad"),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', '"IBM Plex Sans"', "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "12px", "2xl": "14px" },
    },
  },
  plugins: [],
};
