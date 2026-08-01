/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { EvenAtOddsGame, BLANK_PIP_COLOUR, IMoveState } from "../../src/games/evenatodds";
import { DominoDeck } from "../../src/common/dominoes/DominoDeck";
import {
    ambiguousAnchorCell,
    ambiguousAnchorPipState,
    ambiguousSecondEndCell,
} from "../fixtures/evenatodds";

function gameFrom(overrides: Partial<IMoveState>, gameover = false): EvenAtOddsGame {
    const base = new EvenAtOddsGame();
    const ms = base.moveState();
    if (!("p1Side" in overrides)) {
        ms.p1Side = "evens";
    }
    Object.assign(ms, overrides);
    return new EvenAtOddsGame({
        game: "evenatodds",
        numplayers: 2,
        variants: [],
        gameover,
        winner: [],
        stack: [ms],
    });
}

function gameFromAmbiguousAnchor(): EvenAtOddsGame {
    return gameFrom(ambiguousAnchorPipState);
}

function allTileIds(g: EvenAtOddsGame): number[] {
    const ids = new Set<number>();
    for (const t of g.tiles) {
        ids.add(t.id);
    }
    for (const hand of g.hands) {
        for (const id of hand) {
            if (id !== "") {
                ids.add(id);
            }
        }
    }
    for (const id of g.boneyard) {
        ids.add(id);
    }
    for (const id of g.removed) {
        ids.add(id);
    }
    return [...ids];
}

type FlatColour = unknown;
type FlatLegendEntry = { colour?: FlatColour; opacity?: number };

function isLighten(c: FlatColour): c is { func: "lighten"; colour: unknown; dl: number; ds: number } {
    return typeof c === "object" && c !== null && (c as { func?: string }).func === "lighten";
}

function darkenTierFromKey(key: string): number {
    const m = /D(\d+)$/.exec(key);
    return m ? Number(m[1]) : 0;
}

function flatBoardLegendKeys(legend: Record<string, FlatLegendEntry | unknown>): string[] {
    return Object.keys(legend).filter(k => /^F\d/.test(k));
}

function frameColour(legend: Record<string, FlatLegendEntry | unknown>, key: string): FlatColour {
    const entry = legend[key] as FlatLegendEntry | [FlatLegendEntry, ...unknown[]];
    const frame = Array.isArray(entry) ? entry[0] : entry;
    return frame.colour;
}

function ghostFlatKeys(legend: Record<string, unknown>): string[] {
    return Object.keys(legend).filter(k => /^GF\d/.test(k));
}

function ghostIsoKeys(legend: Record<string, unknown>): string[] {
    return Object.keys(legend).filter(k => /^GI\d/.test(k));
}

function ghostFlatFrameOpacity(legend: Record<string, FlatLegendEntry | unknown>, key: string): number | undefined {
    const entry = legend[key] as FlatLegendEntry | [FlatLegendEntry, ...unknown[]];
    const frame = Array.isArray(entry) ? entry[0] : entry;
    return frame.opacity;
}

function isBlankPipColour(c: FlatColour): boolean {
    return typeof c === "object" && c !== null && (c as { func?: string }).func === "custom"
        && (c as { default?: string }).default === "#aaaaaa";
}

function handLegendKeys(legend: Record<string, FlatLegendEntry | unknown>): string[] {
    return Object.keys(legend).filter(k => /^H\d/.test(k));
}

describe("Even at Odds", () => {
    it("requires P1 to choose evens or odds before play", () => {
        const g = new EvenAtOddsGame();
        expect(g.moves()).to.deep.equal(["evens", "odds"]);
        expect(g.getButtons().map(b => b.move)).to.deep.equal(["evens", "odds"]);
        expect(g.validateMove("").valid).to.be.true;
        expect(g.validateMove("").complete).to.equal(-1);
        expect(g.validateMove("evens").valid).to.be.true;
        expect(g.validateMove("evens").complete).to.equal(1);
        expect(g.validateMove("0-2@-3,0N").valid).to.be.false;
    });

    it("renders neutral colours before P1 chooses a side", () => {
        const g = new EvenAtOddsGame();
        const legend = g.render({ altDisplay: "flat", perspective: 1 }).legend as Record<string, FlatLegendEntry | unknown>;
        for (const key of [...flatBoardLegendKeys(legend), ...handLegendKeys(legend)]) {
            expect(isBlankPipColour(frameColour(legend, key))).to.be.true;
        }
    });

    it("assigns sides and passes the first tile play to P2", () => {
        const g = new EvenAtOddsGame();
        const tilesBefore = g.tiles.length;
        const boneyardBefore = g.boneyard.length;
        g.move("evens");
        expect(g.p1Side).to.equal("evens");
        expect(g.currplayer).to.equal(2);
        expect(g.tiles).to.have.length(tilesBefore);
        expect(g.boneyard).to.have.length(boneyardBefore);

        const move = g.moves()[0]!;
        g.move(move);
        expect(g.currplayer).to.equal(1);
    });

    it("swaps pip colours when P1 chooses odds", () => {
        const g = new EvenAtOddsGame();
        g.move("odds");
        const legend = g.render({ altDisplay: "flat" }).legend as Record<string, FlatLegendEntry | unknown>;
        const oddKey = flatBoardLegendKeys(legend).find(k => /^F1/.test(k) && darkenTierFromKey(k) === 0);
        const evenKey = flatBoardLegendKeys(legend).find(k => /^F2/.test(k) && darkenTierFromKey(k) === 0);
        expect(oddKey).to.not.be.undefined;
        expect(evenKey).to.not.be.undefined;
        expect(frameColour(legend, oddKey!)).to.equal(1);
        expect(frameColour(legend, evenKey!)).to.equal(2);
    });

    it("sets up the starting grid, hands, boneyard, and removed tiles", () => {
        const g = new EvenAtOddsGame();
        expect(g.tiles).to.have.length(6);
        expect(g.hands[0]).to.have.length(7);
        expect(g.hands[1]).to.have.length(7);
        expect(g.boneyard).to.have.length(6);
        expect(g.removed).to.have.length(2);

        const doubleIds = [7, 13, 18, 22, 25, 27];
        expect(g.tiles.map(t => t.id).sort((a, b) => a - b)).to.deep.equal(doubleIds);

        const tile11 = g.tiles.find(t => t.pipA === 1 && t.pipB === 1)!;
        const tile66 = g.tiles.find(t => t.pipA === 6 && t.pipB === 6)!;
        const tile44 = g.tiles.find(t => t.pipA === 4 && t.pipB === 4)!;
        expect(tile11.a).to.deep.equal([-2, 1]);
        expect(tile11.b).to.deep.equal([-1, 1]);
        expect(tile66.a).to.deep.equal([0, 1]);
        expect(tile66.b).to.deep.equal([1, 1]);
        expect(tile44.a).to.deep.equal([0, -1]);
        expect(tile44.b).to.deep.equal([1, -1]);

        expect(allTileIds(g).sort((a, b) => a - b)).to.deep.equal(
            [...Array(28).keys()].sort((a, b) => a - b),
        );
    });

    it("allows table placement with a matching anchor on empty ground", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[2], []],
            boneyard: [],
            removed: [],
        });
        expect(g.moves()).to.include("0-2@-3,0N");
        expect(g.validateMove("0-2@-3,0N").valid).to.be.true;
    });

    it("allows stack placement on matching faces at equal height", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[14], []],
            boneyard: [],
            removed: [],
            tiles: [
                { id: 13, a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: 18, a: [2, 0], b: [3, 0], pipA: 3, pipB: 3, level: 0 },
            ],
        });
        expect(g.moves()).to.include("2-3@1,0E");
    });

    it("requires occupied anchors for stack placement", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[14], []],
            boneyard: [],
            removed: [],
            tiles: [
                { id: 13, a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: 18, a: [2, 0], b: [3, 0], pipA: 3, pipB: 3, level: 0 },
            ],
        });
        expect(g.moves()).to.include("2-3@2,0W");
        for (const mv of g.moves().filter(mv => mv.startsWith("2-3@2,-1"))) {
            expect(g.stackHeight([2, -1])).to.equal(0);
            expect(mv.startsWith("2-3@2,-1")).to.be.true;
        }
    });

    it("defers draw for partial and emulation moves", () => {
        const g = new EvenAtOddsGame();
        g.move("evens");
        const move = g.moves()[0]!;
        const boneyardBefore = g.boneyard.length;

        g.move(move, { partial: true });
        expect(g.boneyard).to.have.length(boneyardBefore);
        expect(g.tiles).to.have.length(6);

        const g2 = new EvenAtOddsGame(g.state());
        g2.move(move, { emulation: true });
        expect(g2.boneyard).to.have.length(boneyardBefore);
        expect(g2.tiles.length).to.be.greaterThan(6);
        expect(g2.hands[g2.currplayer - 1]).to.include("");
    });

    it("draws from the boneyard on a committed move", () => {
        const g = new EvenAtOddsGame();
        g.move("evens");
        const move = g.moves()[0]!;
        const boneyardBefore = g.boneyard.length;
        const player = g.currplayer;

        g.move(move);
        expect(g.boneyard).to.have.length(boneyardBefore - 1);
        expect(g.hands[player - 1]).to.have.length(7);
        expect(g.currplayer).to.equal(1);
    });

    it("autocompletes when only one second end is legal", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[14], []],
            boneyard: [],
            removed: [],
            tiles: [
                { id: 13, a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: 18, a: [2, 0], b: [3, 0], pipA: 3, pipB: 3, level: 0 },
            ],
        });
        const result = g.validateMove("2-3@2,0");
        expect(result.valid).to.be.true;
        expect(result.autocomplete).to.equal("2-3@2,0W");
        expect(result.complete).to.equal(1);
    });

    it("scores the largest connected even group", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[], []],
            boneyard: [],
            removed: [],
            tiles: [
                { id: 13, a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: 22, a: [2, 0], b: [3, 0], pipA: 4, pipB: 4, level: 0 },
                { id: 27, a: [2, 1], b: [3, 1], pipA: 6, pipB: 6, level: 0 },
            ],
        });
        g.gameover = true;
        const scores = g.sidebarScores();
        expect(scores[0].scores).to.deep.equal(["6", "0"]);
    });

    it("uses pip-key move notation with anchor and compass direction", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[2], []],
            boneyard: [],
            removed: [],
        });

        expect(g.validateMove("0-2").valid).to.be.true;
        expect(g.validateMove("0-2").complete).to.equal(-1);

        const partial = g.validateMove("0-2@-3,0");
        expect(partial.valid).to.be.true;
        expect(partial.complete).to.equal(-1);

        const full = "0-2@-3,0N";
        expect(g.moves()).to.include(full);
        expect(g.validateMove(full).valid).to.be.true;
        expect(g.validateMove(full).complete).to.equal(1);

        expect(g.validateMove("9-9").valid).to.be.false;
        expect(g.validateMove("3-2").valid).to.be.false;
    });

    it("requires asterisk notation for pip-ambiguous typed moves", () => {
        const g = gameFromAmbiguousAnchor();
        const ambiguous = g.validateMove("1-2@-3,1N");
        expect(ambiguous.valid).to.be.true;
        expect(ambiguous.complete).to.equal(-1);
        expect(ambiguous.canrender).to.be.true;
        if (ambiguous.message !== undefined) {
            expect(ambiguous.message).to.match(/asterisk|needs_anchor_pip/i);
        }

        expect(g.validateMove("1*-2@-3,1N").complete).to.equal(1);
        expect(g.validateMove("1-2*@-3,1N").complete).to.equal(1);
        expect(g.moves()).to.include("1*-2@-3,1N");
        expect(g.moves()).to.include("1-2*@-3,1N");
        expect(g.moves()).to.not.include("1-2@-3,1N");
    });

    it("resolves pip-ambiguous placements from hand end clicks", () => {
        const g = gameFromAmbiguousAnchor();
        const handL = g.handleClick("", -1, -1, "_domino_1-2_H8L_H8R_L");
        expect(handL.move).to.equal("1*-2");
        expect(g.anchorPip).to.equal(1);

        const fullL = g.handleClick(handL.move!, ambiguousSecondEndCell.row, ambiguousSecondEndCell.col);
        expect(fullL.complete).to.equal(1);
        expect(fullL.move).to.equal("1*-2@-3,1N");

        const g2 = gameFromAmbiguousAnchor();
        const handR = g2.handleClick("", -1, -1, "_domino_1-2_H8L_H8R_R");
        expect(handR.move).to.equal("1-2*");
        const fullR = g2.handleClick(handR.move!, ambiguousSecondEndCell.row, ambiguousSecondEndCell.col);
        expect(fullR.complete).to.equal(1);
        expect(fullR.move).to.equal("1-2*@-3,1N");

        const g3 = gameFromAmbiguousAnchor();
        const handL3 = g3.handleClick("", -1, -1, "_domino_1-2_H8L_H8R_L");
        const anchor = g3.handleClick(handL3.move!, ambiguousAnchorCell.row, ambiguousAnchorCell.col);
        expect(anchor.move).to.equal("1*-2@-3,1");
        expect(anchor.complete).to.equal(-1);
        const fullL3 = g3.handleClick(anchor.move!, ambiguousSecondEndCell.row, ambiguousSecondEndCell.col);
        expect(fullL3.move).to.equal("1*-2@-3,1N");
    });

    it("renders ghost anchor half during partial move", () => {
        const g = gameFromAmbiguousAnchor();
        g.move("1*-2@-3,1", { partial: true });

        const iso = g.render();
        const isoLegend = iso.legend as Record<string, { decor?: { top: Array<{ opacity?: number }> } }>;
        const giKeys = ghostIsoKeys(isoLegend);
        expect(giKeys.length).to.be.greaterThan(0);
        for (const key of giKeys) {
            const pipDecor = isoLegend[key].decor?.top?.[1];
            if (pipDecor !== undefined) {
                expect(pipDecor.opacity).to.equal(0.5);
            }
        }
        const pieces = iso.pieces as string[][][];
        const ghostAtAnchor = pieces[ambiguousAnchorCell.row][ambiguousAnchorCell.col]
            .some(id => /^GI\d/.test(id));
        expect(ghostAtAnchor).to.be.true;

        const enter = (iso.annotations as Array<{ type?: string; targets?: { row: number; col: number }[] }> | undefined)
            ?.find(a => a.type === "enter");
        if (enter !== undefined && "targets" in enter) {
            const anchorTarget = { row: ambiguousAnchorCell.row, col: ambiguousAnchorCell.col };
            expect(enter.targets).to.not.deep.include(anchorTarget);
        }

        const flat = g.render({ altDisplay: "flat" });
        const flatLegend = flat.legend as Record<string, FlatLegendEntry | unknown>;
        const gfKeys = ghostFlatKeys(flatLegend);
        expect(gfKeys.length).to.be.greaterThan(0);
        for (const key of gfKeys) {
            expect(ghostFlatFrameOpacity(flatLegend, key)).to.equal(0.5);
        }
    });

    it("renders full domino ghost when only one second end is legal", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[14], []],
            boneyard: [],
            removed: [],
            tiles: [
                { id: 13, a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: 18, a: [2, 0], b: [3, 0], pipA: 3, pipB: 3, level: 0 },
            ],
        });
        g.move("2-3@2,0", { partial: true });
        const iso = g.render();
        const giKeys = ghostIsoKeys(iso.legend as Record<string, unknown>);
        expect(giKeys.length).to.be.greaterThan(0);
        const pieces = iso.pieces as string[][][];
        const ghostCells: { row: number; col: number }[] = [];
        for (let row = 0; row < pieces.length; row++) {
            for (let col = 0; col < pieces[row].length; col++) {
                if (pieces[row][col].some(id => /^GI\d/.test(id))) {
                    ghostCells.push({ row, col });
                }
            }
        }
        expect(ghostCells).to.have.length(2);
        expect(ghostCells[0]).to.not.deep.equal(ghostCells[1]);
    });

    it("annotates last move with a move line between domino halves", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[2], []],
            boneyard: [],
            removed: [],
        });
        g.move("0-2@-3,0N");
        expect(g.lastmove).to.equal("0-2@-3,0N");

        const view = g.render();
        const moveAnn = (view.annotations as Array<{ type?: string; targets?: { row: number; col: number }[]; arrow?: boolean }> | undefined)
            ?.find(a => a.type === "move");
        expect(moveAnn).to.not.be.undefined;
        if (moveAnn !== undefined && "targets" in moveAnn) {
            expect(moveAnn.targets).to.deep.equal([
                { row: 3, col: 2 },
                { row: 2, col: 2 },
            ]);
            expect(moveAnn.arrow).to.equal(false);
        }
    });

    it("ignores hand end when placement pip is unambiguous", () => {
        const g = gameFromAmbiguousAnchor();
        g.handleClick("", -1, -1, "_domino_1-2_H8L_H8R_R");
        g.move("1-2@-3,0E");
        expect(g.lastmove).to.equal("1-2@-3,0E");
        const placed = g.tiles.find(t => t.id === 8)!;
        expect(placed.a).to.deep.equal([-3, 0]);
        expect(placed.pipA).to.equal(2);
    });

    it("exposes pip keys on domino hand tile ids", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[14], []],
            boneyard: [],
            removed: [],
        });
        const view = g.render({ perspective: 1 });
        const handArea = view.areas!.find(a => a.type === "pieces") as { pieces: Array<{ id?: string }> };
        expect(handArea.pieces[0].id).to.equal("2-3");
    });

    it("renders blank pips with customizable grey in iso and flat views", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[5], []],
            boneyard: [],
            removed: [],
        });
        g.move("0-5@0,0S");

        const isoLegend = g.render().legend as Record<string, { colour?: unknown }>;
        for (const key of Object.keys(isoLegend).filter(k => /^I0/.test(k) || k === "Pc0")) {
            expect(isoLegend[key].colour).to.deep.equal(BLANK_PIP_COLOUR);
        }

        const flatLegend = g.render({ altDisplay: "flat" }).legend as Record<string, Array<{ colour?: unknown }>>;
        for (const key of Object.keys(flatLegend).filter(k => /^F0/.test(k))) {
            expect(flatLegend[key][0].colour).to.deep.equal(BLANK_PIP_COLOUR);
        }
    });

    it("darkens flat board glyphs below the tallest stack", () => {
        const pool = DominoDeck.fromDouble(6).dominoes;
        const id = (l: number, r: number) => EvenAtOddsGame.dominoId(pool.find(d => d.l === l && d.r === r)!);
        const g = gameFrom({
            tiles: [
                { id: id(2, 2), a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: id(2, 3), a: [0, 0], b: [1, 0], pipA: 2, pipB: 3, level: 1 },
                { id: id(2, 4), a: [0, 0], b: [1, 0], pipA: 2, pipB: 4, level: 2 },
                { id: id(4, 4), a: [2, 0], b: [3, 0], pipA: 4, pipB: 4, level: 0 },
                { id: id(4, 5), a: [2, 0], b: [3, 0], pipA: 4, pipB: 5, level: 1 },
                { id: id(6, 6), a: [4, 0], b: [5, 0], pipA: 6, pipB: 6, level: 0 },
            ],
            hands: [[], []],
            boneyard: [],
            removed: [],
        });

        const legend = g.render({ altDisplay: "flat" }).legend as Record<string, FlatLegendEntry | unknown>;
        const flatKeys = flatBoardLegendKeys(legend);
        const byTier = (tier: number) => flatKeys.filter(k => darkenTierFromKey(k) === tier);

        const d0 = byTier(0);
        const d1 = byTier(1);
        const d2 = byTier(2);
        expect(d0.length).to.be.greaterThan(0);
        expect(d1.length).to.be.greaterThan(0);
        expect(d2.length).to.be.greaterThan(0);

        for (const key of d0) {
            const colour = frameColour(legend, key);
            expect(isLighten(colour)).to.be.false;
            expect(typeof colour).to.equal("number");
        }

        for (const key of d1) {
            const colour = frameColour(legend, key);
            if (!isLighten(colour)) {
                throw new Error(`expected lighten colour for ${key}`);
            }
            expect(colour.dl).to.be.lessThan(0);
            expect(typeof colour.colour).to.equal("number");
        }

        for (const key of d2) {
            const colour = frameColour(legend, key);
            if (!isLighten(colour)) {
                throw new Error(`expected lighten colour for ${key}`);
            }
            expect(colour.dl).to.be.lessThan(0);
        }

        const colourD1 = frameColour(legend, d1[0]!);
        const colourD2 = frameColour(legend, d2[0]!);
        if (!isLighten(colourD1) || !isLighten(colourD2)) {
            throw new Error("expected lighten colours for progressive comparison");
        }
        expect(colourD2.dl).to.be.lessThan(colourD1.dl);
        expect(colourD1.dl).to.be.lessThan(0);
    });

    it("uses unmodified flat colours when all stacks are at board height", () => {
        const g = new EvenAtOddsGame();
        g.move("evens");
        const legend = g.render({ altDisplay: "flat" }).legend as Record<string, FlatLegendEntry | unknown>;
        const flatKeys = flatBoardLegendKeys(legend);
        expect(flatKeys.length).to.be.greaterThan(0);
        for (const key of flatKeys) {
            expect(isLighten(frameColour(legend, key))).to.be.false;
        }
    });

    it("handleClick stacks via hand select then occupied board cells", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[16], []],
            boneyard: [],
            removed: [],
        });

        const hand = g.handleClick("", -1, -1, "_domino_2-5_H16L_H16R_L");
        expect(hand.valid).to.be.true;
        expect(hand.move).to.equal("2-5");

        const anchor = g.handleClick(hand.move, 3, 3, "0");
        expect(anchor.valid).to.be.true;
        expect(anchor.move).to.equal("2-5@-1,0");
        expect(anchor.complete).to.equal(-1);

        const full = g.handleClick(anchor.move, 3, 4, "0");
        expect(full.valid).to.be.true;
        expect(full.move).to.equal("2-5@-1,0E");
        expect(full.complete).to.equal(1);
        expect(hand.opts).to.be.undefined;
        expect(anchor.opts).to.be.undefined;
        expect(full.opts).to.be.undefined;
    });

    it("handleClick places on empty board cells without a piece id", () => {
        const g = gameFrom({
            currplayer: 1,
            hands: [[2], []],
            boneyard: [],
            removed: [],
        });

        const anchor = g.handleClick("0-2", 3, 1);
        expect(anchor.valid).to.be.true;
        expect(anchor.move).to.equal("0-2@-3,0");

        const full = g.handleClick(anchor.move, 2, 1);
        expect(full.valid).to.be.true;
        expect(full.move).to.equal("0-2@-3,0N");
        expect(full.complete).to.equal(1);
    });

    it("renders isometric and flat boards with off-board areas", () => {
        const g = new EvenAtOddsGame();
        const iso = g.render();
        expect(iso.renderer).to.equal("isometric");
        const isoBoard = iso.board as { width: number; height: number; rowLabels: string[]; columnLabels: string[] };
        expect(isoBoard.width).to.equal(8);
        expect(isoBoard.height).to.equal(7);
        expect(isoBoard.columnLabels).to.include("0");
        expect(isoBoard.columnLabels).to.include("\u22122");
        expect(isoBoard.rowLabels).to.include("0");
        expect(isoBoard.rowLabels).to.include("\u22122");

        const flat = g.render({ altDisplay: "flat" });
        expect((flat.board as { style: string }).style).to.equal("squares-beveled");
        const flatBoard = flat.board as { rowLabels: string[]; columnLabels: string[] };
        expect(flatBoard.columnLabels).to.deep.equal(isoBoard.columnLabels);
        expect(flatBoard.rowLabels).to.deep.equal(isoBoard.rowLabels);

        const playerView = g.render({ perspective: 1 });
        expect(playerView.areas).to.not.be.undefined;
        expect(playerView.areas!.length).to.be.greaterThan(0);
        const handArea = playerView.areas!.find(a => a.type === "pieces") as { ownerMark?: number };
        expect(handArea.ownerMark).to.equal(1);

        const observerView = g.render();
        expect(observerView.areas).to.not.be.undefined;
        for (const area of observerView.areas!) {
            expect((area as { ownerMark?: number }).ownerMark).to.be.undefined;
        }

        const nonParticipantView = g.render({ perspective: -1 });
        expect(nonParticipantView.areas).to.not.be.undefined;
        for (const area of nonParticipantView.areas!) {
            expect((area as { ownerMark?: number }).ownerMark).to.be.undefined;
        }
    });

    it("strips hidden information from state()", () => {
        const g = new EvenAtOddsGame();
        const stripped = g.state({ strip: true, player: 1 });
        const ms = stripped.stack[stripped.stack.length - 1];
        expect(ms.hands[1]).to.deep.equal([]);
        expect(ms.hands[0]).to.have.length(7);
        expect(ms.boneyard).to.deep.equal([]);
        expect(ms.boneyardCount).to.equal(6);
        expect(ms.removed).to.deep.equal([]);
    });

    it("reveals removed tiles after game over", () => {
        const g = new EvenAtOddsGame();
        g.gameover = true;
        const stripped = g.state({ strip: true, player: 1 });
        const ms = stripped.stack[stripped.stack.length - 1];
        expect(ms.removed).to.have.length(2);
    });

    it("reports boneyard count in sidebarStatuses", () => {
        const g = new EvenAtOddsGame();
        const statuses = g.sidebarStatuses();
        expect(statuses[0].value).to.deep.equal(["6"]);
    });

    it("enters overtime when endgame scoring is tied", () => {
        const pool = DominoDeck.fromDouble(6).dominoes;
        const g = gameFrom({
            currplayer: 1,
            hands: [[], []],
            boneyard: [],
            removed: [0, 1],
            overtime: false,
            tiles: [
                { id: EvenAtOddsGame.dominoId(pool.find(d => d.l === 2 && d.r === 2)!), a: [0, 0], b: [1, 0], pipA: 2, pipB: 2, level: 0 },
                { id: EvenAtOddsGame.dominoId(pool.find(d => d.l === 3 && d.r === 3)!), a: [2, 0], b: [3, 0], pipA: 3, pipB: 3, level: 0 },
            ],
        });
        (g as unknown as { checkEOG(): EvenAtOddsGame }).checkEOG();
        expect(g.overtime).to.be.true;
        expect(g.gameover).to.be.false;
        expect(g.hands[0]).to.have.length(1);
        expect(g.hands[1]).to.have.length(1);
        expect(g.removed).to.deep.equal([]);
    });
});
