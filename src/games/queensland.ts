import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, IStatus, IRenderOpts } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Size = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    pieces: [number,number];
    lastmove?: string;
    g1scores?: [number,number];
};

export interface IQueenslandState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class QueenslandGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Queensland",
        uid: "queensland",
        playercounts: [2],
        version: "20240210",
        dateAdded: "2024-02-13",
        // i18next.t("apgames:descriptions.queensland")
        description: "apgames:descriptions.queensland",
        // i18next.t("apgames:notes.queensland")
        notes: "apgames:notes.queensland",
        urls: ["https://static1.squarespace.com/static/5e1ce8815cb76d3000d347f2/t/64264b8894a17f6937a3cf3e/1680231305313/QueenslandPostcardB.pdf"],
        people: [
            {
                type: "designer",
                name: "James Ernest",
                urls: ["https://crabfragmentlabs.com/"],
            },
        ],
        categories: ["goal>score>eog", "mechanic>place",  "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["multistep", "limited-pieces", "scores", "automove"],
        displays: [{uid: "hide-scored"}],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public pieces: [number,number] = [12,12];
    public g1scores?: [number,number];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = [];

    constructor(state?: IQueenslandState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: QueenslandGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces: [12,12]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IQueenslandState;
            }
            if (state.game !== QueenslandGame.gameinfo.uid) {
                throw new Error(`The Queensland and Chicks engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): QueenslandGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.pieces = [...state.pieces];
        this.g1scores = state.g1scores === undefined ? undefined : [...state.g1scores];
        this.lastmove = state.lastmove;
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        // if the game just reset and it's player 1's turn, they must pass
        if (this.g1scores === undefined && this.pieces[0] === 0 && this.pieces[1] === 0 && player === 1) {
            return ["pass"];
        }

        const moves: string[] = [];

        if (this.pieces[player - 1] > 0) {
            // look for moves first
            const g = new RectGrid(8,8);
            const mine = [...this.board.entries()].filter(([, owner]) => owner === player).map(([cell,]) => cell);
            const mvmts: string[] = [];
            for (const from of mine) {
                const [fx, fy] = QueenslandGame.algebraic2coords(from);
                for (const dir of allDirections) {
                    let ray = g.ray(fx, fy, dir).map(pt => QueenslandGame.coords2algebraic(...pt));
                    const idx = ray.findIndex(cell => this.board.has(cell));
                    if (idx !== -1) {
                        ray = ray.slice(0, idx);
                    }
                    for (const to of ray) {
                        mvmts.push(`${from}-${to}`);
                    }
                }
            }

            // get current placements
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const cell = QueenslandGame.coords2algebraic(x, y);
                    if (! this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }

            // add placement after each movement
            for (const mv of mvmts) {
                const [from, to] = mv.split("-");
                for (let y = 0; y < 8; y++) {
                    for (let x = 0; x < 8; x++) {
                        const cell = QueenslandGame.coords2algebraic(x, y);
                        // skip the cell we just moved to
                        if (cell === to) { continue; }
                        if (! this.board.has(cell)) {
                            moves.push(`${mv},${cell}`);
                        }
                    }
                }
                // add entry from cell we moved from
                moves.push(`${mv},${from}`);
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = QueenslandGame.coords2algebraic(col, row);
            let newmove = "";
            // fresh
            if (move.length === 0) {
                // whatever you click, start with the cell
                newmove = cell;
            }
            // continuation
            else {
                // clicking on an occupied cell assumes movement and resets
                if (this.board.has(cell)) {
                    newmove = cell;
                }
                // otherwise
                else {
                    // if already have a movement component, place
                    if (move.includes("-")) {
                        newmove = `${move},${cell}`;
                    }
                    // otherwise, end movement
                    else {
                        newmove = `${move}-${cell}`;
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
            result.message = i18next.t("apgames:validation.queensland.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            if (this.g1scores !== undefined || this.pieces[0] !== 0 || this.pieces[1] !== 0 || this.currplayer !== 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.queensland.BAD_PASS");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        const [left, right] = m.split(",");
        let from: string|undefined;
        let to: string|undefined;
        let place: string|undefined;

        // if there's only one component, use board to determine if placement or move
        if (right === undefined) {
            if (left.includes("-")) {
                [from, to] = left.split("-");
            } else if (this.board.has(left)) {
                from = left;
            } else {
                place = left;
            }
        } else {
            [from, to] = left.split("-");
            place = right;
        }

        if (from !== undefined) {
            // valid cell
            try {
                QueenslandGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // occupied
            if (! this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // is yours
            if (this.board.get(from)! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // validate to
            if (to !== undefined) {
                // valid cell
                try {
                    QueenslandGame.algebraic2coords(to);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // is empty
                if (this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                    return result;
                }
                // unobstructed
                const [fx, fy] = QueenslandGame.algebraic2coords(from);
                const [tx, ty] = QueenslandGame.algebraic2coords(to);
                let between: string[] = [];
                try {
                    between = RectGrid.between(fx, fy, tx, ty).map(pt => QueenslandGame.coords2algebraic(...pt));
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.queensland.STRAIGHT_LINES");
                    return result;
                }
                for (const cell of between) {
                    if (this.board.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                        return result;
                    }
                }
            } else {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.queensland.PARTIAL_MOVE");
                return result;
            }

            if (place === undefined) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.queensland.NOW_PLACE");
                return result;
            }
        }

        if (place !== undefined) {
            // valid cell
            try {
                QueenslandGame.algebraic2coords(place);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: place});
                return result;
            }
            // is empty
            if (this.board.has(place) && (from === undefined || place !== from) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: place});
                return result;
            }
            // you have a piece to place
            if (this.pieces[this.currplayer - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.queensland.NO_PIECES");
                return result;
            }
        } else {
            result.valid = false;
            result.message = i18next.t("apgames:validation.queensland.MUST_PLACE");
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private findPoints(cell: string): string[]|undefined {
        if (! this.board.has(cell)) {
            return undefined;
        }
        const moves = this.moves().filter(mv => mv.startsWith(`${cell}-`));
        const points: string[] = [];
        for (const m of moves) {
            const [left,] = m.split(",");
            const cells = left.split("-");
            points.push(cells[1]);
        }
        return points;
    }

    public move(m: string, {trusted = false, partial = false} = {}): QueenslandGame {
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

        // if partial and move not complete, just set the points and get out
        if ( (partial) && (! m.includes("-")) && (m !== "pass") ) {
            const pts = this.findPoints(m);
            if (pts !== undefined) {
                this._points = pts.map(c => QueenslandGame.algebraic2coords(c));
            } else {
                this._points = [];
            }
            return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        // only reset results if the game hasn't just reset
        if (this.results.find(r => r.type === "reset") === undefined) {
            this.results = [];
        }

        // passing means the game is resetting
        if (m === "pass") {
            // log the reset in the chat log
            this.results.push({type: "reset"});
            // save the current score
            this.g1scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
            // reset the board
            this.board = new Map<string, playerid>();
            // reset the pieces
            this.pieces = [12,12];
        }
        // otherwise, process every other move
        else {
            const [left, right] = m.split(",");

            // move if relevant
            if (left.includes("-")) {
                const [from, to] = left.split("-");
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results.push({type: "move", from, to});
            }

            // place
            let place: string|undefined;
            if (right === undefined && ! left.includes("-")) {
                place = left;
            } else if (right !== undefined) {
                place = right;
            }

            if (place !== undefined) {
                this.board.set(place, this.currplayer);
                this.pieces[this.currplayer - 1]--;
                this.results.push({type: "place", where: place});
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

    protected checkEOG(): QueenslandGame {
        if ( (this.pieces[0] + this.pieces[1] === 0) && (this.g1scores !== undefined) ) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.pieces }
        ]
    }

    public getPlayerPieces(player: number): number {
        return this.pieces[player - 1];
    }

    public getPlayerScore(player: number): number {
        const mine = [...this.board.entries()].filter(([,owner]) => owner === player).map(([cell,]) => cell);
        const g = new RectGrid(8,8);
        const pairs = new Map<string, number>();
        for (const from of mine) {
            const [fx, fy] = QueenslandGame.algebraic2coords(from);
            for (const dir of allDirections) {
                const ray = g.ray(fx, fy, dir).map(pt => QueenslandGame.coords2algebraic(...pt));
                const idx = ray.findIndex(c => this.board.has(c));
                if (idx !== -1) {
                    const to = ray[idx];
                    if (this.board.get(to)! === player) {
                        const ordered = [from, to].sort();
                        const id = ordered.join(",");
                        if (! pairs.has(id)) {
                            pairs.set(id, idx);
                        }
                    }
                }
            }
        }
        let currScore = [...pairs.values()].reduce((prev, curr) => prev + curr, 0);
        if (this.g1scores !== undefined) {
            currScore += this.g1scores[player - 1];
        }
        return currScore;
    }

    public getScored(player: playerid): string[] {
        const mine = [...this.board.entries()].filter(([,owner]) => owner === player).map(([cell,]) => cell);
        const g = new RectGrid(8,8);
        const between = new Set<string>();
        for (const from of mine) {
            const [fx, fy] = QueenslandGame.algebraic2coords(from);
            for (const dir of allDirections) {
                const ray = g.ray(fx, fy, dir).map(pt => QueenslandGame.coords2algebraic(...pt));
                const idx = ray.findIndex(c => this.board.has(c));
                if (idx !== -1) {
                    const to = ray[idx];
                    if (this.board.get(to)! === player) {
                        for (const cell of ray.slice(0, idx)) {
                            between.add(cell);
                        }
                    }
                }
            }
        }
        return [...between];
    }

    public state(): IQueenslandState {
        return {
            game: QueenslandGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: QueenslandGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: [...this.pieces],
            g1scores: this.g1scores === undefined ? undefined : [...this.g1scores],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showScored = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-scored") {
                showScored = false;
            }
        }

        const labels = ["A","B"];
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = QueenslandGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;
                    pieces.push(labels[player - 1]);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{8}/g, "_");

        let points1: {row: number, col: number}[] = [];
        let points2: {row: number, col: number}[] = [];
        if (showScored || this.gameover) {
            const cells1 = this.getScored(1);
            const cells2 = this.getScored(2);
            points1 = cells1.map(cell => {
                const [col, row] = QueenslandGame.algebraic2coords(cell);
                return {row, col};
            });
            points2 = cells2.map(cell => {
                const [col, row] = QueenslandGame.algebraic2coords(cell);
                return {row, col};
            });
        }
        let markers: Array<any> | undefined = []
        if (points1.length > 0) {
            // @ts-ignore
            markers.push({ type: "flood", colour: 1, opacity: 0.33, points: points1 });
        }
        if (points2.length > 0) {
            // @ts-ignore
            markers.push({ type: "flood", colour: 2, opacity: 0.33, points: points2 });
        }
        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: this.gameover ? "squares" : "squares-checkered",
                width: 8,
                height: 8,
                // @ts-ignore
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr
        };

        // Add annotations
        if ( (this.stack[this.stack.length - 1]._results.length > 0) || (this._points.length > 0) ) {
            // @ts-ignore
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }

            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = QueenslandGame.algebraic2coords(move.from);
                    const [toX, toY] = QueenslandGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = QueenslandGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public statuses(): IStatus[] {
        if (this.g1scores === undefined)
            return [{ key: i18next.t("apgames:status.PHASE"), value: [i18next.t("apgames:status.queensland.GAME1")] }];
        else
            return [{ key: i18next.t("apgames:status.PHASE"), value: [i18next.t("apgames:status.queensland.GAME2")] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `**Status**: Game ${this.g1scores === undefined ? "1" : "2"}\n\n`;

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.pieces[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "reset":
                node.push(i18next.t("apresults:RESET.queensland"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): QueenslandGame {
        return new QueenslandGame(this.serialize());
    }
}
