import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const playgroundDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(playgroundDir, "..");

/**
 * Vite playground skeleton (Phase 0). Phase 1 replaces Webpack UMD + playground.js
 * with ESM entry importing @abstractplay/gameslib from src/.
 */
export default defineConfig(({ mode }) => ({
    root: path.join(playgroundDir, "vite"),
    resolve: {
        alias: {
            buffer: "buffer",
            "@abstractplay/gameslib": path.resolve(repoRoot, "src/index.ts"),
        },
    },
    define: {
        global: "globalThis",
    },
    server: {
        port: 3000,
        strictPort: true,
        open: false,
    },
    build: {
        outDir: path.resolve(repoRoot, "dist-vite"),
        emptyOutDir: true,
        sourcemap: mode !== "production",
    },
    optimizeDeps: {
        include: ["buffer"],
    },
}));
