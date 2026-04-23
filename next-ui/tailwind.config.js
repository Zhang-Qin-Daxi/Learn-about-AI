/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./pages/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["SF Pro Display", "PingFang SC", "Noto Sans SC", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        composer: "0 16px 40px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04)",
      },
    },
  },
  plugins: [],
};
