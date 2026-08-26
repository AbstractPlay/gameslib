import { GameBase, IAPGameState, IIndividualState, IRenderOpts } from "../../../src/games/_base";
import { APGamesInformation } from "../../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../../src/schemas/moveresults";
import { resolveChallengeSeed } from "../../../src/common/challenge-seed";

export interface ISoloRngMoveState extends IIndividualState {
    currplayer: number;
    lastmove?: string;
    roll?: number;
    ply: number;
    drawPile?: string[];
}

/**
 * Minimal solo dice game for RNG / catch-up / replay golden tests.
 * Move "roll" commits one d6 from GameRng; setup stores opening roll on stack[0].
 */
export class SoloRngFake extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "SoloRngFake",
        uid: "soloRngFake",
        playercounts: [1],
        version: "20260825",
        dateAdded: "2026-08-25",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: ISoloRngMoveState[] = [];
    public gameover = false;
    public numplayers = 1;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;
    public ply = 0;
    private committedRoll?: number;

    public constructor(state?: string, challengeSeed?: string) {
        super();
        if (state !== undefined) {
            this.hydrate(JSON.parse(state) as IAPGameState);
        } else {
            const seed = resolveChallengeSeed(challengeSeed);
            this.initRng(seed);
            const openingRoll = this.rng!.randomInt(6);
            this.stack = [{
                _version: SoloRngFake.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                ply: 0,
                roll: openingRoll,
                rngCounter: this.rng!.getCounter(),
                challengeSeed: seed,
            }];
        }
    }

    private hydrate(state: IAPGameState): void {
        this.gameover = state.gameover;
        this.numplayers = state.numplayers;
        this.winner = [...state.winner];
        this.variants = [...state.variants];
        this.challengeSeed = state.challengeSeed;
        this.stack = state.stack.map((entry) => {
            const e = entry as ISoloRngMoveState;
            if (typeof e._timestamp === "string") {
                e._timestamp = new Date(e._timestamp);
            }
            return e;
        });
        const top = this.stack[this.stack.length - 1];
        this.currplayer = top.currplayer;
        this.lastmove = top.lastmove;
        this.ply = top.ply;
        this.committedRoll = top.roll;
        this.results = top._results !== undefined ? [...top._results] : [];
        if (this.challengeSeed !== undefined) {
            const counter = typeof top.rngCounter === "number" ? top.rngCounter : 0;
            this.initRng(this.challengeSeed, counter);
        }
    }

    public move(m: string, { trusted = false, emulation = false } = {}): SoloRngFake {
        if (!trusted) {
            throw new Error("SoloRngFake only supports trusted moves in fixtures");
        }
        if (emulation) {
            throw new Error("SoloRngFake does not advance RNG during emulation");
        }
        if (m !== "roll") {
            throw new Error(`Unknown move: ${m}`);
        }
        this.lastmove = m;
        this.ply += 1;
        this.committedRoll = this.rng!.randomInt(6);
        this.results = [{ type: "move", from: "", to: "", what: `${this.committedRoll}` }];
        this.saveState();
        return this;
    }

    public nextRoll(): number {
        return this.rng!.randomInt(6);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SoloRngFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            challengeSeed: this.challengeSeed,
            rngCounter: this.rng?.getCounter(),
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SoloRngFake {
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error(`Invalid stack index ${idx}`);
        }
        const slice = this.stack.slice(0, idx + 1);
        const loaded = new SoloRngFake(JSON.stringify({
            game: SoloRngFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: false,
            winner: [],
            challengeSeed: this.challengeSeed,
            stack: slice,
        }));
        loaded.restoreSoloRngFromEntry(slice[slice.length - 1]);
        return loaded;
    }

    public clone(): SoloRngFake {
        return new SoloRngFake(this.serialize());
    }

    protected moveState(): ISoloRngMoveState {
        return {
            _version: SoloRngFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            ply: this.ply,
            roll: this.committedRoll,
        };
    }
}

export function soloRngFactory(seed: string): SoloRngFake {
    return new SoloRngFake(undefined, seed);
}

/** Play N committed rolls from a fresh seeded instance. */
export function playSoloRngRolls(seed: string, count: number): SoloRngFake {
    const g = new SoloRngFake(undefined, seed);
    for (let i = 0; i < count; i++) {
        g.move("roll", { trusted: true });
    }
    return g;
}
