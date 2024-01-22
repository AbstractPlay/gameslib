/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { hexhexAi2Ap, hexhexAp2Ai, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2|3;  // 3 is used for neutral player.
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

interface ILooseObj {
    [key: string]: any;
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
        // i18next.t("apgames:descriptions.tumbleweed")
        description: "apgames:descriptions.tumbleweed",
        urls: ["https://boardgamegeek.com/boardgame/318702/tumbleweed"],
        people: [
            {
                type: "designer",
                name: "Mike Zapawa",
            }
        ],
        flags: ["pie-even", "multistep", "scores", "aiai"],
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
    public graph: HexTriGraph;
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
        this.load();
        this.graph = this.getGraph();
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
        this.boardSize = this.getBoardSize();
        this.scores = [...state.scores];
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
        return 8;
    }

    private getCentre(boardSize?: number): string {
        if (boardSize === undefined) {
            boardSize = this.boardSize;
        }
        const graph = this.graph !== undefined ? this.graph : this.getGraph(boardSize);
        return graph.coords2algebraic(boardSize - 1, boardSize - 1);
    }

    private getGraph(boardSize?: number): HexTriGraph {
        if (boardSize === undefined) {
            boardSize = this.boardSize;
        }
        return new HexTriGraph(boardSize, boardSize * 2 - 1);
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
            for (const cell of this.graph.listCells() as string[]) {
                for (const cell2 of this.graph.listCells() as string[]) {
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
        for (const cell of this.graph.listCells() as string[]) {
            const losCount = this.getLosCount(cell, player);
            if (losCount === 0 || this.board.has(cell) && this.board.get(cell)![1] >= losCount) {
                continue;
            }
            moves.push(cell);
        }
        moves.push("pass");
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
            const cell = this.graph.coords2algebraic(col, row);
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
            const ray = this.graph.ray(...this.graph.algebraic2coords(cell), dir).map(c => this.graph.coords2algebraic(c[0], c[1]));
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
            if (this.board.size < 3) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS_SETUP");
                return result;
            } else if (this.board.size === 3 && this.currplayer === 2) {
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
                this.graph.algebraic2coords(move);
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
                    result.message = i18next.t("apgames:validation.tumbleweed.SAMECELL", {cell: moves[0]});
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
        for (const cell of this.graph.listCells() as string[]) {
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
        if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" && this.stack.length > 3) {
            this.gameover = true;
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
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

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
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
        for (const row of this.graph.listCells(true)) {
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
        const legend: ILooseObj = {};
        for (const name of legendNames) {
            const [piece, ...size] = name;
            const player = piece === "A" || piece === "C" ? 1 : piece === "B" || piece === "D" ? 2 : 3;
            const sizeStr = size.join("");
            if (piece === "A" || piece === "B" || piece === "E") {
                legend[name] = [
                    { name: "piece", player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else if (piece === "C" || piece === "D") {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, player: player % 2 + 1 },
                    { name: "piece", player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else if (piece === "F") {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, player: 1, opacity: 0.7 },
                    { name: "piece", player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else if (piece === "G") {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, player: 2, opacity: 0.7 },
                    { name: "piece", player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            } else /* if (piece === "H") */ {
                legend[name] = [
                    { name: "piece-borderless", scale: 1.1, player: 1, opacity: 0.7 },
                    { name: "piece-borderless", scale: 1.1, player: 2, opacity: 0.7 },
                    { name: "piece", player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            }
        }

        let points1: {row: number, col: number}[] = [];
        let points2: {row: number, col: number}[] = [];
        if (showInfluence || this.gameover) {
            const points = this.influenceMarkers();
            points1 = points.get(1)!;
            points2 = points.get(2)!;
        }
        let markers: Array<any> | undefined = []
        if (points1.length > 0) {
            // @ts-ignore
            markers.push({ type: "flood", colour: 1, opacity: 0.2, points: points1 });
        }
        if (points2.length > 0) {
            // @ts-ignore
            markers.push({ type: "flood", colour: 2, opacity: 0.2, points: points2 });
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
                // @ts-ignore
                markers,
            },
            legend,
            pieces: pstr,
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

    private influenceMarkers(): Map<playerid, {row: number, col: number}[]> {
        // Get cells that are occupied by each player or have equal or greater LOS by each player.
        // Unoccupied cells with equal LOS will be in both groups.
        const markers = new Map<playerid, {row: number, col: number}[]>([
            [1, []],
            [2, []],
        ]);
        for (const cell of this.graph.listCells() as string[]) {
            if (this.board.has(cell)) {
                const [player, ] = this.board.get(cell)!;
                if (player === 3) { continue; }
                const [x, y] = this.graph.algebraic2coords(cell);
                const cellCoords = {row: y, col: x};
                markers.get(player)!.push(cellCoords);
            } else {
                const player1Los = this.getLosCount(cell, 1);
                const player2Los = this.getLosCount(cell, 2);
                if (player1Los === 0 && player2Los === 0) { continue; }
                const [x, y] = this.graph.algebraic2coords(cell);
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
        for (const cell of this.graph.listCells() as string[]) {
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
                                node.push(i18next.t("apresults:EOG"));
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
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
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
