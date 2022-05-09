import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation, Variant } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

interface ILooseObj {
    [key: string]: any;
}

interface IRowCol {
    row: number;
    col: number;
}

type MarkerType = "glyph"|"fence"|"edge"|"shading"|"dots";
interface IGlyphMarker {
    type: MarkerType;
    glyph: string;
    points: IRowCol[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IZolaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ZolaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Zola",
        uid: "zola",
        playercounts: [2],
        version: "20211210",
        // i18next.t("apgames:descriptions.zola")
        description: "apgames:descriptions.zola",
        urls: ["http://www.marksteeregames.com/Zola.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            }
        ],
        variants: [
            {
                uid: "8x8",
                name: "Larger board: 8x8",
                group: "board"
            }
        ],
        flags: ["automove"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 6;

    constructor(state?: IZolaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] !== "") ) {
                const varInfo: (Variant|undefined)[] = variants.map(v => ZolaGame.gameinfo.variants!.find(n => n.uid === v));
                if (varInfo.includes(undefined)) {
                    throw new Error("Invalid variant passed.");
                }
                if (varInfo.filter(v => v?.group === "board").length > 1) {
                    throw new Error("You can't select two board variants.")
                }
                this.variants = [...variants];
            }
            this.boardSize = 6;
            if (this.variants.includes("8x8")) {
                this.boardSize = 8;
            }
            const board = new Map<string, playerid>();
            for (let row = 0; row < this.boardSize; row++) {
                let p: playerid = 1;
                if (row % 2 === 0) {
                    p = 2;
                }
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = ZolaGame.coords2algebraic(col, row, this.boardSize);
                    board.set(cell, p);
                    p++;
                    if (p > 2) {
                        p = 1;
                    }
                }
            }
            const fresh: IMoveState = {
                _version: ZolaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IZolaState;
            }
            if (state.game !== ZolaGame.gameinfo.uid) {
                throw new Error(`The Lines of Action engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ZolaGame {
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
        this.boardSize = 6;
        if (this.variants.includes("8x8")) {
            this.boardSize = 8;
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const ctr = (this.boardSize - 1) / 2;
        const mypieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);

        // non-capturing moves first
        for (const piece of mypieces) {
            const [x, y] = ZolaGame.algebraic2coords(piece, this.boardSize);
            const neighbours = grid.adjacencies(x, y, true);
            for (const [xn, yn] of neighbours) {
                const to = ZolaGame.coords2algebraic(xn, yn, this.boardSize);
                if (! this.board.has(to)) {
                    const fromDist = RectGrid.trueDistance(x, y, ctr, ctr);
                    const toDist = RectGrid.trueDistance(xn, yn, ctr, ctr);
                    if (toDist > fromDist) {
                        moves.push(`${piece}-${to}`);
                    }
                }
            }
        }

        // capturing moves
        for (const piece of mypieces) {
            const [x, y] = ZolaGame.algebraic2coords(piece, this.boardSize);
            for (const dir of allDirections) {
                const ray = grid.ray(x, y, dir);
                for (const [xn, yn] of ray) {
                    const to = ZolaGame.coords2algebraic(xn, yn, this.boardSize);
                    if (this.board.has(to)) {
                        if (this.board.get(to)! !== player) {
                            const fromDist = RectGrid.trueDistance(x, y, ctr, ctr);
                            const toDist = RectGrid.trueDistance(xn, yn, ctr, ctr);
                            if (toDist <= fromDist) {
                                moves.push(`${piece}x${to}`);
                            }
                        }
                        break;
                    }
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
            const cell = ZolaGame.coords2algebraic(col, row, this.boardSize);
            let newmove = "";
            if (move.length === 0) {
                if ( (this.board.has(cell)) && (this.board.get(cell)! === this.currplayer)) {
                    newmove = cell;
                } else {
                    return {move: "", message: ""} as IClickResult;
                }
            } else {
                const [from,] = move.split(/[-x]/);
                // empty cell must be a move
                if (! this.board.has(cell)) {
                    newmove = `${from}-${cell}`;
                // occupied enemy cell is a capture
                } else if ( (this.board.has(cell)) && (this.board.get(cell)! !== this.currplayer) ) {
                    newmove = `${from}x${cell}`;
                // if it's your own piece, assume you're selecting a new starting piece
                } else if ( (this.board.has(cell)) && (this.board.get(cell)! === this.currplayer) ) {
                    newmove = cell;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.zola.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [from, to] = m.split(/[-x]/);

        // valid cell
        let xFrom: number; let yFrom: number;
        try {
            [xFrom, yFrom] = ZolaGame.algebraic2coords(from, this.boardSize);
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
        // is yours
        if (this.board.get(from)! !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        if ( (to === undefined) || (to.length === 0) ) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.zola.PARTIAL");
            return result;
        } else {
            // valid cell
            let xTo: number; let yTo: number;
            try {
                [xTo, yTo] = ZolaGame.algebraic2coords(to, this.boardSize);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
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
            // distance requirements met
            const ctr = (this.boardSize - 1) / 2;
            const fromDist = RectGrid.trueDistance(xFrom, yFrom, ctr, ctr);
            const toDist = RectGrid.trueDistance(xTo, yTo, ctr, ctr);
            if ( (m.includes("-")) && (toDist <= fromDist) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.zola.DISTANCE_NONCAPTURES");
                return result;
            }
            if ( (m.includes("x")) && (toDist > fromDist) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.zola.DISTANCE_CAPTURES");
                return result;
            }

            // valid full move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string): ZolaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        const [from, to] = m.split(/[-x]/);
        this.board.delete(from);
        this.board.set(to, this.currplayer);
        this.results = [{type: "move", from, to}];
        if (m.includes("x")) {
            this.results.push({type: "capture", where: to})
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

    protected checkEOG(): ZolaGame {
        if (this.moves().length === 0) {
            let prevplayer: playerid = 1;
            if (this.currplayer === 1) {
                prevplayer = 2;
            }
            this.gameover = true;
            this.winner = [prevplayer];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public resign(player: playerid): ZolaGame {
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

    public state(): IZolaState {
        return {
            game: ZolaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ZolaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    private getDistances(): number[] {
        const distances: Set<number> = new Set();
        const ctr = (this.boardSize - 1) / 2;
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const dist = RectGrid.trueDistance(col, row, ctr, ctr);
                distances.add(dist);
            }
        }
        return [...distances].sort((a, b) => a - b);
    }

    private getColours(num: number): string[] {
        const colours: string[] = [];
        const interval = Math.floor(200 / (num - 1));
        for (let n = 0; n < num; n++) {
            let unit = (256 - (n * interval)).toString(16);
            if (unit.length > 2) {
                unit = "f";
            }
            colours.push(`#${unit}${unit}${unit}`);
        }
        return colours;
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
                const cell = ZolaGame.coords2algebraic(col, row, this.boardSize);
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

        // build legend with distance marker tiles
        const myLegend: ILooseObj = {
            "A": {
                "name": "piece",
                "player": 1,
            },
            "B": {
                "name": "piece",
                "player": 2,
            },
        };

        const distances = this.getDistances();
        const colours = this.getColours(distances.length);
        const cells: Map<string, [number, number][]> = new Map();
        const ctr = (this.boardSize - 1) / 2;
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const dist = RectGrid.trueDistance(col, row, ctr, ctr);
                const idx = distances.findIndex(d => d === dist);
                if (idx < 0) {
                    throw new Error("Could not find the distance in the list of distances.");
                }
                const key = `_dist${idx}`;
                if (cells.has(key)) {
                    const val = cells.get(key)!;
                    val.push([col, row]);
                    cells.set(key, val);
                } else {
                    cells.set(key, [[col, row]]);
                }
                const colour = colours[idx];
                myLegend[key] = {
                    name: "piece-square",
                    colour
                };
            }
        }

        // create the board markers
        const markers: IGlyphMarker[] = [];
        for (const [k, v] of cells.entries()) {
            const points: IRowCol[] = [];
            for (const pt of v) {
                points.push({row: pt[1], col: pt[0]});
            }
            markers.push({
                type: "glyph",
                glyph: k,
                points,
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            // @ts-expect-error
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = ZolaGame.algebraic2coords(move.from, this.boardSize);
                    const [toX, toY] = ZolaGame.algebraic2coords(move.to, this.boardSize);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = ZolaGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of ZolaGame.gameinfo.variants!) {
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
                const node: string[] = [(state._timestamp && state._timestamp.toLocaleString()) || "unknown"];
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
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.minimal"));
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

    public clone(): ZolaGame {
        return new ZolaGame(this.serialize());
    }
}
