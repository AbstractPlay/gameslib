import "mocha";
import { expect } from "chai";
import { GameBase, IAPGameState, IIndividualState, IRenderOpts } from "../../src/games/_base";
import { APGamesInformation } from "../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../src/schemas/moveresults";
import type { IGamePly, TurnModel } from "../../src/games/_turn-model";
import { sequencedShouldCloseRound } from "../../src/games/_turn-sequenced";
import {
    sequencedSkiptoPlyActor,
    sequencedSkiptoShouldCloseRound,
    type ISkiptoStackState,
} from "../../src/games/_turn-sequenced-skipto";

interface ISkiptoFakeMoveState extends IIndividualState, ISkiptoStackState {}

/**
 * Frogger-refills-shaped stack tail (legacy `skipto` on stack entries).
 */
class SequencedSkiptoFake extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "SequencedSkiptoFake",
        uid: "sequencedSkiptoFake",
        playercounts: [4],
        version: "20260820",
        dateAdded: "2026-08-20",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: ISkiptoFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 4;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;

    public constructor(useSkiptoRoundGuard: boolean) {
        super();
        this.useSkiptoRoundGuard = useSkiptoRoundGuard;
        this.stack = [{
            _version: SequencedSkiptoFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
        }];
        const tail: Array<{ move: string; cp: number; sk?: number }> = [
            { move: "p1-turn", cp: 2 },
            { move: "p2-turn", cp: 3 },
            { move: "l4-k4,9MS!/", cp: 4, sk: 3 },
            { move: "pass", cp: 1, sk: 3 },
            { move: "pass", cp: 2, sk: 3 },
            { move: "pass", cp: 3, sk: 3 },
            { move: "k4-j3,NL/", cp: 4 },
        ];
        for (const { move, cp, sk } of tail) {
            this.results = [{ type: "move", from: "", to: "", what: move }];
            this.lastmove = move;
            this.currplayer = cp;
            this.stack.push({
                _version: SequencedSkiptoFake.gameinfo.version,
                _results: [...this.results],
                _timestamp: new Date(),
                currplayer: cp,
                skipto: sk,
                lastmove: move,
            });
        }
    }

    private readonly useSkiptoRoundGuard: boolean;

    public turnModel(): TurnModel {
        return "sequenced";
    }

    protected plyActor(stackIndex: number): number {
        return sequencedSkiptoPlyActor(this, stackIndex);
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        if (this.useSkiptoRoundGuard) {
            return sequencedSkiptoShouldCloseRound(this, roundPlies, stackIndex);
        }
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    public move(move: string): SequencedSkiptoFake {
        throw new Error(`SequencedSkiptoFake is fixed; got ${move}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SequencedSkiptoFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SequencedSkiptoFake {
        void idx;
        return new SequencedSkiptoFake(this.useSkiptoRoundGuard);
    }

    public clone(): SequencedSkiptoFake {
        return new SequencedSkiptoFake(this.useSkiptoRoundGuard);
    }

    protected moveState(): ISkiptoFakeMoveState {
        return {
            _version: SequencedSkiptoFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
        };
    }
}

describe("Legacy sequenced skipto helpers (Frogger refills)", () => {
    it("assigns pass actors in seat order after the deferred skipto seat", () => {
        const g = new SequencedSkiptoFake(true);
        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 2, 3, 4, 1, 2, 3]);
    });

    it("keeps the refill cycle in one round while skipto is pending", () => {
        const g = new SequencedSkiptoFake(true);
        const plies = g.getPlies();
        expect(plies.map((p) => p.round)).to.deep.equal([0, 0, 0, 0, 0, 0, 0]);
    });

    it("splits the refill cycle without the skipto round guard", () => {
        const withGuard = new SequencedSkiptoFake(true).getPlies();
        const withoutGuard = new SequencedSkiptoFake(false).getPlies();
        expect(withoutGuard.map((p) => p.round)).to.not.deep.equal(withGuard.map((p) => p.round));
        expect(new Set(withoutGuard.map((p) => p.round)).size).to.be.greaterThan(1);
    });

    it("returns the deferred seat on supplemental submit", () => {
        const g = new SequencedSkiptoFake(true);
        expect(sequencedSkiptoPlyActor(g, g.stack.length - 1)).to.equal(3);
    });

    it("does not close while skipto remains on the stack entry", () => {
        const g = new SequencedSkiptoFake(true);
        const plies = g.getPlies();
        const passPly = plies.find((p) => p.move === "pass" && p.actor === 4)!;
        expect(
            sequencedSkiptoShouldCloseRound(g, plies.slice(0, passPly.playOrder), passPly.stackIndex),
        ).to.equal(false);
    });
});
