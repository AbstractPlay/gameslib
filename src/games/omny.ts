/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerDots, MarkerGlyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, UserFacingError } from "../common";
import { connectedComponents } from 'graphology-components';
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;

type CellContents = playerid[];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface IOmnyState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    startStars?: string[];
};

// ensures random stars have a certain minimum distance from each other
const starsValid = (g: HexTriGraph, stars: string[]): boolean => {
    for (const star of stars) {
        const [sx, sy] = g.algebraic2coords(star);
        // immediate neighbours
        const n1 = new Set<string>(g.neighbours(star));
        // neighbours of neighbours (doesn't apply to size-4 boards)
        const n2 = new Set<string>();
        if (g.minwidth > 4 || stars.length < 4) {
            [...n1].forEach(cell => g.neighbours(cell).forEach(n => n2.add(n)));
        }
        // combined
        const alln = new Set<string>([...n1, ...n2]);
        // delete starting cell
        alln.delete(star);
        // delete each cell at straight-line distance 2 away (doesn't apply to size-4 boards)
        if (g.minwidth > 4 || stars.length < 4) {
            for (const dir of HexTriGraph.directions) {
                const ray = g.ray(sx, sy, dir).map(c => g.coords2algebraic(...c));
                if (ray.length >= 2) {
                    alln.delete(ray[1]);
                }
            }
        }
        // if any of the stars appear in this set, it's invalid
        if (stars.filter(s => alln.has(s)).length > 0) {
            return false;
        }
    }
    // if we get to this point, it's valid
    return true;
}

export class OmnyGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Omny",
        uid: "omny",
        playercounts: [2],
        version: "20250203",
        dateAdded: "2023-07-31",
        // i18next.t("apgames:descriptions.omny")
        description: "apgames:descriptions.omny",
        urls: ["https://boardgamegeek.com/boardgame/342418/omny"],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"]
            }
        ],
        variants: [
            {uid: "size-4", group: "board"},
            {uid: "size-5", group: "board"},
            {uid: "size-6", group: "board"},
            {uid: "size-7", group: "board"},
            {uid: "size-9", group: "board"},
            {uid: "size-10", group: "board"},
            {uid: "constellation", group: "stars"},
            {uid: "gyre", group: "stars"},
            {uid: "yex", group: "stars"},
            {uid: "random-3", group: "stars"},
            {uid: "random-5", group: "stars"},
            {uid: "random-7", group: "stars"},
            {uid: "random-9", group: "stars"},
            {uid: "free", group: "stars"},
            {uid: "captures"},
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>stack", "mechanic>move", "mechanic>coopt", "mechanic>random>setup", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "pie", "automove", "random-start"]
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private tmpstars = new Set<string>();
    public startStars?: string[];

    constructor(state?: IOmnyState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOmnyState;
            }
            if (state.game !== OmnyGame.gameinfo.uid) {
                throw new Error(`The Omny game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            if (state.startStars !== undefined) {
                this.startStars = [...state.startStars];
            }
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }

            const found = this.variants.find(v => v.startsWith("random"));
            if (found !== undefined) {
                const [,numStr] = found.split("-");
                const num = parseInt(numStr, 10);
                const g = this.graph;
                const shuffled = shuffle(g.graph.nodes()) as string[];
                const stars = [shuffled.pop()!];
                while (stars.length < num) {
                    // if we need the rest of the queue to end the loop,
                    // don't do any testing; just take them
                    if (shuffled.length === num - stars.length) {
                        stars.push(...shuffled);
                    }
                    // otherwise test the next one
                    else {
                        const next = shuffled.pop()!;
                        if (starsValid(g, [...stars, next])) {
                            stars.push(next);
                        }
                    }
                }
                this.startStars = [...stars];
            }

            const board = new Map<string,playerid[]>();
            const fresh: IMoveState = {
                _version: OmnyGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): OmnyGame {
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
        return this;
    }

    public get boardSize(): number {
        const found = this.variants.find(v => v.startsWith("size"));
        if (found !== undefined) {
            const [,numStr] = found.split("-");
            return parseInt(numStr, 10);
        }
        return 8;
    }

    public get graph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2)-1);
    }

    public get stars(): Set<string> {
        const set = new Set<string>();
        const g = this.graph;
        const size = this.boardSize;

        // freeform: derive from first two moves
        if (this.variants.includes("free")) {
            // first move
            if (this.stack.length > 1) {
                this.stack[1].lastmove!.split(",").slice(1).forEach(cell => set.add(cell));
            }
            // second move
            if (this.stack.length > 2) {
                this.stack[2].lastmove!.split(",").slice(1).forEach(cell => set.add(cell));
            }
        }
        // corners and centre
        else if (this.variants.includes("constellation")) {
            const yTop = 0;
            const yBot = (size * 2) - 2;
            const yMid = size - 1;
            const xRight = size - 1;
            const xMid = (size * 2) - 2;
            const xCtr = size - 1;
            set.add(g.coords2algebraic(0, yTop));
            set.add(g.coords2algebraic(xRight, yTop));
            set.add(g.coords2algebraic(0, yMid));
            set.add(g.coords2algebraic(xCtr, yMid));
            set.add(g.coords2algebraic(xMid, yMid));
            set.add(g.coords2algebraic(0, yBot));
            set.add(g.coords2algebraic(xRight, yBot));
        }
        // perimeter and centre
        else if (this.variants.includes("gyre")) {
            [...g.getEdges().values()].forEach(edge => edge.forEach(cell => set.add(cell)));
            set.add(g.coords2algebraic(size - 1, size - 1));
        }
        // alternating corners
        else if (this.variants.includes("yex")) {
            set.add(g.coords2algebraic(0, 0));
            set.add(g.coords2algebraic((size * 2) - 2, size - 1));
            set.add(g.coords2algebraic(0, (size * 2) - 2));
        }
        // random start
        else if (this.startStars !== undefined) {
            this.startStars.forEach(cell => set.add(cell));
        }
        // default Sunder (all cells)
        else {
            g.graph.nodes().forEach(cell => set.add(cell));
        }

        return set;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        if (this.variants.includes("free") && this.stack.length <= 2) {
            return [];
        }

        const moves: string[] = [];
        const graph = this.graph.graph;

        // placements first
        for (const cell of graph.nodes()) {
            if (! this.board.has(cell)) {
                moves.push(cell);
            }
        }

        if (this.variants.includes("captures")) {
            const mypieces = [...this.board.entries()].filter(([,stack]) => stack[stack.length - 1] === player).map(e => e[0]);
            // movements
            for (const cell of mypieces) {
                const stack = this.board.get(cell)!;
                for (const n of graph.neighbors(cell)) {
                    if (this.board.has(n)) {
                        const nStack = this.board.get(n)!;
                        if ( (stack.length === nStack.length) && (nStack[nStack.length - 1] !== player) ) {
                            moves.push(`${cell}-${n}`);
                        }
                    }
                }
            }
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
            const cell = this.graph.coords2algebraic(col, row);
            let newmove: string;

            // handle freeform placement first
            if (this.variants.includes("free") && this.stack.length <= 2) {
                if (move === "") {
                    newmove = cell;
                } else {
                    const cells = move.split(",");
                    // if the cell is already starred by the previous player, ignore
                    if (this.stars.has(cell)) {
                        newmove = move;
                    }
                    // duplicate cell means remove it
                    else if (cells.slice(1).includes(cell)) {
                        const pc = cells[0];
                        const newcells = cells.slice(1).filter(c => c !== cell);
                        newmove = [pc, ...newcells].join(",");
                    }
                    // otherwise add to the chain
                    else {
                        newmove = [...cells, cell].join(",");
                    }
                }
            }
            // all other scenarios
            else {
                // starting fresh
                if (move.length === 0) {
                    // if empty, place
                    if (! this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        const contents = this.board.get(cell)!;
                        // if yours, then assume movement
                        if (contents[contents.length - 1] === this.currplayer) {
                            newmove = cell;
                        } else {
                            newmove = move;
                        }
                    }
                }
                // adding to existing string
                else {
                    // if existing cell, possible movement
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell)!;
                        // can't be yours
                        if (contents[contents.length - 1] !== this.currplayer) {
                            newmove = `${move}-${cell}`;
                        } else {
                            newmove = move;
                        }
                    }
                    // otherwise, reset entire move
                    else {
                        newmove = cell;
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.omny.INITIAL_INSTRUCTIONS");
            return result;
        }

        const g = this.graph;
        const graph = g.graph;

        // handle freeform setup first
        if (this.variants.includes("free") && this.stack.length <= 2) {
            const cells = m.split(",");

            // valid cells
            for (const cell of cells) {
                if (!graph.nodes().includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }

            // pc cell is empty
            if (this.board.has(cells[0])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cells[0]});
                return result;
            }

            // no duplicates
            const set = new Set<string>(cells.slice(1));
            if (set.size !== cells.slice(1).length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.omny.NO_DUPES");
                return result;
            }

            let complete: 1|0|-1 = -1;
            // P1 restrictions
            if (this.stack.length === 1) {
                if (cells.length > 2 && cells.length - 1 < graph.nodes().length) {
                    complete = 0
                } else if (cells.length - 1 === graph.nodes().length) {
                    complete = 1;
                }
            }
            // P2 restrictions
            else {
                if (cells.length > 0) {
                    complete = 0;
                    if (this.stars.size + cells.length - 1 === graph.nodes().length) {
                        complete = 1;
                    }
                }
            }

            // we're good, but never complete
            result.valid = true;
            result.complete = complete;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.omny.PARTIAL_SETUP", {context: this.stack.length === 1 ? "p1" : "p2"});
            return result;

        }
        // all other scenarios
        else {
            const [from, to] = m.split("-");
            // valid cell
            if (! graph.nodes().includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }

            if (to === undefined) {
                // if empty, move is over
                if (! this.board.has(from)) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }

                // if captures aren't active, then moves are not possible
                if (!this.variants.includes("captures")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.omny.BAD_MOVE");
                    return result;
                }

                const contents = this.board.get(from)!;
                // if enemy, invalid
                if (contents[contents.length - 1] !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }

                // otherwise, assume valid partial
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.omny.PARTIAL_MOVE");
                return result;
            } else {
                // if captures aren't active, then moves are not possible
                if (!this.variants.includes("captures")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.omny.BAD_MOVE");
                    return result;
                }

                // valid cell
                if (! graph.nodes().includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }

                if (! graph.neighbors(from).includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.omny.ADJACENCY");
                    return result;
                }

                // must be occupied
                if (! this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.omny.EMPTY_MOVE");
                    return result;
                }

                const contents = this.board.get(to)!;
                // must belong to opponent
                if (contents[contents.length - 1] === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.omny.FRIENDLY_CAPTURE");
                    return result;
                }

                const fContents = this.board.get(from)!;
                // must be same height
                if (fContents.length !== contents.length) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.omny.SAME_HEIGHT");
                    return result;
                }

                // all good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): OmnyGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if ( (! result.valid) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && (!this.variants.includes("free") || this.stack.length > 2) && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.tmpstars.clear();

        // handle setup scenarios first
        if (this.variants.includes("free") && this.stack.length <= 2) {
            const cells = m.split(",");
            this.board.set(cells[0], [this.currplayer]);
            cells.slice(1).forEach(cell => this.tmpstars.add(cell));
        }
        // everything else
        else {
            if (m.includes("-")) {
                const [from, to] = m.split("-");
                const fStack = this.board.get(from)!;
                const tStack = this.board.get(to)!;
                const pc = fStack[fStack.length - 1];
                const newFrom = fStack.slice(0, fStack.length - 1);
                if (newFrom.length > 0) {
                    this.board.set(from, [...newFrom]);
                } else {
                    this.board.delete(from);
                }
                this.board.set(to, [...tStack, pc]);
                this.results.push({type: "move", from, to});
            } else {
                this.board.set(m, [this.currplayer]);
                this.results.push({type: "place", where: m});
            }
        }

        if (partial) { return this; }

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

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    private getGroupWith(cell: string): string[] {
        const contents = this.board.get(cell)!;
        const player = contents[contents.length - 1];
        const g = this.graph.graph;
        for (const node of [...g.nodes()]) {
            if (!this.board.has(node)) {
                g.dropNode(node);
            } else {
                const stack = this.board.get(node)!;
                if (stack[stack.length - 1] !== player) {
                    g.dropNode(node);
                }
            }
        }
        const conn = connectedComponents(g);
        return conn.find(grp => grp.includes(cell)) || [];
    }

    // if even one group has a majority, return false
    private isWinningMove(cell: string): boolean {
        const allStars = this.stars;
        let majority = Math.ceil(allStars.size / 2);
        if (allStars.size % 2 === 0) {
            majority++;
        }
        const g = this.graph.graph;
        const group = this.getGroupWith(cell);
        group.forEach(node => g.dropNode(node));
        const grps = connectedComponents(g);
        for (const grp of grps) {
            let numStars = 0;
            grp.forEach(node => {
                if (allStars.has(node)) {
                    numStars++;
                }
            });
            if (numStars >= majority) {
                return false;
            }
        }
        return true;
    }

    protected checkEOG(): OmnyGame {
        const prev = this.currplayer === 1 ? 2 : 1;
        if (this.lastmove !== undefined && !this.lastmove.includes(",")) {
            let cell = this.lastmove;
            if (cell.includes("-")) {
                cell = cell.split("-")[1];
            }
            if (this.isWinningMove(cell)) {
                this.gameover = true;
                this.winner = [prev];
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

    public state(): IOmnyState {
        return {
            game: OmnyGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            startStars: this.startStars !== undefined ? [...this.startStars] : undefined,
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: OmnyGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid[]>,
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let vertexStyle = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "vertex-style") {
                vertexStyle = true;
            }
        }
        const g = this.graph;
        const graph = g.graph;
        const stars = this.stars;

        // Build piece string
        const pieces: string[][] = [];
        for (const row of g.listCells(true) as string[][]) {
            const node: string[] = [];
            for (const cell of row) {
                if ( (! graph.hasNode(cell)) || (! this.board.has(cell)) ) {
                    node.push("-");
                } else if (this.board.has(cell)) {
                    const contents = this.board.get(cell)! as number[];
                    // if on a star point, change the glyph name
                    if (stars.has(cell) || this.tmpstars.has(cell)) {
                        contents[contents.length - 1] = contents[contents.length - 1] === 1 ? 3 : 4;
                    }
                    node.push(contents.join("").replace(/1/g, "A").replace(/2/g, "B").replace(/3/g, "Y").replace(/4/g, "Z"));
                }
            }
            pieces.push(node);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        let starMarks: MarkerGlyph|MarkerDots;
        if (vertexStyle) {
            starMarks = {
                type: "dots",
                points: [...stars].map(node => {
                    const [col, row] = g.algebraic2coords(node);
                    return {row, col};
                }),
            } as MarkerDots;
        } else {
            starMarks = {
                type: "glyph",
                glyph: "STAR",
                points: [...stars].map(node => {
                    const [col, row] = g.algebraic2coords(node);
                    return {row, col};
                }),
            } as MarkerGlyph;
        }
        if (this.tmpstars.size > 0) {
            [...this.tmpstars].forEach(node => {
                const [col, row] = g.algebraic2coords(node);
                starMarks.points.push({row, col});
            })
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: vertexStyle ? "hex-of-tri" : "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                markers: starMarks.points.length > 0 ? [starMarks] : undefined,
            },
            legend: {
                A: {
                        name: "piece",
                        colour: 1,
                },
                B: {
                        name: "piece",
                        colour: 2,
                },
                Y: [
                    {
                        name: "piece",
                        colour: 1,
                    },
                    {
                        name: "star-solid",
                        colour: {
                            func: "flatten",
                            fg: "_context_fill",
                            bg: 1,
                            opacity: 0.25,
                        },
                        scale: 0.5,
                    },
                ],
                Z: [
                    {
                        name: "piece",
                        colour: 2,
                    },
                    {
                        name: "star-solid",
                        colour: {
                            func: "flatten",
                            fg: "_context_fill",
                            bg: 2,
                            opacity: 0.25,
                        },
                        scale: 0.5,
                    },
                ],
                STAR: {
                    name: "star-solid",
                    colour: {
                        func: "flatten",
                        fg: "_context_fill",
                        bg: "_context_background",
                        opacity: 0.1,
                    },
                    scale: 0.5,
                },
            },
            pieces: pstr
        };


        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = g.algebraic2coords(move.from);
                    const [tx, ty] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }

        return rep;
    }

    // public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
    //     let resolved = false;
    //     switch (r.type) {
    //         case "place":
    //             node.push(i18next.t("apresults:PLACE.omny", {player, where: r.where}));
    //             resolved = true;
    //             break;
    //     }
    //     return resolved;
    // }

    public getStartingPosition(): string {
        if (this.startStars !== undefined && this.startStars.length > 0) {
            return this.startStars.join(",");
        }
        return "";
    }

    public clone(): OmnyGame {
        return Object.assign(new OmnyGame(), deepclone(this) as OmnyGame);
        // return new OmnyGame(this.serialize());
    }
}
