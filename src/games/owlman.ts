import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, SquareDiagGraph, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Piece = "O"|"D"|"H";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
};

export interface IOwlmanState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OwlmanGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Owlman",
        uid: "owlman",
        playercounts: [2],
        version: "20250125",
        dateAdded: "2025-01-25",
        // i18next.t("apgames:descriptions.owlman")
        description: "apgames:descriptions.owlman",
        urls: [
            "https://owlmanthegame.blogspot.com/",
            "https://boardgamegeek.com/boardgame/86598/owlman",
        ],
        people: [
            {
                type: "designer",
                name: "Andrew Perkis",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>annihilate", "goal>royal-escape", "mechanic>asymmetry", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["automove"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private graph!: SquareDiagGraph;
    private dots: string[] = [];

    constructor(state?: IOwlmanState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Piece>([
                ["a8", "O"],
                ["d5", "H"], ["f5", "H"], ["h5", "H"],
                ["e4", "H"], ["g4", "H"],
                ["d3", "H"], ["f3", "H"], ["h3", "H"],
                ["e2", "H"], ["g2", "H"],
                ["d1", "H"], ["f1", "H"], ["h1", "D"],
            ]);
            const fresh: IMoveState = {
                _version: OwlmanGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOwlmanState;
            }
            if (state.game !== OwlmanGame.gameinfo.uid) {
                throw new Error(`The Owlman engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OwlmanGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.graph = new SquareDiagGraph(8, 8);
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if ( (row % 2 === 0 && col % 2 === 1) || (row % 2 === 1 && col % 2 === 0) ) {
                    const cell = this.graph.coords2algebraic(col, row);
                    this.graph.graph.dropNode(cell);
                }
            }
        }
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        const mine = [...this.board.entries()].filter(([,pc]) => this.currplayer === 1 ? pc !== "O" : pc === "O");
        for (const [cell, pc] of mine) {
            // owlman
            if (pc === "O") {
                // superswoop supersedes everything
                if (cell === "h1") {
                    const helpers = [...this.board.entries()].filter(([,p]) => p === "H");
                    for (const [hCell,] of helpers) {
                        moves.push(`h1x${hCell}`);
                    }
                }
                // the rest
                else {
                    // swoop
                    const [x, y] = this.graph.algebraic2coords(cell);
                    for (const three of [3, -3]) {
                        for (const one of [1, -1]) {
                            const newx1 = x + three;
                            const newy1 = y + one;
                            const newx2 = x + one;
                            const newy2 = y + three;
                            for (const [newx, newy] of [[newx1, newy1], [newx2, newy2]]) {
                                if (newx >= 0 && newx < 8 && newy >= 0 && newy < 8) {
                                    const newcell = this.graph.coords2algebraic(newx, newy);
                                    // swoop can capture doc on h1
                                    if (newcell === "h1" && this.board.has(newcell) && this.board.get(newcell)! === "D") {
                                        moves.push(`${cell}x${newcell}`);
                                    }
                                    // otherwise, can only move to empty cells
                                    else if (!this.board.has(newcell)) {
                                        moves.push(`${cell}-${newcell}`);
                                    }
                                }
                            }
                        }
                    }
                    // step
                    for (const n of this.graph.neighbours(cell)) {
                        // can capture doc by replacement on h1
                        if (n === "h1" && this.board.has(n) && this.board.get(n) === "D") {
                            moves.push(`${cell}x${n}`);
                        }
                        // otherwise only empty cells
                        else if (!this.board.has(n)) {
                            moves.push(`${cell}-${n}`);
                        }
                    }
                }
            }
            // everyone else
            else {
                for (const n of this.graph.neighbours(cell)) {
                    // can never move back to h1 after leaving it
                    if (n === "h1") { continue; }
                    // can only move to empty cells
                    if (!this.board.has(n)) {
                        moves.push(`${cell}-${n}`);
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = OwlmanGame.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                if (!this.board.has(cell)) {
                    newmove = move + "-" + cell;
                } else {
                    newmove = move + "x" + cell;
                }
            }

            // autocomplete
            const matches = this.moves().filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
            }

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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.owlman.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.owlman.PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): OwlmanGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];

        if (partial) {
            this.dots = [...new Set<string>(allMoves.filter(mv => mv.startsWith(m)).map(mv => mv.split(/[-x]/)).map(parts => parts[parts.length - 1])).values()];
            return this;
        }

        const grid = new RectGrid(8, 8);
        let capped: string|undefined;
        const [from, to] = m.split(/[-x]/);
        if (!this.board.has(from)) {
            throw new Error("Trying to move a nonexistent piece.")
        }
        const fContents = this.board.get(from)!;
        const tContents = this.board.get(to);

        // owlman steps might be a capture
        if (fContents === "O" && this.graph.neighbours(from).includes(to)) {
            const [fx, fy] = this.graph.algebraic2coords(from);
            const [tx, ty] = this.graph.algebraic2coords(to);
            const bearing = RectGrid.bearing(fx, fy, tx, ty)!;
            const ray = grid.ray(tx, ty, bearing).map(c => this.graph.coords2algebraic(...c));
            // find first occupied cell in that direction
            const idx = ray.findIndex(c => this.board.has(c));
            if (idx >= 0 && this.board.get(ray[idx]) === "H") {
                capped = ray[idx];
            }
        }

        // move the piece
        this.board.set(to, fContents);
        this.board.delete(from);
        this.results.push({type: "move", from, to});

        // check for helper scare
        if (capped !== undefined) {
            this.board.delete(capped);
            m += `(x${capped})`;
            this.results.push({type: "capture", how: "approach", what: "H", where: capped});
        }
        // otherwise check for replacement capture (doc or superswoop)
        else if (tContents !== undefined) {
            this.results.push({type: "capture", how: "replacement", what: tContents, where: to});
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): OwlmanGame {
        let reason: string|undefined;
        // doc in place
        if (this.board.get("a8") === "D" && this.board.get("b7") === "H") {
            this.gameover = true;
            this.winner = [1];
            reason = "discovered";
        }
        // owlman can't move
        else if (this.currplayer === 2 && this.moves().length === 0) {
            this.gameover = true;
            this.winner = [1];
            reason = "trapped";
        }
        // doc captured
        else if ([...this.board.values()].find(p => p === "D") === undefined) {
            this.gameover = true;
            this.winner = [2];
            reason = "docKilled";
        }
        // no helpers
        else if ([...this.board.values()].find(p => p === "H") === undefined) {
            this.gameover = true;
            this.winner = [2];
            reason = "noHelpers";
        }
        // daybreak
        // initial pos + 48 doc plies + 48 owlman plies + 1 more doc ply
        else if (this.stack.length >= 98) {
            this.gameover = true;
            this.winner = [2];
            reason = "daybreak";
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IOwlmanState {
        return {
            game: OwlmanGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OwlmanGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = OwlmanGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
            },
            legend: {
                D: {
                    name: "chess-king-outline-traditional",
                    colour: 1,
                },
                H: {
                    name: "piece",
                    colour: 1,
                },
                O: {
                    name: "chess-knight-outline-traditional",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = OwlmanGame.algebraic2coords(move.from);
                    const [toX, toY] = OwlmanGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = OwlmanGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = this.graph.algebraic2coords(cell);
                targets.push({row: y, col: x});
            }
            rep.annotations!.push({
                type: "dots",
                targets: targets as [RowCol, ...RowCol[]],
            });
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.owlman", {player, where: r.where, context: r.how}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public sameMove(move1: string, move2: string): boolean {
        // if either move contains an open parenthesis (indicating a capture),
        // only compare everything up to that parenthesis.
        const idx1 = move1.indexOf("(");
        const idx2 = move2.indexOf("(");
        return move1.substring(0, idx1 >= 0 ? idx1 : undefined) === move2.substring(0, idx2 >= 0 ? idx2 : undefined);
    }

    public clone(): OwlmanGame {
        return new OwlmanGame(this.serialize());
    }
}
