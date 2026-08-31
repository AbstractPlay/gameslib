import "mocha";
import { expect } from "chai";
import {
    isStructuredRenderLabel,
    resolveRenderLabel,
    resolveRenderLabels,
    type StructuredRenderLabel,
} from "../../src/common/render-label";

const mockT = (key: string, params?: Record<string, unknown>): string => {
    if (key === "test:STASH") {
        return `${params?.player}'s stash`;
    }
    if (key === "test:DECK") {
        return "Cards in deck";
    }
    if (key === "test:ACTOR") {
        return `${params?.player} acted`;
    }
    if (key === "apresults:ACTOR.bear") {
        return "The bear";
    }
    return key;
};

describe("render-label", () => {
    it("isStructuredRenderLabel distinguishes structured labels from strings", () => {
        expect(isStructuredRenderLabel("plain")).to.equal(false);
        expect(isStructuredRenderLabel({ textKey: "test:STASH" })).to.equal(true);
        expect(isStructuredRenderLabel(null)).to.equal(false);
    });

    it("resolveRenderLabel passes plain strings through unchanged", () => {
        expect(resolveRenderLabel("Cards in deck", ["Alice", "Bob"], mockT)).to.equal("Cards in deck");
    });

    it("resolveRenderLabel substitutes seat display names for seat actors", () => {
        const label: StructuredRenderLabel = {
            textKey: "test:STASH",
            actor: { kind: "seat", seat: 2 },
        };
        expect(resolveRenderLabel(label, ["Alice", "Bob"], mockT)).to.equal("Bob's stash");
    });

    it("resolveRenderLabel falls back to Player N when no display name is available", () => {
        const label: StructuredRenderLabel = {
            textKey: "test:STASH",
            actor: { kind: "seat", seat: 1 },
        };
        expect(resolveRenderLabel(label, [], mockT)).to.equal("Player 1's stash");
    });

    it("resolveRenderLabel handles neutral labels without seat substitution", () => {
        const label: StructuredRenderLabel = {
            textKey: "test:DECK",
            actor: { kind: "none" },
        };
        expect(resolveRenderLabel(label, ["Alice"], mockT)).to.equal("Cards in deck");
    });

    it("resolveRenderLabel resolves label actors into textParams.player", () => {
        const label: StructuredRenderLabel = {
            textKey: "test:ACTOR",
            actor: { kind: "label", key: "apresults:ACTOR.bear" },
            textParams: { player: "placeholder" },
        };
        expect(resolveRenderLabel(label, ["Alice"], mockT)).to.equal("The bear acted");
    });

    it("resolveRenderLabel forwards extra textParams", () => {
        const label: StructuredRenderLabel = {
            textKey: "test:WITH_SIDE",
            actor: { kind: "seat", seat: 1 },
            textParams: { side: "north" },
        };
        const t = (key: string, params?: Record<string, unknown>) =>
            `${params?.player} (${params?.side})`;
        expect(resolveRenderLabel(label, ["Alice"], t)).to.equal("Alice (north)");
    });

    it("resolveRenderLabel handles streetcar TAKEN_LABEL shape", () => {
        const label: StructuredRenderLabel = {
            textKey: "apgames:validation.streetcar.TAKEN_LABEL",
            actor: { kind: "seat", seat: 2 },
        };
        const t = (key: string, params?: Record<string, unknown>) =>
            key.endsWith("TAKEN_LABEL") ? `${params?.player}'s housing limits` : key;
        expect(resolveRenderLabel(label, ["Alice", "Bob"], t)).to.equal("Bob's housing limits");
    });
});

describe("resolveRenderLabels", () => {
    it("resolves structured area labels in a render rep", () => {
        const rep = {
            areas: [
                {
                    type: "pieces",
                    label: {
                        textKey: "test:STASH",
                        actor: { kind: "seat" as const, seat: 1 },
                    },
                },
            ],
        };
        const resolved = resolveRenderLabels(rep, ["Alice", "Bob"], mockT);
        expect(resolved.areas[0].label).to.equal("Alice's stash");
        expect(rep.areas[0].label).to.deep.equal({
            textKey: "test:STASH",
            actor: { kind: "seat", seat: 1 },
        });
    });

    it("resolves board markers and dual-board labels", () => {
        const rep = {
            board: {
                boardOne: {
                    label: {
                        textKey: "test:STASH",
                        actor: { kind: "seat" as const, seat: 2 },
                    },
                },
                markers: [
                    {
                        type: "label",
                        label: {
                            textKey: "test:DECK",
                            actor: { kind: "none" as const },
                        },
                    },
                ],
            },
        };
        const resolved = resolveRenderLabels(rep, ["Alice", "Bob"], mockT);
        expect(resolved.board.boardOne.label).to.equal("Bob's stash");
        expect(resolved.board.markers[0].label).to.equal("Cards in deck");
    });
});
