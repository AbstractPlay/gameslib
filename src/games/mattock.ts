/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2|3; // player 3 is used for empty mined cells.

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    minersToPlace: [number, number];
};

export interface IMattockState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MattockGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mattock",
        uid: "mattock",
        playercounts: [2],
        version: "20240106",
        // i18next.t("apgames:descriptions.mattock")
        description: "apgames:descriptions.mattock",
        urls: ["https://mattock.drew-edwards.com/"],
        people: [
            {
                type: "designer",
                name: "Drew Edwards",
                urls: ["https://games.drew-edwards.com/"]
            }
        ],
        flags: ["multistep", "automove", "scores"],
        variants: [
            {
                uid: "size-5",
                group: "board",
            },
            {
                uid: "random",
                group: "setup",
            },
            {
                uid: "freestyle",
                group: "setup",
            },
        ],
        displays: [{uid: "hide-blocked"}],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public minersToPlace: [number, number] = [0, 0];
    private boardSize = 0;

    constructor(state?: IMattockState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            let board: Map<string,playerid>;
            let minersToPlace: [number, number] = [0, 0];
            if (this.variants.includes("freestyle")) {
                if (this.variants.includes("size-5")) {
                    minersToPlace = [3, 3];
                } else {
                    minersToPlace = [6, 6];
                }
                board = new Map<string, playerid>();
            } else if (this.variants.includes("random")) {
                if (this.variants.includes("size-5")) {
                    board = this.randomPlacement(5);
                } else {
                    board = this.randomPlacement(7);
                }
            } else {
                if (this.variants.includes("size-5")) {
                    board = new Map<string, playerid>([
                        ["h4", 1], ["c6", 1], ["d2", 1],
                        ["g2", 2], ["f7", 2], ["b3", 2],
                    ]);
                } else {
                    board = new Map<string, playerid>([
                        ["k1", 1], ["i11", 1], ["a3", 1], ["j6", 1], ["e8", 1], ["f4", 1],
                        ["m5", 2], ["c9", 2], ["d1", 2], ["i4", 2], ["h9", 2], ["d5", 2],
                    ]);

                }
            }

            const fresh: IMoveState = {
                _version: MattockGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                minersToPlace,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMattockState;
            }
            if (state.game !== MattockGame.gameinfo.uid) {
                throw new Error(`The Mattock engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = this.getGraph();
    }

    public load(idx = -1): MattockGame {
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
        this.minersToPlace = [...state.minersToPlace];
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 7;
    }

    private getQuardrants(size: number): Map<string, string[]> {
        // Get quadrants top three quadrants of a board of size `size`.
        const quadrants: Map<string, string[]> = new Map([
            ["q1", []],
            ["q2", []],
            ["q3", []],
        ]);
        const graph = this.getGraph(size);
        for (let j=0; j < size - 1; j++) {
            for (let i=0; i < j + 1; i++) {
                quadrants.get("q1")!.push(graph.coords2algebraic(i, j));
                quadrants.get("q2")!.push(graph.coords2algebraic(size - j + i - 1, size - j - 2));
                quadrants.get("q3")!.push(graph.coords2algebraic(i + size, j + 1));
            }
        }
        return quadrants;
    }

    private randomPlacement(size: number): Map<string, playerid> {
        // Create setup for a random variant game.
        const quadrants = this.getQuardrants(size);
        const graph = this.getGraph(size);
        const board: Map<string, playerid> = new Map();
        if (size === 5) {
            this.placeRandom(board, quadrants.get("q1")!, 1, graph);
            this.placeRandom(board, quadrants.get("q2")!, 2, graph);
            this.placeRandom(board, quadrants.get("q3")!, 1, graph);
        } else {
            this.placeRandom(board, quadrants.get("q1")!, 1, graph);
            this.placeRandom(board, quadrants.get("q2")!, 1, graph);
            this.placeRandom(board, quadrants.get("q3")!, 1, graph);
            this.placeRandom(board, quadrants.get("q1")!, 2, graph);
            this.placeRandom(board, quadrants.get("q2")!, 2, graph);
            this.placeRandom(board, quadrants.get("q3")!, 2, graph);
        }
        return board;
    }

    private placeRandom(board: Map<string, playerid>, quadrant: string[], player: playerid, graph: HexTriGraph): void {
        // Place a `player`'s miner at `board` a random cell in `quadrant` and the opponent's miner at the 180 degree rotation.
        let found = false;
        while (!found) {
            const cell = quadrant[Math.floor(Math.random() * quadrant.length)]
            const neighbours = [cell, ...graph.neighbours(cell)];
            if (neighbours.every(n => !board.has(n))) {
                board.set(cell, player);
                board.set(graph.rot180(cell), player % 2 + 1 as playerid);
                found = true;
            }
        }
    }

    private getGraph(size?: number): HexTriGraph {
        if (size === undefined) {
            size = this.boardSize;
        }
        return new HexTriGraph(size, size * 2 - 1);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        if (this.variants.includes("freestyle")) {
            if (this.variants.includes("size-5") && this.stack.length < 7 ||
            !this.variants.includes("size-5") && this.stack.length < 13) {
                for (const cell of this.graph.listCells() as string[]) {
                    if (!this.board.has(cell) && this.canPlace(cell)) {
                        moves.push(cell);
                    }
                }
                return moves;
            }
            if (this.variants.includes("size-5") && this.stack.length === 7 ||
            !this.variants.includes("size-5") && this.stack.length === 13) {
                return ["pass"];
            }
        }

        const miners = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const cell of this.graph.listCells() as string[]) {
            if (this.board.has(cell)) {
                continue;
            }
            if (!this.canMine(cell)) {
                continue;
            }
            if (!this.reachableMine(cell, player)) {
                continue;
            }
            moves.push(cell);
            const loopMiners = this.isRevivable(player) ? [...miners, cell] : miners;
            for (const miner of loopMiners) {
                for (const to of this.getTos(player, miner, cell)) {
                    moves.push(`${cell}/${miner}-${to}`);
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            // If you click on an occupied cell, clear the entry
            if (this.variants.includes("freestyle") && (this.variants.includes("size-5") && this.stack.length < 7 ||
                !this.variants.includes("size-5") && this.stack.length < 13)) {
                    newmove = cell;
            } else {
                if (move === "") {
                    newmove = cell;
                } else {
                    const [mine, from, to] = move.split(/\/|-/);
                    if (from === undefined) {
                        newmove = `${mine}/${cell}`;
                    } else if (to === undefined) {
                        newmove = `${mine}/${from}-${cell}`;
                    } else {
                        newmove = move;
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            if (this.variants.includes("freestyle")) {
                if (this.variants.includes("size-5") && this.stack.length < 7 ||
                !this.variants.includes("size-5") && this.stack.length < 13) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.mattock.INITIAL_INSTRUCTIONS_PLACEMENT");
                    return result;
                }
                if (this.variants.includes("size-5") && this.stack.length === 7 ||
                !this.variants.includes("size-5") && this.stack.length === 13) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.mattock.INITIAL_INSTRUCTIONS_PASS");
                    return result;
                }
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.mattock.INITIAL_INSTRUCTIONS");
            return result;
        }
        if (this.variants.includes("freestyle")) {
            if (this.variants.includes("size-5") && this.stack.length === 7 ||
            !this.variants.includes("size-5") && this.stack.length === 13) {
                if (m !== "pass") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mattock.MUST_PASS");
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
        const moves = m.split(/\/|-/);
        // valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                this.graph.algebraic2coords(move);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        if (this.variants.includes("freestyle")) {
            if (this.variants.includes("size-5") && this.stack.length < 7 ||
                !this.variants.includes("size-5") && this.stack.length < 13) {
                if (moves.length > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mattock.MULTIPLE_PLACEMENT");
                    return result;
                }
                if (this.board.has(moves[0])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: moves[0]});
                    return result;
                }
                if (!this.canPlace(moves[0])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mattock.INVALID_PLACE", {cell: moves[0]});
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        const [mine, from, to] = moves;
        // cell is empty
        if (this.board.has(mine)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mattock.MINED", {mine});
            return result;
        }
        if (!this.canMine(mine)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mattock.INVALID_MINE", {mine});
            return result;
        }
        if (!this.reachableMine(mine, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mattock.UNREACHABLE_MINE", {mine});
            return result;
        }
        if (from === undefined) {
            result.valid = true;
            result.canrender = true;
            result.complete = 0;
            result.message = i18next.t("apgames:validation.mattock.MOVE_INSTRUCTIONS");
            return result;
        }
        if ((!this.board.has(from) || this.board.get(from) !== this.currplayer) && !(this.isRevivable(this.currplayer) && from === mine)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mattock.INVALID_FROM", {from});
            return result;
        }
        const possibleMoves = this.getTos(this.currplayer, from, mine);
        if (possibleMoves.size === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mattock.NO_MOVES", {from});
            return result;
        }
        if (to === undefined) {
            result.valid = true;
            result.canrender = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.mattock.TO_INSTRUCTIONS");
            return result;
        }
        if (this.isRevivable(this.currplayer) && to === mine || this.board.has(to) && this.board.get(to) !== 3) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
            return result;
        }
        if (from === to) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        if (!possibleMoves.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mattock.INVALID_TO", {from, to});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    private canPlace(place: string): boolean {
        // Check that there are no neighbouring miners to `place` for freestyle placement.
        for (const n of this.graph.neighbours(place)) {
            if (this.board.has(n)) { return false; }
        }
        return true;
    }

    private canMine(mine: string): boolean {
        // Check if cell `mine` can be mined.
        if (this.graph.neighbours(mine).filter(n => this.board.has(n)).length > 3) {
            return false;
        }
        for (const neighbour of this.graph.neighbours(mine)) {
            if (!this.board.has(neighbour)) { continue; }
            if (this.graph.neighbours(neighbour).filter(n => this.board.has(n)).length > 2) {
                return false;
            }
        }
        return true;
    }

    private reachableMine(mine: string, player: playerid): boolean {
        // Check if cell `mine` is reachable by `player`.
        const seen: Set<string> = new Set();
        const todo: string[] = []
        for (const n of this.graph.neighbours(mine)) {
            if (this.board.has(n)) {
                const owner = this.board.get(n);
                if (owner === player) { return true; }
                if (owner === 3) { todo.push(n); }
            }
        }
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) {
                continue;
            }
            seen.add(cell);
            for (const n of this.graph.neighbours(cell)) {
                const owner = this.board.get(n);
                if (owner === player) { return true; }
                if (this.board.has(n) && this.board.get(n) === 3) {
                    todo.push(n);
                }
            }
        }
        return false;
    }

    private getTos(player: playerid, from: string, mine: string): Set<string> {
        // Get all cells `player`'s miner at `from` can move to. `mine` is the cell that was just mined.
        const seen: Set<string> = new Set();
        const todo: string[] = [from]
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) {
                continue;
            }
            seen.add(cell);
            for (const n of this.graph.neighbours(cell)) {
                if (n === mine) {
                    todo.push(n);
                }
                if (this.board.has(n)) {
                    const owner = this.board.get(n)!;
                    if (owner === player || owner === 3) {
                        todo.push(n);
                    }
                }
            }
        }
        if (this.isRevivable(player)) {
            seen.delete(mine);
        }
        const miners = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const miner of miners) {
            seen.delete(miner);
        }
        return seen;
    }

    private isRevivable(player: playerid) {
        // Check if a player can revive a miner.
        const miners = [...this.board.entries()].filter(e => e[1] === player);
        return !this.variants.includes("size-5") && miners.length < 6 || this.variants.includes("size-5") && miners.length < 3
    }

    private isCaptured(at: string): boolean {
        // Check if a miner at `at` is captured on the next turn.
        const player = this.board.get(at)!;
        const seen: Set<string> = new Set();
        const todo: string[] = [at]
        let enemyCount = 0;
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) {
                continue;
            }
            seen.add(cell);
            const owner = this.board.get(cell)!;
            if (owner === player && cell !== at) { return false; }
            if (owner === player % 2 + 1) {
                enemyCount++;
            } else {
                for (const n of this.graph.neighbours(cell)) {
                    if (this.board.has(n)) {
                        todo.push(n);
                    }
                }
            }
        }
        if (enemyCount > 1) { return true; }
        return false;
    }

    private getCaptured(player: playerid): string[] {
        // Get all captured miners of a player.
        return [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]).filter(c => this.isCaptured(c));
    }

    public move(m: string, { partial = false, trusted = false } = {}): MattockGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        if (m === "pass") {
            this.results = [{type: "pass"}];
            this.lastmove = "pass";
            this.currplayer = this.currplayer % 2 + 1 as playerid;
            this.saveState();
            return this;
        }

        this.results = [];
        if (this.variants.includes("freestyle") &&
                (this.variants.includes("size-5") && this.stack.length < 7 ||
                !this.variants.includes("size-5") && this.stack.length < 13)) {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
        } else {
            const [mine, from, to] = m.split(/\/|-/);
            this.board.set(mine, 3);
            this.results.push({type: "destroy", where: mine});
            if (this.isRevivable(this.currplayer)) {
                this.board.set(mine, this.currplayer);
                this.results.push({type: "place", where: mine});
            }
            if (to !== undefined) {
                this.board.set(from, 3);
                this.board.set(to, this.currplayer);
                this.results.push({type: "move", from, to});
            }
        }
        if (partial) { return this; }
        for (const enemyMiner of this.getCaptured(this.currplayer % 2 + 1 as playerid)) {
            this.board.set(enemyMiner, 3);
            this.results.push({type: "capture", where: enemyMiner});
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.updateMinersToPlace();
        this.checkEOG();
        this.saveState();
        return this;
    }


    protected checkEOG(): MattockGame {
        if (this.moves().length === 0) {
            let prevPlayer: playerid = 1;
            if (this.currplayer === 1) {
                prevPlayer = 2;
            }
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IMattockState {
        return {
            game: MattockGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MattockGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            minersToPlace: [...this.minersToPlace],
        };
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showBlocked = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-blocked") {
                showBlocked = false;
            }
        }
        // Build piece string
        const captured = this.getCaptured(this.currplayer % 2 + 1 as playerid);
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        if (captured.includes(cell)) {
                            pieces.push("C");
                        } else {
                            pieces.push("A")
                        }
                    } else if (owner === 2) {
                        if (captured.includes(cell)) {
                            pieces.push("D");
                        } else {
                            pieces.push("B")
                        }
                    } else if (owner === 3) {
                        pieces.push("-");
                    }
                } else if (showBlocked && ! this.canMine(cell)) {
                    pieces.push("X");
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const emptyCells = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));
        const points: { row: number, col: number }[] = [];
        for (const cell of emptyCells) {
            const [x, y] = this.graph.algebraic2coords(cell);
            points.push({ row: y, col: x });
        }
        const markers: Array<any> = []
        markers.push({ type: "flood", colour: "#444", opacity: 0.6, points });

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
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }],
                C: [{ name: "piece", player: 1 }, { name: "x" }],
                D: [{ name: "piece", player: 2 }, { name: "x" }],
                X: {name: "x", scale: 0.5},
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
                } else if (move.type === "destroy") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = this.graph.algebraic2coords(move.from);
                    const [tx, ty] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx}, {row: ty, col: tx}]});
                } else if (move.type === "capture") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    private updateMinersToPlace(): void {
        const miners1 = [...this.board.entries()].filter(e => e[1] === 1).length;
        const miners2 = [...this.board.entries()].filter(e => e[1] === 2).length;
        if (this.variants.includes("size-5")) {
            this.minersToPlace = [3 - miners1, 3 - miners2];
        } else {
            this.minersToPlace = [6 - miners1, 6 - miners2];
        }
    }

    public getPlayerScore(player: playerid): number {
        return this.minersToPlace[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.TOPLACE"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public status(): string {
        let status = super.status();

        status += "**To Place**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score}\n\n`;
        }

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.mattock", {player, where: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.mattock", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.mattock", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "destroy":
                node.push(i18next.t("apresults:DESTROY.mattock", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): MattockGame {
        return new MattockGame(this.serialize());
    }
}
