/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101311",
        panel: "#171b18",
        line: "#29312c",
        signal: "#9be46a",
        muted: "#87918a",
      },
    },
  },
  plugins: [],
};