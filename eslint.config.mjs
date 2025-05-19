// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ["src/schemas/*", "src/ais/*", "playground/*", "bin/*", "build/*", "dist/*", "docs/*", "src/games/tafl/ruleset.d.ts", "**/*.config.js"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
        "@typescript-eslint/no-explicit-any": "warn",
        "no-console": "error",
    },
  }
);


