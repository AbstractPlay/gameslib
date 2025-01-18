/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Piece = "K"|"C";
export type CellContents = [playerid,Piece];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    dagger?: playerid;
};

export interface ICatapultState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const forwardDirs: [Directions[],Directions[]] = [["N", "E", "NE"], ["W","S","SW"]];

export class CatapultGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Catapult",
        uid: "catapult",
        playercounts: [2],
        version: "20250117",
        dateAdded: "2023-07-02",
        // i18next.t("apgames:descriptions.catapult")
        description: "apgames:descriptions.catapult",
        urls: ["https://boardgamegeek.com/boardgame/411625/catapult"],
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
            {uid: "size-9", group: "board"},
            {uid: "royal", group: "goal"},
            {uid: "dagger"},
        ],
        categories: ["goal>annihilate", "goal>royal-capture", "mechanic>capture", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "perspective", "no-moves", "custom-randomization", "scores", "custom-buttons"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }
    public get boardsize(): number {
        if (this.variants.includes("size-9")) {
            return 9;
        }
        return 8;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public dagger?: playerid;
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ICatapultState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, CellContents>();
            if (this.variants.includes("size-9")) {
                for (const cell of ["a1", "a3", "b2", "c1", "a5", "b4", "c3", "d2", "e1", "a7", "b6", "c5", "d4", "e3", "f2", "g1"]) {
                    board.set(cell, [1, "C"])
                }
                for (const cell of ["i9", "g9", "h8", "i7", "e9", "f8", "g7", "h6", "i5", "c9", "d8", "e7", "f6", "g5", "h4", "i3"]) {
                    board.set(cell, [2, "C"])
                }
                if (this.variants.includes("royal")) {
                    board.set("a1", [1, "K"]);
                    board.set("i9", [2, "K"]);
                }
            } else {
                for (const cell of ["a2", "b1", "a4", "b3", "c2", "d1", "a6", "b5", "c4", "d3", "e2", "f1"]) {
                    board.set(cell, [1, "C"])
                }
                for (const cell of ["c8", "d7", "e6", "f5", "g4", "h3", "e8", "f7", "g6", "h5", "g8", "h7"]) {
                    board.set(cell, [2, "C"])
                }
                if (this.variants.includes("royal")) {
                    board.set("a1", [1, "K"]);
                    board.set("h8", [2, "K"]);
                }
            }

            let dagger: playerid|undefined;
            if (this.variants.includes("dagger")) {
                dagger = 2;
            }

            const fresh: IMoveState = {
                _version: CatapultGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                dagger,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICatapultState;
            }
            if (state.game !== CatapultGame.gameinfo.uid) {
                throw new Error(`The Catapult engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CatapultGame {
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
        this.dagger = state.dagger;
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const mypieces = [...this.board.entries()].filter(e => e[1][0] === player).map(e => e[0]);

        for (const from of mypieces) {
            const [fx, fy] = this.algebraic2coords(from);
            // calculate range
            let range = 1;
            for (const dir of forwardDirs[player - 1]) {
                const ray: string[] = grid.ray(fx, fy, dir).map(c => this.coords2algebraic(...c));
                if (ray.length === 0 || (this.board.has(ray[0]) && this.board.get(ray[0])![0] === player)) {
                    range = range * 2;
                }
            }

            // non-capturing movement forward only
            for (const dir of forwardDirs[player - 1]) {
                let ray: string[] = grid.ray(fx, fy, dir).map(c => this.coords2algebraic(...c));
                // cut down to range
                ray = ray.slice(0, range);
                for (const to of ray) {
                    if (!this.board.has(to)) {
                        moves.push(`${from}-${to}`);
                    } else {
                        break;
                    }
                }
            }

            // capturing in any direction
            for (const dir of allDirections) {
                let ray: string[] = grid.ray(fx, fy, dir).map(c => this.coords2algebraic(...c));
                // cut down to range
                ray = ray.slice(0, range);
                // cut down to first friendly piece
                const idxFriendly = ray.findIndex(c => this.board.has(c) && this.board.get(c)![0] === player);
                if (idxFriendly >= 0) {
                    ray = ray.slice(0, idxFriendly);
                }
                // remove extra blanks at the front
                const idxEnemy = ray.findIndex(c => this.board.has(c) && this.board.get(c)![0] !== player);
                if (idxEnemy >= 0) {
                    ray = ray.slice(idxEnemy);
                } else {
                    // if there are no enemy pieces, then this isn't a valid capture move
                    continue;
                }
                for (const to of ray) {
                    moves.push(`${from}x${to}`);
                }
            }
        }

        if (moves.length === 0) {
            return ["pass"];
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        // the random mover will never use the dagger
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // In this game only one button is active at a time.
    public getButtons(): ICustomButton[] {
        if (this.moves().includes("pass")) return [{ label: "pass", move: "pass" }];
        return [];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const isCapture = (obj: CatapultGame, from: string, to: string): boolean => {
            const [fx, fy] = obj.algebraic2coords(from);
            const [tx, ty] = obj.algebraic2coords(to);
            let between: string[];
            try {
                between = RectGrid.between(fx, fy, tx, ty).map(c => obj.coords2algebraic(...c));
            } catch {
                return false;
            }
            for (const cell of [...between, to]) {
                if (obj.board.has(cell) && obj.board.get(cell)![0] !== obj.currplayer) {
                    return true;
                }
            }
            return false;
        }

        try {
            const cloned = this.clone();
            if (move.includes(";") || move.length > 4) {
                const [m1,] = move.split(";");
                cloned.executeMove(m1);
            }
            const cell = cloned.coords2algebraic(col, row);
            let contents: CellContents|undefined;
            if (cloned.board.has(cell)) {
                contents = cloned.board.get(cell)!;
            }
            let hasDagger = false;
            if (cloned.dagger === cloned.currplayer) {
                hasDagger = true;
            }
            let newmove = "";

            if (move.length === 0) {
                newmove = cell;
            } else {
                if (contents !== undefined && contents[0] === cloned.currplayer) {
                    if (hasDagger) {
                        newmove = move + ";" + cell;
                    } else {
                        newmove = cell;
                    }
                } else {
                    let prefix: string|undefined;
                    let working = move;
                    if (move.includes(";")) {
                        [prefix, working] = move.split(";");
                    }
                    const [left,] = working.split(/[-x]/);
                    if (left !== undefined && left !== "") {
                        if (isCapture(cloned, left, cell)) {
                            newmove = `${prefix !== undefined ? prefix + ";" : ""}${left}x${cell}`;
                        } else {
                            newmove = `${prefix !== undefined ? prefix + ";" : ""}${left}-${cell}`;
                        }
                    } else {
                        newmove = `${prefix !== undefined ? prefix + ";" : ""}${cell}`;
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
        let hasDagger = false;
        if (this.dagger === this.currplayer) {
            hasDagger = true;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.catapult.INITIAL_INSTRUCTIONS");
            return result;
        }

        // check for double moves first
        if (m.includes(";")) {
            if (!hasDagger) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.catapult.NO_DAGGER");
                return result;
            }
        }

        const cloned = this.clone();
        for (const mv of m.split(";")) {
            if (mv === undefined || mv === "") {
                continue;
            }

            const [from, to] = mv.split(/[-x]/);

            // valid cell
            try {
                cloned.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // is occupied
            if (! cloned.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            const fcontents = cloned.board.get(from)!;
            // is yours
            if (fcontents[0] !== cloned.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            if ( (to === undefined) || (to.length === 0) ) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            } else {
                const allmoves = cloned.moves();
                if (!allmoves.includes(mv)) {
                    if (mv.includes("-")) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.catapult.BAD_MOVE");
                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.catapult.BAD_CAPTURE");
                        return result;
                    }
                }

                cloned.executeMove(mv);
            }
        }

        // we're good
        result.valid = true;
        result.complete = (!m.includes(";") && hasDagger) ? 0 : 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private executeMove(m: string): void {
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const [from, to] = m.split(/[-x]/);
            const [fx, fy] = this.algebraic2coords(from);
            const [tx, ty] = this.algebraic2coords(to);
            const affected = RectGrid.between(fx, fy, tx, ty).map(c => this.coords2algebraic(...c));
            affected.push(to);
            const enemyPresent = affected.map(c => this.board.has(c) ? true : false).reduce((prev, curr) => prev || curr, false);
            if (enemyPresent) {
                for (const cell of affected) {
                    if (this.board.has(cell)) {
                        this.board.delete(cell);
                        this.results.push({type: "capture", where: cell});
                    }
                }
            }
            this.board.set(to, this.board.get(from)!);
            this.board.delete(from);
            this.results = [{type: "move", from, to}, ...this.results];
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): CatapultGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if ( (! partial) && (! trusted) ) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // can't use the failsafe because of the possibility of double moves
            // if ( (! partial) && (! this.moves().includes(m)) ) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];

        if (partial) {
            const [m1, m2] = m.split(";");
            let next: string;
            if (m.includes(";")) {
                this.executeMove(m1);
                next = m2;
            } else {
                next = m1;
            }
            if (next.length === 2) {
                const allmoves = this.moves();
                const matches = allmoves.filter(mv => mv.startsWith(next));
                const dots = matches.map(mv => mv.substring(next.length + 1));
                this._points = dots.map(c => this.algebraic2coords(c));
            } else {
                this.executeMove(next);
            }
            return this;
        } else {
            this._points = [];
        }

        for (const mv of m.split(";")) {
            this.executeMove(mv);
        }

        // pass the dagger
        if (m.includes(";")) {
            this.dagger = this.dagger === 1 ? 2 : 1;
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

    protected checkEOG(): CatapultGame {
        const other = this.currplayer === 1 ? 2 : 1;
        if (this.variants.includes("royal")) {
            const royal = [...this.board.values()].filter(([p, pc]) => p === this.currplayer && pc === "K");
            if (royal.length === 0) {
                this.gameover = true;
                this.winner = [other];
            }
        } else {
            const pcs = [...this.board.values()].filter(([p,]) => p === this.currplayer);
            if (pcs.length === 0) {
                this.gameover = true;
                this.winner = [other];
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

    public state(): ICatapultState {
        return {
            game: CatapultGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CatapultGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            dagger: this.dagger,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents[1] === "C") {
                        if (contents[0] === 1) {
                            pieces.push("A");
                        } else {
                            pieces.push("Y");
                        }
                    } else {
                        if (contents[0] === 1) {
                            pieces.push("B");
                        } else {
                            pieces.push("Z");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
                rotate: -45,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece-chariot",
                    colour: 1
                },
                Y: {
                    name: "piece",
                    colour: 2
                },
                Z: {
                    name: "piece-chariot",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if ( (this.results.length > 0) || (this._points.length > 0) ) {
            rep.annotations = [];

            if (this._points.length > 0) {
                const points: {row: number, col: number}[] = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
            }

            if (this.results.length > 0) {
                for (const move of this.results) {
                    if (move.type === "move") {
                        const [fromX, fromY] = this.algebraic2coords(move.from);
                        const [toX, toY] = this.algebraic2coords(move.to);
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    } else if (move.type === "capture") {
                        const [x, y] = this.algebraic2coords(move.where!);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                }
            }
        }

        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(([owner,]) => owner === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public statuses(): IStatus[] {
        if (this.dagger !== undefined) {
            const key = i18next.t("apgames:status.catapult.DAGGER");
            const value = { glyph: "piece", colour: this.dagger };
            return [{ key, value: [value] }];
        } else {
            return [];
        }
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): CatapultGame {
        return Object.assign(new CatapultGame(), deepclone(this) as CatapultGame);
    }
}
