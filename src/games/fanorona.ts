/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, IAPGameStateV2 } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { Directions, RectGrid } from "../common";
import { SquareFanoronaGraph } from "../common/graphs";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IFanoronaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FanoronaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Fanorona",
        uid: "fanorona",
        playercounts: [2],
        version: "20230604",
        // i18next.t("apgames:descriptions.fanorona")
        description: "apgames:descriptions.fanorona",
        urls: [
            "https://en.wikipedia.org/wiki/Fanorona",
        ],
        flags: ["perspective", "limited-pieces", "multistep", "no-moves"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: IFanoronaState | IAPGameStateV2 | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFanoronaState;
            }
            if (state.game !== FanoronaGame.gameinfo.uid) {
                throw new Error(`The Fanorona game code cannot process a game of '${state.game}'.`);
            }
            if ( ("V" in state) && (state.V === 2) ) {
                state = (this.hydrate(state) as FanoronaGame).state();
            }
            this.gameover = (state as IFanoronaState).gameover;
            this.winner = [...(state as IFanoronaState).winner];
            this.stack = [...(state as IFanoronaState).stack];
        } else {
            const fresh: IMoveState = {
                _version: FanoronaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                placed: false,
                board: new Map(),
            };
            for (const y of [0, 1]) {
                for (let x = 0; x < 9; x++) {
                    fresh.board.set(FanoronaGame.coords2algebraic(x, y), 2);
                }
            }
            for (const y of [3, 4]) {
                for (let x = 0; x < 9; x++) {
                    fresh.board.set(FanoronaGame.coords2algebraic(x, y), 1);
                }
            }
            for (const x of [1, 3, 6, 8]) {
                fresh.board.set(FanoronaGame.coords2algebraic(x, 2), 1);
            }
            for (const x of [0, 2, 5, 7]) {
                fresh.board.set(FanoronaGame.coords2algebraic(x, 2), 2);
            }
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): FanoronaGame {
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

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = FanoronaGame.coords2algebraic(col, row);
            const moves = move.split(/\s*,\s*/);
            if (moves[0] === "") { moves.splice(0, 1); }
            const cloned = Object.assign(new FanoronaGame(), deepclone(this) as FanoronaGame);
            cloned.move(move, {partial: true});
            const contents = cloned.board.get(cell);

            let newmove = "";
            // if clicking on empty space, assume movement
            if (contents === undefined) {
                if (moves.length === 0) {
                    return {move, message: ""} as IClickResult;
                }
                let prev: string;
                // is this initial movement?
                if ( (moves.length === 1) && (move.length === 2) ) {
                    prev = move;
                    newmove = moves[0] + cell;
                // or continuation?
                } else {
                    const prevMove = moves[moves.length - 1];
                    if (prevMove.length >= 4) {
                        prev = prevMove.substring(2, 4);
                    } else {
                        prev = prevMove.substring(0, 2);
                    }
                    newmove = moves.join(",") + "," + cell;
                }
                // add +/- if unambiguous
                const captype = cloned.captureType(prev, cell);
                if (captype === "+") {
                    newmove += "+";
                } else if (captype === "-") {
                    newmove += "-";
                }
            // if clicking on own piece
            } else if (contents === cloned.currplayer) {
                // if start of move, add to move
                if (moves.length === 0) {
                    newmove = cell;
                // otherwise, ignore
                } else {
                    return {move, message: ""} as IClickResult;
                }

            // if clicking on enemy space, assume disambiguation
            } else {
                // ignore if disambiguation isn't necessary
                if ( (move.length === 0) || (move.endsWith("+")) || (move.endsWith("-")) ) {
                    return {move, message: ""} as IClickResult;
                }
                // naively assume that if the piece is adjacent to from, it's approach
                // otherwise withdrawal (the validator can figure it out)
                const from = move.substring(move.length - 2);
                const graph = new SquareFanoronaGraph(9, 5);
                const adj = graph.neighbours(from);
                if (adj.includes(cell)) {
                    newmove = move + "+";
                } else {
                    newmove = move + "-";
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = moves.join(",");
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
        const graph = new SquareFanoronaGraph(9, 5);
        let cloned = Object.assign(new FanoronaGame(), deepclone(this) as FanoronaGame);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.fanorona.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const moves = m.split(",");
        const dirs: Directions[] = [];
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];

            // if initial move
            if (i === 0) {
                if (/^[a-i]\d/.test(move)) {
                    const from = move.substring(0, 2);
                    // must exist
                    if (! cloned.board.has(from)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                        return result;
                    }
                    // must be yours
                    if (cloned.board.get(from)! !== cloned.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {where: from});
                        return result;
                    }
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL");
                    return result;
                }
                if ( (move.length > 2) && (/[a-i]\d[\+\-]?$/) ) {
                    const from = move.substring(0, 2); // already validated
                    const to = move.substring(2, 4);
                    // can't be the same
                    if (from === to) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                        return result;
                    }
                    // must be empty
                    if (cloned.board.has(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                        return result;
                    }
                    // must be adjacent
                    const adj = graph.neighbours(from);
                    if (! adj.includes(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.fanorona.ADJACENT");
                        return result;
                    }
                    // record dir
                    const dir = RectGrid.bearing(...FanoronaGame.algebraic2coords(from), ...FanoronaGame.algebraic2coords(to))!;
                    dirs.push(dir);

                    // validate +/-
                    const captype = cloned.captureType(from, to);
                    if (move.endsWith("+")) {
                        if ( (captype === "NONE") || (captype === "-") ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fanorona.INVALID_CAPTURE", {type: "approach"});
                            return result;
                        }
                    } else if (move.endsWith("-")) {
                        if ( (captype === "NONE") || (captype === "+") ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fanorona.INVALID_CAPTURE", {type: "withdrawal"});
                            return result;
                        }
                    } else {
                        if (captype !== "NONE") {
                            if (moves.length > i + 1) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.fanorona.DISAMBIGUATE");
                                return result;
                            }
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.fanorona.EXPLICIT_CAPTURE");
                            return result;
                        } else {
                            if (cloned.canCapture()) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.fanorona.BAD_PAIKA");
                                return result;
                            }
                        }
                    }
                } else if (move.length === 2) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.fanorona.PARTIAL");
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                    return result;
                }
            // check for move after paika
            } else if ( (i === 1) && (/\d$/.test(moves[0])) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fanorona.PAIKA_STOP");
                return result;
            // otherwise continuation
            } else {
                let from = moves[i - 1].substring(0, 2);
                if (moves[i - 1].length > 3) {
                    from = moves[i - 1].substring(2, 4);
                }
                const to = move.substring(0, 2);
                const dir = RectGrid.bearing(...FanoronaGame.algebraic2coords(from), ...FanoronaGame.algebraic2coords(to))!;
                dirs.push(dir);
                // can't be the same
                if (from === to) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                    return result;
                }
                // must be empty
                if (cloned.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                    return result;
                }
                // must be adjacent
                const adj = graph.neighbours(from);
                if (! adj.includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fanorona.ADJACENT");
                    return result;
                }
                // can't revisit any point
                let hist = [moves[0]];
                if (i > 0) {
                    hist = moves.slice(0, i);
                }
                const dupes = hist.filter(str => str.includes(to));
                if (dupes.length > 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fanorona.REVISIT");
                    return result;
                }
                // can't move in the same direction twice
                if ( (dirs.length > 2) && (dirs[dirs.length - 1] === dirs[dirs.length - 2]) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fanorona.SAME_DIR");
                    return result;
                }

                // validate +/-
                const captype = cloned.captureType(from, to);
                if (move.endsWith("+")) {
                    if ( (captype === "NONE") || (captype === "-") ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.fanorona.INVALID_CAPTURE", {type: "approach"});
                        return result;
                    }
                } else if (move.endsWith("-")) {
                    if ( (captype === "NONE") || (captype === "+") ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.fanorona.INVALID_CAPTURE", {type: "withdrawal"});
                        return result;
                    }
                } else {
                    if (captype !== "NONE") {
                        if (moves.length > i + 1) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fanorona.DISAMBIGUATE");
                            return result;
                        }
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.fanorona.EXPLICIT_CAPTURE");
                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.fanorona.MUST_CAPTURE");
                        return result;
                    }
                }
            } // initial or continuation?

            cloned = Object.assign(new FanoronaGame(), deepclone(this) as FanoronaGame);
            cloned.move(moves.slice(0, i+1).join(","), {partial: true});

        } // foreach submove

        // if we made it here, we're good to go
        result.valid = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        result.canrender = true;
        const lastmove = moves[moves.length - 1];
        let lastCell = lastmove.substring(0, 2);
        if (lastmove.length >= 4) {
            lastCell = lastmove.substring(2, 4);
        }
        let prev = lastmove;
        if (moves.length > 1) {
            prev = moves.slice(0, moves.length - 1).join(",");
        }
        if ( ( (lastmove.endsWith("+")) || (lastmove.endsWith("-")) ) && (cloned.pieceCanCapture(lastCell, cloned.currplayer, prev)) ) {
            result.complete = 0;
        } else {
            result.complete = 1;
        }
        return result;
    }

    // Naive helper that does no validation
    // It's only here to minimize code repetition
    private captureType(from: string, to: string, player?: playerid): "+"|"-"|"BOTH"|"NONE" {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (from === to) {
            throw new Error("Must pass different from and to.");
        }
        const grid = new RectGrid(9, 5);
        let canApproach = false;
        let canWithdraw = false;
        const [fx, fy] = FanoronaGame.algebraic2coords(from);
        const [tx, ty] = FanoronaGame.algebraic2coords(to);
        let dir = RectGrid.bearing(fx, fy, tx, ty)!;
        let ray = grid.ray(tx, ty, dir).map(node => FanoronaGame.coords2algebraic(...node));
        if ( (ray.length > 0) && (this.board.has(ray[0])) && (this.board.get(ray[0])! !== player) ) {
            canApproach = true;
        }
        dir = RectGrid.bearing(tx, ty, fx, fy)!;
        ray = grid.ray(fx, fy, dir).map(node => FanoronaGame.coords2algebraic(...node));
        if ( (ray.length > 0) && (this.board.has(ray[0])) && (this.board.get(ray[0])! !== player) ) {
            canWithdraw = true;
        }
        if (canApproach && canWithdraw) {
            return "BOTH";
        } else if (canApproach) {
            return "+";
        } else if (canWithdraw) {
            return "-"
        } else {
            return "NONE";
        }
    }

    private canCapture(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const graph = new SquareFanoronaGraph(9, 5);
        const mine = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const from of mine) {
            const adj = graph.neighbours(from).filter(c => ! this.board.has(c));
            for (const to of adj) {
                const result = this.captureType(from, to);
                if (result !== "NONE") {
                    return true;
                }
            }
        }
        return false;
    }

    // Helper for determining whether more captures are possible or not
    private pieceCanCapture(from: string, player: playerid, prev: string): boolean {
        const graph = new SquareFanoronaGraph(9, 5);
        let lastcell: string|undefined;
        let lastdir: string|undefined;
        if (prev.length > 0) {
            if ( (prev.endsWith("+")) || (prev.endsWith("-")) ) {
                lastcell = prev.substring(prev.length - 3, prev.length - 1);
            } else {
                lastcell = prev.substring(prev.length - 2);
            }
            lastdir = RectGrid.bearing(...FanoronaGame.algebraic2coords(lastcell), ...FanoronaGame.algebraic2coords(from));
        }
        const adj = graph.neighbours(from).filter(c => ! this.board.has(c));
        for (const to of adj) {
            // if 'to' is in the previous move anywhere, then we can't go there
            if (prev.includes(to)) { continue; }
            // if 'to' is in the same direction as we last moved in, we can't go there
            const dir = RectGrid.bearing(...FanoronaGame.algebraic2coords(from), ...FanoronaGame.algebraic2coords(to));
            if ( (lastdir !== undefined) && (dir === lastdir) ) { continue;}
            // otherwise, check for possible capture
            const result = this.captureType(from, to, player);
            if (result !== "NONE") {
                return true;
            }
        }
        return false;
    }

    // Most validation offloaded to `validateMove`
    public move(m: string, {partial = false, trusted = false} = {}): FanoronaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            if (! partial) {
                const result = this.validateMove(m);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
            }
        }

        this.results = [];

        const moves = m.split(",");
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            let from: string|undefined;
            let to: string|undefined;
            if (i === 0) {
                if (move.length >= 4) {
                    from = move.substring(0, 2);
                    to = move.substring(2, 4);
                    this.board.delete(from);
                    this.board.set(to, this.currplayer);
                    this.results.push({type: "move", from, to});
                }
            } else {
                if (moves[i - 1].length >= 4) {
                    from = moves[i - 1].substring(2, 4);
                } else {
                    from = moves[i - 1].substring(0, 2);
                }
                to = move.substring(0, 2);
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results.push({type: "move", from, to});
            }
            if ( (from !== undefined) && (to !== undefined) && (from !== to) ) {
                const grid = new RectGrid(9, 5);
                const [fx, fy] = FanoronaGame.algebraic2coords(from);
                const [tx, ty] = FanoronaGame.algebraic2coords(to);
                if (move.endsWith("+")) {
                    const dir = RectGrid.bearing(fx, fy, tx, ty)!;
                    const ray = grid.ray(tx, ty, dir).map(node => FanoronaGame.coords2algebraic(...node));
                    while ( (ray.length > 0) && (this.board.has(ray[0])) && (this.board.get(ray[0])! !== this.currplayer) ) {
                        this.results.push({type: "capture", where: ray[0]});
                        this.board.delete(ray[0]);
                        ray.shift();
                    }
                } else if (move.endsWith("-")) {
                    const dir = RectGrid.bearing(tx, ty, fx, fy)!;
                    const ray = grid.ray(fx, fy, dir).map(node => FanoronaGame.coords2algebraic(...node));
                    while ( (ray.length > 0) && (this.board.has(ray[0])) && (this.board.get(ray[0])! !== this.currplayer) ) {
                        this.results.push({type: "capture", where: ray[0]});
                        this.board.delete(ray[0]);
                        ray.shift();
                    }
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = m.replace(/,/g, ", ");
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): FanoronaGame {
        const p1 = this.getPlayerPieces(1);
        const p2 = this.getPlayerPieces(2);
        if ( (p1 === 0) || (p2 === 0) ) {
            this.gameover = true;
            if (p1 === 0) {
                this.winner = [2];
            } else {
                this.winner = [1];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IFanoronaState {
        return {
            game: FanoronaGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FanoronaGame.gameinfo.version,
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
        for (let row = 0; row < 5; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < 9; col++) {
                const cell = FanoronaGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "R";
                    } else {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(/\-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex-fanorona",
                width: 9,
                height: 5
            },
            legend: {
                R: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = FanoronaGame.algebraic2coords(move.from);
                    const [toX, toY] = FanoronaGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", player: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = FanoronaGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    // public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
    //     let resolved = false;
    //     switch (r.type) {
    //         case "place":
    //             node.push(i18next.t("apresults:PLACE.cannon", {player, where: r.where}));
    //             resolved = true;
    //             break;
    //         case "capture":
    //             node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
    //             resolved = true;
    //             break;
    //     }
    //     return resolved;
    // }

    public chatLog(players: string[]): string[][] {
        // move, capture, eog, resign, winners
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                const moves = state._results.filter(r => r.type === "move");
                node.push(i18next.t("apresults:MOVE.multiple", {player: name, moves: moves.map(m => {
                    if (m.type === "move") {
                        return `${m.from}-${m.to}`;
                    } else {
                        throw new Error("Should never happen.");
                    }
                }).join(", ")}));
                const captures = state._results.filter(r => r.type === "capture");
                if (captures.length > 0) {
                    // @ts-ignore
                    node.push(i18next.t("apresults:CAPTURE.noperson.nowhere", {count: captures.length}));
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                        case "resigned":
                            let rname = `Player ${r.player}`;
                            if (r.player <= players.length) {
                                rname = players[r.player - 1]
                            }
                            node.push(i18next.t("apresults:RESIGN", {player: rname}));
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
                            node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): FanoronaGame {
        return new FanoronaGame(this.serialize());
    }
}
