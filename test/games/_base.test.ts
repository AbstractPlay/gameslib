import "mocha";
import { expect } from "chai";
import { GameBase, GameBaseSimultaneous, GameBaseSkipTurn, IAPGameState, IIndividualState, IRenderOpts } from "../../src/games/_base";
import { APGamesInformation } from "../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../src/schemas/moveresults";
import { getPliesSequential, moveHistoryFromSequentialPlies } from "../../src/games/_turn-sequential";
import { skipTurnShouldCloseRound } from "../../src/games/_turn-skip";
import type { IGameRound } from "../../src/games/_turn-model";
import { getMoveListFromGame, roundMoveStrings } from "../fixtures/turnModel/helpers";
import {
    buildSoloSequentialFake,
    soloSequentialMoveHistoryGolden,
} from "../fixtures/turnModel/soloSequential";

interface IFakeMoveState extends IIndividualState {
    currplayer: number;
    lastmove?: string;
}

/**
 * Minimal 2-player engine for turn-model unit tests.
 */
class RoundRobinFake extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "RoundRobinFake",
        uid: "roundRobinFake",
        playercounts: [2],
        version: "20260819",
        dateAdded: "2026-08-19",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: IFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 2;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;

    public constructor(moves: string[], finalCurrplayer = 1) {
        super();
        this.stack = [{
            _version: RoundRobinFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
        }];
        let cp = 1;
        for (const move of moves) {
            this.results = [{ type: "move", from: "", to: "", what: move }];
            this.lastmove = move;
            cp = cp === 1 ? 2 : 1;
            this.currplayer = cp;
            this.stack.push({
                _version: RoundRobinFake.gameinfo.version,
                _results: [...this.results],
                _timestamp: new Date(),
                currplayer: cp,
                lastmove: move,
            });
        }
        this.currplayer = finalCurrplayer;
    }

    public move(move: string): RoundRobinFake {
        throw new Error(`RoundRobinFake is constructed with a fixed stack; got ${move}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public state(_opts?: { strip?: boolean; player?: number }): IAPGameState {
        return {
            game: RoundRobinFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): RoundRobinFake {
        void idx;
        return new RoundRobinFake([]);
    }

    public clone(): RoundRobinFake {
        return new RoundRobinFake([]);
    }

    protected moveState(): IFakeMoveState {
        return {
            _version: RoundRobinFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
        };
    }
}

/** Two consecutive plies by seat 1 before seat 2 acts — stride mis-groups columns. */
class ConsecutiveP1Fake extends RoundRobinFake {
    public constructor() {
        super([]);
        this.stack = [{
            _version: RoundRobinFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
        }];
        const seq: Array<{ move: string; cpAfter: number }> = [
            { move: "first", cpAfter: 1 },
            { move: "second", cpAfter: 2 },
            { move: "third", cpAfter: 2 },
        ];
        for (const { move, cpAfter } of seq) {
            this.results = [{ type: "move", from: "", to: "", what: move }];
            this.lastmove = move;
            this.currplayer = cpAfter;
            this.stack.push({
                _version: RoundRobinFake.gameinfo.version,
                _results: [...this.results],
                _timestamp: new Date(),
                currplayer: cpAfter,
                lastmove: move,
            });
        }
    }
}

interface ISimultaneousMoveState extends IIndividualState {
    lastmove: string[];
}

/** Minimal 2p simultaneous engine — one stack entry per round. */
class SimultaneousFake extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "SimultaneousFake",
        uid: "simultaneousFake",
        playercounts: [2],
        version: "20260820",
        dateAdded: "2026-08-20",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: ISimultaneousMoveState[] = [];
    public gameover = false;
    public numplayers = 2;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];

    public constructor(rounds: Array<[string, string] | [string | null, string | null]>) {
        super();
        this.stack = [{
            _version: SimultaneousFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            lastmove: [],
        }];
        for (const pair of rounds) {
            const lastmove = pair.map((m) => (m === null ? "\u0091" : m)) as [string, string];
            this.stack.push({
                _version: SimultaneousFake.gameinfo.version,
                _results: [
                    { type: "move", from: "a1", to: "a2" },
                    { type: "move", from: "b1", to: "b2" },
                ],
                _timestamp: new Date(),
                lastmove,
            });
        }
    }

    public move(move: string): SimultaneousFake {
        throw new Error(`SimultaneousFake is constructed with a fixed stack; got ${move}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SimultaneousFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SimultaneousFake {
        void idx;
        return new SimultaneousFake([]);
    }

    public clone(): SimultaneousFake {
        return new SimultaneousFake([]);
    }

    protected moveState(): ISimultaneousMoveState {
        const top = this.stack[this.stack.length - 1];
        return {
            _version: SimultaneousFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: top?.lastmove ?? [],
        };
    }
}

describe("GameBaseSimultaneous turn model (Phase 2)", () => {
    it("turnModel() is simultaneous", () => {
        const g = new SimultaneousFake([["p1", "p2"]]);
        expect(g.turnModel()).to.equal("simultaneous");
    });

    it("one stack entry yields one export round with per-seat moves", () => {
        const g = new SimultaneousFake([["a1", "b1"], ["a2", "b2"]]);
        expect(g.getPlies().map((p) => p.move)).to.deep.equal(["a1", "b1", "a2", "b2"]);
        expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal([
            ["a1", "b1"],
            ["a2", "b2"],
        ]);
    });

    it("eliminated seats export as null, not \\u0091", () => {
        const g = new SimultaneousFake([[null, "active"]]);
        expect(roundMoveStrings(g.getRounds())).to.deep.equal([[null, "active"]]);
        expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal([[null, "active"]]);
    });
});

/** 3p skip-turn: seat 2 inactive after opening; rounds close on currplayer wrap. */
class SkipTurnFake extends GameBaseSkipTurn {
    public static readonly gameinfo: APGamesInformation = {
        name: "SkipTurnFake",
        uid: "skipTurnFake",
        playercounts: [3],
        version: "20260820",
        dateAdded: "2026-08-20",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: IFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 3;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;
    private readonly inactiveFromStack = 4;

    public constructor() {
        super();
        this.stack = [{
            _version: SkipTurnFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
        }];
        const seq: Array<{ move: string; cpAfter: number }> = [
            { move: "p1a", cpAfter: 2 },
            { move: "p2a", cpAfter: 3 },
            { move: "p3a", cpAfter: 1 },
            { move: "p1b", cpAfter: 3 },
            { move: "p3b", cpAfter: 1 },
        ];
        for (const { move, cpAfter } of seq) {
            this.results = [{ type: "move", from: "", to: "", what: move }];
            this.lastmove = move;
            this.currplayer = cpAfter;
            this.stack.push({
                _version: SkipTurnFake.gameinfo.version,
                _results: [...this.results],
                _timestamp: new Date(),
                currplayer: cpAfter,
                lastmove: move,
            });
        }
    }

    protected isSeatActive(seat: number, stackIndex: number): boolean {
        if (stackIndex < this.inactiveFromStack) {
            return true;
        }
        return seat !== 2;
    }

    public move(move: string): SkipTurnFake {
        throw new Error(`SkipTurnFake is fixed; got ${move}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SkipTurnFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SkipTurnFake {
        void idx;
        return new SkipTurnFake();
    }

    public clone(): SkipTurnFake {
        return new SkipTurnFake();
    }

    protected moveState(): IFakeMoveState {
        return {
            _version: SkipTurnFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
        };
    }
}

describe("GameBaseSkipTurn turn model (Phase 3)", () => {
    it("turnModel() is skip-turn", () => {
        expect(new SkipTurnFake().turnModel()).to.equal("skip-turn");
    });

    it("closes rounds when currplayer wraps to the opener", () => {
        const g = new SkipTurnFake();
        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 2, 3, 1, 3]);
        expect(plies.map((p) => p.round)).to.deep.equal([0, 0, 0, 1, 1]);
        expect(skipTurnShouldCloseRound(g, plies.slice(0, 3), 3)).to.equal(true);
        expect(skipTurnShouldCloseRound(g, plies.slice(3, 5), 5)).to.equal(true);
    });

    it("inactive seats export as null", () => {
        const g = new SkipTurnFake();
        expect(roundMoveStrings(g.getRounds())).to.deep.equal([
            ["p1a", "p2a", "p3a"],
            ["p1b", null, "p3b"],
        ]);
    });
});

describe("GameBase turn model (Phase 1)", () => {
    it("turnModel() defaults to sequential", () => {
        const g = new RoundRobinFake(["a1", "b1"]);
        expect(g.turnModel()).to.equal("sequential");
    });

    it("getPlies actors follow prevState.currplayer", () => {
        const g = new RoundRobinFake(["a1", "b1", "a2"]);
        expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1]);
    });

    it("getPliesSequential matches moveHistory stride grouping", () => {
        const g = new RoundRobinFake(["a1", "b1", "a2", "b2"]);
        const sequential = getPliesSequential(g);
        expect(sequential.map((p) => p.move)).to.deep.equal(["a1", "b1", "a2", "b2"]);
        expect(sequential.map((p) => p.actor)).to.deep.equal([1, 2, 1, 2]);
        expect(moveHistoryFromSequentialPlies(g)).to.deep.equal(g.moveHistory());
    });

    it("getMoveList move strings align with getRounds for standard 2p round-robin", () => {
        const g = new RoundRobinFake(["a1", "b1", "a2", "b2"]);
        const plies = g.getPlies();
        expect(plies.length).to.equal(4);
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 2, 1, 2]);
        expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal([
            ["a1", "b1"],
            ["a2", "b2"],
        ]);
    });

    it("numplayers === 1 closes a round after every ply", () => {
        const g = buildSoloSequentialFake();
        expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 1, 1]);
        expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal(
            soloSequentialMoveHistoryGolden,
        );
        expect(g.moveHistory()).to.deep.equal(soloSequentialMoveHistoryGolden);
    });

    it("consecutive plies by same seat differ from moveHistory column packing", () => {
        const g = new ConsecutiveP1Fake();
        expect(g.moveHistory()).to.deep.equal([["first", "second"], ["third"]]);
        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 1, 2]);
        expect(plies.map((p) => p.round)).to.deep.equal([0, 0, 1]);
        expect(getMoveListFromGame(g)).to.not.deep.equal(g.moveHistory());
        expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal([
            ["second"],
            [null, "third"],
        ]);
    });
});
