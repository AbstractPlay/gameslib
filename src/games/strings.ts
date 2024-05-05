import { GameBaseSimultaneous, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
type CellContents = number;
type MoveType = "ROW+"|"ROW-"|"COL+"|"COL-";

const homes: Map<playerid, string[]> = new Map([
    [1, ["c6", "f5", "b3", "e2"]],
    [2, ["c2", "f3", "b5", "e6"]]
]);

const origStrings = new Map<string,number>([
    ["b7", 1], ["c7", 2], ["d7", 3], ["e7", 4], ["f7", 5],
    ["g6", 6], ["g5", 7], ["g4", 8], ["g3", 9], ["g2", 10],
    ["f1", 11], ["e1", 12], ["d1", 13], ["c1", 14], ["b1", 15],
    ["a2", 16], ["a3", 17], ["a4", 18], ["a5", 19], ["a6", 20],
]);

export interface IMoveState extends IIndividualState {
    board: Map<string, CellContents>;
    strings: Map<string,number>
    lastmove: string[];
};

export interface IStringsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StringsGame extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pulling Strings",
        uid: "strings",
        playercounts: [2],
        version: "20230611",
        dateAdded: "2023-06-22",
        // i18next.t("apgames:descriptions.strings")
        description: "apgames:descriptions.strings",
        urls: [
            "https://boardgamegeek.com/boardgame/18284/pulling-strings",
        ],
        people: [
            {
                type: "designer",
                name: "Clark D. Rodeffer"
            }
        ],
        categories: ["goal>area", "mechanic>displace",  "mechanic>share", "mechanic>simultaneous", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1c"],
        flags: ["simultaneous", "scores"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 7);
    }

    public static string2cells(pulled: number): [string, MoveType][] {
        const results: [string, MoveType][] = [];
        // ROW-
        if (pulled <= 5) {
            for (let row = 1; row <= 5; row++) {
                const cell = StringsGame.coords2algebraic(pulled, row);
                results.push([cell, "ROW-"]);
            }
        // COL+
        } else if (pulled <= 10) {
            for (let col = 1; col <= 5; col++) {
                const cell = StringsGame.coords2algebraic(col, pulled - 5);
                results.push([cell, "COL+"]);
            }
        // ROW+
        } else if (pulled <= 15) {
            for (let row = 1; row <= 5; row++) {
                const cell = StringsGame.coords2algebraic(6 - (pulled - 10), row);
                results.push([cell, "ROW+"]);
            }
        // COL-
        } else {
            for (let col = 1; col <= 5; col++) {
                const cell = StringsGame.coords2algebraic(col, 6 - (pulled - 15));
                results.push([cell, "COL-"]);
            }
        }
        return results;
    }

    public static nextCell(cell: string, move: MoveType): string|undefined {
        const [x, y] = this.algebraic2coords(cell);
        let next: string|undefined;
        switch (move) {
            case "COL+":
                if (x < 5) {
                    next = StringsGame.coords2algebraic(x + 1, y);
                }
                break;
            case "COL-":
                if (x > 1) {
                    next = StringsGame.coords2algebraic(x - 1, y);
                }
                break;
            case "ROW+":
                if (y < 5) {
                    next = StringsGame.coords2algebraic(x, y + 1);
                }
                break;
            case "ROW-":
                if (y > 1) {
                    next = StringsGame.coords2algebraic(x, y - 1);
                }
                break;
        }
        return next;
    }

    public numplayers = 2;
    public board!: Map<string, CellContents>;
    public strings!: Map<string, number>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: IStringsState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStringsState;
            }
            if (state.game !== StringsGame.gameinfo.uid) {
                throw new Error(`The Pulling Strings game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: StringsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                lastmove: [],
                board: new Map([["d4", 5]]),
                strings: new Map([
                    ["b7", 1], ["c7", 2], ["d7", 3], ["e7", 4], ["f7", 5],
                    ["g6", 6], ["g5", 7], ["g4", 8], ["g3", 9], ["g2", 10],
                    ["f1", 11], ["e1", 12], ["d1", 13], ["c1", 14], ["b1", 15],
                    ["a2", 16], ["a3", 17], ["a4", 18], ["a5", 19], ["a6", 20],
                ]),
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): StringsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board = new Map(state.board);
        this.strings = new Map(state.strings);
        this.lastmove = state.lastmove.join(',');
        return this;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];
        for (const v of this.strings.values()) {
            moves.push(v.toString());
        }
        return moves;
    }

    public randomMove(): string {
        const moves1 = this.moves();
        const move1 = moves1[Math.floor(Math.random() * moves1.length)];
        const moves2 = this.moves();
        const move2 = moves2[Math.floor(Math.random() * moves2.length)];
        return `${move1}, ${move2}`;
    }

    public handleClickSimultaneous(move: string, row: number, col: number, player: playerid, piece?: string): IClickResult {
        try {
            const cell = StringsGame.coords2algebraic(col, row);
            if (! this.strings.has(cell)) {
                return {move: "", message: ""} as IClickResult;
            }
            const newmove = this.strings.get(cell)!.toString();
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.strings.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (! [...this.strings.values()].map(n => n.toString()).includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.strings.NOSTRING", {"string": m});
            return result;
        }

        // valid final move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): StringsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const moves: string[] = m.split(/,\s*/);
        if (moves.length !== 2) {
            throw new UserFacingError("MOVES_SIMULTANEOUS_PARTIAL", i18next.t("apgames:MOVES_SIMULTANEOUS_PARTIAL"));
        }
        for (let i = 0; i < moves.length; i++) {
            if ( (partial) && ( (moves[i] === undefined) || (moves[i] === "") ) ) {
                continue;
            }
            moves[i] = moves[i].toLowerCase();
            moves[i] = moves[i].replace(/\s+/g, "");
            if (! trusted) {
                const result = this.validateMove(moves[i]);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
                if (! ((partial && moves[i] === "") || this.moves().includes(moves[i]))) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
            }
        }

        this.results = [];
        // get pulled strings and record results for chat
        const string1 = parseInt(moves[0], 10);
        this.results.push({type: "pull", where: moves[0]});
        const string2 = parseInt(moves[1], 10);
        this.results.push({type: "pull", where: moves[1]});
        const pulled: number[] = [];
        if (string1 === string2) {
            this.results.push({type: "destroy", where: moves[0]});
            const pair = [...this.strings.entries()].find(e => e[1] === string1);
            if (pair === undefined) {
                throw new Error(`Could not find string ${string1}. This should never happen.`);
            }
            this.strings.delete(pair[0]);
            pulled.push(string1);
        } else {
            pulled.push(string1, string2);
        }

        // for each string, get the list of cells affected and how they're affected
        const actions = new Map<string, MoveType[]>();
        for (const s of pulled) {
            for (const [cell, action] of StringsGame.string2cells(s)) {
                if (actions.has(cell)) {
                    const contents = actions.get(cell)!;
                    actions.set(cell, [...contents, action]);
                } else {
                    actions.set(cell, [action]);
                }
            }
        }

        // for each cell, calculate and record deltas
        const deltas = new Map<string, number>();
        const addDelta = (cell: string, val: number) => {
            if (deltas.has(cell)) {
                const contents = deltas.get(cell)!;
                deltas.set(cell, contents + val);
            } else {
                deltas.set(cell, val);
            }
        }
        for (const [cell, acts] of actions.entries()) {
            const contents = this.board.get(cell);
            if (contents !== undefined) {
                // easy peasy, just move the stack
                if (acts.length === 1) {
                    const next = StringsGame.nextCell(cell, acts[0]);
                    if (next !== undefined) {
                        addDelta(cell, contents * -1);
                        addDelta(next, contents);
                    }

                // otherwise, resolve splits
                } else {
                    const newval = Math.ceil(contents / 2);
                    const nexts: (string|undefined)[] = [];
                    let atLeastOne = false;
                    for (const act of acts) {
                        const next = StringsGame.nextCell(cell, act);
                        if (next !== undefined) {
                            atLeastOne = true;
                        }
                        nexts.push(next);
                    }
                    if (atLeastOne) {
                        addDelta(cell, contents * -1);
                        for (const next of nexts) {
                            if (next === undefined) {
                                addDelta(cell, newval);
                            } else {
                                addDelta(next, newval);
                            }
                        }
                    }
                }
            }
        }

        // now apply those deltas to the board
        for (const [cell, delta] of deltas.entries()) {
            if (this.board.has(cell)) {
                const contents = this.board.get(cell)!;
                const newval = contents + delta;
                if (newval < 0) {
                    throw new Error("Deltas reduced a stack to less than zero! This should never happen!");
                }
                if (newval > 0) {
                    this.board.set(cell, newval);
                } else {
                    this.board.delete(cell);
                }
            } else {
                if (delta < 0) {
                    throw new Error("Negative delta being applied to nonexistent cell! This should never happen!");
                }
                if (delta > 0) {
                    this.board.set(cell, delta);
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = [...moves].join(',');
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): StringsGame {
        const score1 = this.getPlayerScore(1);
        const score2 = this.getPlayerScore(2);
        const only1 = (score1 >= 5) && (score2 < 5);
        const only2 = (score1 < 5) && (score2 >= 5);
        const bothBut1 = (score1 >= 5) && (score2 >= 5) && (score1 > score2);
        const bothBut2 = (score1 >= 5) && (score2 >= 5) && (score1 < score2);
        if ( only1 || only2 || bothBut1 || bothBut2) {
            this.gameover = true;
            this.results.push({type: "eog"});
            if (score1 > score2) {
                this.winner = [1];
                this.results.push({type: "winners", players: [1]});
            } else if (score2 > score1) {
                this.winner = [2];
                this.results.push({type: "winners", players: [2]});
            }
        }
        return this;
    }

    public getPlayerScore(player: playerid): number {
        let score = 0;
        for (const cell of homes.get(player)!) {
            if (this.board.has(cell)) {
                score += this.board.get(cell)!;
            }
        }
        return score;
    }

    public state(): IStringsState {
        return {
            game: StringsGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: StringsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: (this.lastmove === undefined ? [] : this.lastmove.split(',')),
            board: new Map(this.board),
            strings: new Map(this.strings),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const contents: string[] = [];
            for (let col = 0; col < 7; col++) {
                const cell = StringsGame.coords2algebraic(col, row);
                if (this.strings.has(cell)) {
                    contents.push("S" + this.strings.get(cell)!.toString());
                } else if (this.board.has(cell)) {
                    contents.push("C" + this.board.get(cell)!.toString());
                } else {
                    contents.push("");
                }
            }
            pstr += contents.join(",");
        }
        pstr = pstr.replace(/\n,{6}(?=\n)/g, "\n_");

        const legend = {
            R: {
                name: "piece-borderless",
                player: 1,
                opacity: 0.25,
            },
            B: {
                name: "piece-borderless",
                player: 2,
                opacity: 0.25,
            },
        };
        // strings
        for (const n of this.strings.values()) {
            // @ts-ignore
            legend[`S${n}`] = [
                {
                    name: "piece-borderless",
                    colour: "#fff",
                },
                {
                    text: n.toString(),
                    colour: "#000",
                    scale: 0.5
                }
            ];
        }
        // coins
        for (const n of this.board.values()) {
            // @ts-ignore
            legend[`C${n}`] = [
                {
                    "name": "piece",
                    "colour": "#fff"
                },
                {
                    "text": n.toString(),
                    "colour": "#000",
                    "scale": 0.75
                }
            ];
        }

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-labels", "no-border"],
            board: {
                style: "vertex",
                width: 7,
                height: 7,
                strokeOpacity: 0.25,
                markers: [
                    {
                        type: "glyph",
                        glyph: "R",
                        points: [
                            {col: 2, row: 1},
                            {col: 5, row: 2},
                            {col: 1, row: 4},
                            {col: 4, row: 5}
                        ]
                    },
                    {
                        type: "glyph",
                        glyph: "B",
                        points: [
                            {col: 2, row: 5},
                            {col: 5, row: 4},
                            {col: 1, row: 2},
                            {col: 4, row: 1}
                        ]
                    }
                ]
            },
            legend,
            pieces: pstr
        };

        if (this.stack[this.stack.length - 1]._results.length > 0) {
        // if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
            // for (const move of this.results) {
                if (move.type === "pull") {
                    const num = move.where;
                    const pulled = [...origStrings.entries()].find(s => s[1].toString() === num);
                    if (pulled !== undefined) {
                        const cell = pulled[0];
                        const [x, y] = StringsGame.algebraic2coords(cell);
                        rep.annotations.push({
                            type: "enter",
                            targets: [
                                {col: x, row: y}
                            ]
                        });
                    }
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        status += `Player 1: ${this.getPlayerScore(1)}\n\n`;
        status += `Player 2: ${this.getPlayerScore(2)}\n\n`;
        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                if (state._results.length >= 2) {
                    for (let p = 0; p < 2; p++) {
                        let name = `Player ${p + 1}`;
                        if (players.length >= p + 1) {
                            name = players[p];
                        }
                        const r = state._results[p];
                        switch (r.type) {
                            case "pull":
                                node.push(i18next.t("apresults:PULL", {player: name, where: r.where}));
                                break;
                        }
                    }
                }
                if (state._results.length > 2) {
                    for (const r of state._results) {
                        switch (r.type) {
                            case "destroy":
                                node.push(i18next.t("apresults:DESTROY.string", { where: r.where}));
                                break;
                            case "eog":
                                node.push(i18next.t("apresults:EOG.default"));
                                break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));

                                break;
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): StringsGame {
        return new StringsGame(this.serialize());
    }
}
