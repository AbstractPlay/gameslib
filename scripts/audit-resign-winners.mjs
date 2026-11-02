/**
 * Mechanical triage for multiplayer resign / knowable-winner audit.
 * Run: node scripts/audit-resign-winners.mjs
 * Writes: scripts/resign-winner-audit-catalog.md
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Project, SyntaxKind } from "ts-morph";
import {
    collectGameFiles,
    discoverGames,
    DEFAULT_SKIP_FILES,
} from "./registry-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GAMES_DIR = path.join(ROOT, "src", "games");
const OUT = path.join(__dirname, "resign-winner-audit-catalog.md");

function getPlayercountsFromInit(init) {
    const prop = init.getProperty("playercounts");
    if (!prop?.isKind(SyntaxKind.PropertyAssignment)) {
        return [2];
    }
    const arr = prop.getInitializer();
    if (!arr?.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return [2];
    }
    const nums = [];
    for (const el of arr.getElements()) {
        if (el.isKind(SyntaxKind.NumericLiteral)) {
            nums.push(Number(el.getLiteralValue()));
        }
    }
    return nums.length > 0 ? nums : [2];
}

function analyzeSource(text) {
    const hasCheckEOG = /\bcheckEOG\s*\(/.test(text) || /\bresolveWinners\s*\(/.test(text);
    const singleWinnerAssign =
        /this\.winner\s*=\s*\[\s*(?:\(\s*)?(?:idx\s*\+\s*1|p|player|who|winner|\[\.\.\.[a-zA-Z]+\]\[0\])/.test(text) ||
        /this\.winner\s*=\s*\[\s*[12]\s*as/.test(text);
    const coWinAllSeats =
        /for\s*\(\s*let\s+p\s*=\s*1\s*;\s*p\s*<=\s*this\.numplayers/.test(text) &&
        /winners\.push\(p/.test(text);
    const lastManStanding =
        /last\s*man\s*standing|lastManStanding|only one man standing|numAlive\s*===\s*1|filter\([^)]*\)\.length\s*===\s*1/.test(
            text,
        );
    const eliminationState =
        /\beliminated\b/.test(text) ||
        /\bwithdrawn\b/.test(text) ||
        /isEliminated\s*\(/.test(text) ||
        /type:\s*["']eliminated["']/.test(text);
    const resignOverride =
        /public\s+resign\s*\(\s*player[^)]*\)\s*:\s*\w+\s*\{[\s\S]*?return this\s*;/.test(text);
    const annihilateGoal = /goal>annihilate/.test(text);
    const assetSurvival =
        /ships\.filter|numChevrons|chevrons\.filter|players\.size\s*===\s*1|new Set<playerid>\(this\.board/.test(text);
    return {
        hasCheckEOG,
        singleWinnerAssign,
        coWinAllSeats,
        lastManStanding,
        eliminationState,
        resignOverride,
        annihilateGoal,
        assetSurvival,
    };
}

function suggestBucket(row) {
    if (row.resignOverride) {
        return "D";
    }
    if (row.maxPlayers < 3) {
        return row.knowableEOG ? "A2p" : "—";
    }
    if (row.knowableEOG && row.hasCheckEOG) {
        return "A?";
    }
    if (row.eliminationState && row.hasCheckEOG) {
        return "B?";
    }
    return "C?";
}

const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
});
const files = collectGameFiles(GAMES_DIR, DEFAULT_SKIP_FILES);
for (const f of files) {
    project.addSourceFileAtPath(f);
}

const entries = discoverGames(project, GAMES_DIR);
const rows = [];

for (const e of entries) {
    const sf = project.getSourceFile(e.filePath);
    const text = sf?.getFullText() ?? "";
    const signals = analyzeSource(text);
    let playercounts = [2];
    let baseClass = "?";
    const cls = sf?.getClasses().find((c) => c.getName() === e.className);
    if (cls) {
        baseClass = cls.getExtends()?.getText() ?? "?";
        const gameinfoProp = cls.getStaticProperty("gameinfo");
        const init = gameinfoProp?.getInitializer();
        if (init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            playercounts = getPlayercountsFromInit(init);
        }
    }
    const maxPlayers = Math.max(...playercounts);
    const knowableEOG =
        signals.lastManStanding ||
        (signals.singleWinnerAssign && signals.assetSurvival) ||
        (signals.annihilateGoal && signals.hasCheckEOG && signals.assetSurvival);
    rows.push({
        uid: e.uid,
        maxPlayers,
        playercounts: playercounts.join(","),
        base: baseClass,
        simultaneous: baseClass === "GameBaseSimultaneous",
        experimental: e.experimental,
        knowableEOG,
        bucket: "",
        ...signals,
    });
}

for (const row of rows) {
    row.bucket = suggestBucket(row);
}

rows.sort((a, b) => a.uid.localeCompare(b.uid));

const multi = rows.filter((r) => r.maxPlayers >= 3);
const bucketA = multi.filter((r) => r.bucket.startsWith("A"));
const bucketA2p = rows.filter((r) => r.bucket === "A2p");
const bucketB = multi.filter((r) => r.bucket.startsWith("B"));
const bucketC = multi.filter((r) => r.bucket.startsWith("C"));
const bucketD = rows.filter((r) => r.bucket === "D");

function table(list) {
    if (list.length === 0) {
        return "_None_\n";
    }
    const header =
        "| uid | max | base | checkEOG | singleWin | lastMan | elim | asset | resign↗ |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
    const lines = list.map((r) => {
        const yn = (b) => (b ? "y" : "");
        return `| ${r.uid} | ${r.maxPlayers} | ${r.base.replace("GameBase", "")} | ${yn(r.hasCheckEOG)} | ${yn(r.singleWinnerAssign)} | ${yn(r.lastManStanding)} | ${yn(r.eliminationState)} | ${yn(r.assetSurvival)} | ${yn(r.resignOverride)} |`;
    });
    return `${header}\n${lines.join("\n")}\n`;
}

const md = `# Resign / knowable-winner audit (generated)

Generated by \`node scripts/audit-resign-winners.mjs\`. Re-run after game changes.

**Legend**

- **A** — Likely knowable single winner on resign/timeout when board already implies one contender (verify manually).
- **B** — Tracks elimination; winners on resign may need to exclude ghost seats or use elimination order (verify).
- **C** — Default “all non-resigners win” may be correct, or winner not derivable without playing out (verify).
- **D** — Custom resign/timeout (game continues or special elimination).

Column flags: checkEOG, singleWin (heuristic \`winner = [one]\`), lastMan, elim state, asset-based survival, resign↗ override.

## Summary

| Bucket | Multiplayer (≥3) count | Notes |
| --- | ---: | --- |
| A? (candidates) | ${bucketA.length} | Multiplayer; annihilation / last-man / asset survival + checkEOG |
| A2p | ${bucketA2p.length} | Same signals but max players 2 (resign usually OK) |
| B? | ${bucketB.length} | Elimination tracking + checkEOG |
| C? | ${bucketC.length} | Default co-win or unclear |
| D | ${bucketD.length} | Resign override |

Total catalogue games: ${rows.length}. Multiplayer-capable (playercounts include 3+): ${multi.length}.

Only **23** games advertise 3+ seats in \`gameinfo.playercounts\`; most of the catalogue is 2p-only where default resign already yields a single opponent-wins outcome.

## Bucket A2p — knowable EOG, two-player only

${table(bucketA2p.slice(0, 25))}

${bucketA2p.length > 25 ? `_…${bucketA2p.length - 25} more._\n` : ""}

## Bucket A? — fix candidates (manual confirm)

${table(bucketA)}

## Bucket B? — elimination-aware resign

${table(bucketB)}

## Bucket D — resign override

${table(bucketD)}

## Bucket C? — all multiplayer defaults (${bucketC.length})

${table(bucketC)}

## Phase 3 priority (semantic)

| Priority | uid | Action |
| --- | --- | --- |
| P0 | armadas | Implemented: `withdrawalWinnersAmongContenders` + ships. |
| P1 | pacru | Implemented: chevrons + target score. |
| P1 | pigs | Implemented: `!isEliminated` (not pigs2 — that game no-ops resign). |
| P2 | homeworlds, knightline, stawvs, yavalath | Implemented: exclude eliminated / shipless from co-win. |
| Skip | thricewise | `isEliminated` is phase-inactive seats, not permanent elimination — do not use withdrawal hook. |
| Defer | homeworlds (early resign) | Keep all non-resigners as winners when no elimination yet (\`homeworlds.test.ts\`). |
| Pattern | clusterfuss, many 2p annihilate | 2p resign → one opponent wins; low priority unless player counts expand. |

## Manual notes (semantic)

### Confirmed exemplars

| uid | Bucket | Notes |
| --- | --- | --- |
| armadas | **A** | Prod e9dbcad8: shipless P3 co-wins on P1 resign; sole fleet should win (\`test/games/armadas.test.ts\`). |
| pigs2 | **D** | Resign is elimination; game continues until one robot left (\`pigs2.ts\`). |
| homeworlds | **C** | Early 4p resign: all non-resigners co-win by design (\`homeworlds.test.ts\`). |
| pacru | **A** | \`checkEOG\`: score target or sole player with chevrons. |
| clusterfuss | **A** | Single colour on board → one winner. |

### Armadas-like pattern (grep \`only one man standing\` / ship counts)

Games with explicit last-fleet or board-survival EOG should be spot-checked with a resign fixture when implementing Phase 3.

`;

fs.writeFileSync(OUT, md, "utf8");
console.log(`Wrote ${OUT}`);
console.log(
    `Multiplayer: ${multi.length}; A?=${bucketA.length} A2p=${bucketA2p.length} B?=${bucketB.length} C?=${bucketC.length} D=${bucketD.length}`,
);

fs.writeFileSync(
    path.join(__dirname, "resign-winner-audit.json"),
    JSON.stringify(
        { generated: new Date().toISOString(), rows: rows.map(({ uid, maxPlayers, bucket, knowableEOG, ...rest }) => ({ uid, maxPlayers, bucket, knowableEOG, ...rest })) },
        null,
        2,
    ),
    "utf8",
);
