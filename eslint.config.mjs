// @ts-check

import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ["src/schemas/*", "src/ais/*", "playground/*", "bin/*", "build/*", "dist/*", "docs/*", "_ap_docs/**", "src/games/tafl/ruleset.d.ts", "src/games/_registry.generated.ts", "src/games/_build-flags.generated.ts", "src/games/_registry-filter.generated.ts", "**/*.config.js"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
        "@typescript-eslint/no-explicit-any": "warn",
        "no-console": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  }
);

