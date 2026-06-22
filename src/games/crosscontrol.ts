import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareGraph } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2;
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW"|"N"|"S";
const allDirections: directions[] = ["NE","E","SE","SW","W","NW","N","S"];

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
    komi?: number;
    swapped: boolean;
};

export interface ICrossControlState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CrossControlGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Crosscontrol",
        uid: "crosscontrol",
        playercounts: [2],
        version: "20260613",
        dateAdded: "2026-06-22",
        // i18next.t("apgames:descriptions.crosscontrol")
        description: "apgames:descriptions.crosscontrol",
        urls: ["https://boardgamegeek.com/boardgame/143767/crosscontrol"],
        people: [
            {
                type: "designer",
                name: "Fabius Maximus",
                urls: ["https://boardgamegeek.com/boardgamedesigner/170548/fabius-maximus"]
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
            { // just made small changes to ManaT's Stigmergy code
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "automove", "custom-buttons", "custom-colours"],
        variants: [
            { uid: "size-9",  group: "board" },
            { uid: "#board", }, // 13x13
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
            { uid: "size-25", group: "board" },
            { uid: "nokomi",  group: "komi" }
        ],
        displays: [{uid: "hide-threatened"}, {uid: "hide-influence"}, {uid: "hide-both"}],
    };

    public numplayers = 2;
    public version = CrossControlGame.gameinfo.version;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph?: SquareGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    public komi?: number;
    public swapped = true;
    private boardSize = 0;

    constructor(state?: ICrossControlState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const board: Map<string, playerid> = new Map();
            const fresh: IMoveState = {
                _version: CrossControlGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: [0, 0],
                swapped: this.isKomiRuleActive()
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICrossControlState;
            }
            if (state.game !== CrossControlGame.gameinfo.uid) {
                throw new Error(`The CrossControl engine cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): CrossControlGame {
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
        this.komi = this.isKomiRuleActive() ? state.komi : 0;
        this.swapped = false;
        if (this.isKomiRuleActive()) {
            if (state.swapped === undefined) {
                this.swapped = this.stack.length < 3 || this.stack[2].lastmove !== "play-second";
            } else {
                this.swapped = state.swapped;
            }
        }
        return this;
    }

    private buildGraph(): SquareGraph {
        this.graph = new SquareGraph(this.boardSize, this.boardSize);
        return this.graph;
    }

    private getGraph(boardSize?: number): SquareGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new SquareGraph(boardSize, boardSize);
        }
    }

    private getOtherPlayer(player: playerid): playerid {
        const otherplayer = (player as number) + 1;
        if (otherplayer > this.numplayers) return 1;
        return otherplayer as playerid;
    }

    // Fixes known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) {
                return this.getGraph().listCells();
            } else {
                return this.getGraph().listCells(ordered);
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        return 13;
    }

    private isKomiRuleActive(): boolean {
        return this.variants === undefined || this.variants.length === 0 || !this.variants.includes("nokomi");
    }

    public isKomiTurn(): boolean {
        return this.stack.length === 1;
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    public shouldOfferPie(): boolean {
        return this.isKomiRuleActive();
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        player ??= this.currplayer;
        const otherPlayer = this.getOtherPlayer(player);
        let freeSpaces = false;

        const moves: string[] = [];
        if (this.isKomiRuleActive()) {
            if (this.isKomiTurn()) {
                return moves;
            } else if (this.isPieTurn()) {
                moves.push("play-second");
            }
        }

        for (const cell of this.listCells() as string[]) {
            const cellController = this.cellController(cell);
            if (this.board.has(cell) && this.board.get(cell) === otherPlayer && cellController === player) {
                moves.push(`${cell}x`);
            } else if (!this.board.has(cell) && cellController !== otherPlayer) {
                moves.push(cell);
            }

            if (!freeSpaces && !this.board.has(cell) && cellController === undefined) {
                freeSpaces = true;
            }
        }
        if (!freeSpaces) moves.push("pass");
        return moves;
    }

    // In this game only one button is active at a time.
    public getButtons(): ICustomButton[] {
        if (this.moves().includes("pass")) return [{ label: "pass", move: "pass" }];
        if (this.moves().includes("play-second")) return [{ label: "playsecond", move: "play-second" }];
        return [];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (this.isKomiRuleActive() && this.isKomiTurn()) {
                const dummyResult = this.validateMove("") as IClickResult;
                dummyResult.move = "";
                dummyResult.valid = false;
                return dummyResult;
            }

            const newmove = this.getGraph().coords2algebraic(col, row);
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                if (this.board.has(newmove)) result.move = `${newmove}x`;
                else result.move = newmove;
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
                    if (this.board.get(c)! === player) {
                        losCount++;
                    }
                    break;
                }
            }
        }
        return losCount;
    }

    public validateMove(m: string): IValidationResult {
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m.endsWith('x')) m = m.substring(0, m.length-1);

        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.isKomiRuleActive() && this.isKomiTurn()) {
            if (m.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.crosscontrol.INITIAL_SETUP");
                return result;
            }

            if (! /^-?\d+$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.crosscontrol.INVALIDKOMI");
                return result
            }
            const max = (this.getGraph().listCells() as string[]).length + 1;
            const min = max * -1;
            const komi = parseInt(m, 10);
            if (isNaN(komi) || komi < min || komi > max) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.crosscontrol.INVALIDKOMI");
                return result;
            }
            result.valid = true;
            result.complete = 0;
            result.message = i18next.t("apgames:validation.crosscontrol.INITIAL_SETUP");
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.isKomiRuleActive() && this.isPieTurn()) {
                result.message = i18next.t("apgames:validation.crosscontrol.KOMI_CHOICE");
            } else
                result.message = i18next.t("apgames:validation.crosscontrol.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "play-second") {
            if (this.isKomiRuleActive() && this.isPieTurn()) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.crosscontrol.INVALIDPLAYSECOND");
                return result;
            }
        }

        if (m === "pass") {
            if (this.moves().includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.crosscontrol.INVALIDPASS");
                return result;
            }
        }

        // valid cell
        if (!(this.getGraph().listCells() as string[]).includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }

        if (this.board.has(m) && this.board.get(m) === this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.crosscontrol.INITIAL_INSTRUCTIONS");
            return result;
        }

        const otherPlayer = this.getOtherPlayer(this.currplayer);
        const cellController = this.cellController(m);
        if (this.board.has(m) && this.board.get(m) === otherPlayer && cellController !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.crosscontrol.INSUFFICIENT_LOS", {cell: m});
            return result;
        }

        if (!this.board.has(m) && cellController === otherPlayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.crosscontrol.OPPONENT_CONTROL", {cell: m});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): CrossControlGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) return this;

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        let originalMove = m;
        if (m.endsWith('x')) m = m.substring(0, m.length-1);

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            const moves = this.moves();
            if (!partial && !(this.isKomiRuleActive() && this.isKomiTurn()) && !(moves.includes(m) || moves.includes(`${m}x`))) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: originalMove}));
            }
        }

        this.results = [];
        if (this.isKomiRuleActive() && this.isKomiTurn()) {
            this.komi = parseInt(m, 10);
            const max = (this.getGraph().listCells() as string[]).length + 1;
            const min = max * -1;
            if (this.komi > max) this.komi = max;
            if (this.komi < min) this.komi = min;
            this.results.push({type: "komi", value: this.komi});
            // Invert it for backwards compatibility reasons
            this.komi *= -1;
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        } else if (m === "play-second") {
            this.komi! *= -1;
            this.swapped = false;
            this.results.push({type: "play-second"});
        } else {
            if (this.board.has(m)) {
                if (!originalMove.endsWith('x')) originalMove = `${originalMove}x`;
                this.results.push({type: "capture", where: m});
            } else {
                this.results.push({type: "place", where: m});
            }
            this.board.set(m, this.currplayer);
        }

        this.lastmove = originalMove;
        this.currplayer = this.getOtherPlayer(this.currplayer);
        this.updateScores();
        this.checkEOG();
        this.saveState();
        return this;
    }

    private cellController(cell: string): playerid | undefined {
        const player1Los = this.getLosCount(cell, 1);
        const player2Los = this.getLosCount(cell, 2);
        return player1Los > player2Los ? 1 : player2Los > player1Los ? 2 : undefined;
    }

    private cellOwner(cell: string): playerid | undefined {
        if (this.board.has(cell)) return this.board.get(cell);
        return this.cellController(cell);
    }

    // Updates `this.scores` with total influence for each player.
    private updateScores(): void {
        this.scores = [0, 0];
        for (const cell of this.listCells() as string[]) {
            const owner = this.cellOwner(cell);
            if (owner !== undefined) {
                this.scores[owner - 1]++;
            }
        }
    }

    protected checkEOG(): CrossControlGame {
        if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass") {
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
        return this.scores[player - 1]
            + ((player === 2 && this.komi !== undefined && this.komi > 0) ? this.komi : 0)
            + ((player === 1 && this.komi !== undefined && this.komi < 0) ? -this.komi : 0);
    }

    public sidebarScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public state(): ICrossControlState {
        return {
            game: CrossControlGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CrossControlGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            komi: this.komi,
            swapped: this.swapped
        };
    }

    public getPlayerColour(player: playerid): number | string {
        return (player == 1 && !this.swapped) || (player == 2 && this.swapped) ? 1 : 2;
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

        let pstr = "";
        const legendNames: Set<string> = new Set();
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;
                    let key;
                    if (player === 1) {
                        key = "A";
                    } else {
                        key = "B";
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

        const legend: ILegendObj = {};
        for (const piece of legendNames) {
            const player = piece === "A" ? this.getPlayerColour(1) : this.getPlayerColour(2);
            legend[piece] = [
                { name: "piece", colour: player }
            ];
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let markers: Array<any> | undefined = []
        let points1: {row: number, col: number}[] = [];
        let points2: {row: number, col: number}[] = [];

        if (showInfluence) {
            const points = this.influenceMarkers();
            points1 = points.get(1)!;
            points2 = points.get(2)!;

            if (points1.length > 0) {
                markers.push({ type: "flood", colour: this.getPlayerColour(1), opacity: 0.2, points: points1 });
            }

            if (points2.length > 0) {
                markers.push({ type: "flood", colour: this.getPlayerColour(2), opacity: 0.2, points: points2 });
            }
        }

        if (showThreatened) {
            const points = this.threatenedMarkers();
            points1 = points.get(1)!;
            points2 = points.get(2)!;

            if (points1.length > 0) {
                markers.push({ type: "flood", colour: this.getPlayerColour(1), opacity: 0.2, points: points1 });
            }

            if (points2.length > 0) {
                markers.push({ type: "flood", colour: this.getPlayerColour(2), opacity: 0.2, points: points2 });
            }
        }

        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend,
            pieces: pstr,
        };

        rep.annotations = [];
        for (const move of this.stack[this.stack.length - 1]._results) {
            if (move.type === "place" || move.type === "capture") {
                const [x, y] = this.getGraph().algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
            }
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    private influenceMarkers(): Map<playerid, {row: number, col: number}[]> {
        const markers = new Map<playerid, {row: number, col: number}[]>([[1, []], [2, []]]);
        for (const cell of this.listCells() as string[]) {
            if (!this.board.has(cell)) {
                const cellController = this.cellController(cell);
                if (cellController === undefined) continue;
                const [x, y] = this.getGraph().algebraic2coords(cell);
                const cellCoords = {row: y, col: x};
                if (cellController === 1) {
                    markers.get(1)!.push(cellCoords);
                } else {
                    markers.get(2)!.push(cellCoords);
                }
            }
        }
        return markers;
    }

    private threatenedMarkers(): Map<playerid, {row: number, col: number}[]> {
        const markers = new Map<playerid, {row: number, col: number}[]>([[1, []], [2, []]]);
        for (const cell of this.listCells() as string[]) {
            if (this.board.has(cell)) {
                const otherPlayer = this.getOtherPlayer(this.board.get(cell)!);
                if (this.cellController(cell) === otherPlayer) {
                    const [x, y] = this.getGraph().algebraic2coords(cell);
                    const cellCoords = {row: y, col: x};
                    markers.get(otherPlayer)!.push(cellCoords);
                }
            }
        }
        return markers;
    }

    public clone(): CrossControlGame {
        return new CrossControlGame(this.serialize());
    }
}
