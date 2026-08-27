/* eslint-env node */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const entry = path.join(ROOT, "build", "index.js");

try {
  const gl = require(entry);
  if (!gl.gameinfo || typeof gl.GameFactory !== "function") {
    throw new Error("build/index.js missing expected exports");
  }
  if (typeof gl.generateChallengeSeed !== "function") {
    throw new Error("build/index.js missing generateChallengeSeed");
  }
  console.log("smoke-cjs-entry: require(build/index.js) OK");
} catch (error) {
  console.error(`smoke-cjs-entry: ${error.message}`);
  process.exit(1);
}
