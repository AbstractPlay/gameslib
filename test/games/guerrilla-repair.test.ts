/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GuerrillaGame, IGuerrillaState, IMoveState, playerid } from "../../src/games/guerrilla";
import {
    isCombinedGuerrillaTransitionFrame,
    repairGuerrillaMatchStack,
    repairGuerrillaMatchStackJson,
} from "../../src/games/guerrilla-repair";

type BoardCell = [string, playerid];

function guerrillaFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    insurgents?: number;
    variants?: string[];
}): GuerrillaGame {
    const state: IGuerrillaState = {
        game: "guerrilla",
        numplayers: 2,
        variants: opts.variants ?? ["match"],
        gameover: false,
        winner: [],
        stack: [{
            _version: GuerrillaGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board),
            insurgents: opts.insurgents ?? 66,
        } as IMoveState],
    };
    return new GuerrillaGame(state);
}

describe("Guerrilla match stack repair", () => {
    it("detects legacy combined transition frames", () => {
        const entry = {
            _version: GuerrillaGame.gameinfo.version,
            _results: [{ type: "winners", players: [1] }, { type: "reset" }],
            _timestamp: new Date(),
            currplayer: 2,
            board: new Map([["f4", 2]]),
            insurgents: 66,
            rolesSwapped: true,
            g1insurgentScore: 2,
        } as IMoveState;
        expect(isCombinedGuerrillaTransitionFrame(entry)).to.be.true;
    });

    it("does not flag a valid reset-only checkpoint", () => {
        const entry = {
            _version: GuerrillaGame.gameinfo.version,
            _results: [{ type: "reset" }],
            _timestamp: new Date(),
            currplayer: 2,
            board: new Map([["f4", 2]]),
            insurgents: 66,
            rolesSwapped: true,
            g1insurgentScore: 2,
        } as IMoveState;
        expect(isCombinedGuerrillaTransitionFrame(entry)).to.be.false;
    });

    function legacyCombinedFromGoodTransition(g: GuerrillaGame): IGuerrillaState {
        const g1End = g.stack[g.stack.length - 2] as IMoveState;
        const g2Reset = g.stack[g.stack.length - 1] as IMoveState;
        const corrupt: IMoveState = {
            ...g2Reset,
            _results: [...(g1End._results ?? []), ...(g2Reset._results ?? [])],
        };
        delete (corrupt as { lastmove?: string }).lastmove;
        const prefix = g.stack.slice(0, g.stack.length - 2);
        return {
            ...g.state(),
            stack: [...prefix, corrupt],
        };
    }

    it("splits a legacy combined frame produced from a good transition", () => {
        const g = guerrillaFrom({
            board: [["a8", 2]],
            currplayer: 1,
            variants: ["match"],
        });
        const mv = g.moves().find((m) => m.split(",").includes("a8|b7"));
        expect(mv).to.not.equal(undefined);
        const stackBefore = g.stack.length;
        g.move(mv!, {trusted: true});
        expect(g.stack.length).to.equal(stackBefore + 2);

        const broken = legacyCombinedFromGoodTransition(g);
        const repaired = repairGuerrillaMatchStack(broken);
        expect(repaired.repaired).to.be.true;
        const engine = new GuerrillaGame(repaired.state);
        expect(engine.stack.length).to.equal(g.stack.length);
        expect((engine.stack[engine.stack.length - 2] as IMoveState).lastmove).to.equal(mv);
        expect(() => engine.getPlies()).to.not.throw();
        expect(isCombinedGuerrillaTransitionFrame(engine.stack[engine.stack.length - 1] as IMoveState)).to.be.false;
    });

    it("repairs JSON when game 2 moves follow the combined frame", () => {
        const g = guerrillaFrom({
            board: [["a8", 2]],
            currplayer: 1,
            variants: ["match"],
        });
        const mv = g.moves().find((m) => m.split(",").includes("a8|b7"));
        g.move(mv!, {trusted: true});

        const afterG2Move: IMoveState = {
            _version: GuerrillaGame.gameinfo.version,
            _results: [{ type: "place", where: "a1" }],
            _timestamp: new Date(),
            currplayer: 1,
            lastmove: "a1|b2,c3|d4",
            board: new Map([["a1", 1]]),
            insurgents: 64,
            rolesSwapped: true,
            g1insurgentScore: g.g1insurgentScore,
        };

        const broken = legacyCombinedFromGoodTransition(g);
        broken.stack.push(afterG2Move);

        const { stateJson, repaired } = repairGuerrillaMatchStackJson(
            new GuerrillaGame(broken).serialize(),
        );
        expect(repaired).to.be.true;
        const fixed = new GuerrillaGame(stateJson);
        expect(fixed.stack.length).to.equal(g.stack.length + 1);
        expect(() => fixed.getPlies()).to.not.throw();
    });
});
