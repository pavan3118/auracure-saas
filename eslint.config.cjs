const js = require("@eslint/js");
const ts = require("typescript-eslint");
const globals = require("globals");
module.exports = ts.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".local/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
