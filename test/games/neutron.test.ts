/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { NeutronGame, type PieceId, type playerid } from "../../src/games/neutron";

function gameFrom(
    board: Map<string, PieceId>,
    currplayer: playerid,
    variants: string[] = [],
): NeutronGame {
    const moveState = {
        _version: NeutronGame.gameinfo.version,
        _results: [] as const,
        _timestamp: new Date(),
        currplayer,
        board,
    };
    return new NeutronGame({
        game: "neutron",
        numplayers: 2,
        variants,
        gameover: false,
        winner: [],
        stack: [moveState, moveState],
    });
}

describe("Neutron", () => {
    describe("setup", () => {
        it("starts with a 5×5 board and centred neutron", () => {
            const g = new NeutronGame();
            expect(g.boardWidth).to.equal(5);
            expect(g.boardHeight).to.equal(5);
            expect(g.getNeutronCell()).to.equal("c3");
            expect(g.board.get("a1")).to.equal(1);
            expect(g.board.get("a5")).to.equal(2);
        });

        it("supports 7×5 dimensions", () => {
            const g = new NeutronGame(undefined, ["7x5"]);
            expect(g.boardWidth).to.equal(7);
            expect(g.boardHeight).to.equal(5);
            expect([...g.board.values()].filter((v) => v === 1).length).to.equal(7);
            expect([...g.board.values()].filter((v) => v === 2).length).to.equal(7);
            expect(g.getNeutronCell()).to.equal("d3");
        });
    });

    describe("sliding", () => {
        it("allows only furthest slides (b1 to b4, not b2)", () => {
            const g = new NeutronGame();
            const dests = g.slideDestinations("b1", g.board);
            expect(dests).to.include("b4");
            expect(dests).to.not.include("b2");
            expect(g.moves()).to.include("b1-b4");
            expect(g.moves()).to.not.include("b1-b2");
        });
    });

    describe("opening", () => {
        it("restricts White's first turn to pawns in standard Neutron", () => {
            const g = new NeutronGame();
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves.every((m) => m.includes("-") && !m.includes(","))).to.be.true;
        });

        it("allows neutron moves on White's first turn in CoNeutron", () => {
            const g = new NeutronGame(undefined, ["coneutron"]);
            const moves = g.moves();
            expect(moves.some((m) => m.includes(","))).to.be.true;
        });
    });

    describe("winning", () => {
        it("ends without a pawn move when the neutron reaches your back row (Neutron)", () => {
            const board = new Map<string, PieceId>([
                ["c2", 3],
                ["a5", 1],
                ["e5", 1],
                ["a1", 2],
                ["e1", 2],
            ]);
            const g = gameFrom(board, 1);
            expect(g.moves()).to.include("c1");
            g.move("c1", { trusted: true });
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });

        it("wins on the opponent's back row in CoNeutron", () => {
            const board = new Map<string, PieceId>([
                ["c2", 3],
                ["a5", 1],
                ["b5", 1],
                ["a1", 2],
                ["b1", 2],
            ]);
            const g = gameFrom(board, 1, ["coneutron"]);
            expect(g.moves()).to.include("c5");
            g.move("c5", { trusted: true });
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });
    });

    describe("stalemate", () => {
        it("offers no moves when the neutron is surrounded", () => {
            const board = new Map<string, PieceId>([
                ["b2", 2],
                ["c2", 2],
                ["d2", 2],
                ["b3", 2],
                ["d3", 2],
                ["b4", 2],
                ["c4", 2],
                ["d4", 2],
                ["c3", 3],
                ["a5", 1],
                ["e5", 1],
            ]);
            const g = gameFrom(board, 2);
            expect(g.moves()).to.deep.equal([]);
        });
    });

    describe("mobility", () => {
        it("forbids landing on the opponent's home row when restricted", () => {
            const board = new Map<string, PieceId>([
                ["c3", 3],
                ["c2", 1],
                ["a5", 1],
                ["a1", 2],
            ]);
            const g = gameFrom(board, 1, ["restricted"]);
            const moves = g.moves();
            expect(moves.some((m) => m.endsWith("-a1"))).to.be.false;
        });

        it("allows back-rank slides but forbids re-entry under double restricted", () => {
            const onRank = new Map<string, PieceId>([
                ["c3", 3],
                ["a1", 1],
                ["c1", 1],
                ["a5", 2],
            ]);
            const g1 = gameFrom(onRank, 1, ["doubleRestricted"]);
            expect(g1.moves().some((m) => m.endsWith("a1-b1"))).to.be.true;

            const offRank = new Map<string, PieceId>([
                ["c3", 3],
                ["a2", 1],
                ["c1", 1],
                ["a5", 2],
            ]);
            const g2 = gameFrom(offRank, 1, ["doubleRestricted"]);
            expect(g2.moves().some((m) => m.includes("a2-a1"))).to.be.false;
        });
    });

    describe("notation", () => {
        it("accepts a full turn and compound validation", () => {
            const g = new NeutronGame();
            g.move("b1-a2", { trusted: true });
            expect(g.stack.length).to.equal(2);
            const v = g.validateMove("a3,a5-a4");
            expect(v.valid).to.be.true;
        });
    });

    describe("handleClick", () => {
        /** Neutron on c4, player 1 to play — pawn c1 may land on c4 after neutron c4→e2. */
        const midgameBoard = new Map<string, PieceId>([
            ["a5", 2],
            ["b1", 1],
            ["c1", 1],
            ["e1", 2],
            ["e5", 1],
            ["a2", 2],
            ["d5", 1],
            ["d1", 2],
            ["c5", 1],
            ["c4", 3],
            ["b2", 2],
        ]);

        function clickCell(g: NeutronGame, move: string, cell: string) {
            const [x, y] = g.algebraic2coords(cell);
            return g.handleClick(move, y, x);
        }

        it("completes a pawn slide onto the neutron's departure cell before partial board update", () => {
            const g = gameFrom(midgameBoard, 1);
            expect(g.moves()).to.include("e2,c1-c4");
            let move = "";
            const n = clickCell(g, move, "e2");
            expect(n.valid).to.be.true;
            move = n.move;
            const p = clickCell(g, move, "c1");
            expect(p.valid).to.be.true;
            expect(p.move).to.equal("e2,c1");
            move = p.move;
            const d = clickCell(g, move, "c4");
            expect(d.valid).to.be.true;
            expect(d.complete).to.equal(1);
            expect(d.move).to.equal("e2,c1-c4");
        });

        it("allows partial pawn preview after neutron is on its destination", () => {
            const g = gameFrom(midgameBoard, 1);
            g.move("e2", { partial: true });
            const v = g.validateMove("e2,c1");
            expect(v.valid).to.be.true;
            expect(() => g.move("e2,c1", { partial: true })).to.not.throw();
        });

        it("shows pawn destinations from the board after the chosen neutron slide", () => {
            const g = gameFrom(midgameBoard, 1);
            g.move("e2,c1", { partial: true });
            const dots = (g.render().annotations ?? []).find((a) => a.type === "dots");
            const cells = (dots?.targets ?? []).map((t) => g.coords2algebraic(t.col, t.row));
            expect(cells).to.include("c4");
        });
    });

    describe("partial preview", () => {
        it("shows only the neutron arrow after a neutron partial (no pawn dots or prior turn arrow)", () => {
            const g = new NeutronGame();
            g.move("b1-b4", { trusted: true });
            const neutronDest = g.slideDestinations(g.getNeutronCell(), g.board)[0]!;
            const fresh = new NeutronGame(g.serialize());
            fresh.move(neutronDest, { partial: true });
            const rep = fresh.render();
            const moveArrows = (rep.annotations ?? []).filter((a) => a.type === "move");
            expect(moveArrows).to.have.length(1);
            const dots = (rep.annotations ?? []).find((a) => a.type === "dots");
            expect(dots).to.be.undefined;
        });

        it("does not throw when previewing empty neutron selection", () => {
            const g = new NeutronGame();
            g.move("b1-b4", { trusted: true });
            const fresh = new NeutronGame(g.serialize());
            fresh.move("", { partial: true });
            const rep = fresh.render();
            const moveArrows = (rep.annotations ?? []).filter((a) => a.type === "move");
            expect(moveArrows).to.have.length(0);
            const dots = (rep.annotations ?? []).find((a) => a.type === "dots");
            expect(dots).to.exist;
        });
    });
});
