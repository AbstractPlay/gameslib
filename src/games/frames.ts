import { GameBaseSimultaneous, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { AnnotationBasic, APRenderRep, Glyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
type CellContents = 0|playerid;

export interface IMoveState extends IIndividualState {
    board: Map<string, CellContents>;
    lastmove: string[];
    scores: [number,number];
};

export interface IFramesState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FramesGame extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "Frames",
        uid: "frames",
        playercounts: [2],
        version: "20241127",
        dateAdded: "2024-11-28",
        // i18next.t("apgames:descriptions.frames")
        description: "apgames:descriptions.frames",
        urls: [
            "https://boardgamegeek.com/boardgame/18424/frames",
        ],
        people: [
            {
                type: "designer",
                name: "Marcos Donnantuoni"
            }
        ],
        categories: ["goal>score>race", "mechanic>place",  "mechanic>enclose", "mechanic>simultaneous", "board>shape>rect", "board>connect>rect", "components>simple>1c"],
        flags: ["simultaneous", "scores"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 19);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 19);
    }

    public numplayers = 2;
    public board!: Map<string, CellContents>;
    public scores!: [number,number];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: IFramesState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFramesState;
            }
            if (state.game !== FramesGame.gameinfo.uid) {
                throw new Error(`The Frames game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: FramesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                lastmove: [],
                board: new Map([["j10", 0]]),
                scores: [0,0],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): FramesGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board = new Map(state.board);
        this.lastmove = state.lastmove.join(',');
        this.scores = [...state.scores];
        return this;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];
        for (let x = 0; x < 19; x++) {
            for (let y = 0; y < 19; y++) {
                const cell = FramesGame.coords2algebraic(x, y);
                if (!this.board.has(cell)) {
                    moves.push(cell);
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const allmoves = this.moves();
        const move1 = allmoves[Math.floor(Math.random() * allmoves.length)];
        const move2 = allmoves[Math.floor(Math.random() * allmoves.length)];
        return `${move1}, ${move2}`;
    }

    public handleClickSimultaneous(move: string, row: number, col: number, player: playerid, piece?: string): IClickResult {
        try {
            const cell = FramesGame.coords2algebraic(col, row);
            const newmove = cell;
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
            result.message = i18next.t("apgames:validation.frames.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }

        // valid final move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): FramesGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const moves: string[] = m.split(/\s*,\s*/);
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
        if (partial) {
            const [left,right] = m.split(/\s*,\s*/);
            if (!/^\s*$/.test(left)) {
                this.board.set(left, 1);
            } else {
                this.board.set(right, 2);
            }
            return this;
        }

        this.results = [];
        // if moves are the same, place a neutral piece
        if (moves[0] === moves[1]) {
            this.board.set(moves[0], 0);
            this.results.push({type: "place", who: 0, where: moves[0]});
        }
        // otherwise, draw the rectangle
        else {
            this.board.set(moves[0], 1);
            this.board.set(moves[1], 2);
            this.results.push({type: "place", who: 1, where: moves[0]});
            this.results.push({type: "place", who: 2, where: moves[1]});
            const [x1, y1] = FramesGame.algebraic2coords(moves[0]);
            const [x2, y2] = FramesGame.algebraic2coords(moves[1]);
            const [minx, maxx, miny, maxy] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
            const counts: [number,number] = [0,0];
            for (let x = minx+1; x < maxx; x++) {
                for (let y = miny+1; y < maxy; y++) {
                    const cell = FramesGame.coords2algebraic(x, y);
                    if (this.board.has(cell)) {
                        const pc = this.board.get(cell)!;
                        if (pc !== 0) {
                            counts[pc-1]++;
                        }
                    }
                }
            }
            if (counts[0] !== counts[1]) {
                if (counts[0] > counts[1]) {
                    this.scores[0]++;
                } else {
                    this.scores[1]++;
                }
                this.results.push({type: "deltaScore", delta: 1, who: counts[0] > counts[1] ? 1 : 2});
            }
        }

        this.lastmove = [...moves].join(',');
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): FramesGame {
        if (this.scores[0] >= 10) {
            this.gameover = true;
            this.winner = [1];
        } else if (this.scores[1] >= 10) {
            this.gameover = true;
            this.winner = [2];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IFramesState {
        return {
            game: FramesGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FramesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: (this.lastmove === undefined ? [] : this.lastmove.split(',')),
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 19; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const contents: string[] = [];
            for (let col = 0; col < 19; col++) {
                const cell = FramesGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const pc = this.board.get(cell)!;
                    if (pc === 0) {
                        contents.push("X");
                    } else if (pc === 1) {
                        contents.push("A");
                    } else {
                        contents.push("B");
                    }
                } else {
                    contents.push("");
                }
            }
            pstr += contents.join(",");
        }
        pstr = pstr.replace(/\n,{18}(?=\n)/g, "\n_");

        const legend: {[k: string]: string | Glyph | [Glyph, ...Glyph[]];} = {
            A: {
                name: "piece",
                colour: 1,
            },
            B: {
                name: "piece",
                colour: 2,
            },
            X: {
                name: "piece",
                colour: 9,
            },
        };

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: 19,
                height: 19,
            },
            legend,
            pieces: pstr
        };

        if (this.stack[this.stack.length - 1]._results.length > 0) {
        // if (this.results.length > 0) {
            rep.annotations = [] as AnnotationBasic[];
            const placements: string[] = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
            // for (const move of this.results) {
                if (move.type === "place") {
                    const cell = move.where!;
                    placements.push(cell);
                    const [x, y] = FramesGame.algebraic2coords(cell);
                    rep.annotations.push({
                        type: "enter",
                        shape: "circle",
                        targets: [
                            {col: x, row: y}
                        ]
                    });
                }
            }
            // draw rectangle if necessary
            if (placements.length === 2) {
                const [x1, y1] = FramesGame.algebraic2coords(placements[0]);
                const [x2, y2] = FramesGame.algebraic2coords(placements[1]);
                const [minx, maxx, miny, maxy] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
                const strokeWidth = 0.1;
                const dashed: [number, ...number[]] = [10];
                let colour: string|number = "#000";
                const scored = this.stack[this.stack.length - 1]._results.find(x => x.type === "deltaScore") as {type: "deltaScore";delta?: number;who?: number;}|undefined;
                if (scored !== undefined) {
                    colour = scored.who!;
                }
                const targets: RowCol[] = [];
                // top line (only line if same y)
                if (x1 !== x2) {
                    targets.push({col: minx, row: miny},{col: maxx, row: miny});
                }

                // right line (only line if same x)
                if (y1 !== y2) {
                    if (targets.length > 0) {
                        targets.push({col: maxx, row: maxy});
                    } else {
                        targets.push({col: maxx, row: miny},{col: maxx, row: maxy});
                    }
                }

                // bottom & left lines (only exist if x & y are both different)
                if (y1 !== y2 && x1 !== x2) {
                    targets.push({col: minx, row: maxy},{col: minx, row: miny});
                }
                rep.annotations.push({
                    type: "line",
                    targets: targets as [RowCol, ...RowCol[]],
                    strokeWidth,
                    dashed,
                    colour,
                });
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        status += `Player 1: ${this.scores[0]}\n\n`;
        status += `Player 2: ${this.scores[1]}\n\n`;
        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [...this.scores] }
        ]
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                for (const r of state._results) {
                    switch (r.type) {
                        case "place":
                            node.push(i18next.t(r.who === 0 ? "apresults:PLACE.neutral" : "apresults:PLACE.nowhat", {where: r.where, player: r.who === 0 ? "" : players[r.who! - 1]}));
                            break;
                        case "deltaScore":
                            node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {count: 1, delta: 1, player: players[r.who! - 1]}));
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
                result.push(node);
            }
        }
        return result;
    }

    public getCustomRotation(): number | undefined {
        return 0;
    }

    public clone(): FramesGame {
        return new FramesGame(this.serialize());
    }
}
