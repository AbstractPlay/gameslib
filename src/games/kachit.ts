/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood, MarkerGlyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { diagDirections, Direction, orthDirections, RectGrid, reviver, SquareDirectedGraph, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Orientation = "+"|"x"|undefined;
export type RealPiece = {
    owner: playerid;
    orientation: Orientation;
    royal: boolean;
};
export type Piece = "PH"|RealPiece;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
    inhand: [number,number];
};

export interface IKachitState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class KachitGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Kachit Knights",
        uid: "kachit",
        playercounts: [2],
        version: "20250131",
        dateAdded: "2025-01-27",
        // i18next.t("apgames:descriptions.kachit")
        description: "apgames:descriptions.kachit",
        urls: [
            "https://boardgamegeek.com/boardgame/189513/kachit-knights",
        ],
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
        categories: ["goal>royal-capture", "goal>royal-escape", "mechanic>capture", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>custom"],
        flags: ["perspective", "limited-pieces"],
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 4);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 4);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public inhand!: [number,number];
    private graph!: SquareDirectedGraph;
    private dots: string[] = [];
    private highlights: string[] = [];

    constructor(state?: IKachitState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Piece>([
                ["d1", {owner: 1, orientation: undefined, royal: true}],
                ["a4", {owner: 2, orientation: undefined, royal: true}],
            ]);
            const fresh: IMoveState = {
                _version: KachitGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                inhand: [3,3],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IKachitState;
            }
            if (state.game !== KachitGame.gameinfo.uid) {
                throw new Error(`The Kachit engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): KachitGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this.board = deepclone(state.board) as Map<string, Piece>;
        this.inhand = [...state.inhand];
        this.lastmove = state.lastmove;
        this.graph = new SquareDirectedGraph(4, 4);
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves = new Set<string>();

        // if you have pieces in hand, you may place a piece
        if (this.inhand[this.currplayer - 1] > 0) {
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const sum = x + y;
                    let canPlace = false;
                    if (this.currplayer === 1) {
                        if (sum > 3 && sum !== 6) {
                            canPlace = true;
                        }
                    } else {
                        if (sum < 3 && sum !== 0) {
                            canPlace = true;
                        }
                    }
                    if (canPlace) {
                        const cell = KachitGame.coords2algebraic(x, y);
                        if (!this.board.has(cell)) {
                            moves.add(`${cell}+`);
                            moves.add(`${cell}x`);
                        }
                    }
                }
            }
        }

        // you can move any pieces currently on the board
        const mine = [...this.board.entries()].filter(([,pc]) => pc !== "PH" && pc.owner === this.currplayer) as [string, RealPiece][];
        for (const [cell, pc] of mine) {
            // kings can always move to adjacent cells
            if (pc.royal) {
                for (const n of this.graph.neighbours(cell)) {
                    const contents = this.board.get(n);
                    if (contents === undefined || (contents !== "PH" && contents.owner !== this.currplayer)) {
                        const [nx, ny] = KachitGame.algebraic2coords(n);
                        if (pc.orientation === undefined && nx+ny !== 3) {
                            if (!this.board.has(n)) {
                                moves.add(`${cell}-${n}`);
                            } else {
                                moves.add(`${cell}x${n}`);
                            }
                        } else {
                            if (!this.board.has(n)) {
                                moves.add(`${cell}-${n}+`);
                                moves.add(`${cell}-${n}x`);
                            } else {
                                moves.add(`${cell}x${n}+`);
                                moves.add(`${cell}x${n}x`);
                            }
                        }
                    }
                }
            }
            // all pieces with orientation can move along arrows
            if (pc.orientation !== undefined) {
                let validDirs: Direction[];
                if (pc.orientation === "+") {
                    validDirs = [...orthDirections];
                } else {
                    validDirs = [...diagDirections];
                }
                for (const dir of validDirs) {
                    const ray = this.graph.ray(cell, dir);
                    for (const next of ray) {
                        // if empty, can move there and keep looking
                        if (!this.board.has(next)) {
                            moves.add(`${cell}-${next}+`);
                            moves.add(`${cell}-${next}x`);
                        }
                        // if enemy piece, capture and stop looking
                        else if (this.board.get(next)! !== "PH" && (this.board.get(next)! as RealPiece).owner !== this.currplayer) {
                            moves.add(`${cell}x${next}+`);
                            moves.add(`${cell}x${next}x`);
                            break;
                        }
                        // if friendly piece, just stop looking
                        else {
                            break;
                        }
                    }
                }
            }
        }

        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = KachitGame.coords2algebraic(col, row);
            let newmove: string;

            // empty move means starting a move or placement
            if (move === "") {
                newmove = cell;
            } else {
                // move in progress is a placement
                if (move.length === 2 && !this.board.has(move)) {
                    const [fx, fy] = KachitGame.algebraic2coords(move);
                    const bearing = RectGrid.bearing(fx, fy, col, row);
                    // undefined means error
                    if (bearing === undefined) {
                        newmove = move;
                    }
                    // diag
                    else if (bearing.length === 2) {
                        newmove = move + "x";
                    }
                    // orth
                    else {
                        newmove = move + "+";
                    }
                }
                // otherwise some sort of movement
                else {
                    // choosing a destination
                    if (move.length === 2) {
                        const contents = this.board.get(cell);
                        // clicking a friendly resets
                        if (contents !== undefined && contents !== "PH" && contents.owner === this.currplayer) {
                            newmove = cell;
                        }
                        // otherwise occupied is a capture
                        else if (this.board.has(cell)) {
                            newmove = move + "x" + cell;
                        }
                        // otherwise a move
                        else {
                            newmove = move + "-" + cell;
                        }
                    }
                    // choosing an orientation
                    else {
                        const [,to] = move.split(/[-x]/);
                        const [tx, ty] = KachitGame.algebraic2coords(to);
                        const bearing = RectGrid.bearing(tx, ty, col, row);
                        // undefined means error
                        if (bearing === undefined) {
                            newmove = move;
                        }
                        // diag
                        else if (bearing.length === 2) {
                            newmove = move + "x";
                        }
                        // orth
                        else {
                            newmove = move + "+";
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
        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.kachit.INITIAL_INSTRUCTIONS", {context: this.inhand[this.currplayer - 1] > 0 ? "inhand" : "placed"});
            return result;
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                const needDest = m.length === 2 && this.board.has(m);
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.kachit.PARTIAL", {context: needDest ? "destination" : "orientation"});
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): KachitGame {
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
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];
        this.highlights = [];

        if (partial) {
            // if selecting an existing piece, populate movement dots
            if (m.length === 2 && this.board.has(m)) {
                const matches = allMoves.filter(mv => mv.startsWith(m)).filter(mv => mv.length > 3);
                if (matches.length > 0) {
                    this.dots = [...new Set<string>(matches.map(mv => {
                        let idx: number;
                        idx = mv.indexOf("-");
                        if (idx < 0) {
                            idx = mv.indexOf("x");
                        }
                        return mv.substring(idx+1, idx+3);
                    })).values()];
                }
            }
            // otherwise, populate highlights
            else {
                if (m.length === 2) {
                    this.board.set(m, "PH");
                    this.highlights = [...this.graph.neighbours(m)];
                } else if (m.length === 5) {
                    // move the piece for clarity
                    const from = m.substring(0, 2);
                    const to = m.substring(3, 5);
                    const fContents = this.board.get(from)!;
                    this.board.set(to, fContents);
                    this.board.delete(from);
                    this.highlights = [...this.graph.neighbours(to)];
                }
            }
            return this;
        }

        // placement
        if (m.length === 3) {
            const cell = m.substring(0, 2);
            const orientation = m[2] as Orientation;
            this.board.set(cell, {owner: this.currplayer, orientation, royal: false})
            this.results.push({type: "place", where: cell});
            this.inhand[this.currplayer - 1]--;
        }
        // movement
        else {
            // can't use split because of the "x" orientation
            let idx: number;
            idx = m.indexOf("-");
            if (idx < 0) {
                idx = m.indexOf("x");
            }
            if (idx < 0) {
                throw new Error("Could not split move. This should never happen.");
            }
            const from = m.substring(0, idx);
            const right = m.substring(idx+1);
            const to = right.substring(0, 2);
            const orientation = right[2] as Orientation;
            const fContents = this.board.get(from)! as RealPiece;
            const tContents = this.board.get(to);
            this.board.delete(from);
            this.board.set(to, {...fContents, orientation});
            this.results.push({type: "move", from, to});
            if (tContents !== undefined) {
                this.results.push({type: "capture", where: to});
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

    protected checkEOG(): KachitGame {
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        let reason: string|undefined;

        // if current player has no no king, previous player wins
        const myKing = [...this.board.values()].find(pc => pc !== "PH" && pc.owner === this.currplayer && pc.royal);
        if (myKing === undefined) {
            this.gameover = true;
            this.winner = [prev];
            reason = "regicide";
        }

        // if previous player has a king in opposing castle, they win
        if (!this.gameover) {
            const prevKing = [...this.board.entries()].find(([,pc]) => pc !== "PH" && pc.owner === prev && pc.royal)?.[0];
            if (prevKing !== undefined && prevKing === (prev === 1 ? "a4" : "d1")) {
                this.gameover = true;
                this.winner = [prev];
                reason = "invasion";
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IKachitState {
        return {
            game: KachitGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: KachitGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            inhand: [...this.inhand],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 4; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 4; col++) {
                const cell = KachitGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === "PH") {
                        pieces.push("PH")
                    } else {
                        const {owner, orientation, royal} = contents;
                        pieces.push(`${owner === 1 ? "A" : "B"}${royal ? "K" : ""}${orientation === undefined ? "" : orientation === "+" ? "O" : "D"}`);
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // pstr = pstr.replace(/-{5}/g, "_");

        // populate the markers
        const markers: (MarkerFlood|MarkerGlyph)[] = [];
        const p1: RowCol[] = [];
        const p2: RowCol[] = [];
        const pk: RowCol[] = [];
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const sum = col + row;
                if (sum === 0 || sum === 6) {
                    markers.push({
                        type: "glyph",
                        glyph: `${sum === 0 ? "B" : "A"}H`,
                        points: [{row, col}],
                    });
                } else if (sum === 3) {
                    pk.push({row, col});
                } else {
                    if (sum < 3) {
                        p2.push({row, col});
                    } else {
                        p1.push({row, col});
                    }
                }
            }
        }
        markers.push({
            type: "flood",
            colour: 1,
            points: p1 as [RowCol, ...RowCol[]],
        });
        markers.push({
            type: "flood",
            colour: 2,
            points: p2 as [RowCol, ...RowCol[]],
        });
        markers.push({
            type: "glyph",
            glyph: "K",
            points: pk as [RowCol, ...RowCol[]],
        });

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 4,
                height: 4,
                rotate: 45,
                markers,
            },
            legend: {
                AO: [
                    {
                        name: "piece",
                        colour: "_context_background"
                    },
                    {
                        name: "arrows-orth",
                        colour: 1,
                        scale: 0.9,
                    }
                ],
                AD: [
                    {
                        name: "piece",
                        colour: "_context_background"
                    },
                    {
                        name: "arrows-diag",
                        colour: 1,
                        scale: 0.65,
                    }
                ],
                AK: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33,
                    }
                ],
                AKO: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33,
                    },
                    {
                        name: "arrows-orth",
                        colour: "_context_fill",
                        scale: 0.9,
                    },
                ],
                AKD: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33,
                    },
                    {
                        name: "arrows-diag",
                        colour: "_context_fill",
                        scale: 0.65,
                    },
                ],
                BO: [
                    {
                        name: "piece",
                        colour: "_context_background"
                    },
                    {
                        name: "arrows-orth",
                        colour: 2,
                        scale: 0.9,
                    }
                ],
                BD: [
                    {
                        name: "piece",
                        colour: "_context_background"
                    },
                    {
                        name: "arrows-diag",
                        colour: 2,
                        scale: 0.65,
                    }
                ],
                BK: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33,
                    }
                ],
                BKO: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33,
                    },
                    {
                        name: "arrows-orth",
                        colour: "_context_fill",
                        scale: 0.9,
                    },
                ],
                BKD: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33,
                    },
                    {
                        name: "arrows-diag",
                        colour: "_context_fill",
                        scale: 0.65,
                    },
                ],
                K: {
                    name: "katanas",
                    colour: "_context_fill",
                    opacity: 0.25,
                    scale: 0.75,
                    orientation: "vertical",
                },
                AH: {
                    name: "castle-solid",
                    colour: 1,
                    opacity: 0.25,
                    scale: 0.95,
                    orientation: "vertical",
                },
                BH: {
                    name: "castle-solid",
                    colour: 2,
                    opacity: 0.25,
                    scale: 0.95,
                    orientation: "vertical",
                },
                PH: {
                    name: "piece",
                    colour: "_context_background"
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = KachitGame.algebraic2coords(move.from);
                    const [toX, toY] = KachitGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture" || move.type === "place") {
                    const [x, y] = KachitGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = KachitGame.algebraic2coords(cell);
                targets.push({col: x, row: y});
            }
            rep.annotations!.push({
                type: "dots",
                targets: targets as [RowCol, ...RowCol[]],
                colour: 3,
            });
        }

        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.highlights) {
                const [x, y] = KachitGame.algebraic2coords(cell);
                targets.push({col: x, row: y});
            }
            rep.annotations!.push({
                type: "enter",
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

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.inhand }
        ]
    }

    public getCustomRotation(): number | undefined {
        return 180;
    }

    public clone(): KachitGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        return Object.assign(new KachitGame(), deepclone(this) as KachitGame);
    }
}
