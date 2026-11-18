import "mocha";
import { expect } from "chai";
import { MixtourGame, type IMoveState, type playerid } from "../../src/games/mixtour";

describe("Mixtour", () => {
    it("forbids stack moves that restore the board before the opponent's last turn", () => {
        const sharedBoard = [
            ["e2", [1, 2, 2]],
            ["a2", [1, 1, 1, 2]],
            ["c2", [1, 1, 1, 2]],
            ["e5", [1, 2, 2, 2]],
            ["b4", [1]],
            ["e3", [2]],
            ["e1", [1, 1, 1, 2]],
            ["c1", [1, 1, 1]],
            ["a5", [2]],
        ] as const;
        const beforeOpp = new Map<string, playerid[]>([
            ...sharedBoard.map(([cell, stack]) => [cell, [...stack]] as [string, playerid[]]),
            ["c5", [1, 2]],
        ]);
        const afterOpp = new Map<string, playerid[]>([
            ...sharedBoard
                .filter(([cell]) => cell !== "b4")
                .map(([cell, stack]) => [cell, [...stack]] as [string, playerid[]]),
            ["b4", [1, 2]],
            ["c5", [1]],
        ]);
        const frame = (board: Map<string, playerid[]>, lastmove: string): IMoveState => ({
            _version: MixtourGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
            inhand: [4, 9],
            board,
            target: 2,
            scores: [1, 1],
            lastmove,
        });
        const g = new MixtourGame(undefined, ["three"]);
        g.stack = [frame(beforeOpp, "b4:1-c5"), frame(afterOpp, "c5:1-b4")];
        g.load();
        expect(g.moves(1)).to.not.include("b4:1-c5");
        expect(g.validateMove("b4:1-c5").valid).to.equal(false);
    });

    it("persists score variants in serialized state", () => {
        const g = new MixtourGame(undefined, ["five"]);
        expect(g.target).to.equal(3);
        expect(g.state().variants).to.deep.equal(["five"]);

        const restored = new MixtourGame(g.serialize());
        expect(restored.variants).to.deep.equal(["five"]);
        expect(restored.target).to.equal(3);
    });

    it("infers score variants from target when reloading legacy state", () => {
        const g = new MixtourGame(undefined, ["three"]);
        const legacy = g.state();
        legacy.variants = [];

        const restored = new MixtourGame(legacy);
        expect(restored.variants).to.deep.equal(["three"]);
        expect(restored.target).to.equal(2);
    });
});
