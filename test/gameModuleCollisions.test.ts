import "mocha";
import { expect } from "chai";
import { execSync } from "child_process";
import { createRequire } from "module";
import esbuild from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const testFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(testFile);
const require = createRequire(testFile);
const ROOT = path.resolve(testDir, "..");
const GAMES_SRC = path.join(ROOT, "src", "games");
const BUILD_INDEX = path.join(ROOT, "build", "index.js");

/** Game files that share a name with a sibling subfolder (e.g. homeworlds.ts + homeworlds/). */
function collidingGameNames(): string[] {
    const names: string[] = [];
    for (const entry of fs.readdirSync(GAMES_SRC, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
            continue;
        }
        const base = entry.name.replace(/\.ts$/, "");
        const dirPath = path.join(GAMES_SRC, base);
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            names.push(base);
        }
    }
    return names.sort();
}

/** Directory-barrel imports collide with the game file when Vite/Rollup/esbuild bundle for the browser. */
function findDirectoryBarrelImports(gameName: string): string[] {
    const filePath = path.join(GAMES_SRC, `${gameName}.ts`);
    const content = fs.readFileSync(filePath, "utf8");
    const pattern = new RegExp(
        `(?:from\\s+|import\\s+|require\\()["']\\./${gameName}/["']`,
        "g"
    );
    return content.match(pattern) ?? [];
}

function ensureBuildOutput(): void {
    if (!fs.existsSync(BUILD_INDEX)) {
        execSync("npx tsc", { cwd: ROOT, stdio: "pipe" });
    }
}

type BundledGameslib = {
    gameinfo: Map<string, { playercounts?: number[] }>;
    GameFactory: (game: string, ...args: number[]) => {
        description: () => string;
    };
};

function bundleGameslibForBrowser(): BundledGameslib {
    ensureBuildOutput();
    const out = path.join(os.tmpdir(), `gameslib-browser-test-${process.pid}.cjs`);
    esbuild.buildSync({
        entryPoints: [BUILD_INDEX],
        bundle: true,
        platform: "browser",
        format: "cjs",
        outfile: out,
    });
    return require(out) as BundledGameslib;
}

function instantiateGame(gl: BundledGameslib, uid: string) {
    const info = gl.gameinfo.get(uid);
    expect(info, `missing gameinfo for ${uid}`).to.not.equal(undefined);
    if (info!.playercounts !== undefined && info!.playercounts.length > 1) {
        return gl.GameFactory(uid, 2);
    }
    return gl.GameFactory(uid);
}

describe("game module collisions", () => {
    it("lists games whose file shares a name with a subfolder", () => {
        const names = collidingGameNames();
        expect(names.length).to.be.greaterThan(0);
        expect(names).to.include("homeworlds");
    });

    it("does not use directory-barrel imports for same-name subfolders", () => {
        const violations: string[] = [];
        for (const name of collidingGameNames()) {
            const imports = findDirectoryBarrelImports(name);
            for (const imp of imports) {
                violations.push(`${name}.ts: ${imp}`);
            }
        }
        expect(
            violations,
            "use explicit subpaths (e.g. ./homeworlds/stash) instead of directory barrels (./homeworlds/)"
        ).to.deep.equal([]);
    });

    it("browser bundle can construct colliding games without constructor errors", () => {
        const gl = bundleGameslibForBrowser();
        const constructorErrors: string[] = [];

        for (const uid of collidingGameNames()) {
            try {
                instantiateGame(gl, uid);
            } catch (error) {
                const message = (error as Error).message;
                if (/is not a constructor/.test(message)) {
                    constructorErrors.push(`${uid}: ${message}`);
                }
            }
        }

        expect(
            constructorErrors,
            "suspected bundler module-id collision"
        ).to.deep.equal([]);
    });

    it("browser bundle can instantiate Homeworlds (regression)", () => {
        const gl = bundleGameslibForBrowser();
        const game = gl.GameFactory("homeworlds", 2);
        expect(game).to.not.equal(undefined);
    });
});
