/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;
type Directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: Directions[] = ["NE", "E", "SE", "SW", "W", "NW"];

type CellContents = playerid;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface ITrikeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TrikeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Trike",
        uid: "trike",
        playercounts: [2],
        version: "20231225",
        // i18next.t("apgames:descriptions.trike")
        description: "apgames:descriptions.trike",
        urls: ["https://boardgamegeek.com/boardgame/307379/trike"],
        people: [
            {
                type: "designer",
                name: "Alek Erickson",
            }
        ],
        variants: [
            {uid: "standard-7", group: "board"},
            {uid: "standard-13", group: "board"},
            {uid: "standard-15", group: "board"},
        ],
        flags: ["pie"]
    };
    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;
    private boardSize = 0;

    constructor(state?: ITrikeState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITrikeState;
            }
            if (state.game !== TrikeGame.gameinfo.uid) {
                throw new Error(`The Trike game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string,playerid>();
            const fresh: IMoveState = {
                _version: TrikeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): TrikeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;

        const standardVariants = this.variants.filter(v => v.includes("standard"))
        if (standardVariants.length > 0) {
            const size = standardVariants[0].match(/\d+/);
            this.boardSize = parseInt(size![0], 10);
        } else {
            this.boardSize = 11;
        }
        return this;
    }

    private coords2algebraic(x: number, y: number): string {
        if (y > x) {
            throw new Error(`The coordinates (${x},${y}) are invalid.`);
        }
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
        return columnLabels[y] + (x + 1).toString();
    }

    private algebraic2coords(cell: string): [number,number] {
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const y = columnLabels.indexOf(pair[0]);
        if ( (y === undefined) || (y < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const x = parseInt(num, 10);
        if ( (x === undefined) || (isNaN(x)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        if (y > x) {
            throw new Error(`The coordinates (${x},${y}) are invalid.`);
        }
        return [x - 1, y];
    }

    private movePosition(x: number, y: number, dir: Directions, dist = 1): [number, number] | undefined {
        let xNew = x;
        let yNew = y;
        switch (dir) {
            case "NE":
                xNew -= dist
                break;
            case "E":
                yNew += dist;
                break;
            case "SE":
                xNew += dist;
                yNew += dist;
                break;
            case "SW":
                xNew += dist;
                break;
            case "W":
                yNew -= dist;
                break;
            case "NW":
                xNew -= dist;
                yNew -= dist;
                break;
            default:
                throw new Error("Invalid direction requested.");
        }
        if (!this.validCell(xNew, yNew)) {
            return undefined;
        }
        return [xNew, yNew];
    }

    private validCell(x: number, y: number): boolean {
        if (x < 0 || y < 0 || y > x || x >= this.boardSize) {
            return false;
        }
        return true;
    }

    private getNeighbours(x: number, y: number): string[] {
        const neighbours: string[] = [];
        for (const dir of allDirections) {
            const pos = this.movePosition(x, y, dir);
            if (pos !== undefined) {
                neighbours.push(this.coords2algebraic(...pos));
            }
        }
        return neighbours;
    }

    private getMovesDirection(x: number, y: number, dir: Directions): string[] {
        const moves: string[] = [];
        let pos = this.movePosition(x, y, dir);
        while (pos !== undefined) {
            const cell = this.coords2algebraic(...pos);
            if (this.board.has(cell)) {
                break;
            }
            moves.push(cell);
            pos = this.movePosition(...pos, dir);
        }
        return moves;
    }

    private getAllCells(): string[] {
        const cells: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            for (let y = 0; y <= x; y++) {
                cells.push(this.coords2algebraic(x, y));
            }
        }
        return cells;
    }

    private getLastPosition(): string | undefined {
        if (this.lastmove === undefined) {
            return undefined;
        }
        return this.lastmove;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        // get last position
        const lastPosition = this.getLastPosition();
        if (lastPosition === undefined) {
            // if no last move, place anywhere.
            return this.getAllCells();
        }
        const moves: string[] = [];
        const [x, y] = this.algebraic2coords(lastPosition);
        for (const dir of allDirections) {
            const movesDir = this.getMovesDirection(x, y, dir);
            moves.push(...movesDir);
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        try {
            // starting fresh
            const cell = this.coords2algebraic(row, col);
            const result = this.validateMove(cell) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = cell;
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
        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.trike.INITIAL_INSTRUCTIONS");
            return result;
        }
        const [x, y] = this.algebraic2coords(m);
        // valid cell
        if (!this.validCell(x, y)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }
        // valid move
        const lastPosition = this.getLastPosition();
        if (lastPosition === undefined) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        if (m === lastPosition) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }
        // line of sight
        if (!this.moves().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NOLOS", {from: lastPosition, to: m});
            return result;
        }
        // all good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): TrikeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if ( (! result.valid) || (result.complete === -1) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        const lastPosition = this.getLastPosition();
        this.board.set(m, this.currplayer);
        if (lastPosition === undefined) {
            this.results.push({type: "place", where: m});
        } else {
            this.results.push({type: "move", from: lastPosition, to: m});
        }

        // reconstitute a normalized move rep
        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public status(): string {
        let status = super.status();
        if (this.gameover) {
            status += `Points: ${this.getPoints().join("-")}\n\n`;
        }
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        return status;
    }

    private getPoints(): [number, number] {
        const points: [number, number] = [0, 0];
        const [x, y] = this.algebraic2coords(this.lastmove!);
        for (const n of [...this.getNeighbours(x, y), this.lastmove!]) {
            if (this.board.get(n) === 1) {
                points[0] += 1;
            } else {
                points[1] += 1;
            }

        }
        return points;
    }

    protected checkEOG(): TrikeGame {
        // We are now at the START of `this.currplayer`'s turn
        if (this.moves().length === 0) {
            this.gameover = true;
            const points = this.getPoints();
            this.winner = [points[0] > points[1] ? 1 : 2];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ITrikeState {
        return {
            game: TrikeGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: TrikeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        const lastPosition = this.getLastPosition();
        for (let x = 0; x < this.boardSize; x++) {
            const nodes: string[] = [];
            for (let y = 0; y <= x; y++) {
                const cell = this.coords2algebraic(x, y);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (lastPosition !== undefined && cell === lastPosition) {
                        nodes.push(contents === 1 ? "C" : "D");
                    } else {
                        nodes.push(contents === 1 ? "A" : "B");
                    }
                } else {
                    nodes.push("-");
                }
            }
            pieces.push(nodes);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            options: ["reverse-columns"],
            renderer: "stacking-offset",
            board: {
                style: "hex-of-hex",
                minWidth:  1,
                maxWidth: this.boardSize,
                half: "top",
            },
            legend: {
                A: {
                        name: "piece",
                        player: 1,
                },
                B: {
                        name: "piece",
                        player: 2,
                },
                C: {
                        name: "piece-chariot",
                        player: 1,
                },
                D: {
                        name: "piece-chariot",
                        player: 2,
                },
            },
            pieces: pstr
        };


        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: x, col: y}]});
                } else if (move.type === "move") {
                    const [fx, fy] = this.algebraic2coords(move.from);
                    const [tx, ty] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fx, col: fy},{row: tx, col: ty}]});
                }
            }
            if (this.lastmove !== undefined) {
                for (const cell of this.moves()) {
                    const [x, y] = this.algebraic2coords(cell);
                    rep.annotations.push({type: "dots", targets: [{row: x, col: y}]});
                }
            }
        }

        return rep;
    }

    public clone(): TrikeGame {
        return Object.assign(new TrikeGame(), deepclone(this) as TrikeGame);
        // return new TrikeGame(this.serialize());
    }
}
