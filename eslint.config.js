export default [
  {
    ignores: [
      "android/**",
      "ios/**",
      "dist/**",
      "node_modules/**",
      "src/App*.jsx",
      "src/App.j",
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
];
