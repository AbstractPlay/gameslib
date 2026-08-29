import {  GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexTriGraph } from "../common/graphs";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
};

export interface IBitesizeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BitesizeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "BITESIZE",
        uid: "bitesize",
        playercounts: [2],
        version: "20260815",
        dateAdded: "2026-08-25",
        // i18next.t("apgames:descriptions.bitesize")
        description: "apgames:descriptions.bitesize",
        urls: [
                "https://rustic-title-6c1.notion.site/BITESIZE-24926037bce18169a00fd15aacc5dfbb",
                "https://boardgamegeek.com/thread/3499194",
              ],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
                apid: "52077877-93bb-4fff-9e5f-f1c41ac8e866",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        variants: [
            { uid: "size-5", group: "board" }
        ],
        flags: ["scores", "automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(4, 7);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0];
    public boardSize = 4;

    constructor(state?: IBitesizeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BitesizeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBitesizeState;
            }
            if (state.game !== BitesizeGame.gameinfo.uid) {
                throw new Error(`The BITESIZE engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BitesizeGame {
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
        this.results = [...state._results];
        this.boardSize = this.getBoardSize();
        this.scores = [...state.scores];
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 &&
                this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 4;
    }

    private getThreshold(): number {
        return (this.getBoardSize() === 4) ? 16 : 25;
    }

    private getMaxGroupSize(): number {
        // This isn't necessarily always true, but it's true for size 4 and 5
        return this.getBoardSize();
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): BitesizeGame {
        this.graph = this.getGraph();
        return this;
    }

    // get all groups of pieces for `player`
    private getGroups(player?: playerid): string[][] {
        player ??= this.currplayer;
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();

        for (const piece of pieces) {
            if (seen.has(piece)) { continue; }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) { continue; }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }

        return [...groups].map(group => [...group]);
    }

    // is `cell` adjacent to `group`?
    private isAdjacent(cell: string, group: string[]): boolean {
        for (const part of group) {
            for (const neigh of this.graph.neighbours(part)) {
                if (cell === neigh) {
                    return true;
                }
            }
        }
        return false;
    }

    // if current player places a piece at `cell`, what is its new group?
    private newGroup(cell: string, groups: string[][]): string[] {
        const newGroup = [cell]; // the eventual new piece at `cell`
        for (const group of groups) {
            if ( this.isAdjacent(cell, group) ) {
                newGroup.push(...group);
            }
        }
        return newGroup;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const groups = this.getGroups();
        const cells = this.graph.listCells(false) as string[];
        return cells.filter(c => !this.board.has(c)).filter(c => this.newGroup(c, groups).length <= this.getMaxGroupSize());
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            result.move = result.valid ? cell : move;
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
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.bitesize.INSTRUCTIONS", {size: this.getMaxGroupSize()});
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        // check if valid cell
        try {
            this.graph.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }

        if (!allMoves.includes(m) ) {
            result.valid = false;
            if ( this.newGroup(m, this.getGroups()).length > 4 ) {
                result.message = i18next.t("apgames:validation.bitesize.GROUP_TOO_LARGE");
            } else {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        result.canrender = true;
        return result;
    }

    public move(m: string, { trusted = false } = {}): BitesizeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        if (m.length === 0) { return this; }

        this.results = [];

        const newGroup = this.newGroup(m, this.getGroups()); // necessary to check captures
        this.board.set(m, this.currplayer);
        this.results.push({type: "place", where: m});

        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const oppGroups = this.getGroups(prevplayer);

        // check captures
        if (newGroup.length > 1 ) {
            for (const oppGroup of oppGroups) {
                if ( oppGroup.length + 1 !== newGroup.length ) { continue; } // not of capturable size
                if ( oppGroup.some(c => this.isAdjacent(c, newGroup)) ) {
                    // this opponent's group is adjacent to the new formed group => capture it
                    for (const cell of oppGroup) {
                        this.board.delete(cell);
                    }
                    this.scores[this.currplayer - 1] += oppGroup.length;
                    this.results.push({ type: "capture", where: [...oppGroup].join(), count: oppGroup.length });
                }
            }
        } else { // current move is singleton: check if it can help capture 4-sized groups
            // get all singletons
            const singletons: string[] = this.getGroups().filter(group => group.length === 1).map(cs => cs[0]);
            // get opponent max-size groups
            const oppMaxSizeGroups: string[][] = oppGroups.filter(group => group.length === this.getMaxGroupSize());
            // check if any opponent group is adjacent to three singletons
            for (const oppGroup of oppMaxSizeGroups) {
                let count = 0;
                let includeCurrentMove = false; // need to include the current singleton move `m`
                for (const singleton of singletons) {
                    if ( this.isAdjacent(singleton, oppGroup) ) {
                        count += 1;
                        includeCurrentMove = includeCurrentMove || (singleton === m);
                    }
                }
                if ( includeCurrentMove && count === 3 ) { // capture it!
                    for (const cell of oppGroup) {
                        this.board.delete(cell);
                    }
                    this.scores[this.currplayer - 1] += oppGroup.length;
                    this.results.push({ type: "capture", where: [...oppGroup].join(), count: oppGroup.length });
                }
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BitesizeGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;

        this.gameover = this.moves().length === 0 || this.getPlayerScore(prevplayer) >= this.getThreshold();
        if (this.gameover) {
            if (this.getPlayerScore(1) === this.getPlayerScore(2)) {
                // The player who ran out of moves loses ties
                this.winner = [prevplayer];
            } else {
                this.winner = this.getPlayerScore(1) >= this.getPlayerScore(2) ? [1] : [2];
            }
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }

        return this;
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
            },
            legend: {
                A: {name: "hex-pointy", scale: 1.25, colour: 1 },
                B: {name: "hex-pointy", scale: 1.25, colour: 2 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "place") {
                const [x, y] = this.graph.algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
            } else if (move.type === "capture") {
                for (const cell of move.where!.split(",")) {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                }
            }
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player-1];
    }

    public sidebarScores(): IScores[] {
        return [{ name: this.neutralAreaLabel("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }];
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.complete", { where: r.where!, what: "piece" });
                return true;
            case "capture":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.bitesize", { where: r.where!, count: r.count!});
                return true;
            case "eog":
                this.pushNeutralChatLine(lines, "apresults:EOG.default");
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public state(): IBitesizeState {
        return {
            game: BitesizeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BitesizeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public clone(): BitesizeGame {
        return new BitesizeGame(this.serialize());
    }
}
