/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";
import { CartesianProduct } from "js-combinatorics";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type CellContents = 1|2|11|22;

interface IPointEntry {
    row: number;
    col: number;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface IFabrikState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FabrikGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Fabrik",
        uid: "fabrik",
        playercounts: [2],
        version: "20211118",
        // i18next.t("apgames:descriptions.fabrik")
        description: "apgames:descriptions.fabrik",
        urls: ["https://spielstein.com/games/fabrik"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "arbeiter",
                name: "Arbeiter",
                // i18next.t("apgames:variants.fabrik.arbeiter")
                description: "apgames:variants.fabrik.arbeiter"
            }
        ],
        flags: ["multistep", "automove"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 11);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 11);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IFabrikState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const fresh: IMoveState = {
                _version: FabrikGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
            };
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] === "arbeiter") ) {
                this.variants = ["arbeiter"];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFabrikState;
            }
            if (state.game !== FabrikGame.gameinfo.uid) {
                throw new Error(`The Fabrik engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FabrikGame {
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
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // If there aren't two workers yet, place those first
        if (this.board.size < 2) {
            for (let row = 0; row < 11; row++) {
                for (let col = 0; col < 11; col++) {
                    const cell = FabrikGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
        // If there are only two workers, the only placement or passing is allowed
        } else if (this.board.size === 2) {
            // If nobody has passed yet, then passing is an option
            if ( (this.lastmove !== undefined) && (this.lastmove !== "pass") ) {
                moves.push("pass");
            }
            // In any case, the only other option is to place a piece
            moves.push(...this.findPoints());
        // Otherwise, all move types are possible
        } else {
            // First, you're allowed to place without moving
            moves.push(...this.findPoints());

            // Otherwise, calculate all possible moves and placements
            const empties: string[] = [];
            for (let row = 0; row < 11; row++) {
                for (let col = 0; col < 11; col++) {
                    const cell = FabrikGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        empties.push(cell);
                    }
                }
            }
            let workers: string[] = [];
            if (this.variants.includes("arbeiter")) {
                workers = [...this.board.entries()].filter(e => e[1].toString() === `${player!.toString()}${player!.toString()}`).map(e => e[0]);
            } else {
                workers = [...this.board.entries()].filter(e => e[1].toString().length === 2).map(e => e[0]);
            }
            const pairs = new CartesianProduct(workers, empties);
            for (const pair of pairs) {
                const g: FabrikGame = Object.assign(new FabrikGame(), deepclone(this) as FabrikGame);
                const contents = g.board.get(pair[0])!;
                g.board.delete(pair[0]);
                g.board.set(pair[1], contents);
                for (const cell of g.findPoints()) {
                    moves.push(`${pair[0]}-${pair[1]},${cell}`);
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
            const cell = FabrikGame.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                // if all workers have been placed
                if (this.board.size >= 2) {
                    // empty space could be a placement because movement is optional
                    if (! this.board.has(cell)) {
                        if (this.findPoints().includes(cell)) {
                            newmove = cell;
                        } else {
                            return {move: "", message: ""} as IClickResult;
                        }
                    } else {
                        // occupied space must be a worker
                        if (this.board.get(cell)!.toString().length === 2) {
                            newmove = cell;
                        } else {
                            return {move: "", message: ""} as IClickResult;
                        }
                    }
                // otherwise, early phases
                } else {
                    // only empty spaces can be clicked
                    if (! this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        return {move: "", message: ""} as IClickResult;
                    }
                }
            } else {
                const [from,to,place] = move.split(/[-,]/);
                if (this.board.size <= 2) {
                    if (! this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        newmove = move;
                    }
                } else if (place !== undefined) {
                    // if you're clicking on a valid empty cell, replace it
                    const g = this.clone();
                    g.board.set(to, this.board.get(from)!)
                    g.board.delete(from);
                    if (g.findPoints().includes(place)) {
                        newmove = `${from}-${to},${cell}`;
                    // otherwise, change nothing
                    } else {
                        newmove = move;
                    }
                } else if (to !== undefined) {
                    const g = this.clone();
                    g.board.set(to, this.board.get(from)!)
                    g.board.delete(from);
                    // if to is defined and you're clicking on a valid cell, assume placement
                    if (g.findPoints().includes(cell)) {
                        newmove = `${from}-${to},${cell}`;
                    } else {
                        newmove = move;
                    }
                } else { // from *has* to be defined if move itself has content
                    // if you click on an empty cell, assume movement
                    if ( (this.board.has(from)) && (! this.board.has(cell)) ) {
                        newmove = `${from}-${cell}`;
                    } else if (! this.board.has(from)) {
                        newmove = cell;
                    } else {
                        newmove = move;
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

        // validate "pass" first of all
        if (m === "pass") {
            if ( (this.board.size !== 2) || (this.currplayer !== 1) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fabrik.INVALID_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const [from, to, place] = m.split(/[-,]/);

        if (from !== undefined) {
            // valid cell
            try {
                FabrikGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // from currently contains a worker you control
            if (! this.board.has(from)) {
                if (this.board.size < 2) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
                // If this is a valid placement point, assume that
                if (this.findPoints().includes(from)) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }

                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // First move after placing workers has to be a placement or pass
            if (this.board.size === 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fabrik.MUST_PASS_PLAY");
                return result;
            }

            if (this.variants.includes("arbeiter")) {
                const controlled = parseInt(this.currplayer.toString() + this.currplayer.toString(), 10);
                if (this.board.get(from)! !== controlled) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            } else {
                if (this.board.get(from)!.toString().length !== 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            }
            // if this is it, then this is a valid partial
            if (to === undefined) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.fabrik.PARTIAL_MOVE");
                return result;
            }
        }

        let points: string[] | undefined;
        if (to !== undefined) {
            // valid cell
            try {
                FabrikGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // to is empty
            if (this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                return result;
            }
            // there are valid placements from here
            const g = this.clone();
            g.board.set(to, this.board.get(from)!);
            g.board.delete(from);
            points = g.findPoints();
            if (points.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fabrik.NOPLACEMENTS");
                return result;
            }
            // If this is it, this is a valid partial
            if (place === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.fabrik.PARTIAL_PLACE");
                return result;
            }
        }

        if (place !== undefined ) {
            if (points === undefined) {
                throw new Error("Valid placements were not calculated. This should never happen.");
            }
            // valid cell
            try {
                FabrikGame.algebraic2coords(place);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: place});
                return result;
            }
            // This is a valid placement
            if (! points.includes(place)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fabrik.INVALID_PLACEMENT", {where: place});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        return result;
    }

    // The partial flag enables dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, partial = false): FabrikGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if ( (! partial) && (! this.moves().includes(m)) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];

        // Look for movement first
        if (m.includes("-")) {
            const [from, to, place] = m.split(/[,-]/);
            const contents = this.board.get(from)!;
            this.board.delete(from);
            this.board.set(to, contents);
            this.results.push({type: "move", from, to});
            if ( (! partial) && (place === undefined) ) {
                throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
            }
            if (place !== undefined) {
                this.board.set(place, this.currplayer);
                this.results.push({type: "place", where: place});
            }
        // Check for pass
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        // Otherwise it should be just plain placement
        } else {
            if (this.board.size < 2) {
                const contents = parseInt(`${this.currplayer}${this.currplayer}`, 10) as playerid;
                this.board.set(m, contents);
            } else {
                this.board.set(m, this.currplayer);
            }
            this.results.push({type: "place", where: m});
        }

        // Stop here if only requesting partial processing
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

    protected checkEOG(): FabrikGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        let target = 4;
        if (this.variants.includes("arbeiter")) {
            target = 3;
        }
        // Current player has no moves (there's no way to configure the workers to let them move)
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        // Previous player has a row of the appropriate length
        } else if (this.hasRow(prevPlayer, target)) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public hasRow(player: playerid, targetLength: number): boolean {
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const grid = new RectGrid(11,11);
        for (const cell of pieces) {
            const [x, y] = FabrikGame.algebraic2coords(cell);
            for (const dir of allDirections) {
                const ray = grid.ray(x, y, dir);
                let len = 1;
                for (const pt of ray) {
                    const next = FabrikGame.coords2algebraic(...pt);
                    if (pieces.includes(next)) {
                        len++;
                    } else {
                        break;
                    }
                }
                if (len >= targetLength) {
                    return true;
                }
            }
        }
        return false;
    }

    public findPoints(): string[] {
        const points: string[] = [];
        const grid = new RectGrid(11, 11);
        if (this.board.size >= 2) {
            const workers = [...this.board.entries()].filter(e => e[1].toString().length === 2).map(e => e[0]);
            const rays: [string[], string[]] = [[], []];
            for (let i = 0; i < 2; i++) {
                const worker = workers[i];
                const [x, y] = FabrikGame.algebraic2coords(worker);
                for (const dir of allDirections) {
                    const ray = grid.ray(x, y, dir).map(pt => FabrikGame.coords2algebraic(...pt));
                    for (const next of ray) {
                        if (! this.board.has(next)) {
                            rays[i].push(next);
                        } else {
                            break;
                        }
                    }
                }
            }
            return rays[0].filter(cell => rays[1].includes(cell));
        }
        return points;
    }

    public resign(player: playerid): FabrikGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): IFabrikState {
        return {
            game: FabrikGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FabrikGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 11; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 11; col++) {
                const cell = FabrikGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    switch (contents) {
                        case 1:
                            pieces.push("A");
                            break;
                        case 2:
                            pieces.push("B");
                            break;
                        case 11:
                            pieces.push("C");
                            break;
                        case 22:
                            pieces.push("D");
                            break;
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{11}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex-cross",
                width: 11,
                height: 11,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
                C: {
                    name: "chess-queen-outline-montreal",
                    player: 3
                },
                D: {
                    name: "chess-queen-outline-montreal",
                    player: 3
                }
            },
            pieces: pstr
        };
        if (this.variants.includes("arbeiter")) {
            // @ts-ignore
            rep.legend!.C.player = 1;
            // @ts-ignore
            rep.legend!.D.player = 2;
        }
        const cells = this.findPoints().map(p => FabrikGame.algebraic2coords(p));
        if (cells.length > 0) {
            const points: IPointEntry[] = [];
            for (const cell of cells) {
                points.push({row: cell[1], col: cell[0]});
            }
            // @ts-ignore
            rep.board.markers = [{type: "dots", points}];
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = FabrikGame.algebraic2coords(move.from);
                    const [toX, toY] = FabrikGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", player: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = FabrikGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of FabrikGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, promote, deltaScore
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "place":
                            node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where}));
                            break;
                        case "pass":
                            node.push(i18next.t("apresults:PASS.simple", {player: name}));
                            break;
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

    public clone(): FabrikGame {
        return new FabrikGame(this.serialize());
    }
}
