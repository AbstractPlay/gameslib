import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Piece = "K"|"C";
export type CellContents = [playerid,Piece];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface ICourtesanState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const forwardDirs: [Directions[],Directions[]] = [["N", "E", "NE"], ["W","S","SW"]];

export class CourtesanGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "King & Courtesan",
        uid: "courtesan",
        playercounts: [2],
        version: "20230702",
        // i18next.t("apgames:descriptions.courtesan")
        description: "apgames:descriptions.courtesan",
        urls: ["https://www.marksteeregames.com/King_and_Courtesan_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            }
        ],
        flags: ["pie", "multistep", "perspective"],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }


    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ICourtesanState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const [h1x, h1y, h2x, h2y] = [0,7,7,0];
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    let p: playerid|undefined;
                    if (RectGrid.manhattan(col, row, h1x, h1y) <= 6) {
                        p = 1;
                    } else if (RectGrid.manhattan(col, row, h2x, h2y) <= 6) {
                        p = 2;
                    }
                    if (p !== undefined) {
                        const cell = CourtesanGame.coords2algebraic(col, row);
                        let piece: Piece = "C";
                        if ( (cell === "a1") || (cell === "h8") ) {
                            piece = "K";
                        }
                        board.set(cell, [p, piece]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: CourtesanGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICourtesanState;
            }
            if (state.game !== CourtesanGame.gameinfo.uid) {
                throw new Error(`The King & Courtesan engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CourtesanGame {
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

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        const grid = new RectGrid(8, 8);
        const mypieces = [...this.board.entries()].filter(e => e[1][0] === player).map(e => e[0]);

        for (const piece of mypieces) {
            const [fx, fy] = CourtesanGame.algebraic2coords(piece);
            // noncapturing in forward direction
            for (const dir of forwardDirs[player - 1]) {
                const [tx,ty] = RectGrid.move(fx, fy, dir);
                if (grid.inBounds(tx,ty)) {
                    const next = CourtesanGame.coords2algebraic(tx,ty);
                    if (! this.board.has(next)) {
                        moves.push(`${piece}-${next}`);
                    }
                }
            }

            // capturing in any direction
            for (const dir of allDirections) {
                const [tx,ty] = RectGrid.move(fx, fy, dir);
                if (grid.inBounds(tx,ty)) {
                    const next = CourtesanGame.coords2algebraic(tx,ty);
                    if (this.board.has(next)) {
                        const contents = this.board.get(next)!;
                        if (contents[0]  !== player) {
                            moves.push(`${piece}x${next}`);
                        }
                    }
                }
            }
        }
        // exchange moves (in forward directions only)
        const king = [...this.board.entries()].filter(e => e[1][0] === player && e[1][1] === "K").map(e => e[0])[0];
        const [kx, ky] = CourtesanGame.algebraic2coords(king);
        for (const dir of forwardDirs[player - 1]) {
            const [tx,ty] = RectGrid.move(kx, ky, dir);
            if (grid.inBounds(tx,ty)) {
                const next = CourtesanGame.coords2algebraic(tx,ty);
                if (this.board.has(next)) {
                    const contents = this.board.get(next)!;
                    if (contents[0] === player) {
                        moves.push(`${king}/${next}`);
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
        try {
            const cell = CourtesanGame.coords2algebraic(col, row);
            let contents: CellContents|undefined;
            if (this.board.has(cell)) {
                contents = this.board.get(cell)!;
            }
            let newmove = "";

            if (move.length === 0) {
                // if friendly, start the move
                if ( (contents !== undefined) && (contents[0] === this.currplayer) ) {
                    newmove = cell;
                }
                // otherwise reject
                else {
                    return {move: "", message: i18next.t("apgames:validation._general.UNCONTROLLED")} as IClickResult;
                }
            } else {
                const oldmove = move.substring(0, 2);
                // if empty, just move
                if (contents === undefined) {
                    newmove = `${oldmove}-${cell}`;
                }
                // if enemy, capture
                else if (contents[0] !== this.currplayer) {
                    newmove = `${oldmove}x${cell}`;
                }
                // if friendly and a king, exchange
                else if (contents[1] === "C") {
                    newmove = `${oldmove}/${cell}`;
                }
                // otherwise reject
                else {
                    return {move, message: i18next.t("apgames:validation._general.UNKNOWN_CLICK")} as IClickResult;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.courtesan.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [from, to] = m.split(/[-x\/]/);

        // valid cell
        let xFrom: number; let yFrom: number;
        try {
            [xFrom, yFrom] = CourtesanGame.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // is occupied
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        const fcontents = this.board.get(from)!;
        // is yours
        if (fcontents[0] !== this.currplayer) {
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
            // valid cell
            let xTo: number; let yTo: number;
            let tcontents: CellContents|undefined;
            try {
                [xTo, yTo] = CourtesanGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // only one space at a time
            if (RectGrid.distance(xFrom, yFrom, xTo, yTo) !== 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.courtesan.DISTANCE_ONE");
                return result;
            }
            if (this.board.has(to)) {
                tcontents = this.board.get(to)!;
            }
            // correct operator
            if ( (m.includes("-")) && (this.board.has(to)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                return result;
            }
            if ( (m.includes("x")) && (! this.board.has(to)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                return result;
            }

            // validate each operator
            if (m.includes("-")) {
                // must be in forward direction
                const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo);
                if ( (dir === undefined) || (! forwardDirs[this.currplayer - 1].includes(dir)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.courtesan.INVALID_DIR");
                    return result;
                }
            } else if (m.includes("x")) {
                // `to` must be occupied by enemy piece
                if ( (tcontents === undefined) || (tcontents[0] === this.currplayer) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }
            } else if (m.includes("/")) {
                // must be in forward direction
                const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo);
                if ( (dir === undefined) || (! forwardDirs[this.currplayer - 1].includes(dir)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.courtesan.INVALID_DIR");
                    return result;
                }
                // from must be a king and to must be a courtesan
                if ( (fcontents[1] !== "K") || (tcontents![1] !== "C") ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.courtesan.INVALID_EXCHANGE");
                    return result;
                }
            }

            // valid full move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): CourtesanGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        // if partial, just set the points and get out
        if ( (partial) && (! m.includes("-")) && (! m.includes("x")) && (! m.includes("/")) ) {
            const pts = this.moves().filter(mv => mv.startsWith(m)).map(mv => mv.substring(mv.length - 2));
            if (pts.length > 0) {
                this._points = pts.map(c => CourtesanGame.algebraic2coords(c));
            } else {
                this._points = [];
            }
            return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }


        const [from, to] = m.split(/[-x\/]/);
        const contents = this.board.get(from)!;
        if (m.includes("/")) {
            this.board.set(from, [this.currplayer, "C"]);
            this.board.set(to, [this.currplayer, "K"]);
            this.results = [{type: "move", from, to}];
            this.results.push({type: "convert", what: "C", into: "K", where: to});
        } else {
            this.board.delete(from);
            this.board.set(to, contents);
            this.results = [{type: "move", from, to}];
            if (m.includes("x")) {
                this.results.push({type: "capture", where: to})
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

    protected checkEOG(): CourtesanGame {
        const home1 = this.board.get("a1");
        const home2 = this.board.get("h8");
        const kings1 = [...this.board.values()].filter(([p, pc]) => p === 1 && pc === "K");
        const kings2 = [...this.board.values()].filter(([p, pc]) => p === 2 && pc === "K");
        if ( (home1 !== undefined) && (home1[0] === 2) && (home1[1] === "K") ) {
            this.gameover = true;
            this.winner = [2];
        } else if ( (home2 !== undefined) && (home2[0] === 1) && (home2[1] === "K") ) {
            this.gameover = true;
            this.winner = [1];
        } else if (kings1.length === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (kings2.length === 0) {
            this.gameover = true;
            this.winner = [1];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ICourtesanState {
        return {
            game: CourtesanGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CourtesanGame.gameinfo.version,
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
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = CourtesanGame.coords2algebraic(col, row);
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
                width: 8,
                height: 8,
                markers: [
                    {
                        type: "shading",
                        colour: 1,
                        opacity: 0.75,
                        points: [
                            {col: 0, row: 7},
                            {col: 1, row: 7},
                            {col: 1, row: 8},
                            {col: 0, row: 8}
                        ]
                    },
                    {
                        type: "shading",
                        colour: 2,
                        opacity: 0.75,
                        points: [
                            {col: 7, row: 0},
                            {col: 7, row: 1},
                            {col: 8, row: 1},
                            {col: 8, row: 0}
                        ]
                    }
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece-chariot",
                    player: 1
                },
                Y: {
                    name: "piece",
                    player: 2
                },
                Z: {
                    name: "piece-chariot",
                    player: 2
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
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }

            if (this.results.length > 0) {
                for (const move of this.results) {
                    if (move.type === "move") {
                        const [fromX, fromY] = CourtesanGame.algebraic2coords(move.from);
                        const [toX, toY] = CourtesanGame.algebraic2coords(move.to);
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    } else if ( (move.type === "capture") || (move.type === "convert") ) {
                        const [x, y] = CourtesanGame.algebraic2coords(move.where!);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                }
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "convert":
                node.push(i18next.t("apresults:CONVERT.courtesan", {player, where: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): CourtesanGame {
        return new CourtesanGame(this.serialize());
    }
}
