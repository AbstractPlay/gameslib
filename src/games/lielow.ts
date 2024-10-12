import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections, Directions } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
type CellContents = [playerid, number];

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    kingPos: [string?, string?];
    lastmove?: string;
};

export interface ILielowState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LielowGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Lielow",
        uid: "lielow",
        playercounts: [2],
        version: "20231224",
        dateAdded: "2023-12-24",
        // i18next.t("apgames:descriptions.lielow")
        description: "apgames:descriptions.lielow",
        urls: ["https://boardgamegeek.com/boardgame/349408/lielow"],
        people: [
            {
                type: "designer",
                name: "Michael Amundsen",
                urls: ["https://boardgamegeek.com/boardgamedesigner/133389/michael-amundsen"],
            },
            {
                type: "designer",
                name: "Alek Erickson",
                urls: ["https://boardgamegeek.com/boardgamedesigner/101050/alek-erickson"],
            },
        ],
        variants: [
            { uid: "size-9", group: "board" },
        ],
        categories: ["goal>royal-capture", "mechanic>bearoff", "mechanic>capture", "mechanic>move", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "aiai", "limited-pieces"]
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private kingPos: [string?, string?] = [undefined, undefined];
    private boardSize: number;
    private grid: RectGrid;
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ILielowState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.variants.includes("size-9") ? 9 : 8;
            const board = new Map<string, CellContents>();
            // Initialise pieces for both players.
            if (this.variants.includes("size-9")) {
                for (let i = 0; i < this.boardSize; i++) {
                    board.set(this.coords2algebraic(i, this.boardSize - 1), [1, 1]);
                    board.set(this.coords2algebraic(i, this.boardSize - 3), [1, 1]);
                    board.set(this.coords2algebraic(i, 0), [2, 1]);
                    board.set(this.coords2algebraic(i, 2), [2, 1]);
                }
            } else {
                for (let i = 0; i < this.boardSize; i++) {
                    board.set(this.coords2algebraic(i, this.boardSize - 2), [1, 1]);
                    board.set(this.coords2algebraic(i, 1), [2, 1]);
                }
            }
            const kingPos: [string?, string?] = [undefined, undefined]
            const fresh: IMoveState = {
                _version: LielowGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                kingPos,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILielowState;
            }
            if (state.game !== LielowGame.gameinfo.uid) {
                throw new Error(`The Lielow engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.variants.includes("size-9") ? 9 : 8;
        }
        this.load();
        this.grid = new RectGrid(this.boardSize,this.boardSize);
    }

    public load(idx = -1): LielowGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>());
        this.kingPos = [...state.kingPos];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = new Set<string>();
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player);
        const offable: Set<string> = new Set();

        for (const [cell, [, size]] of pieces) {
            const [xcell, ycell] = this.algebraic2coords(cell);
            for (const dir of allDirections) {
                const moved = RectGrid.move(xcell, ycell, dir, size);
                if (this.withinBoard(...moved)) {
                    const toCell = this.coords2algebraic(...moved);
                    if (!this.board.has(toCell)) {
                        moves.add(`${cell}-${toCell}`);
                    } else if (this.board.get(toCell)![0] !== player) {
                        moves.add(`${cell}x${toCell}`);
                    }
                } else {
                    offable.add(cell);
                }
            }
        }
        for (const cell of offable) {
            moves.add(`${cell}-off`);
        }
        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let cell: string | undefined;
            if (col >= 0) {
                cell = this.coords2algebraic(col, row);
            }
            let newmove = "";
            if (move.length > 0) {
                const [from,] = move.split(/[\-x]/);
                if (cell === undefined) {
                    newmove = `${from}-off`;
                } else if (!this.board.has(cell)) {
                    newmove = `${from}-${cell}`;
                } else if (this.board.get(cell)![0] === this.currplayer) {
                    newmove = cell;
                } else {
                    newmove = `${from}x${cell}`;
                }
            } else if (cell !== undefined && this.board.has(cell) && this.board.get(cell)![0] === this.currplayer) {
                newmove = cell;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.lielow.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [from, to] = m.split(/[\-x]/);
        let xFrom: number; let yFrom: number;
        try {
            [xFrom, yFrom] = this.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // `from` has a piece
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        const [fromPlayer, fromSize] = this.board.get(from)!;
        if (fromPlayer !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // valid partial, if no `to`
        if ( (to === undefined) || (to.length === 0) ) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.lielow.PARTIAL");
            return result;

        // if you're bearing off
        } else if (to === "off") {
            // you can reach the target row
            if (this.offBoardPossible(from)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE")
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.lielow.TOOFAR");
            return result;
        // all other situations
        } else {
            let xTo: number; let yTo: number;
            try {
                [xTo, yTo] = this.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // cells are different
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // line of sight
            const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const ray = this.grid.ray(xFrom, yFrom, bearing).map(pt => this.coords2algebraic(...pt));
            if (! ray.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.lielow.INCORRECT_DISTANCE", {from, to});
                return result;
            }
            // within range
            const dist = RectGrid.distance(xFrom, yFrom, xTo, yTo);
            if (fromSize !== dist) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.lielow.INCORRECT_DISTANCE");
                return result;
            }
            // correct operator
            if (m.includes("-")) {
                // is the space empty
                if (this.board.has(to)) {
                    const [toPlayer, ] = this.board.get(to)!;
                    if (toPlayer === this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                        return result;
                    }
                    if (this.board.get(to)![0] === this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                        return result;
                    }
                }
            } else {
                const [toPlayer, ] = this.board.get(to)!;
                // is there a piece to capture
                if (! this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                    return result;
                }
                // is it an enemy piece
                if (toPlayer === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }
            }
            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private withinBoard(x: number, y: number): boolean {
        // The current cell is within board bounds.
        return ( (x >= 0) && (x < this.boardSize) && (y >= 0) && (y < this.boardSize) );
    }

    private offBoardPossible(cell: string): boolean {
        // Check if the piece on cell can bear off.
        // Currently no error handling for if the piece is not on the board.
        const [x, y] = this.algebraic2coords(cell);
        const [, size] = this.board.get(cell)!;
        return y - size < 0 || y + size >= this.boardSize || x - size < 0 || x + size >= this.boardSize
    }

    private closestOffboardCell(cell: string): string | undefined {
        // If the piece can bear off, return the closest cell to the closest edge.
        // Else, return undefined.
        const [x, y] = this.algebraic2coords(cell);
        const [, size] = this.board.get(cell)!;
        let shortestDirection: Directions | undefined;
        let shortestDist: number | undefined;
        for (const direction of ["N", "E", "S", "W"]) {
            const ray = this.grid.ray(x, y, direction as Directions).map(pt => this.coords2algebraic(...pt));
            if (size > ray.length) {
                const dist = size - ray.length;
                if (shortestDist === undefined || dist > shortestDist) {
                    shortestDirection = direction as Directions;
                    shortestDist = dist;
                }
            }
        }
        if (shortestDirection === undefined) {
            return undefined;
        }
        if (shortestDirection === "N") {
            return this.coords2algebraic(x, 0);
        } else if (shortestDirection === "E") {
            return this.coords2algebraic(this.boardSize - 1, y);
        } else if (shortestDirection === "S") {
            return this.coords2algebraic(x, this.boardSize - 1);
        } else {
            return this.coords2algebraic(0, y);
        }
    }

    private findPoints(cell: string): string[] {
        const [x, y] = this.algebraic2coords(cell);
        const [player, size] = this.board.get(cell)!;
        const moves = new Set<string>();
        for (const dir of allDirections) {
            const moved = RectGrid.move(x, y, dir, size);
            if (this.withinBoard(...moved)) {
                const toCell = this.coords2algebraic(...moved);
                if (!this.board.has(toCell) || this.board.get(toCell)![0] !== player) {
                    moves.add(toCell);
                }
            }
        }
        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public move(m: string, {partial = false, trusted = false} = {}): LielowGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        // if partial, just set the points and get out
        if ( (partial) && (! m.includes("-")) && (! m.includes("x")) ) {
            const [cell,] = m.split(/[-x]/);
            const pts = this.findPoints(cell);
            if (pts !== undefined) {
                this._points = pts.map(c => this.algebraic2coords(c));
            } else {
                this._points = [];
            }
            return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        this.results = [];

        const [from, to] = m.split(/[\-x]/);
        const fromPiece = this.board.get(from)!;
        if (m.includes("-")) {
            if (to === "off") {
                const closestCell = this.closestOffboardCell(from);
                this.results.push({type: "bearoff", from, edge: closestCell})
                if (from === this.kingPos[this.currplayer - 1]) {
                    this.kingPos[this.currplayer - 1] = "dead";
                }
            } else {
                this.board.set(to, [...fromPiece]);
                this.results.push({type: "move", from, to, what: fromPiece[1].toString()});
                this.board.set(to, [fromPiece[0], fromPiece[1] + 1]);
                if (from === this.kingPos[this.currplayer - 1]) {
                    this.kingPos[this.currplayer - 1] = to;
                }
            }
            this.board.delete(from);
        } else {
            // If the toPiece is the opponent's king, replace `kingPos` with "dead".
            if (to === this.kingPos[this.currplayer % 2]) {
                this.kingPos[this.currplayer % 2] = "dead";
            }
            this.board.delete(from);
            this.results.push({type: "move", from, to, what: fromPiece[1].toString()});
            this.results.push({type: "capture", where: to});
            this.board.set(to, [this.currplayer, 1]);
            if (from === this.kingPos[this.currplayer - 1]) {
                this.kingPos[this.currplayer - 1] = to;
            }
        }
        // check for accession for both players.
        if (this.kingPos[this.currplayer - 1] !== "dead") {
            const pieces = [...this.board.entries()].filter(e => e[1][0] === this.currplayer);
            const maxSize = Math.max(...pieces.map(e => e[1][1]));
            const biggestPieces = pieces.filter(e => e[1][1] === maxSize).map(e => e[0]);
            const kingPos = this.kingPos[this.currplayer - 1];
            if (biggestPieces.length === 1 && kingPos !== biggestPieces[0]) {
                this.kingPos[this.currplayer - 1] = biggestPieces[0];
                this.results.push({type: "promote", player: this.currplayer, to: "king", where: biggestPieces[0]});
            }
        }
        if (this.kingPos[this.currplayer % 2] !== "dead" && m.includes("x")) {
            const pieces = [...this.board.entries()].filter(e => e[1][0] === this.currplayer % 2 + 1);
            const maxSize = Math.max(...pieces.map(e => e[1][1]));
            const biggestPieces = pieces.filter(e => e[1][1] === maxSize).map(e => e[0]);
            const kingPos = this.kingPos[this.currplayer % 2];
            if (biggestPieces.length === 1 && kingPos !== biggestPieces[0]) {
                this.kingPos[this.currplayer % 2] = biggestPieces[0];
                this.results.push({type: "promote", player: this.currplayer % 2 + 1, to: "king", where: biggestPieces[0]});
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

    protected checkEOG(): LielowGame {
        if (this.kingPos[0] === "dead") {
            this.gameover = true;
            this.winner = [2];
        } else if (this.kingPos[1] === "dead") {
            this.gameover = true;
            this.winner = [1];
        }
        if (this.gameover === true) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ILielowState {
        return {
            game: LielowGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LielowGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: [...this.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>()),
            kingPos: [...this.kingPos]
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const legendNames: Set<string> = new Set();
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    let key = "";
                    let piece = "";
                    if (player === 1) {
                        piece = (this.kingPos[0] === cell) ? "C" : "A";
                        key = `${piece}${size.toString()}`;
                    } else {
                        piece = (this.kingPos[1] === cell) ? "D" : "B";
                        key = `${piece}${size.toString()}`;
                    }
                    legendNames.add(key);
                    pieces.push(key);
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(new RegExp(`\n,${this.boardSize - 1}(?=\n)`, "g"), "_");

        // build legend based on stack sizes
        const myLegend: ILegendObj = {};
        for (const legendName of legendNames) {
            const [piece, ...size] = legendName;
            const name = (piece === "C" || piece === "D") ? "piece-horse" : "piece";
            const player = (piece === "A" || piece === "C") ? 1 : 2;
            const sizeStr = size.join("");
            myLegend[legendName] = [
                {
                    name,
                    colour: player,
                },
                {
                    text: sizeStr,
                    colour: "#000",
                    scale: 0.75,
                }
            ];
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardSize,
                height: this.boardSize,
                buffer: {
                    width: 0.2,
                    pattern: "slant",
                    show: ["N", "E", "S", "W"],
                },
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "promote") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}], colour: "#ffd700"});
                } else if (move.type === "bearoff") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [x, y] = this.algebraic2coords(move.edge!);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: y, col: x}]});
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this._points.length > 0) {
            const points = [];
            for (const cell of this._points) {
                points.push({row: cell[1], col: cell[0]});
            }
            rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "damage", "destroy", "bearoff", "eog", "winners"]);
    }

    public chatLog(players: string[]): string[][] {
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
                const otherName = players.filter(p => p !== name)[0];
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "move":
                                    node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                                break;
                            case "capture":
                                node.push(i18next.t("apresults:CAPTURE.nowhat", {player: name, where: r.where}));
                                break;
                            case "bearoff":
                                node.push(i18next.t("apresults:BEAROFF.nowhat", {player: name, from: r.from}));
                                break;
                            case "promote":
                                node.push(i18next.t("apresults:PROMOTE.lielow", {player: r.player !== state.currplayer ? name : otherName, where: r.where}));
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

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(v => v[0] === player).map(v => v[1]).length;
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

    public clone(): LielowGame {
        return new LielowGame(this.serialize());
    }

    public state2aiai(): string[] {
        const moves = this.moveHistory();
        const lst: string[] = [];
        for (const round of moves) {
            for (const move of round) {
                const stripped = move.replace("x","-");
                lst.push(stripped.replace("-off",""));
            }
        }
        return lst;
    }

    public translateAiai(move: string): string {
        if (move.length === 2) {
            return `${move}-off`;
        } else {
            const [,to] = move.split("-");
            if (this.board.has(to)) {
                return move.replace("-", "x");
            } else {
                return move;
            }
        }
    }
}
