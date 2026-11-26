/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../../src";
import { ZertzGame } from "../../src/games/zertz.js";
import { layoutFor } from "../../src/games/zertz/graph.js";
import { anyJumpExists, enumerateJumpChains } from "../../src/games/zertz/jumps.js";
import { formatLastmove, parseMove, formatPlacementMove } from "../../src/games/zertz/notation.js";
import { captureWinReason, playerWins, thresholds } from "../../src/games/zertz/win.js";
import {
    isolationCaptures,
    removableRings,
    removableRingsAfterPlacement,
} from "../../src/games/zertz/rings.js";

describe("ZertzGame", () => {
    describe("validation prompts", () => {
        before(() => {
            addResource("en");
        });

        it("never shows the generic valid-move line on an empty move box", () => {
            const g = new ZertzGame();
            g.marbles = new Map([
                ["d3", "W"],
                ["d4", "G"],
                ["e4", "W"],
            ]);
            const v = g.validateMove("");
            expect(v.message).to.equal(i18next.t("apgames:validation.zertz.INITIAL_INSTRUCTIONS_CAPTURE"));
            expect(v.message).to.not.equal(i18next.t("apgames:validation._general.VALID_MOVE"));
        });

        it("prompts for the pool at the start of a placement turn", () => {
            const g = new ZertzGame();
            expect(g.validateMove("").message).to.equal(
                i18next.t("apgames:validation.zertz.INITIAL_INSTRUCTIONS_POOL"),
            );
        });

        it("rejects a pinched ring removal with a specific message", () => {
            const g = new ZertzGame(undefined, ["blitz"]);
            g.rings = new Set([
                "g4", "g2", "f4", "f2", "f1", "e5", "e4", "e3", "e2", "d6", "d4", "c4", "c3", "b4", "a3", "a2",
            ]);
            g.marbles = new Map([
                ["a2", "B"],
                ["d6", "W"],
                ["f1", "G"],
                ["e2", "G"],
                ["g2", "W"],
                ["c3", "W"],
                ["b4", "G"],
                ["e4", "B"],
            ]);
            const v = g.validateMove("bf4,f2");
            expect(v.valid).to.equal(false);
            expect(v.message).to.equal(
                i18next.t("apgames:validation.zertz.RING_NOT_FREE", { where: "f2" }),
            );
        });
    });

    describe("setup", () => {
        it("starts with standard pool on default board", () => {
            const g = new ZertzGame();
            expect(g.pool).to.deep.equal({ W: 6, G: 8, B: 10 });
            expect(g.rings.size).to.equal(37);
        });

        it("blitz pool and rejects with tournament", () => {
            expect(() => new ZertzGame(undefined, ["blitz", "tournament"])).to.throw(/Blitz/);
            const g = new ZertzGame(undefined, ["blitz"]);
            expect(g.pool).to.deep.equal({ W: 5, G: 7, B: 9 });
        });

        it("board variant ring counts", () => {
            const t = new ZertzGame(undefined, ["tournament"]);
            const o = new ZertzGame(undefined, ["oversize"]);
            const tCells = layoutFor("tournament").graph.listCells() as string[];
            const oCells = layoutFor("oversize").graph.listCells() as string[];
            expect(t.rings.size).to.equal(tCells.length);
            expect(o.rings.size).to.equal(oCells.length);
            expect(o.rings.size).to.equal(61);
        });

        it("tournament ring geometry resolves every stored cell", () => {
            const g = new ZertzGame(undefined, ["tournament"]);
            for (const cell of g.rings) {
                expect(() => g.graph.algebraic2coords(cell)).to.not.throw();
            }
            expect(() => removableRings(g.graph, g.rings, g.marbles)).to.not.throw();
            expect(g.moves().length).to.be.greaterThan(0);
        });
    });

    describe("notation", () => {
        it("parses placement and jump without spaces", () => {
            const p = parseMove("wd4,d1");
            expect(p?.kind).to.equal("place");
            if (p?.kind === "place") {
                expect(p.colour).to.equal("W");
                expect(p.cell).to.equal("d4");
                expect(p.remove).to.equal("d1");
            }
            const j = parseMove("xd1gd3wd5");
            expect(j?.kind).to.equal("jump");
        });

        it("round-trips a simple placement when legal", () => {
            const g = new ZertzGame();
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            for (const m of moves.slice(0, 5)) {
                const parsed = parseMove(m);
                expect(parsed).to.not.equal(undefined);
            }
        });

        it("formatLastmove uppercases colours and lowercases cells", () => {
            expect(formatLastmove("wd4,d1")).to.equal("Wd4,d1");
            expect(formatLastmove("xd1gd3wd5")).to.equal("xd1Gd3Wd5");
        });

        it("stores caps-normalized lastmove on commit", () => {
            const g = new ZertzGame();
            const mv = g.moves()[0]!.toLowerCase();
            g.move(mv, { trusted: true });
            expect(g.lastmove).to.equal(formatLastmove(mv));
        });
    });

    describe("win thresholds", () => {
        it("standard and blitz", () => {
            expect(thresholds(false)).to.deep.equal({
                tripleEach: 3,
                white: 4,
                grey: 5,
                black: 6,
            });
            expect(thresholds(true)).to.deep.equal({
                tripleEach: 2,
                white: 3,
                grey: 4,
                black: 5,
            });
        });

        it("detects winning captures", () => {
            expect(playerWins({ W: 4, G: 0, B: 0 }, false)).to.be.true;
            expect(playerWins({ W: 2, G: 2, B: 2 }, false)).to.be.false;
            expect(playerWins({ W: 2, G: 2, B: 2 }, true)).to.be.true;
        });

        it("classifies capture wins by reason", () => {
            expect(captureWinReason({ W: 3, G: 3, B: 3 }, false)).to.equal("each");
            expect(captureWinReason({ W: 4, G: 1, B: 0 }, false)).to.equal("white");
            expect(captureWinReason({ W: 0, G: 5, B: 2 }, false)).to.equal("grey");
            expect(captureWinReason({ W: 1, G: 2, B: 6 }, false)).to.equal("black");
            expect(captureWinReason({ W: 2, G: 2, B: 2 }, true)).to.equal("each");
        });

        it("records eog reason on a capturing-set win", () => {
            const g = new ZertzGame();
            g.captured[0] = { W: 4, G: 0, B: 0 };
            (g as unknown as { checkEOG: () => void }).checkEOG();
            expect(g.gameover).to.be.true;
            const eog = g.results.find((r) => r.type === "eog");
            expect(eog).to.not.equal(undefined);
            if (eog?.type === "eog") {
                expect(eog.reason).to.equal("white");
            }
        });
    });

    describe("rules", () => {
        it("removes isolated rings and captures marbles on them", () => {
            const g = new ZertzGame();
            const layout = layoutFor("default");
            g.graph = layout.graph;
            g.rings = new Set([
                "g4", "g2", "f4", "f2", "f1", "e5", "e4", "e3", "e2", "d6", "d4", "c4", "c3", "b4", "a3", "a2",
            ]);
            g.marbles = new Map([
                ["a2", "B"],
                ["d6", "W"],
                ["f1", "G"],
                ["e2", "G"],
                ["g2", "W"],
                ["c3", "W"],
                ["b4", "G"],
                ["e4", "B"],
            ]);
            g.pool = { W: 0, G: 0, B: 1 };
            g.currplayer = 2;
            const mv = g.moves().find((m) => m.toLowerCase().startsWith("bg4,a3x"));
            expect(mv).to.not.equal(undefined);
            g.move(mv!, { trusted: true });
            expect(g.rings.has("a2")).to.equal(false);
            expect(g.marbles.has("a2")).to.equal(false);
            expect(g.captured[1]!.B).to.equal(1);
        });

        it("does not claim marbles on the main component alone", () => {
            const layout = layoutFor("default");
            const rings = new Set(["d4", "e4", "e5", "d5", "f4"]);
            const marbles = new Map([
                ["d4", "W"],
                ["e4", "G"],
                ["e5", "B"],
                ["d5", "W"],
                ["f4", "G"],
            ]);
            expect(isolationCaptures(layout.graph, rings, marbles, "d4")).to.deep.equal([]);
        });

        it("allows removal only when a ring can slide out (two consecutive gaps)", () => {
            const layout = layoutFor("default");
            const rings = new Set([
                "g4", "g2", "f4", "f2", "f1", "e5", "e4", "e3", "e2", "d6", "d4", "c4", "c3", "b4", "a3",
                "a2",
            ]);
            const marbles = new Map([
                ["a2", "B"],
                ["d6", "W"],
                ["f1", "G"],
                ["e2", "G"],
                ["g2", "W"],
                ["c3", "W"],
                ["b4", "G"],
                ["e4", "B"],
            ]);
            const rem = removableRings(layout.graph, rings, marbles);
            expect(rem).to.include.members(["a3", "c4", "e5", "f4", "g4"]);
            expect(rem).to.not.include.members(["d4", "e3", "f2"]);
        });

        it("evaluates ring removal after the placement", () => {
            const g = new ZertzGame(undefined, ["blitz"]);
            g.rings = new Set([
                "g4", "g2", "f4", "f2", "f1", "e5", "e4", "e3", "e2", "d6", "d4", "c4", "c3", "b4", "a3", "a2",
            ]);
            g.marbles = new Map([
                ["a2", "B"],
                ["d6", "W"],
                ["f1", "G"],
                ["e2", "G"],
                ["g2", "W"],
                ["c3", "W"],
                ["b4", "G"],
                ["e4", "B"],
            ]);
            g.pool = { W: 0, G: 0, B: 1 };
            g.currplayer = 2;
            const remAfter = removableRingsAfterPlacement(g.graph, g.rings, g.marbles, "g4", "B");
            expect(remAfter).to.include.members(["a3", "e5"]);
            expect(remAfter).to.not.include("c3");
            expect(g.moves().some((m) => m.toLowerCase().startsWith("bg4,"))).to.be.true;
            expect(g.validateMove("bg4").valid).to.be.true;
        });

        it("must jump when captures exist", () => {
            const g = new ZertzGame();
            g.rings = new Set(g.rings);
            g.marbles = new Map([
                ["d3", "W"],
                ["d4", "G"],
                ["e4", "W"],
            ]);
            expect(anyJumpExists(g.graph, g.rings, g.marbles)).to.be.true;
            expect(g.moves().every((m) => m.startsWith("x"))).to.be.true;
        });

        it("applies a full jump chain", () => {
            const g = new ZertzGame();
            g.marbles = new Map([
                ["d3", "W"],
                ["d4", "G"],
                ["e4", "W"],
            ]);
            g.currplayer = 1;
            const chains = enumerateJumpChains(g.graph, g.rings, g.marbles);
            expect(chains.length).to.be.greaterThan(0);
            const mv = g.moves()[0]!;
            g.move(mv, { trusted: true });
            expect(g.captured[0].G).to.be.greaterThan(0);
        });

        it("never offers or accepts removing the placement ring", () => {
            const g = new ZertzGame();
            for (const m of g.moves()) {
                const p = parseMove(m);
                if (p?.kind === "place" && p.remove !== undefined) {
                    expect(p.remove).to.not.equal(p.cell);
                }
            }
            const vacant = [...g.rings].find((c) => !g.marbles.has(c))!;
            const bogus = `g${vacant},${vacant}`;
            expect(g.validateMove(bogus).valid).to.be.false;
        });

        it("placement consumes pool marble", () => {
            const g = new ZertzGame();
            const empty = (g as unknown as { vacantRings: () => string[] }).vacantRings();
            const cell = empty[0]!;
            const rem = removableRings(g.graph, g.rings, g.marbles);
            let mv: string;
            if (rem.length > 0) {
                const remove = rem.find((r) => r !== cell)!;
                mv = formatPlacementMove({
                    kind: "place",
                    colour: "W",
                    cell,
                    remove,
                });
            } else {
                mv = `w${cell}`;
            }
            g.move(mv, { trusted: true });
            expect(g.pool.W).to.equal(5);
            expect(g.marbles.get(cell)).to.equal("W");
        });
    });

    describe("partial moves", () => {
        it("accepts pool colour selection for playground interim render", () => {
            const g = new ZertzGame();
            expect(() => g.move("w", { partial: true, trusted: true })).to.not.throw();
            expect(g.pool.W).to.equal(6);
        });

        it("allows exploration-style partial apply without trusted", () => {
            const g = new ZertzGame();
            expect(() =>
                g.move("w", { partial: true, emulation: true }),
            ).to.not.throw();
            expect(g.pool.W).to.equal(6);
            const vacant = [...g.rings].find((c) => !g.marbles.has(c))!;
            const partial = `w${vacant}`;
            expect(() =>
                g.move(partial, { partial: true, emulation: true }),
            ).to.not.throw();
            expect(g.marbles.get(vacant)).to.equal("W");
        });

        it("treats lowercase input as complete when it matches a legal placement", () => {
            const g = new ZertzGame();
            const legal = g.moves()[0]!;
            const lowered = legal.toLowerCase();
            const v = g.validateMove(lowered);
            expect(v.valid).to.be.true;
            expect(v.complete).to.equal(1);
        });

        it("interim render places marble before ring removal", () => {
            const g = new ZertzGame();
            const rem = removableRings(g.graph, g.rings, g.marbles);
            expect(rem.length).to.be.greaterThan(0);
            const vacant = [...g.rings].find((c) => !g.marbles.has(c))!;
            const partial = `w${vacant}`;
            const v = g.validateMove(partial);
            expect(v.valid).to.be.true;
            expect(v.canrender).to.be.true;
            expect(v.complete).to.equal(-1);
            g.move(partial, { partial: true, trusted: true });
            expect(g.marbles.get(vacant)).to.equal("W");
            expect(g.pool.W).to.equal(5);
            expect(g.rings.has(vacant)).to.be.true;
        });
    });

    describe("render", () => {
        it("annotates jump moves and captures from the last stack ply", () => {
            const g = new ZertzGame();
            g.marbles = new Map([
                ["c4", "W"],
                ["d4", "G"],
            ]);
            g.currplayer = 1;
            const jump = g.moves().find((m) => m.toLowerCase().startsWith("xc4"));
            expect(jump).to.not.equal(undefined);
            g.move(jump!, { trusted: true });
            const rep = g.render();
            expect(rep.annotations).to.not.equal(undefined);
            expect(rep.annotations!.some((a) => a.type === "move")).to.be.true;
            expect(rep.annotations!.some((a) => a.type === "exit")).to.be.true;
        });

        it("includes board and area legend keys", () => {
            const rep = new ZertzGame().render();
            expect(rep.legend).to.have.keys("R", "W", "G", "B", "aW", "aG", "aB");
            const repAreas = new ZertzGame().render();
            expect(repAreas.areas).to.not.equal(undefined);
            const pool = repAreas.areas!.find((a) => a.type === "pieces")!;
            expect(pool!.pieces.every((p) => /^a[WGB]$/.test(p))).to.be.true;
            expect(rep.board?.style).to.equal("hex-of-tri");
        });
    });
});