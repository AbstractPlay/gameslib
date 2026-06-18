import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexTriGraph } from "../common/graphs";
import i18next from "i18next";

const THRESHOLD = 12

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
};

export interface IEatYourNeighborState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EatYourNeighborGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Eat Your Neighbor",
        uid: "eatyourneighbor",
        playercounts: [2],
        version: "20260616",
        dateAdded: "2026-06-16",
        // i18next.t("apgames:descriptions.eatyourneighbor")
        description: "apgames:descriptions.eatyourneighbor",
        urls: [
                "https://grateful-pantry-bd4.notion.site/Eat-your-Neighbor-1f9105b4dd21804caa9ac5d24cfd68e8",
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
            { uid: "#board", }, // size-4
            { uid: "size-5", group: "board" },
            { uid: "no-threshold", group: "ruleset" },
        ],
        flags: ["scores", "automove", "experimental"]
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
    private ruleset: "default" | "no-threshold";

    constructor(state?: IEatYourNeighborState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: EatYourNeighborGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEatYourNeighborState;
            }
            if (state.game !== EatYourNeighborGame.gameinfo.uid) {
                throw new Error(`The Eat Your Neighbor engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): EatYourNeighborGame {
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
        if ( (this.variants !== undefined) && (this.variants.length > 0) &&
             (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
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

    private getRuleset(): "default" | "no-threshold" {
        if (this.variants.includes("no-threshold")) { return "no-threshold"; }
        return "default";
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): EatYourNeighborGame {
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
        const groups = this.getGroups(); // get current player's groups
        const cells = this.graph.listCells(false) as string[];
        const moves = cells.filter(c => !this.board.has(c))
                           .filter(c => this.newGroup(c, groups).length <= 4);
        if (this.ruleset === "no-threshold") {
            return moves.length === 0 ? ["pass"] : moves;
        }
        return moves;
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
            result.message = i18next.t("apgames:validation.eatyourneighbor.INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (this.ruleset === "no-threshold" && m === "pass") {
            if (! allMoves.includes(m) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.eatyourneighbor.CANNOT_PASS", {move: allMoves[0]});
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        try { // check if valid cell
            this.graph.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if ( this.board.has(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }

        if (! allMoves.includes(m) ) {
            result.valid = false;
            if ( this.newGroup(m, this.getGroups()).length > 4 ) {
                result.message = i18next.t("apgames:validation.eatyourneighbor.GROUP_TOO_LARGE");
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

    public move(m: string, { trusted = false } = {}): EatYourNeighborGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        if (m.length === 0) { return this; }

        this.results = [];

        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
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
                // get opponent 4-size groups
                const oppSize4s: string[][] = oppGroups.filter(group => group.length === 4);
                // check if any opponent group is adjacent to three singletons
                for (const oppGroup of oppSize4s) {
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
        } // else (!pass)

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): EatYourNeighborGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;

        if (this.ruleset === "no-threshold") { // ends with two consecutive passes
            this.gameover = this.lastmove === "pass" &&
                            this.stack[this.stack.length - 1].lastmove === "pass";
        } else { // ends when a player can't place legally or has eaten at least enough pieces
            this.gameover = this.moves().length === 0 ||
                            this.getPlayerScore(prevplayer) >= THRESHOLD;
        }

        if (this.gameover) {
            if ( this.getPlayerScore(1) === this.getPlayerScore(2) ) {
                this.winner = [prevplayer]; // the last player who placed a piece wins
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
        return [{ name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }];
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place": // note that when chat() is invoked, the current player is already updated
                node.push(i18next.t("apresults:PLACE.complete", { player, where: r.where, what: "piece" }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.eatyourneighbor", { player, where: r.where, count: r.count}));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public state(): IEatYourNeighborState {
        return {
            game: EatYourNeighborGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EatYourNeighborGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public clone(): EatYourNeighborGame {
        return new EatYourNeighborGame(this.serialize());
    }
}
