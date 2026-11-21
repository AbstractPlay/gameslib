import {
    IAPGameState,
    IClickResult,
    IScores,
    IValidationResult,
    type ChatLogCollectContext,
    type ChatLogLine,
} from "./_base.js";
import { GameBaseSequenced, sequencedShouldCloseRound } from "./_turn-sequenced.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, type Colourfuncs, type RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, cloneState } from "../common/index.js";
import { chatPlayerToken } from "../common/chat-log.js";
import { YinshGraph, YINSH_BLOCKED_RENDER } from "../common/graphs/yinsh.js";
import i18next from "i18next";
import type { IGamePly } from "./_turn-model.js";
import {
    YINSH_BORDER,
    YINSH_P1,
    YINSH_P2,
    STANDARD_SCORE_GOAL,
    type CapturableRow,
    type IMoveState,
    type IYinshState,
    type playerid,
    type RowPhase,
    type RowPending,
} from "./yinsh/types.js";
import { freshMoveState } from "./yinsh/setup.js";
import { applyRingMove, legalRingDestinations, simulateRingMove } from "./yinsh/move.js";
import {
    defaultMarkerTake,
    findAllCapturableRows,
    rowsNeedChoice,
    isValidMarkerTake,
    markerTakeFromSpan,
    rowNeedsSegmentChoice,
    rowSetKey,
    takeIsOnRowCore,
} from "./yinsh/rows.js";
import {
    formatMarkerRowMove,
    formatRingRemovalMove,
    listMarkerRowMoves,
    parseRingRemovalMove,
    takeSetForMarkerMove,
} from "./yinsh/row-notation.js";

function yinshContrastBorder(fill: Colourfuncs, palette: 3 | 4): Colourfuncs {
    return {
        func: "custom",
        default: { func: "bestContrast", bg: fill, fg: ["#000000", "#ffffff"] },
        palette,
    };
}

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS_SETUP: "Click an empty intersection to place a ring from your reserve.",
        INITIAL_INSTRUCTIONS: "Click one of your rings, then click a destination along a line.",
        INITIAL_INSTRUCTIONS_ROW: "Remove the five markers in the row, then remove one of your rings.",
        INITIAL_INSTRUCTIONS_SEGMENT:
            "Click markers to drop any outside the five you remove. Submit when exactly five in a row remain highlighted.",
        INITIAL_INSTRUCTIONS_CHOOSE_ROW: "Click a highlighted row to choose which five markers to remove.",
        INITIAL_INSTRUCTIONS_REMOVE_RING: "Click one of your rings to score it.",
        BLOCKED: "That intersection is not on the board.",
        OCCUPIED: "There is already a ring on that intersection.",
        MUST_RESOLVE_ROW: "You must complete row removal before continuing.",
        NO_MARKERS: "There are no markers left in the pool.",
        NOT_YOUR_RING: "That is not your ring.",
    },
    status: {
        SCORE: "Score",
    },
    variants: {
        blitz: {
            name: "Blitz",
            description: "Win by scoring one ring (forming one row of five markers).",
        },
    },
};

export const gameApresultsEn = {
    MOVE: {
        ring: "{{player}} moved a ring from {{from}} to {{to}}.",
    },
    ROW: {
        markers: "{{player}} removed a row of markers: {{cells}}.",
        ring: "{{player}} scored a ring from {{where}}.",
    },
    EOG: {
        score: "{{player}} wins with {{count}} scored rings.",
        pool: "The marker pool is empty; {{player}} wins with more scored rings.",
        draw: "The marker pool is empty with equal scored rings; the game is a draw.",
    },
};

export type { IMoveState, IYinshState };

export class YinshGame extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "YINSH",
        uid: "yinsh",
        playercounts: [2],
        version: "20261121",
        dateAdded: "2026-11-21",
        description:
            "Place rings, then each turn drop a marker into a ring and slide the ring along a line, flipping jumped markers. Form rows of five of your colour to remove markers and score a ring.",
        urls: [
            "https://www.gipf.com/yinsh/rules/rules.html",
            "https://boardgamegeek.com/boardgame/434/ying-yang-yinsh",
        ],
        bggid: "434",
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
        variants: [{ uid: "blitz", group: "rules" }],
        customizations: [
            { num: 1, default: YINSH_P1, explanation: "Player 1 marker fill", player: 1 },
            { num: 2, default: YINSH_P2, explanation: "Player 2 marker fill", player: 2 },
            {
                num: 3,
                default: YINSH_BORDER,
                explanation: "Player 1 ring and marker border (overrides automatic contrast when set)",
                player: 1,
            },
            {
                num: 4,
                default: YINSH_BORDER,
                explanation: "Player 2 ring and marker border (overrides automatic contrast when set)",
                player: 2,
            },
        ],
        categories: [
            "goal>score",
            "mechanic>place",
            "mechanic>move",
            "mechanic>flip",
            "board>shape>hex",
            "board>connect>hex",
            "components>special",
            "family>gipf",
        ],
        flags: ["custom-colours", "automove", "experimental"],
    };

    public readonly graph = new YinshGraph();
    public numplayers = 2;
    public currplayer: playerid = 1;
    public phase: "setup" | "play" = "setup";
    public rings!: Map<string, playerid>;
    public markers!: Map<string, playerid>;
    public ringsReserve: [number, number] = [5, 5];
    public markersInPool = 51;
    public score: [number, number] = [0, 0];
    public rowPending?: RowPending;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    /** Ephemeral: ring origin while `from-` is in the move box (partial placement UI). */
    private ringSelect?: string;
    private ringHighlights: string[] = [];

    constructor(state?: IYinshState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.stack = [freshMoveState(YinshGame.gameinfo.version)];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IYinshState;
            }
            if (state.game !== YinshGame.gameinfo.uid) {
                throw new Error(`The YINSH engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public scoreGoal(): number {
        return this.variants.includes("blitz") ? 1 : STANDARD_SCORE_GOAL;
    }

    public load(idx = -1): YinshGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error("Could not load the requested state from the stack.");
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.phase = state.phase;
        this.rings = cloneState(state.rings) as Map<string, playerid>;
        this.markers = cloneState(state.markers) as Map<string, playerid>;
        this.ringsReserve = [...state.ringsReserve] as [number, number];
        this.markersInPool = state.markersInPool;
        this.score = [...state.score] as [number, number];
        this.rowPending = state.rowPending ? (cloneState(state.rowPending) as RowPending) : undefined;
        this.lastmove = state.lastmove;
        this.clearRingPartialUi();
        this.refreshRowPendingFromBoard();
        return this;
    }

    /** Drop stale row options from older saves (subset lines, duplicate line keys). */
    private refreshRowPendingFromBoard(): void {
        if (this.rowPending === undefined || this.phase !== "play") {
            return;
        }
        const prev = this.rowPending.phase;
        if (prev?.type === "remove-ring") {
            return;
        }
        for (const entry of this.rowPending.pending) {
            entry.rows = findAllCapturableRows(this.markers, this.rings, this.graph).filter(
                (r) => r.owner === entry.actor,
            );
        }
        const head = this.rowPending.pending[0];
        if (head === undefined || head.rows.length === 0) {
            this.finishRowQueue();
            return;
        }
        if (prev?.type === "confirm-markers") {
            const match =
                head.rows.find((r) => r.id === prev.row.id) ??
                head.rows.find((r) => rowSetKey(r) === rowSetKey(prev.row));
            if (match !== undefined) {
                let take = prev.take;
                if (rowNeedsSegmentChoice(match)) {
                    if (!takeIsOnRowCore(match, take)) {
                        take = new Set(match.core);
                    }
                } else if (!isValidMarkerTake(match, take)) {
                    take = defaultMarkerTake(match);
                }
                this.rowPending.phase = {
                    type: "confirm-markers",
                    actor: prev.actor,
                    row: match,
                    take,
                };
                return;
            }
        }
        this.openRowPhase();
    }

    private clearRingPartialUi(): void {
        this.ringSelect = undefined;
        this.ringHighlights = [];
    }

    private rowCol(cell: string): RowCol {
        const [col, row] = this.graph.algebraic2coords(cell);
        return { row, col };
    }

    private applyRingPartialUi(m: string): void {
        this.clearRingPartialUi();
        if (this.phase !== "play" || this.rowPending !== undefined) {
            return;
        }
        if (!m.includes("-") || m.startsWith("x")) {
            return;
        }
        const [from, to = ""] = m.split("-") as [string, string];
        if (to !== "" || from === "") {
            return;
        }
        const start = from.toLowerCase();
        const p = this.currplayer;
        if (this.rings.get(start) !== p) {
            return;
        }
        const dests = legalRingDestinations(start, p, this.rings, this.markers, this.graph);
        if (dests.length === 0) {
            return;
        }
        this.ringSelect = start;
        this.ringHighlights = dests;
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        const after = this.stack[stackIndex];
        if (after?.rowPending !== undefined) {
            return false;
        }
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    private rowPhase(): RowPhase | undefined {
        return this.rowPending?.phase;
    }

    private instructionsKey(): string {
        const phase = this.rowPhase();
        if (phase?.type === "choose-row") {
            return "apgames:validation.yinsh.INITIAL_INSTRUCTIONS_CHOOSE_ROW";
        }
        if (phase?.type === "confirm-markers") {
            if (phase.row.segments.length > 1) {
                return "apgames:validation.yinsh.INITIAL_INSTRUCTIONS_SEGMENT";
            }
            return "apgames:validation.yinsh.INITIAL_INSTRUCTIONS_ROW";
        }
        if (phase?.type === "remove-ring") {
            return "apgames:validation.yinsh.INITIAL_INSTRUCTIONS_REMOVE_RING";
        }
        if (this.phase === "setup") {
            return "apgames:validation.yinsh.INITIAL_INSTRUCTIONS_SETUP";
        }
        return "apgames:validation.yinsh.INITIAL_INSTRUCTIONS";
    }

    private markerConfirmPhase(): Extract<RowPhase, { type: "confirm-markers" }> | undefined {
        const phase = this.rowPhase();
        return phase?.type === "confirm-markers" ? phase : undefined;
    }

    private syncMarkerTakeFromMove(move: string): void {
        const phase = this.markerConfirmPhase();
        if (phase === undefined) {
            return;
        }
        const parsed = takeSetForMarkerMove(move, phase.row);
        if (parsed !== undefined) {
            phase.take = parsed;
            return;
        }
        if (!move.startsWith("x") || !move.includes("-")) {
            return;
        }
        const body = move.slice(1);
        const [a, b] = body.split("-") as [string, string];
        if (a === undefined || b === undefined) {
            return;
        }
        phase.take = markerTakeFromSpan(
            phase.row,
            a.toLowerCase(),
            b.toLowerCase(),
            (cell) => this.markers.has(cell),
        );
    }

    private toggleMarkerTake(cell: string): boolean {
        const phase = this.markerConfirmPhase();
        if (phase === undefined || phase.actor !== this.currplayer) {
            return false;
        }
        if (!phase.row.core.includes(cell) || !this.markers.has(cell)) {
            return false;
        }
        if (phase.take.has(cell)) {
            phase.take.delete(cell);
        } else {
            phase.take.add(cell);
        }
        return true;
    }

    private markerConfirmMoveFromTake(): string {
        const phase = this.markerConfirmPhase();
        if (phase === undefined || phase.take.size === 0) {
            return "";
        }
        return formatMarkerRowMove(phase.row, phase.take);
    }

    private chooseRowIndexForCell(cell: string): number {
        const phase = this.rowPhase();
        if (phase?.type !== "choose-row") {
            return -1;
        }
        const options = phase.options;
        const matching = options
            .map((rowOpt, index) => ({ index, rowOpt }))
            .filter(({ rowOpt }) => rowOpt.cells.includes(cell));
        if (matching.length === 0) {
            return -1;
        }
        if (matching.length === 1) {
            return matching[0]!.index;
        }
        const byCoreLength = [...matching].sort((a, b) => b.rowOpt.core.length - a.rowOpt.core.length);
        const maxCore = byCoreLength[0]!.rowOpt.core.length;
        const longest = byCoreLength.filter((m) => m.rowOpt.core.length === maxCore);
        if (longest.length === 1) {
            return longest[0]!.index;
        }
        const unique = longest.filter(
            ({ index }) => !options.some((other, j) => j !== index && other.cells.includes(cell)),
        );
        return (unique[0] ?? longest[0]!).index;
    }

    private validateClickMove(newmove: string, cell: string): string {
        if (newmove.length > 0) {
            return newmove;
        }
        if (this.rowPending !== undefined) {
            const fromTake = this.markerConfirmMoveFromTake();
            if (fromTake.length > 0) {
                return fromTake;
            }
            return "";
        }
        return cell;
    }

    private defaultRowNotation(row: CapturableRow): string {
        return formatMarkerRowMove(row, defaultMarkerTake(row));
    }

    private chooseRowIndex(m: string): number {
        const phase = this.rowPhase();
        if (phase?.type !== "choose-row") {
            return -1;
        }
        return phase.options.findIndex((row) => this.defaultRowNotation(row) === m);
    }

    private beginRowPhase(causedBy: playerid, rows: CapturableRow[]): void {
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
        this.rowPending = {
            causedBy,
            pending: order.map((actor) => ({ actor, rows: [...byActor.get(actor)!] })),
        };
        this.currplayer = this.rowPending.pending[0]!.actor;
        this.openRowPhase();
    }

    private openRowPhase(): void {
        const head = this.rowPending?.pending[0];
        if (head === undefined || head.rows.length === 0) {
            this.finishRowQueue();
            return;
        }
        if (rowsNeedChoice(head.rows)) {
            this.rowPending!.phase = { type: "choose-row", actor: head.actor, options: [...head.rows] };
        } else {
            const row = head.rows[0]!;
            const take = rowNeedsSegmentChoice(row) ? new Set(row.core) : defaultMarkerTake(row);
            this.rowPending!.phase = {
                type: "confirm-markers",
                actor: head.actor,
                row,
                take,
            };
        }
    }

    private finishRowQueue(): void {
        const causedBy = this.rowPending?.causedBy;
        this.rowPending = undefined;
        this.checkEOG();
        if (!this.gameover && causedBy !== undefined) {
            this.currplayer = ((causedBy % 2) + 1) as playerid;
        }
    }

    private afterRingPlay(actor: playerid): void {
        const rows = findAllCapturableRows(this.markers, this.rings, this.graph);
        if (rows.length === 0) {
            this.checkEOG();
            if (!this.gameover) {
                this.currplayer = ((actor % 2) + 1) as playerid;
            }
            return;
        }
        this.beginRowPhase(actor, rows);
    }

    public checkEOG(): void {
        if (this.gameover) {
            return;
        }
        const goal = this.scoreGoal();
        for (const p of [1, 2] as const) {
            if (this.score[p - 1] >= goal) {
                this.gameover = true;
                this.winner = [p];
                this.results.push({ type: "eog", reason: "score" });
                return;
            }
        }
        if (this.phase === "play" && this.markersInPool <= 0 && this.rowPending === undefined) {
            const [a, b] = this.score;
            if (a > b) {
                this.gameover = true;
                this.winner = [1];
                this.results.push({ type: "eog", reason: "pool" });
            } else if (b > a) {
                this.gameover = true;
                this.winner = [2];
                this.results.push({ type: "eog", reason: "pool" });
            } else {
                this.gameover = true;
                this.winner = [];
                this.results.push({ type: "eog", reason: "draw" });
            }
        }
    }

    private parseRingMove(m: string): { from: string; to: string } | undefined {
        if (m.startsWith("x") || !m.includes("-")) {
            return undefined;
        }
        const [from, to] = m.split("-") as [string, string];
        if (from === undefined || to === undefined || to === "") {
            return undefined;
        }
        return { from: from.toLowerCase(), to: to.toLowerCase() };
    }

    private parseSetupPlace(m: string): string | undefined {
        if (m.includes("-") || m.startsWith("x")) {
            return undefined;
        }
        const cell = m.toLowerCase();
        if (!this.graph.isPlayable(cell)) {
            return undefined;
        }
        return cell;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        const p = player ?? this.currplayer;
        if (p !== this.currplayer) {
            return [];
        }
        const phase = this.rowPhase();
        if (phase?.type === "choose-row" && phase.actor === p) {
            return phase.options.map((row) => this.defaultRowNotation(row)).sort();
        }
        if (phase?.type === "confirm-markers" && phase.actor === p) {
            return listMarkerRowMoves(phase.row);
        }
        if (phase?.type === "remove-ring" && phase.actor === p) {
            const list: string[] = [];
            for (const [cell, owner] of this.rings) {
                if (owner === p) {
                    list.push(formatRingRemovalMove(cell));
                }
            }
            return list.sort();
        }
        if (this.rowPending !== undefined) {
            return [];
        }
        if (this.phase === "setup") {
            if (this.ringsReserve[p - 1] <= 0) {
                return [];
            }
            const moves: string[] = [];
            for (const cell of this.graph.graph.nodes()) {
                if (!this.rings.has(cell)) {
                    moves.push(cell);
                }
            }
            return moves.sort();
        }
        if (this.markersInPool <= 0) {
            return [];
        }
        const list: string[] = [];
        for (const [cell, owner] of this.rings) {
            if (owner !== p) {
                continue;
            }
            for (const dest of legalRingDestinations(cell, p, this.rings, this.markers, this.graph)) {
                list.push(`${cell}-${dest}`);
            }
        }
        return [...new Set(list)].sort();
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            complete: 0,
            message: i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }),
        };
        if (this.gameover) {
            result.message = i18next.t("apgames:validation._general.MOVES_GAMEOVER");
            return result;
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            result.complete = -1;
            if (this.rowPending !== undefined) {
                result.valid = true;
                result.canrender = true;
                result.message = i18next.t(this.instructionsKey());
                return result;
            }
            result.valid = true;
            result.canrender = true;
            result.message = i18next.t(this.instructionsKey());
            return result;
        }
        const p = this.currplayer;

        const phase = this.rowPhase();
        if (phase?.type === "choose-row" && phase.actor === p) {
            if (this.chooseRowIndex(m) >= 0) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.yinsh.INITIAL_INSTRUCTIONS_CHOOSE_ROW");
                return result;
            }
            return result;
        }

        const confirm = this.markerConfirmPhase();
        if (confirm !== undefined && confirm.actor === p) {
            this.syncMarkerTakeFromMove(m.length > 0 ? m : this.markerConfirmMoveFromTake());
            if (isValidMarkerTake(confirm.row, confirm.take)) {
                const complete = formatMarkerRowMove(confirm.row, confirm.take);
                if (m.length === 0 || takeSetForMarkerMove(m, confirm.row) !== undefined || m === complete) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.yinsh.INITIAL_INSTRUCTIONS_SEGMENT");
                    return result;
                }
            }
            if (takeIsOnRowCore(confirm.row, confirm.take) && confirm.row.segments.length > 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.yinsh.INITIAL_INSTRUCTIONS_SEGMENT");
                return result;
            }
            return result;
        }

        if (phase?.type === "remove-ring" && phase.actor === p) {
            const cell = parseRingRemovalMove(m);
            if (cell !== undefined && this.rings.get(cell) === p) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation.yinsh.INITIAL_INSTRUCTIONS_REMOVE_RING");
                return result;
            }
            return result;
        }

        if (this.rowPending !== undefined) {
            result.message = i18next.t("apgames:validation.yinsh.MUST_RESOLVE_ROW");
            return result;
        }

        if (this.phase === "play" && m.includes("-") && !m.startsWith("x")) {
            const [from, to = ""] = m.split("-") as [string, string];
            if (to === "" && from !== undefined && from.length > 0) {
                const start = from.toLowerCase();
                if (this.rings.get(start) === p) {
                    const dests = legalRingDestinations(start, p, this.rings, this.markers, this.graph);
                    if (dests.length > 0) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.yinsh.INITIAL_INSTRUCTIONS");
                        return result;
                    }
                } else if (start.length > 0) {
                    result.message = i18next.t("apgames:validation.yinsh.NOT_YOUR_RING");
                    return result;
                }
            }
        }

        if (this.phase === "setup") {
            const cell = this.parseSetupPlace(m);
            if (cell === undefined) {
                if (this.graph.blocked.has(m)) {
                    result.message = i18next.t("apgames:validation.yinsh.BLOCKED");
                } else if (this.rings.has(m)) {
                    result.message = i18next.t("apgames:validation.yinsh.OCCUPIED");
                }
                return result;
            }
            if (this.ringsReserve[p - 1] <= 0 || this.rings.has(cell)) {
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t(this.instructionsKey());
            return result;
        }

        const mv = this.parseRingMove(m);
        if (mv === undefined) {
            return result;
        }
        if (this.markersInPool <= 0) {
            result.message = i18next.t("apgames:validation.yinsh.NO_MARKERS");
            return result;
        }
        const sim = simulateRingMove(mv.from, mv.to, p, this.rings, this.markers, this.graph);
        if (!sim.ok) {
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation.yinsh.INITIAL_INSTRUCTIONS");
        return result;
    }

    private applyMarkerRemoval(take: Set<string>, row: CapturableRow): void {
        const actor = this.currplayer;
        const cells = row.cells.filter((c) => take.has(c));
        for (const c of cells) {
            this.markers.delete(c);
        }
        this.markersInPool += cells.length;
        this.results.push({
            type: "capture",
            how: "yinsh-row",
            where: cells.join(", "),
            whose: actor,
        });
    }

    private scoreRing(cell: string, actor: playerid): void {
        this.rings.delete(cell);
        this.score[actor - 1]++;
        this.results.push({
            type: "move",
            from: cell,
            to: "score",
            who: actor,
        });
    }

    private selectRow(index: number): void {
        const phase = this.rowPhase();
        if (phase?.type !== "choose-row") {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yinsh.MUST_RESOLVE_ROW"));
        }
        const row = phase.options[index];
        if (row === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yinsh.MUST_RESOLVE_ROW"));
        }
        const actor = phase.actor;
        this.rowPending!.chooseRowPeers = phase.options.map((r) => r.id);
        if (rowNeedsSegmentChoice(row)) {
            const take = new Set(row.core);
            this.rowPending!.phase = {
                type: "confirm-markers",
                actor,
                row,
                take,
            };
            this.lastmove = formatMarkerRowMove(row, take);
        } else {
            const take = defaultMarkerTake(row);
            this.applyMarkerRemoval(take, row);
            this.lastmove = formatMarkerRowMove(row, take);
            this.rowPending!.phase = { type: "remove-ring", actor };
        }
    }

    private doMarkerRowMove(m: string): void {
        const phase = this.markerConfirmPhase();
        if (phase === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yinsh.MUST_RESOLVE_ROW"));
        }
        const take = takeSetForMarkerMove(m, phase.row);
        if (take === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yinsh.MUST_RESOLVE_ROW"));
        }
        this.applyMarkerRemoval(take, phase.row);
        this.lastmove = m;
        this.rowPending!.phase = { type: "remove-ring", actor: phase.actor };
        this.checkEOG();
    }

    private doRingScoreMove(m: string): void {
        const phase = this.rowPhase();
        if (phase?.type !== "remove-ring") {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yinsh.MUST_RESOLVE_ROW"));
        }
        const cell = parseRingRemovalMove(m);
        if (cell === undefined || this.rings.get(cell) !== phase.actor) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yinsh.NOT_YOUR_RING"));
        }
        this.scoreRing(cell, phase.actor);
        this.lastmove = m;
        this.checkEOG();
        if (this.gameover) {
            this.rowPending = undefined;
            return;
        }
        const peers = this.rowPending!.chooseRowPeers;
        const head = this.rowPending!.pending[0]!;
        if (peers !== undefined) {
            head.rows = head.rows.filter((r) => !peers.includes(r.id));
            delete this.rowPending!.chooseRowPeers;
        } else if (head.rows.length > 0) {
            head.rows.shift();
        }
        if (head.rows.length === 0) {
            this.rowPending!.pending.shift();
        }
        if (this.rowPending!.pending.length === 0) {
            this.finishRowQueue();
        } else {
            this.currplayer = this.rowPending!.pending[0]!.actor;
            this.openRowPhase();
        }
    }

    public move(m: string, { trusted = false, partial = false } = {}): YinshGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted) {
            const v = this.validateMove(m);
            if (!v.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", v.message);
            }
        }
        if (partial) {
            if (this.markerConfirmPhase() !== undefined) {
                this.syncMarkerTakeFromMove(m);
                return this;
            }
            this.applyRingPartialUi(m);
            return this;
        }
        this.clearRingPartialUi();
        this.results = [];
        const player = this.currplayer;

        if (this.rowPhase()?.type === "choose-row") {
            const pick = this.chooseRowIndex(m);
            if (pick >= 0) {
                this.selectRow(pick);
                this.saveState();
                return this;
            }
        }

        if (this.markerConfirmPhase() !== undefined) {
            this.doMarkerRowMove(m);
            this.saveState();
            return this;
        }

        if (this.rowPhase()?.type === "remove-ring") {
            this.doRingScoreMove(m);
            this.saveState();
            return this;
        }

        if (this.phase === "setup") {
            const cell = this.parseSetupPlace(m);
            if (cell === undefined || this.rings.has(cell)) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
            }
            this.rings.set(cell, player);
            this.ringsReserve[player - 1]--;
            this.results.push({ type: "place", where: cell });
            this.lastmove = cell;
            const totalPlaced = this.rings.size;
            if (totalPlaced >= 10) {
                this.phase = "play";
                this.currplayer = 1;
            } else {
                this.currplayer = ((player % 2) + 1) as playerid;
            }
            this.saveState();
            return this;
        }

        const mv = this.parseRingMove(m);
        if (mv === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        const applied = applyRingMove(mv.from, mv.to, player, this.rings, this.markers, this.graph);
        if (!applied.ok) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
        }
        this.markersInPool -= 1;
        this.results.push({ type: "move", from: mv.from, to: mv.to });
        this.lastmove = m;
        this.afterRingPlay(player);
        this.saveState();
        return this;
    }

    public handleClick(move: string, row: number, col: number): IClickResult {
        try {
            const cells = this.graph.listCells(true) as string[][];
            const cell = cells[row]?.[col];
            if (cell === undefined || !this.graph.isPlayable(cell)) {
                throw new Error("Invalid click");
            }
            if (this.markerConfirmPhase() !== undefined) {
                this.syncMarkerTakeFromMove(move);
            }
            let newmove = move;
            const phase = this.rowPhase();
            if (phase?.type === "choose-row") {
                const pick = this.chooseRowIndexForCell(cell);
                if (pick >= 0) {
                    newmove = this.defaultRowNotation(phase.options[pick]!);
                }
            } else if (phase?.type === "confirm-markers" && phase.row.core.includes(cell)) {
                if (this.toggleMarkerTake(cell)) {
                    newmove = this.markerConfirmMoveFromTake();
                }
            } else if (phase?.type === "remove-ring" && this.rings.get(cell) === phase.actor) {
                newmove = formatRingRemovalMove(cell);
            } else if (this.phase === "setup" && !this.rings.has(cell)) {
                newmove = cell;
            } else if (this.phase === "play" && this.rowPending === undefined) {
                const normalized = move.toLowerCase().replace(/\s+/g, "");
                const dash = normalized.indexOf("-");
                const fromStem = dash >= 0 ? normalized.slice(0, dash) : "";
                const toStem = dash >= 0 ? normalized.slice(dash + 1) : "";
                if (fromStem.length > 0 && toStem === "" && cell === fromStem && this.rings.get(cell) === this.currplayer) {
                    newmove = "";
                } else {
                    const parsed = this.parseRingMove(normalized);
                    if (parsed !== undefined) {
                        newmove = `${parsed.from}-${cell}`;
                    } else if (this.rings.get(cell) === this.currplayer) {
                        newmove = `${cell}-`;
                    } else if (fromStem.length > 0 && this.rings.get(fromStem) === this.currplayer) {
                        newmove = `${fromStem}-${cell}`;
                    }
                }
            }
            const prefix = newmove.toLowerCase().replace(/\s+/g, "");
            if (prefix.length > 0 && prefix.includes("-") && !prefix.startsWith("x")) {
                const sole = this.moves().filter((mv) => mv.toLowerCase().startsWith(prefix));
                if (sole.length === 1) {
                    newmove = sole[0]!;
                }
            }
            const forValidate = this.validateClickMove(newmove, cell);
            const result = this.validateMove(forValidate) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove.length > 0 ? newmove : forValidate;
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
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return { func: "custom", default: YINSH_P1, palette: 1 };
        }
        return { func: "custom", default: YINSH_P2, palette: 2 };
    }

    public sidebarScores(): IScores[] {
        return [
            {
                name: this.neutralAreaLabel("apgames:status.yinsh.SCORE"),
                scores: [this.score[0], this.score[1]],
            },
        ];
    }

    /** One legend key per cell: marker, ring, or combined ring+marker (no stacking). */
    private cellPieceKey(cell: string): string {
        if (!this.graph.isPlayable(cell)) {
            return "-";
        }
        const ring = this.rings.get(cell);
        let marker = this.markers.get(cell);
        if (this.ringSelect === cell && marker === undefined) {
            marker = this.currplayer;
        }
        const hasMarker = marker !== undefined;
        const hasRing = ring !== undefined;
        if (hasRing && hasMarker) {
            return ring === 1 ? "C" : "F";
        }
        if (hasRing) {
            return ring === 1 ? "B" : "E";
        }
        if (hasMarker) {
            return marker === 1 ? "A" : "D";
        }
        return "-";
    }

    public render(): APRenderRep {
        const p1 = this.getPlayerColour(1);
        const p2 = this.getPlayerColour(2);
        const p1Border = yinshContrastBorder(p1, 3);
        const p2Border = yinshContrastBorder(p2, 4);
        const cells = this.graph.listCells(true) as string[][];
        const rows: string[] = [];
        for (const line of cells) {
            const pieces: string[] = [];
            for (const cell of line) {
                pieces.push(this.cellPieceKey(cell));
            }
            rows.push(pieces.join(","));
        }

        const rep: APRenderRep = {
            options: ["reverse-numbers"],
            board: {
                style: "hex-of-tri",
                minWidth: 6,
                maxWidth: 11,
                rotate: 90,
                blocked: YINSH_BLOCKED_RENDER as [RowCol, ...RowCol[]],
            },
            legend: {
                A: {
                    name: "ring-02",
                    paint: { fill: p1, border: p1Border },
                },
                B: {
                    name: "ring-23",
                    paint: { fill: p1, border: p1Border },
                },
                C: [
                    { name: "ring-02", paint: { fill: p1, border: p1Border } },
                    { name: "ring-23", paint: { fill: p1, border: p1Border } },
                ],
                D: {
                    name: "ring-02",
                    paint: { fill: p2, border: p2Border },
                },
                E: {
                    name: "ring-23",
                    paint: { fill: p2, border: p2Border },
                },
                F: [
                    { name: "ring-02", paint: { fill: p2, border: p2Border } },
                    { name: "ring-23", paint: { fill: p2, border: p2Border } },
                ],
            },
            pieces: rows.join("\n"),
        };

        rep.annotations = [];
        for (const res of this.results) {
            if (res.type === "move" && res.from && res.to && res.to !== "score") {
                const [fx, fy] = this.graph.algebraic2coords(res.from);
                const [tx, ty] = this.graph.algebraic2coords(res.to);
                rep.annotations!.push({
                    type: "move",
                    targets: [
                        { row: fy, col: fx },
                        { row: ty, col: tx },
                    ],
                });
            }
        }

        const rphase = this.rowPhase();
        const lineAnnotation = (cells: string[]) => {
            const targets = cells.map((c) => this.rowCol(c));
            if (targets.length >= 2) {
                rep.annotations!.push({
                    type: "line",
                    targets: targets as [{ row: number; col: number }, { row: number; col: number }, ...{ row: number; col: number }[]],
                });
            }
        };
        const exitOnCells = (cells: string[]) => {
            for (const cell of cells) {
                if (!this.markers.has(cell)) {
                    continue;
                }
                const pt = this.rowCol(cell);
                rep.annotations!.push({
                    type: "exit",
                    shape: "circle",
                    targets: [pt],
                });
            }
            lineAnnotation(cells);
        };
        if (rphase?.type === "choose-row") {
            const marked = new Set<string>();
            for (const row of rphase.options) {
                const candidates = row.cells.filter((c) => this.markers.has(c));
                lineAnnotation(candidates);
                for (const cell of candidates) {
                    if (marked.has(cell)) {
                        continue;
                    }
                    marked.add(cell);
                    rep.annotations!.push({
                        type: "exit",
                        shape: "circle",
                        targets: [this.rowCol(cell)],
                    });
                }
            }
        } else if (rphase?.type === "confirm-markers") {
            const removal = [...rphase.take].filter((c) => this.markers.has(c));
            exitOnCells(removal);
        } else if (rphase?.type === "remove-ring") {
            const targets: RowCol[] = [];
            for (const [cell, owner] of this.rings) {
                if (owner === rphase.actor) {
                    targets.push(this.rowCol(cell));
                }
            }
            if (targets.length > 0) {
                rep.annotations!.push({
                    type: "dots",
                    targets: targets as [RowCol, ...RowCol[]],
                });
            }
        }

        if (this.ringHighlights.length > 0) {
            rep.annotations!.push({
                type: "dots",
                targets: this.ringHighlights.map((c) => this.rowCol(c)) as [RowCol, ...RowCol[]],
            });
        }

        if (rep.annotations!.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "move":
                if (r.to === "score") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:yinsh.ROW.ring", {
                        player: chatPlayerToken(r.who ?? ctx.defaultSeat),
                        where: r.from!,
                    });
                    return true;
                }
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:yinsh.MOVE.ring", {
                    player: chatPlayerToken(ctx.defaultSeat),
                    from: r.from!,
                    to: r.to!,
                });
                return true;
            case "capture":
                if (r.how === "yinsh-row") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:yinsh.ROW.markers", {
                        player: chatPlayerToken(r.whose ?? ctx.defaultSeat),
                        cells: r.where!,
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

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        if (r.reason === "draw") {
            return {
                actor: { kind: "none" },
                textKey: "apresults:yinsh.EOG.draw",
            };
        }
        const winnerSeat = this.winner[0] ?? ctx.defaultSeat;
        const key =
            r.reason === "pool" ? "apresults:yinsh.EOG.pool" : "apresults:yinsh.EOG.score";
        return {
            actor: this.getChatActorRef(winnerSeat),
            textKey: key,
            textParams: {
                player: chatPlayerToken(winnerSeat),
                count: this.score[winnerSeat - 1],
            },
        };
    }

    public state(): IAPGameState {
        return {
            game: YinshGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const s: IMoveState = {
            _version: YinshGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            phase: this.phase,
            rings: cloneState(this.rings) as Map<string, playerid>,
            markers: cloneState(this.markers) as Map<string, playerid>,
            ringsReserve: [...this.ringsReserve] as [number, number],
            markersInPool: this.markersInPool,
            score: [...this.score] as [number, number],
            lastmove: this.lastmove,
        };
        if (this.rowPending !== undefined) {
            s.rowPending = cloneState(this.rowPending) as RowPending;
        }
        return s;
    }

    public clone(): YinshGame {
        return new YinshGame(this.state() as IYinshState);
    }
}