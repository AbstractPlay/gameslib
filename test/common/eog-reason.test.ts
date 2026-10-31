import { expect } from "chai";
import i18next from "i18next";
import {
    normalizeEogReasonLeaf,
    resolveEogCatalogKey,
} from "../../src/common/chat-log.js";
import { addResource } from "../../src/i18n-node.js";
import { BridgesGame } from "../../src/games/bridges.js";

describe("EOG reason helpers", () => {
    it("normalizeEogReasonLeaf handles spaces, kebab-case, and camelCase", () => {
        expect(normalizeEogReasonLeaf("two passes")).to.equal("two_passes");
        expect(normalizeEogReasonLeaf("pass-alive")).to.equal("pass_alive");
        expect(normalizeEogReasonLeaf("docKilled")).to.equal("doc_killed");
        expect(normalizeEogReasonLeaf("gonnect_direct_connection")).to.equal("gonnect_direct_connection");
    });

    it("resolveEogCatalogKey prefers game-specific leaves", () => {
        addResource("en");
        const exists = (key: string) => i18next.exists(key);
        const resolved = resolveEogCatalogKey("bridges", "double_pass", {}, exists);
        expect(resolved.textKey).to.equal("apresults:bridges.EOG.double_pass");
    });

    it("resolveEogCatalogKey falls back to _general", () => {
        addResource("en");
        const exists = (key: string) => i18next.exists(key);
        const resolved = resolveEogCatalogKey("bridges", "stalemate", {}, exists);
        expect(resolved.textKey).to.equal("apresults:_general.EOG.stalemate");
    });

    it("resolveEogCatalogKey omits count when game uses a plain repetition string", () => {
        addResource("en");
        const exists = (key: string) => i18next.exists(key);
        const resolved = resolveEogCatalogKey("ataxx", "repetition", {}, exists);
        expect(resolved.textKey).to.equal("apresults:ataxx.EOG.repetition");
        expect(resolved.textParams).to.equal(undefined);
    });
});

describe("formatEogSummary", () => {
    it("resolves bridges double_pass via catalog lookup", () => {
        addResource("en");
        const g = new BridgesGame();
        g.gameover = true;
        g.winner = [1];
        g.stack = [{
            _version: BridgesGame.gameinfo.version,
            _results: [
                { type: "eog", reason: "double_pass" },
                { type: "winners", players: [1] },
            ],
            _timestamp: new Date(),
            currplayer: 1,
            board: new Map(),
            scores: [1, 0],
            bridges: [[1], []],
        } as never];
        const summary = g.formatEogSummary(["A", "B"], (key, params) => i18next.t(key, params));
        expect(summary).to.equal(i18next.t("apresults:bridges.EOG.double_pass"));
    });
});
