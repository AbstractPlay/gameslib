import {
    IAPGameState,
    IClickResult,
    IIndividualState,
    IScores,
    IValidationResult,
    type ChatLogCollectContext,
    type ChatLogLine,
} from "./_base.js";
import { GameBaseSequenced } from "./_turn-sequenced.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, type Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, cloneState } from "../common/index.js";
import { chatPlayerToken } from "../common/chat-log.js";
import { GipfGraph } from "../common/graphs/gipf.js";
import i18next from "i18next";
import type { IGamePly } from "./_turn-model.js";
import { sequencedShouldCloseRound } from "./_turn-sequenced.js";
import type {
    CapturePhase,
    CellPiece,
    CapturePending,
    CapturableRow,
    PieceKind,
    playerid,
    RulesVariant,
} from "./gipf/types.js";
import {
    GIPF_CHARIOT_BORDER,
    GIPF_P1,
    GIPF_P1_CHARIOT_INNER,
    GIPF_P2,
    GIPF_P2_CHARIOT_INNER,
} from "./gipf/types.js";
import { buildInitialBoard, initialReserve } from "./gipf/setup.js";
import {
    captureMaskForMove,
    formatCaptureMove,
    listCaptureConfirmMoves,
    takeSetForCaptureMove,
} from "./gipf/capture-notation.js";
import { legalPushDestinations, pushEntrySpot, simulatePush } from "./gipf/push.js";
import {
    captureMaskFromTake,
    defaultGipfTake,
    findAllCapturableRows,
    optionalGipfOnRow,
    takeSetForCaptureMask,
} from "./gipf/rows.js";

const GIPF_P1_CHARIOT_BORDER: Colourfuncs = { func: "custom", default: GIPF_CHARIOT_BORDER, palette: 3 };
const GIPF_P1_CHARIOT_INNER_COLOUR: Colourfuncs = { func: "custom", default: GIPF_P1_CHARIOT_INNER, palette: 4 };
const GIPF_P2_CHARIOT_BORDER: Colourfuncs = { func: "custom", default: GIPF_CHARIOT_BORDER, palette: 5 };
const GIPF_P2_CHARIOT_INNER_COLOUR: Colourfuncs = { func: "custom", default: GIPF_P2_CHARIOT_INNER, palette: 6 };

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS:
            "Click an empty dot to place a piece from your reserve, then click the first spot along a line to push it into play.",
        INITIAL_INSTRUCTIONS_TOURNAMENT:
            "On a dot: a GIPF-piece is placed first; click the dot again to switch to a single or clear it. Then push along a line. GIPF entries end with G (e.g. e1-e2G).",
        INITIAL_INSTRUCTIONS_PUSH: "Click the first spot along a line to complete your move.",
        INITIAL_INSTRUCTIONS_CAPTURE:
            "Marked pieces must be removed. Click any highlighted mandatory piece to fill the capture line in the move box, then submit it.",
        INITIAL_INSTRUCTIONS_CAPTURE_OPTIONAL:
            "Click a highlighted mandatory piece for the full capture line, or click an optional GIPF-piece to leave it on the board. Submit the capture notation when finished.",
        INITIAL_INSTRUCTIONS_CHOOSE_ROW: "Click a highlighted row to remove it first.",
        BLOCKED_LINE: "That line is blocked; you cannot push a piece off the board.",
        DOT_OCCUPIED: "That dot already has a piece.",
        NOT_DOT: "{{where}} is not a dot.",
        MUST_CAPTURE: "You must remove pieces from the board before continuing.",
        MUST_ENTER_GIPF: "You must bring a GIPF piece into play before playing single pieces.",
    },
    variants: {
        "#rules": {
            description: "GIPF-pieces, optional GIPF removal on rows, and loss if your last GIPF leaves the board.",
            name: "Standard",
        },
        basic: {
            description: "Basic pieces only; win when the opponent's reserve is empty.",
            name: "Basic",
        },
        tournament: {
            description: "Empty start; players may bring multiple GIPF pieces before locking single-piece play.",
            name: "Tournament",
        },
    },
};

export const gameApresultsEn = {
    MOVE: {
        push: "{{player}} pushed from {{from}} to {{to}}.",
    },
    CAPTURE: {
        rowSummary:
            "{{player}} captured pieces from the following cells: {{cells}}. This included {{ownCount}} of their own pieces and {{enemyCount}} enemy pieces.",
    },
    EOG: {
        reserve: "{{player}} wins because the opponent has no reserve.",
        gipf: "{{player}} wins because the opponent has no GIPF piece on the board.",
    },
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellPiece>;
    reserve: [number, number];
    gipfLocked?: [boolean, boolean];
    /** Per seat: first dot-push ply completed (tournament — unlocks singles alongside GIPF). */
    tournamentOpeningDone?: [boolean, boolean];
    pendingDot?: { cell: string; owner: playerid; kind: PieceKind };
    capturePending?: CapturePending;
    lastmove?: string;
}

export interface IGipfState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class GipfGame extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "GIPF",
        uid: "gipf",
        playercounts: [2],
        version: "20261120",
        dateAdded: "2026-11-20",
        description:
            "Players push pieces from dots onto a hex line board, forming rows of four to capture. Win by emptying the opponent's reserve or removing their last GIPF piece.",
        urls: [
            "https://www.gipf.com/gipf/rules/complete_rules.html",
            "https://boardgamegeek.com/boardgame/40295/gipf",
        ],
        bggid: "40295",
        people: [
            {
                type: "designer",
                name: "Kris Burm",
                urls: ["https://www.gipf.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "basic", group: "rules" },
            { uid: "tournament", group: "rules" },
        ],
        customizations: [
            { num: 1, default: GIPF_P1, explanation: "Player 1 basic piece fill", player: 1 },
            { num: 2, default: GIPF_P2, explanation: "Player 2 basic piece fill", player: 2 },
            {
                num: 3,
                default: GIPF_CHARIOT_BORDER,
                explanation: "Player 1 GIPF-piece border (chariot outer ring)",
                player: 1,
            },
            {
                num: 4,
                default: GIPF_P1_CHARIOT_INNER,
                explanation: "Player 1 GIPF-piece inner rings",
                player: 1,
            },
            {
                num: 5,
                default: GIPF_CHARIOT_BORDER,
                explanation: "Player 2 GIPF-piece border (chariot outer ring)",
                player: 2,
            },
            {
                num: 6,
                default: GIPF_P2_CHARIOT_INNER,
                explanation: "Player 2 GIPF-piece inner rings",
                player: 2,
            },
        ],
        categories: [
            "goal>eliminate",
            "mechanic>place",
            "mechanic>move",
            "mechanic>capture",
            "board>shape>hex",
            "board>connect>hex",
            "components>simple>1per",
        ],
        flags: ["custom-colours", "check", "automove", "experimental"],
    };

    public readonly graph = new GipfGraph();
    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellPiece>;
    public reserve: [number, number] = [12, 12];
    public gipfLocked?: [boolean, boolean];
    public tournamentOpeningDone?: [boolean, boolean];
    public pendingDot?: IMoveState["pendingDot"];
    public capturePending?: CapturePending;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IGipfState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const rv = this.rulesVariant();
            const board = buildInitialBoard(rv);
            const fresh: IMoveState = {
                _version: GipfGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                reserve: initialReserve(rv),
            };
            if (rv === "tournament") {
                fresh.gipfLocked = [false, false];
                fresh.tournamentOpeningDone = [false, false];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGipfState;
            }
            if (state.game !== GipfGame.gameinfo.uid) {
                throw new Error(`The GIPF engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public rulesVariant(): RulesVariant {
        if (this.variants.includes("basic")) {
            return "basic";
        }
        if (this.variants.includes("tournament")) {
            return "tournament";
        }
        return "standard";
    }

    public gipfOnBoard(seat: playerid): number {
        let n = 0;
        for (const p of this.board.values()) {
            if (p.owner === seat && p.kind === "gipf") {
                n++;
            }
        }
        return n;
    }

    public load(idx = -1): GipfGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error("Could not load the requested state from the stack.");
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = cloneState(state.board) as Map<string, CellPiece>;
        this.reserve = [...state.reserve] as [number, number];
        this.gipfLocked = state.gipfLocked ? [...state.gipfLocked] as [boolean, boolean] : undefined;
        this.tournamentOpeningDone = state.tournamentOpeningDone
            ? [...state.tournamentOpeningDone] as [boolean, boolean]
            : undefined;
        this.reconcileTournamentOpeningDone(idx, state.tournamentOpeningDone === undefined);
        this.pendingDot = state.pendingDot ? { ...state.pendingDot } : undefined;
        this.capturePending = state.capturePending
            ? (cloneState(state.capturePending) as CapturePending)
            : undefined;
        this.lastmove = state.lastmove;
        return this;
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        const after = this.stack[stackIndex];
        if (after?.pendingDot !== undefined || after?.capturePending !== undefined) {
            return false;
        }
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    private usesGipfEntryNotation(): boolean {
        return this.rulesVariant() === "tournament";
    }

    /** Tournament dot-click cycle (GIPF → basic → clear) while GIPF entries remain unlocked. */
    private showTournamentPlacementInstructions(player: playerid = this.currplayer): boolean {
        return this.tournamentDotToggleAllowed(player);
    }

    private tournamentDotToggleAllowed(player: playerid): boolean {
        return (
            this.usesGipfEntryNotation()
            && this.gipfLocked !== undefined
            && !this.gipfLocked[player - 1]
            && !this.mustEnterGipf(player)
        );
    }

    private defaultDotPlacementKind(player: playerid): PieceKind {
        if (!this.usesGipfEntryNotation() || this.gipfLocked?.[player - 1]) {
            return "basic";
        }
        return "gipf";
    }

    private tournamentEmptyDotMove(cell: string, movePrefix: string): string {
        const explicitGipf = movePrefix.startsWith("g") || movePrefix.endsWith("g");
        if (explicitGipf) {
            return `g${cell}`;
        }
        return this.defaultDotPlacementKind(this.currplayer) === "gipf" ? `g${cell}` : cell;
    }

    private placementInstructionsKey(player: playerid = this.currplayer): string {
        return this.showTournamentPlacementInstructions(player)
            ? "apgames:validation.gipf.INITIAL_INSTRUCTIONS_TOURNAMENT"
            : "apgames:validation.gipf.INITIAL_INSTRUCTIONS";
    }

    private parseDotPlacement(m: string): { dot: string; kind: PieceKind } | undefined {
        if (m.startsWith("cap") || m.startsWith("x") || m.startsWith("!")) {
            return undefined;
        }
        if (m.includes("-") || m.includes(">")) {
            return undefined;
        }
        let gipf = false;
        let downgradeBasic = false;
        let body = m.toLowerCase();
        const nodes = this.graph.graph;
        const dotFromPrefix = (prefix: string): string | undefined => {
            const rest = body.slice(prefix.length);
            if (rest.length === 0 || nodes.hasNode(body) || !nodes.hasNode(rest) || !this.graph.isDot(rest)) {
                return undefined;
            }
            return rest.toLowerCase();
        };
        if (body.startsWith("g")) {
            const dot = dotFromPrefix("g");
            if (dot !== undefined) {
                gipf = true;
                body = dot;
            }
        } else if (body.startsWith("b") && this.usesGipfEntryNotation()) {
            const dot = dotFromPrefix("b");
            if (dot !== undefined) {
                downgradeBasic = true;
                body = dot;
            }
        } else if (body.endsWith("g")) {
            gipf = true;
            body = body.slice(0, -1);
        }
        const legacy = body.startsWith("+");
        const dot = (legacy ? body.slice(1) : body).toLowerCase();
        if (!this.graph.isDot(dot)) {
            return undefined;
        }
        if ((gipf || legacy) && !this.usesGipfEntryNotation()) {
            return undefined;
        }
        if (downgradeBasic) {
            return { dot, kind: "basic" };
        }
        if (gipf || legacy) {
            return { dot, kind: "gipf" };
        }
        return { dot, kind: "basic" };
    }

    private parseDotClear(m: string): string | undefined {
        if (!m.startsWith("!")) {
            return undefined;
        }
        const dot = m.slice(1).toLowerCase();
        return this.graph.isDot(dot) ? dot : undefined;
    }

    private formatPlayMove(dot: string, dest: string, kind: PieceKind): string {
        const base = `${dot}-${dest}`;
        if (kind === "gipf" && this.usesGipfEntryNotation()) {
            return `${base}G`;
        }
        return base;
    }

    /** Display `lastmove` with a capital G when the ply is a tournament GIPF entry. */
    private formatLastmove(m: string): string {
        if (m.startsWith("!") || m.startsWith("cap") || m.startsWith("x")) {
            return m;
        }
        const complete = this.parseCompleteMove(m);
        if (complete !== undefined && complete.kind === "gipf") {
            return `${complete.dot}-${complete.dest}G`;
        }
        const dotPlace = this.parseDotPlacement(m);
        if (dotPlace !== undefined && dotPlace.kind === "gipf" && !m.includes("-") && !m.startsWith("+")) {
            return `${dotPlace.dot}G`;
        }
        return m;
    }

    private moveMatchesPrefix(mv: string, prefix: string): boolean {
        return mv.toLowerCase().startsWith(prefix);
    }

    /** Tournament: first dot-push must be a GIPF entry; later plies may choose until a single locks GIPF out. */
    private mustEnterGipf(player: playerid): boolean {
        return (
            this.rulesVariant() === "tournament"
            && this.tournamentOpeningDone !== undefined
            && !this.tournamentOpeningDone[player - 1]
        );
    }

    private reconcileTournamentOpeningDone(stackIndex: number, legacyFrame = false): void {
        if (this.rulesVariant() !== "tournament") {
            return;
        }
        if (this.tournamentOpeningDone === undefined) {
            this.tournamentOpeningDone = [false, false];
        }
        if (legacyFrame) {
            if (stackIndex >= 1) {
                this.tournamentOpeningDone[0] = true;
            }
            if (stackIndex >= 2) {
                this.tournamentOpeningDone[1] = true;
            }
        }
        for (const p of [1, 2] as const) {
            if (this.gipfLocked?.[p - 1]) {
                this.tournamentOpeningDone[p - 1] = true;
            }
        }
    }

    private finishTournamentOpeningPly(player: playerid): void {
        if (this.rulesVariant() === "tournament" && this.tournamentOpeningDone !== undefined) {
            this.tournamentOpeningDone[player - 1] = true;
        }
    }

    private canUpgradePendingToGipf(): boolean {
        const pd = this.pendingDot;
        if (pd === undefined || pd.kind !== "basic") {
            return false;
        }
        if (!this.usesGipfEntryNotation() || this.gipfLocked?.[pd.owner - 1]) {
            return false;
        }
        return this.reserve[pd.owner - 1] >= 1;
    }

    private entryKindsForMoves(player: playerid): PieceKind[] {
        if (this.usesGipfEntryNotation()) {
            const kinds: PieceKind[] = [];
            if (this.canEnterKind("gipf", player)) {
                kinds.push("gipf");
            }
            if (this.canEnterKind("basic", player)) {
                kinds.push("basic");
            }
            return kinds;
        }
        return ["basic"];
    }

    private parseCompleteMove(m: string): { dot: string; dest: string; kind: PieceKind } | undefined {
        let rest = m;
        let gipf = false;
        if (m.startsWith("+")) {
            gipf = true;
            rest = m.slice(1);
        } else if (m.endsWith("g") && !m.endsWith("gipf")) {
            gipf = true;
            rest = m.slice(0, -1);
        }
        const sep = rest.includes("-") ? "-" : rest.includes(">") ? ">" : undefined;
        if (sep === undefined) {
            return undefined;
        }
        const parts = rest.split(sep);
        let dot = parts[0];
        const dest = parts[1];
        if (dot === undefined || dest === undefined || dest === "") {
            return undefined;
        }
        dot = dot.toLowerCase();
        if (gipf && !this.usesGipfEntryNotation()) {
            return undefined;
        }
        return { dot, dest: dest.toLowerCase(), kind: gipf ? "gipf" : "basic" };
    }

    private canEnterKind(kind: PieceKind, player: playerid): boolean {
        const rv = this.rulesVariant();
        if (kind === "gipf") {
            if (rv !== "tournament") {
                return false;
            }
            if (this.gipfLocked?.[player - 1]) {
                return false;
            }
            return this.reserve[player - 1] >= 2;
        }
        if (rv === "basic") {
            return this.reserve[player - 1] >= 1;
        }
        if (rv === "tournament" && this.mustEnterGipf(player)) {
            return false;
        }
        return this.reserve[player - 1] >= 1;
    }

    private canStartDotPlacement(dot: string, player: playerid): boolean {
        if (!this.graph.isDot(dot) || this.board.has(dot)) {
            return false;
        }
        if (this.capturePending) {
            return false;
        }
        if (this.usesGipfEntryNotation()) {
            if (this.reserve[player - 1] < 1) {
                return false;
            }
            for (const kind of this.entryKindsForMoves(player)) {
                const piece: CellPiece = { owner: player, kind };
                if (legalPushDestinations(this.board, this.graph, dot, piece).length > 0) {
                    return true;
                }
            }
            return false;
        }
        if (!this.canEnterKind("basic", player)) {
            return false;
        }
        const piece: CellPiece = { owner: player, kind: "basic" };
        return legalPushDestinations(this.board, this.graph, dot, piece).length > 0;
    }

    private dotPlacementBlocked(dot: string, kind: PieceKind): boolean {
        if (!this.graph.isDot(dot) || this.board.has(dot) || this.capturePending) {
            return false;
        }
        if (!this.canEnterKind(kind, this.currplayer)) {
            return false;
        }
        const piece: CellPiece = { owner: this.currplayer, kind };
        return legalPushDestinations(this.board, this.graph, dot, piece).length === 0;
    }

    private rowsNeedChoice(rows: CapturableRow[]): boolean {
        if (rows.length < 2) {
            return false;
        }
        for (let i = 0; i < rows.length; i++) {
            for (let j = i + 1; j < rows.length; j++) {
                const a = rows[i]!;
                const b = rows[j]!;
                if (a.cells.some((c) => b.cells.includes(c))) {
                    return true;
                }
            }
        }
        return false;
    }

    private beginCapturePhase(causedBy: playerid, rows: CapturableRow[]): void {
        const byActor = new Map<playerid, CapturableRow[]>();
        for (const row of rows) {
            const list = byActor.get(row.owner) ?? [];
            list.push(row);
            byActor.set(row.owner, list);
        }
        const order: playerid[] = [];
        if (byActor.has(causedBy)) {
            order.push(causedBy);
        }
        for (const p of [1, 2] as const) {
            if (p !== causedBy && byActor.has(p)) {
                order.push(p);
            }
        }
        this.capturePending = {
            causedBy,
            pending: order.map((actor) => ({ actor, rows: [...byActor.get(actor)!] })),
        };
        this.currplayer = this.capturePending.pending[0]!.actor;
        this.openCapturePhase();
    }

    private openCapturePhase(): void {
        const head = this.capturePending?.pending[0];
        if (head === undefined || head.rows.length === 0) {
            this.finishCaptureQueue();
            return;
        }
        if (this.rowsNeedChoice(head.rows)) {
            this.capturePending!.phase = { type: "choose-row", actor: head.actor, options: [...head.rows] };
        } else {
            const row = head.rows[0]!;
            const take = defaultGipfTake(row, this.board, head.actor, this.rulesVariant());
            const optionalGipf = optionalGipfOnRow(row, this.board, this.rulesVariant());
            const selectionMask = captureMaskFromTake(optionalGipf, take);
            this.capturePending!.phase = {
                type: "confirm",
                actor: head.actor,
                row,
                optionalGipf,
                take,
                selectionMask,
            };
        }
    }

    private applyCaptureSelectionMask(mask: number): void {
        const phase = this.captureConfirmPhase();
        if (phase === undefined) {
            return;
        }
        phase.selectionMask = mask;
        phase.take = takeSetForCaptureMask(phase.row, phase.optionalGipf, mask);
    }

    private finishCaptureQueue(): void {
        const causedBy = this.capturePending?.causedBy;
        this.capturePending = undefined;
        this.checkEOG();
        if (!this.gameover && causedBy !== undefined) {
            this.currplayer = ((causedBy % 2) + 1) as playerid;
        }
    }

    private pieceReserveUnits(p: CellPiece): number {
        return p.kind === "gipf" ? 2 : 1;
    }

    private applyCapture(take: Set<string>, row?: CapturableRow): void {
        const actor = this.currplayer;
        const order =
            row !== undefined ? row.cells.filter((c) => take.has(c)) : [...take].sort();
        let ownUnits = 0;
        let enemyUnits = 0;
        for (const cell of order) {
            const p = this.board.get(cell);
            if (p === undefined) {
                continue;
            }
            const units = this.pieceReserveUnits(p);
            if (p.owner === actor) {
                ownUnits += units;
            } else {
                enemyUnits += units;
            }
        }
        for (const cell of order) {
            const p = this.board.get(cell);
            if (p === undefined) {
                continue;
            }
            this.board.delete(cell);
            const idx = p.owner - 1;
            if (p.owner === actor) {
                this.reserve[idx] += this.pieceReserveUnits(p);
            }
        }
        if (order.length > 0) {
            this.results.push({
                type: "capture",
                how: "gipf-row",
                where: order.join(", "),
                count: ownUnits,
                what: String(enemyUnits),
                whose: actor,
            });
        }
    }

    private afterPlayPush(causedBy: playerid): void {
        const rows = findAllCapturableRows(this.board, this.graph);
        if (rows.length === 0) {
            this.checkEOG();
            if (!this.gameover) {
                this.currplayer = ((causedBy % 2) + 1) as playerid;
            }
            return;
        }
        this.beginCapturePhase(causedBy, rows);
    }

    public checkEOG(): void {
        if (this.gameover) {
            return;
        }
        const rv = this.rulesVariant();
        for (const p of [1, 2] as const) {
            const opp = (p % 2) + 1 as playerid;
            if (this.reserve[opp - 1] <= 0 || !this.canEnterAny(opp)) {
                this.gameover = true;
                this.winner = [p];
                this.results.push({ type: "eog", reason: "reserve" });
                return;
            }
            if (rv !== "basic" && this.gipfOnBoard(opp) === 0) {
                if (rv === "tournament" && this.stack.length < 3) {
                    continue;
                }
                this.gameover = true;
                this.winner = [p];
                this.results.push({ type: "eog", reason: "gipf" });
                return;
            }
        }
    }

    private canEnterAny(player: playerid): boolean {
        if (this.reserve[player - 1] <= 0) {
            return false;
        }
        for (const dot of this.graph.graph.nodes()) {
            if (!this.graph.isDot(dot) || this.board.has(dot)) {
                continue;
            }
            for (const kind of this.entryKindsForMoves(player)) {
                const piece: CellPiece = { owner: player, kind };
                if (legalPushDestinations(this.board, this.graph, dot, piece).length > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        const p = player ?? this.currplayer;
        if (p !== this.currplayer) {
            return [];
        }
        if (this.capturePending) {
            const phase = this.capturePending.phase;
            if (phase?.type === "choose-row" && phase.actor === p) {
                return phase.options.map((row) => this.defaultCaptureNotationForRow(row, phase.actor)).sort();
            }
            if (phase?.type === "confirm" && phase.actor === p) {
                return listCaptureConfirmMoves(phase.row, phase.optionalGipf).sort();
            }
            return [];
        }
        if (this.pendingDot !== undefined) {
            if (this.pendingDot.owner !== p) {
                return [];
            }
            const { cell, kind, owner } = this.pendingDot;
            if (this.mustEnterGipf(owner) && kind === "basic") {
                return [];
            }
            const piece: CellPiece = { owner, kind };
            return legalPushDestinations(this.board, this.graph, cell, piece).map((d) =>
                this.formatPlayMove(cell, d, kind),
            );
        }
        const list: string[] = [];
        for (const dot of this.graph.graph.nodes()) {
            if (!this.canStartDotPlacement(dot, p)) {
                continue;
            }
            for (const kind of this.entryKindsForMoves(p)) {
                const piece: CellPiece = { owner: p, kind };
                const dests = legalPushDestinations(this.board, this.graph, dot, piece);
                for (const d of dests) {
                    list.push(this.formatPlayMove(dot, d, kind));
                }
            }
        }
        return [...new Set(list)].sort();
    }

    private captureConfirmPhase(): Extract<CapturePhase, { type: "confirm" }> | undefined {
        const phase = this.capturePending?.phase;
        return phase?.type === "confirm" ? phase : undefined;
    }

    private captureInstructionsKey(): string {
        const phase = this.capturePending?.phase;
        if (phase?.type === "choose-row") {
            return "apgames:validation.gipf.INITIAL_INSTRUCTIONS_CHOOSE_ROW";
        }
        if (this.captureConfirmNeedsToggle()) {
            return "apgames:validation.gipf.INITIAL_INSTRUCTIONS_CAPTURE_OPTIONAL";
        }
        return "apgames:validation.gipf.INITIAL_INSTRUCTIONS_CAPTURE";
    }

    private isCaptureSelectionMove(m: string): boolean {
        const phase = this.captureConfirmPhase();
        return phase !== undefined && takeSetForCaptureMove(m, phase.row, phase.optionalGipf) !== undefined;
    }

    private captureConfirmNeedsToggle(): boolean {
        const phase = this.captureConfirmPhase();
        return phase !== undefined && phase.optionalGipf.length > 0;
    }

    private currentCaptureConfirmMove(): string {
        const phase = this.captureConfirmPhase();
        if (phase === undefined) {
            return "";
        }
        return formatCaptureMove(phase.row, phase.take);
    }

    private fullCaptureConfirmMove(): string {
        const phase = this.captureConfirmPhase();
        if (phase === undefined) {
            return "";
        }
        const take = defaultGipfTake(phase.row, this.board, phase.actor, this.rulesVariant());
        return formatCaptureMove(phase.row, take);
    }

    private captureConfirmSelectionKey(moveHint: string): string {
        const phase = this.captureConfirmPhase();
        if (phase === undefined) {
            return "";
        }
        const m = moveHint.toLowerCase().replace(/\s+/g, "");
        if (m.length > 0 && takeSetForCaptureMove(m, phase.row, phase.optionalGipf) !== undefined) {
            return m;
        }
        return this.currentCaptureConfirmMove();
    }

    private toggleCaptureConfirmMove(moveHint = ""): string | undefined {
        const phase = this.captureConfirmPhase();
        if (phase === undefined || phase.optionalGipf.length === 0) {
            return undefined;
        }
        const options = listCaptureConfirmMoves(phase.row, phase.optionalGipf);
        const current = this.captureConfirmSelectionKey(moveHint);
        const idx = options.indexOf(current);
        if (idx < 0) {
            return options[0];
        }
        return options[(idx + 1) % options.length]!;
    }

    private isMandatoryCaptureCell(cell: string): boolean {
        const phase = this.captureConfirmPhase();
        return phase !== undefined && phase.take.has(cell) && !phase.optionalGipf.includes(cell);
    }

    private defaultCaptureNotationForRow(row: CapturableRow, actor: playerid): string {
        const take = defaultGipfTake(row, this.board, actor, this.rulesVariant());
        return formatCaptureMove(row, take);
    }

    private chooseRowOptionIndex(m: string): number {
        const phase = this.capturePending?.phase;
        if (phase?.type !== "choose-row") {
            return -1;
        }
        return phase.options.findIndex((row) => this.defaultCaptureNotationForRow(row, phase.actor) === m);
    }

    /** Fully committed stack ply (not a partial dot placement). */
    private isCommittedMove(m: string): boolean {
        if (m === "cap") {
            return true;
        }
        if (this.isCaptureSelectionMove(m)) {
            return !this.captureConfirmNeedsToggle();
        }
        return this.parseCompleteMove(m) !== undefined;
    }

    /** Sole legal move, or single prefix completion when `automove` is enabled. */
    private suggestAutocomplete(m: string): string | undefined {
        if (m.startsWith("cap") || m.startsWith("x")) {
            return undefined;
        }
        const legal = this.moves();
        if (m.length === 0) {
            const confirm = this.captureConfirmPhase();
            if (confirm !== undefined && confirm.actor === this.currplayer) {
                return this.currentCaptureConfirmMove();
            }
            if (legal.length === 1) {
                return legal[0];
            }
            return undefined;
        }
        const dotOnly = this.parseDotPlacement(m);
        if (dotOnly !== undefined && !m.includes("-")) {
            if (this.pendingDot !== undefined && this.pendingDot.cell !== dotOnly.dot) {
                return undefined;
            }
            if (this.pendingDot !== undefined && this.pendingDot.cell === dotOnly.dot) {
                if (this.tournamentDotToggleAllowed(this.currplayer) || this.mustEnterGipf(this.currplayer)) {
                    return undefined;
                }
            }
            if (this.pendingDot === undefined && this.tournamentDotToggleAllowed(this.currplayer)) {
                return undefined;
            }
            const dotPrefix = `${dotOnly.dot}-`;
            const dotMatches = legal.filter((mv) => mv.toLowerCase().startsWith(dotPrefix));
            if (dotMatches.length === 1) {
                return dotMatches[0];
            }
        }
        const matches = legal.filter((mv) => this.moveMatchesPrefix(mv, m));
        if (matches.length === 1 && matches[0] !== m) {
            return matches[0];
        }
        return undefined;
    }

    private applyAutocomplete(result: IValidationResult, m: string): void {
        const suggested = this.suggestAutocomplete(m);
        if (suggested === undefined) {
            return;
        }
        result.autocomplete = suggested;
        if (!this.isCommittedMove(suggested)) {
            return;
        }
        const dotOnly = m.length > 0 ? this.parseDotPlacement(m) : undefined;
        const dotComplete =
            dotOnly !== undefined
            && !m.includes("-")
            && suggested.toLowerCase().startsWith(`${dotOnly.dot}-`);
        const legal = this.moves();
        if (legal.length === 1) {
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return;
        }
        if (dotComplete && suggested !== m) {
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return;
        }
        if (m.length > 0 && suggested !== m) {
            const matches = legal.filter((mv) => this.moveMatchesPrefix(mv, m));
            if (matches.length === 1 && matches[0] === suggested) {
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };
        m = m.toLowerCase().replace(/\s+/g, "");

        if (m.length === 0) {
            result.complete = -1;
            if (this.capturePending) {
                result.valid = false;
                result.message = i18next.t(this.captureInstructionsKey());
                if (this.captureConfirmPhase() !== undefined) {
                    this.applyAutocomplete(result, m);
                    if (this.captureConfirmNeedsToggle()) {
                        result.complete = 0;
                        result.canrender = true;
                    } else if (result.autocomplete !== undefined) {
                        result.complete = 1;
                    }
                }
                return result;
            }
            result.valid = true;
            if (this.pendingDot) {
                result.message = i18next.t("apgames:validation.gipf.INITIAL_INSTRUCTIONS_PUSH");
            } else {
                result.message = i18next.t(this.placementInstructionsKey());
            }
            this.applyAutocomplete(result, m);
            return result;
        }

        const choosePhase = this.capturePending?.phase;
        if (choosePhase?.type === "choose-row" && choosePhase.actor === this.currplayer) {
            if (this.chooseRowOptionIndex(m) >= 0) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.gipf.INITIAL_INSTRUCTIONS_CAPTURE");
                return result;
            }
            if (m.startsWith("x")) {
                return result;
            }
        }

        const confirmPhase = this.captureConfirmPhase();
        if (confirmPhase !== undefined && confirmPhase.actor === this.currplayer) {
            if (takeSetForCaptureMove(m, confirmPhase.row, confirmPhase.optionalGipf) !== undefined) {
                result.valid = true;
                const optionalChoice = this.captureConfirmNeedsToggle();
                result.complete = optionalChoice ? 0 : 1;
                if (optionalChoice) {
                    result.canrender = true;
                }
                result.message =
                    optionalChoice
                        ? i18next.t(this.captureInstructionsKey())
                        : i18next.t("apgames:validation._general.VALID_MOVE");
                if (!optionalChoice) {
                    this.applyAutocomplete(result, m);
                }
                return result;
            }
        }

        if (m === "cap" && this.captureConfirmPhase() !== undefined) {
            result.valid = true;
            result.complete = this.captureConfirmNeedsToggle() ? 0 : 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const complete = this.parseCompleteMove(m);
        if (complete !== undefined) {
            if (this.capturePending) {
                return result;
            }
            const { dot, dest, kind } = complete;
            if (!this.graph.isDot(dot)) {
                return result;
            }
            if (pushEntrySpot(this.graph, dot, dest) === undefined) {
                return result;
            }
            const pd = this.pendingDot;
            if (pd !== undefined) {
                if (pd.owner !== this.currplayer || pd.cell !== dot || pd.kind !== kind) {
                    return result;
                }
                const piece: CellPiece = { owner: pd.owner, kind };
                const sim = simulatePush(this.board, this.graph, dot, dest, piece);
                if (!sim.ok) {
                    result.message = i18next.t("apgames:validation.gipf.BLOCKED_LINE");
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            if (this.board.has(dot)) {
                result.message = i18next.t("apgames:validation.gipf.DOT_OCCUPIED");
                return result;
            }
            if (!this.canEnterKind(kind, this.currplayer)) {
                return result;
            }
            if (this.mustEnterGipf(this.currplayer) && kind === "basic") {
                return result;
            }
            const piece: CellPiece = { owner: this.currplayer, kind };
            const sim = simulatePush(this.board, this.graph, dot, dest, piece);
            if (!sim.ok) {
                result.message = i18next.t("apgames:validation.gipf.BLOCKED_LINE");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const dotClear = this.parseDotClear(m);
        if (dotClear !== undefined) {
            const pd = this.pendingDot;
            if (pd !== undefined && pd.cell === dotClear && pd.owner === this.currplayer) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t(this.placementInstructionsKey());
                return result;
            }
            const onDot = this.board.get(dotClear);
            if (
                onDot !== undefined
                && onDot.owner === this.currplayer
                && this.graph.isDot(dotClear)
                && !this.capturePending
            ) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t(this.placementInstructionsKey());
                return result;
            }
            return result;
        }

        const dotPlace = this.parseDotPlacement(m);
        if (dotPlace !== undefined) {
            if (this.capturePending) {
                result.message = i18next.t("apgames:validation.gipf.MUST_CAPTURE");
                return result;
            }
            const { dot, kind } = dotPlace;
            if (!this.graph.isDot(dot)) {
                result.message = i18next.t("apgames:validation.gipf.NOT_DOT", { where: dot });
                return result;
            }
            if (this.pendingDot !== undefined && this.pendingDot.cell === dot) {
                if (kind === "gipf" && this.pendingDot.owner === this.currplayer && this.pendingDot.kind === "basic") {
                    if (!this.canUpgradePendingToGipf()) {
                        return result;
                    }
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gipf.INITIAL_INSTRUCTIONS_PUSH");
                    this.applyAutocomplete(result, m);
                    return result;
                }
                if (
                    kind === "basic"
                    && this.pendingDot.owner === this.currplayer
                    && this.pendingDot.kind === "gipf"
                    && this.tournamentDotToggleAllowed(this.currplayer)
                ) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t(this.placementInstructionsKey());
                    this.applyAutocomplete(result, m);
                    return result;
                }
                if (this.pendingDot.owner !== this.currplayer || this.pendingDot.kind !== kind) {
                    return result;
                }
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.gipf.INITIAL_INSTRUCTIONS_PUSH");
                this.applyAutocomplete(result, m);
                return result;
            }
            if (this.pendingDot !== undefined) {
                return result;
            }
            if (this.board.has(dot)) {
                result.message = i18next.t("apgames:validation.gipf.DOT_OCCUPIED");
                return result;
            }
            const pieceKind: PieceKind = kind === "gipf" ? "gipf" : "basic";
            if (!this.canEnterKind(pieceKind, this.currplayer)) {
                return result;
            }
            if (!this.canStartDotPlacement(dot, this.currplayer)) {
                if (this.dotPlacementBlocked(dot, pieceKind)) {
                    result.message = i18next.t("apgames:validation.gipf.BLOCKED_LINE");
                }
                return result;
            }
            if (this.dotPlacementBlocked(dot, pieceKind)) {
                result.message = i18next.t("apgames:validation.gipf.BLOCKED_LINE");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.gipf.INITIAL_INSTRUCTIONS_PUSH");
            this.applyAutocomplete(result, m);
            return result;
        }

        if (this.pendingDot !== undefined && !m.startsWith("cap")) {
            const pd = this.pendingDot;
            const complete = this.parseCompleteMove(m);
            if (complete !== undefined && complete.dot === pd.cell) {
                return this.validateMove(m);
            }
            const along = m.includes("-") ? m.split("-").pop()! : m;
            const entry = pushEntrySpot(this.graph, pd.cell, along);
            if (entry !== undefined) {
                if (this.mustEnterGipf(pd.owner) && pd.kind === "basic") {
                    return result;
                }
                return this.validateMove(this.formatPlayMove(pd.cell, entry, pd.kind));
            }
        }

        return result;
    }

    /** Tablero-style scratch: apply an incomplete move-box fragment before interpreting clicks. */
    private clickContextFromMove(move: string): GipfGame {
        const trimmed = move.toLowerCase().replace(/\s+/g, "");
        if (trimmed.length === 0) {
            return this;
        }
        const pre = this.validateMove(trimmed);
        if (!pre.valid || pre.complete !== -1) {
            return this;
        }
        const ctx = this.clone();
        ctx.move(trimmed, { partial: true, trusted: true });
        return ctx;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cells = this.graph.listCells(true) as string[][];
            const cell = cells[row]?.[col];
            if (cell === undefined) {
                throw new Error("Invalid click");
            }
            const ctx = this.clickContextFromMove(move);
            let newmove = move;
            if (ctx.capturePending?.phase?.type === "choose-row") {
                const options = ctx.capturePending.phase.options;
                const matching = options
                    .map((rowOpt, index) => ({ index, rowOpt }))
                    .filter(({ rowOpt }) => rowOpt.cells.includes(cell));
                let hit = -1;
                if (matching.length === 1) {
                    hit = matching[0]!.index;
                } else if (matching.length > 1) {
                    const unique = matching.filter(
                        ({ index }) => !options.some((other, j) => j !== index && other.cells.includes(cell)),
                    );
                    hit = (unique[0] ?? matching[0]!).index;
                }
                if (hit >= 0) {
                    const pick = options[hit]!;
                    newmove = ctx.defaultCaptureNotationForRow(pick, ctx.capturePending!.phase!.actor);
                }
            } else if (ctx.captureConfirmPhase() !== undefined) {
                const phase = ctx.captureConfirmPhase()!;
                const moveHint = move.toLowerCase().replace(/\s+/g, "");
                if (phase.optionalGipf.includes(cell)) {
                    const toggled = ctx.toggleCaptureConfirmMove(moveHint);
                    if (toggled !== undefined) {
                        newmove = toggled;
                    }
                } else if (ctx.isMandatoryCaptureCell(cell)) {
                    newmove = ctx.fullCaptureConfirmMove();
                }
            } else if (ctx.pendingDot !== undefined) {
                if (ctx.rulesVariant() === "tournament" && cell === ctx.pendingDot.cell) {
                    if (ctx.tournamentDotToggleAllowed(ctx.pendingDot.owner)) {
                        if (ctx.pendingDot.kind === "gipf") {
                            newmove = cell;
                        } else {
                            newmove = `!${cell}`;
                        }
                    }
                } else {
                    const entry = pushEntrySpot(ctx.graph, ctx.pendingDot.cell, cell);
                    if (entry !== undefined) {
                        newmove = ctx.formatPlayMove(ctx.pendingDot.cell, entry, ctx.pendingDot.kind);
                    }
                }
            } else if (ctx.graph.isDot(cell) && !ctx.board.has(cell)) {
                newmove = ctx.usesGipfEntryNotation()
                    ? ctx.tournamentEmptyDotMove(cell, move)
                    : cell;
            } else if (move !== "") {
                const dotPlace = ctx.parseDotPlacement(move);
                if (dotPlace) {
                    const entry = pushEntrySpot(ctx.graph, dotPlace.dot, cell);
                    if (entry !== undefined) {
                        newmove = ctx.formatPlayMove(dotPlace.dot, entry, dotPlace.kind);
                    }
                }
            }
            if (newmove.length > 0 && (newmove.includes("-") || newmove.startsWith("cap") || newmove.startsWith("x"))) {
                const sole = ctx.moves().filter((mv) => ctx.moveMatchesPrefix(mv, newmove.toLowerCase()));
                if (sole.length === 1) {
                    newmove = sole[0]!;
                }
            }
            let result = ctx.validateMove(newmove || cell) as IClickResult;
            if (result.autocomplete !== undefined) {
                newmove = result.autocomplete;
                result = ctx.validateMove(newmove) as IClickResult;
            }
            if (result.valid && this.parseDotClear(newmove) !== undefined) {
                result.autocomplete = newmove;
                result.move = "";
                result.canrender = true;
                result.complete = -1;
            } else if (
                ctx.captureConfirmPhase() !== undefined &&
                ctx.captureConfirmNeedsToggle() &&
                (ctx.captureConfirmPhase()!.optionalGipf.includes(cell) || ctx.isMandatoryCaptureCell(cell))
            ) {
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t(ctx.captureInstructionsKey());
            }
            if (!result.valid) {
                result.move = move;
            } else if (result.move !== "") {
                result.move = newmove || cell;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move,
                    row,
                    col,
                    piece,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    public move(m: string, { trusted = false, partial = false } = {}): GipfGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            return this;
        }
        if (!trusted) {
            const v = this.validateMove(m);
            if (!v.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", v.message);
            }
        }

        this.results = [];
        const player = this.currplayer;

        const confirmPhase = this.captureConfirmPhase();
        if (confirmPhase !== undefined && takeSetForCaptureMove(m, confirmPhase.row, confirmPhase.optionalGipf) !== undefined) {
            const mask = captureMaskForMove(m, confirmPhase.row, confirmPhase.optionalGipf);
            if (mask !== undefined) {
                this.applyCaptureSelectionMask(mask);
            }
            if (confirmPhase.optionalGipf.length > 0 && partial) {
                this.lastmove = this.currentCaptureConfirmMove();
                this.saveState();
                return this;
            }
            this.doCaptureMove(m);
            this.saveState();
            return this;
        }

        const capturePhase = this.capturePending?.phase;
        if (capturePhase?.type === "choose-row") {
            const pick = this.chooseRowOptionIndex(m);
            if (pick >= 0) {
                this.selectCaptureRow(pick);
                if (!partial) {
                    const confirm = this.captureConfirmPhase();
                    if (
                        confirm !== undefined
                        && !this.captureConfirmNeedsToggle()
                        && takeSetForCaptureMove(m, confirm.row, confirm.optionalGipf) !== undefined
                    ) {
                        this.doCaptureMove(m);
                    }
                }
                this.saveState();
                return this;
            }
        }

        if (m === "cap") {
            this.doCaptureMove(m);
            this.saveState();
            return this;
        }

        const dotClear = this.parseDotClear(m);
        if (dotClear !== undefined) {
            if (this.pendingDot?.cell === dotClear && this.pendingDot.owner === player) {
                this.clearPendingDot(dotClear, player);
            } else {
                this.clearOrphanDotPlacement(dotClear, player);
            }
            this.lastmove = this.formatLastmove(m);
            this.saveState();
            return this;
        }

        const complete = this.parseCompleteMove(m);
        if (complete !== undefined) {
            this.doPlayMove(complete.dot, complete.dest, complete.kind, player);
            this.lastmove = this.formatLastmove(m);
            this.saveState();
            return this;
        }

        const dotUpgrade = this.parseDotPlacement(m);
        if (dotUpgrade?.kind === "gipf" && this.pendingDot?.cell === dotUpgrade.dot && this.pendingDot.kind === "basic") {
            this.upgradePendingDot(player);
            this.lastmove = this.formatLastmove(m);
            this.saveState();
            return this;
        }

        const dotDowngrade = this.parseDotPlacement(m);
        if (
            dotDowngrade?.kind === "basic"
            && this.pendingDot?.cell === dotDowngrade.dot
            && this.pendingDot.kind === "gipf"
        ) {
            this.downgradePendingToBasic(player);
            this.lastmove = this.formatLastmove(m);
            this.saveState();
            return this;
        }

        const dotPlace = this.parseDotPlacement(m);
        if (
            dotPlace !== undefined
            && this.pendingDot !== undefined
            && this.pendingDot.cell === dotPlace.dot
            && this.pendingDot.owner === player
            && this.pendingDot.kind === dotPlace.kind
        ) {
            this.lastmove = this.formatLastmove(m);
            this.saveState();
            return this;
        }
        if (dotPlace !== undefined && this.pendingDot === undefined) {
            const cost = dotPlace.kind === "gipf" ? 2 : 1;
            this.reserve[player - 1] -= cost;
            this.pendingDot = { cell: dotPlace.dot, owner: player, kind: dotPlace.kind };
            this.board.set(dotPlace.dot, { owner: player, kind: dotPlace.kind });
            this.results.push({ type: "place", where: dotPlace.dot });
            this.lastmove = this.formatLastmove(m);
            this.saveState();
            return this;
        }

        throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
    }

    private doPlayMove(dot: string, dest: string, kind: PieceKind, player: playerid): void {
        const piece: CellPiece = { owner: player, kind };
        let cost = kind === "gipf" ? 2 : 1;
        if (this.pendingDot?.cell === dot) {
            this.pendingDot = undefined;
            cost = 0;
        } else {
            this.reserve[player - 1] -= cost;
            this.board.set(dot, piece);
        }
        const sim = simulatePush(this.board, this.graph, dot, dest, piece);
        if (!sim.ok) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.BLOCKED_LINE"));
        }
        this.board = sim.board;
        if (cost > 0) {
            /* already deducted */
        }
        if (this.rulesVariant() === "tournament" && kind === "basic" && this.gipfLocked) {
            this.gipfLocked[player - 1] = true;
        }
        if (this.mustEnterGipf(player) && kind !== "gipf") {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.MUST_ENTER_GIPF"));
        }
        this.results.push({ type: "move", from: dot, to: dest });
        this.finishTournamentOpeningPly(player);
        this.afterPlayPush(player);
    }

    private upgradePendingDot(player: playerid): void {
        const pd = this.pendingDot;
        if (pd === undefined || pd.owner !== player || pd.kind !== "basic") {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        if (!this.canUpgradePendingToGipf()) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        this.reserve[player - 1] -= 1;
        pd.kind = "gipf";
        this.board.set(pd.cell, { owner: player, kind: "gipf" });
    }

    private downgradePendingToBasic(player: playerid): void {
        const pd = this.pendingDot;
        if (pd === undefined || pd.owner !== player || pd.kind !== "gipf") {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        if (!this.tournamentDotToggleAllowed(player)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        pd.kind = "basic";
        this.reserve[player - 1] += 1;
        this.board.set(pd.cell, { owner: player, kind: "basic" });
    }

    private clearPendingDot(dot: string, player: playerid): void {
        const pd = this.pendingDot;
        if (pd === undefined || pd.cell !== dot || pd.owner !== player) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        const refund = pd.kind === "gipf" ? 2 : 1;
        this.board.delete(dot);
        this.reserve[player - 1] += refund;
        this.pendingDot = undefined;
    }

    /** Dot piece visible on the board without `pendingDot` (interim partial / desync). */
    private clearOrphanDotPlacement(dot: string, player: playerid): void {
        const onDot = this.board.get(dot);
        if (onDot === undefined || onDot.owner !== player || !this.graph.isDot(dot)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        const refund = onDot.kind === "gipf" ? 2 : 1;
        this.board.delete(dot);
        this.reserve[player - 1] += refund;
        if (this.pendingDot?.cell === dot) {
            this.pendingDot = undefined;
        }
    }

    /** Row picked during choose-row; opens confirm before pieces are removed. */
    private selectCaptureRow(index: number): void {
        const phase = this.capturePending?.phase;
        if (phase?.type !== "choose-row") {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.MUST_CAPTURE"));
        }
        const row = phase.options[index];
        if (row === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.MUST_CAPTURE"));
        }
        const actor = phase.actor;
        const take = defaultGipfTake(row, this.board, actor, this.rulesVariant());
        const optionalGipf = optionalGipfOnRow(row, this.board, this.rulesVariant());
        this.capturePending!.chooseRowPeers = phase.options.map((r) => r.id);
        this.capturePending!.phase = {
            type: "confirm",
            actor,
            row,
            optionalGipf,
            take,
            selectionMask: captureMaskFromTake(optionalGipf, take),
        };
        this.lastmove = formatCaptureMove(row, take);
    }

    private doCaptureMove(m: string): void {
        const phase = this.capturePending?.phase;
        if (phase === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.MUST_CAPTURE"));
        }
        let row: CapturableRow;
        let take: Set<string>;
        if (phase.type === "confirm") {
            row = phase.row;
            if (m === "cap") {
                take = new Set(phase.take);
            } else {
                const parsed = takeSetForCaptureMove(m, row, phase.optionalGipf);
                if (parsed === undefined) {
                    throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.MUST_CAPTURE"));
                }
                take = parsed;
            }
        } else {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.gipf.MUST_CAPTURE"));
        }
        this.applyCapture(take, row);
        this.lastmove = formatCaptureMove(row, take);

        const head = this.capturePending!.pending[0]!;
        const peers = this.capturePending!.chooseRowPeers;
        if (peers !== undefined && peers.includes(row.id)) {
            const peerSet = new Set(peers);
            head.rows = head.rows.filter((r) => !peerSet.has(r.id));
            delete this.capturePending!.chooseRowPeers;
        } else {
            head.rows = head.rows.filter((r) => r.id !== row.id);
        }

        if (head.rows.length > 0) {
            this.openCapturePhase();
        } else {
            this.capturePending!.pending.shift();
            if (this.capturePending!.pending.length === 0) {
                this.finishCaptureQueue();
            } else {
                this.currplayer = this.capturePending!.pending[0]!.actor;
                this.openCapturePhase();
            }
        }
        this.checkEOG();
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return { func: "custom", default: GIPF_P1, palette: 1 };
        }
        return { func: "custom", default: GIPF_P2, palette: 2 };
    }

    public sidebarScores(): IScores[] {
        return [
            {
                name: this.neutralAreaLabel("apgames:status.PIECESINHAND"),
                scores: [this.reserve[0], this.reserve[1]],
            },
        ];
    }

    public render(): APRenderRep {
        const p1 = this.getPlayerColour(1);
        const p2 = this.getPlayerColour(2);
        let pstr = "";
        for (const row of this.graph.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (!this.board.has(cell)) {
                    pieces.push("-");
                } else {
                    const c = this.board.get(cell)!;
                    if (c.owner === 1) {
                        pieces.push(c.kind === "gipf" ? "B" : "A");
                    } else {
                        pieces.push(c.kind === "gipf" ? "D" : "C");
                    }
                }
            }
            pstr += pieces.join(",");
        }

        const rep: APRenderRep = {
            options: ["reverse-numbers"],
            board: {
                style: "gipf",
                minWidth: 5,
                maxWidth: 9,
                rotate: 90,
            },
            legend: {
                A: { name: "piece", colour: p1 },
                B: {
                    name: "piece-chariot",
                    paint: {
                        fill: p1,
                        border: GIPF_P1_CHARIOT_BORDER,
                        inner: GIPF_P1_CHARIOT_INNER_COLOUR,
                    },
                },
                C: { name: "piece", colour: p2 },
                D: {
                    name: "piece-chariot",
                    paint: {
                        fill: p2,
                        border: GIPF_P2_CHARIOT_BORDER,
                        inner: GIPF_P2_CHARIOT_INNER_COLOUR,
                    },
                },
            },
            pieces: pstr,
        };

        rep.annotations = [];
        const graph = this.graph;
        const r = this.stack[this.stack.length - 1]._results;
        for (const res of r) {
            if (res.type === "move" && res.from && res.to) {
                const [fx, fy] = graph.algebraic2coords(res.from);
                const [tx, ty] = graph.algebraic2coords(res.to);
                rep.annotations.push({
                    type: "move",
                    targets: [
                        { row: fy, col: fx },
                        { row: ty, col: tx },
                    ],
                });
            }
        }
        const capPhase = this.capturePending?.phase;
        const coordTargets = (cells: string[]) =>
            cells.map((cell) => {
                const [x, y] = graph.algebraic2coords(cell);
                return { row: y, col: x };
            });
        const lineAnnotation = (cells: string[]) => {
            const targets = coordTargets(cells);
            const annotations = rep.annotations!;
            if (targets.length >= 2) {
                annotations.push({
                    type: "line",
                    targets: targets as [
                        { row: number; col: number },
                        { row: number; col: number },
                        ...{ row: number; col: number }[],
                    ],
                });
            }
        };
        const exitOnCells = (cells: string[]) => {
            for (const cell of cells) {
                const [x, y] = graph.algebraic2coords(cell);
                rep.annotations!.push({
                    type: "exit",
                    shape: "circle",
                    targets: [{ row: y, col: x }],
                });
            }
            lineAnnotation(cells);
        };
        if (capPhase?.type === "confirm") {
            const removal = capPhase.row.cells.filter((c) => capPhase.take.has(c) && this.board.has(c));
            exitOnCells(removal);
        } else if (capPhase?.type === "choose-row") {
            const marked = new Set<string>();
            for (const row of capPhase.options) {
                const candidates = row.cells.filter((c) => this.board.has(c));
                lineAnnotation(candidates);
                for (const cell of candidates) {
                    if (marked.has(cell)) {
                        continue;
                    }
                    marked.add(cell);
                    const [x, y] = graph.algebraic2coords(cell);
                    rep.annotations!.push({
                        type: "exit",
                        shape: "circle",
                        targets: [{ row: y, col: x }],
                    });
                }
            }
        } else {
            for (const res of r) {
                if (res.type !== "capture" || res.how !== "gipf-row" || res.where === undefined) {
                    continue;
                }
                const cells = res.where
                    .split(",")
                    .map((c) => c.trim().toLowerCase())
                    .filter((c) => c.length > 0);
                exitOnCells(cells);
            }
        }
        return rep;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "move":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:gipf.MOVE.push", {
                    from: r.from!,
                    to: r.to!,
                });
                return true;
            case "capture":
                if (r.how === "gipf-row" && r.where !== undefined) {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:gipf.CAPTURE.rowSummary", {
                        cells: r.where,
                        ownCount: r.count ?? 0,
                        enemyCount: parseInt(r.what ?? "0", 10),
                    });
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "eog":
                return this.collectEogChatLogLine(lines, r, ctx);
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    protected gipfEogWinnerSeat(ctx: ChatLogCollectContext): number {
        const winResult = ctx.results.find((x) => x.type === "winners");
        if (winResult?.type === "winners" && winResult.players.length > 0) {
            return winResult.players[0]!;
        }
        if (this.winner.length > 0) {
            return this.winner[0]!;
        }
        return ctx.defaultSeat;
    }

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        const winnerSeat = this.gipfEogWinnerSeat(ctx);
        const textKey =
            r.reason === "gipf" ? "apresults:gipf.EOG.gipf" : "apresults:gipf.EOG.reserve";
        return {
            actor: this.getChatActorRef(winnerSeat),
            textKey,
            textParams: { player: chatPlayerToken(winnerSeat) },
        };
    }

    public eogSubjectSeat(): number | undefined {
        return this.winner.length > 0 ? this.winner[0] : undefined;
    }

    public state(): IGipfState {
        return {
            game: GipfGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const s: IMoveState = {
            _version: GipfGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            board: cloneState(this.board) as Map<string, CellPiece>,
            reserve: [...this.reserve] as [number, number],
            lastmove: this.lastmove,
        };
        if (this.gipfLocked !== undefined) {
            s.gipfLocked = [...this.gipfLocked];
        }
        if (this.tournamentOpeningDone !== undefined) {
            s.tournamentOpeningDone = [...this.tournamentOpeningDone];
        }
        if (this.pendingDot !== undefined) {
            s.pendingDot = { ...this.pendingDot };
        }
        if (this.capturePending !== undefined) {
            s.capturePending = cloneState(this.capturePending) as CapturePending;
        }
        return s;
    }

    public clone(): GipfGame {
        return new GipfGame(this.state());
    }
}