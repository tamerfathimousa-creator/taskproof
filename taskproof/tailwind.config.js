/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#EDF1EF",
        surface: "#FFFFFF",
        surface2: "#F5F8F6",
        ink: "#12231F",
        muted: "#5B6B66",
        line: "#DAE2DF",
        accent: "#0E7C66",
        accentInk: "#FFFFFF",
        accentSoft: "#DDF1EA",
        warm: "#D9922A",
        warmSoft: "#FBEBD0",
        bad: "#C2452D",
        badSoft: "#F9E0DA",
        deep: "#0B2B26",
      },
      fontFamily: {
        display: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
