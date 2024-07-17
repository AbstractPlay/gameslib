/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { hexhexAi2Ap, hexhexAp2Ai, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2|3;  // 3 is used for neutral player.
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, number]>;
    lastmove?: string;
    scores: [number, number];
};

export interface ITumbleweedState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TumbleweedGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Tumbleweed",
        uid: "tumbleweed",
        playercounts: [2],
        version: "20231229",
        dateAdded: "2024-01-03",
        // i18next.t("apgames:descriptions.tumbleweed")
        description: "apgames:descriptions.tumbleweed",
        // i18next.t("apgames:notes.tumbleweed")
        notes: "apgames:notes.tumbleweed",
        urls: ["https://boardgamegeek.com/boardgame/318702/tumbleweed"],
        people: [
            {
                type: "designer",
                name: "Mike Zapawa",
                urls: ["https://boardgamegeek.com/boardgamedesigner/126470/mike-zapawa"],
            }
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>3c"],
        flags: ["pie-even", "scores", "aiai"],
        variants: [
            {
                uid: "size-6",
                group: "board",
            },
            {
                uid: "size-10",
                group: "board",
            }
        ],
        displays: [{uid: "hide-threatened"}, {uid: "hide-influence"}, {uid: "hide-both"}],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, [playerid, number]>;
    public graph?: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    private boardSize = 0;

    constructor(state?: ITumbleweedState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const boardSize = this.getBoardSize();
            const board: Map<string, [playerid, number]> = new Map();
            board.set(this.getCentre(boardSize), [3 as playerid, 2]);
            const fresh: IMoveState = {
                _version: TumbleweedGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: [0, 0]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITumbleweedState;
            }
            if (state.game !== TumbleweedGame.gameinfo.uid) {
                throw new Error(`The Tumbleweed engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.boardSize = this.getBoardSize();
        this.load();
        this.buildGraph();
    }

    public load(idx = -1): TumbleweedGame {
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
        this.scores = [...state.scores];
        return this;
    }

    private buildGraph(): HexTriGraph {
        this.graph = new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
        return this.graph;
    }

    private getGraph(boardSize?: number): HexTriGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new HexTriGraph(boardSize, (boardSize * 2) - 1);
        }
    }

    // Fixes known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) {
                return this.getGraph().listCells();
            } else {
                return this.getGraph().listCells(ordered);
            }
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
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
        return 8;
    }

    private getCentre(boardSize?: number): string {
        if (boardSize === undefined) {
            return this.getGraph().coords2algebraic(this.boardSize - 1, this.boardSize - 1);
        } else {
            return this.getGraph(boardSize).coords2algebraic(boardSize - 1, boardSize - 1);
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        if (this.board.size < 3) {
            // On first move, first player places two stones.
            const centre = this.getCentre();
            for (const cell of this.listCells() as string[]) {
                for (const cell2 of this.listCells() as string[]) {
                    if (cell === cell2 || cell === centre || cell2 === centre) {
                        continue;
                    }
                    moves.push(`${cell},${cell2}`);
                }
            }
            return moves;
        } else if (this.board.size === 3 && player === 2) {
            return ["pass"];
        }
        for (const cell of this.listCells() as string[]) {
            const losCount = this.getLosCount(cell, player);
            if (losCount === 0 || this.board.has(cell) && this.board.get(cell)![1] >= losCount) {
                continue;
            }
            moves.push(cell);
        }
        // forbidding pass on ply 3 because it's almost never wanted
        // https://discord.com/channels/526483743180062720/1204190463234412594
        if (this.stack.length !== 3) {
            moves.push("pass");
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
            const split = move.split(",");
            const cell = this.getGraph().coords2algebraic(col, row);
            if (this.board.size < 3) {
                if (split.length === 1 && split[0] !== "") {
                    newmove = `${move},${cell}`;
                } else if (split.length === 2) {
                    newmove = move;
                } else {
                    newmove = cell;
                }
            } else {
                newmove = cell;
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

    private getLosCount(cell: string, player: playerid): number {
        let losCount = 0;
        for (const dir of allDirections) {
            const ray = this.getGraph().ray(...this.getGraph().algebraic2coords(cell), dir).map(c => this.getGraph().coords2algebraic(c[0], c[1]));
            for (const c of ray) {
                if (this.board.has(c)) {
                    if (this.board.get(c)![0] === player) {
                        losCount++;
                    }
                    break;
                }
            }
        }
        return losCount;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            if (this.stack.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS_SETUP");
                return result;
            } else if (this.stack.length === 2) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS_PASS");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS");
            return result;
        }
        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        if (this.board.size === 3 && this.currplayer === 2) {
            if (m !== "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.SECOND_PLAYER_PASS");
                return result;
            }
        }

        const moves = m.split(",");
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tumbleweed.TOOMANYMOVES", {cell: moves[2]});
            return result;
        }
        // valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                this.getGraph().algebraic2coords(move);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        // Special case where first player places two stones.
        if (this.board.size < 3) {
            const centre = this.getCentre();
            if (moves[0] === centre) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tumbleweed.NO_CENTRE", {cell: moves[0]});
                    return result;
            }
            if (moves.length === 2) {
                if (moves[0] === moves[1]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tumbleweed.SAME_CELL", {cell: moves[0]});
                    return result;
                }
                if (moves[1] === centre) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tumbleweed.NO_CENTRE", {cell: moves[1]});
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.tumbleweed.ONE_MORE");
            return result;
        }

        const losCount = this.getLosCount(m, this.currplayer);
        if (losCount === 0 || this.board.has(m) && this.board.get(m)![1] >= losCount) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tumbleweed.INSUFFICIENT_LOS", {cell: m});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): TumbleweedGame {
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

        if (this.board.size < 3) {
            const moves = m.split(",");
            if (moves.length !== 2) {
                // Partial.
                this.board.set(moves[0], [this.currplayer, 1]);
                this.results.push({type: "place", who: 1, where: moves[0], count: 1});
                this.updateScores();
                return this;
            }
            this.board.set(moves[0], [this.currplayer, 1]);
            this.board.set(moves[1], [(this.currplayer % 2) + 1 as playerid, 1]);
            this.results.push({type: "place", who: 1, where: moves[0], count: 1}, {type: "place", who: 2, where: moves[1], count: 1});
        } else {
            this.results = [];
            if (m === "pass") {
                this.results.push({type: "pass"});
            } else {
                const losCount = this.getLosCount(m, this.currplayer);
                this.results.push({type: "place", where: m, count: losCount});
                if (this.board.has(m)) {
                    const [player, size] = this.board.get(m)!;
                    this.results.push({type: "capture", where: m, count: size, whose: player});
                }
                this.board.set(m, [this.currplayer, losCount]);
            }
        }
        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.updateScores();
        this.checkEOG();
        this.saveState();
        return this;
    }

    private cellOwner(cell: string): playerid | undefined {
        // A cell is owned by a player if they have a stack on it
        // or if they have the highest LOS to it.
        if (this.board.has(cell)) {
            const [player, ] = this.board.get(cell)!;
            if (player === 3) { return undefined; }
            return player;
        }
        const player1Los = this.getLosCount(cell, 1);
        const player2Los = this.getLosCount(cell, 2);
        if (player1Los > player2Los) {
            return 1;
        } else if (player2Los > player1Los) {
            return 2;
        }
        return undefined;
    }

    private updateScores(): void {
        // Updates `this.scores` with total influence for each player.
        this.scores = [0, 0];
        for (const cell of this.listCells() as string[]) {
            const owner = this.cellOwner(cell);
            if (owner !== undefined) {
                this.scores[owner - 1]++;
            }
        }
    }

    private pieceCount(player: playerid): number {
        // Get number of piece on board for `player`.
        return [...this.board.values()].filter(v => v[0] === player).length;
    }

    protected checkEOG(): TumbleweedGame {
        // Making it impossible to end the game by passing before four plys have been played (stack length 5, was 3)
        // https://discord.com/channels/526483743180062720/1204190463234412594
        if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" && this.stack.length >= 5) {
            this.gameover = true;
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
        }
        // If there are no score changes for both players for `plyCount` plys, the game is over.
        const plyCount = 20;
        if (this.stack.length > plyCount) {
            const lastPlies = this.stack.slice(this.stack.length - plyCount).map(s => s.scores);
            if (lastPlies.every(s => s[0] === lastPlies[0][0]) && lastPlies.every(s => s[1] === lastPlies[0][1])) {
                this.gameover = true;
                const p1Score = this.getPlayerScore(1);
                const p2Score = this.getPlayerScore(2);
                this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
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

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public state(): ITumbleweedState {
        return {
            game: TumbleweedGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TumbleweedGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showThreatened = true;
        let showInfluence = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-threatened") {
                showThreatened = false;
            } else if (altDisplay === "hide-influence") {
                showInfluence = false;
            } else if (altDisplay === "hide-both") {
                showThreatened = false;
                showInfluence = false;
            }
        }
        // Build piece string
        const legendNames: Set<string> = new Set();
        // A - player1 normal
        // B - player2 normal
        // C - player1 threatened
        // D - player2 threatened
        // E - neutral
        // F - neutral threatened by player1
        // G - neutral threatened by player2
        // H - neutral threatened by both
        let pstr = "";
        const threatenedPieces: Set<string> = showThreatened ? this.threatenedPieces() : new Set();
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    let key;
                    if (player === 1) {
                        if (threatenedPieces.has(cell)) {
                            key = `C${size.toString()}`;
                        } else {
                            key = `A${size.toString()}`;
                        }
                    } else if (player === 2) {
                        if (threatenedPieces.has(cell)) {
                            key = `D${size.toString()}`;
                        } else {
                            key = `B${size.toString()}`;
                        }
                    } else {
                        if (showThreatened) {
                            const player1Los = this.getLosCount(cell, 1);
                            const player2Los = this.getLosCount(cell, 2);
                            if (player1Los > player2Los && player1Los > size) {
                                key = `F${size.toString()}`;
                            } else if (player2Los > player1Los && player2Los > size) {
                                key = `G${size.toString()}`;
                            } else if (player1Los === player2Los && player1Los > size) {
                                key = `H${size.toString()}`;
                            } else {
                                key = `E${size.toString()}`;
                            }
                        } else {
                            key = `E${size.toString()}`;
                        }
                    }
                    legendNames.add(key);
                    pieces.push(key);
                } else {
                    pieces.push("-");
                }

            }
            // If all elements are "-", replace with "_"
            if (pieces.every(p => p === "-")) {
                pieces = ["_"];
            }
            pstr += pieces.join(",");
        }

        // build legend based on stack sizes
        const legend: ILegendObj = {};
        for (const name of legendNames) {
            const [piece, ...size] = name;
            const player = piece === "A" || piece === "C" ? 1 : piece === "B" || piece === "D" ? 2 : 3;
            const sizeStr = size.join("");
            if (piece === "A" || piece === "B" || piece === "E") {
                legend[name] = [
                    { name: "piece", colour: player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else if (piece === "C" || piece === "D") {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, colour: player % 2 + 1 },
                    { name: "piece", colour: player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else if (piece === "F") {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, colour: 1 },
                    { name: "piece", colour: player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else if (piece === "G") {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, colour: 2 },
                    { name: "piece", colour: player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else /* if (piece === "H") */ {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, colour: 1 },
                    { name: "piece-borderless", scale: 1.1, colour: 2 },
                    { name: "piece", colour: player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            }
        }

        let points1: {row: number, col: number}[] = [];
        let points2: {row: number, col: number}[] = [];
        if (showInfluence) {
            const points = this.influenceMarkers();
            points1 = points.get(1)!;
            points2 = points.get(2)!;
        }
        let markers: Array<any> | undefined = []
        if (points1.length > 0) {
            markers.push({ type: "flood", colour: 1, opacity: 0.2, points: points1 as [RowCol, ...RowCol[]] });
        }
        if (points2.length > 0) {
            markers.push({ type: "flood", colour: 2, opacity: 0.2, points: points2 as [RowCol, ...RowCol[]] });
        }
        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                markers,
            },
            legend,
            pieces: pstr,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.getGraph().algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    private influenceMarkers(): Map<playerid, {row: number, col: number}[]> {
        // Get cells that are occupied by each player or have equal or greater LOS by each player.
        // Unoccupied cells with equal LOS will be in both groups.
        const markers = new Map<playerid, {row: number, col: number}[]>([
            [1, []],
            [2, []],
        ]);
        for (const cell of this.listCells() as string[]) {
            if (this.board.has(cell)) {
                const [player, ] = this.board.get(cell)!;
                if (player === 3) { continue; }
                const [x, y] = this.getGraph().algebraic2coords(cell);
                const cellCoords = {row: y, col: x};
                markers.get(player)!.push(cellCoords);
            } else {
                const player1Los = this.getLosCount(cell, 1);
                const player2Los = this.getLosCount(cell, 2);
                if (player1Los === 0 && player2Los === 0) { continue; }
                const [x, y] = this.getGraph().algebraic2coords(cell);
                const cellCoords = {row: y, col: x};
                if (player1Los >= player2Los) {
                    markers.get(1)!.push(cellCoords);
                }
                if (player2Los >= player1Los) {
                    markers.get(2)!.push(cellCoords);
                }
            }
        }
        return markers;
    }

    private threatenedPieces(): Set<string> {
        // A piece is threatened if it can be captured by the other player,
        // and it cannot be captured back.
        const threatenedPieces = new Set<string>();
        for (const cell of this.listCells() as string[]) {
            if (this.board.has(cell)) {
                const [player, size] = this.board.get(cell)!;
                const otherPlayer = player === 1 ? 2 : 1;
                const losCount = this.getLosCount(cell, player);
                const otherPlayerLosCount = this.getLosCount(cell, otherPlayer);
                if (otherPlayerLosCount >= losCount && otherPlayerLosCount > size) {
                    threatenedPieces.add(cell);
                }
            }
        }
        return threatenedPieces
    }

    public chatLog(players: string[]): string[][] {
        // Use `chatLog` to determine if capture is self-capture.
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "place":
                                node.push(i18next.t("apresults:PLACE.tumbleweed", {player: name, where: r.where, count: r.count}));
                                break;
                            case "capture":
                                // Check if capture is self-capture.
                                const str = r.whose === otherPlayer ? "apresults:CAPTURE.tumbleweed_self" : "apresults:CAPTURE.tumbleweed";
                                node.push(i18next.t(str, {player: name, where: r.where, count: r.count}));
                                break;
                            case "pass":
                                node.push(i18next.t("apresults:PASS.simple", {player: name}));
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
                            case "timeout":
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:TIMEOUT", {player: tname}));
                                break;
                            case "gameabandoned":
                                node.push(i18next.t("apresults:ABANDONED"));
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

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            const pieces = this.pieceCount(n as playerid);
            const influence = score - pieces;
            status += `Player ${n}: ${pieces} + ${influence} = ${score}\n\n`;
        }

        return status;
    }

    public clone(): TumbleweedGame {
        return new TumbleweedGame(this.serialize());
    }

    public state2aiai(): string[] {
        let width = 8;
        if (this.variants.includes("size-6")) {
            width = 6;
        } else if (this.variants.includes("size-10")) {
            width = 10;
        }
        const moves = this.moveHistory();
        const lst: string[] = [];
        for (let i = 0; i < moves.length; i++) {
            const round = moves[i];
            for (const move of round) {
                // special notation for first turn
                // doesn't matter which special you choose (black or white)
                if ((i === 0) && (move === "pass")) {
                    lst.push("Play White (first)")
                }
                // all other passes
                else if (move === "pass") {
                    lst.push("Pass");
                }
                // regular placements
                else {
                    const cells: string[] = move.split(",");
                    for (const cell of cells) {
                        lst.push(hexhexAp2Ai(cell, width))
                    }
                }
            }
        }
        return lst;
    }

    public translateAiai(move: string): string {
        let width = 8;
        if (this.variants.includes("size-6")) {
            width = 6;
        } else if (this.variants.includes("size-10")) {
            width = 10;
        }

        if (move === "Play White (first)") {
            return "Swap";
        } else if (move === "Play Black (second)") {
            return "pass";
        } else if (move === "Pass") {
            return "pass";
        } else {
            const cells = move.split("|");
            const translated = cells.map(cell => hexhexAi2Ap(cell, width));
            return translated.join(",");
        }
    }

    public aiaiMgl(): string {
        let mgl = "tumbleweed";
        if (this.variants.includes("size-6")) {
            mgl = "tumbleweed-6";
        } else if (this.variants.includes("size-10")) {
            mgl = "tumbleweed-10";
        }
        return mgl;
    }

}
