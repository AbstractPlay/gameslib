import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { deepMerge } from "../../scripts/translate.mjs";
import {
    applyMergeChunk,
    mergeApgamesEnSources,
    splitMonolithForShards,
} from "../../scripts/lib/apgames-en-merge.mjs";
import { MERGED_EN } from "../../scripts/lib/apgames-en-paths.mjs";

describe("apgames-en merge", () => {
    it("split shards + legacy re-merge to the original monolith", () => {
        const monolith = {
            categories: { tags: { foo: { tag: "Foo" } } },
            names: { complica: "Complica", pass: "not-a-game" },
            descriptions: { complica: "Desc" },
            validation: {
                _general: { GENERIC: "err" },
                complica: { PARTIAL: "pick" },
            },
            status: {
                GROUPCOUNT: "Groups",
                complica: { PHASE: "P" },
            },
            buttons: {
                pass: "Pass",
                complica: { foo: "Bar" },
            },
            variants: {},
            displays: {},
            notes: {},
        };
        const { shardFiles, legacy } = splitMonolithForShards(monolith);
        let merged = {};
        for (const chunk of Object.values(shardFiles)) {
            deepMerge(merged, chunk);
        }
        deepMerge(merged, legacy);
        assert.deepEqual(merged, monolith);
    });

    it("records merge collision when two sources set the same leaf to different English", () => {
        const merged = { validation: { _general: { SAME: "first" } } };
        const provenance = new Map([["validation._general.SAME", "shared/a.json"]]);
        const collisions = [];
        applyMergeChunk(
            merged,
            { validation: { _general: { SAME: "second" } } },
            "legacy/monolith-slice.json",
            provenance,
            collisions,
        );
        assert.equal(collisions.length, 1);
        assert.equal(collisions[0].leafPath, "validation._general.SAME");
    });

    it("does not record collision when overlay repeats the same English", () => {
        const merged = { names: { foo: "Foo" } };
        const provenance = new Map([["names.foo", "legacy"]]);
        const collisions = [];
        applyMergeChunk(merged, { names: { foo: "Foo" } }, "gameinfo", provenance, collisions);
        assert.equal(collisions.length, 0);
    });

    it("matches committed locales/en/apgames.json when shards are present", () => {
        const onDisk = JSON.parse(fs.readFileSync(MERGED_EN, "utf8"));
        assert.deepEqual(mergeApgamesEnSources(), onDisk);
    });
});
