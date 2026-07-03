import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, BoardBasic, Glyph, IsoCubeFaces, IsoPiece, MarkerDots } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";

export type playerid = 1 | 2;
/** Top colour then front (+Z / toward rank 1) colour, e.g. `12` = top 1, south face 2. */
type Orient = "11" | "12" | "21" | "22";
type TipDir = "N" | "E" | "S" | "W";
type Phase = "place" | "tip";

const ORIENTS: Orient[] = ["11", "12", "21", "22"];
/** Placements in untippable cells: south face is always colour 1. */
const HOLE_ORIENTS: Orient[] = ["11", "21"];
const TIP_DIRS: TipDir[] = ["N", "E", "S", "W"];

/** `near` = bottom cube on the adjacent cell; `far` = top cube two cells away. */
type LieSlot = "near" | "far";

type CellPiece =
    | { kind: "stand"; orient: Orient }
    | { kind: "lie"; orient: Orient; tipDir: TipDir; slot: LieSlot };

interface PendingPlacement {
    cell: string;
    orient: Orient;
    top: playerid;
    placer: playerid;
}

type FlatLegend = {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
};
type IsoLegend = {
    [key: string]: IsoPiece;
};

// Each megalith is two cubes stacked vertically. On each cube: top/bottom are opposite
// colours; left/right match; front/back match and are opposite of left/right.
// Placement `TF-cell`: T = top colour, F = front (+Z, toward rank 1 / south) colour.

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellPiece>;
    phase: Phase;
    pending: PendingPlacement | null;
    forcedPass: boolean;
    reserve: number;
    lastmove?: string;
}

export interface ICarnacState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class CarnacGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Carnac",
        uid: "carnac",
        playercounts: [2],
        version: "20260707",
        dateAdded: "2026-07-02",
        description: "apgames:descriptions.carnac",
        notes: "apgames:notes.carnac",
        urls: ["https://boardgamegeek.com/boardgame/103061/carnac"],
        people: [
            {
                type: "designer",
                name: 'Emiliano "Wentu" Venturini',
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "8x5", group: "board" },
            { uid: "#board" },
            { uid: "14x9", group: "board" },
        ],
        displays: [{ uid: "flat" }],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>displace", "board>3d", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["scores", "shared-stash", "automove", "custom-buttons", "experimental"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellPiece>;
    public phase: Phase = "place";
    public pending: PendingPlacement | null = null;
    public forcedPass = false;
    public reserve = 28;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public width = 10;
    public height = 7;

    constructor(state?: ICarnacState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = [...variants];
            }
            this.setBoardDimensions();
            const fresh: IMoveState = {
                _version: CarnacGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                phase: "place",
                pending: null,
                forcedPass: false,
                reserve: 28,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICarnacState;
            }
            if (state.game !== CarnacGame.gameinfo.uid) {
                throw new Error(`The Carnac engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    private setBoardDimensions(): void {
        if (this.variants.includes("8x5")) {
            this.width = 8;
            this.height = 5;
        } else if (this.variants.includes("14x9")) {
            this.width = 14;
            this.height = 9;
        } else {
            this.width = 10;
            this.height = 7;
        }
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.height);
    }

    public load(idx = -1): CarnacGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.phase = state.phase;
        this.pending = state.pending ? { ...state.pending } : null;
        this.forcedPass = state.forcedPass;
        this.reserve = state.reserve;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.setBoardDimensions();
        return this;
    }

    private inBounds(x: number, y: number): boolean {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    private isEmpty(cell: string): boolean {
        return !this.board.has(cell);
    }

    private opposite(colour: playerid): playerid {
        return colour === 1 ? 2 : 1;
    }

    private parseOrient(orient: Orient): { top: playerid; front: playerid } {
        return {
            top: parseInt(orient[0], 10) as playerid,
            front: parseInt(orient[1], 10) as playerid,
        };
    }

    /** Renderer `faces` colours: top/bottom, north=back, south=front, west=left, east=right. */
    private cubeFaces(top: playerid, front: playerid): { top: playerid; bottom: playerid; north: playerid; south: playerid; east: playerid; west: playerid } {
        const side = this.opposite(front);
        return {
            top,
            bottom: this.opposite(top),
            north: front,
            south: front,
            east: side,
            west: side,
        };
    }

    private applyTipMapping(
        faces: { top: playerid; bottom: playerid; north: playerid; south: playerid; east: playerid; west: playerid },
        tipDir: TipDir,
    ): IsoCubeFaces {
        switch (tipDir) {
            case "N":
                return {
                    top: faces.south,
                    north: faces.top,
                    south: faces.bottom,
                    east: faces.east,
                    west: faces.west,
                };
            case "S":
                return {
                    top: faces.north,
                    north: faces.bottom,
                    south: faces.top,
                    east: faces.east,
                    west: faces.west,
                };
            case "E":
                return {
                    top: faces.west,
                    north: faces.north,
                    south: faces.south,
                    east: faces.top,
                    west: faces.bottom,
                };
            case "W":
                return {
                    top: faces.east,
                    north: faces.north,
                    south: faces.south,
                    east: faces.bottom,
                    west: faces.top,
                };
        }
    }

    /** One quarter-turn from standing; identical for both cubes in the tipped pair. */
    private tippedCubeFaces(
        faces: { top: playerid; bottom: playerid; north: playerid; south: playerid; east: playerid; west: playerid },
        tipDir: TipDir,
    ): IsoCubeFaces {
        return this.applyTipMapping(faces, tipDir);
    }

    private orientFaces(orient: Orient): { top: playerid; bottom: playerid; north: playerid; south: playerid; east: playerid; west: playerid } {
        const { top, front } = this.parseOrient(orient);
        return this.cubeFaces(top, front);
    }

    private topColor(orient: Orient): playerid {
        return this.parseOrient(orient).top;
    }

    private keyCubeFaces(orient: Orient): IsoCubeFaces {
        const { top, north, south, east, west } = this.orientFaces(orient);
        return { top, north, south, east, west };
    }

    /** Bird's-eye colour on a cell (dolmen scoring and flat view). */
    public scoringColour(cell: string): playerid | undefined {
        const piece = this.board.get(cell);
        if (piece === undefined) {
            return undefined;
        }
        return this.pieceTopColour(piece);
    }

    private pieceTopColour(piece: CellPiece): playerid {
        if (piece.kind === "stand") {
            return this.topColor(piece.orient);
        }
        return this.lyingCubeFaces(piece.orient, piece.tipDir).top as playerid;
    }

    /** Face colours for one cube after tipping (identical for both cubes in the pair). */
    public lyingCubeFaces(orient: Orient, tipDir: TipDir): IsoCubeFaces {
        return this.tippedCubeFaces(this.orientFaces(orient), tipDir);
    }

    /**
     * Board-relative step from internal coordinates.
     * N/S/E/W follow algebraic labelling: from a1, north is a2 then a3, east is b1 then c1.
     */
    private boardStep(x: number, y: number, dir: TipDir, dist: number): [number, number] {
        switch (dir) {
            case "N":
                return [x, y - dist];
            case "S":
                return [x, y + dist];
            case "E":
                return [x + dist, y];
            case "W":
                return [x - dist, y];
        }
    }

    private tipTargets(cell: string, dir: TipDir): [string, string] | undefined {
        const [x, y] = this.algebraic2coords(cell);
        const [x1, y1] = this.boardStep(x, y, dir, 1);
        const [x2, y2] = this.boardStep(x, y, dir, 2);
        if (!this.inBounds(x1, y1) || !this.inBounds(x2, y2)) {
            return undefined;
        }
        const near = this.coords2algebraic(x1, y1);
        const far = this.coords2algebraic(x2, y2);
        if (!this.isEmpty(near) || !this.isEmpty(far)) {
            return undefined;
        }
        return [near, far];
    }

    private validTipDirections(pending: PendingPlacement): TipDir[] {
        const dirs: TipDir[] = [];
        for (const dir of TIP_DIRS) {
            if (this.tipTargets(pending.cell, dir) !== undefined) {
                dirs.push(dir);
            }
        }
        return dirs;
    }

    private emptyCells(): string[] {
        const cells: string[] = [];
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.isEmpty(cell)) {
                    cells.push(cell);
                }
            }
        }
        return cells;
    }

    /** Empty cell with no room to tip a standing megalith in any direction. */
    private isHole(cell: string): boolean {
        for (const dir of TIP_DIRS) {
            if (this.tipTargets(cell, dir) !== undefined) {
                return false;
            }
        }
        return true;
    }

    private validOrientsForCell(cell: string): Orient[] {
        if (this.isHole(cell)) {
            return HOLE_ORIENTS;
        }
        return ORIENTS;
    }

    private canPlace(): boolean {
        return this.reserve > 0 && this.emptyCells().length > 0;
    }

    private placementMoves(): string[] {
        if (!this.canPlace()) {
            return [];
        }
        const moves: string[] = [];
        for (const cell of this.emptyCells()) {
            for (const orient of this.validOrientsForCell(cell)) {
                moves.push(`${orient}-${cell}`);
            }
        }
        return moves;
    }

    private tipMoves(): string[] {
        if (this.pending === null) {
            return [];
        }
        const moves: string[] = [];
        for (const dir of this.validTipDirections(this.pending)) {
            moves.push(`>${dir.toLowerCase()}`);
        }
        if (moves.length > 0) {
            moves.push("pass");
        }
        return moves;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        if (this.forcedPass) {
            return ["pass"];
        }
        if (this.phase === "tip") {
            return this.tipMoves();
        }
        return this.placementMoves();
    }

    public getButtons(): ICustomButton[] {
        if (this.forcedPass) {
            return [{ label: "pass", move: "pass" }];
        }
        if (this.phase === "tip" && this.pending !== null) {
            const buttons: ICustomButton[] = [];
            for (const dir of this.validTipDirections(this.pending)) {
                buttons.push({ label: `tip_${dir.toLowerCase()}`, move: `>${dir.toLowerCase()}` });
            }
            if (buttons.length > 0) {
                buttons.push({ label: "pass", move: "pass" });
            }
            return buttons;
        }
        return [];
    }

    public sidebarScores(): IScores[] {
        const counts = this.dolmenCounts();
        return [
            { name: i18next.t("apgames:status.carnac.DOLMENS"), scores: [counts[0], counts[1]] },
        ];
    }

    public sidebarStatus(): IStatus[] {
        return [
            { key: i18next.t("apgames:status.carnac.RESERVE"), value: [this.reserve.toString()] },
        ];
    }

    private topViewColors(): Map<string, playerid> {
        const view = new Map<string, playerid>();
        for (const [cell, piece] of this.board.entries()) {
            view.set(cell, this.pieceTopColour(piece));
        }
        return view;
    }

    private dolmenComponents(): Map<playerid, number[]> {
        const view = this.topViewColors();
        const g = new UndirectedGraph();
        for (const cell of view.keys()) {
            g.addNode(cell);
        }
        for (const cell of view.keys()) {
            const [x, y] = this.algebraic2coords(cell);
            for (const dir of ["N", "E", "S", "W"] as TipDir[]) {
                const [xn, yn] = this.boardStep(x, y, dir, 1);
                if (!this.inBounds(xn, yn)) {
                    continue;
                }
                const neighbour = this.coords2algebraic(xn, yn);
                if (view.has(neighbour) && view.get(neighbour) === view.get(cell)) {
                    if (!g.hasEdge(cell, neighbour)) {
                        g.addEdge(cell, neighbour);
                    }
                }
            }
        }
        const sizes: Map<playerid, number[]> = new Map([[1, []], [2, []]]);
        for (const component of connectedComponents(g)) {
            if (component.length < 3) {
                continue;
            }
            const colour = view.get(component[0])!;
            sizes.get(colour)!.push(component.length);
        }
        for (const p of [1, 2] as playerid[]) {
            sizes.get(p)!.sort((a, b) => b - a);
        }
        return sizes;
    }

    public dolmenCounts(): [number, number] {
        const sizes = this.dolmenComponents();
        return [sizes.get(1)!.length, sizes.get(2)!.length];
    }

    private compareDolmenScores(a: number[], b: number[]): number {
        const max = Math.max(a.length, b.length);
        for (let i = 0; i < max; i++) {
            const av = a[i] ?? 0;
            const bv = b[i] ?? 0;
            if (av !== bv) {
                return av - bv;
            }
        }
        return 0;
    }

    private tipDirectionFromClick(standingCell: string, clickRow: number, clickCol: number): TipDir | undefined {
        const [px, py] = this.algebraic2coords(standingCell);
        if (clickCol === px && clickRow !== py) {
            return clickRow < py ? "N" : "S";
        }
        if (clickRow === py && clickCol !== px) {
            return clickCol > px ? "E" : "W";
        }
        return undefined;
    }

    private isPlacementKeyPiece(piece?: string): boolean {
        if (piece === undefined) {
            return false;
        }
        if (ORIENTS.includes(piece as Orient)) {
            return true;
        }
        return piece === "K1" || piece === "K2" || piece === "K3" || piece === "K4"
            || piece === "1" || piece === "2";
    }

    private orientFromKeyClick(piece?: string, move?: string): Orient | undefined {
        if (piece !== undefined && ORIENTS.includes(piece as Orient)) {
            return piece as Orient;
        }
        const keyPieces: Record<string, Orient> = {
            K1: "11", K2: "12", K3: "21", K4: "22",
        };
        if (piece !== undefined && keyPieces[piece] !== undefined) {
            return keyPieces[piece];
        }
        const flatNames: Record<string, Orient> = {
            "1": "11",
            "2": "21",
        };
        if (piece !== undefined && flatNames[piece] !== undefined) {
            return flatNames[piece];
        }
        if (move !== undefined && move.length > 0 && ORIENTS.includes(move as Orient)) {
            return move as Orient;
        }
        return undefined;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = move;
            if (piece === "_btn_pass") {
                newmove = "pass";
            } else if (piece !== undefined && piece.startsWith("_btn_tip_")) {
                newmove = `>${piece.substring("_btn_tip_".length)}`;
            } else if (this.phase === "place" && !this.forcedPass) {
                const keyOrient = this.orientFromKeyClick(piece, move);
                if (row < 0 || col < 0 || this.isPlacementKeyPiece(piece)) {
                    if (keyOrient === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.carnac.SELECT_ORIENTATION"),
                        };
                    }
                    newmove = keyOrient;
                } else {
                    const cell = this.coords2algebraic(col, row);
                    const selected = ORIENTS.find(o => move === o || move.startsWith(`${o}-`));
                    if (selected !== undefined) {
                        newmove = `${selected}-${cell}`;
                    }
                }
            } else if (this.phase === "tip" && this.pending !== null && !this.forcedPass) {
                if (piece !== undefined && ["n", "e", "s", "w"].includes(piece)) {
                    newmove = `>${piece}`;
                } else {
                    const dir = this.tipDirectionFromClick(this.pending.cell, row, col);
                    if (dir === undefined) {
                        return {
                            move: "",
                            valid: false,
                            message: i18next.t("apgames:validation.carnac.TIP_OR_PASS"),
                        };
                    }
                    newmove = `>${dir.toLowerCase()}`;
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        if (this.gameover) {
            result.message = i18next.t("apgames:MOVES_GAMEOVER");
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.forcedPass) {
                result.message = i18next.t("apgames:validation.carnac.FORCED_PASS");
            } else if (this.phase === "tip") {
                result.message = i18next.t("apgames:validation.carnac.TIP_OR_PASS");
            } else {
                result.message = i18next.t("apgames:validation.carnac.SELECT_ORIENTATION");
            }
            return result;
        }

        if (m === "pass") {
            if (this.forcedPass) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            if (this.phase !== "tip" || this.pending === null || this.validTipDirections(this.pending).length === 0) {
                result.message = i18next.t("apgames:validation.carnac.INVALID_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (m.startsWith(">")) {
            if (this.phase !== "tip" || this.pending === null || this.forcedPass) {
                result.message = i18next.t("apgames:validation.carnac.NOT_TIP_PHASE");
                return result;
            }
            const dir = m.substring(1).toUpperCase() as TipDir;
            if (!TIP_DIRS.includes(dir)) {
                result.message = i18next.t("apgames:validation.carnac.INVALID_TIP", { move: m });
                return result;
            }
            if (!this.validTipDirections(this.pending).includes(dir)) {
                result.message = i18next.t("apgames:validation.carnac.INVALID_TIP", { move: m });
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (this.phase !== "place" || this.forcedPass) {
            result.message = i18next.t("apgames:validation.carnac.NOT_PLACE_PHASE");
            return result;
        }

        const parts = m.split("-");
        if (parts.length === 1) {
            if (!ORIENTS.includes(parts[0] as Orient)) {
                result.message = i18next.t("apgames:validation.carnac.INVALID_ORIENTATION", { orient: parts[0] });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.carnac.SELECT_CELL");
            return result;
        }

        if (parts.length !== 2) {
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }

        const [orient, cell] = parts as [Orient, string];
        if (!ORIENTS.includes(orient)) {
            result.message = i18next.t("apgames:validation.carnac.INVALID_ORIENTATION", { orient });
            return result;
        }
        try {
            this.algebraic2coords(cell);
        } catch {
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
            return result;
        }
        if (!this.isEmpty(cell)) {
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: cell });
            return result;
        }
        if (this.reserve <= 0) {
            result.message = i18next.t("apgames:validation.carnac.NO_RESERVE");
            return result;
        }
        if (!this.validOrientsForCell(cell).includes(orient)) {
            result.message = i18next.t("apgames:validation.carnac.INVALID_HOLE_ORIENTATION", { orient, where: cell });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private executePlacement(orient: Orient, cell: string): void {
        this.board.set(cell, { kind: "stand", orient });
        this.reserve--;
        this.results.push({ type: "place", where: cell, what: orient });
        this.pending = { cell, orient, top: this.topColor(orient), placer: this.currplayer };
        this.lastmove = `${orient}-${cell}`;
    }

    private executeTip(dir: TipDir): void {
        if (this.pending === null) {
            throw new Error("No pending megalith to tip.");
        }
        const orient = this.pending.orient;
        const targets = this.tipTargets(this.pending.cell, dir)!;
        const [near, far] = targets;
        this.board.delete(this.pending.cell);
        this.board.set(near, { kind: "lie", orient, tipDir: dir, slot: "near" });
        this.board.set(far, { kind: "lie", orient, tipDir: dir, slot: "far" });
        this.results.push({ type: "move", from: this.pending.cell, to: `${near},${far}`, how: dir });
        const placer = this.pending.placer;
        this.pending = null;
        this.lastmove = `>${dir.toLowerCase()}`;
        this.phase = "place";
        this.currplayer = placer;
        this.forcedPass = true;
    }

    private afterPlacement(): void {
        if (this.pending === null) {
            return;
        }
        const opponent = (this.pending.placer === 1 ? 2 : 1) as playerid;
        const tips = this.validTipDirections(this.pending);
        if (tips.length > 0) {
            this.phase = "tip";
            this.currplayer = opponent;
            this.forcedPass = false;
        } else {
            this.phase = "place";
            this.currplayer = opponent;
            this.forcedPass = false;
            this.pending = null;
        }
    }

    public move(m: string, { trusted = false, partial = false } = {}): CarnacGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        if (partial || m.length === 0) {
            return this;
        }

        this.results = [];

        if (m === "pass") {
            if (this.forcedPass) {
                this.results.push({ type: "pass", why: "forced" });
                this.forcedPass = false;
                this.currplayer = (this.currplayer === 1 ? 2 : 1) as playerid;
            } else if (this.phase === "tip" && this.pending !== null) {
                const placer = this.pending.placer;
                this.results.push({ type: "pass" });
                this.pending = null;
                this.phase = "place";
                this.currplayer = placer;
            } else {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.carnac.INVALID_PASS"));
            }
            this.lastmove = "pass"
        } else if (m.startsWith(">")) {
            this.executeTip(m.substring(1).toUpperCase() as TipDir);
        } else {
            const [orient, cell] = m.split("-") as [Orient, string];
            this.executePlacement(orient, cell);
            this.afterPlacement();
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CarnacGame {
        const noPlace = !this.canPlace();
        if (this.reserve === 0 || noPlace) {
            this.gameover = true;
            const sizes = this.dolmenComponents();
            const p1 = sizes.get(1)!;
            const p2 = sizes.get(2)!;
            const cmp = this.compareDolmenScores(p1, p2);
            if (cmp > 0) {
                this.winner = [1];
            } else if (cmp < 0) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ICarnacState {
        return {
            game: CarnacGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CarnacGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            board: new Map(this.board),
            phase: this.phase,
            pending: this.pending ? { ...this.pending } : null,
            forcedPass: this.forcedPass,
            reserve: this.reserve,
            lastmove: this.lastmove,
        };
    }

    /** Deterministic legend id for a cube face set (N=S, E=W; valid HTML selector). */
    private cubeFacesLegendId(faces: IsoCubeFaces): string {
        return `C${faces.top}${faces.north}${faces.south}${faces.east}${faces.west}`;
    }

    private registerCubeLegend(legend: IsoLegend, faces: IsoCubeFaces, scale = 1): string {
        const id = this.cubeFacesLegendId(faces);
        if (legend[id] === undefined) {
            legend[id] = { piece: "cube", faces, scale };
        }
        return id;
    }

    private cubeGlyph(colour: playerid): string {
        return colour === 1 ? "C1" : "C2";
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        let perspective: number | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
            perspective = opts.perspective;
        }
        let isIso = true;
        if (altDisplay === "flat") {
            isIso = false;
        } else if (altDisplay !== undefined && altDisplay.startsWith("isometric")) {
            isIso = true;
        }

        const cubeFlat = (colour: playerid, scale = 1): Glyph => ({
            name: "piece-square",
            colour,
            scale,
        });

        const pstr: string[][][] = [];
        let myLegend: FlatLegend | IsoLegend;
        if (isIso) {
            myLegend = {} as IsoLegend;
        } else {
            myLegend = {
                C1: cubeFlat(1),
                C2: cubeFlat(2),
            } as FlatLegend;
        }

        for (let row = 0; row < this.height; row++) {
            const rowPieces: string[][] = [];
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                if (!this.board.has(cell)) {
                    rowPieces.push([]);
                } else {
                    const piece = this.board.get(cell)!;
                    if (isIso) {
                        if (piece.kind === "stand") {
                            const faces = this.keyCubeFaces(piece.orient);
                            const id = this.registerCubeLegend(myLegend as IsoLegend, faces);
                            rowPieces.push([id, id]);
                        } else {
                            const faces = this.lyingCubeFaces(piece.orient, piece.tipDir);
                            const id = this.registerCubeLegend(myLegend as IsoLegend, faces);
                            rowPieces.push([id]);
                        }
                    } else {
                        rowPieces.push([this.cubeGlyph(this.pieceTopColour(piece))]);
                    }
                }
            }
            pstr.push(rowPieces);
        }

        let rep: APRenderRep;
        if (isIso) {
            rep = {
                renderer: "isometric",
                board: {
                    style: "squares",
                    width: this.width,
                    height: this.height,
                },
                legend: myLegend,
                pieces: pstr as [string[][], ...string[][][]],
            };
        } else {
            let flatPstr = "";
            for (const row of pstr) {
                if (flatPstr.length > 0) {
                    flatPstr += "\n";
                }
                flatPstr += row.map(cell => {
                    if (cell.length === 0) {
                        return "-";
                    }
                    return cell[cell.length - 1];
                }).join(",");
            }
            rep = {
                board: {
                    style: "squares-checkered",
                    width: this.width,
                    height: this.height,
                },
                legend: myLegend,
                pieces: flatPstr,
            };
        }

        const showPlacementKey = this.phase === "place" && !this.forcedPass && !this.gameover
            && perspective !== undefined && perspective === this.currplayer;

        if (showPlacementKey) {
            const keyOrients: [string, string, Orient][] = isIso
                ? [
                    ["K1", "11", "11"],
                    ["K2", "12", "12"],
                    ["K3", "21", "21"],
                    ["K4", "22", "22"],
                ]
                : [
                    ["K1", "1", "11"],
                    ["K2", "2", "21"],
                ];
            const key: AreaKey = {
                type: "key",
                position: "left",
                height: isIso ? 0.7 : 0.4,
                list: keyOrients.map(([piece, name, value]) => ({ piece, name, value })),
                clickable: true,
            };
            rep.areas = [key];
            for (const [keyLabel, , orient] of keyOrients) {
                if (isIso) {
                    const faces = this.keyCubeFaces(orient);
                    (myLegend as IsoLegend)[keyLabel] = {
                        piece: "cube",
                        faces,
                        scale: 0.9,
                    };
                } else {
                    (myLegend as FlatLegend)[keyLabel] = cubeFlat(this.topColor(orient), 0.85);
                }
            }
        }

        if (this.pending !== null && this.phase === "tip") {
            const [x, y] = this.algebraic2coords(this.pending.cell);
            if (rep.annotations === undefined) {
                rep.annotations = [];
            }
            rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
        }

        if (this.results.length > 0) {
            if (rep.annotations === undefined) {
                rep.annotations = [];
            }
            for (const r of this.results) {
                if (r.type === "place") {
                    const [x, y] = this.algebraic2coords(r.where!);
                    if (isIso) {
                        const marker: MarkerDots = {
                            type: "dots",
                            points: [{row: y, col: x}],
                            colour: {
                                func: "bestContrast",
                                bg: "_context_board",
                                fg: ["#00aa00", "#ffffff"],
                            },
                            opacity: 0.55,
                            size: 0.35,
                        };
                        (rep.board as BoardBasic).markers = [...((rep.board as BoardBasic).markers ?? []), marker];
                    } else {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                } else if (r.type === "move" && r.how !== undefined) {
                    const [near, far] = r.to.split(",");
                    const [nx, ny] = this.algebraic2coords(near);
                    const [fx, fy] = this.algebraic2coords(far);
                    rep.annotations.push({ type: "move", targets: [{ row: ny, col: nx }, { row: fy, col: fx }] });
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place": {
                const orient = r.what as Orient;
                const { top, front } = this.parseOrient(orient);
                node.push(i18next.t("apresults:PLACE.carnac", { player, where: r.where, top, south: front }));
                resolved = true;
                break;
            }
            case "move":
                if (r.how !== undefined) {
                    node.push(i18next.t("apresults:MOVE.carnac_tip", { player, from: r.from, to: r.to, how: r.how }));
                    resolved = true;
                }
                break;
            case "pass":
                if (r.why === "forced") {
                    node.push(i18next.t("apresults:PASS.forced", { player }));
                } else {
                    node.push(i18next.t("apresults:PASS.carnac", { player }));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): CarnacGame {
        return new CarnacGame(this.serialize());
    }
}
