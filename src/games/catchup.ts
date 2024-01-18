/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import _ from "lodash";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    sizes: number[][];
    lastMaxs: [number, number];
};

export interface ICatchupState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CatchupGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Catchup",
        uid: "catchup",
        playercounts: [2],
        version: "20240109",
        // i18next.t("apgames:descriptions.catchup")
        description: "apgames:descriptions.catchup",
        urls: ["https://boardgamegeek.com/boardgame/68199/catchup"],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://www.nickbentley.games/"],
            }
        ],
        flags: ["experimental", "multistep", "scores", "no-moves"],
        variants: [
            {
                uid: "size-6",
                group: "board",
            },
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public sizes: number[][] = [[], []];
    public lastMaxs: [number, number] = [0, 0];
    private boardSize = 0;
    private currMoveHighlight: string[] = [];

    constructor(state?: ICatchupState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: CatchupGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                sizes: [[], []],
                lastMaxs: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICatchupState;
            }
            if (state.game !== CatchupGame.gameinfo.uid) {
                throw new Error(`The Catchup engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CatchupGame {
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
        this.sizes = deepclone(state.sizes) as number[][];
        this.lastMaxs = [...state.lastMaxs];
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 5;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): CatchupGame {
        this.graph = this.getGraph();
        return this;
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.graph.algebraic2coords(a);
        const [bx, by] = this.graph.algebraic2coords(b);
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        return 0;
    }

    private getGroupSizes(player: playerid): number[] {
        // Get the sizes of all groups of pieces for `player`.
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
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
        return groups.map(g => g.size).sort((a, b) => b - a);
    }

    private updateSizes(): void {
        // Update `this.sizes`.
        for (let i = 1; i <= this.numplayers; i++) {
            this.sizes[i - 1] = this.getGroupSizes(i as playerid);
        }
    }

    private hasBonusMove(player: playerid): boolean {
        // Check for bonus move.
        // Bonus move only if the current max of opponent is greater than 1.
        const currMaxOpponent = this.sizes[player % 2][0] ?? 1;
        if (currMaxOpponent <= 1) { return false; }

        // No delta in opponent's max size.
        const lastMax = this.lastMaxs[player % 2];
        if (currMaxOpponent === lastMax) { return false; }

        // Opponent's max is not greater than or equal to player's.
        const currMax = this.sizes[player - 1][0] ?? 1;
        if (currMax > currMaxOpponent) { return false; }
        return true;
    }

    private randomMoveCount(): number {
        // Get weighted random number of moves to simulate picking from list of all moves.
        const maxMoves = this.maxMoves(this.currplayer);
        const spacesLeft = this.spacesLeft();
        const weights: number[] = [];
        for (let i = 0; i < maxMoves; i++) {
            weights.push((weights.length === 0 ? 1 : weights[weights.length - 1]) * (spacesLeft - i));
        }
        const cumWeights: number[] = weights.map((w, i) => weights.slice(0, i + 1).reduce((a, b) => a + b));
        const random = Math.random() * cumWeights[cumWeights.length - 1];
        let weightedIndex = -1;
        for (let i = 0; i < cumWeights.length; i++) {
            weightedIndex = i;
            if (cumWeights[i] > random) { break; }
        }
        return _.range(1, maxMoves + 1)[weightedIndex];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public moves(player?: playerid): string[] {
        // Move list is too large for Catchup.
        return [];
    }

    public randomMove(): string {
        // Move list too large so we generate the random placement as needed.
        const availableSpaces: string[] = [];
        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell)) { continue; }
            availableSpaces.push(cell);
        }
        const places = _.sampleSize(availableSpaces, this.randomMoveCount());
        return places.sort((a, b) => this.sort(a, b)).join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                const moves = move.split(",");
                if (moves.includes(cell)) {
                    newmove = moves.filter(m => m !== cell).sort((a, b) => this.sort(a, b)).join(",");
                } else {
                    newmove = [...moves, cell].sort((a, b) => this.sort(a, b)).join(",");
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
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

    private spacesLeft(): number {
        // Count the number of empty cells.
        return this.graph.listCells().length - this.board.size;
    }

    private maxMoves(player: playerid): number {
        // Calculate the maximum number of moves for `player`.
        const spacesLeft = this.spacesLeft();
        const hasBonusMove = this.hasBonusMove(player)
        return this.stack.length === 1 ? 1 : Math.min(spacesLeft, hasBonusMove ? 3 : 2);
    }

    private normaliseMove(move: string): string {
        // Sort the move list so that there is a unique representation.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    public sameMove(move1: string, move2: string): boolean {
        // Check if two moves are the same.
        return this.normaliseMove(move1) === this.normaliseMove(move2);
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const maxMoves = this.maxMoves(this.currplayer);
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.catchup.INITIAL_INSTRUCTIONS", {count: maxMoves});
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const moves = m.split(",");
        // Don't exceed count
        if (moves.length > maxMoves) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catchup.TOO_MANY_MOVES", {count: maxMoves});
            return result;
        }

        // Valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                const [, y] = this.graph.algebraic2coords(move);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }

        // Cell is empty
        let notEmpty;
        for (const move of moves) {
            if (this.board.has(move)) { notEmpty = move; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: notEmpty});
            return result;
        }

        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^[a-z]\\d+(,[a-z]\\d+){0,${maxMoves - 1}}$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catchup.INVALID_PLACEMENT", {move: m});
            return result;
        }

        // No duplicate cells.
        const seen: Set<string> = new Set();
        const duplicates: Set<string> = new Set();
        for (const move of moves) {
            if (seen.has(move)) {
                duplicates.add(move);
            }
            seen.add(move);
        }
        if (duplicates.size > 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catchup.DUPLICATE", {where: [...duplicates].join(", ")});
            return result;
        }

        // Normalised move
        const normalised = this.normaliseMove(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catchup.NORMALISED", {move: normalised});
            return result;
        }

        // we're good
        if (moves.length < maxMoves) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.catchup.MAKE_MORE_MOVES", {count: maxMoves - moves.length});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): CatchupGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }
        if (m.length === 0) { return this; }

        m = this.normaliseMove(m);
        const moves = m.split(",");

        this.results = [];
        for (const move of moves) {
            this.board.set(move, this.currplayer);
            this.results.push({type: "place", where: move});
            this.currMoveHighlight.push(move);
        }

        this.lastmove = m;
        this.lastMaxs = [this.sizes[0][0] ?? 1, this.sizes[1][0] ?? 1];
        this.updateSizes()

        if (partial) { return this; }

        this.currMoveHighlight = [];
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private getWinner(): playerid | undefined {
        // Get the winning player.
        const player1 = this.sizes[0];
        const player2 = this.sizes[1];
        // Loop through the shorter array
        const minLen = Math.min(player1.length, player2.length);
        for (let i = 0; i < minLen; i++) {
            if (player1[i] > player2[i]) {
                return 1;
            } else if (player1[i] < player2[i]) {
                return 2;
            }
        }
        // If the loop ends, compare the lengths of the arrays
        if (player1.length > player2.length) {
            return 1;
        } else if (player1.length < player2.length) {
            return 2;
        } else {
            return undefined;
        }
    }

    protected checkEOG(): CatchupGame {
        if (this.spacesLeft() === 0) {
            this.gameover = true;
            const winner = this.getWinner();
            // Ties are not possible on an odd board, but just for completion.
            this.winner = winner === undefined ? [1, 2] : [winner];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ICatchupState {
        return {
            game: CatchupGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CatchupGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            sizes: deepclone(this.sizes) as number[][],
            lastMaxs: [...this.lastMaxs],
        };
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

        const points: { row: number, col: number }[] = [];
        for (const cell of this.currMoveHighlight) {
            const [x, y] = this.graph.algebraic2coords(cell);
            points.push({ row: y, col: x });
        }
        const markers: Array<any> | undefined = points.length !== 0 ? [{ type: "flood", colour: "#FFFF00", opacity: 0.4, points }] : undefined;

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                // @ts-ignore
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        // Ideally it should return the entire group size string.
        // return scores.join("-");
        // But because this method has to return a number, we just take the
        // effective group as score, which may be harder to interpret.
        const scores = this.sizes[player - 1];
        if (scores.length === 0) { return 0; }
        const scoresOther = this.sizes[player % 2];
        if (scoresOther.length > scores.length) {
            return 0;
        }
        if (scoresOther.length < scores.length) {
            return scores[scoresOther.length];
        }
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] !== scoresOther[i]) {
                return scores[i];
            }
        }
        return 0;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.sizes[0].join("-"), this.sizes[1].join("-")] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Sizes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.sizes[n - 1].join("-");
            status += `Player ${n}: ${pieces}\n\n`;
        }

        return status;
    }

    public clone(): CatchupGame {
        return new CatchupGame(this.serialize());
    }
}
