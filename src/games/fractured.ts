import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { AnnotationBasic, APRenderRep, AreaTrack, Colourfuncs, MarkerFlood, MarkerGlyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { FracturedFlatGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export const CITIES = new Set([
    "A2", "A5", "A8", "A14", "A15", "A17", "A21", "A22",
    "B1", "B4", "B5", "B8", "B12", "B15",
    "C1", "C2", "C5",
    "D1",
]);

export const SIZE_COLOUR: Readonly<Record<number, number>> = {
    2: 1,
    3: 4,
    4: 3,
    5: 2,
    6: 5,
};

export const PIECES_EACH = 16;
export const TRACK_LEN = 13;
export const TRACK_CENTER = 6;
export const TRACK_LABELS = [6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6] as const;

const TRACK_GLYPH_KEYS = [
    "N6", "N5", "N4", "N3", "N2", "N1", "N0",
    "N1", "N2", "N3", "N4", "N5", "N6",
] as const;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    reserve: [number, number];
    scoreIndex: number;
    lastmove?: string;
}

export interface IFracturedState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class FracturedGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Fractured Flat",
        uid: "fractured",
        playercounts: [2],
        version: "20260810",
        dateAdded: "2026-08-10",
        description: "apgames:descriptions.fractured",
        urls: [],
        people: [
            {
                type: "designer",
                name: "James Ernest",
                urls: ["https://crabfragmentlabs.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        customizations: [
            { num: 1, default: 1, explanation: "Size-2 regions" },
            { num: 4, default: 4, explanation: "Size-3 regions" },
            { num: 3, default: 3, explanation: "Size-4 regions" },
            { num: 2, default: 2, explanation: "Size-5 regions" },
            { num: 5, default: 5, explanation: "Size-6 regions (centre)" },
            { num: 6, default: 6, explanation: "Player 1" },
            { num: 7, default: 7, explanation: "Player 2" },
            { num: 8, default: "#fff", explanation: "City colour" },
        ],
        categories: ["goal>score>race", "mechanic>place", "mechanic>move", "board>other", "board>connect>other", "components>simple>1per"],
        flags: ["experimental", "scores", "custom-colours"],
    };

    public readonly graph = new FracturedFlatGraph();
    private readonly cellSizes = new Map<string, number>();
    private readonly cellsBySize = new Map<number, string[]>();

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public reserve: [number, number] = [15, 16];
    public scoreIndex = TRACK_CENTER;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IFracturedState | string) {
        super();
        for (const cell of this.graph.graph.nodes()) {
            const size = this.graph.neighbours(cell).length;
            this.cellSizes.set(cell, size);
            const bucket = this.cellsBySize.get(size);
            if (bucket === undefined) {
                this.cellsBySize.set(size, [cell]);
            } else {
                bucket.push(cell);
            }
        }

        if (state === undefined) {
            const fresh: IMoveState = {
                _version: FracturedGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, playerid>(),
                reserve: [15, 16],
                scoreIndex: TRACK_CENTER,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFracturedState;
            }
            if (state.game !== FracturedGame.gameinfo.uid) {
                throw new Error(`The Fractured Flat engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FracturedGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.reserve = [...state.reserve];
        this.scoreIndex = state.scoreIndex;
        this.lastmove = state.lastmove;
        return this;
    }

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public cellSize(cell: string): number {
        const size = this.cellSizes.get(cell.toUpperCase());
        if (size === undefined) {
            throw new Error(`Unknown cell: ${cell}`);
        }
        return size;
    }

    public isOpen(cell: string, player: playerid): boolean {
        const normalized = cell.toUpperCase();
        const size = this.cellSize(normalized);
        if (size === 2) {
            return true;
        }
        const sameSize = this.cellsBySize.get(size) ?? [];
        if (sameSize.some(c => this.board.get(c) === player)) {
            return true;
        }
        for (let s = 2; s < size; s++) {
            const tier = this.cellsBySize.get(s) ?? [];
            if (!tier.every(c => this.board.has(c))) {
                return false;
            }
        }
        return true;
    }

    public validDestinations(from: string): string[] {
        const normalized = from.toUpperCase();
        const fromSize = this.cellSize(normalized);
        return this.graph.neighbours(normalized).filter(n => {
            return !this.board.has(n) && this.cellSize(n) === fromSize + 1;
        });
    }

    public computeScore(cell: string, player: playerid): number {
        const normalized = cell.toUpperCase();
        let points = 0;
        if (CITIES.has(normalized)) {
            points++;
        }
        const opp = player === 1 ? 2 : 1;
        for (const n of this.graph.neighbours(normalized)) {
            if (this.board.get(n) === opp) {
                points++;
            }
        }
        return points;
    }

    public getPlayerScore(player: playerid): number {
        return player === 1
            ? TRACK_CENTER - this.scoreIndex
            : this.scoreIndex - TRACK_CENTER;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        if (this.reserve[player - 1] > 0) {
            for (const cell of this.graph.graph.nodes()) {
                if (!this.board.has(cell) && this.isOpen(cell, player)) {
                    moves.push(cell.toLowerCase());
                }
            }
        }

        for (const [cell, owner] of this.board.entries()) {
            if (owner !== player) {
                continue;
            }
            for (const dest of this.validDestinations(cell)) {
                moves.push(`${cell.toLowerCase()}-${dest.toLowerCase()}`);
            }
        }

        return moves.sort((a, b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";

            if (move.length > 0) {
                let from = move;
                if (move.includes("-")) {
                    from = move.split("-")[0]!;
                }
                if (cell.toUpperCase() === from.toUpperCase()) {
                    return { move: "", message: "" } as IClickResult;
                }
                const dests = this.validDestinations(from);
                if (dests.includes(cell)) {
                    newmove = `${from.toLowerCase()}-${cell.toLowerCase()}`;
                } else if (this.board.get(cell) === this.currplayer) {
                    newmove = cell.toLowerCase();
                }
            } else if (this.board.get(cell) === this.currplayer) {
                newmove = cell.toLowerCase();
            } else if (!this.board.has(cell) && this.isOpen(cell, this.currplayer) && this.reserve[this.currplayer - 1] > 0) {
                newmove = cell.toLowerCase();
            } else {
                return { move: "", message: "" } as IClickResult;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move.length > 0 ? move : "";
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
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.fractured.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase().replace(/\s+/g, "");

        if (m.includes("-")) {
            const [from, to] = m.split("-");
            if (from === undefined || to === undefined || to.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fractured.BAD_MOVE");
                return result;
            }
            if (!this.moves().includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fractured.BAD_MOVE");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const cell = m.toUpperCase();
        try {
            this.graph.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }

        if (this.board.has(cell)) {
            if (this.board.get(cell) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { cell: m });
                return result;
            }
            if (this.validDestinations(cell).length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", { where: m });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.fractured.PARTIAL_MOVE");
            return result;
        }

        if (this.reserve[this.currplayer - 1] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.fractured.NO_RESERVE");
            return result;
        }
        if (!this.isOpen(cell, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.fractured.CLOSED");
            return result;
        }
        if (!this.moves().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.fractured.BAD_PLACE");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { trusted = false, partial = false } = {}): FracturedGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted) {
            const validation = this.validateMove(m);
            if (!validation.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", validation.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        this.results = [];
        const player = this.currplayer;
        let claimed: string;

        if (m.includes("-")) {
            const [from, to] = m.split("-");
            const fromCell = from!.toUpperCase();
            const toCell = to!.toUpperCase();
            this.board.delete(fromCell);
            this.board.set(toCell, player);
            claimed = toCell;
            this.results.push({ type: "move", from: fromCell, to: toCell });
        } else {
            const cell = m.toUpperCase();
            this.board.set(cell, player);
            claimed = cell;
            this.reserve[player - 1]--;
            this.results.push({ type: "place", where: cell, who: player });
        }

        const points = this.computeScore(claimed, player);
        if (points > 0) {
            for (let i = 0; i < points; i++) {
                if (player === 1) {
                    this.scoreIndex--;
                } else {
                    this.scoreIndex++;
                }
            }
            this.results.push({ type: "deltaScore", delta: points, who: player });
            if (this.scoreIndex < 0) {
                this.gameover = true;
                this.winner = [1];
                this.results.push({ type: "winners", players: [1] });
            } else if (this.scoreIndex > TRACK_LEN - 1) {
                this.gameover = true;
                this.winner = [2];
                this.results.push({ type: "winners", players: [2] });
            }
        }

        if (!this.gameover && m.includes("-") === false && this.reserve[player - 1] === 0) {
            this.gameover = true;
        }

        if (this.gameover && this.winner.length === 0) {
            if (this.scoreIndex === TRACK_CENTER) {
                this.winner = [1];
            } else if (this.getPlayerScore(1) > this.getPlayerScore(2)) {
                this.winner = [1];
            } else if (this.getPlayerScore(2) > this.getPlayerScore(1)) {
                this.winner = [2];
            } else {
                this.winner = [1];
            }
            this.results.push({ type: "winners", players: [...this.winner] });
        }

        this.lastmove = m;
        if (!this.gameover) {
            this.currplayer = this.currplayer === 1 ? 2 : 1;
        }
        this.stack.push(this.moveState());
        this.load();
        return this;
    }

    public moveState(): IMoveState {
        return {
            _version: FracturedGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            reserve: [...this.reserve],
            scoreIndex: this.scoreIndex,
        };
    }

    public state(): IFracturedState {
        return {
            game: FracturedGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public sidebarScores(): IScores[] {
        return [
            {
                name: i18next.t("apgames:status.RESERVE"),
                scores: [...this.reserve],
            },
        ];
    }

    public render(): APRenderRep {
        const floodByColour = new Map<number, RowCol[]>();
        const cityPoints: RowCol[] = [];

        for (const cell of this.graph.graph.nodes()) {
            const [col, row] = this.algebraic2coords(cell);
            const pt = { row, col };
            const colour = SIZE_COLOUR[this.cellSize(cell)];
            if (colour !== undefined) {
                const bucket = floodByColour.get(colour);
                if (bucket === undefined) {
                    floodByColour.set(colour, [pt]);
                } else {
                    bucket.push(pt);
                }
            }
            if (CITIES.has(cell)) {
                cityPoints.push(pt);
            }
        }

        const markers: Array<MarkerFlood|MarkerGlyph> = [];
        for (const [colour, points] of floodByColour) {
            if (points.length > 0) {
                markers.push({
                    type: "flood",
                    colour,
                    points: points as [RowCol, ...RowCol[]],
                });
            }
        }
        if (cityPoints.length > 0) {
            markers.push({
                type: "glyph",
                glyph: "city",
                points: cityPoints as [RowCol, ...RowCol[]],
            });
        }

        let pstr = "";
        for (const row of this.graph.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const cells: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    cells.push(this.board.get(cell) === 1 ? "A" : "B");
                } else {
                    cells.push("-");
                }
            }
            pstr += cells.join(",");
        }

        const trackPieces: string[] = [];
        const scoreOnTrack = this.scoreIndex >= 0 && this.scoreIndex < TRACK_LEN;
        for (let col = 0; col < TRACK_LEN; col++) {
            if (col === this.scoreIndex && scoreOnTrack) {
                trackPieces.push("S");
            } else {
                trackPieces.push(TRACK_GLYPH_KEYS[col]!);
            }
        }

        const trackFloodP1: RowCol[] = [];
        const trackFloodP2: RowCol[] = [];
        for (let col = 0; col < TRACK_CENTER; col++) {
            trackFloodP1.push({ row: 0, col });
        }
        for (let col = TRACK_CENTER + 1; col < TRACK_LEN; col++) {
            trackFloodP2.push({ row: 0, col });
        }

        const trackAnnotations: AnnotationBasic[] = [];
        const delta = [...this.results].reverse().find(r => r.type === "deltaScore");
        if (delta !== undefined && delta.type === "deltaScore" && (delta.delta ?? 0) > 0 && delta.who !== undefined) {
            const who = delta.who as playerid;
            const to = this.scoreIndex;
            const from = who === 1 ? to + (delta.delta ?? 0) : to - (delta.delta ?? 0);
            if (from !== to) {
                if (!scoreOnTrack) {
                    const startCol = Math.min(TRACK_LEN - 1, Math.max(0, from));
                    trackAnnotations.push({
                        type: "exit",
                        targets: [{ row: 0, col: startCol }],
                    });
                } else {
                    trackAnnotations.push({
                        type: "move",
                        targets: [{ row: 0, col: from }, { row: 0, col: to }],
                        arrow: false,
                    });
                }
            }
        }

        const track: AreaTrack = {
            type: "track",
            position: "bottom",
            board: {
                style: "squares",
                width: TRACK_LEN,
                height: 1,
                markers: [
                    { type: "flood", colour: 6,opacity: 0.75, points: trackFloodP1 as [RowCol, ...RowCol[]] },
                    { type: "flood", colour: 7, opacity: 0.75,points: trackFloodP2 as [RowCol, ...RowCol[]] },
                ],
            },
            pieces: trackPieces.join(","),
            annotations: trackAnnotations.length > 0 ? trackAnnotations : undefined,
        };

        const legend: APRenderRep["legend"] = {
            A: { name: "cube", colour: 6 },
            B: { name: "cube", colour: 7 },
            S: { name: "cube", colour: 6 },
            city: { name: "star-outline", opacity: 0.5, colour: {func: "custom", default: "#fff", palette: 8} },
            N6: { name: "piecepack-number-6" },
            N5: { name: "piecepack-number-5" },
            N4: { name: "piecepack-number-4" },
            N3: { name: "piecepack-number-3" },
            N2: { name: "piecepack-number-2" },
            N1: { name: "piecepack-number-1" },
            N0: { name: "piecepack-number-void" },
        };

        const rep: APRenderRep = {
            board: {
                style: "fractured-flat",
                markers,
            },
            legend,
            pieces: pstr,
            areas: [track],
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const mv of this.results) {
                if (mv.type === "place" && mv.where !== undefined) {
                    const [col, row] = this.algebraic2coords(mv.where);
                    rep.annotations!.push({ type: "enter", targets: [{ row, col }] });
                } else if (mv.type === "move" && mv.from !== undefined && mv.to !== undefined) {
                    const [fc, fr] = this.algebraic2coords(mv.from);
                    const [tc, tr] = this.algebraic2coords(mv.to);
                    rep.annotations!.push({
                        type: "move",
                        targets: [{ row: fr, col: fc }, { row: tr, col: tc }],
                        arrow: true,
                    });
                }
            }
        }

        return rep;
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return {
                func: "custom",
                default: 6,
                palette: 6
            };
        } else {
            return {
                func: "custom",
                default: 7,
                palette: 7
            };
        }
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult, players: string[] = []): boolean {
        let resolved = false;
        switch (r.type) {
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {count: r.delta, delta: r.delta, player: players[r.who! - 1]}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): FracturedGame {
        return new FracturedGame(this.serialize());
    }
}
