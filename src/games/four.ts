/* eslint-disable id-denylist */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import type { APRenderRep, Polymatrix } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Piece } from "./four/piece";
import { reviver, UserFacingError, matrixRectRot90, matrixRectRotN90, x2uid } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type PieceCode = "R1"|"R2"|"R3"|"R4"|"B1"|"B2"|"B3"|"B4"|"G1"|"G2"|"G3"|"G4"|"Y1"|"Y2"|"Y3"|"Y4";
export type Colour = "R"|"B"|"G"|"Y";
export type Size = 1|2|3|4

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Piece[];
    lastmove?: string;
    stashes: [PieceCode[], PieceCode[]];
    selected?: Polymatrix;
};

export interface IFourState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const genHashes = (): Map<string,string> => {
    const map = new Map<string,string>();
    for (const [k,v] of FourGame.piece2matrix.entries()) {
        map.set(x2uid(v), k);
    }
    return map;
}

export class FourGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Four",
        uid: "four",
        playercounts: [2],
        version: "20240216",
        dateAdded: "2024-02-18",
        // i18next.t("apgames:descriptions.four")
        description: "apgames:descriptions.four",
        urls: ["https://boardgamegeek.com/boardgame/133842/four"],
        people: [
            {
                type: "designer",
                name: "Stephen Tavener",
                urls: ["http://www.mrraow.com"]
            },
        ],
        variants: [
            {uid: "simplified"}
        ],
        categories: ["goal>immobilize", "mechanic>place", "board>shape>rect", "board>connect>rect", "board>dynamic", "components>poly"],
        flags: ["shared-pieces", "multistep"]
    };

    public static piece2matrix = new Map<string, Polymatrix>([
        ["R1", [[1]]],
        ["R2", [[1,1]]],
        ["R2(1)", [[1],[1]]],
        ["R3", [[1,1],[0,1]]],
        ["R3(1)", [[0,1],[1,1]]],
        ["R3(2)", [[1,0],[1,1]]],
        ["R3(3)", [[1,1],[1,0]]],
        ["R4", [[1,1],[1,1]]],
        ["B1", [[2]]],
        ["B2", [[2,2]]],
        ["B2(1)", [[2],[2]]],
        ["B3", [[2,2],[0,2]]],
        ["B3(1)", [[0,2],[2,2]]],
        ["B3(2)", [[2,0],[2,2]]],
        ["B3(3)", [[2,2],[2,0]]],
        ["B4", [[2,2],[2,2]]],
        ["G1", [[3]]],
        ["G2", [[3,3]]],
        ["G2(1)", [[3],[3]]],
        ["G3", [[3,3],[0,3]]],
        ["G3(1)", [[0,3],[3,3]]],
        ["G3(2)", [[3,0],[3,3]]],
        ["G3(3)", [[3,3],[3,0]]],
        ["G4", [[3,3],[3,3]]],
        ["Y1", [[4]]],
        ["Y2", [[4,4]]],
        ["Y2(1)", [[4],[4]]],
        ["Y3", [[4,4],[0,4]]],
        ["Y3(1)", [[0,4],[4,4]]],
        ["Y3(2)", [[4,0],[4,4]]],
        ["Y3(3)", [[4,4],[4,0]]],
        ["Y4", [[4,4],[4,4]]],
    ]);
    public static hash2piece: Map<string,string> = genHashes();

    // helper function to ensure that you always load a copy
    public static loadPiece(pc: string): Polymatrix|undefined {
        if (FourGame.piece2matrix.has(pc)) {
            return FourGame.piece2matrix.get(pc)!.map(lst => [...lst]);
        } else {
            return undefined;
        }
    }

    public get maxWidth(): number {
        if (this.variants.includes("simplified")) {
            return 7;
        }
        return 9;
    }
    public get maxHeight(): number {
        if (this.variants.includes("simplified")) {
            return 7;
        }
        return 9;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Piece[];
    public stashes!: [PieceCode[],PieceCode[]];
    public selected?: Polymatrix;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IFourState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const letters = ["R","B","G","Y"];
            const numbers = [1,2,3,4];
            if (this.variants.includes("simplified")) {
                numbers.pop();
            }
            const board: Piece[] = [];
            const stash: PieceCode[] = [];
            for (const letter of letters) {
                for (const number of numbers) {
                    stash.push(`${letter}${number}` as PieceCode);
                }
            }
            const fresh: IMoveState = {
                _version: FourGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stashes: [[...stash], [...stash]],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFourState;
            }
            if (state.game !== FourGame.gameinfo.uid) {
                throw new Error(`The Four engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FourGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = state.board.map(obj => new Piece(obj));
        this.stashes = state.stashes.map(lst => [...lst]) as [PieceCode[],PieceCode[]];
        this.lastmove = state.lastmove;
        this.selected = state.selected?.map(lst => [...lst]);
        return this;
    }

    private isEmpty(x: number, y: number): boolean {
        const contains = this.board.filter(p => p.includes(x, y));
        if (contains.length > 0) {
            return false;
        }
        return true;
    }

    // This function relies on brute force and validateMove.
    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        // get last placed colour and size
        let lastColour: Colour|undefined;
        let lastSize: Size|undefined;
        if (this.lastmove !== undefined) {
            lastColour = this.lastmove[0] as Colour;
            lastSize = parseInt(this.lastmove[1], 10) as Size;
        }
        // get pieces from your stash that don't match lastColour or lastSize
        let available = [...this.stashes[player - 1]];
        if (lastColour !== undefined) {
            available = available.filter(code => ! code.startsWith(lastColour!));
        }
        if (lastSize !== undefined) {
            available = available.filter(code => ! code.endsWith(lastSize!.toString()));
        }
        // get the board size
        const {minX, minY, maxX, maxY} = this.getMinMax();
        // for each stash piece
        for (const root of available) {
            // get all legal rotations and flips
            const pieces = [...FourGame.piece2matrix.keys()].filter(pc => pc.startsWith(root));
            // for each configuration
            for (const piece of pieces) {
                // if board is empty, then place all pieces at 0,0
                if (this.board.length === 0) {
                    moves.push(`${piece},0,0`);
                }
                // otherwise, check all possible placements
                else {
                    for (let y = minY - 2; y <= maxY + 2; y++) {
                        for (let x = minX - 2; x <= maxX + 2; x++) {
                            const move = `${piece},${x},${y}`;
                            const result = this.validateMove(move);
                            if (result.valid && result.complete === 1) {
                                moves.push(move);
                            }
                        }
                    }
                }
            }
        }

        return moves.sort();
    }

    public getMinMax(): {minX: number; minY: number; maxX: number; maxY: number} {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const piece of this.board) {
            const cells = piece.cells();
            minX = Math.min(minX, ...cells.map(([x,]) => x));
            minY = Math.min(minY, ...cells.map(([,y]) => y));
            maxX = Math.max(maxX, ...cells.map(([x,]) => x));
            maxY = Math.max(maxY, ...cells.map(([,y]) => y));
        }
        if (minX === Infinity) {
            minX = 0;
        }
        if (minY === Infinity) {
            minY = 0;
        }
        if (maxX === -Infinity) {
            maxX = 0;
        }
        if (maxY === -Infinity) {
            maxY = 0;
        }
        return {minX, minY, maxX, maxY};
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            // capture button clicks
            if (row === -1 || col === -1) {
                if (piece === undefined) {
                    throw new Error(`When clicking buttons, "piece" must always be defined.`);
                }
                // polyomino buttons
                if (piece.startsWith("_btn_")) {
                    // populate selected with initial piece
                    const [pc,] = move.split(",");
                    if (pc === undefined || pc.length === 0) {
                        throw new Error(`You tried to manipulate a polyomino before selecting one!`);
                    }
                    this.selected = FourGame.loadPiece(pc);
                    if (this.selected === undefined) {
                        throw new Error(`You tried to manipulate a polyomino before selecting one!`);
                    }
                    switch (piece) {
                        case "_btn_cancel":
                            this.selected = undefined;
                            break;
                        case "_btn_ccw":
                            this.selected = matrixRectRotN90(this.selected);
                            break;
                        case "_btn_cw":
                            this.selected = matrixRectRot90(this.selected);
                            break;
                        case "_btn_flipx":
                            this.selected.reverse();
                            break;
                        case "_btn_flipy":
                            this.selected = this.selected.map(lst => [...lst].reverse());
                            break;
                        default:
                            throw new Error(`Unrecognized button: ${piece}`);
                    }
                    if (this.selected !== undefined) {
                        newmove = FourGame.hash2piece.get(x2uid(this.selected))!;
                    }
                }
                // otherwise it's a stash piece
                else if (piece !== "SPACER") {
                    this.selected = FourGame.loadPiece(piece);
                    newmove = piece;
                }
            }
            // board clicks
            else {
                if (move !== "") {
                    const {minX, minY, maxX, maxY} = this.getMinMax();
                    const realWidth = maxX - minX + 1;
                    const realHeight = maxY - minY + 1;
                    let marginX = 2;
                    if (realWidth === this.maxWidth) {
                        marginX = 0;
                    }
                    let marginY = 2;
                    if (realHeight === this.maxHeight) {
                        marginY = 0;
                    }
                    const realX = minX - marginX + col;
                    const realY = maxY + marginY - row;
                    newmove = [move, realX, realY].join(",");
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

    // This has to be perfect because it used by moves(), which is backwards from usual.
    // Thankfully, the list of restrictions is small.
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.replace(/\s+/g, "");
        if (m.length > 0) {
            m = m[0].toUpperCase() + m.substring(1).toLowerCase();
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.four.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [pieceStr, x, y] = m.split(",");
        const piece = pieceStr.substring(0, 2) as PieceCode;

        // piece is in your stash
        if (! this.stashes[this.currplayer - 1].includes(piece)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.four.NO_PIECE", {piece});
            return result;
        }

        // not the same colour or size as opp's last move
        if (this.lastmove !== undefined) {
            if (this.lastmove[0] === piece[0] || this.lastmove[1] === piece[1]) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.four.DIFFERENT_MOVE");
                return result;
            }
        }

        if (x !== undefined && y !== undefined) {
            const col = parseInt(x, 10);
            const row = parseInt(y, 10);
            const matrix = FourGame.loadPiece(pieceStr)!;
            const newPiece = new Piece({col, row, matrix});

            // no overlap
            let overlaps = false;
            for (const cell of newPiece.cells()) {
                if (! this.isEmpty(...cell)) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.four.NO_OVERLAP", {piece: pieceStr, coord: `${x},${y}`});
                return result;
            }

            if (this.board.length > 0) {
                const cells = newPiece.cells();
                const surr = new Set<string>()
                for (const [cx,cy] of cells) {
                    const N = [cx, cy+1] as [number,number];
                    const E = [cx+1, cy] as [number,number];
                    const S = [cx, cy-1] as [number,number];
                    const W = [cx-1, cy] as [number,number];
                    for (const [nx, ny] of [N,E,S,W]) {
                        if (! newPiece.includes(nx, ny)) {
                            surr.add(`${nx},${ny}`);
                        }
                    }
                }

                // connected
                const connections = new Set<string>();
                for (const pt of surr) {
                    const [nx, ny] = pt.split(",").map(n => parseInt(n, 10));
                    if (! this.isEmpty(nx, ny)) {
                        // fetch piece
                        const found = this.board.find(pc => pc.includes(nx, ny));
                        if (found === undefined) {
                            throw new Error("Could not find the connecting piece. This should never happen.");
                        }
                        connections.add(FourGame.hash2piece.get(x2uid(found.matrix))!);
                    }
                }
                if (connections.size === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.four.MUST_CONNECT");
                    return result;
                }
                // not adjacent
                for (const conn of connections) {
                    if (conn[0] === piece[0] || conn[1] === piece[1]) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.four.NOT_ADJACENT");
                        return result;
                    }
                }
            }

            // grid is not too big
            const cloned = this.clone();
            cloned.board.push(newPiece);
            const {minX, minY, maxX, maxY} = cloned.getMinMax();
            const width = maxX - minX + 1;
            const height = maxY - minY + 1;
            if (width > cloned.maxWidth || height > cloned.maxHeight) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.four.TOO_BIG");
                return result;
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.four.PARTIAL");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): FourGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.replace(/\s+/g, "");
        if (m.length > 0) {
            m = m[0].toUpperCase() + m.substring(1).toLowerCase();
        }

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // the failsafe is useless since moves() uses validateMove() already
            // if (! this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];

        const [pieceStr, x, y] = m.split(",");
        let matrix: Polymatrix|undefined;
        if (pieceStr !== undefined && pieceStr.length > 0) {
            matrix = FourGame.loadPiece(pieceStr)!;
            this.selected = matrix;
        }
        if (matrix !== undefined && x !== undefined && y !== undefined) {
            const row = parseInt(y, 10);
            const col = parseInt(x, 10);
            const piece = new Piece({row, col, matrix});
            this.board.push(piece);
            this.results.push({type: "place", what: pieceStr, where: `${x},${y}`});
            const code = pieceStr.substring(0, 2);
            const idx = this.stashes[this.currplayer - 1].findIndex(c => c === code);
            if (idx !== -1) {
                this.stashes[this.currplayer - 1].splice(idx, 1);
            }
        }

        if (partial) { return this; }

        // clear any selected piece
        this.selected = undefined;

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

    protected checkEOG(): FourGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        // if no moves, prevPlayer wins
        if (this.moves().length === 0) {
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

    public state(): IFourState {
        return {
            game: FourGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FourGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.map(obj => obj.clone()),
            stashes: this.stashes.map(lst => [...lst]) as [PieceCode[],PieceCode[]],
            selected: this.selected?.map(lst => [...lst]),
        };
    }

    public render(): APRenderRep {
        const {minX, minY, maxX, maxY} = this.getMinMax();
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        let marginX = 2;
        if (width === this.maxWidth) {
            marginX = 0;
        }
        let marginY = 2;
        if (height === this.maxHeight) {
            marginY = 0;
        }
        const rowLabels: string[] = [];
        for (let y = minY - marginY; y <= maxY + marginY; y++) {
            rowLabels.push(y.toString());
        }
        const columnLabels: string[] = [];
        for (let x = minX - marginX; x <= maxX + marginX; x++) {
            columnLabels.push(x.toString());
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "polyomino",
            board: {
                style: "squares-beveled",
                width: width + (marginX*2),
                height: height + (marginY*2),
                rowLabels: rowLabels.map(l => l.replace("-", "\u2212")),
                columnLabels: columnLabels.map(l => l.replace("-", "\u2212")),
            },
            legend: {
                SPACER: {
                    name: "piece-square-borderless",
                    colour: "_context_background",
                },
            },
            pieces: this.board.map(p => p.render(columnLabels, [...rowLabels].reverse()))
        };

        // add stash glyphs
        const pcs = new Set<PieceCode>(this.stashes.flat());
        for (const pc of pcs) {
            const matrix = FourGame.loadPiece(pc)!;
            rep.legend![pc] = matrix;
        }

        // areas
        rep.areas = [];
        if (this.selected !== undefined) {
            rep.areas.push({
                type: "polyomino",
                label: i18next.t("apgames:validation.four.LABEL_SELECTED") || "local",
                matrix: this.selected,
            });
        }
        for (const player of [1,2] as playerid[]) {
            const stash = this.stashes[player - 1];
            const strs: string[] = [];
            const letters = ["R","B","G","Y"];
            const numbers = [1,2,3,4];
            let areaWidth = 4;
            if (this.variants.includes("simplified")) {
                numbers.pop();
                areaWidth = 3;
            }
            for (const letter of letters) {
                for (const number of numbers) {
                    const code = `${letter}${number}` as PieceCode;
                    if (stash.includes(code)) {
                        strs.push(code)
                    } else {
                        strs.push("SPACER");
                    }
                }
            }
            // @ts-ignore
            rep.areas.push({
                type: "pieces",
                pieces: [...strs] as [string, ...string[]],
                label: i18next.t("apgames:validation.fnap.LABEL_STASH", {playerNum: player}) || "local",
                width: areaWidth,
            });
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = move.where!.split(",");
                    const realRows = [...rowLabels].reverse();
                    const row = realRows.findIndex(l => l === y);
                    const col = columnLabels.findIndex(l => l === x);
                    const matrix = FourGame.loadPiece(move.what!)!;
                    const polyHeight = matrix.length;
                    let polyWidth = 0;
                    if (polyHeight > 0) {
                        polyWidth = matrix[0].length;
                    }
                    rep.annotations.push({type: "outline", targets: [{row, col}, {row, col: col + polyWidth}, {row: row + polyHeight, col: col + polyWidth}, {row: row + polyHeight, col}]});
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.complete", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): FourGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const cloned = Object.assign(new FourGame(), deepclone(this) as FourGame);
        cloned.board = cloned.board.map(obj => new Piece(obj));
        return cloned;
    }
}
