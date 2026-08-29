import {  GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Colourfuncs, DominoTileRef, Glyph, IsoPiece } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { Domino } from "../common/dominoes/Domino";
import { DominoDeck } from "../common/dominoes/DominoDeck";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";

export type playerid = 1 | 2;
export type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Side = "evens" | "odds";
type Half = [number, number];
type HandEntry = number | "";
type Dir = "N" | "E" | "S" | "W";

const CUBE_HEIGHT = 30;
const FLAT_SCALE = 1.25;
const FLAT_HEIGHT_DARKEN_DL = 0.33;
const RENDER_PAD = 2;
const PENDING_DRAW = "" as HandEntry;
const DIRS: Half[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const BLANK_PIP_COLOUR: Colourfuncs = { func: "custom", default: "#aaaaaa", palette: 3 };

export interface PlacedTile {
    id: number;
    a: Half;
    b: Half;
    pipA: Pip;
    pipB: Pip;
    level: number;
}

type FlatLegend = { [key: string]: Glyph | [Glyph, ...Glyph[]] };
type IsoLegend = { [key: string]: IsoPiece };

interface ISerializedDomino {
    id: number;
    l: number;
    r: number;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    tiles: PlacedTile[];
    hands: HandEntry[][];
    pool: ISerializedDomino[];
    boneyard: number[];
    removed: number[];
    overtime: boolean;
    lastmove?: string;
    selected?: number;
    anchor?: Half;
    anchorPip?: Pip;
    boneyardCount?: number;
    p1Side?: Side;
}

export interface IEvenAtOddsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class EvenAtOddsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Even at Odds",
        uid: "evenatodds",
        playercounts: [2],
        version: "20260724",
        dateAdded: "2026-08-03",
        description: "apgames:descriptions.evenatodds",
        notes: "apgames:notes.evenatodds",
        people: [
            { type: "designer", name: "Jacob Landrum" },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        urls: ["https://boardgamegeek.com/boardgame/458452/even-at-odds"],
        bggid: "458452",
        displays: [{ uid: "flat" }],
        categories: ["goal>area", "mechanic>place", "mechanic>stack", "board>3d", "board>dynamic", "components>dominoes"],
        flags: ["scores", "custom-buttons"],
        customizations: [{num: 3, default: "#aaaaaa", explanation: "Colour of the blank ends"}],
    };

    public static readonly ALL_DOMINOES: Domino[] = DominoDeck.fromDouble(6).dominoes;

    public numplayers = 2;
    public currplayer: playerid = 1;
    public tiles!: PlacedTile[];
    public hands!: HandEntry[][];
    public pool!: Map<number, Domino>;
    public boneyard!: number[];
    public removed!: number[];
    public overtime = false;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public selected?: number;
    public anchor?: Half;
    public anchorPip?: Pip;
    public highlights: Half[] = [];
    public lastmove?: string;
    public p1Side?: Side;

    private renderMinX = 0;
    private renderMaxY = 0;

    constructor(state?: IEvenAtOddsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh = this.createInitialMoveState();
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEvenAtOddsState;
            }
            if (state.game !== EvenAtOddsGame.gameinfo.uid) {
                throw new Error(`The Even at Odds engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public static dominoId(d: Domino): number {
        const idx = EvenAtOddsGame.ALL_DOMINOES.findIndex(x => x.l === d.l && x.r === d.r);
        if (idx < 0) {
            throw new Error(`Unknown domino ${d.uid()}`);
        }
        return idx;
    }

    private static buildPool(): Map<number, Domino> {
        const pool = new Map<number, Domino>();
        EvenAtOddsGame.ALL_DOMINOES.forEach((d, id) => pool.set(id, d.clone()));
        return pool;
    }

    private createInitialMoveState(): IMoveState {
        const pool = EvenAtOddsGame.buildPool();
        const uidToId = new Map<string, number>();
        for (const [id, d] of pool) {
            uidToId.set(d.uid(), id);
        }

        const tiles: PlacedTile[] = [];
        const setupRows: [Pip, Pip][][] = [
            [[1, 1], [6, 6]],
            [[2, 2], [5, 5]],
            [[3, 3], [4, 4]],
        ];
        const rowYs = [1, 0, -1];
        for (let row = 0; row < setupRows.length; row++) {
            let colX = -2;
            const y = rowYs[row];
            for (const [l, r] of setupRows[row]) {
                const id = uidToId.get(`${l}|${r}`)!;
                tiles.push({
                    id,
                    a: [colX, y],
                    b: [colX + 1, y],
                    pipA: l,
                    pipB: r,
                    level: 0,
                });
                colX += 2;
            }
        }

        const offBoard = [...pool.keys()].filter(id => !tiles.some(t => t.id === id));
        const deck = new DominoDeck(offBoard.map(id => pool.get(id)!));
        deck.shuffle();

        const removed: number[] = [];
        for (let i = 0; i < 2; i++) {
            const d = deck.draw();
            if (d !== undefined) {
                removed.push(EvenAtOddsGame.dominoId(d));
            }
        }

        const hands: HandEntry[][] = [[], []];
        for (let p = 0; p < 2; p++) {
            for (let i = 0; i < 7; i++) {
                const d = deck.draw();
                if (d !== undefined) {
                    hands[p].push(EvenAtOddsGame.dominoId(d));
                }
            }
        }

        const boneyard: number[] = [];
        while (deck.size > 0) {
            const d = deck.draw();
            if (d !== undefined) {
                boneyard.push(EvenAtOddsGame.dominoId(d));
            }
        }

        return {
            _version: EvenAtOddsGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: 1,
            tiles,
            hands,
            pool: [...pool.entries()].map(([id, d]) => ({ id, l: d.l, r: d.r })),
            boneyard,
            removed,
            overtime: false,
        };
    }

    public load(idx = -1): EvenAtOddsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.tiles = state.tiles.map(t => ({ ...t, a: [...t.a] as Half, b: [...t.b] as Half }));
        this.hands = state.hands.map(h => [...h]);
        this.pool = new Map(state.pool.map(p => [p.id, new Domino(p.l, p.r)]));
        this.boneyard = [...state.boneyard];
        this.removed = [...state.removed];
        this.overtime = state.overtime;
        this.lastmove = state.lastmove;
        this.selected = state.selected;
        this.anchor = state.anchor ? [...state.anchor] as Half : undefined;
        this.anchorPip = state.anchorPip;
        this.p1Side = state.p1Side;
        if (this.p1Side === undefined && state.lastmove !== undefined) {
            this.p1Side = "evens";
        }
        this.results = [...state._results];
        return this;
    }

    private static isSideChoice(m: string): m is Side {
        const lower = m.toLowerCase();
        return lower === "evens" || lower === "odds";
    }

    private static normalizeSideChoice(m: string): Side {
        const lower = m.toLowerCase();
        if (lower === "evens" || lower === "odds") {
            return lower;
        }
        throw new Error(`Invalid side choice: ${m}`);
    }

    private inSideChoicePhase(): boolean {
        return this.p1Side === undefined;
    }

    private playerSide(player: playerid): Side | undefined {
        if (this.p1Side === undefined) { return undefined; }
        if (player === 1) { return this.p1Side; }
        return this.p1Side === "evens" ? "odds" : "evens";
    }

    private halfKey(h: Half): string {
        return `${h[0]},${h[1]}`;
    }

    private orthoAdjacent(a: Half, b: Half): boolean {
        return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) === 1;
    }

    private tilesAtHalf(h: Half): PlacedTile[] {
        const k = this.halfKey(h);
        return this.tiles
            .filter(t => this.halfKey(t.a) === k || this.halfKey(t.b) === k)
            .sort((a, b) => a.level - b.level);
    }

    public stackHeight(h: Half): number {
        return this.tilesAtHalf(h).length;
    }

    private pipAtHalf(h: Half): Pip | undefined {
        const ts = this.tilesAtHalf(h);
        if (ts.length === 0) { return undefined; }
        const top = ts[ts.length - 1];
        return this.halfKey(top.a) === this.halfKey(h) ? top.pipA : top.pipB;
    }

    private topTileAt(h: Half): PlacedTile | undefined {
        const ts = this.tilesAtHalf(h);
        return ts.length > 0 ? ts[ts.length - 1] : undefined;
    }

    private activePip(h: Half): Pip | undefined {
        return this.pipAtHalf(h);
    }

    private dominoById(id: number): Domino | undefined {
        return this.pool.get(id);
    }

    private dominoPips(id: number): [Pip, Pip] | undefined {
        const d = this.dominoById(id);
        if (d === undefined) { return undefined; }
        return [d.l as Pip, d.r as Pip];
    }

    private static readonly DIR_DELTAS: Record<Dir, Half> = {
        N: [0, 1],
        E: [1, 0],
        S: [0, -1],
        W: [-1, 0],
    };

    private tileKey(tileId: number): string {
        const pips = this.dominoPips(tileId);
        if (pips === undefined) {
            throw new Error(`Unknown tile id ${tileId}`);
        }
        return `${pips[0]}-${pips[1]}`;
    }

    private parseTileKey(key: string): [Pip, Pip] | undefined {
        const m = /^(\d+)-(\d+)$/.exec(key);
        if (!m) { return undefined; }
        const l = parseInt(m[1], 10);
        const r = parseInt(m[2], 10);
        if (l > r || l < 0 || r > 6) { return undefined; }
        return [l as Pip, r as Pip];
    }

    private tileIdFromKey(key: string): number | undefined {
        const pips = this.parseTileKey(key);
        if (pips === undefined) { return undefined; }
        const [l, r] = pips;
        for (const [id, d] of this.pool) {
            if (d.l === l && d.r === r) { return id; }
        }
        return undefined;
    }

    private parseTileKeyFromMove(m: string): {
        consumed: number;
        tileKey: string;
        tileId?: number;
        anchorPip?: Pip;
    } | undefined {
        const starLow = /^(\d+)\*-(\d+)/.exec(m);
        if (starLow) {
            const l = parseInt(starLow[1], 10);
            const r = parseInt(starLow[2], 10);
            if (l > r || l < 0 || r > 6) { return undefined; }
            const tileKey = `${l}-${r}`;
            return {
                consumed: starLow[0].length,
                tileKey,
                tileId: this.tileIdFromKey(tileKey),
                anchorPip: l as Pip,
            };
        }
        const starHigh = /^(\d+)-(\d+)\*/.exec(m);
        if (starHigh) {
            const l = parseInt(starHigh[1], 10);
            const r = parseInt(starHigh[2], 10);
            if (l > r || l < 0 || r > 6) { return undefined; }
            const tileKey = `${l}-${r}`;
            return {
                consumed: starHigh[0].length,
                tileKey,
                tileId: this.tileIdFromKey(tileKey),
                anchorPip: r as Pip,
            };
        }
        const plain = /^(\d+)-(\d+)/.exec(m);
        if (plain) {
            const l = parseInt(plain[1], 10);
            const r = parseInt(plain[2], 10);
            if (l > r || l < 0 || r > 6) { return undefined; }
            const tileKey = `${l}-${r}`;
            return {
                consumed: plain[0].length,
                tileKey,
                tileId: this.tileIdFromKey(tileKey),
            };
        }
        return undefined;
    }

    private tileKeyWithAnchorPip(tileId: number, anchorPip: Pip): string {
        const pips = this.dominoPips(tileId);
        if (pips === undefined) {
            throw new Error(`Unknown tile id ${tileId}`);
        }
        const [l, r] = pips;
        if (anchorPip === l) { return `${l}*-${r}`; }
        if (anchorPip === r) { return `${l}-${r}*`; }
        throw new Error(`Pip ${anchorPip} is not on tile ${tileId}`);
    }

    private tileHasAmbiguousMoves(tileId: number): boolean {
        return this.moves().some(m => {
            const parsed = this.parseMove(m);
            return parsed.tileId === tileId && parsed.anchorPip !== undefined;
        });
    }

    private completionMoveForSecondEnd(tileId: number, other: Half, anchorPip: Pip): string | undefined {
        const completions: string[] = [];
        for (const anchor of this.legalAnchors(tileId, anchorPip)) {
            for (const end of this.legalSecondEnds(tileId, anchor, anchorPip)) {
                if (end[0] === other[0] && end[1] === other[1]) {
                    completions.push(this.formatMove(tileId, anchor, end, anchorPip));
                }
            }
        }
        return completions.length === 1 ? completions[0] : undefined;
    }

    private isPlacementAmbiguous(tileId: number, anchor: Half, other: Half): boolean {
        return this.anchorPipsForPlacement(tileId, anchor, other).length > 1;
    }

    private anchorPipsForPlacement(tileId: number, anchor: Half, other: Half): Pip[] {
        if (!this.hands[this.currplayer - 1].includes(tileId)) { return []; }
        if (!this.orthoAdjacent(anchor, other)) { return []; }
        const pips = this.dominoPips(tileId);
        if (pips === undefined) { return []; }
        const level = this.placementLevel(anchor, other);
        if (level === undefined) { return []; }

        const valid: Pip[] = [];
        const seen = new Set<Pip>();
        for (const pipAnchor of pips) {
            if (seen.has(pipAnchor)) { continue; }
            let anchorOk = false;
            if (level === 0) {
                anchorOk = this.tableAnchorValid(anchor, pipAnchor) && this.stackHeight(other) === 0;
            } else {
                anchorOk = this.stackAnchorValid(anchor, pipAnchor);
            }
            if (!anchorOk) { continue; }

            if (level === 0) {
                seen.add(pipAnchor);
                valid.push(pipAnchor);
                continue;
            }

            const topA = this.topTileAt(anchor);
            const topO = this.topTileAt(other);
            if (topA === undefined || topO === undefined) { continue; }
            if (topA.id === topO.id) { continue; }
            if (this.activePip(other) === undefined) { continue; }
            seen.add(pipAnchor);
            valid.push(pipAnchor);
        }
        return valid;
    }

    private dirFromEnds(anchor: Half, other: Half): Dir | undefined {
        const dx = other[0] - anchor[0];
        const dy = other[1] - anchor[1];
        if (dx === 0 && dy === 1) { return "N"; }
        if (dx === 1 && dy === 0) { return "E"; }
        if (dx === 0 && dy === -1) { return "S"; }
        if (dx === -1 && dy === 0) { return "W"; }
        return undefined;
    }

    private otherFromDir(anchor: Half, dir: Dir): Half {
        const [dx, dy] = EvenAtOddsGame.DIR_DELTAS[dir];
        return [anchor[0] + dx, anchor[1] + dy];
    }

    private pipColour(pip: Pip): 1 | 2 | Colourfuncs {
        if (pip === 0) { return BLANK_PIP_COLOUR; }
        if (this.p1Side === undefined) { return BLANK_PIP_COLOUR; }
        const isEven = pip % 2 === 0;
        if (this.p1Side === "evens") {
            return isEven ? 1 : 2;
        }
        return isEven ? 2 : 1;
    }

    private maxActiveLevel(): number {
        let max = 0;
        for (const t of this.tiles) {
            max = Math.max(max, t.level);
        }
        return max;
    }

    private flatPipColour(pip: Pip, darkenSteps: number): 1 | 2 | Colourfuncs {
        const base = this.pipColour(pip);
        if (darkenSteps === 0) { return base; }
        return { func: "lighten", colour: base, ds: 0, dl: -FLAT_HEIGHT_DARKEN_DL * darkenSteps };
    }

    private pipTeam(pip: Pip): playerid | 0 {
        if (pip === 0) { return 0; }
        if (this.p1Side === undefined) { return 0; }
        const colour = this.pipColour(pip);
        if (typeof colour === "number") { return colour; }
        return 0;
    }

    private pipGlyphName(pip: Pip): `tile-0${1 | 2 | 3 | 4 | 5 | 6}` | undefined {
        if (pip === 0) { return undefined; }
        return `tile-0${pip}` as `tile-0${1 | 2 | 3 | 4 | 5 | 6}`;
    }

    private pipContrastColour(bg: 1 | 2 | Colourfuncs): Colourfuncs {
        return {
            func: "bestContrast",
            bg,
            fg: ["#000000", "#ffffff"],
        };
    }

    private pipGlyphOverlay(pip: Pip, bg: 1 | 2 | Colourfuncs, scale?: number): Glyph | undefined {
        const name = this.pipGlyphName(pip);
        if (name === undefined) { return undefined; }
        const glyph: Glyph = {
            name,
            colour: this.pipContrastColour(bg),
        };
        if (scale !== undefined) {
            glyph.scale = scale;
        }
        return glyph;
    }

    private dominoEndKey(tileId: number, end: "L" | "R"): string {
        return `H${tileId}${end}`;
    }

    private registerDominoHandEnd(legend: FlatLegend, tileId: number, end: "L" | "R", pip: Pip): void {
        const key = this.dominoEndKey(tileId, end);
        if (legend[key] !== undefined) { return; }
        const rot = end === "L" ? 90 : -90;
        const frame: Glyph = {
            name: "piece-square-single",
            rotate: rot,
            scale: FLAT_SCALE,
            colour: this.pipColour(pip),
        };
        const pipGlyph = this.pipGlyphOverlay(pip, this.pipColour(pip), FLAT_SCALE);
        if (pipGlyph === undefined) {
            legend[key] = [frame];
        } else {
            legend[key] = [frame, pipGlyph];
        }
    }

    private registerDominoHandTile(legend: FlatLegend, tileId: number): void {
        const d = this.dominoById(tileId);
        if (d === undefined) { return; }
        this.registerDominoHandEnd(legend, tileId, "L", d.l as Pip);
        this.registerDominoHandEnd(legend, tileId, "R", d.r as Pip);
    }

    private dominoHandPiece(tileId: number): DominoTileRef {
        return {
            domino: [this.dominoEndKey(tileId, "L"), this.dominoEndKey(tileId, "R")],
            id: this.tileKey(tileId),
        };
    }

    private offBoardTileIds(): number[] {
        const onBoardIds = new Set(this.tiles.map(t => t.id));
        const inHand = new Set<number>();
        for (const hand of this.hands) {
            for (const id of hand) {
                if (typeof id === "number") { inHand.add(id); }
            }
        }
        return [...this.pool.keys()]
            .filter(id => !onBoardIds.has(id) && !inHand.has(id))
            .sort((a, b) => this.dominoSortAsc(this.pool.get(a)!, this.pool.get(b)!));
    }

    private handLabel(player: playerid) {
        const side = this.playerSide(player);
        if (side !== undefined) {
            return this.seatAreaLabel(player, "apgames:validation.evenatodds.LABEL_HAND", { side });
        }
        return this.seatAreaLabel(player, "apgames:validation.evenatodds.LABEL_HAND_NO_SIDE");
    }

    private tableAnchorValid(anchor: Half, pipAnchor: Pip): boolean {
        if (this.stackHeight(anchor) !== 0) { return false; }
        for (const [dx, dy] of DIRS) {
            const n: Half = [anchor[0] + dx, anchor[1] + dy];
            if (this.activePip(n) === pipAnchor) {
                return true;
            }
        }
        return false;
    }

    private stackAnchorValid(anchor: Half, pipAnchor: Pip): boolean {
        const h = this.stackHeight(anchor);
        if (h === 0) { return false; }
        return this.activePip(anchor) === pipAnchor;
    }

    private placementLevel(anchor: Half, other: Half): number | undefined {
        const ha = this.stackHeight(anchor);
        const ho = this.stackHeight(other);
        if (ha === 0 && ho === 0) { return 0; }
        if (ha > 0 && ha === ho) { return ha; }
        return undefined;
    }

    private isLegalPlacement(tileId: number, anchor: Half, other: Half, requiredAnchorPip?: Pip): boolean {
        const anchorPips = this.anchorPipsForPlacement(tileId, anchor, other);
        if (anchorPips.length === 0) { return false; }
        if (requiredAnchorPip === undefined) { return true; }
        return anchorPips.includes(requiredAnchorPip);
    }

    private legalSecondEnds(tileId: number, anchor: Half, requiredAnchorPip?: Pip): Half[] {
        const ends: Half[] = [];
        for (const [dx, dy] of DIRS) {
            const other: Half = [anchor[0] + dx, anchor[1] + dy];
            if (this.isLegalPlacement(tileId, anchor, other, requiredAnchorPip)) {
                ends.push(other);
            }
        }
        return ends;
    }

    private formatMove(tileId: number, anchor?: Half, other?: Half, anchorPip?: Pip): string {
        const placementAmbiguous = other !== undefined && anchor !== undefined
            && this.isPlacementAmbiguous(tileId, anchor, other);
        let m: string;
        if (placementAmbiguous && anchorPip !== undefined) {
            m = this.tileKeyWithAnchorPip(tileId, anchorPip);
        } else if (other === undefined && anchor !== undefined && anchorPip !== undefined) {
            const needsAsterisk = this.legalSecondEnds(tileId, anchor, anchorPip)
                .some(end => this.isPlacementAmbiguous(tileId, anchor, end));
            m = needsAsterisk ? this.tileKeyWithAnchorPip(tileId, anchorPip) : this.tileKey(tileId);
        } else {
            m = this.tileKey(tileId);
        }
        if (anchor !== undefined) {
            m += `@${anchor[0]},${anchor[1]}`;
            if (other !== undefined) {
                const dir = this.dirFromEnds(anchor, other);
                if (dir === undefined) {
                    throw new Error(`Illegal domino orientation ${anchor} to ${other}`);
                }
                m += dir;
            }
        }
        return m;
    }

    private parseMove(m: string): {
        tileKey?: string;
        tileId?: number;
        anchorPip?: Pip;
        anchor?: Half;
        dir?: Dir;
        other?: Half;
    } {
        m = m.toUpperCase().replace(/\s+/g, "");
        const tile = this.parseTileKeyFromMove(m);
        if (tile === undefined) { return {}; }
        const rest = m.slice(tile.consumed);
        const full = /^@(-?\d+),(-?\d+)([NESW])$/.exec(rest);
        if (full) {
            const anchor: Half = [parseInt(full[1], 10), parseInt(full[2], 10)];
            const dir = full[3] as Dir;
            return {
                tileKey: tile.tileKey,
                tileId: tile.tileId,
                anchorPip: tile.anchorPip,
                anchor,
                dir,
                other: this.otherFromDir(anchor, dir),
            };
        }
        const partial = /^@(-?\d+),(-?\d+)$/.exec(rest);
        if (partial) {
            return {
                tileKey: tile.tileKey,
                tileId: tile.tileId,
                anchorPip: tile.anchorPip,
                anchor: [parseInt(partial[1], 10), parseInt(partial[2], 10)],
            };
        }
        if (rest.length === 0) {
            return {
                tileKey: tile.tileKey,
                tileId: tile.tileId,
                anchorPip: tile.anchorPip,
            };
        }
        return {};
    }

    private resolvedAnchorPip(tileId: number, anchor: Half, other: Half, preferred?: Pip): Pip | undefined {
        const anchorPips = this.anchorPipsForPlacement(tileId, anchor, other);
        if (anchorPips.length === 0) { return undefined; }
        if (anchorPips.length === 1) { return anchorPips[0]; }
        if (preferred !== undefined && anchorPips.includes(preferred)) { return preferred; }
        return undefined;
    }

    private partialMatchesMove(partial: string, full: string): boolean {
        const pp = this.parseMove(partial);
        const fp = this.parseMove(full);
        if (pp.tileId === undefined || pp.tileId !== fp.tileId) { return false; }
        if (pp.anchorPip !== undefined && fp.anchorPip !== undefined && pp.anchorPip !== fp.anchorPip) {
            return false;
        }
        if (pp.anchor === undefined) { return true; }
        if (fp.anchor === undefined) { return false; }
        if (pp.anchor[0] !== fp.anchor[0] || pp.anchor[1] !== fp.anchor[1]) { return false; }
        if (pp.other === undefined) { return true; }
        if (fp.other === undefined) { return false; }
        return pp.other[0] === fp.other[0] && pp.other[1] === fp.other[1];
    }

    private movesMatchingPartial(m: string): string[] {
        const parsed = this.parseMove(m);
        return this.moves().filter(full => {
            if (!this.partialMatchesMove(m, full)) { return false; }
            const fp = this.parseMove(full);
            if (parsed.anchorPip !== undefined && fp.anchorPip !== undefined && parsed.anchorPip !== fp.anchorPip) {
                return false;
            }
            if (parsed.anchorPip === undefined && this.anchorPip !== undefined
                && fp.anchor !== undefined && fp.other !== undefined && fp.tileId !== undefined) {
                const apips = this.anchorPipsForPlacement(fp.tileId, fp.anchor, fp.other);
                if (apips.length > 1 && fp.anchorPip !== this.anchorPip) {
                    return false;
                }
            }
            return true;
        });
    }

    public getButtons(): ICustomButton[] {
        if (this.inSideChoicePhase()) {
            return [
                { label: "evenatodds.evens", move: "evens" },
                { label: "evenatodds.odds", move: "odds" },
            ];
        }
        return [];
    }

    public moves(): string[] {
        if (this.inSideChoicePhase()) {
            return ["evens", "odds"];
        }
        const moves: string[] = [];
        const hand = this.hands[this.currplayer - 1].filter((id): id is number => id !== PENDING_DRAW);
        for (const tileId of hand) {
            const anchors = this.legalAnchors(tileId);
            for (const anchor of anchors) {
                for (const other of this.legalSecondEnds(tileId, anchor)) {
                    const anchorPips = this.anchorPipsForPlacement(tileId, anchor, other);
                    if (anchorPips.length > 1) {
                        for (const pip of anchorPips) {
                            moves.push(this.formatMove(tileId, anchor, other, pip));
                        }
                    } else if (anchorPips.length === 1) {
                        moves.push(this.formatMove(tileId, anchor, other));
                    }
                }
            }
        }
        return moves;
    }

    private legalAnchors(tileId: number, requiredAnchorPip?: Pip): Half[] {
        const anchors: Half[] = [];
        const seen = new Set<string>();
        const pips = this.dominoPips(tileId);
        if (pips === undefined) { return anchors; }
        const [l, r] = pips;

        const tryAnchor = (h: Half) => {
            const k = this.halfKey(h);
            if (seen.has(k)) { return; }
            if (this.legalSecondEnds(tileId, h, requiredAnchorPip).length > 0) {
                seen.add(k);
                anchors.push(h);
            }
        };

        for (const t of this.tiles) {
            for (const h of [t.a, t.b] as Half[]) {
                const pip = this.activePip(h);
                if (pip === l || pip === r) {
                    for (const [dx, dy] of DIRS) {
                        const empty: Half = [h[0] + dx, h[1] + dy];
                        if (this.stackHeight(empty) === 0) {
                            tryAnchor(empty);
                        }
                    }
                    tryAnchor(h);
                }
            }
        }
        return anchors;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };
        const raw = m.replace(/\s+/g, "");
        if (this.inSideChoicePhase()) {
            if (raw.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.evenatodds.INITIAL_INSTRUCTIONS_choose");
                return result;
            }
            if (EvenAtOddsGame.isSideChoice(raw)) {
                if (this.currplayer === 1) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                }
                return result;
            }
            result.message = i18next.t("apgames:validation.evenatodds.MUST_CHOOSE_SIDE");
            return result;
        }
        m = raw.toUpperCase();
        const allMoves = this.moves();
        const parsed = this.parseMove(m);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.evenatodds.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (parsed.tileId !== undefined && !this.hands[this.currplayer - 1].includes(parsed.tileId)) {
            result.message = i18next.t("apgames:validation.evenatodds.NOT_IN_HAND");
            return result;
        }

        if (parsed.tileId !== undefined && parsed.anchor !== undefined && parsed.other !== undefined) {
            const anchorPips = this.anchorPipsForPlacement(parsed.tileId, parsed.anchor, parsed.other);
            if (anchorPips.length > 1 && parsed.anchorPip === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.evenatodds.NEEDS_ANCHOR_PIP");
                return result;
            }
            if (parsed.anchorPip !== undefined && !anchorPips.includes(parsed.anchorPip)) {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                return result;
            }
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const prefixes = this.movesMatchingPartial(m);
        if (prefixes.length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.evenatodds.PARTIAL");
            if (parsed.anchor !== undefined && parsed.other === undefined && parsed.tileId !== undefined) {
                const preferred = parsed.anchorPip ?? this.anchorPip;
                const seconds = this.legalSecondEnds(parsed.tileId, parsed.anchor, preferred);
                if (seconds.length === 1) {
                    const pip = this.resolvedAnchorPip(parsed.tileId, parsed.anchor, seconds[0], preferred);
                    result.autocomplete = this.formatMove(parsed.tileId, parsed.anchor, seconds[0], pip);
                    result.complete = 1;
                }
            }
            return result;
        }

        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
        return result;
    }

    private applyPlacement(tileId: number, anchor: Half, other: Half, anchorPip?: Pip): void {
        const pips = this.dominoPips(tileId)!;
        const level = this.placementLevel(anchor, other)!;
        const validPips = this.anchorPipsForPlacement(tileId, anchor, other);
        let pipAnchor: Pip;
        if (anchorPip !== undefined) {
            if (!validPips.includes(anchorPip)) {
                throw new Error(`Invalid anchor pip ${anchorPip} for placement at ${anchor}`);
            }
            pipAnchor = anchorPip;
        } else if (validPips.length === 1) {
            pipAnchor = validPips[0];
        } else {
            throw new Error(`Ambiguous anchor pip for placement at ${anchor}`);
        }
        const pipOther = pipAnchor === pips[0] ? pips[1] : pips[0];

        this.tiles.push({
            id: tileId,
            a: [...anchor] as Half,
            b: [...other] as Half,
            pipA: pipAnchor,
            pipB: pipOther,
            level,
        });
        this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(id => id !== tileId);
        this.results.push({
            type: "place",
            what: `${pipAnchor}-${pipOther}`,
            where: `${anchor[0]},${anchor[1]};${other[0]},${other[1]}`,
        });
    }

    public move(m: string, { trusted = false, partial = false, emulation = false } = {}): EvenAtOddsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        const raw = m.replace(/\s+/g, "");
        if (this.inSideChoicePhase()) {
            if (!trusted) {
                const result = this.validateMove(raw);
                if (!result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message);
                }
            }
            if (!EvenAtOddsGame.isSideChoice(raw)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: raw }));
            }
            this.results = [];
            this.highlights = [];
            this.p1Side = EvenAtOddsGame.normalizeSideChoice(raw);
            this.lastmove = this.p1Side;
            this.currplayer = 2;
            this.saveState();
            return this;
        }

        m = raw.toUpperCase();
        const allMoves = this.moves();

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !emulation && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        this.results = [];
        this.highlights = [];

        const parsed = this.parseMove(m);
        const placementPip = parsed.anchorPip ?? this.anchorPip;
        if (parsed.tileId !== undefined && parsed.anchor === undefined) {
            this.selected = parsed.tileId;
            this.anchor = undefined;
            this.anchorPip = placementPip;
            this.highlights = this.legalAnchors(parsed.tileId, placementPip);
            if (partial) { return this; }
        }

        if (parsed.tileId !== undefined && parsed.anchor !== undefined && parsed.other === undefined) {
            this.selected = parsed.tileId;
            this.anchor = parsed.anchor;
            this.anchorPip = placementPip;
            this.highlights = this.legalSecondEnds(parsed.tileId, parsed.anchor, placementPip);
            if (partial) { return this; }
        }

        if (parsed.tileId !== undefined && parsed.anchor !== undefined && parsed.other !== undefined) {
            if (partial) {
                this.selected = parsed.tileId;
                this.anchor = parsed.anchor;
                this.anchorPip = placementPip;
                this.highlights = [parsed.other];
                return this;
            }
            const resolved = this.resolvedAnchorPip(
                parsed.tileId,
                parsed.anchor,
                parsed.other,
                placementPip,
            );
            this.applyPlacement(parsed.tileId, parsed.anchor, parsed.other, resolved);
            this.selected = undefined;
            this.anchor = undefined;
            this.anchorPip = undefined;
            this.highlights = [];
            if (!partial) {
                m = this.formatMove(parsed.tileId, parsed.anchor, parsed.other, resolved);
            }
        }

        if (partial) { return this; }
        if (emulation) {
            if (this.boneyard.length > 0 && !this.hands[this.currplayer - 1].includes(PENDING_DRAW)) {
                this.hands[this.currplayer - 1].push(PENDING_DRAW);
            }
            return this;
        }

        this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(id => id !== PENDING_DRAW);
        if (this.boneyard.length > 0) {
            const drawId = this.boneyard.pop()!;
            this.hands[this.currplayer - 1].push(drawId);
            this.results.push({ type: "deckDraw" });
        }

        this.lastmove = m;
        this.checkEOG();
        if (!this.gameover) {
            this.currplayer = this.currplayer === 1 ? 2 : 1;
        }
        this.saveState();
        return this;
    }

    private bothHandsEmpty(): boolean {
        return this.hands.every(h => h.filter(id => id !== PENDING_DRAW).length === 0);
    }

    private scorePlayer(team: playerid): number {
        const graph = new UndirectedGraph();
        const nodes: { key: string; half: Half; pip: Pip }[] = [];

        for (const t of this.tiles) {
            for (const h of [t.a, t.b] as Half[]) {
                const pip = this.activePip(h);
                if (pip === undefined || this.pipTeam(pip) !== team) { continue; }
                const key = `${this.halfKey(h)}:${pip}`;
                if (!graph.hasNode(key)) {
                    graph.addNode(key);
                    nodes.push({ key, half: h, pip });
                }
            }
        }

        for (const n of nodes) {
            for (const [dx, dy] of DIRS) {
                const nh: Half = [n.half[0] + dx, n.half[1] + dy];
                const npip = this.activePip(nh);
                if (npip === undefined || this.pipTeam(npip) !== team) { continue; }
                const nkey = `${this.halfKey(nh)}:${npip}`;
                if (graph.hasNode(nkey) && !graph.hasEdge(n.key, nkey)) {
                    graph.addEdge(n.key, nkey);
                }
            }
        }

        const comps = connectedComponents(graph);
        let best = 0;
        for (const comp of comps) {
            if (comp.length > best) {
                best = comp.length;
            }
        }
        return best;
    }

    private maxLevelTeamFaces(team: playerid): number {
        let maxLevel = -1;
        for (const t of this.tiles) {
            if (t.level > maxLevel) { maxLevel = t.level; }
        }
        let count = 0;
        for (const t of this.tiles) {
            if (t.level !== maxLevel) { continue; }
            for (const pip of [t.pipA, t.pipB]) {
                if (this.pipTeam(pip) === team) { count++; }
            }
        }
        return count;
    }

    protected checkEOG(): EvenAtOddsGame {
        if (!this.bothHandsEmpty()) { return this; }

        const s1 = this.scorePlayer(1);
        const s2 = this.scorePlayer(2);
        if (s1 > s2) {
            this.winner = [1];
        } else if (s2 > s1) {
            this.winner = [2];
        } else {
            const h1 = this.maxLevelTeamFaces(1);
            const h2 = this.maxLevelTeamFaces(2);
            if (h1 > h2) {
                this.winner = [1];
            } else if (h2 > h1) {
                this.winner = [2];
            } else if (!this.overtime && this.removed.length >= 2) {
                this.overtime = true;
                for (let p = 0; p < 2; p++) {
                    this.hands[p].push(this.removed[p]);
                }
                this.removed = [];
                return this;
            } else {
                this.winner = [1, 2];
            }
        }

        this.gameover = true;
        this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = move.toUpperCase().replace(/\s+/g, "");
            const domino = piece !== undefined ? /^_domino_(\d+-\d+)_/i.exec(piece) : null;
            if (domino) {
                newmove = domino[1].toUpperCase();
                const tileId = this.tileIdFromKey(newmove);
                const end = piece?.match(/_([LR])$/i)?.[1];
                if (tileId !== undefined && end !== undefined) {
                    const d = this.dominoById(tileId);
                    if (d !== undefined) {
                        const pip = (end === "L" ? d.l : d.r) as Pip;
                        this.anchorPip = pip;
                        if (this.tileHasAmbiguousMoves(tileId)) {
                            newmove = this.tileKeyWithAnchorPip(tileId, pip);
                        }
                    }
                }
            } else if (row >= 0 && col >= 0) {
                this.syncRenderCoords();
                const half = this.renderCellToHalf(row, col);
                const parsed = this.parseMove(newmove);
                const pip = parsed.anchorPip ?? this.anchorPip;
                if (parsed.tileId !== undefined && parsed.anchor === undefined) {
                    const tileId = parsed.tileId;
                    if (pip !== undefined) {
                        const asAnchor = this.legalAnchors(tileId, pip)
                            .some(a => a[0] === half[0] && a[1] === half[1]);
                        const ambiguousAnchor = asAnchor && this.legalSecondEnds(tileId, half, pip)
                            .some(end => this.isPlacementAmbiguous(tileId, half, end));
                        if (ambiguousAnchor) {
                            newmove = this.formatMove(tileId, half, undefined, pip);
                        } else {
                            const completion = this.completionMoveForSecondEnd(tileId, half, pip);
                            newmove = completion ?? this.formatMove(tileId, half, undefined, pip);
                        }
                    } else {
                        newmove = this.formatMove(tileId, half);
                    }
                } else if (parsed.tileId !== undefined && parsed.anchor !== undefined) {
                    newmove = this.formatMove(parsed.tileId, parsed.anchor, half, pip);
                }
            }

            const matches = this.movesMatchingPartial(newmove);
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
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move, row, col, piece, emessage: (e as Error).message,
                }),
            };
        }
    }

    private occupiedBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const t of this.tiles) {
            for (const h of [t.a, t.b] as Half[]) {
                minX = Math.min(minX, h[0]);
                maxX = Math.max(maxX, h[0]);
                minY = Math.min(minY, h[1]);
                maxY = Math.max(maxY, h[1]);
            }
        }
        if (minX === Infinity) {
            return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        }
        return { minX, maxX, minY, maxY };
    }

    private formatAxisLabel(n: number): string {
        return n.toString().replace("-", "\u2212");
    }

    private buildAxisLabels(bounds: { minX: number; maxX: number; minY: number; maxY: number }): {
        columnLabels: string[];
        rowLabels: string[];
        width: number;
        height: number;
    } {
        const columnLabels: string[] = [];
        for (let x = bounds.minX - RENDER_PAD; x <= bounds.maxX + RENDER_PAD; x++) {
            columnLabels.push(this.formatAxisLabel(x));
        }
        const rowLabels: string[] = [];
        for (let y = bounds.minY - RENDER_PAD; y <= bounds.maxY + RENDER_PAD; y++) {
            rowLabels.push(this.formatAxisLabel(y));
        }
        return {
            columnLabels,
            rowLabels,
            width: bounds.maxX - bounds.minX + 1 + 2 * RENDER_PAD,
            height: bounds.maxY - bounds.minY + 1 + 2 * RENDER_PAD,
        };
    }

    private syncRenderCoords(): void {
        const bounds = this.occupiedBounds();
        this.renderMinX = bounds.minX - RENDER_PAD;
        this.renderMaxY = bounds.maxY + RENDER_PAD;
    }

    private renderCellToHalf(row: number, col: number): Half {
        return [this.renderMinX + col, this.renderMaxY - row];
    }

    private halfToRenderCell(h: Half): { row: number; col: number } {
        return {
            row: this.renderMaxY - h[1],
            col: h[0] - this.renderMinX,
        };
    }

    private dominoSortAsc(a: Domino, b: Domino): number {
        if (a.l !== b.l) { return a.l - b.l; }
        return a.r - b.r;
    }

    private isoDecorTop(pip: Pip, rot: number): Glyph[] {
        const frame: Glyph = { name: "piece-square-single", rotate: rot, opacity: 0 };
        const pipGlyph = this.pipGlyphOverlay(pip, this.pipColour(pip));
        return pipGlyph === undefined ? [frame] : [frame, pipGlyph];
    }

    private halfOrient(a: Half, b: Half): "H" | "V" {
        return a[1] === b[1] ? "H" : "V";
    }

    private halfSideOnTile(t: PlacedTile, h: Half): "L" | "R" {
        const horiz = this.halfOrient(t.a, t.b) === "H";
        if (horiz) {
            return h[0] < Math.max(t.a[0], t.b[0]) ? "L" : "R";
        }
        return h[1] < Math.max(t.a[1], t.b[1]) ? "L" : "R";
    }

    private registerHalfIso(legend: IsoLegend, pip: Pip, side: "L" | "R", horiz: boolean): string {
        const rot = horiz ? (side === "L" ? 90 : -90) : (side === "L" ? 0 : 180);
        const key = `I${pip}${side}${horiz ? "H" : "V"}${rot}`;
        if (legend[key] === undefined) {
            legend[key] = {
                piece: "cube",
                colour: this.pipColour(pip),
                scale: 1,
                height: CUBE_HEIGHT,
                decor: {
                    top: this.isoDecorTop(pip, rot) as [Glyph, ...Glyph[]],
                },
            };
        }
        return key;
    }

    private registerHalfFlat(legend: FlatLegend, pip: Pip, side: "L" | "R", horiz: boolean, darkenSteps: number): string {
        const rot = horiz ? (side === "L" ? 90 : -90) : (side === "L" ? 0 : 180);
        const key = `F${pip}${side}${horiz ? "H" : "V"}${rot}D${darkenSteps}`;
        if (legend[key] === undefined) {
            const bg = this.flatPipColour(pip, darkenSteps);
            const pipGlyph = this.pipGlyphOverlay(pip, bg);
            const frame: Glyph = {
                name: "piece-square-single",
                rotate: rot,
                scale: FLAT_SCALE,
                colour: bg,
            };
            const glyphs: [Glyph, ...Glyph[]] = pipGlyph === undefined
                ? [frame]
                : [frame, pipGlyph];
            legend[key] = glyphs;
        }
        return key;
    }

    private isoGhostDecorTop(pip: Pip, rot: number): Glyph[] {
        const frame: Glyph = { name: "piece-square-single", rotate: rot, opacity: 0 };
        const pipGlyph = this.pipGlyphOverlay(pip, this.pipColour(pip));
        if (pipGlyph === undefined) { return [frame]; }
        return [frame, { ...pipGlyph, opacity: 0.5 }];
    }

    private registerGhostHalfIso(legend: IsoLegend, pip: Pip, side: "L" | "R", horiz: boolean): string {
        const rot = horiz ? (side === "L" ? 90 : -90) : (side === "L" ? 0 : 180);
        const key = `GI${pip}${side}${horiz ? "H" : "V"}${rot}`;
        if (legend[key] === undefined) {
            legend[key] = {
                piece: "cube",
                colour: this.pipColour(pip),
                scale: 1,
                height: CUBE_HEIGHT,
                decor: {
                    top: this.isoGhostDecorTop(pip, rot) as [Glyph, ...Glyph[]],
                },
            };
        }
        return key;
    }

    private registerGhostHalfFlat(legend: FlatLegend, pip: Pip, side: "L" | "R", horiz: boolean, darkenSteps: number): string {
        const rot = horiz ? (side === "L" ? 90 : -90) : (side === "L" ? 0 : 180);
        const key = `GF${pip}${side}${horiz ? "H" : "V"}${rot}D${darkenSteps}`;
        if (legend[key] === undefined) {
            const bg = this.flatPipColour(pip, darkenSteps);
            const pipGlyph = this.pipGlyphOverlay(pip, bg);
            const frame: Glyph = {
                name: "piece-square-single",
                rotate: rot,
                scale: FLAT_SCALE,
                colour: bg,
                opacity: 0.5,
            };
            const glyphs: [Glyph, ...Glyph[]] = pipGlyph === undefined
                ? [frame]
                : [frame, { ...pipGlyph, opacity: 0.5 }];
            legend[key] = glyphs;
        }
        return key;
    }

    private ghostDarkenSteps(half: Half, other?: Half): number {
        const maxH = this.maxActiveLevel();
        let level = 0;
        if (other !== undefined && this.anchor !== undefined) {
            level = this.placementLevel(this.anchor, other) ?? 0;
        } else if (this.anchor !== undefined && this.halfKey(half) === this.halfKey(this.anchor)) {
            level = this.stackHeight(this.anchor);
        }
        return maxH - level;
    }

    private ghostHalvesForPartial(): { half: Half; pip: Pip; side: "L" | "R"; horiz: boolean }[] {
        if (this.selected === undefined || this.anchor === undefined) {
            return [];
        }
        const pips = this.dominoPips(this.selected);
        if (pips === undefined) { return []; }
        const [l, r] = pips;
        let pipAnchor: Pip;
        if (this.anchorPip !== undefined) {
            pipAnchor = this.anchorPip;
        } else {
            const seconds = this.highlights.length === 1
                ? this.highlights
                : this.legalSecondEnds(this.selected, this.anchor);
            if (seconds.length === 0) { return []; }
            const apips = this.anchorPipsForPlacement(this.selected, this.anchor, seconds[0]);
            if (apips.length === 0) { return []; }
            pipAnchor = apips[0];
        }
        const pipOther = (pipAnchor === l ? r : l) as Pip;

        const seconds = this.legalSecondEnds(this.selected, this.anchor, this.anchorPip);
        if (seconds.length === 1) {
            const other = seconds[0];
            const horiz = this.halfOrient(this.anchor, other) === "H";
            const anchorSide: "L" | "R" = horiz
                ? (this.anchor[0] < other[0] ? "L" : "R")
                : (this.anchor[1] < other[1] ? "L" : "R");
            const otherSide: "L" | "R" = anchorSide === "L" ? "R" : "L";
            return [
                { half: this.anchor, pip: pipAnchor, side: anchorSide, horiz },
                { half: other, pip: pipOther, side: otherSide, horiz },
            ];
        }
        return [{ half: this.anchor, pip: pipAnchor, side: "L", horiz: true }];
    }

    private stackGlyphsAt(h: Half, legend: IsoLegend | FlatLegend, isIso: boolean, maxH = 0): string[] {
        const glyphs: string[] = [];
        const ts = this.tilesAtHalf(h);
        for (let i = 0; i < ts.length; i++) {
            const t = ts[i];
            const pip = this.halfKey(t.a) === this.halfKey(h) ? t.pipA : t.pipB;
            const side = this.halfSideOnTile(t, h);
            const horiz = this.halfOrient(t.a, t.b) === "H";
            if (isIso) {
                if (i === ts.length - 1) {
                    glyphs.push(this.registerHalfIso(legend as IsoLegend, pip, side, horiz));
                } else {
                    const plainKey = `Pc${pip}`;
                    if ((legend as IsoLegend)[plainKey] === undefined) {
                        (legend as IsoLegend)[plainKey] = {
                            piece: "cube",
                            colour: this.pipColour(pip),
                            scale: 1,
                            height: CUBE_HEIGHT,
                        };
                    }
                    glyphs.push(plainKey);
                }
            } else if (i === ts.length - 1) {
                const darkenSteps = maxH - t.level;
                glyphs.push(this.registerHalfFlat(legend as FlatLegend, pip, side, horiz, darkenSteps));
            }
        }
        return glyphs;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const altDisplay = opts?.altDisplay;
        const isIso = altDisplay !== "flat";
        const maxH = isIso ? 0 : this.maxActiveLevel();

        const bounds = this.occupiedBounds();
        this.syncRenderCoords();
        const { columnLabels, rowLabels, width, height } = this.buildAxisLabels(bounds);

        let myLegend: FlatLegend | IsoLegend;
        if (isIso) {
            myLegend = {} as IsoLegend;
        } else {
            myLegend = {} as FlatLegend;
        }

        const pstr: string[][][] = [];
        const flatRows: string[][] = [];
        for (let row = 0; row < height; row++) {
            const rowPieces: string[][] = [];
            const flatRow: string[] = [];
            for (let col = 0; col < width; col++) {
                const half = this.renderCellToHalf(row, col);
                const glyphs = this.stackGlyphsAt(half, myLegend, isIso, maxH);
                if (isIso) {
                    rowPieces.push(glyphs);
                } else {
                    flatRow.push(glyphs.length > 0 ? glyphs[glyphs.length - 1] : "-");
                }
            }
            if (isIso) {
                pstr.push(rowPieces);
            } else {
                flatRows.push(flatRow);
            }
        }

        const ghostHalves = this.ghostHalvesForPartial();
        const flatGhostOverlays: { key: string; cell: { row: number; col: number } }[] = [];
        const ghostOther = ghostHalves.length === 2
            ? (ghostHalves[0].half[0] === this.anchor![0] && ghostHalves[0].half[1] === this.anchor![1]
                ? ghostHalves[1].half : ghostHalves[0].half)
            : undefined;
        for (const gh of ghostHalves) {
            const cell = this.halfToRenderCell(gh.half);
            const darkenSteps = isIso ? 0 : this.ghostDarkenSteps(gh.half, ghostOther);
            if (isIso) {
                const key = this.registerGhostHalfIso(myLegend as IsoLegend, gh.pip, gh.side, gh.horiz);
                pstr[cell.row][cell.col].push(key);
            } else {
                const key = this.registerGhostHalfFlat(myLegend as FlatLegend, gh.pip, gh.side, gh.horiz, darkenSteps);
                if (flatRows[cell.row][cell.col] === "-") {
                    flatRows[cell.row][cell.col] = key;
                } else {
                    flatGhostOverlays.push({ key, cell });
                }
            }
        }

        const areas: AreaPieces[] = [];
        const legend = myLegend as FlatLegend;
        legend["tUNKNOWN"] = {
            name: "piece-square-borderless",
            colour: { func: "flatten", fg: "_context_fill", bg: "_context_background", opacity: 0.5 },
        };

        const handTileIds: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            for (const id of this.hands[p - 1]) {
                if (typeof id === "number") {
                    handTileIds.push(id);
                }
            }
        }
        const offBoardIds = this.offBoardTileIds();
        for (const id of [...new Set([...handTileIds, ...offBoardIds])]) {
            this.registerDominoHandTile(legend, id);
        }

        for (let p = 1; p <= this.numplayers; p++) {
            const hand = this.hands[p - 1];
            const visible = hand.filter(id => id !== PENDING_DRAW);
            if (visible.length > 0 || hand.includes(PENDING_DRAW)) {
                const pieces = hand.map((id) => {
                    if (typeof id !== "number") { return "tUNKNOWN"; }
                    return this.dominoHandPiece(id);
                }) as [string | DominoTileRef, ...(string | DominoTileRef)[]];
                areas.push({
                    type: "pieces",
                    pieces,
                    label: this.handLabel(p as playerid),
                    ownerMark: p,
                    spacing: 0.5,
                    width: 6,
                });
            }
        }

        const remaining = offBoardIds.map(id => this.dominoHandPiece(id)) as [DominoTileRef, ...DominoTileRef[]];

        if (remaining.length > 0) {
            areas.push({
                type: "pieces",
                label: this.neutralAreaLabel("apgames:validation.evenatodds.LABEL_REMAINING"),
                spacing: 0.25,
                pieces: remaining,
                width: 6,
            });
        }

        let rep: APRenderRep;
        if (isIso) {
            rep = {
                renderer: "isometric",
                board: {
                    style: "squares",
                    projection: "shallow",
                    width,
                    height,
                    rowLabels,
                    columnLabels,
                },
                legend: myLegend,
                pieces: pstr as [string[][], ...string[][][]],
                areas: areas.length > 0 ? areas : undefined,
            };
        } else {
            let flatPstr = "";
            for (const row of flatRows) {
                if (flatPstr.length > 0) { flatPstr += "\n"; }
                flatPstr += row.join(",");
            }
            rep = {
                board: {
                    style: "squares-beveled",
                    width,
                    height,
                    rowLabels,
                    columnLabels,
                },
                legend: myLegend,
                pieces: flatPstr,
                areas: areas.length > 0 ? areas : undefined,
            };
        }

        if (this.highlights.length > 0 || this.anchor !== undefined || this.lastmove !== undefined
            || flatGhostOverlays.length > 0) {
            rep.annotations = [];
            const showGhost = ghostHalves.length > 0;
            const enterTargets = this.highlights.map(h => this.halfToRenderCell(h));
            if (this.anchor !== undefined && !showGhost) {
                enterTargets.push(this.halfToRenderCell(this.anchor));
            }
            if (enterTargets.length > 0) {
                rep.annotations.push({
                    type: "enter",
                    targets: enterTargets as [{ row: number; col: number }, ...{ row: number; col: number }[]],
                });
            }
            for (const overlay of flatGhostOverlays) {
                rep.annotations.push({
                    type: "glyph",
                    glyph: overlay.key,
                    targets: [overlay.cell],
                });
            }
            if (this.lastmove !== undefined) {
                const parsed = this.parseMove(this.lastmove);
                if (parsed.anchor !== undefined && parsed.other !== undefined) {
                    rep.annotations.push({
                        type: "move",
                        targets: [
                            this.halfToRenderCell(parsed.anchor),
                            this.halfToRenderCell(parsed.other),
                        ],
                        arrow: false,
                    });
                }
            }
        }

        return rep;
    }

    public state(opts?: { strip?: boolean; player?: number }): IEvenAtOddsState {
        const state: IEvenAtOddsState = {
            game: EvenAtOddsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
        if (opts?.strip && !this.gameover) {
            state.stack = state.stack.map(mstate => {
                const copy: IMoveState = {
                    ...mstate,
                    tiles: mstate.tiles.map(t => ({ ...t })),
                    hands: mstate.hands.map(h => [...h]),
                    pool: [...mstate.pool],
                    boneyard: [],
                    boneyardCount: mstate.boneyard.length,
                    removed: this.gameover ? [...mstate.removed] : [],
                };
                for (let p = 1; p <= 2; p++) {
                    if (p !== opts.player) {
                        copy.hands[p - 1] = [];
                    }
                }
                return copy;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: EvenAtOddsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            tiles: this.tiles.map(t => ({ ...t, a: [...t.a] as Half, b: [...t.b] as Half })),
            hands: this.hands.map(h => [...h]),
            pool: [...this.pool.entries()].map(([id, d]) => ({ id, l: d.l, r: d.r })),
            boneyard: [...this.boneyard],
            removed: [...this.removed],
            overtime: this.overtime,
            lastmove: this.lastmove,
            selected: this.selected,
            anchor: this.anchor ? [...this.anchor] as Half : undefined,
            anchorPip: this.anchorPip,
            p1Side: this.p1Side,
        };
    }

    public sidebarStatuses(): IStatus[] {
        return [
            { key: i18next.t("apgames:status.evenatodds.BONEYARD"), value: [this.boneyard.length.toString()] },
        ];
    }

    public sidebarScores(): IScores[] {
        if (!this.gameover) { return []; }
        return [{
            name: i18next.t("apgames:status.SCORES"),
            scores: [this.scorePlayer(1).toString(), this.scorePlayer(2).toString()],
        }];
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.evenatodds", { where: r.where!, what: r.what! });
                return true;
            case "deckDraw":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:DECKDRAW.evenatodds", {});
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public clone(): EvenAtOddsGame {
        return new EvenAtOddsGame(this.state());
    }
}
