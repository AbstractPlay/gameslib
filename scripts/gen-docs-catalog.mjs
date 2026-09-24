/**
 * Writes docs/meta-games.md and docs/categories.md from gameinfo under src/games/.
 * Outputs are gitignored; CI and docs:check regenerate them ephemerally.
 * Narrative category copy lives in docs/categories.prose.md.
 *
 * Usage: node scripts/gen-docs-catalog.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project } from "ts-morph";
import {
    collectGameFiles,
    discoverGames,
    DEFAULT_SKIP_FILES,
} from "./registry-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const DOCS_DIR = path.join(ROOT, "docs");
const META_GAMES_PATH = path.join(DOCS_DIR, "meta-games.md");
const CATEGORIES_PATH = path.join(DOCS_DIR, "categories.md");
const CATEGORIES_PROSE_PATH = path.join(DOCS_DIR, "categories.prose.md");
const FRONT_CATEGORIES_JSON = path.join(
    ROOT,
    "..",
    "front",
    "public",
    "locales",
    "en",
    "apfront.json",
);

const PLAY_GAME = "https://play.abstractplay.com/games";
const GEN_START = "<!-- gen-docs-catalog:start -->";
const GEN_END = "<!-- gen-docs-catalog:end -->";

function loadCategoryLabels() {
    if (!fs.existsSync(FRONT_CATEGORIES_JSON)) {
        return { keys: null, labels: {} };
    }
    const data = JSON.parse(fs.readFileSync(FRONT_CATEGORIES_JSON, "utf8"));
    const catRoot = data.categories ?? {};
    const labels = {};
    for (const [key, val] of Object.entries(catRoot)) {
        if (val && typeof val === "object" && val.tag) {
            labels[key] = val.tag;
        }
    }
    return { keys: new Set(Object.keys(catRoot)), labels };
}

function discoverCatalogGames() {
    const project = new Project({
        tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
        skipAddingFilesFromTsConfig: true,
    });
    for (const filePath of collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES)) {
        project.addSourceFileAtPath(filePath);
    }
    return discoverGames(project, GAMES_DIR, DEFAULT_SKIP_FILES);
}

function buildMetaGamesMarkdown(games) {
    const sorted = [...games].sort((a, b) => {
        const nc = (a.name ?? a.uid).localeCompare(b.name ?? b.uid, "en");
        return nc !== 0 ? nc : a.uid.localeCompare(b.uid);
    });
    const prod = sorted.filter((g) => !g.experimental);
    const experimental = sorted.filter((g) => g.experimental);

    const lines = [
        "# Meta-game catalog",
        "",
        "Alphabetical list of **display names** and **`metaGame` uids** for tooling and integrations.",
        "",
        "Regenerate after registry changes:",
        "",
        "```bash",
        "npm run gen-docs-catalog",
        "```",
        "",
        `*${sorted.length} games in source tree (from registry discovery).*`,
        "",
        "## Production catalog",
        "",
        "| Display name | `metaGame` uid |",
        "| --- | --- |",
    ];
    for (const g of prod) {
        lines.push(`| ${escapeCell(g.name ?? g.uid)} | \`${g.uid}\` |`);
    }
    if (experimental.length > 0) {
        lines.push("", "## Experimental (`experimental` flag)", "", "| Display name | `metaGame` uid |", "| --- | --- |");
        for (const g of experimental) {
            lines.push(`| ${escapeCell(g.name ?? g.uid)} | \`${g.uid}\` |`);
        }
    }
    lines.push("");
    return lines.join("\n");
}

function escapeCell(s) {
    return String(s).replace(/\|/g, "\\|");
}

function tagPrefix(tag) {
    if (tag.startsWith("goal>")) return "goal";
    if (tag.startsWith("mechanics>")) return "mechanics";
    if (tag.startsWith("board>")) return "board";
    if (tag.startsWith("components>")) return "components";
    return "other";
}

function buildCategoriesGenerated(games, i18n) {
    const byTag = new Map();
    const allTags = new Set();
    for (const g of games) {
        for (const tag of g.categories ?? []) {
            allTags.add(tag);
            if (!byTag.has(tag)) byTag.set(tag, []);
            byTag.get(tag).push(g);
        }
    }
    for (const list of byTag.values()) {
        list.sort((a, b) =>
            (a.name ?? a.uid).localeCompare(b.name ?? b.uid, "en") ||
            a.uid.localeCompare(b.uid),
        );
    }

    const missingI18n =
        i18n.keys == null
            ? []
            : [...allTags].filter((t) => !i18n.keys.has(t)).sort();

    const prefixes = ["goal", "mechanics", "board", "components", "other"];
    const tagsByPrefix = {};
    for (const p of prefixes) tagsByPrefix[p] = [];
    for (const tag of [...allTags].sort()) {
        tagsByPrefix[tagPrefix(tag)].push(tag);
    }

    const lines = [
        GEN_START,
        "",
        "## Generated tag index",
        "",
        "Tags below are taken from `gameinfo.categories` on each game class. Explore labels come from front `categories.*` i18n.",
        "",
    ];

    for (const prefix of prefixes) {
        const tags = tagsByPrefix[prefix];
        if (tags.length === 0) continue;
        lines.push(`### \`${prefix}\` tags`, "");
        for (const tag of tags) {
            const label = i18n.labels[tag];
            const count = byTag.get(tag)?.length ?? 0;
            const labelPart = label ? ` — ${label}` : "";
            lines.push(`- \`${tag}\`${labelPart} (${count} game${count === 1 ? "" : "s"})`);
        }
        lines.push("");
    }

    if (missingI18n.length > 0) {
        lines.push(
            "### Tags missing Explore i18n",
            "",
            "Add `categories.<tag>.*` to `public/locales/en/apfront.json` in the front repo:",
            "",
        );
        for (const tag of missingI18n) {
            lines.push(`- \`${tag}\``);
        }
        lines.push("");
    }

    lines.push("## Generated games by tag", "");

    for (const tag of [...allTags].sort()) {
        const list = byTag.get(tag) ?? [];
        const label = i18n.labels[tag];
        lines.push(`### \`${tag}\`${label ? ` (${label})` : ""}`, "");
        if (list.length === 0) {
            lines.push("*No games.*", "");
            continue;
        }
        for (const g of list) {
            const exp = g.experimental ? " *(experimental)*" : "";
            lines.push(
                `- [${g.name ?? g.uid}](${PLAY_GAME}/${g.uid}) (\`${g.uid}\`)${exp}`,
            );
        }
        lines.push("");
    }

    lines.push(GEN_END, "");
    return lines.join("\n");
}

function buildCategoriesMarkdown(prose, generatedBlock) {
    return `${prose.trimEnd()}\n\n${generatedBlock}`;
}

function writeGenerated(filePath, content) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`Wrote ${path.relative(ROOT, filePath)}`);
}

const games = discoverCatalogGames();
const i18n = loadCategoryLabels();
const metaMd = buildMetaGamesMarkdown(games);
const genBlock = buildCategoriesGenerated(games, i18n);

writeGenerated(META_GAMES_PATH, metaMd);

if (!fs.existsSync(CATEGORIES_PROSE_PATH)) {
    console.error(
        "gen-docs-catalog: docs/categories.prose.md missing (committed narrative source)",
    );
    process.exit(1);
}
const categoriesProse = fs.readFileSync(CATEGORIES_PROSE_PATH, "utf8");
const categoriesFull = buildCategoriesMarkdown(categoriesProse, genBlock);
writeGenerated(CATEGORIES_PATH, categoriesFull);

console.log(`Catalog: ${games.length} games, ${new Set(games.flatMap((g) => g.categories ?? [])).size} distinct tags`);
