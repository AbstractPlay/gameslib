import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, orthDirections, reviver, shuffle, SquareDirectedGraph, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Piece = playerid|"X";


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
};

export interface IPahTumState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const len2pts = new Map<number, number>([
    [3, 3], [4, 10], [5, 25], [6, 56], [7, 119],
]);

export class PahTumGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pah-Tum",
        uid: "pahtum",
        playercounts: [2],
        version: "20250201",
        dateAdded: "2025-02-01",
        // i18next.t("apgames:descriptions.pahtum")
        description: "apgames:descriptions.pahtum",
        urls: ["https://boardgamegeek.com/boardgame/28128/pah-tum"],
        people: [
            {
                type: "designer",
                name: "Unknown",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {uid: "captures"},
            {uid: "quick"},
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>capture", "mechanic>convert", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "pie-even", "custom-buttons", "random-start"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlights: string[] = [];

    constructor(state?: IPahTumState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, Piece>();
            if (this.variants.includes("quick")) {
                const g = new SquareOrthGraph(7, 7);
                const shuffled = shuffle(g.graph.nodes()) as string[];
                for (let i = 0; i < 5; i++) {
                    board.set(shuffled[i], "X");
                }
            }
            const fresh: IMoveState = {
                _version: PahTumGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPahTumState;
            }
            if (state.game !== PahTumGame.gameinfo.uid) {
                throw new Error(`The PahTum engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PahTumGame {
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

    public shouldOfferPie(): boolean {
        return (!this.variants.includes("quick"));
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    public getButtons(): ICustomButton[] {
        if (!this.variants.includes("quick") && this.stack.length === 2) {
            return [{ label: "pass", move: "pass" }];
        }
        return [];
    }

    private get graph(): SquareDirectedGraph {
        return new SquareDirectedGraph(7, 7);
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        // don't return a list of moves when manually placing blocks or choosing sides
        if (!this.variants.includes("quick") && this.stack.length <= 2) {
            if (this.stack.length === 1) {
                return [];
            } else {
                return ["pass"];
            }
        }

        const moves = new Set<string>(this.graph.graph.nodes().filter(n => !this.board.has(n)));
        // if captures are enabled, check each move for captures
        if (this.variants.includes("captures")) {
            for (const mv of [...moves]) {
                const caps = this.findCaptures(mv);
                if (caps.length > 0) {
                    moves.delete(mv);
                    for (const cap of caps) {
                        moves.add(`${mv}(x${cap})`);
                    }
                }
            }
        }

        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private findCaptures(cell: string, p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const caps: string[] = [];
        const g = this.graph;
        for (const dir of orthDirections) {
            const ray = g.ray(cell, dir);
            if (ray.length >= 2 && this.board.has(ray[0]) && this.board.get(ray[0])! === (p === 1 ? 2 : 1) && this.board.has(ray[1]) && this.board.get(ray[1])! === p) {
                caps.push(ray[0]);
            }
        }
        return caps;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = PahTumGame.coords2algebraic(col, row);
            let newmove: string;

            // handle first turn specially
            if (!this.variants.includes("quick") && this.stack.length === 1) {
                if (move === "") {
                    newmove = cell;
                } else {
                    const cells = move.split(",")
                    if (!cells.includes(cell)) {
                        newmove = [...cells, cell].join(",");
                    } else {
                        newmove = move;
                    }
                }
            }
            // regular moves
            else {
                // if captures are active, then a second click means something
                if (this.variants.includes("captures") && move.length > 0 && this.findCaptures(move).length > 1) {
                    newmove = `${move}(x${cell})`;
                }
                // otherwise, just assume placement
                else {
                    newmove = cell;
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
        const g = this.graph;

        if (m.length === 0) {
            let context = "rest";
            if (!this.variants.includes("quick")) {
                if (this.stack.length === 1) {
                    context = "offer"
                } else if (this.stack.length === 2) {
                    context = "response";
                }
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pahtum.INITIAL_INSTRUCTIONS", {context});
            return result;
        }

        // handle setup separately
        if (!this.variants.includes("quick") && this.stack.length <= 2) {
            if (this.stack.length === 1) {
                const cells = new Set<string>(m.split(","));
                // each cell must be valid and empty
                for (const cell of cells) {
                    if (!g.graph.hasNode(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }
                    if (this.board.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                        return result;
                    }
                }
                result.valid = true;
                result.complete = cells.size === 5 ? 1 : -1;
                result.canrender = true;
                result.message = cells.size === 5 ?
                    i18next.t("apgames:validation._general.VALID_MOVE") :
                    i18next.t("apgames:validation.pahtum.PARTIAL", {context: "setup"});
                return result;
            } else {
                if (m !== "pass") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        if (allMoves.includes(m)) {
            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.pahtum.PARTIAL", {context: "rest"});
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): PahTumGame {
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
            if (!partial && (this.variants.includes("quick") || this.stack.length > 2) && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.highlights = [];

        // if partial, and not setup, highlight and get out
        if (partial && (this.variants.includes("quick") || this.stack.length > 2)) {
            const set = new Set<string>();
            const matches = allMoves.filter(mv => mv.startsWith(m));
            for (const match of matches) {
                if (match.includes("(")) {
                    set.add(match.substring(4, 6));
                }
            }
            this.highlights = [...set];
            return this;
        }

        // setup scenarios first
        if (!this.variants.includes("quick") && this.stack.length <= 2) {
            if (this.stack.length === 1) {
                const cells = m.split(",");
                for (const cell of cells) {
                    this.board.set(cell, "X");
                    this.results.push({type: "place", where: cell, what: "block"});
                }
            } else {
                this.results.push({type: "pass"});
            }
        }
        // all the rest
        else {
            let cell = m;
            let cap: string|undefined;
            if (m.includes("(")) {
                cell = m.substring(0, 2);
                cap = m.substring(4, 6);
            }
            this.board.set(cell, this.currplayer);
            this.results.push({type: "place", where: cell, what: "piece"});
            if (cap !== undefined) {
                this.board.set(cap, this.currplayer);
                this.results.push({type: "convert", what: this.currplayer === 1 ? "2" : "1", into: this.currplayer.toString(), where: cell});
            }
        }

        // need to check for partial again in case we are setting up
        if (partial) { return this; }

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

    public get lines(): string[] {
        const collate = (cells: string[], dir: Direction): string[] => {
            const localLines: string[] = [];
            for (const cell of cells) {
                const ray = g.ray(cell, dir, true);
                const line = ray.map(n => this.board.has(n) ? this.board.get(n)! : "-")
                                .join("");
                localLines.push(line);
            }
            return localLines;
        }

        const g = this.graph;
        const lines: string[] = [];
        // N-E
        lines.push(...collate(["a1", "a2", "a3", "a4", "a5", "a6", "a7"], "E"));
        // S-W
        lines.push(...collate(["a7", "b7", "c7", "d7", "e7", "f7", "g7"], "S"));

        return lines;
    }

    public getPlayerScore(player: playerid): number {
        let score = 0;
        for (const line of this.lines) {
            for (const len of [7, 6, 5, 4, 3]) {
                const target = Array.from({length: len}, () => player).join("");
                if (line.includes(target)) {
                    score += len2pts.get(len)!;
                    break;
                }
            }
        }
        return score;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    protected checkEOG(): PahTumGame {
        if (this.board.size === 49) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IPahTumState {
        return {
            game: PahTumGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PahTumGame.gameinfo.version,
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
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 7; col++) {
                const cell = PahTumGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else if (contents === 2) {
                        pieces.push("B");
                    } else {
                        pieces.push("X");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{7}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 7,
                height: 7,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
                X: {
                    name: "piece-square-borderless",
                    colour: "_context_fill",
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place" || move.type === "convert") {
                    const [x, y] = PahTumGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // add highlights
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.highlights) {
                const [x, y] = PahTumGame.algebraic2coords(cell);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
            }
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
            case "place":
                node.push(i18next.t("apresults:PLACE.pahtum", {player, where: r.where, context: r.what!}));
                resolved = true;
                break;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.simple", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getStartingPosition(): string {
        const blocks = [...this.board.entries()].filter(([,pc]) => pc === "X").map(([cell,]) => cell).sort((a,b) => a.localeCompare(b));
        return blocks.join(",");
    }

    public clone(): PahTumGame {
        return new PahTumGame(this.serialize());
    }
}
