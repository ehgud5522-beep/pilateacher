/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        page: "var(--page)",
        card: "var(--card)",
        canvas: "var(--canvas)",
        line: "var(--line)",
        ink: "var(--ink)",
        ink2: "var(--ink2)",
        sub: "var(--sub)",
        faint: "var(--faint)",
        primary: "var(--primary)",
        brand: "var(--brand)",
        tint: "var(--tint)",
        ring: "var(--ring)",
        toast: "var(--toast)",
        photo: "var(--photo)",
        good: "var(--good)",
        "good-s": "var(--good-s)",
        bad: "var(--bad)",
        "bad-s": "var(--bad-s)",
        warn: "var(--warn)",
        "warn-s": "var(--warn-s)",
        mint: "var(--mint)",
      },
      boxShadow: {
        theme: "var(--shadow)",
      },
      backgroundImage: {
        grad: "var(--grad)",
        "grad-soft": "var(--grad-soft)",
        "splash-bg": "var(--splash-bg)",
        glow: "var(--glow)",
      },
    },
  },
  plugins: [],
};
