import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { collectLeaves } from "../../scripts/locale-prune.mjs";
import {
    buildPathMapFromCatalog,
    flatCatalogLeavesFromCommittedMap,
    HOMEWORLD_ACTION_LEAF,
    loadCommittedPathMapEntries,
    mapCatalogLeafPath,
} from "../../scripts/lib/apresults-path-map.mjs";
import { mergeApresultsEnSources } from "../../scripts/lib/apresults-en-merge.mjs";
import { MERGED_EN_ARESULTS, PATH_MAP_JSON } from "../../scripts/lib/apresults-en-paths.mjs";

describe("apresults path map", () => {
    it("maps homeworlds actions to uid.resultType.semanticLeaf", () => {
        const uidSet = new Set(["homeworlds", "btt"]);
        for (const [action, leaf] of Object.entries(HOMEWORLD_ACTION_LEAF)) {
            const e = mapCatalogLeafPath(`homeworlds.${action}`, uidSet);
            assert.equal(e.uid, "homeworlds");
            assert.equal(e.resultType, action);
            assert.equal(e.newLeaf, leaf);
            assert.equal(e.newFullKey, `apresults:homeworlds.${action}.${leaf}`);
        }
    });

    it("strips uid prefix under game bucket (PLACE.btt_small)", () => {
        const uidSet = new Set(["btt"]);
        const e = mapCatalogLeafPath("PLACE.btt_small", uidSet);
        assert.equal(e.uid, "btt");
        assert.equal(e.resultType, "PLACE");
        assert.equal(e.newLeaf, "small");
        assert.equal(e.newPath, "btt.PLACE.small");
    });

    it("keeps shared stems in _general (PLACE.nowhat)", () => {
        const uidSet = new Set(["btt"]);
        const e = mapCatalogLeafPath("PLACE.nowhat", uidSet);
        assert.equal(e.uid, "_general");
        assert.equal(e.newPath, "_general.PLACE.nowhat");
    });

    it("routes uid-prefixed capture stems to game buckets", () => {
        const uidSet = new Set(["asli", "ataxx", "amazons", "spook", "tritium", "druid", "elOso", "blockade", "boom"]);
        assert.equal(mapCatalogLeafPath("CAPTURE.asli_self", uidSet).newPath, "asli.CAPTURE.self");
        assert.equal(mapCatalogLeafPath("CAPTURE.ataxx_one", uidSet).newPath, "ataxx.CAPTURE.one");
        assert.equal(mapCatalogLeafPath("MOVE.amazonsNoFirstShot", uidSet).newPath, "amazons.MOVE.noFirstShot");
        assert.equal(mapCatalogLeafPath("PLACE.spooky", uidSet).newPath, "spook.PLACE.spooky");
        assert.equal(mapCatalogLeafPath("PLACE.tritium-flag", uidSet).newPath, "tritium.PLACE.flag");
        assert.equal(mapCatalogLeafPath("DRUID_HEX_EDGE.N", uidSet).newPath, "druid.HEX_EDGE.N");
        assert.equal(mapCatalogLeafPath("ACTOR.elOso.bear", uidSet).newPath, "elOso.ACTOR.bear");
        assert.equal(mapCatalogLeafPath("CAPTURE.blockade", uidSet).newPath, "blockade.CAPTURE.default");
        assert.equal(mapCatalogLeafPath("CAPTURE.boom", uidSet).newPath, "boom.CAPTURE.default");
        assert.equal(mapCatalogLeafPath("MOVE.blockade", uidSet).newPath, "blockade.MOVE.default");
        assert.equal(mapCatalogLeafPath("DESTROY.string", new Set(["strings"])).newPath, "strings.DESTROY.string");
        assert.equal(
            mapCatalogLeafPath("SCRIBE.glyphs.bomber", new Set(["scribe"])).newPath,
            "scribe.SCRIBE.glyphs.bomber",
        );
    });

    it("has no newPath collisions for current English catalog", () => {
        const merged = mergeApresultsEnSources();
        const flatLeaves = flatCatalogLeavesFromCommittedMap(merged);
        const { collisions } = buildPathMapFromCatalog(flatLeaves);
        assert.equal(collisions.length, 0, collisions.map((c) => c.newPath).join(", "));
    });

    it("committed path map entries aligned with merge output", () => {
        const merged = JSON.parse(fs.readFileSync(MERGED_EN_ARESULTS, "utf8"));
        const mergedLeaves = Object.keys(collectLeaves(merged)).length;
        const onDisk = JSON.parse(fs.readFileSync(PATH_MAP_JSON, "utf8"));
        assert.equal(onDisk.entries.length, loadCommittedPathMapEntries().length);
        assert.equal(mergedLeaves, onDisk.entries.length);
        assert.equal(onDisk.schemaVersion, 1);
    });
});
