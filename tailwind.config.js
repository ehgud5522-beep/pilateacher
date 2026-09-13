/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      /* 기본 크기 눈금(text-xs·text-sm…)은 아직 남겨 둔다. 791곳이 그것을
         쓰고 있고, 화면 단위로 옮기는 중이라 두 눈금이 잠시 공존한다.
         옮기기가 끝나면 extend 가 아니라 theme.fontSize 로 바꿔 기본
         눈금을 없앤다 -- 그때가 크기가 여섯 개가 되는 시점이다.

         줄간격은 여기에 넣지 않았다. 지금 단계는 크기만 옮기는 리팩터이고,
         임의 크기(text-[10px])에는 줄간격이 붙지 않으므로 여기에 넣으면
         화면이 조용히 달라진다. 줄간격은 화면을 보면서 3단계에서 정한다. */
      fontSize: {
        caption: "var(--t-caption)",
        body: "var(--t-body)",
        title: "var(--t-title)",
        heading: "var(--t-heading)",
        display: "var(--t-display)",
        hero: "var(--t-hero)",
      },
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
