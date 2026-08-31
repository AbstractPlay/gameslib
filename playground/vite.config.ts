import { defineConfig } from "vite";
import { createReadStream, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const playgroundDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(playgroundDir, "..");
const localesDir = path.join(repoRoot, "locales");

function serveLocalesMiddleware() {
    return (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/locales/")) {
            next();
            return;
        }
        const rel = url.slice("/locales/".length);
        const filePath = path.resolve(localesDir, rel);
        if (!filePath.startsWith(localesDir + path.sep) && filePath !== localesDir) {
            res.statusCode = 403;
            res.end();
            return;
        }
        if (!existsSync(filePath)) {
            res.statusCode = 404;
            res.end();
            return;
        }
        res.setHeader("Content-Type", "application/json");
        createReadStream(filePath).pipe(res);
    };
}

/** Vite playground — dev server and production build to dist/ for S3 deploy. */
export default defineConfig(({ mode }) => ({
    root: playgroundDir,
    resolve: {
        alias: {
            "@abstractplay/gameslib": path.resolve(repoRoot, "src/index-browser.ts"),
        },
    },
    define: {
        global: "globalThis",
    },
    server: {
        port: 3000,
        strictPort: true,
        open: false,
        fs: {
            allow: [repoRoot],
        },
    },
    plugins: [
        {
            name: "gameslib-locales",
            configureServer(server) {
                server.middlewares.use(serveLocalesMiddleware());
            },
            configurePreviewServer(server) {
                server.middlewares.use(serveLocalesMiddleware());
            },
        },
    ],
    build: {
        outDir: path.resolve(repoRoot, "dist"),
        emptyOutDir: true,
        sourcemap: mode !== "production",
        commonjsOptions: {
            transformMixedEsModules: true,
        },
        rollupOptions: {
            input: {
                playground: path.join(playgroundDir, "playground.html"),
                index: path.join(playgroundDir, "index.html"),
            },
        },
    },
}));
