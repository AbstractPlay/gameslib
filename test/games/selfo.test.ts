/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { SelfoGame, type playerid } from "../../src/games/selfo.js";
import { HexTriGraph } from "../../src/common/index.js";

// Radius-2 board (19 cells): "r2f5" only picks the size, every test sets the board itself.
const graph = new HexTriGraph(3, 5);

const setup = (variants: string[], black: string[], white: string[], current: playerid = 1): SelfoGame => {
    const game = new SelfoGame(undefined, variants);
    const board = new Map<string, playerid>();
    for (const c of black) { board.set(c, 1); }
    for (const c of white) { board.set(c, 2); }
    game.board = board;
    game.currplayer = current;
    return game;
};

const connected = (cells: string[], g: HexTriGraph = graph): boolean => {
    const set = new Set(cells);
    const seen = new Set<string>([cells[0]]);
    const stack = [cells[0]];
    while (stack.length > 0) {
        for (const n of g.neighbours(stack.pop()!)) {
            if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
    }
    return seen.size === set.size;
};

const corners = (graph.listCells() as string[]).filter(c => graph.neighbours(c).length === 3);

describe("Selfo", () => {
    describe("random start", () => {
        // [variants, radius, pieces per player]
        const sizes: [string[], number, number][] = [
            [["r2f5"], 2, 5],
            [[], 3, 9],
            [["r4f12"], 4, 12],
            [["r5f20"], 5, 20],
        ];
        for (const [variants, radius, pieces] of sizes) {
            it(`builds a valid board for ${variants.join(",") || "the default size"}`, () => {
                const g = new HexTriGraph(radius + 1, radius * 2 + 1);
                expect((g.listCells() as string[]).length).to.equal(3 * radius * (radius + 1) + 1);
                for (let i = 0; i < 10; i++) {
                    const game = new SelfoGame(undefined, variants);
                    const black = [...game.board.entries()].filter(([, p]) => p === 1).map(([c]) => c);
                    const white = [...game.board.entries()].filter(([, p]) => p === 2).map(([c]) => c);
                    expect(black.length).to.equal(pieces);
                    expect(white.length).to.equal(pieces);
                    expect(black.every(c => g.graph.hasNode(c))).to.be.true;
                    expect(connected(black, g)).to.be.false;
                    expect(connected(white, g)).to.be.false;
                    expect(game.gameover).to.be.false;
                    expect(game.moves().length).to.be.greaterThan(0);
                }
            });
        }

        it("records the starting position", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            const [first, second] = game.getStartingPosition().split("|");
            expect(first.split(",").length).to.equal(5);
            expect(second.split(",").length).to.equal(5);
        });
    });

    describe("moves and winning", () => {
        // black: c3 + n0 next to it + a loose piece t two steps away that can reach n1 (also next to c3)
        const centre = "c3";
        const nbrs = graph.neighbours(centre).sort();
        const n0 = nbrs[0];
        const n1 = nbrs.find(n => n !== n0 && !graph.neighbours(n0).includes(n))!;
        const t = graph.neighbours(n1).sort().find(c => c !== centre && !nbrs.includes(c))!;
        const used = new Set([centre, n0, n1, t]);
        const whites = (graph.listCells() as string[]).filter(c => !used.has(c) && !graph.neighbours(c).includes(n1)).slice(0, 4);

        it("generates only moves to adjacent empty cells", () => {
            const game = setup(["r2f5"], [centre, n0, t], whites.slice(0, 3));
            const moves = game.moves();
            expect(moves.length).to.be.greaterThan(0);
            for (const m of moves) {
                const [from, to] = m.split("-");
                expect(game.board.get(from)).to.equal(1);
                expect(game.board.has(to)).to.be.false;
                expect(graph.neighbours(from)).to.include(to);
            }
        });

        it("ends the game when the mover connects all their pieces", () => {
            const game = setup(["r2f5"], [centre, n0, t], whites.slice(0, 3));
            expect(game.moves()).to.include(`${t}-${n1}`);
            game.move(`${t}-${n1}`);
            expect(game.gameover).to.be.true;
            expect(game.winner).to.deep.equal([1]);
        });

        it("passes the turn when nobody has won", () => {
            const game = setup(["r2f5"], [centre, n0, t], whites.slice(0, 3));
            const other = game.moves().find(m => m !== `${t}-${n1}` && m.startsWith(`${t}-`))!;
            game.move(other);
            expect(game.gameover).to.be.false;
            expect(game.currplayer).to.equal(2);
        });

        it("rejects illegal moves", () => {
            const game = setup(["r2f5"], [centre, n0, t], whites.slice(0, 3));
            expect(game.validateMove(`${whites[0]}-${n1}`).valid).to.be.false; // not your piece
            expect(game.validateMove(`${centre}-${n0}`).valid).to.be.false;    // occupied
            expect(() => game.move(`${t}-${centre}`)).to.throw();
        });
    });

    describe("enclosure", () => {
        const c1 = corners[0];
        const c2 = corners.find(c => c !== c1 && !graph.neighbours(c1).includes(c) && graph.path(c1, c)!.length > 3)!;
        const around1 = graph.neighbours(c1);
        const around2 = graph.neighbours(c2);
        const [a, b, last] = around2;
        const mover = graph.neighbours(last).find(c => c !== c2 && !around2.includes(c) && !around1.includes(c) && c !== c1)!;
        const black = [c1, a, b, mover];
        const white = [...around1, c2];

        it("is a draw when a move leaves both sides enclosed", () => {
            const game = setup(["r2f5"], black, white);
            expect(game.moves()).to.include(`${mover}-${last}`);
            game.move(`${mover}-${last}`);
            expect(game.gameover).to.be.true;
            expect(game.winner).to.deep.equal([1, 2]);
        });

        it("is forbidden with the no-enclosure variant", () => {
            const game = setup(["r2f5", "no-enclosure"], black, white);
            expect(game.moves()).to.not.include(`${mover}-${last}`);
            expect(game.validateMove(`${mover}-${last}`).valid).to.be.false;
        });
    });

    describe("clicks", () => {
        it("builds a move from two clicks and lets you reselect", () => {
            const game = setup(["r2f5"], ["c3", "a1"], ["e1", "e3"]);
            const [fx, fy] = graph.algebraic2coords("c3");
            const free = graph.neighbours("c3").find(c => !game.board.has(c))!;
            const [tx, ty] = graph.algebraic2coords(free);
            const first = game.handleClick("", fy, fx);
            expect(first.valid).to.be.true;
            expect(first.move).to.equal("c3");
            expect(first.complete).to.equal(-1);
            const second = game.handleClick("c3", ty, tx);
            expect(second.valid).to.be.true;
            expect(second.move).to.equal(`c3-${free}`);
            expect(second.complete).to.equal(1);
            const [ox, oy] = graph.algebraic2coords("a1");
            expect(game.handleClick("c3", oy, ox).move).to.equal("a1");
            expect(game.handleClick("c3", fy, fx).move).to.equal("");
        });
    });

    describe("pie rule", () => {
        // a first move that does not end the game
        const firstMove = (game: SelfoGame): string => game.moves().find(m => !game.clone().move(m).gameover)!;

        it("is not available before the first move", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            expect(game.moves()).to.not.include("pie");
            expect(game.validateMove("pie").valid).to.be.false;
            expect(() => game.move("pie")).to.throw();
        });

        it("is only offered to the second player right after the first move", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            game.move(firstMove(game));
            expect(game.currplayer).to.equal(2);
            expect(game.isPieTurn()).to.be.true;
            expect(game.moves()).to.include("pie");
            expect(game.moves(1)).to.not.include("pie");
            expect(game.validateMove("pie").valid).to.be.true;
        });

        it("plays the generic Pass button as pie on the pie turn", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            expect(game.handleClick("", -1, -1, "_btn_pass").valid).to.be.false;
            game.move(firstMove(game));
            const before = new Map(game.board);
            const click = game.handleClick("", -1, -1, "_btn_pass");
            expect(click.valid).to.be.true;
            expect(click.move).to.equal("pie");
            expect(click.complete).to.equal(1);
            expect(game.validateMove("pass").valid).to.be.true;
            game.move("pass");
            expect(game.lastmove).to.equal("pie");
            for (const [cell, owner] of before) {
                expect(game.board.get(cell)).to.equal(owner === 1 ? 2 : 1);
            }
            expect(game.currplayer).to.equal(1);
        });

        it("does not allow passing outside the pie turn", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            expect(game.validateMove("pass").valid).to.be.false;
            expect(() => game.move("pass")).to.throw();
            game.move(firstMove(game));
            game.move(game.moves().find(m => m !== "pie")!);
            expect(game.validateMove("pass").valid).to.be.false;
            expect(game.handleClick("", -1, -1, "_btn_pass").valid).to.be.false;
        });

        it("is not available once the second player has simply moved on", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            game.move(firstMove(game));
            game.move(game.moves().find(m => m !== "pie")!);
            expect(game.isPieTurn()).to.be.false;
            expect(game.moves()).to.not.include("pie");
            expect(game.validateMove("pie").valid).to.be.false;
        });

        it("swaps the colours of all pieces and gives the move back to the first player", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            game.move(firstMove(game));
            const before = new Map(game.board);
            game.move("pie");
            expect(game.board.size).to.equal(before.size);
            for (const [cell, owner] of before) {
                expect(game.board.get(cell)).to.equal(owner === 1 ? 2 : 1);
            }
            expect(game.currplayer).to.equal(1);
            expect(game.gameover).to.be.false;
            expect(game.isPieTurn()).to.be.false;
            expect(game.moves()).to.not.include("pie");
        });

        it("survives serialization", () => {
            const game = new SelfoGame(undefined, ["r2f5"]);
            game.move(firstMove(game));
            game.move("pie");
            const copy = game.clone();
            expect(copy.currplayer).to.equal(1);
            expect([...copy.board.entries()]).to.deep.equal([...game.board.entries()]);
            expect(copy.moves()).to.deep.equal(game.moves());
        });
    });

    describe("state", () => {
        it("survives serialization", () => {
            const game = new SelfoGame(undefined, ["r2f5", "no-enclosure"]);
            game.move(game.moves()[0]);
            const copy = game.clone();
            expect(copy.moves()).to.deep.equal(game.moves());
            expect(copy.currplayer).to.equal(2);
            expect(copy.variants).to.deep.equal(["r2f5", "no-enclosure"]);
            expect(copy.getStartingPosition()).to.equal(game.getStartingPosition());
        });

        it("renders a hex board", () => {
            const rep = new SelfoGame(undefined, ["r2f5"]).render();
            expect(rep.board).to.deep.include({style: "hex-of-hex", minWidth: 3, maxWidth: 5});
        });
    });
});