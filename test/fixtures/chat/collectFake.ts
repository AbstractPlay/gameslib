import { GameBase, IAPGameState, IIndividualState, IRenderOpts } from "../../../src/games/_base";
import { APGamesInformation } from "../../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../../src/schemas/moveresults";

interface IFakeMoveState extends IIndividualState {
    currplayer: number;
    scores?: number[];
}

/**
 * Minimal engine exercising default {@link GameBase.collectChatLogLine} result types.
 */
export class ChatCollectFake extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "ChatCollectFake",
        uid: "chatCollectFake",
        playercounts: [2],
        version: "20260828",
        dateAdded: "2026-08-28",
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

    public constructor(frames: APMoveResult[][], options: { scores?: number[] } = {}) {
        super();
        let cp = 1;
        for (const frame of frames) {
            cp = cp === 1 ? 2 : 1;
            const entry: IFakeMoveState = {
                _version: ChatCollectFake.gameinfo.version,
                _results: frame,
                _timestamp: new Date("2026-01-01T12:00:00.000Z"),
                currplayer: cp,
            };
            if (options.scores !== undefined) {
                entry.scores = options.scores;
            }
            this.stack.push(entry);
        }
        if (this.stack.length > 0) {
            const top = this.stack[this.stack.length - 1]!;
            this.currplayer = top.currplayer;
            this.results = top._results !== undefined ? [...top._results] : [];
        }
    }

    public render(_opts?: IRenderOpts): APRenderRep {
        void _opts;
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            gameover: this.gameover,
            numplayers: this.numplayers,
            winner: this.winner,
            variants: this.variants,
            stack: this.stack,
        };
    }

    public serialize(): string {
        return JSON.stringify(this.state());
    }
}

/** Representative frames for default collector parity. */
export const chatCollectFakeFrames: APMoveResult[][] = [
    [{ type: "move", from: "a1", to: "b2" }],
    [{ type: "place", what: "stone", where: "c3" }],
    [{ type: "pass" }],
    [{ type: "capture", what: "piece", where: "d4" }],
    [{ type: "resigned", player: 2 }],
    [{ type: "deltaScore" }, { type: "move", from: "e5", to: "f6" }],
];

export const chatCollectFakePlayerNames = ["Alice", "Bob"];
