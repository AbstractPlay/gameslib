import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Colourfuncs, Colourstrings, Glyph, MarkerFlood, PatternName, PositiveInteger, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
import { CifraGraph } from "./cifra/graph";

export type playerid = 1|2;
export type ContentsDash = playerid;
export type ContentsSum = {p: playerid, v: number};
export type CellContents = ContentsDash|ContentsSum;
export type Shade = "L"|"D";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface ICifraState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    startpos: Array<Shade>;
};

interface IBuffer {
    width: number;
    pattern?: PatternName;
    show?: ("N"|"E"|"S"|"W")[];
    colours?: {
      side: "N" | "E" | "S" | "W";
      colour: PositiveInteger | Colourstrings | Colourfuncs;
    }[];
};

export class CifraGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "CIFRA",
        uid: "cifra",
        playercounts: [2],
        version: "20250215",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.cifra")
        description: "apgames:descriptions.cifra",
        urls: ["https://boardgamegeek.com/boardgame/360439/cifra-code25"],
        people: [
            {
                type: "designer",
                name: "Mitsuo Yamamoto",
            },
            {
                type: "publisher",
                name: "Logy Games",
                urls: ["http://www.logygames.com/"],
            },
        ],
        variants: [
            {uid: "size-9", group: "board"},
            {uid: "king", group: "mode"},
            {uid: "sum", group: "mode"},
        ],
        categories: ["goal>royal-capture", "goal>royal-escape", "goal>score>eog", "mechanic>place", "mechanic>move", "mechanic>capture", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["experimental", "automove", "custom-buttons", "custom-colours", "scores", "custom-randomization"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public startpos: Array<Shade>;
    private highlights: string[] = [];

    constructor(state?: ICifraState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            // randomize cells
            const half = ((this.boardSize * this.boardSize) - 1) / 2;
            const p1 = Array.from({length: half}, () => "L").join("");
            const p2 = Array.from({length: half}, () => "D").join("");
            this.startpos = shuffle([...p1, ...p2]) as Shade[];

            const board = new Map<string, CellContents>();

            const fresh: IMoveState = {
                _version: CifraGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICifraState;
            }
            if (state.game !== CifraGame.gameinfo.uid) {
                throw new Error(`The Cifra engine cannot process a game of '${state.game}'.`);
            }
            this.startpos = [...state.startpos];
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CifraGame {
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
        return this;
    }

    public get boardSize(): number {
        if (this.variants.includes("size-9")) {
            return 9;
        } else {
            return 5;
        }
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        // side choosing
        if (this.stack.length === 1) {
            return ["light,top", "light,bottom", "dark,top", "dark,bottom"];
        }

        // don't generate opening moves for variants
        if ((this.variants.includes("king") || this.variants.includes("sum")) && this.stack.length <= 3) {
            return [];
        }

        const g = new CifraGraph(this.startpos, this.getPlayerShade(this.currplayer)!);
        const myHome = this.getHomeRow(this.currplayer)!;
        const theirHome = myHome === "1" ? this.boardSize.toString() : "1";
        const allMine = [...this.board.entries()].filter(([, p]) => (p as ContentsDash) === this.currplayer || (p as ContentsSum).p === this.currplayer).map(([c,]) => c);
        const unlocked = allMine.filter(c => !c.endsWith(theirHome));

        const moves: string[] = [];

        for (const cell of unlocked) {
            for (const dir of allDirections) {
                let ray = g.weightedRay(cell, dir);
                // trim to first occupied
                const idx = ray.findIndex(c => this.board.has(c));
                if (idx >= 0) {
                    ray = ray.slice(0, idx+1);
                }
                if (ray.length > 0) {
                    // if last cell is friendly occupied or locked, lop it off
                    if (allMine.includes(ray[ray.length - 1]) || (this.board.has(ray[ray.length - 1]) && ray[ray.length - 1].endsWith(myHome)) ) {
                        ray = ray.slice(0, -1);
                    }
                    // each surviving cell is a valid move target
                    for (const next of ray) {
                        if (this.board.has(next)) {
                            moves.push(`${cell}x${next}`);
                        } else {
                            moves.push(`${cell}-${next}`);
                        }
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b))
    }

    public getButtons(): ICustomButton[] {
        if (this.stack.length === 1) {
            return [
                { label: "cifra.lt", move: "light,top" },
                { label: "cifra.lb", move: "light,bottom" },
                { label: "cifra.dt", move: "dark,top" },
                { label: "cifra.db", move: "dark,bottom" },
            ];
        }
        return [];
    }

    public randomMove(): string {
        if (this.stack.length === 1) {
            const shuffled = shuffle(["light,top", "light,bottom", "dark,top", "dark,bottom"]) as string[];
            return shuffled[0];
        } else if ( (this.variants.includes("sum") || this.variants.includes("king")) && this.stack.length <= 3) {
            const pcs: number[] = [];
            for (let i = 1; i <= this.boardSize; i++) {
                pcs.push(i);
            }
            const mv: string[] = [];
            const shuffled = shuffle(pcs) as number[];
            const row = this.getHomeCol(this.currplayer)!;
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                mv.push(`${shuffled[col]}${cell}`);
            }
            return mv.join(",");
        } else {
            const moves = this.moves();
            return moves[Math.floor(Math.random() * moves.length)];
        }
    }

    public getHomeRow(p: playerid): string|undefined {
        if (this.stack.length === 1) {
            return undefined;
        }
        const [, position] = this.stack[1].lastmove!.split(",");
        const num1 = position === "top" ? this.boardSize : 1;
        const num2 = num1 === 1 ? this.boardSize : 1;
        return p === 1 ? num1.toString() : num2.toString();
    }

    public getHomeCol(p: playerid): number|undefined {
        if (this.stack.length === 1) {
            return undefined;
        }
        const [, position] = this.stack[1].lastmove!.split(",");
        const num1 = position === "top" ? 0 : this.boardSize - 1;
        const num2 = num1 === 0 ? this.boardSize - 1 : 0;
        return p === 1 ? num1 : num2;
    }

    public getPlayerColour(p: playerid): number|string {
        if (this.stack.length === 1) {
            return "#808080";
        }
        const [shade,] = this.stack[1].lastmove!.split(",");
        const c1 = shade === "light" ? "_context_background" : 2;
        const c2 = c1 === 2 ? "_context_background" : 2;
        return p === 1 ? c1 : c2;
    }

    public getPlayerShade(p: playerid): Shade|undefined {
        if (this.stack.length === 1) {
            return undefined
        }
        const [shade,] = this.stack[1].lastmove!.split(",");
        const c1 = shade === "light" ? "L" : "D";
        const c2 = c1 === "L" ? "D" : "L";
        return p === 1 ? c1 : c2;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string;
            let cell: string|undefined;
            if (row >= 0 && col >= 0) {
                cell = this.coords2algebraic(col, row);
            }

            if (move.length === 0) {
                if (cell === undefined) {
                    if (piece === undefined) {
                        throw new Error("No piece passed.");
                    }
                    newmove = piece.substring(piece.length - 1);
                } else {
                    newmove = cell;
                }
            } else {
                // selecting a different off-board piece
                if (cell === undefined) {
                    if (piece === undefined) {
                        throw new Error("No piece passed.");
                    }
                    const pc = piece.substring(piece.length - 1);
                    const lst = move.split(",");
                    const idx = lst.findIndex(l => l.startsWith(pc));
                    if (idx >= 0) {
                        lst.splice(idx, 1);
                    }
                    lst.push(pc);
                    newmove = lst.join(",");
                }
                // choosing a destination, or selecting a new piece to move
                else {
                    // either capture or reselection
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell)!;
                        if ((contents as ContentsDash) === this.currplayer || (contents as ContentsSum).p === this.currplayer) {
                            newmove = cell;
                        } else {
                            newmove = `${move}x${cell}`;
                        }
                    }
                    // destination
                    else {
                        // initial placement
                        if (move.length === 1 || move.includes(",")) {
                            let lst = move.split(",");
                            const idx = lst.findIndex(l => l.endsWith(cell!));
                            if (idx >= 0) {
                                lst = lst.splice(idx, 1);
                            }
                            if (lst[lst.length - 1].length === 1) {
                                lst[lst.length - 1] += cell;
                            }
                            newmove = lst.join(",");
                        } else {
                            newmove = `${move}-${cell}`;
                        }
                    }
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
            let context = "play";
            if (this.stack.length === 1) {
                context = "choose";
            } else if ((this.variants.includes("king") || this.variants.includes("sum")) && this.stack.length <= 2) {
                context = "setup";
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.cifra.INITIAL_INSTRUCTIONS", {context});
            return result;
        }

        // setup scenarios first
        if (this.stack.length === 1) {
            const [shade, pos] = m.split(",")
            if ( (shade === "light" || shade === "dark") && (pos === "top" || pos === "bottom") ) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.cifra.INITIAL_INSTRUCTIONS", {context: "choose"});
                return result;
            }
        }
        else if ((this.variants.includes("king") || this.variants.includes("sum")) && this.stack.length <= 3) {
            const homeRow = this.getHomeRow(this.currplayer)!;
            const lst = m.split(",");
            const setPcs = new Set<string>();
            for (let i = 1; i <= this.boardSize; i++) {
                setPcs.add(i.toString());
            }
            const setCells = new Set<string>();
            for (const l of lst) {
                const num = l[0];
                const cell = l.substring(1);
                // no dupes
                if (!setPcs.has(num)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cifra.NO_DUPES", {context: "pc"});
                    return result;
                }
                setPcs.delete(num);
                if (l.length > 1) {
                    // no dupes
                    if (setCells.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.cifra.NO_DUPES", {context: "cell"});
                        return result;
                    }
                    setCells.add(cell);
                    // only on home row
                    if (!cell.endsWith(homeRow)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.cifra.ONLY_HOME");
                        return result;
                    }
                }
            }

            // if the last cell isn't complete, partial
            if (lst[lst.length - 1].length === 1) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.cifra.PARTIAL_PLACE", {piece: lst[lst.length - 1]});
                return result;
            } else {
                if (setPcs.size === 0 && setCells.size === this.boardSize) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.cifra.PARTIAL_SETUP", {count: setPcs.size});
                    return result;
                }
            }
        }

        // the rest of the scenarios
        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.cifra.PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.cifra.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): CifraGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && allMoves.length > 0 && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.highlights = [];

        // should only ever be partial if moving a piece or in setup phase
        // so highlight destinations and get out
        if (partial) {
            // setup scenario
            if ((this.variants.includes("king") || this.variants.includes("sum")) && this.stack.length <= 3) {
                // in this case, just place the pieces
                const parts = m.split(",");
                for (const part of parts) {
                    const v = parseInt(part[0], 10);
                    const cell = part.substring(1);
                    this.board.set(cell, {p: this.currplayer, v} as ContentsSum);
                }
            } else {
                this.highlights = allMoves.filter(mv => mv.startsWith(m)).map(mv => mv.substring(mv.length - 2));
            }
            return this;
        }

        // choosing sides
        if (this.stack.length === 1) {
            this.results.push({type: "affiliate", which: m});
            // if in default Dash mode, populate the board
            if (!this.variants.includes("king") && !this.variants.includes("sum")) {
                const [, pos] = m.split(",");
                const row1 = pos === "top" ? 0 : this.boardSize - 1;
                const row2 = row1 === 0 ? this.boardSize - 1 : 0;
                for (let col = 0; col < this.boardSize; col++) {
                    const cell1 = this.coords2algebraic(col, row1);
                    this.board.set(cell1, 1);
                    const cell2 = this.coords2algebraic(col, row2);
                    this.board.set(cell2, 2);
                }
            }
        }
        // setup of King or Sum modes
        else if ((this.variants.includes("king") || this.variants.includes("sum")) && this.stack.length <= 3) {
            const parts = m.split(",");
            for (const part of parts) {
                const v = parseInt(part[0], 10);
                const cell = part.substring(1);
                this.board.set(cell, {p: this.currplayer, v} as ContentsSum);
                this.results.push({type: "place", what: part[0], where: cell});
            }
            // strip the move notation to just the values
            m = parts.map(pt => pt[0]).join(",");
        }
        // everything else
        else {
            const [from, to] = m.split(/[-x]/);
            const fContents = this.board.get(from)!;
            const tContents = this.board.get(to);
            this.board.set(to, fContents);
            this.board.delete(from);
            this.results.push({type: "move", from, to});
            if (tContents !== undefined) {
                this.results.push({type: "capture"});
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

    public getPlayerScore(player: number): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.variants.includes("king")) {
            return 0;
        } else if (this.variants.includes("sum")) {
            const scoreRow = this.getHomeRow(player === 1 ? 2 : 1);
            if (scoreRow !== undefined) {
                const locked = [...this.board.entries()].filter(([c,pc]) => c.endsWith(scoreRow) && (pc as ContentsSum).p === player).map(([,pc]) => (pc as ContentsSum).v);
                return locked.reduce((acc, curr) => acc + curr, 0);
            } else {
                return 0;
            }
        } else {
            const scoreRow = this.getHomeRow(player === 1 ? 2 : 1);
            if (scoreRow !== undefined) {
                const locked = [...this.board.entries()].filter(([c,pc]) => c.endsWith(scoreRow) && pc === player);
                return locked.length;
            } else {
                return 0;
            }
        }
    }

    public getPlayersScores(): IScores[] {
        if (!this.variants.includes("king")) {
            const scores: number[] = [];
            for (let p = 1; p <= this.numplayers; p++) {
                scores.push(this.getPlayerScore(p));
            }
            return [
                { name: i18next.t("apgames:status.SCORES"), scores},
            ];
        } else {
            return [];
        }
    }

    public getNumAlive(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        const lockedRow = this.getHomeRow(p === 1 ? 2 : 1);
        const owned = [...this.board.entries()].filter(([,pc]) => pc === p || (pc as ContentsSum).p === p);
        const locked = owned.filter(([c,]) => lockedRow !== undefined && c.endsWith(lockedRow));
        return owned.length - locked.length;
    }

    public findKing(p: playerid): string|null {
        if (!this.variants.includes("king")) {
            throw new Error("You should never use this function outside of King games.");
        }
        const king = [...this.board.entries()].find(([,pc]) => (pc as ContentsSum).p === p && (pc as ContentsSum).v === this.boardSize);
        if (king !== undefined) {
            return king[0];
        } else {
            return null;
        }
    }

    protected checkEOG(): CifraGame {
        const prev = this.currplayer === 1 ? 2 : 1;

        // game never ends until all possible setup is complete
        if (this.stack.length > 3) {
            // King mode
            if (this.variants.includes("king")) {
                // if current player has no king or if prev player broke through, prev wins
                const kCurr = this.findKing(this.currplayer);
                const kPrev = this.findKing(prev);
                const home = this.getHomeRow(this.currplayer);
                if (kCurr === null || (kPrev !== null && home !== undefined && kPrev.endsWith(home))) {
                    this.gameover = true;
                    this.winner = [prev];
                }
            }
            // Dash or Sum mode
            else {
                // game ends as soon as one player has no living pieces
                // (living === !locked)
                if (this.getNumAlive(1) === 0 || this.getNumAlive(2) === 0) {
                    this.gameover = true;
                    const s1 = this.getPlayerScore(1);
                    const s2 = this.getPlayerScore(2);
                    const t1 = this.getNumAlive(1);
                    const t2 = this.getNumAlive(2);
                    if (s1 > s2) {
                        this.winner = [1];
                    } else if (s2 > s1) {
                        this.winner = [2];
                    } else {
                        if (t1 > t2) {
                            this.winner = [1];
                        } else if (t2 > t1) {
                            this.winner = [2];
                        } else {
                            this.winner = [1,2];
                        }
                    }
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

    public state(opts?: {strip?: boolean, player?: number}): ICifraState {
        const state: ICifraState = {
            game: CifraGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            startpos: [...this.startpos],
        };
        if (opts !== undefined && opts.strip) {
            // only strip if we're still in the setup window
            if (state.stack.length === 3 && opts.player !== 1) {
                state.stack[2]._results = [];
                state.stack[2].lastmove = "?";
                state.stack[2].board.clear();
            }
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: CifraGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (this.variants.includes("sum")) {
                        pieces.push(`${(contents as ContentsSum).p === 1 ? "A" : "B"}${(contents as ContentsSum).v}`);
                    } else if (this.variants.includes("king")) {
                        pieces.push(`${(contents as ContentsSum).p === 1 ? "A" : "B"}${(contents as ContentsSum).v === this.boardSize ? "K" : ""}`);
                    } else {
                        if (contents === 1) {
                            pieces.push("A");
                        } else {
                            pieces.push("B");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const markers: MarkerFlood[] = [];
        // add neutral cell
        markers.push({
            type: "flood",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5
            },
            points: [{row: Math.floor(this.boardSize / 2), col: Math.floor(this.boardSize / 2)}],
        });
        // add blue cells
        const points: RowCol[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                let idx = (row * this.boardSize) + col;
                // skip the centre cell
                if (idx === this.startpos.length / 2) {
                    continue;
                }
                // if beyond that point, subtract 1
                else if (idx > this.startpos.length / 2) {
                    idx--;
                }
                if (this.startpos[idx] === "D") {
                    points.push({row, col});
                }
            }
        }
        markers.push({
            type: "flood",
            colour: 2,
            points: points as [RowCol, ...RowCol[]],
        });

        const home1 = this.getHomeRow(1);
        const c1 = this.getPlayerColour(1);
        const c2 = this.getPlayerColour(2);
        const buffer: IBuffer = {
            width: 0.15,
            show: ["N", "S"],
            colours: [
                {
                    side: "N",
                    colour: home1 === undefined ? "#808080" : home1 === "1" ? c2 : c1,
                },
                {
                    side: "S",
                    colour: home1 === undefined ? "#808080" : home1 === "1" ? c1 : c2,
                },
            ],
        };

        const legend: {[k: string]: Glyph|[Glyph, ...Glyph[]]} = {
            A: {
                name: "piece",
                colour: this.getPlayerColour(1),
            },
            B: {
                name: "piece",
                colour: this.getPlayerColour(2),
            },
            AK: {
                name: "piece-chariot",
                colour: this.getPlayerColour(1),
            },
            BK: {
                name: "piece-chariot",
                colour: this.getPlayerColour(2),
            },
        };
        for (let i = 1; i <= this.boardSize; i++) {
            legend[`A${i}`] = [
                {
                    name: "piece",
                    colour: this.getPlayerColour(1),
                },
                {
                    text: i.toString(),
                    colour: "#000",
                    scale: 0.75,
                }
            ];
            legend[`B${i}`] = [
                {
                    name: "piece",
                    colour: this.getPlayerColour(2),
                },
                {
                    text: i.toString(),
                    colour: "#000",
                    scale: 0.75,
                }
            ];
        }

        // pieces area if in setup phase
        let areas: AreaPieces[]|undefined;
        if (this.stack.length === 2 || this.stack.length === 3) {
            if (this.variants.includes("sum") || this.variants.includes("king")) {
                const allPcs = new Set<number>();
                for (let i = 1; i <= this.boardSize; i++) {
                    allPcs.add(i);
                }
                const onboard = [...this.board.values()].filter(pc => (pc as ContentsSum).p === this.currplayer) as ContentsSum[];
                onboard.forEach(({v}) => allPcs.delete(v));
                if (allPcs.size > 0) {
                    areas = [{
                        type: "pieces",
                        pieces: [...allPcs].map(n => `${this.currplayer === 1 ? "A" : "B"}${n}`) as [string, ...string[]],
                        label: `Player ${this.currplayer}'s stash`
                    }];
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
                buffer,
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // add highlights if present
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.highlights) {
                const [col, row] = this.algebraic2coords(cell);
                targets.push({row, col});
            }
            rep.annotations!.push({
                type: "dots",
                targets: targets as [RowCol, ...RowCol[]],
            });
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        status += "**Scores**: " + scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.complete", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "affiliate":
                const [shade, pos] = this.stack[1].lastmove!.split(",");
                const context = shade === "light" ?
                    (pos === "top" ? "lt" : "lb") :
                    (pos === "top" ? "dt" : "db");
                node.push(i18next.t("apresults:AFFILIATE.cifra", {player, context}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): CifraGame {
        return new CifraGame(this.serialize());
    }
}
