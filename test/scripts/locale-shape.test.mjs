import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeNamesIntoApgames } from "../../scripts/lib/sync-game-names-locale-lib.mjs";
import {
    managedLocaleOnDiskMatchesShape,
    normalizeManagedLocaleOnDisk,
    pruneToSourceShape,
} from "../../scripts/locale-prune.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("mergeNamesIntoApgames shape", () => {
    it("keeps English top-level key order when updating names", () => {
        const english = {
            buttons: { pass: "Pass" },
            names: { old: "Old" },
            validation: { foo: { BAR: "x" } },
            descriptions: { foo: "desc" },
        };
        const managed = {
            descriptions: { foo: "desc-de" },
            names: { old: "Old" },
            buttons: { pass: "Passen" },
            validation: { foo: { BAR: "y" } },
        };
        const merged = mergeNamesIntoApgames(managed, { newgame: "New", old: "Old" }, english);
        assert.deepEqual(Object.keys(merged), ["buttons", "names", "validation", "descriptions"]);
        assert.equal(merged.names.newgame, "New");
        assert.equal(merged.buttons.pass, "Passen");
    });
});

describe("managed locale shape normalize", () => {
    it("detects key-order drift vs English and rewrites without changing leaves", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ap-locale-shape-"));
        const localesDir = path.join(tmp, "locales");
        const enPath = path.join(localesDir, "en", "apgames.json");
        const dePath = path.join(localesDir, "de", "apgames.json");
        fs.mkdirSync(path.dirname(enPath), { recursive: true });
        fs.mkdirSync(path.dirname(dePath), { recursive: true });

        const english = {
            buttons: { pass: "Pass" },
            names: { g: "G" },
            validation: { g: { X: "English" } },
        };
        const wrongOrder = {
            names: { g: "G" },
            buttons: { pass: "Passen" },
            validation: { g: { X: "Deutsch" } },
        };
        fs.writeFileSync(enPath, `${JSON.stringify(english, null, 2)}\n`, "utf8");
        fs.writeFileSync(dePath, `${JSON.stringify(wrongOrder, null, 2)}\n`, "utf8");

        const targetData = JSON.parse(fs.readFileSync(dePath, "utf8"));
        assert.equal(managedLocaleOnDiskMatchesShape(dePath, english, targetData), false);

        const normalized = normalizeManagedLocaleOnDisk(
            dePath,
            tmp,
            "de",
            "apgames.json",
            english,
            targetData,
            {},
        );
        assert.equal(normalized, true);
        const onDisk = JSON.parse(fs.readFileSync(dePath, "utf8"));
        assert.deepEqual(Object.keys(onDisk), Object.keys(english));
        assert.equal(onDisk.validation.g.X, "Deutsch");
        assert.equal(pruneToSourceShape(english, onDisk)?.validation?.g?.X, "Deutsch");

        fs.rmSync(tmp, { recursive: true, force: true });
    });
});
