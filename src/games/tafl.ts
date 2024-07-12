import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid, Directions } from "../common";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { TaflSettings } from "./tafl/settings";

type playerid = 1 | 2;

// taflmen, king, commander, knight
type pieceid = "T" | "K" | "C" | "N";
const allPieces: pieceid[] = ["T", "K", "C", "N"];
const orthDirections: Directions[] = ["N", "E", "S", "W"];

type CellContents = [playerid, pieceid];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface ITaflState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface IPiece {
      strength?: "strong-near-throne" | "strong" | "weak";
      power?: "armed" | "anvil-only" | "hammer-only" | "unarmed" | "piercing";
      jump?:
        | "no-jump"
        | "jump-taflmen"
        | "jump-enemy-taflmen"
        | "jump-capture-enemy-taflmen"
        | "jump-enemy-taflmen-to-from-restricted";
      movement?: "rook" | "rook-1";
      berserkEscape?: boolean;
}

const defaultVariant = "linnaean-9x9-tcross-w";

export class TaflGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Hnefatafl",
        uid: "tafl",
        playercounts: [2],
        version: "20240505",
        dateAdded: "2024-02-24",
        // i18next.t("apgames:descriptions.tafl")
        description: "apgames:descriptions.tafl",
        // i18next.t("apgames:notes.tafl")
        notes: "apgames:notes.tafl",
        urls: [
            "https://abstractplay.com/wiki/doku.php?id=hnefatafl",
            "http://aagenielsen.dk/tafl_rules.php",
        ],
        people: [],
        variants: [
            // default: "linnaean-9x9-tcross-w"
            { uid: "linnaean-11x11-belldiamond-w", group: "variant" },
            { uid: "linnaean-11x11-lewiscross-w", group: "variant" },
            { uid: "copenhagen-11x11-tdiamond", group: "variant" },
            { uid: "berserk-11x11-tdiamondberserk", group: "variant" },
            { uid: "total-11x11-tdiamond", group: "variant" },
            { uid: "tyr-11x11-tyr", group: "variant" },
            { uid: "tyr-15x15-tyr", group: "variant" },
            { uid: "seabattle-9x9-starsquare-w", group: "variant" },
            { uid: "seabattle-11x11-tcross-w", group: "variant" },
            { uid: "magpie-7x7-cross", group: "variant" },
        ],
        categories: ["goal>royal-escape", "goal>royal-capture", "mechanic>asymmetry", "mechanic>capture", "mechanic>differentiate",  "mechanic>move", "mechanic>traditional", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["multistep", "custom-colours", "check", "limited-pieces"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.settings.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.settings.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private grid!: RectGrid;
    private dots: string[] = [];
    private settings;
    private pieceMap: Map<pieceid, IPiece>;
    private throne;
    private nearThrone;
    private corners;
    private restrictedToCells: Map<pieceid, string[]>;
    private illegalCells: Map<pieceid, string[]>;
    private playerAttacker: playerid;
    private playerDefender: playerid;

    constructor(state?: ITaflState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const variant = this.variants.length > 0 && this.variants[0] !== "" ? this.variants[0] : defaultVariant;
            this.settings = new TaflSettings(variant);
            const fresh: IMoveState = {
                _version: TaflGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.setupBoard(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITaflState;
            }
            if (state.game !== TaflGame.gameinfo.uid) {
                throw new Error(`The Hnefatafl game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            const variant = this.variants.length > 0 && this.variants[0] !== "" ? this.variants[0] : defaultVariant;
            this.settings = new TaflSettings(variant);
        }
        this.load();
        this.grid = new RectGrid(this.settings.boardSize, this.settings.boardSize);
        this.pieceMap = new Map([
            ["T", this.settings.ruleset.pieces!.taflman!],
            ["K", this.settings.ruleset.pieces!.king!],
            ["C", this.settings.ruleset.pieces!.commander!],
            ["N", this.settings.ruleset.pieces!.knight!],
        ]);
        this.playerAttacker = this.settings.firstPlayer;
        this.playerDefender = this.playerAttacker === 1 ? 2 : 1;
        this.throne = this.getThrone();
        this.nearThrone = this.getNearThrone();
        this.corners = this.getCorners();
        this.restrictedToCells = this.getRestrictedToCells();
        this.illegalCells = this.getIllegalCells();
    }

    public load(idx = -1): TaflGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    private setupBoard(): Map<string, CellContents> {
        // Get the board setup for a new game.
        const board = new Map<string, CellContents>();
        const playerAttacker = this.settings.firstPlayer;
        const playerDefender = playerAttacker === 1 ? 2 : 1;
        for (let row = 0; row < this.settings.boardSize; row++) {
            for (let col = 0; col < this.settings.boardSize; col++) {
                const contents = this.settings.setupStrings[row][col];
                const cell = this.coords2algebraic(col, row);
                switch (contents) {
                    case "t":
                        board.set(cell, [playerAttacker, "T"]);
                        break;
                    case "k":
                        board.set(cell, [playerAttacker, "K"]);
                        break;
                    case "c":
                        board.set(cell, [playerAttacker, "C"]);
                        break;
                    case "n":
                        board.set(cell, [playerAttacker, "N"]);
                        break;
                    case "T":
                        board.set(cell, [playerDefender, "T"]);
                        break;
                    case "K":
                        board.set(cell, [playerDefender, "K"]);
                        break;
                    case "C":
                        board.set(cell, [playerDefender, "C"]);
                        break;
                    case "N":
                        board.set(cell, [playerDefender, "N"]);
                        break;
                }
            }
        }
        return board;
    }

    private getThrone(): string | undefined {
        // Get location of the throne. If there is no throne, return undefined.
        const throneType = this.settings.ruleset.throne!.type;
        switch (throneType) {
            case "centre":
                const centre = Math.floor(this.settings.boardSize / 2);
                return this.coords2algebraic(centre, centre);
            case "no-throne":
                return undefined;
            default:
                throw new Error(`Invalid throne type: ${throneType}.`);
        }
    }

    private getNearThrone(): string[] {
        // Get the spaces that are considered "near" the throne.
        // This is the throne and the spaces orthogonally adjacent to it.
        if (this.throne === undefined) {
            return [];
        }
        const [x, y] = this.algebraic2coords(this.throne);
        const nearThrone: string[] = [this.throne];
        for (const dir of orthDirections) {
            nearThrone.push(this.coords2algebraic(...RectGrid.move(x, y, dir)));
        }
        return nearThrone;
    }

    private getCorners(): string[] {
        // Get the corner cells. If there are no corners, return an empty array.
        const cornerType = this.settings.ruleset.corner!.type;
        switch (cornerType) {
            case "no-corner":
                return [];
            case "corner":
                return [
                    this.coords2algebraic(0, 0),
                    this.coords2algebraic(this.settings.boardSize - 1, 0),
                    this.coords2algebraic(0, this.settings.boardSize - 1),
                    this.coords2algebraic(this.settings.boardSize - 1, this.settings.boardSize - 1),
                ];
            default:
                throw new Error(`Invalid corner type: ${cornerType}.`);
        }
    }

    private getRestrictedToCells(): Map<pieceid, string[]> {
        // Get cells that are restricted only to certain pieces.
        // This is used in the berserk variant when the king can only jump to and from
        // restricted spaces.
        const map = new Map<pieceid, string[]>();
        for (const piece of allPieces) {
            map.set(piece, []);
        }
        if (this.settings.ruleset.throne!.type! !== "no-throne") {
            const throneRestrictedTo = this.settings.ruleset.throne!.emptyRestrictedTo;
            if (throneRestrictedTo === "all") {
                for (const piece of allPieces) {
                    map.get(piece)!.push(this.throne!);
                }
            }
            if (throneRestrictedTo === "king-only") {
                map.get("K")!.push(this.throne!);
            }
        }
        if (this.settings.ruleset.corner!.type! !== "no-corner") {
            const cornerRestrictedTo = this.settings.ruleset.corner!.restrictedTo;
            if (cornerRestrictedTo === "all") {
                for (const piece of allPieces) {
                    map.get(piece)!.push(...this.corners);
                }
            }
            if (cornerRestrictedTo === "king-only") {
                map.get("K")!.push(...this.corners);
            }
        }
        return map;
    }

    private getIllegalCells(): Map<pieceid, string[]> {
        // Get cells that are illegal for certain pieces to enter.
        const map = new Map<pieceid, string[]>();
        for (const piece of allPieces) {
            map.set(piece, []);
        }
        if (this.settings.ruleset.throne!.type! !== "no-throne") {
            const throneRestrictedTo = this.settings.ruleset.throne!.emptyRestrictedTo;
            if (throneRestrictedTo === "none") {
                for (const piece of allPieces) {
                    map.get(piece)!.push(this.throne!);
                }
            }
            if (throneRestrictedTo === "king-only") {
                for (const piece of allPieces) {
                    if (piece === "K") { continue; }
                    map.get(piece)!.push(this.throne!);
                }
            }
        }
        if (this.settings.ruleset.corner!.type! !== "no-corner") {
            const cornerRestrictedTo = this.settings.ruleset.corner!.restrictedTo;
            if (cornerRestrictedTo === "none") {
                for (const piece of allPieces) {
                    map.get(piece)!.push(...this.corners);
                }
            }
            if (cornerRestrictedTo === "king-only") {
                for (const piece of allPieces) {
                    if (piece === "K") { continue; }
                    map.get(piece)!.push(...this.corners);
                }
            }
        }
        return map;
    }

    public moves(player?: 1|2): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        // Get all cells containing pieces of the current player
        const playerPieces = Array.from(this.board.entries()).filter(([, [p,]]) => p === player).map(([c,]) => c);
        for (const from of playerPieces) {
            for (const move of this.getAllMoves(from)) {
                moves.push(move);
            }
        }
        return moves;
    }

    private createMove(from: string, to: string, captured: string[] = [], initialFrom?: string, tosJump?: string[]): string {
        // Create the move notation given a from and to.
        if (tosJump === undefined) {
            tosJump = this.getTosJump(from, "all", captured, initialFrom);
        }
        const connector = tosJump.includes(to) ? "^" : "-";
        from = this.addPrefix(from, initialFrom);
        const captures = this.getCaptures(from, to, captured, initialFrom);
        if (captures.length > 0) {
            return from + connector + to + "x" + captures.map((c) => this.addPrefix(c)).sort((a, b) => this.sort(a, b)).join("x");;
        }
        return from + connector + to;
    }

    private normaliseMove(move: string): string {
        // Rebuild the move notation to ensure it is in the correct format.
        const moves = move.split(" ");
        const createdMoves: string[] = [];
        const initialFrom = this.stripPrefix(moves[0].split(/[-\^]/)[0]);
        const captures: string[] = [];
        for (const m of moves) {
            const [from, to ] = m.split(/[-\^x]/);
            const strippedFrom = this.stripPrefix(from);
            if (to === undefined) {
                createdMoves.push(this.addPrefix(strippedFrom, initialFrom));
            } else {
                createdMoves.push(this.createMove(strippedFrom, this.stripPrefix(to), captures, initialFrom));
            }
            captures.push(...this.extractCaptures(createdMoves[createdMoves.length - 1]));
        }
        return createdMoves.join(" ");
    }

    private hasMoves(player?: playerid): boolean {
        // Short-circuited version of `moves` to check end condition.
        if (player === undefined) {
            player = this.currplayer;
        }
        const playerPieces = Array.from(this.board.entries()).filter(([, [p,]]) => p === player).map(([c,]) => c);
        for (const cell of playerPieces) {
            if (this.getTos(cell).length > 0) { return true; }
        }
        return false;
    }

    private getTos(from: string, captured: string[] = [], initialFrom?: string, which: "all" | "berserk" = "all"): string[] {
        // Get all possible moves from a cell at `from`.
        const tos: string[] = [];
        from = this.stripPrefix(from);
        if (initialFrom === undefined) { initialFrom = from; }
        if (which === "all") {
            tos.push(...this.getTosNormal(from, captured, initialFrom));
            tos.push(...this.getTosJump(from, "all", captured, initialFrom));
            return tos;
        }
        // If this is for berserk moves, we only return moves that result in captures.
        const tosNormal = this.getTosNormal(from, captured, initialFrom);
        const tosJumpNoCapture = this.getTosJump(from, "no-capture", captured, initialFrom);
        const tosNoJumpCapture = [...tosNormal, ...tosJumpNoCapture];
        const tosJumpCapture = this.getTosJump(from, "capture", captured, initialFrom);
        tos.push(...tosJumpCapture);
        for (const to of tosNoJumpCapture) {
            if (tosJumpCapture.includes(to)) { continue }
            if (this.hasCaptures(from, to, captured, initialFrom)) {
                tos.push(to);
            }
        }
        const [, pcF] = this.board.get(initialFrom)!;
        // If the king has the berserk escape power, we also add the escape moves.
        if (pcF === "K") {
            if (this.pieceMap.get("K")!.berserkEscape) {
                const allTos: string[] = [...tosNoJumpCapture, ...tosJumpCapture];
                for (const to of allTos) {
                    if (this.settings.ruleset.escapeType === "corner" && !this.corners.includes(to)) { continue; }
                    if (this.settings.ruleset.escapeType === "edge" && !this.isOnEdge(to)) { continue; }
                    if (tos.includes(to)) { continue; }
                    tos.push(to);
                }
            }
        }
        return tos;
    }

    private getAllMoves(from: string, pastMoves = "", captured: string[] = [], initialFrom?: string): string[] {
        // Get all possible moves from a cell at `from`.
        if (initialFrom === undefined) { initialFrom = from; }
        const tosJump = this.getTosJump(from, "all", captured, initialFrom);
        const moves: string[] = [];
        if (pastMoves.length === 0) {
            for (const to of this.getTos(from, captured, initialFrom, "all")) {
                moves.push(this.createMove(from, to, captured, initialFrom, tosJump));
            }
        }
        if (!this.settings.ruleset.berserkCapture) {
            return moves;
        }
        // If berserk capture is enabled, we also need to check for berserk moves.
        const [, pcF] = this.board.get(initialFrom)!;
        for (const to of this.getTos(from, captured, initialFrom, "berserk")) {
            const newCaptured = this.getCaptures(from, to, captured, initialFrom);
            const thisMove = this.createMove(from, to, captured, initialFrom, tosJump);
            const newMove = pastMoves === "" ? thisMove : pastMoves + " " + thisMove;
            moves.push(newMove);
            // If the king manages to escape, we do not continue recursing.
            if (
                pcF === "K" &&
                (this.settings.ruleset.escapeType === "corner" && this.corners.includes(to) ||
                this.settings.ruleset.escapeType === "edge" && this.isOnEdge(to))
            ) { continue; }
            moves.push(...this.getAllMoves(to, newMove, [...captured, ...newCaptured], initialFrom));
        }
        return moves;
    }

    private isOnEdge(cell: string): boolean {
        // Check if `cell` is on the edge of the board.
        const [x, y] = this.algebraic2coords(cell);
        return x === 0 || x === this.settings.boardSize - 1 || y === 0 || y === this.settings.boardSize - 1;
    }

    private getEdgeDir(cell: string): Directions {
        // Get the direction of the edge that `cell` is on.
        // Direction points inwards from the edge.
        // This is used in the algorithm for shieldWall captures and escape forts.
        const [x, y] = this.algebraic2coords(cell);
        if (x === 0) { return "E"; }
        if (x === this.settings.boardSize - 1) { return "W"; }
        if (y === 0) { return "S"; }
        if (y === this.settings.boardSize - 1) { return "N"; }
        throw new Error(`Cell ${cell} is not on the edge.`);
    }

    private getOrthCells(cell: string): string[] {
        // Gets all the cells that are orthogonally adjacent to the given cell.
        const [x, y] = this.algebraic2coords(cell);
        const orth: string[] = [];
        for (const dir of orthDirections) {
            const [x1, y1] = RectGrid.move(x, y, dir);
            if (this.grid.inBounds(x1, y1)) {
                orth.push(this.coords2algebraic(x1, y1));
            }
        }
        return orth;
    }

    private strongCaptureCheck(to: string, capture: string, initialFrom: string): boolean {
        // Check if a piece moves from `from` to `to` will result in a strong capture of piece at `capture`.
        // This is called by the custodian capture algorithm.
        const [plF,] = this.board.get(initialFrom)!;
        const [, pcC] = this.board.get(capture)!;
        const edgeAnvilTo = this.settings.ruleset.edge!.anvilTo!;
        const cornerAnvilTo = this.settings.ruleset.corner!.anvilTo!;
        const emptyThroneAnvilTo = this.settings.ruleset.throne!.emptyAnvilTo!;
        if (this.isOnEdge(capture)) {
            if (edgeAnvilTo.includes("none")) { return false; }
            if (edgeAnvilTo.includes("king-only") && pcC !== "K") { return false; }
            if (edgeAnvilTo.includes("men-only") && pcC === "K") { return false; }
        }
        const neighbours = this.getOrthCells(capture).filter((c) => to !== c);
        for (const n of neighbours) {
            if (!this.board.has(n)) {
                if (this.corners.includes(n)) {
                    if (cornerAnvilTo.includes("all")) { continue; }
                    if (cornerAnvilTo.includes("king-only") && pcC === "K") { continue; }
                    if (cornerAnvilTo.includes("men-only") && pcC !== "K") { continue; }
                }
                if (this.throne === n) {
                    if (emptyThroneAnvilTo.includes("all")) { continue; }
                    if (emptyThroneAnvilTo.includes("king-only") && pcC === "K") { continue; }
                    if (emptyThroneAnvilTo.includes("men-only") && pcC !== "K") { continue; }
                }
                return false;
            }
            const [plN, pcN] = this.board.get(n)!;
            if (plN !== plF) { return false; }
            const powerN = this.pieceMap.get(pcN)!.power!;
            if (powerN === "unarmed" || powerN === "hammer-only") { return false; }
        }
        return true;
    }

    private getCustodianCaptures(from: string, to: string, captured: string[] = [], initialFrom?: string): string[] {
        // Gets all the cells that would capture a piece if we moved to `to`.
        if (initialFrom === undefined) { initialFrom = from; }
        const [plF, pcF] = this.board.get(initialFrom)!;
        const powerF = this.pieceMap.get(pcF)!.power!;
        const captures: string[] = [];
        if (powerF === "unarmed" || powerF === "anvil-only") { return captures; }
        const [x, y] = this.algebraic2coords(to);
        for (const dir of orthDirections) {
            // Check each direction for custodian capture.
            // In this implementation, check for conditions for which capture cannot occur.
            // If it does not hit a `continue` statement, we add it to the `captures`.
            const ray = this.grid.ray(x, y, dir).map((c) => this.coords2algebraic(...c));
            if (ray.length === 0) { continue; }
            if (ray.includes(initialFrom) && initialFrom !== this.throne) { continue; }
            const capture = ray[0];
            if (!this.board.has(capture)) { continue; }
            const [plC, pcC] = this.board.get(capture)!;
            if (plC === plF) { continue; }
            const strength = this.pieceMap.get(pcC)!.strength!;
            const isStrong = strength === "strong" || strength === "strong-near-throne" && this.nearThrone.includes(capture);
            // Four side capture
            if (isStrong) {
                if (this.strongCaptureCheck(to, capture, initialFrom)) {
                    if (!captured.includes(capture)) { captures.push(capture); }
                    continue;
                } else if (!powerF.includes("piercing")) {
                    continue;
                }
            }
            if (ray.length === 1) {
                // Checking capture against the edge.
                const edgeAnvilTo = this.settings.ruleset.edge!.anvilTo!;
                if (edgeAnvilTo === "none") { continue; }
                if (isStrong) {
                    if (!edgeAnvilTo.includes("piercing")) { continue; }
                } else {
                    if (edgeAnvilTo === "king-only" && pcC !== "K") { continue; }
                    if (edgeAnvilTo === "men-only" && pcC === "K") { continue; }
                }
            } else {
                const anvilCell = ray[1];
                if (this.board.has(anvilCell)) {
                    // Check for capture against a piece occupying a cell.
                    const [plA, pcA] = this.board.get(anvilCell)!;
                    const powerA = this.pieceMap.get(pcA)!.power!;
                    if (plA === plC) { continue; }
                    if (isStrong) {
                        if (!powerA.includes("piercing")) { continue; }
                    } else {
                        if (powerA === "unarmed" || powerA === "hammer-only") { continue; }
                    }
                } else if (this.corners.includes(anvilCell)) {
                    // Check for capture against the corners.
                    const cornerAnvilTo = this.settings.ruleset.corner!.anvilTo!;
                    if (cornerAnvilTo === "none") { continue; }
                    if (isStrong) {
                        if (!cornerAnvilTo.includes("piercing")) { continue; }
                    } else {
                        if (cornerAnvilTo === "king-only" && pcC !== "K") { continue; }
                        if (cornerAnvilTo === "men-only" && pcC === "K") { continue; }
                    }
                } else if (this.throne === anvilCell) {
                    // Check for capture against the throne.
                    const emptyThroneAnvilTo = this.settings.ruleset.throne!.emptyAnvilTo!;
                    if (emptyThroneAnvilTo === "none") { continue; }
                    if (isStrong) {
                        if (!emptyThroneAnvilTo.includes("piercing")) { continue; }
                    } else {
                        if (emptyThroneAnvilTo === "king-only" && pcC !== "K") { continue; }
                        if (emptyThroneAnvilTo === "men-only" && pcC === "K") { continue; }
                    }
                } else {
                    // Otherwise, continue checking in the next direction.
                    continue;
                }
            }
            if (!captured.includes(capture)) { captures.push(capture); }
        }
        return captures;
    }

    private getJumpCaptures(from: string, to: string, captured: string[] = [], initialFrom?: string): string[] {
        // Get all cells where an enemy piece is captured by a jump move from `from` to `to`.
        if (initialFrom === undefined) { initialFrom = from; }
        const [plF, pcF] = this.board.get(initialFrom)!;
        const jump = this.pieceMap.get(pcF)!.jump!;
        if (!jump.includes("jump-capture")) { return []; }
        const betweens = RectGrid.between(...this.algebraic2coords(from), ...this.algebraic2coords(to));
        if (betweens.length !== 1) { return []; }
        const between = this.coords2algebraic(...betweens[0]);
        if (captured.includes(between)) { return []; }
        if (!this.board.has(between)) { return []; }
        const [plB, pcB] = this.board.get(between)!;
        if (plB === plF) { return []; }
        if (jump.includes("taflmen") && pcB !== "T") { return []; }
        return [between];
    }

    private getShieldWallCaptures(from: string, to: string, captured: string[] = [], initialFrom?: string): string[] {
        // Get all pieces captured by shieldWall capture.
        if (initialFrom === undefined) { initialFrom = from; }
        if (!this.settings.ruleset.hasShieldWalls) { return []; }
        if (!this.isOnEdge(to)) { return []; }
        const [plF, ] = this.board.get(initialFrom)!;
        const edgeDir = this.getEdgeDir(to);
        const dirsToCheck: Directions[] = edgeDir === "N" || edgeDir === "S" ? ["E", "W"] : ["N", "S"];
        const captures: string[] = [];
        const cornerAnvilTo = this.settings.ruleset.corner!.anvilTo!;
        loop:
        for (const dir of dirsToCheck) {
            // We add consecutive cells in a direction to `tentativeCaptures`.
            // If all conditions are met, we add all these cells to `captures`.
            const tentativeCaptures: string[] = [];
            const ray = this.grid.ray(...this.algebraic2coords(to), dir).map((c) => this.coords2algebraic(...c));
            for (const capture of ray) {
                if ((cornerAnvilTo.includes("all") || cornerAnvilTo.includes("king-only")) && this.corners.includes(capture)) { break; }
                if (!this.board.has(capture)) { continue loop; }
                const [plC, pcC] = this.board.get(capture)!;
                if (plC === plF) { break; }
                if (pcC !== "K" && !captured.includes(capture)) { tentativeCaptures.push(capture); }
                const adjacent = this.coords2algebraic(...RectGrid.move(...this.algebraic2coords(capture), edgeDir));
                if (!this.board.has(adjacent)) { continue loop; }
                const [plA, ] = this.board.get(adjacent)!;
                if (plA !== plF) { continue loop; }
            }
            captures.push(...tentativeCaptures);
        }
        return captures;
    }

    private getCaptures(from: string, to: string, captured: string[] = [], initialFrom?: string): string[] {
        // Get all pieces captured by a move from `from` to `to`.
        from = this.stripPrefix(from);
        if (initialFrom === undefined) { initialFrom = from; }
        const captures: string[] = [];
        captures.push(...this.getCustodianCaptures(from, to, captured, initialFrom));
        captures.push(...this.getJumpCaptures(from, to, captured, initialFrom));
        captures.push(...this.getShieldWallCaptures(from, to, captured, initialFrom));
        return [...new Set(captures)];
    }

    private hasCaptures(from: string, to: string, captured: string[] = [], initialFrom?: string): boolean {
        // Check if a move from `from` to `to` results in any captures.
        // Allows for short-circuiting.
        from = this.stripPrefix(from);
        if (initialFrom === undefined) { initialFrom = from; }
        else { initialFrom = this.stripPrefix(initialFrom); }
        if (this.getCustodianCaptures(from, to, captured, initialFrom).length > 0) { return true; }
        if (this.getJumpCaptures(from, to, captured, initialFrom).length > 0) { return true; }
        if (this.getShieldWallCaptures(from, to, captured, initialFrom).length > 0) { return true; }
        return false;
    }

    private getTosNormal(from: string, captured: string[] = [], initialFrom?: string): string[] {
        // Get all cells that a piece at `from` can move to using their normal move.
        // Does not check if piece is present on board.
        if (initialFrom === undefined) { initialFrom = from; }
        const coordsFrom = this.algebraic2coords(from);
        const [, pcF] = this.board.get(initialFrom)!;
        const piece = this.pieceMap.get(pcF)!;
        const tos: string[] = [];
        // For passable by, we assume that this setting is only relevant to the throne cell.
        let passedThrone = false;
        const throneEmptyPassableBy = this.settings.ruleset.throne!.emptyPassableBy;
        if (piece.movement!.startsWith("rook")) {
            const [, d] = piece.movement!.split("-");
            const limit = d === undefined ? this.settings.boardSize : Number(d);
            for (const dir of orthDirections) {
                const ray = this.grid.ray(...coordsFrom, dir).map((c) => this.coords2algebraic(...c));
                for (let i = 0; i < Math.min(ray.length, limit); i++) {
                    if (passedThrone) {
                        if (throneEmptyPassableBy === "none") { break; }
                        if (throneEmptyPassableBy === "king-only" && pcF !== "K") { break; }
                    }
                    const cell = ray[i];
                    if (cell === this.throne) { passedThrone = true; }
                    if (this.board.has(cell) && !captured.includes(cell) && cell !== initialFrom) { break; }
                    if (this.illegalCells.get(pcF)!.includes(cell)) { continue; }
                    tos.push(cell);
                }
            }
        }
        return tos;
    }

    private getTosJump(from: string, which: "all" | "capture" | "no-capture", captured: string[] = [], initialFrom?: string): string[] {
        // Get all jump moves from a cell at `from`.
        // Use `which` to specify if we want all jumps, only captures, or only non-captures.
        const tos: string[] = [];
        if (initialFrom === undefined) { initialFrom = from; }
        const [plF, pcF] = this.board.get(initialFrom)!;
        const jumpType = this.pieceMap.get(pcF)!.jump!;
        if (jumpType === "no-jump") {
            return tos;
        }
        if (which === "capture" && !jumpType.includes("jump-capture")) {
            return tos;
        }
        const coordsFrom = this.algebraic2coords(from);
        for (const dir of orthDirections) {
            const ray = this.grid.ray(...coordsFrom, dir).map((c) => this.coords2algebraic(...c));
            if (ray.length <= 1) { continue; }
            if (!this.board.has(ray[0]) || captured.includes(ray[0])) { continue; }
            const [plJ, pcJ] = this.board.get(ray[0])!;
            if (this.board.has(ray[1]) && !captured.includes(ray[1]) && ray[1] !== initialFrom) { continue; }
            if (this.illegalCells.get(pcF)!.includes(ray[1])) { continue; }
            if (jumpType.includes("jump-capture") && which === "no-capture" && plJ !== plF) { continue; }
            if (jumpType.includes("jump-capture") && which === "capture" && plJ === plF) { continue; }
            if ((jumpType === "jump-enemy-taflmen" || jumpType === "jump-capture-enemy-taflmen") && plJ !== plF && pcJ === "T") {
                // Jump over any enemy taflmen.
                tos.push(ray[1]);
            } else if (jumpType === "jump-taflmen" && pcJ === "T") {
                // Jump over any taflmen.
                tos.push(ray[1]);
            } else if (jumpType === "jump-enemy-taflmen-to-from-restricted" && plJ !== plF && pcJ === "T") {
                // Jump over any enemy taflmen, but only if the to or from cells are restricted to the jumper.
                const restrictedToCells = this.restrictedToCells.get(pcF)!;
                if (restrictedToCells.includes(from) || restrictedToCells.includes(ray[1])) {
                    tos.push(ray[1]);
                }
            }
        }
        return tos;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(([p, pc]) => p === player && pc !== "K").length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        // We also remove any capital letters from the cell names.
        a = a.replace(/[A-Z]/, "");
        b = b.replace(/[A-Z]/, "");
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private addPrefix(cell: string, initialFrom?: string): string {
        // Assumes that the cell has a piece.
        if (initialFrom === undefined) { initialFrom = cell; }
        const [, pc] = this.board.get(initialFrom)!;
        const letter = pc === "T" ? "" : pc;
        return letter + cell;
    }

    private stripPrefix(cell: string): string {
        // Remove the letter from the cell name.
        return cell.replace(/[A-Z]/, "");
    }

    private extractCaptures(move: string): string[] {
        // Extract all captures in the notation.
        const captures: string[] = [];
        const moves = move.split(" ");
        for (const m of moves) {
            const [, ...captured] = m.split("x");
            captures.push(...captured.map((c) => this.stripPrefix(c)));
        }
        return captures;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            const captured = this.extractCaptures(move);
            if (move === "" || this.board.has(cell) && !captured.includes(cell) && cell !== this.stripPrefix(move.split(" ")[0].split(/[-\^]/)[0])) {
                if (this.board.has(cell) && !captured.includes(cell)) {
                    newmove = this.addPrefix(cell);
                } else {
                    // If the cell is empty, we just assign the cell to the move
                    // And allow the validation to handle the error.
                    newmove = cell;
                }
            } else {
                const moves = move.split(" ");
                const firstMove = moves[0];
                const lastMove = moves[moves.length - 1];
                const [initialFrom, ] = firstMove.split(/[-\^x]/);
                const [from, to, ] = lastMove.split(/[-\^x]/);
                if (to === undefined) {
                    // This can only happen after first click.
                    const latestMove = this.createMove(this.stripPrefix(from), cell);
                    newmove = latestMove;
                } else {
                    newmove = move + " " + this.createMove(to, cell, captured, this.stripPrefix(initialFrom));
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
            result.canrender = true;
            result.message = i18next.t("apgames:validation.tafl.INITIAL_INSTRUCTIONS");
            return result;
        }
        const cells = m.split(/[-\^x ]/);

        // Valid cell
        let currentMove;
        try {
            for (const p of cells) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(this.stripPrefix(p));
                if (!this.grid.inBounds(x, y)) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        const moves = m.split(" ");

        // Check that first click is a piece of the current player
        const firstMove = moves[0];
        const [initialFrom, initialTo, ] = firstMove.split(/[-\^x]/);
        const initialFromStripped = this.stripPrefix(initialFrom);
        if (!this.board.has(this.stripPrefix(initialFromStripped))) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: initialFromStripped});
            return result;
        }
        const [plF, ] = this.board.get(initialFromStripped)!;
        if (plF !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // Check that captured pieces are the opponent's
        const captures = this.extractCaptures(m);
        for (const capture of captures) {
            const [plC, ] = this.board.get(this.stripPrefix(capture))!;
            if (plC === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                return result;
            }
        }

        let previousTo: string | undefined;
        for (const [i, move] of moves.entries()) {
            const [from, to, ...toCaptures] = move.split(/[-\^x]/);
            const strippedFrom = this.stripPrefix(from);
            // No same from and to.
            if (strippedFrom === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO", {from});
                return result;
            }
            // Check that multimoves are contiguous.
            if (previousTo !== undefined) {
                if (strippedFrom !== previousTo) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tafl.CONTIGUOUS", {from, previousTo});
                    return result;
                }
            }
            previousTo = to;
            // Check that all cells have the correct prefix.
            const toCheck = i === 0 ? [from, ...toCaptures] : toCaptures;
            for (const cell of toCheck) {
                const prefixed = this.addPrefix(this.stripPrefix(cell))
                if (prefixed !== cell) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tafl.PREFIX", {cell, prefixed});
                    return result;
                }
            }
        }

        // Check that the mave is normalised.
        const normalised = this.normaliseMove(m);
        if (normalised !== m) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tafl.NORMALISE", {normalised});
            return result;
        }
        // Check that the piece can move
        const tos = this.getTos(initialFromStripped);
        if (tos.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tafl.NO_MOVES", {from: initialFromStripped});
            return result;
        }
        // Incomplete move
        if (initialTo === undefined) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }
        // Check that initial destination is valid
        if (!tos.includes(initialTo)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tafl.INVALID_DESTINATION", {from: initialFromStripped, to: initialTo});
            return result;
        }
        // correctness of multistep moves
        if (moves.length > 1) {
            const currentCaptures = this.extractCaptures(firstMove);
            let currentFrom = initialTo;
            for (const move of moves.slice(1)) {
                const [, to, ] = move.split(/[-\^x]/);
                if (!this.getTos(currentFrom, currentCaptures, initialFromStripped, "berserk").includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tafl.BERSERK", {to});
                    return result;
                }
                currentCaptures.push(...this.extractCaptures(move));
                currentFrom = to;
            }
        }
        const lastMove = moves[moves.length - 1];
        const [, lastTo, ] = lastMove.split(/[-\^x]/);
        if (this.settings.ruleset.berserkCapture && captures.length > 0 && this.getTos(lastTo, captures, initialFromStripped, "berserk").length > 0) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.tafl.BERSERK_CONTINUE");
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): TaflGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        let result;
        m = m.trim().replace(/\s+/g, " ");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        // Move valid, so change the state
        const moves = m.split(" ");
        this.results = [];
        for (const move of moves) {
            const [from, to, ] = move.split(/[-\^x]/);
            const strippedFrom = this.stripPrefix(from);
            if (to !== undefined) {
                const [, pcF] = this.board.get(strippedFrom)!;
                const custodianCaptures = this.getCustodianCaptures(strippedFrom, to);
                const jumpCaptures = this.getJumpCaptures(strippedFrom, to);
                const shieldWallCaptures = this.getShieldWallCaptures(strippedFrom, to);
                const moveHow = this.getTosJump(strippedFrom, "all").includes(to) ? "jump" : "normal";
                this.results.push({type: "move", from: strippedFrom, to, what: pcF, how: moveHow});
                this.board.delete(strippedFrom)
                this.board.set(to, [this.currplayer, pcF]);
                for (const capture of custodianCaptures) {
                    const [, pcC] = this.board.get(capture)!;
                    this.board.delete(capture);
                    this.results.push({type: "capture", where: capture, what: pcC,  how: "custodian"});
                }
                for (const capture of jumpCaptures) {
                    if (!this.board.has(capture)) { continue; }
                    const [, pcC] = this.board.get(capture)!;
                    this.board.delete(capture);
                    this.results.push({type: "capture", where: capture, what: pcC, how: "jump"});
                }
                for (const capture of shieldWallCaptures) {
                    if (!this.board.has(capture)) { continue; }
                    const [, pcC] = this.board.get(capture)!;
                    this.board.delete(capture);
                    this.results.push({type: "capture", where: capture, what: pcC, how: "shieldWall"});
                }
            }
        }
        if (partial) {
            const [from, to, ] = moves[0].split(/[-\^x]/);
            if (moves.length === 1 && to === undefined) {
                this.dots = this.getTos(this.stripPrefix(from));
            } else if (this.settings.ruleset.berserkCapture) {
                const lastMove = moves[moves.length - 1];
                // eslint-disable-next-line @typescript-eslint/no-shadow, no-shadow
                const [, to, ] = lastMove.split(/[-\^x]/);
                const captured = this.extractCaptures(lastMove);
                if (captured.length > 0) {
                    this.dots = this.getTos(to, [], undefined, "berserk");
                }
            }
            return this;
        } else {
            this.dots = [];
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private kingDead(captures?: string[]): boolean {
        // Check if King is dead.
        // If a list of captures is provided, check if the King is in the list.
        if (captures === undefined) {
            const kingArray = Array.from(this.board.entries()).filter(([, [p, pc]]) => p === this.playerDefender && pc === "K");
            if (kingArray.length === 0) { return true; }
            return false;
        }
        if (captures.map((c) => this.board.get(c)![1]).includes("K")) { return true; }
        return false;
    }

    private escaped(kingCell?: string): boolean {
        // Check if King has escaped.
        // If a cell is provided, check that it is on the edge or on the corner.
        const escapeType = this.settings.ruleset.escapeType!;
        if (kingCell === undefined) {
            const kingArray = Array.from(this.board.entries()).filter(([, [p, pc]]) => p === this.playerDefender && pc === "K");
            if (kingArray.length === 0) { return false; }
            kingCell = kingArray[0][0];
        }
        if (kingCell === undefined) { return false; }
        if (escapeType === "edge" && this.isOnEdge(kingCell)) { return true; }
        if (escapeType === "corner" && this.corners.includes(kingCell)) { return true; }
        return false;
    }

    private encircled(): boolean {
        // Check if all defenders are encircled.
        const defendersCount = Array.from(this.board.entries()).filter(([, [p,]]) => p === this.playerDefender).length;
        const seen: Set<string> = new Set();
        // Start from king.
        const todo: string[] = Array.from(this.board.entries()).filter(([, [, pc]]) => pc === "K").map(([c,]) => c);
        const defenders: Set<string> = new Set(todo);
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) { continue; }
            seen.add(cell);
            const neighbours = this.getOrthCells(cell);
            for (const n of neighbours) {
                if (this.board.has(n)) {
                    const [pl,] = this.board.get(n)!
                    if (pl === this.playerAttacker) { continue; }
                    defenders.add(n);
                }
                if (this.isOnEdge(n)) { return false; }
                todo.push(n);
            }
        }
        if (defenders.size === defendersCount) {
            return true;
        } else {
            return false;
        }
    }

    private hasExitFort(kingCell?: string): boolean {
        // Check for applicability of this rule before calling this function.
        // Checks that
        // 1. King is present (if it is not given).
        // 2. King is on the edge.
        // 3. King has at least one space to move.
        // 4. King is trapped in a space with its own taflmen only.
        if (kingCell === undefined) {
            const kingCells = Array.from(this.board.entries()).filter(([, [p, pc]]) => p === this.playerDefender && pc === "K").map(([c,]) => c);
            // 1. King is present.
            if (kingCells.length === 0) { return false; }
            kingCell = kingCells[0];
        }
        // 2. King is on the edge.
        if (!this.isOnEdge(kingCell)) { return false; }
        const todo: string[] = [kingCell];
        const seen: Set<string> = new Set();
        let kingHasSpace = false;
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) { continue; }
            seen.add(cell);
            const neighbours = this.getOrthCells(cell);
            for (const n of neighbours) {
                if (!kingHasSpace && !this.board.has(n)) {
                    kingHasSpace = true;
                }
                if (this.board.has(n)) {
                    const [pl,] = this.board.get(n)!
                    if (pl === this.playerDefender) { continue; }
                    // 4. King is trapped in a space with its own taflmen only.
                    return false;
                }
                todo.push(n);
            }
            // 3. King has at least one space to move.
            if (!kingHasSpace) { return false; }
        }
        return true;
    }

    public inCheck(): number[] {
        const checks: playerid[] = [];
        if (this.gameover && this.lastmove !== "resign" && this.lastmove !== "timeout") {
            return checks;
        }
        // if the attacker can capture the king, then the defender is in check.
        for (const move of this.moves(this.playerAttacker)) {
            if (this.kingDead(this.extractCaptures(move))) {
                checks.push(this.playerDefender);
                break;
            }
        }
        // if there is an encirclement, then the defender is in check.
        if (this.settings.ruleset.encirclementWin! && this.encircled()) {
            if (!checks.includes(this.playerDefender)) {
                checks.push(this.playerDefender);
            }
        }
        // if the defender can escape the next turn, then the attacker is in check.
        const kingPos = Array.from(this.board.entries()).filter(([, [p, pc]]) => p === this.playerDefender && pc === "K").map(([c,]) => c);
        if (kingPos.length > 0) {
            for (const move of this.getAllMoves(kingPos[0])) {
                const moveSegments = move.split(" ");
                const breakups = moveSegments[moveSegments.length - 1].split(/[-\^x]/);
                const to = breakups[1];
                if (this.escaped(to)) {
                    checks.push(this.playerAttacker);
                    break;
                }
            }
        }
        // if there is an escape fort, then the attacker is in check.
        if (this.settings.ruleset.hasExitForts! && this.hasExitFort()) {
            if (!checks.includes(this.playerAttacker)) {
                checks.push(this.playerAttacker);
            }
        }
        return checks;
    }

    protected checkEOG(): TaflGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.kingDead()) {
            this.gameover = true;
            this.winner = [this.playerAttacker];
            this.results.push({ type: "eog", reason: "king-captured" });
        } else if (this.escaped()) {
            this.gameover = true;
            this.winner = [this.playerDefender];
            this.results.push({ type: "eog", reason: "king-escaped" });
        } else if (this.settings.ruleset.repetition === "defenders-lose" && this.currplayer === this.playerAttacker && this.stateCount() >= 2) {
            // Perpetual repetitions is a loss for the defender.
            // But we only enforce it if defender player makes their turn.
            this.gameover = true;
            this.winner = [this.playerAttacker];
            this.results.push({ type: "eog", reason: "repetition" });
        } else if (this.settings.ruleset.repetition === "draw" && this.stateCount() >= 2) {
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "repetition" });
        } else if (this.currplayer === this.playerAttacker && this.settings.ruleset.encirclementWin! && this.encircled()) {
            this.gameover = true;
            this.winner = [this.playerAttacker];
            this.results.push({ type: "eog", reason: "encirclement" });
        } else if (this.currplayer === this.playerDefender && this.settings.ruleset.hasExitForts! && this.hasExitFort()) {
            this.gameover = true;
            this.winner = [this.playerDefender];
            this.results.push({ type: "eog", reason: "exit-fort" });
        } else if (!this.hasMoves()) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (this.gameover) {
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): ITaflState {
        return {
            game: TaflGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: TaflGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public getPlayerColour(p: playerid): number|string {
        // We make it so that the attackers consistently have the colour of player 1
        // and the defenders consistently have the colour of player 2.
        if (p === this.playerAttacker) {
            return 1;
        } else {
            return 2;
        }
    }

    public render(): APRenderRep {
        // Build piece string
        // A - player 1 taflman
        // B - player 2 taflman
        // D - player 2 king
        // E - player 1 commander
        // F - player 2 commander
        // G - player 1 knight
        // H - player 2 knight
        let pstr = "";
        for (let row = 0; row < this.settings.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.settings.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, contents] = this.board.get(cell)!;
                    if (player === this.playerAttacker) {
                        switch (contents) {
                            case "T":
                                pstr += "A";
                                break
                            case "K":
                                pstr += "C";
                                break;
                            case "C":
                                pstr += "E";
                                break;
                            case "N":
                                pstr += "G";
                                break;
                        }
                    } else if (player === this.playerDefender) {
                        switch (contents) {
                            case "T":
                                pstr += "B";
                                break;
                            case "K":
                                pstr += "D";
                                break;
                            case "C":
                                pstr += "F";
                                break;
                            case "N":
                                pstr += "H";
                                break;
                        }
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.settings.boardSize}}`, "g"), "_");

        let markers: Array<any> | undefined = []
        if (this.settings.ruleset.berserkCapture) {
            markers.push({
                    type: "shading", colour: "#FFA500", opacity: 0.1,
                    points: [{row: 0, col: 0}, {row: 0, col: this.settings.boardSize}, {row: this.settings.boardSize, col: this.settings.boardSize}, {row: this.settings.boardSize, col: 0}],
                })
        }
        if (this.throne !== undefined) {
            const [x, y] = this.algebraic2coords(this.throne);
            const thronePoints = [{row: y, col: x}];
            markers.push({ type: "flood", colour: 2, opacity: 0.4, points: thronePoints });
        }
        if (this.corners.length > 0) {
            const cornerPoints: Array<any> = [];
            for (const corner of this.corners) {
                const [x, y] = this.algebraic2coords(corner);
                cornerPoints.push({row: y, col: x});
            }
            markers.push({ type: "flood", colour: 2, opacity: 0.4, points: cornerPoints });
        }
        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.settings.boardSize,
                height: this.settings.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: this.pieceMap.get("K")!.movement === "rook-1"
                  ? [{ name: "piece-horse", colour: 1 }, { text: "♧️", scale: 0.3, colour: "_context_fill" }]
                  : this.pieceMap.get("K")!.power === "unarmed"
                  ? [{ name: "piece-horse", colour: 1 }, { name: "piecepack-suit-diamonds", scale: 0.4, colour: "_context_fill", orientation: "vertical" }]
                  : this.pieceMap.get("K")?.strength === "strong"
                  ? [ { name: "piece-horse", colour: 1 }, { name: "cross-orth", scale: 0.4, colour: "_context_fill", orientation: "vertical" } ]
                  : this.pieceMap.get("K")?.strength === "strong-near-throne"
                  ? [ { name: "piece-horse", colour: 1 }, { text: "〜", scale: 0.3, colour: "_context_fill" } ]
                  : [{ name: "piece-horse", colour: 1 }, { text: "━", scale: 0.4, colour: "_context_fill" }],
                D: this.pieceMap.get("K")!.movement === "rook-1"
                  ? [{ name: "piece-horse", colour: 2 }, { text: "♧️", scale: 0.3, colour: "_context_fill" }]
                  : this.pieceMap.get("K")!.power === "unarmed"
                  ? [{ name: "piece-horse", colour: 2 }, { name: "piecepack-suit-diamonds", scale: 0.4, colour: "_context_fill", orientation: "vertical" }]
                  : this.pieceMap.get("K")?.strength === "strong"
                  ? [ { name: "piece-horse", colour: 2 }, { name: "cross-orth", scale: 0.4, colour: "_context_fill", orientation: "vertical" } ]
                  : this.pieceMap.get("K")?.strength === "strong-near-throne"
                  ? [ { name: "piece-horse", colour: 2 }, { text: "〜", scale: 0.3, colour: "_context_fill" } ]
                  : [{ name: "piece-horse", colour: 2 }, { text: "━", scale: 0.4, colour: "_context_fill" }],
                E: [{ name: "piece", colour: 1 }, { text: "C", scale: 0.5, colour: "_context_fill" }],
                F: [{ name: "piece", colour: 2 }, { text: "C", scale: 0.5, colour: "_context_fill" }],
                G: [{ name: "piece", colour: 1 }, { text: "N", scale: 0.5, colour: "_context_fill" }],
                H: [{ name: "piece", colour: 2 }, { text: "N", scale: 0.5, colour: "_context_fill" }],
            },
            pieces: pstr,
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    if (move.where === undefined) { continue; }
                    const targets: RowCol[] = [];
                    for (const cell of move.where.split(",")) {
                        if (cell.length === 0) { continue; }
                        const [x, y] = this.algebraic2coords(cell);
                        targets.push({row: y, col: x});
                    }
                    if (targets.length > 0) {
                        rep.annotations.push({type: "exit", targets: targets as [RowCol, ...RowCol[]]});
                    }
                }
            }
        }
        if (this.dots.length > 0) {
            const points: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots", targets: points as [RowCol, ...RowCol[]]});
        }
        return rep;
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
            case "move":
                if (r.how === "jump") {
                    node.push(i18next.t("apresults:MOVE.tafl_jump", { player, from: r.from, to: r.to }));
                } else {
                    node.push(i18next.t("apresults:MOVE.tafl", { player, from: r.from, to: r.to }));
                }
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.tafl", { player, where: r.where }));
                resolved = true;
                break;
            case "eog":
                switch (r.reason) {
                    case "king-captured":
                        node.push(i18next.t("apresults:EOG.tafl_king_captured"));
                        break;
                    case "king-escaped":
                        node.push(i18next.t("apresults:EOG.tafl_king_escaped"));
                        break;
                    case "repetition":
                        node.push(i18next.t("apresults:EOG.repetition", { count: 3 }));
                        break;
                    case "stalemate":
                        node.push(i18next.t("apresults:EOG.stalemate"));
                        break;
                    case "encirclement":
                        node.push(i18next.t("apresults:EOG.tafl_encirclement"));
                        break;
                    case "exit-fort":
                        node.push(i18next.t("apresults:EOG.tafl_exit_fort"));
                        break;
                    case undefined:
                        node.push(i18next.t("apresults:EOG.default"));
                        break;
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): TaflGame {
        return new TaflGame(this.serialize());
    }
}
