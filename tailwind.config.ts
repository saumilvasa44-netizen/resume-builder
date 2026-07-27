import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f7f8fa",
        panel: "#ffffff",
        panel2: "#f1f3f6",
        border: "#e2e5eb",
        accent: "#4f46e5",
        accent2: "#4338ca",
        muted: "#6b7280",
        good: "#16a34a",
        warn: "#d97706",
        bad: "#dc2626",
      },
    },
  },
  plugins: [],
};
export default config;
