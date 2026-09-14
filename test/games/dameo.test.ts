/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { DameoGame, IDameoState, IMoveState, playerid, CellContents } from "../../src/games/dameo";

type BoardCell = [string, CellContents];

function dameoFrom(opts: { board: BoardCell[]; currplayer?: playerid }): DameoGame {
    const state: IDameoState = {
        game: "dameo",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: [{
            _version: DameoGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board),
            countdown: 0,
        } as IMoveState],
    };
    return new DameoGame(state);
}

describe("Dameo", () => {
    it("handleClick extends partial move onto the starting occupied square", () => {
        const g = dameoFrom({
            board: [["a1", [1, 2]]],
        });
        const full = "a1-b2-a1";
        g.moves = () => [full];
        const [ax, ay] = g.algebraic2coords("a1");
        const click = g.handleClick("a1-b2", ay, ax);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal(full);
    });
});
