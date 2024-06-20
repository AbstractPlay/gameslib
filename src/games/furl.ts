/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { hexhexAi2Ap, hexhexAp2Ai, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2;
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW"
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

interface ILooseObj {
    [key: string]: any;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, number]>;
    lastmove?: string;
};

export interface IFurlState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FurlGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Furl",
        uid: "furl",
        playercounts: [2],
        // version: "20231229",
        version: "20240309",
        dateAdded: "2023-12-29",
        // i18next.t("apgames:descriptions.furl")
        description: "apgames:descriptions.furl",
        urls: ["https://boardgamegeek.com/boardgame/325422/furl"],
        people: [
            {
                type: "designer",
                name: "Stephen Tavener",
                urls: ["http://www.mrraow.com"]
            }
        ],
        categories: ["goal>breakthrough", "mechanic>capture", "mechanic>stack", "mechanic>move>sow", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["multistep", "check", "perspective", "aiai", "limited-pieces"],
        variants: [
            // { uid: "size-5", group: "board" },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, [playerid, number]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private graph: HexTriGraph;
    private _points: [number, number][] = [];

    constructor(state?: IFurlState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const boardSize = this.getBoardSize();
            const graph = this.getGraph(boardSize);
            const board: Map<string, [playerid, number]> = new Map();
            for (let i = 0; i < boardSize - 1; i++) {
                for (let j = 0; j < boardSize + i; j++) {
                    board.set(graph.coords2algebraic(j, boardSize * 2 - 2 - i), [1 as playerid, 1]);
                    board.set(graph.coords2algebraic(j, i), [2 as playerid, 1]);
                }
            }
            const fresh: IMoveState = {
                _version: FurlGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFurlState;
            }
            if (state.game !== FurlGame.gameinfo.uid) {
                throw new Error(`The Furl engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = this.getGraph(this.boardSize)
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
        return 4;
    }

    public load(idx = -1): FurlGame {
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
        return this;
    }

    private getGraph(boardSize: number): HexTriGraph {
        return new HexTriGraph(boardSize, boardSize * 2 - 1);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        for (const cell of this.graph.listCells(false) as string[]) {
            if (!this.board.has(cell)) { continue; }
            const [checkPlayer, size] = this.board.get(cell)!;
            if (checkPlayer !== player) { continue; }
            if (size === 1) {
                const tos = this.getFurls(cell);
                for (const to of tos) {
                    moves.push(`${cell}<${to}`);
                }
            } else {
                const tos = this.getUnfurls(cell);
                for (const to of tos) {
                    if (this.board.has(to)) {
                        moves.push(`${cell}x${to}`);
                    } else {
                        moves.push(`${cell}>${to}`);
                    }
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
            if (move === "") {
                newmove = cell;
            } else {
                const [, size] = this.board.get(move)!;
                if (size === 1) {
                    if (this.getFurls(move).includes(cell)) {
                        newmove = `${move}<${cell}`;
                    } else if (this.board.has(cell) && this.board.get(cell)![0] === this.currplayer) {
                        newmove = cell;
                    } else {
                        // Let validation deal with it.
                        newmove = `${move}<${cell}`;
                    }
                } else {
                    if (this.getUnfurls(move).includes(cell)) {
                        if (this.board.has(cell)) {
                            newmove = `${move}x${cell}`;
                        } else {
                            newmove = `${move}>${cell}`;
                        }
                    } else if (this.board.has(cell) && this.board.get(cell)![0] === this.currplayer) {
                        newmove = cell;
                    } else {
                        // Let validation deal with it.
                        newmove = `${move}>${cell}`;
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
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.furl.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [from, to] = m.split(/[><x]/);

        // valid cell
        let tryCell;
        try {
            for (const cell of [from, to]) {
                if (cell === undefined) {
                    continue;
                }
                tryCell = cell;
                this.graph.algebraic2coords(tryCell)
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: tryCell})
            return result;
        }

        // from check
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from})
            return result;
        }
        if (this.board.get(from)![0] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED")
            return result;
        }
        const [, size] = this.board.get(from)!;
        if (to === undefined) {
            if (size === 1) {
                const furls = this.getFurls(from);
                if (furls.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.furl.NO_FURLS", {from});
                    return result;
                }
            } else {
                const unfurls = this.getUnfurls(from);
                if (unfurls.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.furl.NO_UNFURLS", {from});
                    return result;
                }
            }
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = size === 1 ? i18next.t("apgames:validation.furl.PARTIAL_FURL") : i18next.t("apgames:validation.furl.PARTIAL_UNFURL");
                return result;
            }
        if (size === 1) {
            if (m.includes(">") || m.includes("x")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.furl.UNFURL4FURL")
                return result;
            }
            const furls = this.getFurls(from);
            if (!furls.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.furl.INVALID_FURL", {from, to})
                return result;
            }
        } else {
            if (m.includes("<")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.furl.FURL4UNFURL", {size})
                return result;
            }
            const unfurls = this.getUnfurls(from);
            if (!unfurls.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.furl.INVALID_UNFURL", {from, to, size})
                return result;
            }
            if (!this.board.has(to)) {
                if (m.includes("x")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.furl.CAPTURE4UNFURL", {from, to})
                    return result;
                }
            } else {
                if (m.includes(">")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.furl.UNFURL4CAPTURE", {from, to})
                    return result;
                }
            }
        }
        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    private getFurls(cell: string): string[] {
        if (!this.board.has(cell)) { throw new Error(`Cell ${cell} is empty.`); }
        const [player, size] = this.board.get(cell)!;
        const furls: string[] = [];
        if (size > 1) { throw new Error(`Cell ${cell} has size greater than 1.`); }
        for (const direction of allDirections) {
            const ray = this.graph.ray(...this.graph.algebraic2coords(cell), direction);
            for (const [i, checkCell] of ray.map(c => this.graph.coords2algebraic(...c)).entries()) {
                if (!this.board.has(checkCell)) { break; }
                const [checkPlayer, checkSize] = this.board.get(checkCell)!;
                if (checkPlayer !== player || checkSize > 1) { break; }
                if (checkSize === 1) {
                    const newCell = this.moveHex(...this.graph.algebraic2coords(cell), direction, i + 1)!;
                    furls.push(this.graph.coords2algebraic(...newCell));
                }
            }
        }
        return furls;
    }

    private getUnfurls(cell: string): string[] {
        if (!this.board.has(cell)) { throw new Error(`Cell ${cell} is empty.`); }
        const [player, size] = this.board.get(cell)!;
        if (size === 1) { throw new Error(`Cell ${cell} has size 1.`); }
        const unfurls: string[] = [];
        for (const direction of allDirections) {
            const ray = this.graph.ray(...this.graph.algebraic2coords(cell), direction);
            if (ray.length < size) { continue; }
            let unfurlable = true;
            for (const [i, checkCell] of ray.map(c => this.graph.coords2algebraic(...c)).entries()) {
                if (i === size) { break; }
                if (i === size - 1) {
                    // Landing piece can be empty or opponent's piece.
                    if (this.board.has(checkCell)) {
                        const [checkPlayer,] = this.board.get(checkCell)!;
                        if (checkPlayer === player) { unfurlable = false; break; }
                    }
                } else {
                    if (this.board.has(checkCell)) { unfurlable = false; break; }
                }

            }
            if (unfurlable) {
                const newCell = this.moveHex(...this.graph.algebraic2coords(cell), direction, size)!;
                unfurls.push(this.graph.coords2algebraic(...newCell));
            }
        }
        return unfurls;
    }

    private getDirectionDistance(from: string, to: string): [directions, number] | undefined {
        // Get direction from `from` to `to`.
        // If `to` is not in the same ray as `from`, return undefined.
        if (from === to) {
            throw new Error(`Cannot get direction from ${from} to itself.`);
        }
        const [fx, fy] = this.graph.algebraic2coords(from);
        const [tx, ty] = this.graph.algebraic2coords(to);
        for (const direction of allDirections) {
            const ray = this.graph.ray(fx, fy, direction);
            for (const [i, cell] of ray.entries()) {
                if (cell[0] === tx && cell[1] === ty) {
                    return [direction, i + 1];
                }
            }
        }
        return undefined;
    }

    private moveHex(x: number, y: number, dir: directions, dist = 1): [number, number] | undefined {
        // Because `HexTriGraph.move` does not work properly when `dist > 1` at the moment.
        const ray = this.graph.ray(x, y, dir);
        if (ray.length >= dist) {
            return ray[dist - 1];
        }
        return undefined;
    }

    public move(m: string, {partial = false, trusted = false} = {}): FurlGame {
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

        const [from, to] = m.split(/[><x]/);

        if (partial || to === undefined) {
            const [, size] = this.board.get(from)!;
            if (size > 1) {
                this._points = this.getUnfurls(from).map(c => this.graph.algebraic2coords(c));
            } else {
                this._points = this.getFurls(from).map(c => this.graph.algebraic2coords(c));
            }
            return this;
        } else {
            this._points = [];
        }

        this.results = [];
        this.board.delete(from);
        if (m.includes("<")) {
            const [direction, distance] = this.getDirectionDistance(from, to)!;
            for (let i = 1; i <= distance; i++) {
                const movedCell = this.graph.coords2algebraic(...this.moveHex(...this.graph.algebraic2coords(from), direction, i)!);
                if (i < distance) {
                    this.board.delete(movedCell);
                } else {
                    this.board.set(movedCell, [this.currplayer, distance + 1]);
                }
            }
            this.results.push({type: "furl", from, to, count: distance + 1});
        } else {
            const [direction, distance] = this.getDirectionDistance(from, to)!;
            for (let i = 1; i <= distance; i++) {
                const movedCell = this.graph.coords2algebraic(...this.moveHex(...this.graph.algebraic2coords(from), direction, i)!);
                this.board.set(movedCell, [this.currplayer, 1]);
            }
            this.results.push({type: "unfurl", from, to, count: distance});
            if (m.includes("x")) {
                const [, size] = this.board.get(to)!;
                this.results.push({type: "capture", count: size, where: to});
            }
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

    private checkWinFor(player: playerid): boolean {
        const checkRow = player === 1 ? 0 : this.boardSize * 2 - 2;
        for (let i = 0; i < this.boardSize; i++) {
            const cell = this.graph.coords2algebraic(i, checkRow);
            if (this.board.has(cell) && this.board.get(cell)![0] === player) {
                return true;
            }
        }
        return false;
    }

    public inCheck(): number[] {
        // Only detects check for the current player
        let otherPlayer: playerid = 1;
        if (this.currplayer === 1) {
            otherPlayer = 2;
        }
        if (this.checkWinFor(otherPlayer)) {
            return [this.currplayer];
        } else {
            return [];
        }
    }

    protected checkEOG(): FurlGame {
        // We are now at the START of `this.currplayer`'s turn
        if (this.checkWinFor(this.currplayer)) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (!this.gameover && this.moves().length === 0) {
            let otherPlayer: playerid = 1;
            if (this.currplayer === 1) {
                otherPlayer = 2;
            }
            this.gameover = true;
            this.winner = [otherPlayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IFurlState {
        return {
            game: FurlGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FurlGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const legendNames: Set<string> = new Set();
        let pstr = "";
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
                        key = `A${size.toString()}`;
                    } else {
                        key = `B${size.toString()}`;
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
            const player = piece === "A" ? 1 : 2;
            const sizeStr = size.join("");
            if (sizeStr === "1") {
                legend[name] = [{ name: "piece", colour: player }]
            } else {
                legend[name] = [
                    { name: "piece", colour: player },
                    { text: sizeStr, colour: "#000", scale: 0.75 },
                ]
            }
        }

        // Build marker points to show home row.
        const points1 = [];
        const points2 = [];
        for (let i = 0; i < this.boardSize; i++) {
            points1.push({row: this.boardSize * 2 - 2, col: i});
            points2.push({row: 0, col: i});
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                markers: [
                    { type: "flood", colour: 1, opacity: 0.2, points: points1 as [{ row: number; col: number; }, ...{ row: number; col: number; }[]] },
                    { type: "flood", colour: 2, opacity: 0.2, points: points2 as [{ row: number; col: number; }, ...{ row: number; col: number; }[]] },
                ],
            },
            legend,
            pieces: pstr,
        };

        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "furl" || move.type === "unfurl") {
                    const [fx, fy] = this.graph.algebraic2coords(move.from);
                    const [tx, ty] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                } else if (move.type === "capture") {
                    const [cx, cy] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: cy, col: cx}]});
                }
            }
        }
        if (this._points.length > 0) {
            const points = [];
            for (const cell of this._points) {
                points.push({row: cell[1], col: cell[0]});
            }
            // @ts-ignore
            rep.annotations.push({type: "dots", targets: points});
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "furl":
                node.push(i18next.t("apresults:FURL.furl", {player, from: r.from, to: r.to, count: r.count}));
                resolved = true;
                break;
            case "unfurl":
                node.push(i18next.t("apresults:UNFURL.furl", {player, from: r.from, to: r.to, count: r.count}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.furl", {player, where: r.where, size: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerPieces(player: number): number {
        if (this.stack[0]._version === "20231229") {
            // Only filter for values where the length of the key is less than 4.
            // This is because in this version, there are some erroneous keys that can't be removed now.
            return [...this.board.entries()].filter(v => v[0].length < 4 && v[1][0] === player).map(v => v[1][1]).reduce((a, b) => a + b, 0);
        }
        return [...this.board.values()].filter(v => v[0] === player).map(v => v[1]).reduce((a, b) => a + b, 0);
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        return status;
    }

    public clone(): FurlGame {
        return new FurlGame(this.serialize());
    }

    public state2aiai(): string[] {
        const moves = this.moveHistory();
        const lst: string[] = [];
        for (const round of moves) {
            for (const move of round) {
                let split = "<";
                if (move.includes(">")) {
                    split = ">";
                } else if (move.includes("x")) {
                    split = "x";
                }
                let [from,to] = move.split(split);
                from = hexhexAp2Ai(from, 4);
                to = hexhexAp2Ai(to, 4);
                if (split === "<") {
                    lst.push(`Furl ${from}:${to}`);
                } else {
                    lst.push(`Unfurl ${from}:${to}`);
                }
            }
        }
        return lst;
    }

    public translateAiai(move: string): string {
        let sub: string;
        let op: string;
        if (move.startsWith("Furl")) {
            sub = move.substring(5);
            op = "<";
        } else {
            sub = move.substring(7);
            op = ">";
        }
        let [from,to] = sub.split(":");
        from = hexhexAi2Ap(from, 4);
        to = hexhexAi2Ap(to, 4);
        const fContents = this.board.get(from);
        const tContents = this.board.get(to);
        // check for captures first
        if (fContents !== undefined && tContents !== undefined && fContents[0] !== tContents[0]) {
            return `${from}x${to}`;
        }
        // otherwise, just go with the arrow operator
        else {
            return `${from}${op}${to}`;
        }
    }
}
