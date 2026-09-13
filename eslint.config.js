export default [
  {
    ignores: [
      "android/**",
      "ios/**",
      "dist/**",
      "node_modules/**",
      "src/App-backup*.jsx",
      "src/App.j",
      "src/pilateacher-shell-schedule.jsx",
    ],
  },
  {
    files: ["src/ai/**/*.js", "src/data/**/*.js", "src/features/auth/**/*.js", "src/features/account/**/*.js", "tools/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        AbortController: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        Blob: "readonly",
        CustomEvent: "readonly",
        File: "readonly",
        FileReader: "readonly",
        Image: "readonly",
        MediaRecorder: "readonly",
        ResizeObserver: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        caches: "readonly",
        console: "readonly",
        createImageBitmap: "readonly",
        crypto: "readonly",
        cancelAnimationFrame: "readonly",
        document: "readonly",
        fetch: "readonly",
        indexedDB: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        performance: "readonly",
        process: "readonly",
        requestAnimationFrame: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
    },
  },
  /* 13px 아래로 내려가지 않는다.

     크기 단계를 여섯 개로 줄여 놓아도, 다음에 화면을 만들 때 "여기만 조금
     작게" 를 한 번 넣으면 그대로 되돌아간다. 되돌아가는 자리가 리뷰가
     아니라 린트에서 걸리게 둔다.

     text-xs 는 여기서 걸리지 않는다. 임의 크기가 아니라 Tailwind 기본
     눈금이고, 550곳이 아직 그것을 쓴다 -- 화면 단위로 옮기는 중이다.
     그 눈금을 없애는 것은 옮기기가 끝난 뒤 tailwind.config.js 에서 한다. */
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: [
      /* 360° 바디뷰는 꺼져 있다. 켜지 않는 화면을 이 작업으로 건드리지
         않기로 했으므로 임의 크기가 남아 있다. 되살릴 때 함께 옮긴다. */
      "src/features/posture/BodyViewSheet.jsx",
    ],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "Property[key.name='fontSize'][value.value<13]",
          message: "글자는 13px 아래로 내려가지 않는다. src/features/ui/type-scale.js 의 TYPE 에서 고를 것.",
        },
        {
          selector: "Literal[value=/text-\\[([0-9]|1[0-2])(\\.[0-9]+)?px\\]/]",
          message: "임의 크기 대신 text-caption·text-body·text-title·text-heading·text-display·text-hero 중에서 고를 것. 13px 이 바닥이다.",
        },
        {
          selector: "TemplateElement[value.raw=/text-\\[([0-9]|1[0-2])(\\.[0-9]+)?px\\]/]",
          message: "임의 크기 대신 text-caption·text-body·text-title·text-heading·text-display·text-hero 중에서 고를 것. 13px 이 바닥이다.",
        },
      ],
    },
  },
];
