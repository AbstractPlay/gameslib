
import {  GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult, IStashEntry, ICustomButton, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AreaPieces, BoardBasic, Colourfuncs, Glyph, MarkerDots, MarkerGlyph, MarkerLine, MarkerShading, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, shuffle, cloneState } from "../common/index.js";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs/index.js";
import {
    isRoadNetworkConnected,
    realDistanceOnBoard,
    roadNetworkAfterPlacement,
} from "./acity-road.js";
export const gameApgamesEn = {
    validation: {
        BAD_DOME: "Domes may only be placed on tiles of the same colour unless all such placements break the road network.",
        BAD_TOWER: "Towers may only be placed on tiles their own colour, on black tiles, or on tiles that already contain two legally placed structures.",
        BROKEN_ROAD: "Placing a piece at {{where}} would break the road network.",
        CLAIM_TOWERS: "You may only claim towers.",
        CLAIM_ENDS_GAME: "You may not claim a tower on the last placement of the game.",
        DOUBLE_CLAIM: "The tower at {{where}} has already been claimed.",
        INITIAL_INSTRUCTIONS: "Select a piece from your stash, or type 'pass' if you have no legal moves remaining.",
        INVALID_PIECE: "You don't have {{piece}} in your stash to place.",
        ISOLATED: "Placing a piece at {{where}} would cut another piece off from the road network.",
        MARKER: "You may not build on the lot containing the suit icon until all other legally buildable lots on that tile are occupied.",
        NO_MORE_CLAIMS: "You have already claimed three towers. You may not claim any more.",
        PARTIAL_MOVE: "Select the lot where you want to build.",
        VALID_W_CLAIMS: "Looks like a valid move. You may also choose to claim a tower.",
        LABEL_STASH: "{{player}}'s stash",
    },
    displays: {
        roads: {
            description: "Display the growing road network.",
            name: "Roads",
        },
    },
};


export type playerid = 1|2;

type Piece = "RT"|"RD"|"BT"|"BD"|"GT"|"GD"|"ND";
type Color = "R"|"B"|"G"|"N";
type MarkerPos = 0|1|2|3;
export type ACityPiece = Piece;
export type ACityColor = Color;
export type ACityMarkerPos = MarkerPos;
type PlacementResult = "GOOD"|"ROAD"|"ISOLATED"|"DOMES"|"TOWERS"|"MARKER";
export type ACityPlacementResult = PlacementResult;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
    stashes: [Piece[],Piece[]];
    claimed: [string[],string[]];
};

export interface IACityState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    startpos: [Color,MarkerPos][]
};

interface ITile {
    guild: Color;
    marker: string;
    cells: string[];
}

export class ACityGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Alien City",
        uid: "acity",
        playercounts: [2],
        version: "20230531",
        dateAdded: "2023-06-22",
        description: "Alien City is a combination Piecepack/Icehouse game about building a city on a newly colonized world. Four guilds compete for customers, and the player has to predict which bets are going to pay off. Each turn, the player places either a tower or dome and may optionally claim a tower they think is going to score big when the game ends. Play continues until no more construction is possible. Scores are based on the relative positions of buildings to claimed towers.",
        urls: ["https://www.looneylabs.com/content/alien-city", "https://boardgamegeek.com/boardgame/20623/alien-city"],
        bggid: "20623",
        people: [
            {
                type: "designer",
                name: "Michael Schoessow",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of the Sun suit"
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of the Anchor suit"
            },
            {
                num: 3,
                default: 3,
                explanation: "Colour of the Crown suit"
            },
            {
                num: 4,
                default: "#000",
                explanation: "Colour of the Moon suit"
            },
            {
                num: 5,
                default: "#fff",
                explanation: "Colour of the first player",
                player: 1
            },
            {
                num: 6,
                default: "#000",
                explanation: "Colour of the second player",
                player: 2
            },
        ],
        categories: ["goal>score>eog", "mechanic>network", "mechanic>place", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>pyramids", "components>piecepack"],
        flags: ["player-stashes", "scores", "custom-colours", "random-start", "custom-buttons", "custom-randomization"],
        displays: [{uid: "roads"}],
    };

    public static piece2string(pc: Piece): string {
        let str = "";
        switch(pc[0]) {
            case "N":
                str += "black";
                break;
            case "R":
                str += "red";
                break;
            case "G":
                str += "green";
                break;
            case "B":
                str += "blue";
                break;
            default:
                str += "??";
                break;
        }
        switch(pc[1]) {
            case "D":
                str += " dome";
                break;
            case "T":
                str += " tower";
                break;
            default:
                str += " ??";
                break;
        }
        return str;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public stashes!: [Piece[],Piece[]];
    public graph!: SquareOrthGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public startpos!: [Color,MarkerPos][];
    public claimed!: [string[],string[]];
    private distCacheSig = "";
    private distCache = new Map<string, number>();

    constructor(state?: IACityState | string) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: ACityGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                stashes: [
                    ["RD","RD","RD","BD","BD","BD","GD","GD","GD","ND","ND","ND","RT","RT","RT","BT","BT","GT","GT"],
                    ["RD","RD","RD","BD","BD","BD","GD","GD","GD","ND","ND","ND","RT","RT","BT","BT","BT","GT","GT"],
                ],
                claimed: [[],[]]
            };
            this.stack = [fresh];
            this.startpos = [];
            for (const colour of shuffle("NNNNNRRRRRGGGGGBBBBB".split(""))) {
                const cell = Math.floor(Math.random() * 4);
                this.startpos.push([colour as Color, cell as MarkerPos]);
            }
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IACityState;
            }
            if (state.game !== ACityGame.gameinfo.uid) {
                throw new Error(`The Alien City engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.startpos = cloneState(state.startpos) as [Color,MarkerPos][];
        }
        this.load();
    }

    public load(idx = -1): ACityGame {
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
        this.stashes = cloneState(state.stashes) as [Piece[],Piece[]];
        this.claimed = cloneState(state.claimed) as [string[],string[]];
        this.buildGraph();
        return this;
    }

    private buildGraph(): ACityGame {
        this.graph = new SquareOrthGraph(8, 10);
        // for each cell that has pieces
        for (const cell of this.board.keys()) {
            // look at each neighboring cell
            for (const n of this.graph.neighbours(cell)) {
                // if that cell also has a piece
                if (this.board.has(n)) {
                    // remove the direct connection between them
                    // you can only connect along the road
                    this.graph.graph.dropEdge(cell, n);
                }
            }
        }
        return this;
    }

    /** True when the player has at least one complete placement (including optional-claim partials). */
    private hasLegalPlacement(player: playerid): boolean {
        const saved = this.currplayer;
        this.currplayer = player;
        try {
            const stash = new Set<string>(this.stashes[player - 1]);
            const empties = (this.graph.listCells() as string[]).filter((c) => ! this.board.has(c));
            for (const piece of stash) {
                for (const cell of empties) {
                    const result = this.validateMove(`${piece}-${cell}`);
                    if ( (result.valid) && (result.complete !== undefined) && (result.complete >= 0) ) {
                        return true;
                    }
                }
            }
            return false;
        } finally {
            this.currplayer = saved;
        }
    }

    private anyPlayerHasLegalPlacement(): boolean {
        return this.hasLegalPlacement(1) || this.hasLegalPlacement(2);
    }

    /** After applying placement and claim, would neither seat have a legal placement? */
    private claimWouldEndConstruction(pc: Piece, to: string, claim: string): boolean {
        const snap = this.moveState();
        const seat = snap.currplayer;
        const idx = snap.stashes[seat - 1].findIndex((p) => p === pc);
        if (idx !== -1) {
            snap.stashes[seat - 1].splice(idx, 1);
        }
        snap.board.set(to, pc);
        snap.claimed[seat - 1].push(claim);
        snap.currplayer = seat === 1 ? 2 : 1;
        const g = new ACityGame({
            game: ACityGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: false,
            winner: [],
            stack: [snap],
            startpos: cloneState(this.startpos) as [Color, MarkerPos][],
        });
        return ! g.anyPlayerHasLegalPlacement();
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        const saved = this.currplayer;
        this.currplayer = player;
        try {
            const stash = new Set<string>(this.stashes[player - 1]);
            const empties = (this.graph.listCells() as string[]).filter(c => ! this.board.has(c));
            for (const piece of stash) {
                for (const cell of empties) {
                    const move = `${piece}-${cell}`
                    const result = this.validateMove(move);
                    if ( (result.valid) && (result.complete !== undefined) && (result.complete >= 0) ) {
                        moves.push(move);
                    }
                }
            }

            if (this.claimed[player - 1].length < 3) {
                const unclaimed = [...this.board.entries()].filter(node => ( (node[1].endsWith("T")) && (! this.claimed[0].includes(node[0])) && (! this.claimed[1].includes(node[0])) )).map(node => node[0]);
                const caps: string[] = [];
                for (const move of moves)  {
                    for (const cell of unclaimed) {
                        const capped = `${move}(${cell})`;
                        const capResult = this.validateMove(capped);
                        if (capResult.valid && capResult.complete !== undefined && capResult.complete >= 0) {
                            caps.push(capped);
                        }
                    }
                }
                moves.push(...caps);
            }
        } finally {
            this.currplayer = saved;
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    public getButtons(): ICustomButton[] {
        if (this.randomMove() === "pass") {
            return [{ label: "apgames:buttons.pass", move: "pass" }];
        }
        return [];
    }

    // used to determine whether to show the "pass" button
    // never makes a claim
    public randomMove(): string {
        const stash = shuffle([...new Set<string>(this.stashes[this.currplayer - 1])]) as string[];
        const empties = shuffle((this.graph.listCells() as string[]).filter((c) => ! this.board.has(c))) as string[];
        for (const piece of stash) {
            for (const cell of empties) {
                const move = `${piece}-${cell}`
                const result = this.validateMove(move);
                if ( (result.valid) && (result.complete !== undefined) && (result.complete >= 0) ) {
                    return move;
                }
            }
        }
        return "pass";
    }

    public cell2guild(cell: string): [Color, boolean] {
        const [x, y] = this.graph.algebraic2coords(cell);
        const tileX = Math.floor(x / 2);
        const tileY = Math.floor(y / 2);
        const idx = (tileY * 4) + tileX;
        const tile = this.startpos[idx];
        const guild = tile[0];
        let markerX = tileX * 2;
        let markerY = tileY * 2;
        switch (tile[1]) {
            case 1:
                markerX++;
                break;
            case 2:
                markerY++;
                break;
            case 3:
                markerX++;
                markerY++;
                break;
        }
        const isMarker = ( (markerX === x) && (markerY === y) );
        return [guild, isMarker];
    }

    public cell2tile(cell: string): ITile {
        const [x, y] = this.graph.algebraic2coords(cell);
        const tileX = Math.floor(x / 2);
        const tileY = Math.floor(y / 2);
        const idx = (tileY * 4) + tileX;
        const tile = this.startpos[idx];
        const guild = tile[0];
        let markerX = tileX * 2;
        let markerY = tileY * 2;
        switch (tile[1]) {
            case 1:
                markerX++;
                break;
            case 2:
                markerY++;
                break;
            case 3:
                markerX++;
                markerY++;
                break;
        }
        const result: ITile = {
            guild,
            cells: [],
            marker: this.graph.coords2algebraic(markerX, markerY),
        };
        for (let dx = 0; dx <= 1; dx++) {
            for (let dy = 0; dy <= 1; dy++) {
                result.cells.push(this.graph.coords2algebraic((tileX * 2) + dx, (tileY * 2) + dy));
            }
        }
        return result;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if ( (col < 0) && (row < 0) && (piece !== undefined) ) {
                newmove = piece;
            } else {
                const cell = this.graph.coords2algebraic(col, row);
                if (move === "") {
                    // The only valid first option is clicking on a piece in your stash
                    // So clicking anywhere on the board before then resets the move
                    return {move: "", message: ""} as IClickResult;
                } else {
                    // if the clicked space is empty, assume placement
                    if ( (! this.board.has(cell)) && (! move.endsWith(cell)) ) {
                        newmove = move.substring(0, 2) + "-" + cell;
                    // otherwise assume claiming
                    } else {
                        newmove = move + `(${cell})`;
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                // Don't wipe out the selected piece by default
                result.move = move.substring(0, 2);
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

        // normalize caps
        if (m.toLowerCase() !== "pass") {
            m = m.substring(0, 2).toUpperCase() + m.substring(2).toLowerCase();
        } else {
            m = m.toLowerCase();
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.acity.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (! this.hasLegalPlacement(this.currplayer)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_PASS");
                return result;
            }
        }

        const reMove = /^([RGBN][DT])(-([a-h]\d+))?(\(([a-h]\d+)\))?$/;
        if (reMove.test(m)) {
            const [,pc,,to,,claim] = m.match(reMove)!; // can't be null because we tested
            // `pc` is guaranteed to be defined and at least well formed
            // you have such a piece in your stash
            if (! this.stashes[this.currplayer - 1].includes(pc as Piece)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.acity.INVALID_PIECE", {piece: ACityGame.piece2string(pc as Piece)});
                return result;
            }

            if ( (to !== undefined) && (to !== null) && (to.length > 0) ) {
                // cell is empty
                if (this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                    return result;
                }
                const placement = this.canPlace(pc as Piece, to);
                // placing here may not break the road
                if (placement === "ROAD") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.acity.BROKEN_ROAD", {where: to});
                    return result;
                }
                // placing here may not cut a piece off from the road
                if (placement === "ISOLATED") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.acity.ISOLATED", {where: to});
                    return result;
                }
                // domes on own colours unless all lots of that colour break the road
                if (placement === "DOMES") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.acity.BAD_DOME");
                    return result;
                }
                // The first two structures built on a tile must be the same color as the tile, except for towers on black tiles
                if (placement === "TOWERS") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.acity.BAD_TOWER");
                    return result;
                }
                // can't build on marker until all other possible lots occupied (SDG did exhaustive search of all possible piece placements on the tile)
                if (placement === "MARKER") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.acity.MARKER");
                    return result;
                }

                // validate claim, if present
                if ( (claim !== undefined) && (claim !== null) && (claim.length > 0) ) {
                    // must have claims remaining
                    if (this.claimed[this.currplayer - 1].length >= 3) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.acity.NO_MORE_CLAIMS");
                        return result;
                    }
                    // check if claim is the same tower that was just placed
                    if (claim === to) {
                        // Just make sure that the piece they placed is a tower
                        if (! pc.endsWith("T")) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.acity.CLAIM_TOWERS");
                            return result;
                        }
                    } else {
                        // cell is occupied
                        if (! this.board.has(claim)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: claim});
                            return result;
                        }
                        // cell is a tower
                        if (! this.board.get(claim)!.endsWith("T")) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.acity.CLAIM_TOWERS");
                            return result;
                        }
                        // cell is not already claimed
                        if ( (this.claimed[0].includes(claim)) || (this.claimed[1].includes(claim)) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.acity.DOUBLE_CLAIM", {where: claim});
                            return result;
                        }
                    }

                    if (this.claimWouldEndConstruction(pc as Piece, to, claim)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.acity.CLAIM_ENDS_GAME");
                        return result;
                    }

                    // We're good
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    let unclaimedT = [...this.board.entries()].filter(e => e[1].endsWith("T") && ! this.claimed[0].includes(e[0]) && ! this.claimed[1].includes(e[0])).length;
                    // add tower about to be placed
                    if (pc.endsWith("T")) { unclaimedT++; }
                    if ( (this.claimed[this.currplayer - 1].length < 3) && (unclaimedT > 0) ) {
                        result.valid = true;
                        result.complete = 0;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.acity.VALID_W_CLAIMS");
                        return result;
                    } else {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }
                }
            } else {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.acity.PARTIAL_MOVE");
                return result;
            }
        } else {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }
    }

    public isConnected(): boolean {
        return isRoadNetworkConnected(this.board);
    }

    // Lots that are illegal for any piece because building there would break
    // the road or strand a structure. Uses the same check as canPlace() so the
    // display can never disagree with the rules.
    private structurallyIllegalCells(): Set<string> {
        const illegal = new Set<string>();
        const empties = (this.graph.listCells() as string[]).filter((c) => ! this.board.has(c));
        for (const cell of empties) {
            const { roadOk, isolated } = roadNetworkAfterPlacement(this.board, "ND", cell);
            if (! roadOk || isolated) {
                illegal.add(cell);
            }
        }
        return illegal;
    }

    /**
     * Refactor/golden harness only — mirrors private {@link canPlace}.
     */
    public goldenPlacementResult(piece: ACityPiece, cell: string): ACityPlacementResult {
        return this.canPlace(piece, cell);
    }

    /** Refactor/golden harness only — mirrors private {@link getRealDistance}. */
    public goldenRealDistance(from: string, to: string): number {
        return this.getRealDistance(from, to);
    }

    private canPlace(piece: Piece, cell: string): PlacementResult {
        const { roadOk, isolated } = roadNetworkAfterPlacement(this.board, piece, cell);
        if (! roadOk) {
            return "ROAD";
        }
        if (isolated) {
            return "ISOLATED";
        }

        const pcColor = piece[0] as Color;
        const [cellColor] = this.cell2guild(cell);
        if (piece.endsWith("D")) {
            if (pcColor !== cellColor) {
                const trialBoard = new Map(this.board);
                trialBoard.set(cell, piece);
                const cells = this.getEmptyGuild(pcColor, trialBoard);
                let broken = true;
                for (const c of cells) {
                    const alt = roadNetworkAfterPlacement(this.board, piece, c);
                    if (alt.roadOk && ! alt.isolated) {
                        broken = false;
                        break;
                    }
                }
                if (! broken) {
                    return "DOMES";
                }
            }
        }

        if ( (cellColor !== "N") && (piece.endsWith("T")) && (pcColor !== cellColor) ) {
            const built = this.cell2tile(cell).cells.filter((c) => this.board.has(c)).length;
            if (built < 2) {
                return "TOWERS";
            }
        }

        const tile = this.cell2tile(cell);
        if (tile.marker === cell) {
            const empties = tile.cells.filter((c) => c !== cell && ! this.board.has(c));
            const allPieces = new Set<string>(...this.stashes[0], ...this.stashes[1]);
            let otherOptions = false;
            for (const other of empties) {
                for (const pc of allPieces) {
                    if (this.canPlace(pc as Piece, other) === "GOOD") {
                        otherOptions = true;
                        break;
                    }
                }
                if (otherOptions) { break; }
            }
            if (otherOptions) {
                return "MARKER";
            }
        }

        return "GOOD";
    }

    private getEmptyGuild(color: Color, board: Map<string, Piece> = this.board): string[] {
        const empties = (this.graph.listCells() as string[]).filter((cell) => ! board.has(cell));
        const cells: string[] = [];
        for (const cell of empties) {
            const [c,] = this.cell2guild(cell);
            if (c === color) {
                cells.push(cell);
            }
        }
        return cells;
    }

    public move(m: string, {partial = false, trusted = false} = {}): ACityGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        // normalize caps
        if (m.toLowerCase() !== "pass") {
            m = m.substring(0, 2).toUpperCase() + m.substring(2).toLowerCase();
        } else {
            m = m.toLowerCase();
        }
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const reMove = /^([RGBN][DT])(-([a-h]\d+))(\(([a-h]\d+)\))?$/;
            if (reMove.test(m)) {
                const [,piece,,to,,claim] = m.match(reMove)!;
                // remove piece from stash
                const idx = this.stashes[this.currplayer - 1].findIndex(p => p === piece as Piece);
                if (idx !== -1) {
                    this.stashes[this.currplayer - 1].splice(idx, 1);
                } else {
                    throw new Error("Could not find the piece in the player's stash.");
                }
                // place on board
                if (this.board.has(to)) {
                    throw new Error(`The lot ${to} is already occupied!`);
                }
                this.board.set(to, piece as Piece);
                this.results.push({type: "place", where: to, what: ACityGame.piece2string(piece as Piece)});
                // claim if given
                if ( (claim !== undefined) && (claim !== null) && (claim.length > 0) ) {
                    this.claimed[this.currplayer - 1].push(claim);
                    this.results.push({type: "claim", where: claim});
                }
            } else {
                throw new Error("Move not well formed.");
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

    protected checkEOG(): ACityGame {
        // If two passes in a row, we need to end
        let passedout = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedout = true;
        }
        // if both stashes are empty, we're also definitely done
        const stashCount = this.stashes.reduce((prev, curr) => {return prev + curr.length}, 0);

        if ( (passedout) || (stashCount === 0) ) {
            // nullify last-move claim
            let realLast = this.lastmove;
            if ( (realLast !== undefined) && (realLast === "pass") ) {
                for (let i = this.stack.length - 1; i >= 0; i--) {
                    if ( (this.stack[i].lastmove !== undefined) && (this.stack[i].lastmove !== "pass") ) {
                        realLast = this.stack[i].lastmove!;
                        break;
                    }
                }
            }
            if (/\([a-h]\d+\)$/.test(realLast!)) {
                const [,claim] = realLast!.match(/\(([a-h]\d+)\)$/)!;
                this.claimed[0] = this.claimed[0].filter(c => c !== claim);
                this.claimed[1] = this.claimed[1].filter(c => c !== claim);
                this.results.push({type: "nullifyClaim", where: claim});
            }
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IACityState {
        return {
            game: ACityGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            startpos: cloneState(this.startpos) as [Color,MarkerPos][],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ACityGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            stashes: cloneState(this.stashes) as [Piece[],Piece[]],
            claimed: cloneState(this.claimed) as [string[],string[]],
        };
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return {
                func: "custom",
                default: "#fff",
                palette: 5
            };
        } else {
            return {
                func: "custom",
                default: "#000",
                palette: 6
            };
        }
    }

    public render(opts: IRenderOpts = {}): APRenderRep {
        // Build piece string
        let pieceRep: string[][][] | null = [];
        const cells = this.graph.listCells(true) as string[][];
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const node: string[] = []
                    const contents = this.board.get(cell)!;
                    node.push(contents);
                    if (this.claimed[0].includes(cell)) {
                        node.push("Claim1");
                    } else if (this.claimed[1].includes(cell)) {
                        node.push("Claim2");
                    }
                    pieces.push(node);
                } else {
                    pieces.push([]);
                }
            }
            pieceRep.push(pieces);
        }
        if (pieceRep.length === 0) {
            pieceRep = null;
        }

        // Build rep
        const markers: (MarkerShading|MarkerGlyph|MarkerLine|MarkerDots)[] = [];
        // very lightly shade in tiles
        for (let i = 0; i < this.startpos.length; i++) {
            const tile = this.startpos[i];
            const tlx = (i % 4) * 2;
            const tly = Math.floor(i / 4) * 2;
            let colour: string|number|Colourfuncs;
            let suit: string;
            switch (tile[0]) {
                case "R":
                    colour = 1;
                    suit = "MarkRed";
                    break;
                case "B":
                    colour = 2;
                    suit = "MarkBlue";
                    break;
                case "G":
                    colour = 3;
                    suit = "MarkGreen";
                    break;
                case "N":
                    colour = {
                        func: "custom",
                        default: "#000000",
                        palette: 4
                    };
                    suit = "MarkBlack";
                    break;
            }
            markers.push({
                type: "shading",
                colour,
                // opacity: 0.1,
                points: [
                    // tl
                    {col: tlx, row: tly},
                    // tr
                    {col: tlx + 2, row: tly},
                    // br
                    {col: tlx + 2, row: tly + 2},
                    // bl
                    {col: tlx, row: tly + 2},
                ],
            });
            // add suit marker
            const tileObj = this.cell2tile(this.graph.coords2algebraic(tlx, tly));
            const [mx, my] = this.graph.algebraic2coords(tileObj.marker);
            markers.push({
                type: "glyph",
                glyph: suit,
                points: [{col: mx, row: my}]
            });
        }

        if (opts.altDisplay === "roads") {
            const illegal = this.structurallyIllegalCells();

            for (const cell of illegal) {
                const [x, y] = this.graph.algebraic2coords(cell);
                for (const n of this.graph.neighbours(cell)) {
                    if (! illegal.has(n)) { continue; }
                    const [nx, ny] = this.graph.algebraic2coords(n);
                    // only look right/down so each edge is drawn once
                    if ( (nx < x) || ( (nx === x) && (ny < y) ) ) { continue; }
                    markers.push({
                        type: "line",
                        points: [{col: x, row: y}, {col: nx, row: ny}],
                        colour: "_context_strokes",
                        centered: true,
                        // 1:3 dash-to-gap like US broken lane lines (10 ft
                        // paint, 30 ft gap). Each segment starts and ends on a
                        // half-dash (the zero gap joins adjacent halves), so
                        // every cell centre gets a full dash however the
                        // segments meeting there are oriented.
                        style: "dashed",
                        dasharray: [1.25, 7.5, 1.25, 0],
                        width: 2,
                    });
                }
            }

            // dots only at chain ends, not at mid-chain cells or intersections
            const terminalPoints: RowCol[] = [...illegal]
                .filter((cell) => this.graph.neighbours(cell).filter((n) => illegal.has(n)).length <= 1)
                .map((cell) => {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    return {col: x, row: y};
                });
            if (terminalPoints.length > 0) {
                markers.push({
                    type: "dots",
                    points: terminalPoints as [RowCol, ...RowCol[]],
                    colour: "_context_strokes",
                    size: 0.15,
                });
            }
        }

        const board: BoardBasic = {
            style: "squares",
            width: 8,
            height: 10,
            tileWidth: 2,
            tileHeight: 2,
            markers,
        }
        const rep: APRenderRep =  {
            board,
            legend: {
                RD: {
                    name: "piece",
                    colour: 1
                },
                BD: {
                    name: "piece",
                    colour: 2
                },
                GD: {
                    name: "piece",
                    colour: 3
                },
                ND: {
                    name: "piece",
                    colour: {
                        func: "custom",
                        default: "#000000",
                        palette: 4
                    }
                },
                RT: {
                    name: "pyramid-up-large-upscaled",
                    colour: 1
                },
                BT: {
                    name: "pyramid-up-large-upscaled",
                    colour: 2
                },
                GT: {
                    name: "pyramid-up-large-upscaled",
                    colour: 3
                },
                Claim1: {
                    name: "pyramid-up-small",
                    colour: this.getPlayerColour(1)
                },
                Claim2: {
                    name: "pyramid-up-small",
                    colour: this.getPlayerColour(2)
                },
                MarkRed: {
                    name: "piecepack-suit-suns",
                    colour: 1,
                    scale: 0.5,
                    opacity: 0.15,
                },
                MarkBlue: {
                    name: "piecepack-suit-anchors",
                    colour: 2,
                    scale: 0.5,
                    opacity: 0.15,
                },
                MarkGreen: {
                    name: "piecepack-suit-crowns",
                    paint: {
                        "fill": { colour: 3, opacity: 0.15 },
                        "border": { opacity: 0.15 }
                    },
                    scale: 0.5,
                },
                MarkBlack: {
                    name: "piecepack-suit-moons",
                    colour: {
                        func: "custom",
                        default: "#000000",
                        palette: 4
                    },
                    scale: 0.5,
                    opacity: 0.15,
                },
            },
            pieces: pieceRep as [string[][], ...string[][][]],
            areas: []
        };

        // add stashes to board
        for (const n of [0, 1]) {
            if (this.stashes[n].length > 0) {
                rep.areas!.push({
                    type: "pieces",
                    label: this.seatAreaLabel(n + 1, "apgames:validation.acity.LABEL_STASH"),
                    ownerMark: n === 0 ? this.getPlayerColour(1) : this.getPlayerColour(2),
                    pieces: [...this.stashes[n]],
                    veiled: this.stashAreaVeiled(n + 1, opts),
                } as AreaPieces);
            }
        }

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "claim") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: this.neutralAreaLabel("apgames:status.CLAIMS_REMAINING"), scores: [3 - this.claimed[0].length, 3 - this.claimed[1].length] },
        ]
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const entry: IStashEntry[] = [];
        const stash = this.stashes[player - 1];
        const pieces = new Set<Piece>(stash);
        for (const pc of [...pieces].sort((a,b) => a.localeCompare(b))) {
            let glyph: Glyph;
            switch (pc) {
                case "BD":
                    glyph = {name: "piece", colour: 2};
                    break;
                case "BT":
                    glyph = {name: "pyramid-up-large-upscaled", colour: 2};
                    break;
                case "GD":
                    glyph = {name: "piece", colour: 3};
                    break;
                case "GT":
                    glyph = {name: "pyramid-up-large-upscaled", colour: 3};
                    break;
                case "ND":
                    glyph = {name: "piece", colour: "#000000"};
                    break;
                case "RD":
                    glyph = {name: "piece", colour: 1};
                    break;
                case "RT":
                    glyph = {name: "pyramid-up-large-upscaled", colour: 1};
                    break;
            }
            entry.push({
                glyph,
                movePart: pc,
                count: stash.filter(p => p === pc).length,
            });
        }
        return entry;
    }

    private boardDistCacheSig(): string {
        return [...this.board.entries()].map(([k, v]) => `${k}:${v}`).sort().join("|");
    }

    private ensureDistanceCache(): void {
        const sig = this.boardDistCacheSig();
        if (sig === this.distCacheSig) {
            return;
        }
        this.distCache.clear();
        this.distCacheSig = sig;
        const keys = [...this.board.keys()];
        for (const from of keys) {
            for (const to of keys) {
                if (from === to) {
                    continue;
                }
                this.distCache.set(`${from}|${to}`, realDistanceOnBoard(this.board, from, to));
            }
        }
    }

    private getRealDistance(from: string, to: string): number {
        this.ensureDistanceCache();
        const key = `${from}|${to}`;
        let dist = this.distCache.get(key);
        if (dist === undefined) {
            dist = realDistanceOnBoard(this.board, from, to);
            this.distCache.set(key, dist);
        }
        return dist;
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        if (this.claimed[player - 1].length > 0) {
            for (const claim of this.claimed[player - 1]) {
                const claimed = this.board.get(claim)!;
                let customerBase = 0;
                for (const [n, pc] of this.board.entries()) {
                    if (n === claim) { continue; }
                    if (claimed[0] === pc[0]) { continue; }
                    if (this.getRealDistance(claim, n) > 2) {
                        continue;
                    }
                    customerBase++;
                }
                let distance = Infinity;
                for (const [n, pc] of this.board.entries()) {
                    if (n === claim) { continue; }
                    if (claimed !== pc) { continue; }
                    distance = Math.min(distance, this.getRealDistance(claim, n));
                }
                if (distance !== Infinity) {
                    score += customerBase * distance;
                }
            }
        }
        // now bonuses
        const allGT = [...this.board.entries()].filter(e => e[1] === "GT").map(e => e[0]);
        const unclaimedGT = allGT.filter(cell => (! this.claimed[0].includes(cell)) && (! this.claimed[1].includes(cell)) );
        for (const gt of unclaimedGT) {
            let closestRedDist = Infinity;
            let closestRedCell: string|undefined;
            let closestBlueDist = Infinity;
            let closestBlueCell: string|undefined;
            for (const [n, pc] of this.board.entries()) {
                if (n === gt) { continue; }
                if (pc === "RT") {
                    const dist = this.getRealDistance(gt, n);
                    if (dist === closestRedDist) {
                        closestRedCell = undefined;
                    } else if (dist < closestRedDist) {
                        closestRedDist = dist;
                        closestRedCell = n;
                    }
                } else if (pc === "BT") {
                    const dist = this.getRealDistance(gt, n);
                    if (dist === closestBlueDist) {
                        closestBlueCell = undefined;
                    } else if (dist < closestBlueDist) {
                        closestBlueDist = dist;
                        closestBlueCell = n;
                    }
                }
            }
            if ( (closestRedCell !== undefined) && (this.claimed[player - 1].includes(closestRedCell)) ) {
                const bonus = 10 - (closestRedDist * 2);
                if (bonus > 0) {
                    score += bonus;
                }
            }
            if ( (closestBlueCell !== undefined) && (this.claimed[player - 1].includes(closestBlueCell)) ) {
                const bonus = 10 - (closestBlueDist * 2);
                if (bonus > 0) {
                    score += bonus;
                }
            }
        }

        return score;
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PLACE.complete", {where: r.where!, what: r.what!});
                return true;
            case "claim":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.CLAIM.default", {where: r.where!});
                return true;
            case "nullifyClaim":
                this.pushNeutralChatLine(lines, "apresults:_general.NULLIFY_CLAIM.default", {where: r.where!});
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public getStartingPosition(): string {
        return this.startpos.map(t => t.join("")).join(",");
    }

    public clone(): ACityGame {
        return new ACityGame(this.serialize());
    }
}

