import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, IsoPiece, MarkerEdge } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { connectedComponents } from "graphology-components";
import { HexTriGraph, type HexDir } from "../common/graphs/hextri";

export type playerid = 1 | 2;
type Dir = "N" | "E" | "S" | "W";
type HexEdge = "N" | "NE" | "SE" | "S" | "SW" | "NW";
type LintelDir = Dir | HexDir;
type BoardMode = "rect" | "y" | "hex";

const DIRS: Dir[] = ["N", "E", "S", "W"];
const HEX_LINTEL_DIRS: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];
const HEX_WIN_EDGE_SETS: [HexEdge, HexEdge, HexEdge][] = [
    ["N", "SE", "SW"],
    ["NE", "S", "NW"],
];
const CUBE_HEIGHT = 50;
const HEX_SCALE = 1.1765;

type Stone =
    | { kind: "sarsen"; owner: playerid }
    | { kind: "spacer" }
    | { kind: "lintel"; owner: playerid; id: string; segment: 0 | 1 | 2; dir: LintelDir };

type FlatLegend = {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
};
type IsoLegend = {
    [key: string]: IsoPiece;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    stacks: Map<string, Stone[]>;
    druid: { 1?: string; 2?: string };
    druidSpawnEdge: { 1?: Dir; 2?: Dir };
    passCount: number;
    nextLintelId: number;
    connPath: string[];
    lastmove?: string;
}

export interface IDruidState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class DruidGame extends GameBase {
    // private static readonly PREV_VERSION = "20260706";
    private static readonly SIDES_INVERTED_SINCE = "20260815";

    public static readonly gameinfo: APGamesInformation = {
        name: "Druid",
        uid: "druid",
        playercounts: [2],
        // version: "20260706",
        version: "20260815",
        dateAdded: "2026-08-03",
        description: "apgames:descriptions.druid",
        notes: "apgames:notes.druid",
        urls: [
            "https://cambolbro.com/games/druid/",
            "https://web.archive.org/web/20250712151400/http://www.gamerz.net/pbmserv/druid.html",
            "https://boardgamegeek.com/boardgame/11748/druid",
        ],
        bggid: "11748",
        people: [
            {
                type: "designer",
                name: "Cameron Browne",
                urls: ["http://cambolbro.com/"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "size-8", group: "board" },
            { uid: "#board" },
            { uid: "size-12", group: "board" },
            { uid: "y-7", group: "board" },
            { uid: "y-8", group: "board" },
            { uid: "y-9", group: "board" },
            { uid: "hex-4", group: "board" },
            { uid: "hex-5", group: "board" },
            { uid: "hex-6", group: "board" },
            { uid: "walk", group: "ruleset" },
        ],
        displays: [{ uid: "flat" }],
        categories: ["goal>connect", "mechanic>place", "mechanic>move", "board>3d", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["pie", "automove"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public stacks!: Map<string, Stone[]>;
    public druid: { 1?: string; 2?: string } = {};
    public druidSpawnEdge: { 1?: Dir; 2?: Dir } = {};
    public passCount = 0;
    public nextLintelId = 1;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public width = 10;
    public height = 10;
    public boardSize = 10;
    public hexGraph?: HexTriGraph;
    public lastmove?: string;

    constructor(state?: IDruidState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = [...variants];
            }
            this.sanitizeVariants();
            const fresh: IMoveState = {
                _version: DruidGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                stacks: new Map(),
                druid: {},
                druidSpawnEdge: {},
                passCount: 0,
                nextLintelId: 1,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDruidState;
            }
            if (state.game !== DruidGame.gameinfo.uid) {
                throw new Error(`The Druid engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.sanitizeVariants();
        this.configureBoard();
        this.load();
    }

    /** Must match `reverse-letters` in `render()` for hex boards. */
    private hexReverseLetters(): boolean {
        return this.boardMode() === "y";
    }

    private boardMode(): BoardMode {
        if (this.variants.some(v => v.startsWith("y-"))) {
            return "y";
        }
        if (this.variants.some(v => v.startsWith("hex-"))) {
            return "hex";
        }
        return "rect";
    }

    /** Druid's Walk applies only to the rectangular board. */
    private sanitizeVariants(): void {
        if (this.boardMode() !== "rect") {
            this.variants = this.variants.filter(v => v !== "walk");
        }
    }

    private isWalk(): boolean {
        return this.boardMode() === "rect" && this.variants.includes("walk");
    }

    private rectSidesInverted(): boolean {
        return this.boardMode() === "rect"
            && parseInt(this.stack[0]._version, 10) >= parseInt(DruidGame.SIDES_INVERTED_SINCE, 10);
    }

    private rectPlayerConnectsHorizontal(player: playerid): boolean {
        const legacy = player === 1;
        return this.rectSidesInverted() ? !legacy : legacy;
    }

    private configureBoard(): void {
        this.hexGraph = undefined;
        const mode = this.boardMode();
        if (mode === "y") {
            let size = 8;
            if (this.variants.includes("y-7")) {
                size = 7;
            } else if (this.variants.includes("y-9")) {
                size = 9;
            }
            this.boardSize = size;
            const g = new HexTriGraph(1, size);
            g.reverseLetters = this.hexReverseLetters();
            this.hexGraph = g;
            this.width = size;
            this.height = g.height;
            return;
        }
        if (mode === "hex") {
            let size = 5;
            if (this.variants.includes("hex-4")) {
                size = 4;
            } else if (this.variants.includes("hex-6")) {
                size = 6;
            }
            this.boardSize = size;
            this.hexGraph = new HexTriGraph(size, size * 2 - 1);
            this.width = size * 2 - 1;
            this.height = this.hexGraph.height;
            return;
        }
        if (this.variants.includes("size-8")) {
            this.width = 8;
            this.height = 8;
        } else if (this.variants.includes("size-12")) {
            this.width = 12;
            this.height = 12;
        } else {
            this.width = 10;
            this.height = 10;
        }
        this.boardSize = this.width;
    }

    private listAllCells(): string[] {
        if (this.hexGraph !== undefined) {
            return (this.hexGraph.listCells() as string[]).filter(c => this.isOnBoard(c));
        }
        const cells: string[] = [];
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                cells.push(this.coords2algebraic(col, row));
            }
        }
        return cells;
    }

    /** Whether `cell` belongs to the active board topology. */
    private isOnBoard(cell: string): boolean {
        try {
            const [x, y] = this.algebraic2coords(cell);
            if (this.boardMode() === "y") {
                return y < this.boardSize && x <= y;
            }
            if (this.hexGraph !== undefined) {
                return this.hexGraph.graph.hasNode(cell);
            }
            return x >= 0 && x < this.width && y >= 0 && y < this.height;
        } catch {
            return false;
        }
    }

    public coords2algebraic(x: number, y: number): string {
        if (this.hexGraph !== undefined) {
            return this.hexGraph.coords2algebraic(x, y);
        }
        return GameBase.coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        if (this.hexGraph !== undefined) {
            return this.hexGraph.algebraic2coords(cell);
        }
        return GameBase.algebraic2coords(cell, this.height);
    }

    public load(idx = -1): DruidGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        this.configureBoard();

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.stacks = new Map(state.stacks);
        this.druid = { ...state.druid };
        this.druidSpawnEdge = { ...(state.druidSpawnEdge ?? {}) };
        for (const player of [1, 2] as playerid[]) {
            if (this.druid[player] !== undefined && this.druidSpawnEdge[player] === undefined) {
                const edge = this.spawnEdgeAt(this.druid[player]!, player);
                if (edge !== undefined) {
                    this.druidSpawnEdge[player] = edge;
                }
            }
        }
        this.passCount = state.passCount;
        this.nextLintelId = state.nextLintelId;
        this.connPath = [...(state.connPath ?? [])];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    private inBounds(x: number, y: number): boolean {
        if (this.hexGraph !== undefined) {
            try {
                return this.isOnBoard(this.coords2algebraic(x, y));
            } catch {
                return false;
            }
        }
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    private boardStep(x: number, y: number, dir: Dir, dist: number): [number, number] {
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

    private stackAt(cell: string): Stone[] {
        return this.stacks.get(cell) ?? [];
    }

    /** Topmost stone on a cell (sarsen or lintel segment), if any. */
    private topStone(cell: string): Stone | undefined {
        const stack = this.stackAt(cell);
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].kind !== "spacer") {
                return stack[i];
            }
        }
        return undefined;
    }

    /** Colour of the topmost stone on a cell (undefined if bare ground). */
    public topColour(cell: string): playerid | undefined {
        const top = this.topStone(cell);
        if (top === undefined || top.kind === "spacer") {
            return undefined;
        }
        return top.owner;
    }

    /** Whether a Druid may step onto `cell` (topmost stone must be friendly; no bare gaps). */
    private canDruidStepTo(cell: string, player: playerid): boolean {
        if (this.hasDruid(cell)) {
            return false;
        }
        const top = this.topStone(cell);
        return top !== undefined && top.kind !== "spacer" && top.owner === player;
    }

    private hasDruid(cell: string): boolean {
        return this.druid[1] === cell || this.druid[2] === cell;
    }

    private oppositeEdge(edge: Dir): Dir {
        switch (edge) {
            case "N":
                return "S";
            case "S":
                return "N";
            case "E":
                return "W";
            case "W":
                return "E";
        }
    }

    /** Which of the player's edges (if any) this cell lies on. */
    private spawnEdgeAt(cell: string, player: playerid): Dir | undefined {
        if (this.rectPlayerConnectsHorizontal(player)) {
            if (this.onEdge(cell, "W")) {
                return "W";
            }
            if (this.onEdge(cell, "E")) {
                return "E";
            }
        } else {
            if (this.onEdge(cell, "N")) {
                return "N";
            }
            if (this.onEdge(cell, "S")) {
                return "S";
            }
        }
        return undefined;
    }

    private druidExitEdge(player: playerid): Dir | undefined {
        const spawn = this.druidSpawnEdge[player];
        return spawn === undefined ? undefined : this.oppositeEdge(spawn);
    }

    private canBearOff(player: playerid, from: string): boolean {
        if (this.druid[player] !== from) {
            return false;
        }
        const exit = this.druidExitEdge(player);
        return exit !== undefined && this.onEdge(from, exit);
    }

    private onEdge(cell: string, edge: Dir): boolean {
        const [x, y] = this.algebraic2coords(cell);
        switch (edge) {
            case "N":
                return y === 0;
            case "S":
                return y === this.height - 1;
            case "E":
                return x === this.width - 1;
            case "W":
                return x === 0;
        }
    }

    private edgeLines(player: playerid): [string[], string[]] {
        const sources: string[] = [];
        const targets: string[] = [];
        if (this.rectPlayerConnectsHorizontal(player)) {
            for (let y = 0; y < this.height; y++) {
                sources.push(this.coords2algebraic(0, y));
                targets.push(this.coords2algebraic(this.width - 1, y));
            }
        } else {
            for (let x = 0; x < this.width; x++) {
                sources.push(this.coords2algebraic(x, 0));
                targets.push(this.coords2algebraic(x, this.height - 1));
            }
        }
        return [sources, targets];
    }

    private edgeMarkers(): MarkerEdge[] {
        if (this.rectSidesInverted()) {
            return [
                { type: "edge", edge: "E", colour: 2 },
                { type: "edge", edge: "W", colour: 2 },
                { type: "edge", edge: "N", colour: 1 },
                { type: "edge", edge: "S", colour: 1 },
            ];
        }
        return [
            { type: "edge", edge: "E", colour: 1 },
            { type: "edge", edge: "W", colour: 1 },
            { type: "edge", edge: "N", colour: 2 },
            { type: "edge", edge: "S", colour: 2 },
        ];
    }

    private oppositeHexDir(dir: HexDir): HexDir {
        switch (dir) {
            case "NE":
                return "SW";
            case "E":
                return "W";
            case "SE":
                return "NW";
            case "SW":
                return "NE";
            case "W":
                return "E";
            case "NW":
                return "SE";
        }
    }

    private isRectDir(dir: LintelDir): dir is Dir {
        return dir === "N" || dir === "E" || dir === "S" || dir === "W";
    }

    private hexLintelSuffix(dir: HexDir, segment: 0 | 1 | 2): string {
        const compass: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];
        const undrawn: HexDir[] = [];
        if (segment === 0) {
            undrawn.push(dir);
        } else if (segment === 2) {
            undrawn.push(this.oppositeHexDir(dir));
        } else {
            undrawn.push(dir, this.oppositeHexDir(dir));
        }
        undrawn.sort((a, b) => compass.indexOf(a) - compass.indexOf(b));
        return undrawn.join("_");
    }

    private hexLintelPiece(dir: HexDir, segment: 0 | 1 | 2): string {
        return `lintelp_${this.hexLintelSuffix(dir, segment)}`;
    }

    private yEdgeSets(): string[][] {
        const left: string[] = [];
        const right: string[] = [];
        const bottom: string[] = [];
        for (const cell of this.listAllCells()) {
            const [x, y] = this.algebraic2coords(cell);
            if (x === 0) {
                left.push(cell);
            }
            if (x === y) {
                right.push(cell);
            }
            if (y === this.boardSize - 1) {
                bottom.push(cell);
            }
        }
        return [left, right, bottom];
    }

    private playerConnectsEdges(graph: UndirectedGraph, edgeSets: string[][]): boolean {
        for (const comp of connectedComponents(graph)) {
            let connected = true;
            for (const edge of edgeSets) {
                if (!edge.some(c => graph.hasNode(c) && comp.includes(c))) {
                    connected = false;
                    break;
                }
            }
            if (connected) {
                return true;
            }
        }
        return false;
    }

    private static readonly HEX_EDGES: HexEdge[] = ["N", "NE", "SE", "S", "SW", "NW"];

    private hexEdgeReason(triple: [HexEdge, HexEdge, HexEdge]): string {
        return triple.join(",");
    }

    private parseHexEdgeReason(reason: string): HexEdge[] | undefined {
        const parts = reason.split(",");
        if (parts.length !== 3) {
            return undefined;
        }
        if (!parts.every(p => DruidGame.HEX_EDGES.includes(p as HexEdge))) {
            return undefined;
        }
        return parts as HexEdge[];
    }

    private hexEdgeListLabel(edges: HexEdge[]): string {
        const labels = edges.map(e => i18next.t(`apresults:DRUID_HEX_EDGE.${e}`));
        if (labels.length <= 1) {
            return labels.join("");
        }
        if (labels.length === 2) {
            return `${labels[0]} ${i18next.t("apresults:DRUID_HEX_EDGE.and")} ${labels[1]}`;
        }
        return `${labels.slice(0, -1).join(", ")}, ${i18next.t("apresults:DRUID_HEX_EDGE.and")} ${labels[labels.length - 1]}`;
    }

    private permute<T>(items: T[]): T[][] {
        if (items.length <= 1) {
            return [[...items]];
        }
        const result: T[][] = [];
        for (let i = 0; i < items.length; i++) {
            const rest = [...items.slice(0, i), ...items.slice(i + 1)];
            for (const tail of this.permute(rest)) {
                result.push([items[i], ...tail]);
            }
        }
        return result;
    }

    private cartesianProduct(arrays: string[][]): string[][] {
        return arrays.reduce<string[][]>(
            (acc, curr) => acc.flatMap(prefix => curr.map(item => [...prefix, item])),
            [[]],
        );
    }

    /** Join two cell paths, overlapping at the junction when they share cells. */
    private mergePaths(a: string[], b: string[]): string[] {
        if (a.length === 0) {
            return [...b];
        }
        if (b.length === 0) {
            return [...a];
        }
        const maxOverlap = Math.min(a.length, b.length);
        for (let overlap = maxOverlap; overlap > 0; overlap--) {
            let match = true;
            for (let i = 0; i < overlap; i++) {
                if (a[a.length - overlap + i] !== b[i]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return [...a, ...b.slice(overlap)];
            }
        }
        return [...a, ...b];
    }

    /** Shortest witness path touching one cell on each edge set within a winning component. */
    private recordConnPath(graph: UndirectedGraph, edgeSets: string[][]): void {
        let bestPath: string[] = [];
        for (const comp of connectedComponents(graph)) {
            const touchCandidates = edgeSets.map(edge =>
                edge.filter(c => graph.hasNode(c) && comp.includes(c)),
            );
            if (touchCandidates.some(candidates => candidates.length === 0)) {
                continue;
            }
            for (const perm of this.permute(touchCandidates.map((_, i) => i))) {
                const ordered = perm.map(i => touchCandidates[i]);
                for (const cells of this.cartesianProduct(ordered)) {
                    let path: string[] = [];
                    let valid = true;
                    for (let i = 0; i < cells.length; i++) {
                        if (i === 0) {
                            path = [cells[0]];
                            continue;
                        }
                        const seg = bidirectional(graph, cells[i - 1], cells[i]);
                        if (seg === null) {
                            valid = false;
                            break;
                        }
                        path = this.mergePaths(path, seg);
                    }
                    if (valid && (bestPath.length === 0 || path.length < bestPath.length)) {
                        bestPath = path;
                    }
                }
            }
            if (bestPath.length > 0) {
                this.connPath = bestPath;
                return;
            }
        }
    }

    private lintelCellsHex(endA: string, endB: string): [string, string, string] | undefined {
        const g = this.hexGraph!;
        const dir = g.bearing(endA, endB);
        if (dir === undefined) {
            return undefined;
        }
        const [ax, ay] = g.algebraic2coords(endA);
        const ray = g.ray(ax, ay, dir, true).map(([x, y]) => g.coords2algebraic(x, y));
        const idxA = ray.indexOf(endA);
        const idxB = ray.indexOf(endB);
        if (idxA === -1 || idxB === -1 || Math.abs(idxA - idxB) !== 2) {
            return undefined;
        }
        const lo = Math.min(idxA, idxB);
        const near = ray[lo];
        const mid = ray[lo + 1];
        const far = ray[lo + 2];
        const d = g.bearing(near, far)!;
        let cells: [string, string, string];
        if (d === "W" || d === "SW" || d === "NW") {
            cells = [far, mid, near];
        } else {
            cells = [near, mid, far];
        }
        if (!cells.every(c => this.isOnBoard(c))) {
            return undefined;
        }
        return cells;
    }

    private lintelCells(endA: string, endB: string): [string, string, string] | undefined {
        if (this.hexGraph !== undefined) {
            return this.lintelCellsHex(endA, endB);
        }
        const [ax, ay] = this.algebraic2coords(endA);
        const [bx, by] = this.algebraic2coords(endB);
        let dir: Dir | undefined;
        if (ax === bx && ay !== by) {
            dir = by < ay ? "N" : "S";
        } else if (ay === by && ax !== bx) {
            dir = bx > ax ? "E" : "W";
        } else {
            return undefined;
        }
        const [mx, my] = this.boardStep(ax, ay, dir, 1);
        const far = this.coords2algebraic(bx, by);
        const near = this.coords2algebraic(ax, ay);
        const mid = this.coords2algebraic(mx, my);
        const [fx, fy] = this.algebraic2coords(far);
        if (!this.inBounds(mx, my) || !this.inBounds(fx, fy)) {
            return undefined;
        }
        const [ex, ey] = this.boardStep(ax, ay, dir, 2);
        if (ex !== bx || ey !== by) {
            return undefined;
        }
        if (dir === "W" || dir === "S") {
            return [far, mid, near];
        }
        return [near, mid, far];
    }

    private lintelDir(cells: [string, string, string]): LintelDir {
        if (this.hexGraph !== undefined) {
            return this.hexGraph.bearing(cells[0], cells[2])!;
        }
        const [a, , c] = cells;
        const [ax, ay] = this.algebraic2coords(a);
        const [cx, cy] = this.algebraic2coords(c);
        if (ax === cx) {
            return cy < ay ? "N" : "S";
        }
        return cx > ax ? "E" : "W";
    }

    private normalizeLintelEnds(endA: string, endB: string): [string, string] {
        return endA.localeCompare(endB) <= 0 ? [endA, endB] : [endB, endA];
    }

    private lintelNotation(endA: string, endB: string): string {
        const [a, b] = this.normalizeLintelEnds(endA, endB);
        return `${a}+${b}`;
    }

    /** Canonicalize completed lintel moves (`a1+c3` regardless of entry order). */
    private normalizeMove(m: string): string {
        const plus = m.indexOf("+");
        if (plus === -1) {
            return m;
        }
        const endA = m.substring(0, plus);
        const endB = m.substring(plus + 1);
        if (endA.length < 2 || endB.length < 2) {
            return m;
        }
        try {
            this.algebraic2coords(endA);
            this.algebraic2coords(endB);
        } catch {
            return m;
        }
        return this.lintelNotation(endA, endB);
    }

    /** Friendly stones directly under the new lintel (one per cell at index endHeight - 1). */
    private countLintelSupports(cells: string[], player: playerid, endHeight: number): number {
        const supportIdx = endHeight - 1;
        if (supportIdx < 0) {
            return 0;
        }
        let count = 0;
        for (const cell of cells) {
            const stack = this.stackAt(cell);
            if (supportIdx < stack.length) {
                const stone = stack[supportIdx];
                if (stone.kind !== "spacer" && stone.owner === player) {
                    count++;
                }
            }
        }
        return count;
    }

    private stackHeight(cell: string): number {
        return this.stackAt(cell).length;
    }

    private endSupported(cell: string): boolean {
        return this.stackHeight(cell) > 0;
    }

    /** True when a new lintel middle at endHeight would pass through the gap under an existing lintel. */
    private wouldThreadThroughLintelGap(mid: string, endHeight: number): boolean {
        const stack = this.stackAt(mid);
        for (let i = 0; i < stack.length; i++) {
            if (stack[i].kind === "lintel" && endHeight <= i) {
                return true;
            }
        }
        return false;
    }

    private canPlaceLintel(endA: string, endB: string, player: playerid): boolean {
        const cells = this.lintelCells(endA, endB);
        if (cells === undefined) {
            return false;
        }
        for (const cell of cells) {
            if (!this.isOnBoard(cell) || this.hasDruid(cell)) {
                return false;
            }
        }
        const [end0, mid, end2] = cells;
        if (!this.endSupported(end0) || !this.endSupported(end2)) {
            return false;
        }
        const endHeight = this.stackHeight(end0);
        if (this.stackHeight(end2) !== endHeight) {
            return false;
        }
        const midHeight = this.stackHeight(mid);
        if (midHeight > endHeight) {
            return false;
        }
        if (this.wouldThreadThroughLintelGap(mid, endHeight)) {
            return false;
        }
        if (this.countLintelSupports(cells, player, endHeight) !== 2) {
            return false;
        }
        return true;
    }

    private canPlaceSarsen(cell: string, player: playerid): boolean {
        if (!this.isOnBoard(cell)) {
            return false;
        }
        if (this.hasDruid(cell)) {
            return false;
        }
        const stack = this.stackAt(cell);
        if (stack.length === 0) {
            return true;
        }
        const top = stack[stack.length - 1];
        return top.kind !== "spacer" && top.owner === player;
    }

    private lintelsAtEnd(cell: string, player: playerid): string[] {
        return this.allLintelPlacements(player).filter(m => {
            const plus = m.indexOf("+");
            const endA = m.substring(0, plus);
            const endB = m.substring(plus + 1);
            return endA === cell || endB === cell;
        });
    }

    private druidMoves(player: playerid): string[] {
        if (!this.isWalk()) {
            return [];
        }
        const from = this.druid[player];
        if (from === undefined) {
            return [];
        }
        const moves: string[] = [];
        const [x, y] = this.algebraic2coords(from);
        for (const dir of DIRS) {
            const [xn, yn] = this.boardStep(x, y, dir, 1);
            if (!this.inBounds(xn, yn)) {
                continue;
            }
            const to = this.coords2algebraic(xn, yn);
            if (this.canDruidStepTo(to, player)) {
                moves.push(`${from}-${to}`);
            }
        }
        if (this.canBearOff(player, from)) {
            moves.push(`${from}-off`);
        }
        return moves;
    }

    private allSarsenPlacements(player: playerid): string[] {
        const cells: string[] = [];
        for (const cell of this.listAllCells()) {
            if (this.canPlaceSarsen(cell, player)) {
                cells.push(cell);
            }
        }
        return cells;
    }

    private allLintelPlacements(player: playerid): string[] {
        const moves = new Set<string>();
        if (this.hexGraph !== undefined) {
            for (const cell of this.listAllCells()) {
                const [x, y] = this.algebraic2coords(cell);
                for (const dir of HEX_LINTEL_DIRS) {
                    const step2 = this.hexGraph.move(x, y, dir, 2);
                    if (step2 === undefined) {
                        continue;
                    }
                    const endB = this.coords2algebraic(...step2);
                    if (this.canPlaceLintel(cell, endB, player)) {
                        moves.add(this.lintelNotation(cell, endB));
                    }
                }
            }
            return [...moves];
        }
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                for (const dir of ["E", "N"] as Dir[]) {
                    const [x2, y2] = this.boardStep(col, row, dir, 2);
                    if (!this.inBounds(x2, y2)) {
                        continue;
                    }
                    const endA = this.coords2algebraic(col, row);
                    const endB = this.coords2algebraic(x2, y2);
                    if (this.canPlaceLintel(endA, endB, player)) {
                        moves.add(this.lintelNotation(endA, endB));
                    }
                }
            }
        }
        return [...moves];
    }

    private placementMoves(player: playerid): string[] {
        const moves: string[] = [];
        for (const cell of this.allSarsenPlacements(player)) {
            moves.push(cell);
        }
        moves.push(...this.allLintelPlacements(player));
        return moves;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const player = this.currplayer;
        const moves = [...this.placementMoves(player), ...this.druidMoves(player), "pass"];
        return moves;
    }

    /** Whether `m` is a prefix of or equal to a legal move. */
    private moveMatches(partial: string, m: string): boolean {
        if (m === partial) {
            return true;
        }
        if (partial.includes("+")) {
            return false;
        }
        if (partial.includes("-")) {
            return m.startsWith(partial);
        }
        return m.startsWith(`${partial}+`) || m.startsWith(`${partial}-`) || m.endsWith(`+${partial}`);
    }

    private matchingMoves(partial: string): string[] {
        return this.moves().filter(m => this.moveMatches(partial, m));
    }

    private parseMove(m: string):
        | { kind: "pass" }
        | { kind: "sarsen"; cell: string }
        | { kind: "lintel"; endA: string; endB: string }
        | { kind: "druid"; from: string; to: string }
        | undefined {
        if (m === "pass" || m === "--") {
            return { kind: "pass" };
        }
        const plus = m.indexOf("+");
        if (plus !== -1) {
            const [endA, endB] = [m.substring(0, plus), m.substring(plus + 1)];
            if (endA.length === 0 || endB.length === 0) {
                return undefined;
            }
            const [a, b] = this.normalizeLintelEnds(endA, endB);
            return { kind: "lintel", endA: a, endB: b };
        }
        const dash = m.indexOf("-");
        if (dash !== -1) {
            const from = m.substring(0, dash);
            const to = m.substring(dash + 1);
            if (from.length === 0 || to.length === 0) {
                return undefined;
            }
            return { kind: "druid", from, to };
        }
        if (m.length >= 2) {
            return { kind: "sarsen", cell: m };
        }
        return undefined;
    }

    private isDruidMovePrefix(m: string): boolean {
        if (!this.isWalk()) {
            return false;
        }
        const from = this.druid[this.currplayer];
        if (from === undefined) {
            return false;
        }
        return m === from || m.startsWith(`${from}-`);
    }

    private clickBuildsMove(move: string, cell: string): string {
        if (move.length === 0) {
            return cell;
        }
        if (this.isDruidMovePrefix(move) || this.druid[this.currplayer] === move) {
            if (move === cell) {
                return cell;
            }
            const from = move.includes("-") ? move.split("-")[0] : move;
            return `${from}-${cell}`;
        }
        if (move.includes("+")) {
            return this.normalizeMove(move);
        }
        if (this.lintelCells(move, cell) !== undefined) {
            return this.lintelNotation(move, cell);
        }
        if (this.canPlaceSarsen(move, this.currplayer)) {
            return this.lintelNotation(move, cell);
        }
        return this.lintelNotation(move, cell);
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (piece === "_btn_pass") {
                return this.validateMove("pass") as IClickResult;
            }
            if (row < 0 || col < 0) {
                if (this.isWalk() && (this.isDruidMovePrefix(move) || this.druid[this.currplayer] === move)) {
                    const from = move.includes("-") ? move.split("-")[0] : move;
                    const newmove = `${from}-off`;
                    const result = this.validateMove(newmove) as IClickResult;
                    if (result.valid) {
                        result.move = newmove;
                    } else {
                        result.move = move;
                    }
                    return result;
                }
                const result = this.validateMove(move) as IClickResult;
                if (result.valid) {
                    result.move = move;
                }
                return result;
            }

            const cell = this.coords2algebraic(col, row);
            let newmove = move;

            if (this.isWalk() && this.druid[this.currplayer] === cell) {
                if (this.canBearOff(this.currplayer, cell)) {
                    const newmove = `${cell}-off`;
                    const result = this.validateMove(newmove) as IClickResult;
                    result.move = newmove;
                    return result;
                }
                newmove = cell;
            } else if (move.length === 0) {
                if (!this.canPlaceSarsen(cell, this.currplayer)) {
                    const result = this.validateMove(cell) as IClickResult;
                    result.move = "";
                    return result;
                }
                newmove = cell;
            } else if (this.isDruidMovePrefix(move)) {
                newmove = this.clickBuildsMove(move, cell);
            } else if (move.includes("+")) {
                newmove = this.normalizeMove(move);
            } else if (this.lintelCells(move, cell) !== undefined) {
                newmove = this.lintelNotation(move, cell);
            } else if (this.canPlaceSarsen(move, this.currplayer)) {
                newmove = this.lintelNotation(move, cell);
            } else {
                newmove = cell;
            }

            const matches = this.matchingMoves(newmove);
            if (matches.length === 1) {
                newmove = matches[0];
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
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
        m = this.normalizeMove(m);
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        if (this.gameover) {
            result.message = i18next.t("apgames:MOVES_GAMEOVER");
            return result;
        }

        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.druid.SELECT_MOVE");
            return result;
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            const player = this.currplayer;
            if (this.canPlaceSarsen(m, player) && this.lintelsAtEnd(m, player).length > 0) {
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.druid.SARSEN_OR_LINTEL");
            } else {
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
            return result;
        }

        const matches = this.matchingMoves(m);
        if (matches.length === 0) {
            const parsed = this.parseMove(m);
            if (parsed?.kind === "sarsen") {
                try {
                    this.algebraic2coords(parsed.cell);
                } catch {
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: parsed.cell });
                    return result;
                }
                if (!this.isOnBoard(parsed.cell)) {
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: parsed.cell });
                    return result;
                }
                if (!this.canPlaceSarsen(parsed.cell, this.currplayer)) {
                    result.message = i18next.t("apgames:validation.druid.INVALID_SARSEN", { where: parsed.cell });
                    return result;
                }
            }
            if (parsed?.kind === "lintel") {
                result.message = i18next.t("apgames:validation.druid.INVALID_LINTEL", { move: m });
                return result;
            }
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }

        result.valid = true;
        result.canrender = true;

        if (m.includes("+") || m.includes("-")) {
            result.complete = -1;
            if (m.includes("+")) {
                result.message = i18next.t("apgames:validation.druid.SELECT_LINTEL_END");
            } else {
                result.message = i18next.t("apgames:validation.druid.SELECT_DRUID_DEST");
            }
            return result;
        }

        const player = this.currplayer;
        if (this.isWalk() && this.druid[player] === m) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.druid.SELECT_DRUID_DEST");
            return result;
        }

        if (this.canPlaceSarsen(m, player)) {
            if (this.lintelsAtEnd(m, player).length > 0) {
                result.complete = 0;
                result.message = i18next.t("apgames:validation.druid.SARSEN_OR_LINTEL");
            } else {
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
            return result;
        }

        if (!m.includes("+")) {
            result.message = i18next.t("apgames:validation.druid.INVALID_SARSEN", { where: m });
            return result;
        }

        result.complete = -1;
        result.message = i18next.t("apgames:validation.druid.SELECT_LINTEL_END");
        return result;
    }

    private placeSarsen(cell: string, player: playerid): void {
        if (!this.isOnBoard(cell)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INVALIDCELL", { cell }));
        }
        const stack = [...this.stackAt(cell)];
        stack.push({ kind: "sarsen", owner: player });
        this.stacks.set(cell, stack);
        this.results.push({ type: "place", where: cell, what: "sarsen" });
        this.maybeSpawnDruid(cell, player);
    }

    private placeLintel(endA: string, endB: string, player: playerid): void {
        const cells = this.lintelCells(endA, endB)!;
        if (!this.canPlaceLintel(endA, endB, player)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.druid.INVALID_LINTEL", { move: this.lintelNotation(endA, endB) }));
        }
        const dir = this.lintelDir(cells);
        const id = `L${this.nextLintelId++}`;
        const endHeight = this.stackHeight(cells[0]);
        cells.forEach((cell, segment) => {
            const stack = [...this.stackAt(cell)];
            if (segment === 1) {
                for (let pad = endHeight - stack.length; pad > 0; pad--) {
                    stack.push({ kind: "spacer" });
                }
            }
            stack.push({ kind: "lintel", owner: player, id, segment: segment as 0 | 1 | 2, dir });
            this.stacks.set(cell, stack);
            this.maybeSpawnDruid(cell, player);
        });
        this.results.push({ type: "place", where: this.lintelNotation(endA, endB), what: "lintel" });
    }

    private maybeSpawnDruid(cell: string, player: playerid): void {
        if (!this.isWalk() || this.druid[player] !== undefined) {
            return;
        }
        const edge = this.spawnEdgeAt(cell, player);
        if (edge !== undefined) {
            this.druid[player] = cell;
            this.druidSpawnEdge[player] = edge;
            this.results.push({ type: "place", where: cell, what: "druid" });
        }
    }

    private moveDruid(player: playerid, dest: string): void {
        const from = this.druid[player];
        if (from === undefined) {
            throw new Error("No druid to move.");
        }
        if (!this.canDruidStepTo(dest, player)) {
            throw new Error("Invalid druid move.");
        }
        this.druid[player] = dest;
        this.results.push({ type: "move", from, to: dest });
    }

    private bearOffDruid(player: playerid, from: string): void {
        if (!this.canBearOff(player, from)) {
            throw new Error("Cannot bear off druid.");
        }
        delete this.druid[player];
        delete this.druidSpawnEdge[player];
        this.results.push({ type: "bearoff", from });
    }

    public move(m: string, { trusted = false, partial = false } = {}): DruidGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = this.normalizeMove(m);

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                if (result.complete === 1) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
                }
                partial = true;
            }
        }

        if (partial || m.length === 0) {
            return this;
        }

        this.results = [];
        const player = this.currplayer;
        const parsed = this.parseMove(m);

        if (parsed === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }));
        }

        if (parsed.kind === "pass") {
            this.results.push({ type: "pass" });
            this.passCount++;
            this.lastmove = "pass";
        } else if (parsed.kind === "sarsen") {
            this.placeSarsen(parsed.cell, player);
            this.passCount = 0;
            this.lastmove = m;
        } else if (parsed.kind === "lintel") {
            this.placeLintel(parsed.endA, parsed.endB, player);
            this.passCount = 0;
            this.lastmove = m;
        } else if (parsed.kind === "druid") {
            if (parsed.to === "off") {
                this.bearOffDruid(player, parsed.from);
            } else {
                this.moveDruid(player, parsed.to);
            }
            this.passCount = 0;
            this.lastmove = m;
        }

        this.checkEOG();
        if (!this.gameover) {
            this.currplayer = this.currplayer === 1 ? 2 : 1;
        }
        this.saveState();
        return this;
    }

    private buildConnectionGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        for (const cell of this.listAllCells()) {
            if (this.topColour(cell) === player) {
                graph.addNode(cell);
            }
        }
        if (this.hexGraph !== undefined) {
            for (const node of graph.nodes()) {
                for (const neighbour of this.hexGraph.neighbours(node)) {
                    if (!this.isOnBoard(neighbour)) {
                        continue;
                    }
                    if (graph.hasNode(neighbour) && !graph.hasEdge(node, neighbour)) {
                        graph.addEdge(node, neighbour);
                    }
                }
            }
            return graph;
        }
        for (const node of graph.nodes()) {
            const [x, y] = this.algebraic2coords(node);
            for (const dir of DIRS) {
                const [xn, yn] = this.boardStep(x, y, dir, 1);
                if (!this.inBounds(xn, yn)) {
                    continue;
                }
                const neighbour = this.coords2algebraic(xn, yn);
                if (graph.hasNode(neighbour) && !graph.hasEdge(node, neighbour)) {
                    graph.addEdge(node, neighbour);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): DruidGame {
        if (this.passCount >= this.numplayers) {
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
            return this;
        }

        const prevPlayer = this.currplayer;
        if (this.isWalk()) {
            const last = this.results[this.results.length - 1];
            if (last?.type === "bearoff") {
                this.gameover = true;
                this.winner = [prevPlayer];
                this.results.push({ type: "eog" }, { type: "winners", players: [prevPlayer] });
            }
            return this;
        }

        const graph = this.buildConnectionGraph(prevPlayer);
        const mode = this.boardMode();

        if (mode === "y") {
            const edges = this.yEdgeSets();
            if (this.playerConnectsEdges(graph, edges)) {
                this.gameover = true;
                this.winner = [prevPlayer];
                this.recordConnPath(graph, edges);
                this.results.push({ type: "eog" }, { type: "winners", players: [prevPlayer] });
            }
            return this;
        }

        if (mode === "hex") {
            const boardEdges = this.hexGraph!.getEdges();
            for (const triple of HEX_WIN_EDGE_SETS) {
                const edgeSets = triple.map(e => boardEdges.get(e)!);
                if (this.playerConnectsEdges(graph, edgeSets)) {
                    this.gameover = true;
                    this.winner = [prevPlayer];
                    this.recordConnPath(graph, edgeSets);
                    this.results.push(
                        { type: "eog", reason: this.hexEdgeReason(triple) },
                        { type: "winners", players: [prevPlayer] },
                    );
                    return this;
                }
            }
            return this;
        }

        const [sources, targets] = this.edgeLines(prevPlayer);
        for (const source of sources) {
            for (const target of targets) {
                if (graph.hasNode(source) && graph.hasNode(target)) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevPlayer];
                        this.connPath = [...path];
                        this.results.push({ type: "eog" }, { type: "winners", players: [prevPlayer] });
                        return this;
                    }
                }
            }
        }
        return this;
    }

    public state(): IDruidState {
        return {
            game: DruidGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DruidGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            stacks: new Map(this.stacks),
            druid: { ...this.druid },
            druidSpawnEdge: { ...this.druidSpawnEdge },
            passCount: this.passCount,
            nextLintelId: this.nextLintelId,
            connPath: [...this.connPath],
            lastmove: this.lastmove,
        };
    }

    private solidStoneLegend(legend: IsoLegend, player: playerid): string {
        const isHex = this.hexGraph !== undefined;
        const key = isHex ? `H${player}` : `C${player}`;
        if (legend[key] === undefined) {
            legend[key] = {
                piece: isHex ? "hexp" : "cube",
                height: CUBE_HEIGHT,
                colour: player,
                scale: isHex ? HEX_SCALE : 1,
            };
        }
        return key;
    }

    private lintelLegendKey(dir: LintelDir, segment: 0 | 1 | 2, player: playerid): string {
        if (this.hexGraph !== undefined) {
            return `L${player}${this.hexLintelPiece(dir as HexDir, segment)}`;
        }
        if (this.isRectDir(dir)) {
            const endPiece = (() => {
                switch (dir) {
                    case "E":
                    case "W":
                        return segment === 0 ? "lintelE" : segment === 2 ? "lintelW" : "lintelEW";
                    case "N":
                    case "S":
                        return segment === 0 ? "lintelN" : segment === 2 ? "lintelS" : "lintelNS";
                }
            })();
            return `L${player}${endPiece}`;
        }
        return `L${player}${this.hexLintelPiece(dir, segment)}`;
    }

    private registerLintelLegend(legend: IsoLegend, dir: LintelDir, segment: 0 | 1 | 2, player: playerid): string {
        const key = this.lintelLegendKey(dir, segment, player);
        if (legend[key] === undefined) {
            const piece = key.replace(/^L[12]/, "");
            legend[key] = {
                piece: piece as IsoPiece["piece"],
                height: CUBE_HEIGHT,
                colour: player,
                scale: this.hexGraph !== undefined ? HEX_SCALE : 1,
            };
        }
        return key;
    }

    private registerSpacerLegend(legend: IsoLegend): string {
        const key = "SC";
        if (legend[key] === undefined) {
            legend[key] = {
                piece: this.hexGraph !== undefined ? "spaceHex" : "spaceCube",
                height: CUBE_HEIGHT,
                colour: 1,
                scale: this.hexGraph !== undefined ? HEX_SCALE : 1,
            };
        }
        return key;
    }

    private registerConeLegend(legend: IsoLegend, player: playerid): string {
        const key = `D${player}`;
        if (legend[key] === undefined) {
            legend[key] = { piece: "pyramid", size: "small", colour: player };
        }
        return key;
    }

    private renderStackGlyphs(cell: string, legend: IsoLegend): string[] {
        const glyphs: string[] = [];
        const stack = this.stackAt(cell);
        for (let i = 0; i < stack.length; i++) {
            const stone = stack[i];
            if (stone.kind === "spacer") {
                glyphs.push(this.registerSpacerLegend(legend));
            } else if (stone.kind === "sarsen") {
                glyphs.push(this.solidStoneLegend(legend, stone.owner));
            } else {
                glyphs.push(this.registerLintelLegend(legend, stone.dir, stone.segment, stone.owner));
            }
        }
        if (this.isWalk()) {
            if (this.druid[1] === cell) {
                glyphs.push(this.registerConeLegend(legend, 1));
            }
            if (this.druid[2] === cell) {
                glyphs.push(this.registerConeLegend(legend, 2));
            }
        }
        return glyphs;
    }

    /** Rendered cube count for overhead labels (includes spacer cubes and druids). */
    private cellRenderHeight(cell: string): number {
        let height = this.stackAt(cell).length;
        if (this.isWalk() && this.hasDruid(cell)) {
            height++;
        }
        return height;
    }

    private registerFlatCellLegend(legend: FlatLegend, base: "C1" | "C2" | "R1" | "R2", height: number): string {
        const key = `${base}h${height}`;
        if (legend[key] === undefined) {
            const isHex = this.hexGraph !== undefined;
            const piece: Glyph = base.startsWith("R")
                ? { name: "piece", colour: base === "R1" ? 1 : 2, scale: 0.65 }
                : isHex
                    ? { name: "hex-pointy", colour: base === "C1" ? 1 : 2 }
                    : { name: "piece-square", colour: base === "C1" ? 1 : 2 };
            legend[key] = [piece, { text: height.toString(), scale: 0.75 }];
        }
        return key;
    }

    private flatCellKey(cell: string, legend: FlatLegend): string {
        const height = this.cellRenderHeight(cell);
        if (height === 0) {
            return "-";
        }
        let base: "C1" | "C2" | "R1" | "R2";
        if (this.druid[1] === cell) {
            base = "R1";
        } else if (this.druid[2] === cell) {
            base = "R2";
        } else {
            const top = this.topStone(cell);
            if (top === undefined || top.kind === "spacer") {
                return "-";
            }
            base = top.owner === 1 ? "C1" : "C2";
        }
        return this.registerFlatCellLegend(legend, base, height);
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        const isIso = altDisplay !== "flat";
        const mode = this.boardMode();
        const isHexBoard = mode === "y" || mode === "hex";
        const markers = isHexBoard ? [] : this.edgeMarkers();

        let myLegend: FlatLegend | IsoLegend;
        if (isIso) {
            myLegend = {} as IsoLegend;
        } else {
            myLegend = {} as FlatLegend;
        }

        const pstr: string[][][] = [];
        const flatPstrGrid: string[][] = [];
        if (isHexBoard) {
            const cells = this.hexGraph!.listCells(true) as string[][];
            for (const row of cells) {
                const rowPieces: string[][] = [];
                const flatRow: string[] = [];
                for (const cell of row) {
                    if (isIso) {
                        rowPieces.push(this.renderStackGlyphs(cell, myLegend as IsoLegend));
                    } else {
                        flatRow.push(this.flatCellKey(cell, myLegend as FlatLegend));
                    }
                }
                if (isIso) {
                    pstr.push(rowPieces);
                } else {
                    flatPstrGrid.push(flatRow);
                }
            }
        } else {
            for (let row = 0; row < this.height; row++) {
                const rowPieces: string[][] = [];
                const flatRow: string[] = [];
                for (let col = 0; col < this.width; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (isIso) {
                        rowPieces.push(this.renderStackGlyphs(cell, myLegend as IsoLegend));
                    } else {
                        flatRow.push(this.flatCellKey(cell, myLegend as FlatLegend));
                    }
                }
                if (isIso) {
                    pstr.push(rowPieces);
                } else {
                    flatPstrGrid.push(flatRow);
                }
            }
        }

        let rep: APRenderRep;
        if (isHexBoard) {
            if (isIso) {
                rep = {
                    renderer: "isometric",
                    options: this.hexReverseLetters() ? ["reverse-letters"] : undefined,
                    board: mode === "y"
                        ? { style: "hex-of-hex", minWidth: 1, maxWidth: this.boardSize, half: "top" }
                        : { style: "hex-of-hex", minWidth: this.boardSize, maxWidth: this.boardSize * 2 - 1 },
                    legend: myLegend,
                    pieces: pstr as [string[][], ...string[][][]],
                };
            } else {
                let flatPstr = "";
                for (const row of flatPstrGrid) {
                    if (flatPstr.length > 0) {
                        flatPstr += "\n";
                    }
                    flatPstr += row.join(",");
                }
                rep = {
                    options: this.hexReverseLetters() ? ["reverse-letters"] : undefined,
                    board: mode === "y"
                        ? { style: "hex-of-hex", minWidth: 1, maxWidth: this.boardSize, half: "top" }
                        : { style: "hex-of-hex", minWidth: this.boardSize, maxWidth: this.boardSize * 2 - 1 },
                    legend: myLegend,
                    pieces: flatPstr,
                };
            }
        } else if (isIso) {
            rep = {
                renderer: "isometric",
                board: {
                    style: "squares",
                    projection: "shallow",
                    width: this.width,
                    height: this.height,
                    markers,
                },
                legend: myLegend,
                pieces: pstr as [string[][], ...string[][][]],
            };
        } else {
            let flatPstr = "";
            for (const row of flatPstrGrid) {
                if (flatPstr.length > 0) {
                    flatPstr += "\n";
                }
                flatPstr += row.join(",");
            }
            rep = {
                board: {
                    style: "squares-checkered",
                    width: this.width,
                    height: this.height,
                    markers,
                },
                legend: myLegend,
                pieces: flatPstr,
            };
        }

        if (this.results.length > 0 || this.connPath.length > 0) {
            rep.annotations = [];
            for (const r of this.results) {
                if (r.type === "place" && r.what !== "druid") {
                    const where = r.what === "lintel" ? r.where!.split("+") : [r.where!];
                    for (const end of where) {
                        const [x, y] = this.algebraic2coords(end);
                        if (isIso) {
                            rep.annotations!.push({ type: "dots", targets: [{ row: y, col: x }], size: 0.3 });
                        } else {
                            rep.annotations!.push({ type: "enter", targets: [{ row: y, col: x }] });
                        }
                    }
                } else if (r.type === "move") {
                    const [fx, fy] = this.algebraic2coords(r.from);
                    const [tx, ty] = this.algebraic2coords(r.to);
                    rep.annotations!.push({ type: "move", targets: [{ row: fy, col: fx }, { row: ty, col: tx }] });
                }
            }
            if (this.connPath.length > 0) {
                const targets = this.connPath.map(cell => {
                    const [x, y] = this.algebraic2coords(cell);
                    return { row: y, col: x };
                }) as [{ row: number; col: number }, ...{ row: number; col: number }[]];
                if (mode === "rect") {
                    rep.annotations!.push({
                        type: "line",
                        targets,
                        arrow: false,
                        style: "dashed",
                    });
                } else {
                    rep.annotations!.push({
                        type: "outline",
                        targets,
                    });
                }
            }
        }

        return rep;
    }



    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "eog": {
                const edges = r.reason !== undefined ? this.parseHexEdgeReason(r.reason) : undefined;
                if (edges === undefined) {
                    return false;
                }
                const winResult = ctx.results.find(x => x.type === "winners");
                let winnerSeat = ctx.defaultSeat;
                if (winResult?.type === "winners" && winResult.players.length > 0) {
                    winnerSeat = winResult.players[0];
                }
                this.pushSeatChatLine(lines, winnerSeat, "apresults:EOG.druid_hex", {
                    edges: this.hexEdgeListLabel(edges),
                });
                return true;
            }
            case "place":
                if (r.what === "lintel") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.druid_lintel", {where: r.where!});
                } else if (r.what === "druid") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.druid_druid", {where: r.where!});
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.druid_sarsen", {where: r.where!});
                }
                return true;
            case "move":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:MOVE.druid_walk", {
                    from: r.from!, to: r.to!,
                });
                return true;
            case "bearoff":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:BEAROFF.druid", {from: r.from!});
                return true;
            case "pass":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PASS.druid", {});
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): DruidGame {
        return new DruidGame(this.serialize());
    }
}
