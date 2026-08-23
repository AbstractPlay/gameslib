import "mocha";
import { expect } from "chai";
import { GameBaseSequenced } from "../../src/games/_turn-sequenced";
import { IAPGameState, IIndividualState, IRenderOpts } from "../../src/games/_base";
import { APGamesInformation } from "../../src/schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../../src/schemas/moveresults";

interface ISequencedFakeMoveState extends IIndividualState {
    currplayer: number;
    lastmove?: string;
}

/** Standard 4p seat-cycle sequenced fake — no legacy `skipto` stack field. */
class SequencedRoundRobinFake extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "SequencedRoundRobinFake",
        uid: "sequencedRoundRobinFake",
        playercounts: [4],
        version: "20260820",
        dateAdded: "2026-08-20",
        description: "apgames:descriptions.hex",
        categories: ["abstract"],
    };

    public stack: ISequencedFakeMoveState[] = [];
    public gameover = false;
    public numplayers = 4;
    public winner: number[] = [];
    public results: APMoveResult[] = [];
    public variants: string[] = [];
    public currplayer = 1;

    public constructor(moves: string[]) {
        super();
        this.stack = [{
            _version: SequencedRoundRobinFake.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
        }];
        let cp = 1;
        for (const move of moves) {
            this.results = [{ type: "move", from: "", to: "", what: move }];
            this.lastmove = move;
            cp = cp >= this.numplayers ? 1 : cp + 1;
            this.currplayer = cp;
            this.stack.push({
                _version: SequencedRoundRobinFake.gameinfo.version,
                _results: [...this.results],
                _timestamp: new Date(),
                currplayer: cp,
                lastmove: move,
            });
        }
    }

    public move(move: string): SequencedRoundRobinFake {
        throw new Error(`SequencedRoundRobinFake is fixed; got ${move}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public render(_opts?: IRenderOpts): APRenderRep {
        return { board: null, pieces: [] } as unknown as APRenderRep;
    }

    public state(): IAPGameState {
        return {
            game: SequencedRoundRobinFake.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: this.stack.map((s) => ({ ...s })),
        };
    }

    public load(idx: number): SequencedRoundRobinFake {
        void idx;
        return new SequencedRoundRobinFake([]);
    }

    public clone(): SequencedRoundRobinFake {
        return new SequencedRoundRobinFake([]);
    }

    protected moveState(): ISequencedFakeMoveState {
        return {
            _version: SequencedRoundRobinFake.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
        };
    }
}

describe("GameBaseSequenced turn model", () => {
    it("exports turn-model sequenced", () => {
        const g = new SequencedRoundRobinFake(["a", "b"]);
        expect(g.turnModel()).to.equal("sequenced");
    });

    it("closes a round when currplayer wraps to the opener", () => {
        const g = new SequencedRoundRobinFake(["p1", "p2", "p3", "p4", "p1b"]);
        const plies = g.getPlies();
        expect(plies.map((p) => p.actor)).to.deep.equal([1, 2, 3, 4, 1]);
        expect(plies.map((p) => p.round)).to.deep.equal([0, 0, 0, 0, 1]);
    });

    it("uses prevState.currplayer for ply actors", () => {
        const g = new SequencedRoundRobinFake(["p1", "p2", "p3"]);
        expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 3]);
    });

    it("exports one sparse row per ply", () => {
        const g = new SequencedRoundRobinFake(["p1", "p2", "p3", "p4"]);
        expect(g.getRounds()).to.have.length(4);
    });
});
