import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    links: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface ITwixtState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

/**
 * Function taken from renderers/src/renderers/_base.ts.
 * It's not exported, so I copied it here.
 * An infinite generator for creating column labels from an initial string of characters.
 * With the English alphabet, you would get a-z, then aa-az-ba-zz, then aaa etc.
 *
 * @param labels - A string of characters to use as column labels
 * @returns The next label in the sequence.
 */
function* generateColumnLabel(labels: string): IterableIterator<string> {
    let n = 0
    let len = 1;
    const chars = labels.split("");
    while (true) {
        let label = "";
        let mask = n.toString(chars.length);
        while (mask.length < len) {
            mask = "0" + mask;
        }
        for (const char of mask) {
            const val = parseInt(char, chars.length);
            label += chars[val];
        }
        yield label;
        n++;
        const threshold = Math.pow(chars.length, len);
        if (n === threshold) {
            n = 0;
            len++;
        }
    }
}


export class TwixtGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Twixt",
        uid: "twixt",
        playercounts: [2],
        version: "20240220",
        dateAdded: "2024-02-24",
        // i18next.t("apgames:descriptions.twixt")
        description: "apgames:descriptions.twixt",
        // i18next.t("apgames:notes.twixt")
        notes: "apgames:notes.twixt",
        urls: ["https://boardgamegeek.com/boardgame/949/twixt"],
        people: [
            {
                type: "designer",
                name: "Alex Randolph",
            }
        ],
        variants: [
            {
                uid: "size-30",
                group: "board",
            },
            {
                uid: "pp",
                group: "ruleset",
            }
        ],
        categories: ["goal>connect", "mechanic>place",  "mechanic>block", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["pie", "multistep", "rotate90"],
        displays: [{uid: "hide-diagonals"}],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public links!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 0;
    private lines: [PlayerLines, PlayerLines];
    private columnLabels: string[];
    private dots: string[] = [];

    constructor(state?: ITwixtState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map();
            const links = new Map();
            const fresh: IMoveState = {
                _version: TwixtGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                links,
                connPath: [],
            };
            this.stack = [fresh];
            if (variants !== undefined) {
                this.variants = [...variants];
            }
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITwixtState;
            }
            if (state.game !== TwixtGame.gameinfo.uid) {
                throw new Error(`The Twixt engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        const iterator = generateColumnLabel("abcdefghijklmnopqrstuvwxyz");
        this.columnLabels = Array.from({ length: this.boardSize }, () => iterator.next().value as string)
        this.lines = this.getLines();
    }

    public load(idx = -1): TwixtGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.links = new Map(state.links);
        this.lastmove = state.lastmove;
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 24;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 1; x < this.boardSize - 1; x++) {
            const N = this.coords2peg(x, 0);
            const S = this.coords2peg(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.coords2peg(this.boardSize - 1, y);
            const W = this.coords2peg(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS],[lineE,lineW]];
    }

    private coords2peg(x: number, y: number, middle?: "horizontal" | "vertical"): string {
        // Given coordinates, return the peg.
        if (middle === undefined) {
            return this.columnLabels[x] + (y + 1).toString();
        } else if (middle === "horizontal") {
            return this.columnLabels[x] + (y + 1).toString() + "'";
        } else {
            return this.columnLabels[x] + "'" + (y + 1).toString();
        }
    }

    private peg2coords(cell: string): [number, number] {
        // Given a peg, return the coordinates.
        let i = 0;
        while (i < cell.length && isNaN(parseInt(cell[i], 10))) { i++; }
        const letters = cell.slice(0, i);
        const numbers = cell.slice(i)
        const x = this.columnLabels.indexOf(letters);
        if (x === undefined || x < 0) {
            throw new Error(`The column label is invalid: ${letters}`);
        }
        const y = Number(numbers);
        if (y === undefined || isNaN(y) || numbers === "" ) {
            throw new Error(`The row label is invalid: ${numbers}`);
        }
        return [x, y - 1];
    }

    public link2coords(link: string): [[number, number], [number, number]] {
        // Given a link, return the coordinates of the two pegs it connects.
        const dir = link[0];
        const middleCell = link.slice(1).replace("'", "");
        const [x, y] = this.peg2coords(middleCell);
        const isVertical = link[link.length - 1] !== "'";
        if (isVertical) {
            if (dir === "/") {
                return [[x, y + 1], [x + 1, y - 1]];
            } else /* if (dir === "\\") */ {
                return [[x + 1, y + 1], [x, y - 1]];
            }
        } else {
            if (dir === "/") {
                return [[x + 1, y], [x - 1, y + 1]];
            } else /* if (dir === "\\") */ {
                return [[x + 1, y + 1], [x - 1, y]];
            }
        }
    }

    public pegs2link(peg1: string, peg2: string): string {
        // Given two pegs, return the link between them.
        const [x1, y1] = this.peg2coords(peg1);
        const [x2, y2] = this.peg2coords(peg2);
        const xMax = Math.max(x1, x2);
        const xMin = Math.min(x1, x2);
        const yMax = Math.max(y1, y2);
        const yMin = Math.min(y1, y2);
        if (xMax - xMin === 2) {
            if (yMax - yMin === 1) {
                // horizontal
                const middlePeg = this.coords2peg(xMin + 1, yMin, "horizontal");
                if (x1 < x2 && y1 < y2 || x1 > x2 && y1 > y2) {
                    return "\\" + middlePeg;
                } else {
                    return "/" +  middlePeg;
                }
            }
        } else if (yMax - yMin === 2) {
            if (xMax - xMin === 1) {
                // vertical
                const middlePeg = this.coords2peg(xMin, yMin + 1, "vertical");
                if (x1 < x2 && y1 < y2 || x1 > x2 && y1 > y2) {
                    return "\\" + middlePeg;
                } else {
                    return "/" + middlePeg;
                }
            }
        }
        throw new Error(`The two pegs are not knight's move away: ${peg1} and ${peg2}`);
    }

    private potentialLinks(peg: string): string[] {
        // Given a peg, return all the potential links a knight's move away.
        const [x, y] = this.peg2coords(peg);
        const toCheck: [number, number][] = [
            [x - 1, y - 2],
            [x + 1, y - 2],
            [x - 2, y - 1],
            [x + 2, y - 1],
            [x - 2, y + 1],
            [x + 2, y + 1],
            [x - 1, y + 2],
            [x + 1, y + 2]
        ];
        const potential: string[] = [];
        for (const [i, j] of toCheck) {
            if (i >= 0 && i < this.boardSize && j >= 0 && j < this.boardSize) {
                potential.push(this.coords2peg(i, j));
            }
        }
        return potential;
    }

    private crossedLinks(link: string): string[] {
        // Get all links that would cross the given link.
        const direction = link[0];
        const otherDirection = (direction === "/") ? "\\" : "/";
        const middleCell = link.slice(1).replace("'", "");
        const isVertical = link[link.length - 1] !== "'";
        const [x, y] = this.peg2coords(middleCell);
        const crossed = [];
        if (isVertical) {
            crossed.push(otherDirection + this.coords2peg(x, y - 1, "horizontal"));
            crossed.push(otherDirection + this.coords2peg(x + 1, y - 1, "horizontal"));
            crossed.push(otherDirection + this.coords2peg(x, y, "horizontal"));
            crossed.push(otherDirection + this.coords2peg(x + 1, y, "horizontal"));
            crossed.push(otherDirection + this.coords2peg(x, y, "vertical"))
            crossed.push(otherDirection + this.coords2peg(x, y - 1, "vertical"))
            crossed.push(otherDirection + this.coords2peg(x, y + 1, "vertical"))
            if (direction === "/") {
                crossed.push("/" + this.coords2peg(x, y, "horizontal"));
                crossed.push("/" + this.coords2peg(x + 1, y - 1, "horizontal"));
            } else {
                crossed.push("\\" + this.coords2peg(x, y - 1, "horizontal"));
                crossed.push("\\" + this.coords2peg(x + 1, y, "horizontal"));
            }
        } else {
            crossed.push(otherDirection + this.coords2peg(x - 1, y, "vertical"));
            crossed.push(otherDirection + this.coords2peg(x, y, "vertical"));
            crossed.push(otherDirection + this.coords2peg(x - 1, y + 1, "vertical"));
            crossed.push(otherDirection + this.coords2peg(x, y + 1, "vertical"));
            crossed.push(otherDirection + this.coords2peg(x, y, "horizontal"))
            crossed.push(otherDirection + this.coords2peg(x - 1, y, "horizontal"));
            crossed.push(otherDirection + this.coords2peg(x + 1, y, "horizontal"));
            if (direction === "/") {
                crossed.push("/" + this.coords2peg(x - 1, y + 1, "vertical"));
                crossed.push("/" + this.coords2peg(x, y, "vertical"));
            } else {
                crossed.push("\\" + this.coords2peg(x, y + 1, "vertical"));
                crossed.push("\\" + this.coords2peg(x - 1, y, "vertical"));
            }
        }
        return crossed;
    }

    private sortPegs(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.peg2coords(a);
        const [bx, by] = this.peg2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private printLink(link: string): string {
        // Given a connection, print it in a format that is easy to read for the player.
        const expanded = this.link2coords(link).map((x) => this.coords2peg(...x)).sort((a, b) => this.sortPegs(a, b)).join("-");
        return `${link} (${expanded})`;
    }

    public moves(player?: playerid): string[] {
        // We only return peg placement without any linking or delinking.
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        for (let x = player === 1 ? 1 : 0; x < (player === 1 ? this.boardSize - 1 : this.boardSize); x++) {
            for (let y = player === 2 ? 1 : 0; y < (player === 2 ? this.boardSize - 1 : this.boardSize); y++) {
                const cell = this.coords2peg(x, y);
                if (!this.board.has(cell)) {
                    moves.push(cell);
                }
            }
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private sortMoves(a: string, b: string): number {
        // Sorting for move segments
        if (a[0] === "-" && b[0] !== "-") { return -1; }
        if (b[0] === "-" && a[0] !== "-") { return 1; }
        if ((a[0] === "/" || a[0] === "\\") && b[0] !== "/" && b[0] !== "\\") { return -1; }
        if ((b[0] === "/" || b[0] === "\\") && a[0] !== "/" && a[0] !== "\\") { return 1; }
        const aDropped = a.replace(/['-/\\]/g, "");
        const bDropped = b.replace(/['-/\\]/g, "");
        return this.sortPegs(aDropped, bDropped);
    }

    private normaliseMove(m: string): string {
        // Normalise a move so that it is in a standard format.
        const moves = m.split(",");
        // Remove moves that have an inverse.
        const toRemove = new Set<string>();
        for (const move of moves) {
            if (move[0] === "-") {
                const inverse = move.slice(1);
                if (moves.includes(inverse)) {
                    toRemove.add(move);
                    toRemove.add(inverse);
                }
            }
        }
        // If a move is present twice, remove both instances.
        const seen = new Set<string>();
        for (const move of moves) {
            if (seen.has(move)) {
                toRemove.add(move);
            }
            seen.add(move);
        }
        const result = new Set(moves.filter((x) => !toRemove.has(x)));
        return Array.from(result).sort((a, b) => this.sortMoves(a, b)).join(",");
    }

    private isPeg(moveSegment: string): boolean {
        // Check if a move segment is a peg.
        let x: number | undefined;
        let y: number | undefined;
        try {
            [x, y] = this.peg2coords(moveSegment);
        } catch (e) {
            return false;
        }
        if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
            return false;
        }
        return true;
    }

    private splitLinkPeg(move: string): [string[], string | undefined] {
        // split a move into moves involving links and the placement of the peg.
        const split = move.split(",");
        const last = split[split.length - 1];
        if (this.isPeg(last)) {
            return [split.slice(0, split.length - 1), last];
        }
        return [split, undefined];
    }

    private validateMoveSegment(move: string): boolean {
        // Check that a move segment is valid.
        if (move.length === 0) { return false; }
        const regex = new RegExp(/^-?[\/\\]?[a-z]+'?[0-9]+'?$/);
        if (!regex.test(move)) { return false; }
        if (move.split("'").length > 2) { return false; }
        if (move[0] === "-" && this.isPeg(move.slice(1))) { return false; }
        if ((move.includes("/" || move.includes("\\")) && !move.includes("'"))) { return false; }
        const stripped = move.replace(/['-/\\]/g, "");
        const [x, y] = this.peg2coords(stripped);
        if (this.isPeg(move)) {
            if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                return false;
            }
        } else {
            if (x < 0 || x >= this.boardSize - 1 || y < 0 || y >= this.boardSize - 1) {
                return false;
            }
        }
        return true;
    }

    private isKnightMove(peg1: string, peg2: string): boolean {
        // Check if two pegs are a knight's move away.
        const [x1, y1] = this.peg2coords(peg1);
        const [x2, y2] = this.peg2coords(peg2);
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        return dx === 1 && dy === 2 || dx === 2 && dy === 1;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (this.variants.includes("pp")) {
                if (row === -1 || col === -1) {
                    newmove = move;
                } else {
                    const cell = this.coords2peg(col, row);
                    newmove = cell;
                }
            } else {
                if (move.length === 0) {
                    if (row === -1 || col === -1) {
                        const [x1, y1, x2, y2] = piece!.split(/[|,]/).map((x) => parseInt(x, 10));
                        newmove = "-" + this.pegs2link(this.coords2peg(x1, y1), this.coords2peg(x2, y2));
                    } else {
                        const cell = this.coords2peg(col, row);
                        if (!this.board.has(cell)) {
                            newmove = cell;
                        } else {
                            newmove = cell + "-";
                        }
                    }
                } else if (move[move.length - 1] === "-") {
                    const split = move.split(",");
                    const head = split.length === 1 ? [] : split.slice(0, split.length - 1);
                    if (row === -1 || col === -1) {
                        const [x1, y1, x2, y2] = piece!.split(/[|,]/).map((x) => parseInt(x, 10));
                        const link = this.pegs2link(this.coords2peg(x1, y1), this.coords2peg(x2, y2));
                        head.push("-" + link);
                        newmove = this.normaliseMove(head.join(","));
                    } else {
                        const cell = this.coords2peg(col, row);
                        if (!this.board.has(cell)) {
                            head.push(cell);
                            newmove = this.normaliseMove(head.join(","));
                        } else {
                            const partialMove = split[split.length - 1];
                            const firstPeg = partialMove.slice(0, partialMove.length - 1);
                            if (this.isKnightMove(firstPeg, cell)) {
                                const link = this.pegs2link(firstPeg, cell);
                                if (this.links.has(link)) {
                                    head.push("-" + link);
                                } else {
                                    head.push(link);
                                }
                            }
                            newmove = this.normaliseMove(head.join(","));
                        }
                    }
                } else {
                    if (row === -1 || col === -1) {
                        const [x1, y1, x2, y2] = piece!.split(/[|,]/).map((x) => parseInt(x, 10));
                        newmove = this.normaliseMove(move + ",-" + this.pegs2link(this.coords2peg(x1, y1), this.coords2peg(x2, y2)));
                    } else {
                        const cell = this.coords2peg(col, row);
                        if (this.board.has(cell)) {
                            newmove = this.normaliseMove(move) + "," + cell + "-";
                        } else {
                            newmove = this.normaliseMove(move + "," + cell);
                        }
                    }
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                if (move[move.length - 1] === "-") {
                    // Strip away the partial move.
                    const split = move.split(",");
                    const head = split.length === 1 ? [] : split.slice(0, split.length - 1);
                    result.move = this.normaliseMove(head.join(","));
                } else {
                    result.move = move;
                }
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            if (this.variants.includes("pp")) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.twixt.INITIAL_INSTRUCTIONS_PP")
                return result;
            } else {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.twixt.INITIAL_INSTRUCTIONS")
                return result;
            }
        }

        m = m.toLowerCase();
        let place: string | undefined;
        if (this.variants.includes("pp")) {
            place = m
            if (!this.isPeg(place)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.twixt.INVALID_MOVE_SEGMENT", { move: m });
                return result;
            }
            if (this.board.has(place)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.twixt.OCCUPIED", { move: m });
                return result;
            }
        } else {
            const movesAll = m.split(",");
            const moves = m[m.length - 1] === "-" ? movesAll.slice(0, movesAll.length - 1) : movesAll;
            for (const move of moves) {
                if (!this.validateMoveSegment(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.twixt.INVALID_MOVE_SEGMENT", { move });
                    return result;
                }
            }
            const normalised = this.normaliseMove(m);
            if (normalised !== m) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.twixt.NORMALISED", { normalised });
                return result;
            }
            for (const move of moves) {
                if (this.isPeg(move)) {
                    if (this.board.has(move)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.twixt.OCCUPIED", { move });
                        return result;
                    }
                } else {
                    const isRemove = move[0] === "-";
                    const link = isRemove ? move.slice(1) : move;
                    const pegs = this.link2coords(link).map((p) => this.coords2peg(...p));
                    for (const peg of pegs) {
                        if (!this.board.has(peg)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.twixt.NO_PEG", { link: this.printLink(link), peg });
                            return result;
                        }
                        if (this.board.get(peg) !== this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.twixt.LINK_ON_WRONG_PLAYER", { link: this.printLink(link), peg });
                            return result;
                        }
                    }
                    if (isRemove) {
                        if (!this.links.has(link)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.twixt.LINK_ABSENT", { link: this.printLink(link)} );
                            return result;
                        }
                    } else {
                        if (this.links.has(link)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.twixt.LINK_PRESENT", { link: this.printLink(link)} );
                            return result;
                        }
                    }
                }
            }
            const head = moves.slice(0, moves.length - 1);
            for (const move of head) {
                if (this.isPeg(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.twixt.TOO_MANY_PEGS");
                    return result;
                }
            }
            const linkRemovals = [];
            const linkAdditions = [];
            for (const move of moves) {
                if (this.isPeg(move)) { continue; }
                if (move[0] === "-") {
                    linkRemovals.push(move.slice(1));
                } else if (move[0] === "/" || move[0] === "\\") {
                    linkAdditions.push(move);
                }
            }
            for (const link of linkAdditions) {
                for (const toTest of this.crossedLinks(link)) {
                    if (this.links.has(toTest) && !linkRemovals.includes(toTest)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.twixt.CROSSING", { link: this.printLink(link) });
                        return result;
                    }
                }
            }
            if (m[m.length - 1] === "-") {
                const partialMove = movesAll[movesAll.length - 1];
                const partialPeg = partialMove.slice(0, partialMove.length - 1);
                if (!this.isPeg(partialPeg)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.twixt.INVALID_PARTIAL", { move: partialMove });
                    return result;
                }
                if (!this.board.has(partialPeg)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.twixt.PARTIAL_EMPTY", { move: partialMove });
                    return result;
                }
                if (this.board.get(partialPeg) !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.twixt.PARTIAL_OPPONENT", { move: partialMove });
                    return result;
                }
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.twixt.PARTIAL_LINK");
                return result;
            }
            const lastMove = moves[moves.length - 1];
            if (!this.isPeg(lastMove)) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.twixt.INITIAL_INSTRUCTIONS");
                return result;
            }
            place = lastMove
        }
        const [x, y] = this.peg2coords(place);
        if (x === 0 && y === 0 ||
                x === this.boardSize - 1 && y === this.boardSize - 1 ||
                x === 0 && y === this.boardSize - 1 ||
                x === this.boardSize - 1 && y === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.twixt.CORNER", { place });
            return result;
        }
        if (this.currplayer === 1 && (x === 0 || x === this.boardSize - 1) ||
                this.currplayer === 2 && (y === 0 || y === this.boardSize - 1)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.twixt.OPPONENTS_AREA", { place });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): TwixtGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        let result;
        if (! trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // We only check for peg placement.
            if (!partial) {
                const [, peg] = this.splitLinkPeg(m);
                if (!this.moves().includes(peg!)) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }))
                }
            }
        }
        if (m.length === 0) {
            this.dots = [];
            return this;
        }
        let fullMoves;
        if (m[m.length - 1] === "-") {
            const split = m.split(",");
            const head = split.length === 1 ? [] : split.slice(0, split.length - 1);
            const linkRemovals: string[] = [];
            const linkAdditions: string[] = [];
            for (const move of head) {
                if (this.isPeg(move)) { continue; }
                if (move[0] === "-") {
                    linkRemovals.push(move.slice(1));
                } else if (move[0] === "/" || move[0] === "\\") {
                    linkAdditions.push(move);
                }
            }
            const partialMove = split[split.length - 1];
            const from = partialMove.slice(0, partialMove.length - 1);
            this.dots = [];
            for (const pegToCheck of this.potentialLinks(from)) {
                if (this.board.has(pegToCheck) && this.board.get(pegToCheck) === this.currplayer) {
                    const link = this.pegs2link(from, pegToCheck);
                    const crossed = this.crossedLinks(link);
                    if (!this.variants.includes("pp") && crossed.some((x) => (this.links.has(x) || linkAdditions.includes(x)) && !linkRemovals.includes(x))) { continue; }
                    if (this.variants.includes("pp") && crossed.some((x) => (this.links.has(x) || linkAdditions.includes(x)) && !linkRemovals.includes(x) && this.links.get(x) !== this.currplayer)) { continue; }
                    this.dots.push(pegToCheck);
                }
            }
            fullMoves = head;
        } else {
            this.dots = [];
            fullMoves = m.split(",");
        }
        this.results = [];
        for (const move of fullMoves) {
            if (move[0] === "-") {
                const link = move.slice(1);
                this.links.delete(link);
                this.results.push({ type: "remove", where: this.printLink(link) });
            } else if (move[0] === "/" || move[0] === "\\") {
                this.links.set(move, this.currplayer);
                this.results.push({ type: "add", where: this.printLink(move) });
            } else {
                this.results.push({ type: "place", where: move });
                this.board.set(move, this.currplayer);
                for (const toCheck of this.potentialLinks(move)) {
                    if (this.board.has(toCheck) && this.board.get(toCheck) === this.currplayer) {
                        const link = this.pegs2link(move, toCheck);
                        const crossed = this.crossedLinks(link);
                        if (!this.variants.includes("pp") && crossed.some((x) => this.links.has(x))) { continue; }
                        if (this.variants.includes("pp") && crossed.some((x) => this.links.has(x) && this.links.get(x) !== this.currplayer)) { continue; }
                        this.links.set(link, this.currplayer);
                        this.results.push( {type: "add", where: this.printLink(link)} );
                    }
                }
            }
        }
        if (partial) { return this; }

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

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        for (const [link, p] of this.links.entries()) {
            if (p !== player) { continue; }
            const [peg1, peg2] = this.link2coords(link).map((x) => this.coords2peg(...x));
            if (graph.hasNode(peg1) && !graph.hasEdge(peg1, peg2)) {
                graph.addEdge(peg1, peg2);
            }
        }
        return graph;
    }

    protected checkEOG(): TwixtGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        const graph = this.buildGraph(prevPlayer);
        const [sources, targets] = this.lines[prevPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevPlayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) {
                break;
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

    public state(): ITwixtState {
        return {
            game: TwixtGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TwixtGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            links: new Map(this.links),
            connPath: [...this.connPath],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showDiagonals = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-diagonals") {
                showDiagonals = false;
            }
        }
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2peg(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const markers: Array<any> = [
            {
                type: "line",
                points: [{ row: 1, col: 1 }, { row: 1, col: this.boardSize - 1 }],
                colour: 1,
                width: 5,
            },
            {
                type: "line",
                points: [ { row: this.boardSize - 1, col: 1 }, { row: this.boardSize - 1, col: this.boardSize - 1 } ],
                colour: 1,
                width: 5,
            },
            {
                type: "line",
                points: [ { row: 1, col: 1 }, { row: this.boardSize - 1, col: 1 } ],
                colour: 2,
                width: 5,
            },
            {
                type: "line",
                points: [ { row: 1, col: this.boardSize - 1 }, { row: this.boardSize - 1, col: this.boardSize - 1 } ],
                colour: 2,
                width: 5,
            },
        ]
        if (showDiagonals) {
            const diagonals = [
                [{ row: 1, col: 1 }, { row: this.boardSize - 3, col: (this.boardSize - 2) / 2 }],
                [{ row: 1, col: 1 }, { row: (this.boardSize - 2) / 2, col: this.boardSize - 3 }],
                [{ row: 1, col: this.boardSize - 2 }, { row: (this.boardSize - 2) / 2, col: 2 }],
                [{ row: 1, col: this.boardSize - 2 }, { row: this.boardSize - 3, col: (this.boardSize - 2) / 2 + 1 }],
                [{ row: this.boardSize - 2, col: 1 }, { row: 2, col: (this.boardSize - 2) / 2 }],
                [{ row: this.boardSize - 2, col: 1 }, { row: (this.boardSize - 2) / 2 + 1, col: this.boardSize - 3 }],
                [{ row: this.boardSize - 2, col: this.boardSize - 2 }, { row: (this.boardSize - 2) / 2 + 1, col: 2 }],
                [{ row: this.boardSize - 2, col: this.boardSize - 2 }, { row: 2, col: (this.boardSize - 2) / 2 + 1 }],
            ]
            for (const diagonal of diagonals) {
                markers.push({
                    type: "line",
                    points: diagonal,
                    width: 5,
                    opacity: 0.2,
                    centered: true,
                })
            }
        }

        for (const [link, player] of this.links) {
            const [peg1, peg2] = this.link2coords(link);
            markers.push({
                type: "line",
                points: [
                    {
                        row: peg1[1],
                        col: peg1[0],
                    },
                    {
                        row: peg2[1],
                        col: peg2[0],
                    },
                ],
                colour: player,
                width: 5,
                centered: true,
                clickable: true,
            })
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "pegboard",
                width: this.boardSize,
                height: this.boardSize,
                blocked: [
                    { row: 0, col: 0 },
                    { row: 0, col: this.boardSize - 1 },
                    { row: this.boardSize - 1, col: 0 },
                    { row: this.boardSize - 1, col: this.boardSize - 1 }
                ],
                markers,
            },
            options: ["reverse-numbers"],
            legend: {
                A: {
                    name: "piece",
                    colour: 1,
                    scale: 0.75,
                },
                B: {
                    name: "piece",
                    colour: 2,
                    scale: 0.75,
                }
            },
            pieces: pstr
        };

        // Add annotations
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.peg2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.peg2coords(cell);
                    targets.push({row: y, col: x})
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.peg2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({type: "dots", targets: points as [RowCol, ...RowCol[]]});
        }
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.twixt", { player, where: r.where }));
                resolved = true;
                break;
            case "add":
                node.push(i18next.t("apresults:ADD.twixt", { player, where: r.where }));
                resolved = true;
                break;
            case "remove":
                node.push(i18next.t("apresults:REMOVE.twixt", { player, where: r.where }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): TwixtGame {
        return new TwixtGame(this.serialize());
    }
}
