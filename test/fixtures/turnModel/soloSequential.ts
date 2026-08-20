import { GameBase, IAPGameState, IIndividualState, IRenderOpts } from "../../../src/games/_base";
import { APGamesInformation } from "../../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../../src/schemas/moveresults";

interface IFakeMoveState extends IIndividualState {
    currplayer: number;
    lastmove?: string;
}

/**
 * Minimal 1-player sequential engine for turn-model golden tests (no live game with playercounts [1] yet).
 */
export class SoloSequentialFake extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "SoloSequentialFake",
        uid: "soloSequentialFake",
        playercounts: [1],
        version: "20260819",
        dateAdded: "2026-08-19",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: IFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 1;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;

    public constructor(state?: string) {
        super();
        if (state !== undefined) {
            this.hydrate(JSON.parse(state) as IAPGameState);
        } else {
            this.stack = [{
                _version: SoloSequentialFake.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
            }];
        }
    }

    private hydrate(state: IAPGameState): void {
        this.gameover = state.gameover;
        this.numplayers = state.numplayers;
        this.winner = [...state.winner];
        this.variants = [...state.variants];
        this.stack = state.stack.map((entry) => {
            const e = entry as IFakeMoveState;
            if (typeof e._timestamp === "string") {
                e._timestamp = new Date(e._timestamp);
            }
            return e;
        });
        const top = this.stack[this.stack.length - 1];
        this.currplayer = top.currplayer;
        this.lastmove = top.lastmove;
        this.results = top._results !== undefined ? [...top._results] : [];
    }

    public move(m: string, { trusted = false } = {}): SoloSequentialFake {
        if (!trusted) {
            throw new Error("SoloSequentialFake only supports trusted moves in fixtures");
        }
        this.lastmove = m;
        this.results = [{ type: "move", from: "", to: "", what: m }];
        this.saveState();
        return this;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public state(_opts?: { strip?: boolean; player?: number }): IAPGameState {
        return {
            game: SoloSequentialFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SoloSequentialFake {
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error(`Invalid stack index ${idx}`);
        }
        const slice = this.stack.slice(0, idx + 1);
        return new SoloSequentialFake(JSON.stringify({
            game: SoloSequentialFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: this.winner,
            stack: slice,
        }));
    }

    public clone(): SoloSequentialFake {
        return new SoloSequentialFake(this.serialize());
    }

    protected moveState(): IFakeMoveState {
        return {
            _version: SoloSequentialFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
        };
    }
}

/** Three consecutive plies while currplayer stays 1 — baseline for solo sequential export. */
export function buildSoloSequentialFake(): SoloSequentialFake {
    const g = new SoloSequentialFake();
    g.move("flip a4", { trusted: true });
    g.move("draw", { trusted: true });
    g.move("place b2", { trusted: true });
    g.gameover = true;
    g.winner = [1];
    return g;
}

/** Expected moveHistory stride for 1p (one column per ply). */
export const soloSequentialMoveHistoryGolden: string[][] = [
    ["flip a4"],
    ["draw"],
    ["place b2"],
];

export const soloSequentialPlayerNames = ["SoloPlayer"];
