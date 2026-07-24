/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { EvenAtOddsGame, BLANK_PIP_COLOUR, IMoveState } from "../../src/games/evenatodds";
import { DominoDeck } from "../../src/common/dominoes/DominoDeck";

function gameFrom(overrides: Partial<IMoveState>, gameover = false): EvenAtOddsGame {
    const base = new EvenAtOddsGame();
    const ms = base.moveState();
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

describe("Even at Odds", () => {
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
        const move = g.moves()[0]!;
        const boneyardBefore = g.boneyard.length;
        const player = g.currplayer;

        g.move(move);
        expect(g.boneyard).to.have.length(boneyardBefore - 1);
        expect(g.hands[player - 1]).to.have.length(7);
        expect(g.currplayer).to.not.equal(player);
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
