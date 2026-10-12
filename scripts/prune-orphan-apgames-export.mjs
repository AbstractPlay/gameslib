#!/usr/bin/env node
/**
 * Remove gameApgamesEn leaves reported as strict orphans (dry-run by default).
 * Usage: node scripts/prune-orphan-apgames-export.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { SyntaxKind } from "ts-morph";
import { mergeApgamesEnSources } from "./lib/apgames-en-merge.mjs";
import { findOrphanApgamesLeaves, resetGamesContextCache } from "./lib/check-apgames-refs.mjs";
import { loadGamesProject } from "./lib/apgames-extract-ts.mjs";
import { REPO_ROOT } from "./lib/apgames-en-paths.mjs";

const write = process.argv.includes("--write");
const UID_SECTIONS = ["validation", "variants", "displays", "buttons", "status"];

/**
 * @param {string} line
 */
function parseOrphanLeaf(line) {
    const m = line.match(/apgames:((?:validation|variants|displays|buttons|status)\.[^)\s]+)/);
    return m?.[1];
}

/**
 * @param {string} leaf e.g. validation.foo.BAR
 */
function leafToExportPath(leaf, uid) {
    const parts = leaf.split(".");
    const section = parts[0];
    if (parts[1] !== uid) {
        return undefined;
    }
    return { section, keys: parts.slice(2) };
}

/**
 * @param {import("ts-morph").ObjectLiteralExpression} obj
 * @param {string[]} keys
 */
function removeNestedProperty(obj, keys) {
    if (keys.length === 0) {
        return false;
    }
    const [head, ...rest] = keys;
    const prop = obj.getProperty(head) ?? obj.getProperty(`"${head}"`);
    if (!prop?.isKind(SyntaxKind.PropertyAssignment)) {
        return false;
    }
    if (rest.length === 0) {
        prop.remove();
        return true;
    }
    const init = prop.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return false;
    }
    const removed = removeNestedProperty(init, rest);
    if (removed && init.getProperties().length === 0) {
        prop.remove();
    }
    return removed;
}

resetGamesContextCache();
const merged = mergeApgamesEnSources();
const orphans = findOrphanApgamesLeaves(merged);
const project = loadGamesProject();

const byFile = new Map();
for (const line of orphans) {
    const leaf = parseOrphanLeaf(line);
    if (!leaf) {
        continue;
    }
    const uid = leaf.split(".")[1];
    const parsed = leafToExportPath(leaf, uid);
    if (!parsed || !UID_SECTIONS.includes(parsed.section)) {
        continue;
    }
    const gamePath = path.join(REPO_ROOT, "src", "games", `${uid}.ts`);
    if (!fs.existsSync(gamePath)) {
        continue;
    }
    const list = byFile.get(gamePath) ?? [];
    list.push(parsed);
    byFile.set(gamePath, list);
}

let removed = 0;
for (const [filePath, entries] of byFile) {
    const sf = project.getSourceFile(filePath);
    if (!sf) {
        continue;
    }
    const exportDecl = sf.getVariableDeclaration("gameApgamesEn");
    const init = exportDecl?.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) {
        continue;
    }
    for (const { section, keys } of entries) {
        const sectionProp = init.getProperty(section);
        if (!sectionProp?.isKind(SyntaxKind.PropertyAssignment)) {
            continue;
        }
        const sectionInit = sectionProp.getInitializer();
        if (!sectionInit?.isKind(SyntaxKind.ObjectLiteralExpression)) {
            continue;
        }
        if (removeNestedProperty(sectionInit, keys)) {
            removed++;
            const rel = path.relative(REPO_ROOT, filePath);
            console.log(write ? "removed" : "would remove", `${section}.${keys.join(".")}`, "from", rel);
        }
    }
    if (write) {
        fs.writeFileSync(filePath, sf.getFullText(), "utf8");
    }
}

console.log(write ? `Removed ${removed} export leaf(s).` : `Dry run: ${removed} leaf(s). Pass --write to apply.`);
