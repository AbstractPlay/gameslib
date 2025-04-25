import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, oppositeDirections, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareDiamondsDirectedGraph } from "../common/graphs";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ITessellaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TessellaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Tessella",
        uid: "tessella",
        playercounts: [2],
        version: "20250422",
        dateAdded: "2025-04-25",
        // i18next.t("apgames:descriptions.tessella")
        description: "apgames:descriptions.tessella",
        urls: [
            "https://drive.google.com/file/d/1QMwtw90X1qLMpk4l1OoQ4oTZZfhTITAq/view",
            "https://boardgamegeek.com/boardgame/377702/tessella",
        ],
        people: [
            {
                type: "designer",
                name: "Michael Lefkowitz",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>race", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "scores"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private dots: string[] = [];

    constructor(state?: ITessellaState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>([
                ["a5", 2], ["a4", 2], ["a3", 2], ["a2", 2], ["b5", 2], ["c5", 2], ["d5", 2],
                ["e1", 1], ["d1", 1], ["c1", 1], ["b1", 1], ["e2", 1], ["e3", 1], ["e4", 1],
            ]);
            const fresh: IMoveState = {
                _version: TessellaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITessellaState;
            }
            if (state.game !== TessellaGame.gameinfo.uid) {
                throw new Error(`The Tessella engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TessellaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    public get graph(): SquareDiamondsDirectedGraph {
        return new SquareDiamondsDirectedGraph(5, 5);
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const g = this.graph;
        const moves: string[] = [];

        const mine = [...this.board.entries()].filter(([,v]) => v === this.currplayer).map(([k,]) => k);
        for (const start of mine) {
            // moves first
            for (const n of g.neighbours(start)) {
                if (!this.board.has(n)) {
                    moves.push(`${start}-${n}`);
                }
            }
            // captures
            for (const dir of allDirections) {
                const ray = g.ray(start, dir);
                const occ = ray.find(n => this.board.has(n));
                if (occ !== undefined) {
                    // can only capture enemy pieces
                    if (this.board.get(occ)! !== this.currplayer) {
                        // go in the opposite dir looking for backup
                        const oppRay = g.ray(start, oppositeDirections.get(dir)!);
                        const oppOcc = oppRay.find(n => this.board.has(n));
                        if (oppOcc !== undefined) {
                            // if it's your own piece, valid capture
                            if (this.board.get(oppOcc)! === this.currplayer) {
                                moves.push(`${start}x${occ}`);
                            }
                        }
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
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove: string;

            if (move === "") {
                newmove = cell;
            } else {
                // if second click is your own piece, reset
                if (this.board.has(cell) && this.board.get(cell)! === this.currplayer) {
                    newmove = cell;
                }
                // otherwise complete move
                else {
                    const [from,] = move.split(/[-x]/);
                    if (this.board.has(cell)) {
                        newmove = `${from}x${cell}`;
                    } else {
                        newmove = `${from}-${cell}`;
                    }
                }
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tessella.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                const cancap = matches.some(mv => mv.includes("x"));
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.tessella.PARTIAL", {context: cancap ? "cancap" : "move"});
                return result;
            } else {
                if (!m.includes("-") && !m.includes("x")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: m});
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): TessellaGame {
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
            const [f,] = m.split(/[-x]/);
            const matches = allMoves.filter(mv => mv.startsWith(f));
            const tos = new Set<string>(matches.map(mv => {
                const [,t] = mv.split(/[-x]/);
                return t;
            }));
            this.dots = [...tos];
            return this;
        }

        const [from, to] = m.split(/[-x]/);
        this.board.delete(from);
        this.board.set(to, this.currplayer);
        this.results.push({type: "move", from, to});
        if (m.includes("x")) {
            this.results.push({type: "capture", where: to});
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

    public getPlayerScore(player: playerid): number {
        const other = player === 1 ? 2 : 1;
        const theirs = [...this.board.values()].filter(v => v === other);
        return 7 - theirs.length;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }]
    }

    protected checkEOG(): TessellaGame {
        const s1 = this.getPlayerScore(1);
        const s2 = this.getPlayerScore(2);
        if (s1 === 4 || s2 === 4) {
            this.gameover = true;
            this.winner = [(s1 === 4 ? 1 : 2)];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ITessellaState {
        return {
            game: TessellaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TessellaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()]),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-diamonds",
                width: 5,
                height: 5,
                rotate: 45,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1,
                    scale: 0.5,
                },
                B: {
                    name: "piece",
                    colour: 2,
                    scale: 0.5,
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        // add dots
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const coords: RowCol[] = [];
            for (const dot of this.dots) {
                const [x, y] = g.algebraic2coords(dot);
                coords.push({row: y, col: x});
            }
            rep.annotations!.push({type: "dots", targets: coords as [RowCol, ...RowCol[]]});
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    // public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
    //     let resolved = false;
    //     switch (r.type) {
    //         case "place":
    //             node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
    //             resolved = true;
    //             break;
    //         case "move":
    //             resolved = true;
    //             break;
    //     }
    //     return resolved;
    // }

    public clone(): TessellaGame {
        return new TessellaGame(this.serialize());
    }
}
