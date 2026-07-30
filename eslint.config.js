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
    files: ["src/data/**/*.js", "tools/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        structuredClone: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
