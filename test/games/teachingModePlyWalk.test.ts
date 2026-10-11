import "mocha";
import { expect } from "chai";
import { GameBaseSequenced } from "../../src/games/_turn-sequenced";
import { FroggerGame } from "../../src/games/frogger";
import type { IAPGameState, IIndividualState } from "../../src/games/_base";
import type { APGamesInformation } from "../../src/schemas/gameinfo";
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../../src/schemas/moveresults";
import {
    pliesAlignWithStackWalk,
    targetStackLengthBeforeTrailingRun,
    teachingPlyWalkSupported,
    trailingSameActorRun,
} from "../../src/games/_teachingPlyWalk";

interface ISequencedFakeMoveState extends IIndividualState {
    currplayer: number;
    lastmove?: string;
}

/**
 * 2p sequenced fake: same seat may act twice before currplayer advances to the opponent.
 * Built with explicit currplayer on each stack frame (not round-robin auto-advance).
 */
class SequencedTwoPlayerDoubleActivationFake extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "SequencedTwoPlayerDoubleActivationFake",
        uid: "sequencedTwoPlayerDoubleActivationFake",
        playercounts: [2],
        version: "20261011",
        dateAdded: "2026-10-11",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: ISequencedFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 2;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;
    public lastmove?: string;

    public constructor(
        frames: Array<{ lastmove: string; currplayer: number }>,
    ) {
        super();
        this.stack = [{
            _version: SequencedTwoPlayerDoubleActivationFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
        }];
        for (const frame of frames) {
            this.lastmove = frame.lastmove;
            this.currplayer = frame.currplayer;
            this.stack.push({
                _version: SequencedTwoPlayerDoubleActivationFake.gameinfo.version,
                _results: [{ type: "move", from: "", to: "", what: frame.lastmove }],
                _timestamp: new Date(),
                currplayer: frame.currplayer,
                lastmove: frame.lastmove,
            });
        }
    }

    public move(): SequencedTwoPlayerDoubleActivationFake {
        throw new Error("fixed fixture");
    }

    public render(): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SequencedTwoPlayerDoubleActivationFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(): SequencedTwoPlayerDoubleActivationFake {
        return new SequencedTwoPlayerDoubleActivationFake([]);
    }

    public clone(): SequencedTwoPlayerDoubleActivationFake {
        return new SequencedTwoPlayerDoubleActivationFake([]);
    }
}

describe("teaching mode ply walk (Phase 0)", () => {
    it("maps one ply per stack index for sequenced 2p double-activation fixture", () => {
        const g = new SequencedTwoPlayerDoubleActivationFake([
            { lastmove: "p1a", currplayer: 1 },
            { lastmove: "p1b", currplayer: 2 },
            { lastmove: "p2a", currplayer: 1 },
        ]);
        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 1, 2]);
        expect(plies.map((p) => p.stackIndex)).to.deep.equal([1, 2, 3]);
        expect(pliesAlignWithStackWalk(plies, g.stack.length)).to.equal(true);
        expect(teachingPlyWalkSupported(plies)).to.equal(true);
    });

    it("trailing same-actor run length 2 rolls back to first ply in run", () => {
        const g = new SequencedTwoPlayerDoubleActivationFake([
            { lastmove: "p1a", currplayer: 1 },
            { lastmove: "p1b", currplayer: 2 },
        ]);
        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 1]);
        const run = trailingSameActorRun(plies, 1);
        expect(run).to.not.equal(null);
        expect(run!.plies).to.have.length(2);
        expect(targetStackLengthBeforeTrailingRun(run!)).to.equal(1);
    });

    it("single ply at tip has run length 1", () => {
        const g = new SequencedTwoPlayerDoubleActivationFake([
            { lastmove: "p1a", currplayer: 2 },
        ]);
        const run = trailingSameActorRun(g.getPlies(), 1);
        expect(run!.plies).to.have.length(1);
        expect(targetStackLengthBeforeTrailingRun(run!)).to.equal(1);
    });

    describe("Frogger 2p refills (teaching audit)", () => {
        const sequencedRefills = `{"game":"frogger","numplayers":2,"variants":["freeswim","refills"],"gameover":false,"winner":[],"stack":[{"_version":"20260822","_results":[{"type":"move","from":"g3","to":"f3","what":"2MK","how":"back"},{"type":"move","from":"f3","to":"e2","what":"6MV","how":"back"},{"type":"move","from":"e2","to":"d3","what":"NS","how":"back"}],"_timestamp":"2026-01-08T20:08:26.404Z","currplayer":2,"lastmove":"g3-f3,2MK/f3-e2,6MV/e2-d3,NS/","board":{"dataType":"Map","value":[["b4","3MV"],["c4","4YK"],["d4","NY"],["e4","PVLY"],["f4","5SV"],["g4","5YK"],["h4","PMSL"],["i4","PMYK"],["j4","NM"],["k4","4VL"],["l4","PSVK"],["m4","4MS"],["a3","X1-5"],["a2","X2-5"],["c3","X2"],["d3","X1"]]},"closedhands":[["5ML","8VL","3LY"],["2VL","9VY","7SK"]],"hands":[["1Y","6LK","9LK","NK","8YK","2SY","1K","2MK","6MV","NS"],["9MS","1L","7VY","1S","6SY","1M","NL","1V","3SK","7ML"]],"market":["NV"],"discards":[],"nummoves":3}]}`;

        it("supports teaching ply walk after consecutive refill plies by one seat", () => {
            const g = new FroggerGame(sequencedRefills);
            g.move("c3-b3,NV!/");
            g.move("b3-a2,8MS/");

            const plies = g.getPlies();
            expect(plies.map((p) => p.actor)).to.deep.equal([2, 2]);
            expect(teachingPlyWalkSupported(plies)).to.equal(true);
            expect(pliesAlignWithStackWalk(plies, g.stack.length)).to.equal(true);

            const run = trailingSameActorRun(plies, 2);
            expect(run!.plies).to.have.length(2);
            expect(targetStackLengthBeforeTrailingRun(run!)).to.equal(1);
        });

        it("does not use simultaneous structural flag", () => {
            expect(FroggerGame.gameinfo.flags?.includes("simultaneous")).to.equal(false);
        });
    });
});
