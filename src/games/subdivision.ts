/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { shuffle, SquareGraph, SquareOrthGraph } from "../common";
import { APRenderRep, AreaPieces, Glyph, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = require("rfdc/default");

export type playerid = 1|2|3|4;

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

type Stash = [number, number, number];
export type Size = 1|2|3;
export type CellContents = [playerid, Size] | "X";

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface ISubdivisionState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SubdivisionGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Subdivision",
        uid: "subdivision",
        playercounts: [2,3,4],
        version: "20241203",
        dateAdded: "2024-12-13",
        // i18next.t("apgames:descriptions.subdivision")
        description: "apgames:descriptions.subdivision",
        urls: [
            "https://looneypyramids.wiki/wiki/Subdivision",
            "https://boardgamegeek.com/boardgame/31507/subdivision",
        ],
        people: [
            {
                type: "designer",
                name: "Carlton Noles",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9260/carlton-noles"]
            }
        ],
        variants: [
            {
                uid: "manualParks",
                group: "parks",
            },
            {
                uid: "randomParks",
                group: "parks",
            },
            {
                uid: "parkControl",
                group: "scoring",
            }
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>pyramids"],
        flags: ["scores", "custom-colours", "custom-buttons", "random-start", "automove"]
    };

    public numplayers!: number;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []

    public get boardsize(): 6|7|8 {
        if (this.numplayers === 2) {
            return 6;
        } else if (this.numplayers === 3) {
            return 7;
        } else {
            return 8;
        }
    }

    public get numParks(): 4|6 {
        if (this.numplayers === 2) {
            return 6;
        } else {
            return 4;
        }
    }

    public get graphFull(): SquareGraph {
        return new SquareGraph(this.boardsize, this.boardsize);
    }

    public get graphOrth(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardsize, this.boardsize);
    }

    constructor(state: number | ISubdivisionState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const scores: number[] = [];
            for (let i = 0; i < this.numplayers; i++) {
                scores.push(0);
            }
            if (variants !== undefined && Array.isArray(variants) && variants.length > 0) {
                // manual park placement is not possible in 3-player games
                for (const v of variants) {
                    if (v === "manualParks" && this.numplayers === 3) {
                        continue;
                    }
                    this.variants.push(v);
                }
            }
            const board = new Map<string, CellContents>();
            if (this.variants.includes("randomParks")) {
                const shuffled = shuffle(this.graphFull.listCells(false) as string[]) as string[];
                for (let i = 0; i < this.numParks; i++) {
                    board.set(shuffled[i], "X");
                }
            } else if (!this.variants.includes("manualParks")) {
                const parks: string[] = [];
                if (this.numplayers === 2) {
                    parks.push("a1", "a6", "f1", "f6", "c3", "d4");
                } else if (this.numplayers === 3) {
                    parks.push("a1", "a7", "g1", "g7");
                } else {
                    parks.push("a1", "a8", "h1", "h8");
                }
                for (const park of parks) {
                    board.set(park, "X");
                }
            }

            const fresh: IMoveState = {
                _version: SubdivisionGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISubdivisionState;
            }
            if (state.game !== SubdivisionGame.gameinfo.uid) {
                throw new Error(`The Subdivision game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.variants = [...state.variants];
        }
        this.load();
    }

    public load(idx = -1): SubdivisionGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = clone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        return this;
    }

    public getStash(player: playerid): Stash {
        const stash: Stash = [5,5,5];
        const owned = [...this.board.values()].filter(pc => pc !== "X" && pc[0] === player) as [playerid, Size][];
        for (const [,size] of owned) {
            stash[size-1]--;
        }
        return stash;
    }

    private needsParks(): boolean {
        const parks = [...this.board.values()].filter(pc => pc === "X");
        return parks.length < this.numParks;
    }

    private validOne(cell: string, player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        let valid = false;
        for (const n of this.graphFull.neighbours(cell)) {
            if (this.board.has(n)) {
                const nPc = this.board.get(n)!;
                if (Array.isArray(nPc) && nPc[0] !== player && (nPc[1] === 1 || nPc[1] === 3)) {
                    valid = true;
                    break;
                }
            }
        }
        return valid;
    }

    private validThree(cell: string, player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        let valid = true;
        for (const n of this.graphFull.neighbours(cell)) {
            if (this.board.has(n)) {
                const nPc = this.board.get(n)!;
                if (Array.isArray(nPc) && nPc[0] === player && nPc[1] === 3) {
                    valid = false;
                    break;
                }
            }
        }
        return valid;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        const moves: string[] = [];
        const g = this.graphFull;
        const empty = [...(g.listCells(false) as string[])].filter(cell => !this.board.has(cell));

        // check for park placement
        if (this.variants.includes("manualParks") && this.needsParks()) {
            moves.push(...empty);
        }
        // otherwise check for placement
        else {
            const stash = this.getStash(player);
            for (const cell of empty) {
                for (const size of [1,2,3] as Size[]) {
                    // skip if you don't have any pieces of that size
                    if (stash[size-1] < 1) { continue; }
                    // check placement rules
                    if (size === 1) {
                        if (this.validOne(cell, player)) {
                            moves.push(`1${cell}`);
                        }
                    } else if (size === 3) {
                        if (this.validThree(cell, player)) {
                            moves.push(`3${cell}`);
                        }
                    } else {
                        moves.push(`2${cell}`);
                    }
                }
            }
        }

        // may only pass if no available moves
        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public getButtons(): ICustomButton[] {
        if (this.moves().includes("pass")) return [{ label: "pass", move: "pass" }];
        return [];
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graphFull;
            let newmove: string;

            if (row >= 0 && col >= 0) {
                const cell = g.coords2algebraic(col, row);
                newmove = `${move}${cell}`;
            } else {
                if (piece !== undefined) {
                    newmove = piece[1];
                } else {
                    newmove = "";
                }
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.subdivision.INITIAL_INSTRUCTIONS", {context: this.needsParks() ? "parks" : "place"})
            return result;
        }

        if (m === "pass") {
            const moves = this.moves();
            if (!moves.includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.BAD_PASS")
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        const g = this.graphFull;

        // park placement
        if (m.length === 2) {
            // parks are valid
            if (!this.needsParks()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.BAD_PARK")
                return result;
            }
            // valid space
            if (!(g.listCells(false) as string[]).includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // the space is empty
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // piece placement
        else if (m.length === 3) {
            const size = parseInt(m[0], 10);
            const cell = m.substring(1);

            // all parks are present
            if (this.needsParks()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.NEED_PARKS")
                return result;
            }

            // valid size
            if (![1,2,3].includes(size)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.INVALID_SIZE")
                return result;
            }
            // enough pieces
            if (this.getStash(this.currplayer)[size-1] < 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.NO_PIECE", {size})
                return result;
            }
            // valid space
            if (!(g.listCells(false) as string[]).includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // the space is empty
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
            // meets placement restrictions
            if (size === 1 && !this.validOne(cell, this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.BAD_ONE")
                return result;
            }
            if (size === 3 && !this.validThree(cell, this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.BAD_THREE")
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // check for partial placement
        else if (m.length === 1) {
            const size = parseInt(m, 10);
            // valid size
            if (![1,2,3].includes(size)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.INVALID_SIZE")
                return result;
            }
            // enough pieces
            if (this.getStash(this.currplayer)[size-1] < 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.subdivision.NO_PIECE", {size})
                return result;
            }

            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.subdivision.PARTIAL_PLACEMENT", {size: size === 1 ? "small" : size === 2 ? "medium" : "large"});
            return result;
        }

        // if we get here, something is wrong
        result.valid = false;
        result.message = i18next.t("apgames:validation._general.INVALID_MOVE")
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): SubdivisionGame {
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
            } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        // park placements
        if (m.length === 2) {
            this.board.set(m, "X");
            this.results.push({type: "place", what: "park", where: m});
        }
        // piece placements
        else if (m.length === 3) {
            const size = parseInt(m[0], 10) as Size;
            const cell = m.substring(1);
            this.board.set(cell, [this.currplayer, size]);
            this.results.push({type: "place", what: size.toString(), where: cell});
        }
        // passing
        else if (m === "pass") {
            this.results.push({type: "pass"});
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

    private someoneCanMove(): boolean {
        let canmove = false;
        for (let p = 1; p <= this.numplayers; p++) {
            const moves = this.moves(p as playerid);
            if (moves.length > 1 || moves[0] !== "pass") {
                canmove = true;
                break;
            }
        }
        return canmove;
    }

    protected checkEOG(): SubdivisionGame {
        if ([...this.board.keys()].length === this.boardsize**2 || !this.someoneCanMove()) {
            this.gameover = true;
            const scores: number[] = [];
            for (let p = 1; p <= this.numplayers; p++) {
                scores.push(this.getPlayerScore(p as playerid));
            }
            const max = Math.max(...scores);
            this.winner = [];
            for (let p = 1; p <= this.numplayers; p++) {
                if (this.getPlayerScore(p as playerid) === max) {
                    this.winner.push(p as playerid);
                }
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

    public state(): ISubdivisionState {
        return {
            game: SubdivisionGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SubdivisionGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: clone(this.board) as Map<string, CellContents>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const g = this.graphFull;
        const prefixes = ["A", "B", "C", "D"];
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = g.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (Array.isArray(contents)) {
                        pieces.push(`${prefixes[contents[0]-1]}${contents[1]}`);
                    } else {
                        pieces.push("-");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }


        const myLegend: ILegendObj = {
            "SPACER": {
                name: "piece-square-borderless",
                colour: "_context_background",
            }
        };
        for (let n = 0; n < this.numplayers; n++) {
            myLegend[prefixes[n] + "1"] = {
                name: "pyramid-up-small-upscaled",
                colour: n > 1 ? n+2 : n+1,
            };
            myLegend[prefixes[n] + "2"] = {
                name: "pyramid-up-medium-upscaled",
                colour: n > 1 ? n+2 : n+1,
            };
            myLegend[prefixes[n] + "3"] = {
                name: "pyramid-up-large-upscaled",
                colour: n > 1 ? n+2 : n+1,
            };
        }

        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const stash = this.getStash(p as playerid);
            // don't render any stash if it's empty
            if (stash.reduce((prev, curr) => prev + curr, 0) === 0) {
                continue;
            }
            const pcs: string[] = [];
            for (let size = 1; size <= 3; size++) {
                // skip empty rows
                if (stash[size-1] === 0) { continue; }
                for (let i = 0; i < 5; i++) {
                    if (stash[size-1] > i) {
                        pcs.push(`${prefixes[p-1]}${size}`);
                    } else {
                        pcs.push("SPACER");
                    }
                }
            }
            if (pcs.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: pcs as [string, ...string[]],
                    width: 5,
                    label: i18next.t("apgames:validation.subdivision.LABEL_STASH", {playerNum: p}) || "local"
                });
            }
        }

        let markers: MarkerFlood[]|undefined;
        const parks = [...this.board.entries()].filter(([,pc]) => pc === "X").map(([c,]) => c);
        if (parks.length > 0) {
            const rc: RowCol[] = [];
            for (const park of parks) {
                const [x,y] = g.algebraic2coords(park);
                rc.push({row: y, col: x});
            }
            markers = [{
                type: "flood",
                colour: 3,
                opacity: 0.5,
                points: rc as [RowCol, ...RowCol[]],
            }];
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardsize,
                height: this.boardsize,
                markers,
            },
            legend: myLegend,
            pieces: pstr,
            areas,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [toX, toY] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayerScore(player: number): number {
        const owned = [...this.board.entries()].filter(([,pc]) => pc !== "X" && pc[0] === player) as [string, [playerid, Size]][];
        const cells = owned.map(([cell,]) => cell);
        const contents = owned.map(([,pc]) => pc);
        // add up all the placed pieces
        let score = contents.reduce((prev, curr) => prev + curr[1], 0);
        // subtract the number of groups
        const gOrth = this.graphOrth;
        for (const node of gOrth.graph.nodes()) {
            if (!cells.includes(node)) {
                gOrth.graph.dropNode(node);
            }
        }
        const connected = connectedComponents(gOrth.graph);
        score -= connected.length;
        // now look for smalls near larges
        const larges = owned.filter(([,pc]) => pc[1] === 3).map(([cell,]) => cell);
        const g = this.graphFull;
        for (const cell of larges) {
            let smalls = 0
            for (const n of g.neighbours(cell)) {
                if (this.board.has(n)) {
                    const pc = this.board.get(n)!;
                    if (Array.isArray(pc) && pc[1] === 1) {
                        smalls++;
                    }
                }
            }
            // the first small is free
            if (smalls > 0) {
                smalls--;
            }
            if (smalls > 3) {
                smalls = 3;
            }
            score -= smalls;
        }

        // park control, when specified
        if (this.variants.includes("parkControl")) {
            const parks = [...this.board.entries()].filter(([,pc]) => pc === "X").map(([cell,]) => cell);
            for (const park of parks) {
                const near: (CellContents|undefined)[] = [];
                for (const n of g.neighbours(park)) {
                    if (!this.board.has(n)) {
                        near.push(undefined);
                    } else {
                        const pc = this.board.get(n)!;
                        if (Array.isArray(pc)) {
                            near.push(pc);
                        }
                    }
                }
                // if there's any empty spaces, no bonus
                if (near.includes(undefined)) {
                    continue;
                }
                // all pieces must belong to the current player
                let allMine = true;
                for (const [p,] of near as CellContents[]) {
                    if (p !== player) {
                        allMine = false;
                        break;
                    }
                }
                if (allMine) {
                    score += 3;
                }
            }
        }

        return score;
    }

    public getPlayersScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        return [{ name: i18next.t("apgames:status.SCORES"), scores}];
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        if (r.type === "place") {
            // park, 1, 2, 3
            if (r.what === "park") {
                node.push(i18next.t("apresults:PLACE.subdivision", {context: r.what, player, where: r.where}));
            } else {
                node.push(i18next.t("apresults:PLACE.PYRAMID", {context: r.what, player, where: r.where}));
            }
            return true;
        }
        return false;
    }

    public getPlayerColour(p: playerid): number | string {
        return p > 2 ? p+1 : p;
    }

    public getStartingPosition(): string {
        const parks = [...this.board.entries()].filter(([,pc]) => pc === "X").map(([cell,]) => cell).sort((a,b) => a.localeCompare(b));
        return parks.join(",");
    }

    public clone(): SubdivisionGame {
        return Object.assign(new SubdivisionGame(this.numplayers), clone(this) as SubdivisionGame);
    }
}
