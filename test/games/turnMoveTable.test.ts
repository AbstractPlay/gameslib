import "mocha";
import { expect } from "chai";
import { ThricewiseGame } from "../../src/games/thricewise";
import { cardsBasic } from "../../src/common/decktet";
import {
    getMoveTableRoundsForEngine,
    hasMultiplePliesPerStackIndex,
    normalizeMoveTableDensity,
    packPliesForMoveTable,
    pathIndexForMoveTableCell,
    moveTableRoundsFromExplorationPath,
} from "../../src/games/_turn-move-table";
import type { IGamePly, IGameRound } from "../../src/games/_turn-model";
import { GameBaseSequenced } from "../../src/games/_turn-sequenced";

describe("turn move table presentation", () => {
    it("normalizeMoveTableDensity maps auto to compact", () => {
        expect(normalizeMoveTableDensity("auto")).to.equal("compact");
        expect(normalizeMoveTableDensity("sparse")).to.equal("sparse");
    });

    it("hasMultiplePliesPerStackIndex ignores plies without stackIndex", () => {
        const plies: IGamePly[] = [
            { actor: 1, move: "a", results: [], round: 0, playOrder: 1 },
            { actor: 2, move: "b", results: [], round: 0, playOrder: 2 },
        ];
        expect(hasMultiplePliesPerStackIndex(plies)).to.equal(false);
    });

    it("getMoveTableRoundsForEngine compacts when plies lack stackIndex", () => {
        const engine = {
            numplayers: 4,
            turnModel: () => "sequenced" as const,
            getPlies: () => [
                { actor: 1, move: "p1", round: 0, playOrder: 1, results: [] },
                { actor: 2, move: "p2", round: 0, playOrder: 2, results: [] },
                { actor: 3, move: "p3", round: 0, playOrder: 3, results: [] },
                { actor: 4, move: "p4", round: 0, playOrder: 4, results: [] },
                { actor: 1, move: "p1b", round: 1, playOrder: 1, results: [] },
            ],
            getRounds: () => [
                ["p1", null, null, null],
                [null, "p2", null, null],
                [null, null, "p3", null],
                [null, null, null, "p4"],
                ["p1b", null, null, null],
            ],
        };
        const buildRoundRow = (group: IGamePly[]): IGameRound => {
            const row: IGameRound = [null, null, null, null];
            for (const ply of group) {
                row[ply.actor - 1] = ply.move;
            }
            return row;
        };
        const rows = getMoveTableRoundsForEngine(engine as never, { density: "compact", pathLength: 5 }, buildRoundRow);
        expect(rows).to.have.length(2);
    });

    it("packPliesForMoveTable merges seat cycle and splits duplicate actors", () => {
        const plies: IGamePly[] = [
            { actor: 1, move: "a", results: [], stackIndex: 1, round: 0, playOrder: 1 },
            { actor: 2, move: "b", results: [], stackIndex: 2, round: 0, playOrder: 2 },
            { actor: 2, move: "c", results: [], stackIndex: 3, round: 0, playOrder: 2 },
        ];
        const buildRoundRow = (group: IGamePly[]): IGameRound => {
            const row: IGameRound = [null, null];
            for (const ply of group) {
                row[ply.actor - 1] = ply.move;
            }
            return row;
        };
        const rows = packPliesForMoveTable(plies, 2, buildRoundRow);
        expect(rows).to.have.length(3);
        expect(rows[0]![0]).to.equal("a");
        expect(rows[1]![1]).to.equal("b");
        expect(rows[2]![1]).to.equal("c");
    });

    it("sequenced round-robin compact move table has fewer rows than sparse export", () => {
        class RoundRobin extends GameBaseSequenced {
            public static readonly gameinfo = {
                name: "RR",
                uid: "rrMoveTableTest",
                playercounts: [3],
                version: "1",
                dateAdded: "2026-01-01",
                description: "x",
                categories: ["abstract"],
            };
            public stack: Array<{ currplayer: number; lastmove?: string; _results: []; _timestamp: Date; _version: string }> = [];
            public numplayers = 3;
            public gameover = false;
            public winner: number[] = [];
            public results = [];
            public variants: string[] = [];
            public currplayer = 1;
            public constructor(moves: string[]) {
                super();
                this.stack = [{ _version: "1", _results: [], _timestamp: new Date(), currplayer: 1 }];
                let cp = 1;
                for (const move of moves) {
                    cp = cp >= 3 ? 1 : cp + 1;
                    this.currplayer = cp;
                    this.stack.push({
                        _version: "1",
                        _results: [],
                        _timestamp: new Date(),
                        currplayer: cp,
                        lastmove: move,
                    });
                }
            }
            public move(): this {
                throw new Error("fixed");
            }
            public render() {
                return { board: null, pieces: [] };
            }
            public state() {
                return { game: "rr", numplayers: 3, variants: [], gameover: false, winner: [], stack: this.stack };
            }
            public load(): this {
                return this;
            }
            public clone(): this {
                return this;
            }
            protected moveState() {
                return { _version: "1", _results: [], _timestamp: new Date(), currplayer: this.currplayer };
            }
        }
        const engine = new RoundRobin(["m1", "m2", "m3", "m4", "m5", "m6"]);
        const pathLength = 6;
        const compact = engine.getMoveTableRounds({ density: "compact", pathLength });
        const sparse = engine.getMoveTableRounds({ density: "sparse", pathLength });
        expect(engine.getRounds()).to.have.length(pathLength);
        expect(compact.length).to.equal(2);
        expect(sparse).to.have.length(pathLength);
    });

    it("thricewise uses export rounds for move table (wire-expanded)", () => {
        const g = new ThricewiseGame(3);
        const twos = cardsBasic.filter((c) => c.rank.seq === 2).map((c) => c.uid);
        const aces = cardsBasic.filter((c) => c.rank.seq === 1).map((c) => c.uid);
        const fours = cardsBasic.filter((c) => c.rank.seq === 4).map((c) => c.uid);
        const fives = cardsBasic.filter((c) => c.rank.seq === 5).map((c) => c.uid);
        g.hands = [[fives[0], twos[0]], [aces[0], twos[1]], [fours[0], fives[1]]];
        g.move(`${fives[0]},${aces[0]},${fours[0]}`);
        const exportRounds = g.getRounds();
        const tableRounds = g.getMoveTableRounds({ density: "compact" });
        expect(tableRounds).to.deep.equal(exportRounds);
    });

    it("moveTableRoundsFromExplorationPath splits wire path", () => {
        const path = [
            [{ move: "7ML,NL" }],
            [{ move: "7ML@2.-1,\u0091" }],
        ];
        const rows = moveTableRoundsFromExplorationPath(path, 2, 2);
        expect(rows[0]![0]).to.equal("7ML");
        expect(rows[0]![1]).to.equal("NL");
        expect(rows[1]![0]).to.equal("7ML@2.-1");
        expect(rows[1]![1]).to.equal(null);
    });

    it("pathIndexForMoveTableCell on sequenced fake compact grid", () => {
        class Fake extends GameBaseSequenced {
            public static readonly gameinfo = {
                name: "Fake",
                uid: "fakeMoveTable",
                playercounts: [4],
                version: "1",
                dateAdded: "2026-01-01",
                description: "x",
                categories: ["abstract"],
            };
            public stack: Array<{ currplayer: number; lastmove?: string; _results: []; _timestamp: Date; _version: string }> = [];
            public numplayers = 4;
            public gameover = false;
            public winner: number[] = [];
            public results = [];
            public variants: string[] = [];
            public currplayer = 1;
            public constructor(moves: string[]) {
                super();
                this.stack = [{ _version: "1", _results: [], _timestamp: new Date(), currplayer: 1 }];
                let cp = 1;
                for (const move of moves) {
                    cp = cp >= 4 ? 1 : cp + 1;
                    this.currplayer = cp;
                    this.stack.push({
                        _version: "1",
                        _results: [],
                        _timestamp: new Date(),
                        currplayer: cp,
                        lastmove: move,
                    });
                }
            }
            public move(): this {
                throw new Error("fixed");
            }
            public render() {
                return { board: null, pieces: [] };
            }
            public state() {
                return { game: "fake", numplayers: 4, variants: [], gameover: false, winner: [], stack: this.stack };
            }
            public load(): this {
                return this;
            }
            public clone(): this {
                return this;
            }
            protected moveState() {
                return { _version: "1", _results: [], _timestamp: new Date(), currplayer: this.currplayer };
            }
        }
        const g = new Fake(["p1", "p2", "p3", "p4", "p1b"]);
        const pathLength = 5;
        const idx = pathIndexForMoveTableCell(g, {
            density: "compact",
            model: "sequenced",
            useRoundGrid: true,
            numcolumns: 4,
            rowIdx: 0,
            seatIdx: 3,
            pathLength,
        });
        expect(idx).to.equal(3);
    });
});
