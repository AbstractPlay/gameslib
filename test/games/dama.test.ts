/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { DamaGame, IDamaState, IMoveState, playerid, CellContents } from "../../src/games/dama";

type BoardCell = [string, CellContents];

function damaFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    crownsPending?: string[];
    stack?: IMoveState[];
}): DamaGame {
    const moveState: IMoveState = {
        _version: DamaGame.gameinfo.version,
        _results: [],
        _timestamp: new Date(),
        currplayer: opts.currplayer ?? 1,
        board: new Map(opts.board),
        crownsPending: opts.crownsPending ?? [],
    };
    const state: IDamaState = {
        game: "dama",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: opts.stack ?? [moveState],
    };
    return new DamaGame(state);
}

function moveIncreasesY(g: DamaGame, mv: string): boolean {
    const cells = mv.split("-");
    const [, y0] = g.algebraic2coords(cells[0]);
    const [, y1] = g.algebraic2coords(cells[cells.length - 1]);
    return y1 > y0;
}

function moveDecreasesY(g: DamaGame, mv: string): boolean {
    const cells = mv.split("-");
    const [, y0] = g.algebraic2coords(cells[0]);
    const [, y1] = g.algebraic2coords(cells[cells.length - 1]);
    return y1 < y0;
}

describe("Dama", () => {
    it("starts with 32 men on rows 1–2 and 5–6; back ranks empty", () => {
        const g = new DamaGame();
        expect(g.board.size).to.equal(32);
        for (let algebraicRow = 1; algebraicRow <= 8; algebraicRow++) {
            const y = 8 - algebraicRow;
            for (let col = 0; col < 8; col++) {
                const cell = g.coords2algebraic(col, y);
                if (algebraicRow === 1 || algebraicRow === 2) {
                    expect(g.board.get(cell)).to.deep.equal([2, 1]);
                } else if (algebraicRow === 5 || algebraicRow === 6) {
                    expect(g.board.get(cell)).to.deep.equal([1, 1]);
                } else {
                    expect(g.board.has(cell)).to.be.false;
                }
            }
        }
    });

    it("shows destination dots for a partial move", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [["e5", [1, 1]]],
        });
        g.move("e5", { partial: true });
        const dots = g.render().annotations?.find(a => a.type === "dots");
        expect(dots).to.not.equal(undefined);
        expect(dots!.targets.length).to.equal(3);
    });

    it("validateMove sets canrender for an incomplete prefix", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [["e5", [1, 1]]],
        });
        const result = g.validateMove("e5");
        expect(result.valid).to.be.true;
        expect(result.canrender).to.be.true;
        expect(result.complete).to.equal(-1);
    });

    it("men do not move backward", () => {
        const g = new DamaGame();
        const moves = g.moves(1);
        expect(moves.length).to.be.greaterThan(0);
        for (const mv of moves) {
            expect(moveIncreasesY(g, mv)).to.be.false;
        }
        g.currplayer = 2;
        const moves2 = g.moves(2);
        for (const mv of moves2) {
            expect(moveDecreasesY(g, mv)).to.be.false;
        }
    });

    it("requires maximal capture", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 1]],
                ["d4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        const moves = g.moves();
        expect(moves).to.deep.equal(["e4-c4-a4"]);
    });

    it("removes captured pieces immediately during a multi-capture", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 2]],
                ["d4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        const moves = g.moves();
        expect(moves).to.include("e4-c4-a4");
    });

    it("defers promotion until the owner's next turn", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["a7", [1, 1]],
                ["b3", [1, 1]],
                ["h2", [2, 1]],
            ],
        });
        g.move("a7-a8");
        expect(g.board.get("a8")).to.deep.equal([1, 1]);
        expect(g.crownsPending).to.include("a8");
        g.move("h2-g2");
        expect(g.board.get("a8")).to.deep.equal([1, 2]);
        expect(g.crownsPending).to.not.include("a8");
        expect(g.moves().some(mv => mv.startsWith("a8-"))).to.be.true;
    });

    it("crowns the incoming player on the board before they move", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["a4", [1, 1]],
                ["e2", [2, 1]],
            ],
        });
        g.move("a4-a5");
        g.move("e2-e1");
        expect(g.board.get("e1")).to.deep.equal([2, 1]);
        expect(g.crownsPending).to.include("e1");
        g.move("a5-a6");
        expect(g.board.get("e1")).to.deep.equal([2, 2]);
        expect(g.crownsPending).to.not.include("e1");
    });

    it("does not crown during a partial capture sequence", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 1]],
                ["d4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        g.move("e4-c4", { trusted: true, partial: true });
        expect(g.results.some(r => r.type === "promote")).to.be.false;
        expect(g.crownsPending).to.be.empty;
        expect(g.board.get("e4")).to.deep.equal([1, 1]);
    });

    it("forbids a 180-degree king turn between captures", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["e4", [1, 2]],
                ["d4", [2, 1]],
                ["c4", [2, 1]],
                ["b4", [2, 1]],
            ],
        });
        const moves = g.moves();
        expect(moves).to.not.include("e4-a4-b4-c4-d4");
    });

    it("draws king versus single man", () => {
        const g = damaFrom({
            currplayer: 1,
            board: [
                ["a1", [1, 2]],
                ["h8", [2, 1]],
            ],
        });
        g.checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
    });

    it("draws on threefold repetition", () => {
        const board = new Map<string, CellContents>([
            ["a1", [1, 2]],
            ["b1", [2, 2]],
        ]);
        const frame: IMoveState = {
            _version: DamaGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1 as playerid,
            board: new Map(board),
            crownsPending: [],
        };
        const state: IDamaState = {
            game: "dama",
            numplayers: 2,
            variants: [],
            gameover: false,
            winner: [],
            stack: [frame, { ...frame, board: new Map(board) }],
        };
        const g = new DamaGame(state);
        g.checkEOG();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
    });
});
