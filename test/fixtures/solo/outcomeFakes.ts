import { GameBase, IAPGameState, IIndividualState, IRenderOpts } from "../../../src/games/_base";
import type { IGradeTier, ISoloOutcomeMeta } from "../../../src/games/_solo-outcome";
import { APGamesInformation } from "../../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../../src/schemas/moveresults";
import { resolveChallengeSeed } from "../../../src/common/challenge-seed";

interface ISoloFakeMoveState extends IIndividualState {
    currplayer: number;
    lastmove?: string;
    moveCount: number;
}

class SoloOutcomeFakeBase extends GameBase {
    public stack: ISoloFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 1;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;
    public moveCount = 0;

    protected readonly passAtMoves: number;
    protected readonly outcomeMeta: ISoloOutcomeMeta;
    protected readonly gradeTiers: IGradeTier[] | undefined;
    protected readonly finalScore: number;

    protected constructor(
        state: string | undefined,
        config: {
            passAtMoves: number;
            outcomeMeta: ISoloOutcomeMeta;
            gradeTiers: IGradeTier[] | undefined;
            finalScore: number;
        },
    ) {
        super();
        this.passAtMoves = config.passAtMoves;
        this.outcomeMeta = config.outcomeMeta;
        this.gradeTiers = config.gradeTiers;
        this.finalScore = config.finalScore;
        if (state !== undefined) {
            this.hydrate(JSON.parse(state) as IAPGameState);
        } else {
            this.moveCount = 0;
            this.stack = [{
                _version: SoloOutcomeFakeBase.gameinfo.version,
                _results: [],
                _timestamp: new Date("2026-08-19T14:00:00.000Z"),
                currplayer: 1,
                moveCount: 0,
            }];
        }
    }

    public static readonly gameinfo: APGamesInformation = {
        name: "SoloOutcomeFake",
        uid: "soloOutcomeFake",
        playercounts: [1],
        version: "20260825",
        dateAdded: "2026-08-25",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    protected hydrate(state: IAPGameState): void {
        this.gameover = state.gameover;
        this.numplayers = state.numplayers;
        this.winner = [...state.winner];
        this.variants = [...state.variants];
        this.challengeSeed = state.challengeSeed;
        this.stack = state.stack.map((entry) => {
            const e = entry as ISoloFakeMoveState;
            if (typeof e._timestamp === "string") {
                e._timestamp = new Date(e._timestamp);
            }
            return e;
        });
        const top = this.stack[this.stack.length - 1];
        this.currplayer = top.currplayer;
        this.lastmove = top.lastmove;
        this.moveCount = top.moveCount;
        this.results = top._results !== undefined ? [...top._results] : [];
        if (this.challengeSeed !== undefined) {
            const counter = typeof top.rngCounter === "number" ? top.rngCounter : 0;
            this.initRng(this.challengeSeed, counter);
        }
    }

    public getSoloOutcomeMeta(): ISoloOutcomeMeta {
        return this.outcomeMeta;
    }

    public getGradeTiers(): IGradeTier[] | undefined {
        return this.gradeTiers;
    }

    public getPlayerScore(player: number): number {
        void player;
        return this.moveCount;
    }

    public getBinaryPassed(player: number): boolean | undefined {
        if (this.outcomeMeta.outcomeType !== "binary" || player !== 1) {
            return undefined;
        }
        return this.moveCount <= this.passAtMoves;
    }

    public move(m: string, { trusted = false } = {}): SoloOutcomeFakeBase {
        if (!trusted) {
            throw new Error("SoloOutcomeFake only supports trusted moves in fixtures");
        }
        this.lastmove = m;
        this.moveCount += 1;
        this.results = [{ type: "move", from: "", to: "", what: m }];
        if (this.moveCount >= this.finalScore && this.outcomeMeta.outcomeType !== "graded") {
            this.finish();
        }
        if (this.outcomeMeta.outcomeType === "graded" && m === "finish") {
            this.moveCount = this.finalScore;
            this.finish();
        }
        this.saveState();
        return this;
    }

    protected finish(): void {
        this.gameover = true;
        this.winner = [1];
        this.results.push({ type: "eog" });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SoloOutcomeFakeBase.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            challengeSeed: this.challengeSeed,
            rngCounter: this.rng?.getCounter(),
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SoloOutcomeFakeBase {
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error(`Invalid stack index ${idx}`);
        }
        const slice = this.stack.slice(0, idx + 1);
        const Ctor = this.constructor as new (state?: string, challengeSeed?: string) => SoloOutcomeFakeBase;
        const loaded = new Ctor(
            JSON.stringify({
                game: SoloOutcomeFakeBase.gameinfo.uid,
                numplayers: this.numplayers,
                variants: this.variants,
                gameover: idx === this.stack.length - 1 ? this.gameover : false,
                winner: idx === this.stack.length - 1 ? this.winner : [],
                challengeSeed: this.challengeSeed,
                stack: slice,
            }),
        );
        loaded.restoreSoloRngFromEntry(slice[slice.length - 1]);
        return loaded;
    }

    public clone(): SoloOutcomeFakeBase {
        const Ctor = this.constructor as new (state?: string, challengeSeed?: string) => SoloOutcomeFakeBase;
        return new Ctor(this.serialize());
    }

    protected moveState(): ISoloFakeMoveState {
        return {
            _version: SoloOutcomeFakeBase.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(this.stack[0]._timestamp.getTime() + this.moveCount * 60_000),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            moveCount: this.moveCount,
        };
    }
}

/** Binary pass/fail — lower moves is better; pass at ≤25 moves. */
export class SoloBinaryFake extends SoloOutcomeFakeBase {
    public constructor(state?: string, challengeSeed?: string) {
        super(state, {
            passAtMoves: 25,
            finalScore: 22,
            gradeTiers: undefined,
            outcomeMeta: {
                outcomeType: "binary",
                scoreDirection: "lower",
                scoreLabel: "moves",
            },
        });
        if (state === undefined) {
            this.initRng(resolveChallengeSeed(challengeSeed ?? "20260819-042"));
        }
    }
}

/** Graded tiers — higher points is better. */
export class SoloGradedFake extends SoloOutcomeFakeBase {
    public constructor(state?: string) {
        super(state, {
            passAtMoves: 0,
            finalScore: 73,
            gradeTiers: [
                { id: "pass", label: "apgames:solo.tiers.pass", threshold: 50 },
                { id: "good", label: "apgames:solo.tiers.good", threshold: 70 },
                { id: "excellent", label: "apgames:solo.tiers.excellent", threshold: 90 },
            ],
            outcomeMeta: {
                outcomeType: "graded",
                scoreDirection: "higher",
                scoreLabel: "points",
            },
        });
        if (state === undefined) {
            for (let i = 0; i < 72; i++) {
                this.move("score", { trusted: true });
            }
            this.move("finish", { trusted: true });
        }
    }
}

/** Pure numeric score — fewer moves wins. */
export class SoloScoreFake extends SoloOutcomeFakeBase {
    public constructor(state?: string) {
        super(state, {
            passAtMoves: 0,
            finalScore: 14,
            gradeTiers: undefined,
            outcomeMeta: {
                outcomeType: "score",
                scoreDirection: "lower",
                scoreLabel: "moves",
            },
        });
        if (state === undefined) {
            for (let i = 0; i < 14; i++) {
                this.move("step", { trusted: true });
            }
        }
    }
}

/** Timed sprint — elapsed ms from stack timestamps. */
export class SoloTimedFake extends SoloOutcomeFakeBase {
    public constructor(state?: string, challengeSeed?: string) {
        super(state, {
            passAtMoves: 0,
            finalScore: 5,
            gradeTiers: undefined,
            outcomeMeta: {
                outcomeType: "timed",
                scoreDirection: "lower",
                scoreLabel: "time",
            },
        });
        if (state === undefined) {
            this.initRng(resolveChallengeSeed(challengeSeed ?? "20260819-042"));
            const start = new Date("2026-08-19T14:02:10.123Z");
            this.stack[0]._timestamp = start;
            for (let i = 0; i < 5; i++) {
                this.move("tick", { trusted: true });
            }
            const end = new Date(start.getTime() + 184_000);
            this.stack[this.stack.length - 1]._timestamp = end;
        }
    }

    protected moveState(): ISoloFakeMoveState {
        const start = new Date(this.stack[0]._timestamp).getTime();
        const ts = new Date(start + this.moveCount * 36_800);
        return {
            _version: SoloOutcomeFakeBase.gameinfo.version,
            _results: [...this.results],
            _timestamp: ts,
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            moveCount: this.moveCount,
        };
    }
}

export function buildSoloBinaryRecord() {
    const g = new SoloBinaryFake();
    for (let i = 0; i < 22; i++) {
        g.move("step", { trusted: true });
    }
    return g;
}

export function buildSoloGradedRecord() {
    return new SoloGradedFake();
}

export function buildSoloScoreRecord() {
    return new SoloScoreFake();
}

export function buildSoloTimedRecord() {
    return new SoloTimedFake();
}
