import {
    GameBase,
    IClickResult,
    IRenderOpts,
    IScores,
    IValidationResult,
    chatPlayerToken,
    type ChatLogCollectContext,
    type ChatLogLine,
    type ColourResolvable,
} from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, AreaPieces, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { cloneState, reviver, UserFacingError } from "../common/index.js";
import type { GameRng } from "../common/rng.js";
import i18next from "i18next";
import { LyngkGraph, LYNGK_BLOCKED_RENDER, LYNGK_MAX_WIDTH, LYNGK_MIN_WIDTH } from "./lyngk/graph.js";
import {
    applyClaim,
    canClaimColour,
    canPlayerUseStack,
    stackController,
} from "./lyngk/colours.js";
import {
    allLegalMoveStrings,
    anyBoardPath,
    bothImmobilized,
    legalNextCellsForPath,
    pathIsLegal,
} from "./lyngk/move.js";
import { formatMove, parseCellChain, parseClaimPrefix } from "./lyngk/notation.js";
import {
    buildRandomBoard,
    cloneBoard,
    cloneClaims,
    initialClaimed,
    initialClaims,
    serializeStartingBoard,
} from "./lyngk/setup.js";
import {
    applyLanding,
    removeCaptured,
    shouldCaptureStack,
} from "./lyngk/stack.js";
import type { ActiveColour, Board, ClaimState, ILyngkState, IMoveState, PieceColour, playerid } from "./lyngk/types.js";
import { resolveWinner } from "./lyngk/win.js";

const COLOUR_GLYPHS = ["A", "B", "C", "D", "E", "F"] as const;
const GLYPH_TO_COLOUR: Record<string, ActiveColour> = { A: 1, B: 2, C: 3, D: 4, E: 5 };

/** Reserve area keys must differ from on-board legend ids (see ZERTZ `areaMarbleKey`). */
function reserveAreaKey(c: ActiveColour): string {
    return `a${colourGlyph(c)}`;
}

function reserveColourFromPiece(piece: string): ActiveColour | undefined {
    const key = piece.length >= 2 && piece.startsWith("a") ? piece.slice(1) : piece;
    if (key.length === 0) {
        return undefined;
    }
    return GLYPH_TO_COLOUR[key.charAt(0).toUpperCase()];
}

function colourGlyph(c: PieceColour): string {
    return COLOUR_GLYPHS[c - 1]!;
}

function fillForColour(c: PieceColour): ColourResolvable {
    if (c === 6) {
        return { func: "custom", default: "dots", palette: 6 };
    }
    return c;
}

function pieceLegend(c: PieceColour): Glyph {
    if (c === 6) {
        return { name: "piece", paint: { fill: fillForColour(c) } };
    }
    return { name: "piece", colour: c };
}

function ownerOverlayLegend(owner: playerid): Glyph {
    return { text: String(owner), scale: 0.45 };
}

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS:
            "Click a stack you control, then click destinations along a line. Optionally claim a colour from the reserve first.",
        NO_PASS: "You must make a board move when one is available.",
        MUST_PASS: "You have no legal move; your turn will pass automatically.",
        INVALID_MOVE: "That move is not legal.",
        INVALID_CLAIM: "You cannot claim that colour.",
        CLAIM_WITHOUT_MOVE: "Claiming a colour requires a board move on the same turn.",
        CLAIM_WITH_PASS: "You cannot claim a colour when passing.",
        RESERVE_LABEL: "Unclaimed colours",
    },
    status: {
        CLAIMED: "Claimed colours",
        CAPTURED: "Captured stacks",
    },
    displays: {
        "hide-stack-owner": {
            name: "Hide stack owner",
            description: "Do not mark the top disc of stacks you control.",
        },
    },
};

export const gameApresultsEn = {
    CLAIM: {
        default: "{{player}} claimed colour {{colour}}.",
    },
    MOVE: {
        default: "{{player}} moved {{cells}}.",
    },
    CAPTURE: {
        default: "{{player}} captured a stack at {{where}}.",
    },
    EOG: {
        score: "{{player}} wins with {{count}} captured stacks.",
        tiebreak: "{{player}} wins on tiebreak.",
        draw: "The game is a draw.",
    },
};

export type { IMoveState, ILyngkState };

export class LyngkGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "LYNGK",
        uid: "lyngk",
        playercounts: [2],
        version: "20261123",
        dateAdded: "2026-11-23",
        description:
            "Claim two of five colours, stack and slide pieces on a hex board, chain through your colour with the LYNGK rule, and score by capturing completed stacks of five.",
        urls: [
            "https://www.gipf.com/",
            "https://boardgamegeek.com/boardgame/217083/lyngk",
        ],
        bggid: "217083",
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
        customizations: [
            { num: 1, default: 1, explanation: "Colour 1 (red)" },
            { num: 2, default: 2, explanation: "Colour 2 (blue)" },
            { num: 3, default: 3, explanation: "Colour 3 (green)" },
            { num: 4, default: 4, explanation: "Colour 4 (yellow)" },
            { num: 5, default: 5, explanation: "Colour 5 (purple)" },
            { num: 6, default: "dots", explanation: "Joker (dots pattern)" },
        ],
        categories: [
            "family>gipf",
            "goal>score>eog",
            "mechanic>stack",
            "mechanic>move",
            "mechanic>capture",
            "board>shape>hex",
            "board>connect>hex",
            "components>simple>1per",
        ],
        flags: ["shared-pieces", "automove", "scores", "random-start", "experimental"],
        displays: [{ uid: "hide-stack-owner" }],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Board;
    public claims!: ClaimState;
    public claimed!: [ActiveColour[], ActiveColour[]];
    public captured: [number, number] = [0, 0];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _graph?: LyngkGraph;
    private startpos = "";
    public rng?: GameRng;
    private moveHighlights: string[] = [];
    private partialMoveCells: string[] = [];

    constructor(state?: ILyngkState | string) {
        super();
        this._graph = new LyngkGraph();
        if (state === undefined) {
            const board = buildRandomBoard(this.graph, this.rng);
            const fresh: IMoveState = {
                _version: LyngkGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                claims: initialClaims(),
                claimed: initialClaimed(),
                captured: [0, 0],
            };
            this.stack = [fresh];
            this.startpos = serializeStartingBoard(this.graph, board);
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILyngkState;
            }
            if (state.game !== LyngkGame.gameinfo.uid) {
                throw new Error(`The LYNGK engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public get graph(): LyngkGraph {
        if (this._graph === undefined) {
            this._graph = new LyngkGraph();
        }
        return this._graph;
    }

    public load(idx = -1): LyngkGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const s = this.stack[idx]!;
        this.currplayer = s.currplayer;
        this.board = cloneBoard(s.board);
        this.claims = cloneClaims(s.claims);
        this.claimed = [s.claimed[0].slice() as ActiveColour[], s.claimed[1].slice() as ActiveColour[]];
        this.captured = [s.captured[0], s.captured[1]];
        this.lastmove = s.lastmove;
        this.results = [...s._results];
        if (idx === 0 && this.startpos.length === 0) {
            this.startpos = serializeStartingBoard(this.graph, this.board);
        }
        this.clearMoveHighlights();
        return this;
    }

    private rowCol(cell: string): RowCol {
        const [x, y] = this.graph.algebraic2coords(cell);
        return { row: y, col: x };
    }

    private clearMoveHighlights(): void {
        this.moveHighlights = [];
        this.partialMoveCells = [];
    }

    private pushMoveChainArrows(annotations: NonNullable<APRenderRep["annotations"]>, cells: string[]): void {
        for (let i = 0; i < cells.length - 1; i++) {
            const from = cells[i]!;
            const to = cells[i + 1]!;
            annotations.push({
                type: "move",
                targets: [this.rowCol(from), this.rowCol(to)],
            });
        }
    }

    private syncMoveHighlightsFromMove(m: string): void {
        this.clearMoveHighlights();
        const { rest } = parseClaimPrefix(m.toLowerCase().replace(/\s+/g, ""));
        const cells = parseCellChain(rest);
        if (cells === undefined || cells.length === 0) {
            return;
        }
        this.partialMoveCells = cells;
        this.moveHighlights = legalNextCellsForPath(
            this.graph,
            this.board,
            this.claims,
            this.currplayer,
            cells,
        );
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        const p = player ?? this.currplayer;
        return allLegalMoveStrings(this.graph, this.board, this.claims, this.claimed, p);
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };
        if (this.gameover) {
            result.message = i18next.t("apgames:validation._general.MOVES_GAMEOVER");
            return result;
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            this.clearMoveHighlights();
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.lyngk.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (anyBoardPath(this.graph, this.board, this.claims, this.currplayer)) {
                result.message = i18next.t("apgames:validation.lyngk.NO_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.lyngk.MUST_PASS");
            return result;
        }

        const { claim, rest } = parseClaimPrefix(m);
        if (claim !== undefined) {
            if (rest === "pass") {
                result.message = i18next.t("apgames:validation.lyngk.CLAIM_WITH_PASS");
                return result;
            }
            if (!canClaimColour(this.claims, this.claimed, this.currplayer, claim)) {
                result.message = i18next.t("apgames:validation.lyngk.INVALID_CLAIM");
                return result;
            }
        }

        if (/^[1-5]$/.test(m)) {
            result.message = i18next.t("apgames:validation.lyngk.CLAIM_WITHOUT_MOVE");
            return result;
        }

        const cells = parseCellChain(rest);
        if (cells === undefined) {
            if (claim !== undefined && rest.length === 0) {
                this.clearMoveHighlights();
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.lyngk.INITIAL_INSTRUCTIONS");
                return result;
            }
            this.clearMoveHighlights();
            result.message = i18next.t("apgames:validation.lyngk.INVALID_MOVE");
            return result;
        }

        if (claim !== undefined && !anyBoardPath(this.graph, this.board, this.claims, this.currplayer)) {
            result.message = i18next.t("apgames:validation.lyngk.CLAIM_WITHOUT_MOVE");
            return result;
        }

        const from = cells[0]!;
        if (!this.board.has(from) || !canPlayerUseStack(this.claims, this.board.get(from)!, this.currplayer)) {
            this.clearMoveHighlights();
            result.message = i18next.t("apgames:validation.lyngk.INVALID_MOVE");
            return result;
        }

        if (cells.length >= 2 && pathIsLegal(this.graph, this.board, this.claims, this.currplayer, cells)) {
            const formatted = formatMove(claim, cells);
            if (!this.moves().includes(formatted)) {
                this.clearMoveHighlights();
                result.message = i18next.t("apgames:validation.lyngk.INVALID_MOVE");
                return result;
            }
            this.clearMoveHighlights();
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.lyngk.INITIAL_INSTRUCTIONS");
            return result;
        }

        const nextCells = legalNextCellsForPath(this.graph, this.board, this.claims, this.currplayer, cells);
        if (nextCells.length > 0) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.lyngk.INITIAL_INSTRUCTIONS");
            this.syncMoveHighlightsFromMove(m);
            return result;
        }

        this.clearMoveHighlights();
        result.message = i18next.t("apgames:validation.lyngk.INVALID_MOVE");
        return result;
    }

    public move(m: string, { trusted = false, partial = false } = {}): LyngkGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted) {
            const v = this.validateMove(m);
            if (!v.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", v.message);
            }
            if (!partial && v.complete !== 1 && m.length > 0) {
                if (!(v.complete === 0 && (m.endsWith("-") || /^\d+,?$/.test(m) || /^\d+,[a-z]+\d+$/.test(m)))) {
                    throw new UserFacingError("VALIDATION_GENERAL", v.message);
                }
            }
        }

        if (partial) {
            this.syncMoveHighlightsFromMove(m);
            return this;
        }

        this.results = [];
        this.clearMoveHighlights();
        const player = this.currplayer;

        if (m === "pass") {
            this.results.push({ type: "pass" });
            this.lastmove = m;
            this.currplayer = player === 1 ? 2 : 1;
            this.checkEOG();
            this.saveState();
            return this;
        }

        const { claim, rest } = parseClaimPrefix(m);
        const cells = parseCellChain(rest)!;
        const origin = cells[0]!;
        const terminal = cells[cells.length - 1]!;

        if (claim !== undefined) {
            applyClaim(this.claims, this.claimed, player, claim);
            this.results.push({ type: "claim", who: player, count: claim });
        }

        const merged = applyLanding(this.board, origin, terminal);
        this.results.push({ type: "move", who: player, from: origin, to: terminal, what: cells.join("-") });

        if (shouldCaptureStack(this.claims, merged, player)) {
            removeCaptured(this.board, terminal);
            this.captured[player - 1]++;
            this.results.push({ type: "capture", whose: player, where: terminal });
        }

        this.lastmove = m;
        this.currplayer = player === 1 ? 2 : 1;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): LyngkGame {
        if (this.gameover) {
            return this;
        }
        if (!bothImmobilized(this.graph, this.board, this.claims)) {
            return this;
        }
        this.gameover = true;
        this.winner = resolveWinner(this.board, this.captured);
        if (this.winner.length === 2) {
            this.results.push({ type: "eog", reason: "draw" });
        } else {
            this.results.push({ type: "eog", reason: "score" });
        }
        this.results.push({ type: "winners", players: [...this.winner] });
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = move.toLowerCase().replace(/\s+/g, "");

            if (row < 0 || col < 0) {
                if (piece === undefined) {
                    throw new Error("Off-board click requires piece.");
                }
                const colour = reserveColourFromPiece(piece);
                if (colour === undefined) {
                    throw new Error("Invalid reserve piece.");
                }
                const { claim, rest } = parseClaimPrefix(newmove);
                const chain = parseCellChain(rest) ?? [];
                const chainStr = chain.length > 0 ? formatMove(undefined, chain).replace(/^\d+,/, "") : "";
                const prefix = `${colour},`;
                if (claim !== undefined) {
                    newmove = chainStr.length > 0 ? `${colour},${chainStr}` : prefix;
                } else if (newmove.length === 0) {
                    newmove = prefix;
                } else {
                    newmove = chainStr.length > 0 ? `${colour},${chainStr}` : `${colour},${newmove}`;
                }
            } else {
                const cells = this.graph.listCells(true) as string[][];
                const cell = cells[row]?.[col];
                if (cell === undefined || !this.graph.isPlayable(cell)) {
                    throw new Error("Invalid click");
                }

                const { claim, rest } = parseClaimPrefix(newmove);
                const chain = parseCellChain(rest) ?? [];

                if (chain.length === 0) {
                    if (this.board.has(cell) && canPlayerUseStack(this.claims, this.board.get(cell)!, this.currplayer)) {
                        newmove = formatMove(claim, [cell]);
                    }
                } else {
                    const last = chain[chain.length - 1]!;
                    const next = legalNextCellsForPath(
                        this.graph,
                        this.board,
                        this.claims,
                        this.currplayer,
                        chain,
                    );
                    if (cell === last && chain.length === 1) {
                        newmove = formatMove(claim, [cell]);
                    } else if (next.includes(cell)) {
                        newmove = formatMove(claim, [...chain, cell]);
                    } else if (canPlayerUseStack(this.claims, this.board.get(cell)!, this.currplayer)) {
                        newmove = formatMove(claim, [cell]);
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
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

    private stackGlyphs(cell: string, stack: PieceColour[], opts?: IRenderOpts): string[] {
        const showOwner = !this.hasDisplay(opts, "hide-stack-owner");
        return stack.map((c, i) => {
            if (i !== stack.length - 1) {
                return colourGlyph(c);
            }
            if (!showOwner) {
                return colourGlyph(c);
            }
            const ctrl = stackController(this.claims, stack);
            if (ctrl === 1 || ctrl === 2) {
                return `${colourGlyph(c)}${ctrl}`;
            }
            return colourGlyph(c);
        });
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const cells = this.graph.listCells(true) as string[][];
        const pstr: string[][][] = [];
        for (const row of cells) {
            const line: string[][] = [];
            for (const cell of row) {
                const stack = this.board.get(cell);
                line.push(stack === undefined ? [] : this.stackGlyphs(cell, stack, opts));
            }
            pstr.push(line);
        }

        const legend: APRenderRep["legend"] = {
            A: pieceLegend(1),
            B: pieceLegend(2),
            C: pieceLegend(3),
            D: pieceLegend(4),
            E: pieceLegend(5),
            F: pieceLegend(6),
        };
        for (const c of [1, 2, 3, 4, 5] as ActiveColour[]) {
            legend[reserveAreaKey(c)] = pieceLegend(c);
        }
        if (!this.hasDisplay(opts, "hide-stack-owner")) {
            for (const c of [1, 2, 3, 4, 5, 6] as PieceColour[]) {
                for (const p of [1, 2] as playerid[]) {
                    const key = `${colourGlyph(c)}${p}`;
                    legend[key] = [pieceLegend(c), ownerOverlayLegend(p)];
                }
            }
        }

        const rep: APRenderRep = {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-tri",
                minWidth: LYNGK_MIN_WIDTH,
                maxWidth: LYNGK_MAX_WIDTH,
                blocked: LYNGK_BLOCKED_RENDER as [RowCol, ...RowCol[]],
            },
            legend,
            pieces: pstr as [string[][], ...string[][][]],
        };

        const reserveGlyphs: string[] = [];
        for (const c of [1, 2, 3, 4, 5] as ActiveColour[]) {
            if (this.claims.inReserve.has(c)) {
                reserveGlyphs.push(reserveAreaKey(c));
            }
        }
        if (reserveGlyphs.length > 0) {
            const area: AreaPieces = {
                type: "pieces",
                label: this.neutralAreaLabel("apgames:validation.lyngk.RESERVE_LABEL"),
                pieces: reserveGlyphs as [string, ...string[]],
            };
            rep.areas = [area];
        }

        rep.annotations = [];
        if (this.partialMoveCells.length >= 2) {
            this.pushMoveChainArrows(rep.annotations, this.partialMoveCells);
        }
        if (this.moveHighlights.length > 0) {
            rep.annotations.push({
                type: "enter",
                shape: "circle",
                targets: this.moveHighlights.map((c) => this.rowCol(c)) as [RowCol, ...RowCol[]],
            });
        }
        for (const r of this.results) {
            if (r.type === "move") {
                const chain =
                    r.what !== undefined
                        ? parseCellChain(r.what)
                        : r.from !== undefined && r.to !== undefined
                          ? [r.from, r.to]
                          : undefined;
                if (chain !== undefined && chain.length >= 2) {
                    this.pushMoveChainArrows(rep.annotations!, chain);
                }
            } else if (r.type === "capture" && r.where) {
                rep.annotations!.push({
                    type: "exit",
                    shape: "circle",
                    targets: [this.rowCol(r.where)],
                });
            }
        }

        return rep;
    }

    public sidebarScores(): IScores[] {
        const claimRow = (p: playerid) =>
            this.claimed[p - 1].map((c) => this.statusSheetGlyph("piece", c));
        return [
            { name: this.neutralAreaLabel("apgames:status.lyngk.CLAIMED"), scores: [claimRow(1), claimRow(2)] },
            {
                name: this.neutralAreaLabel("apgames:status.lyngk.CAPTURED"),
                scores: [String(this.captured[0]), String(this.captured[1])],
            },
        ];
    }

    public getStartingPosition(): string {
        if (this.startpos.length > 0) {
            return this.startpos;
        }
        return serializeStartingBoard(this.graph, this.stack[0]!.board);
    }

    public moveState(): IMoveState {
        return {
            _version: LyngkGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            board: cloneBoard(this.board),
            claims: cloneClaims(this.claims),
            claimed: [this.claimed[0].slice() as ActiveColour[], this.claimed[1].slice() as ActiveColour[]],
            captured: [this.captured[0], this.captured[1]],
            lastmove: this.lastmove,
            rngCounter: this.rng?.getCounter(),
        };
    }

    public state(): ILyngkState {
        return {
            game: LyngkGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public clone(): LyngkGame {
        return Object.assign(new LyngkGame(), cloneState(this) as LyngkGame);
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "claim": {
                const seat = (r.who ?? ctx.defaultSeat) as playerid;
                this.pushSeatChatLine(lines, seat, "apresults:lyngk.CLAIM.default", {
                    player: chatPlayerToken(seat),
                    colour: r.count,
                });
                return true;
            }
            case "move": {
                const seat = (r.who ?? ctx.defaultSeat) as playerid;
                this.pushSeatChatLine(lines, seat, "apresults:lyngk.MOVE.default", {
                    player: chatPlayerToken(seat),
                    cells: r.what ?? `${r.from}-${r.to}`,
                });
                return true;
            }
            case "capture": {
                const seat = (r.whose ?? ctx.defaultSeat) as playerid;
                this.pushSeatChatLine(lines, seat, "apresults:lyngk.CAPTURE.default", {
                    player: chatPlayerToken(seat),
                    where: r.where!,
                });
                return true;
            }
            case "pass":
                return super.collectChatLogLine(lines, r, ctx);
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    protected eogChatLineOverride(
        r: Extract<APMoveResult, { type: "eog" }>,
        ctx: ChatLogCollectContext,
    ): ChatLogLine | undefined {
        if (r.reason === "draw") {
            return {
                actor: this.getChatActorRef(ctx.defaultSeat),
                textKey: "apresults:lyngk.EOG.draw",
                textParams: {},
            };
        }
        const winResult = ctx.results.find((x) => x.type === "winners");
        const winnerSeat =
            winResult?.type === "winners" && winResult.players.length === 1
                ? (winResult.players[0]! as playerid)
                : ((this.winner[0] ?? ctx.defaultSeat) as playerid);
        return {
            actor: this.getChatActorRef(winnerSeat),
            textKey: "apresults:lyngk.EOG.score",
            textParams: { player: chatPlayerToken(winnerSeat), count: this.captured[winnerSeat - 1] },
        };
    }
}