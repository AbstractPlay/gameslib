import {  GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, resolveChallengeSeed, reviver, UserFacingError, type Direction } from "../common";
import { chatPlayerToken, forEachGroupResult, type ChatActorRef, type ChatLogEntry, type ChatLogLine } from "../common/chat-log";
import { type IGradeTier, type ISoloOutcomeMeta } from "./_solo-outcome";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1 | 2;

export type Stack = { owner: playerid; count: number };

export type FrameState = {
    board: Map<string, Stack>;
    sky: number;
    cave: number;
    pit: number;
    ground: number;
};

export interface IMoveState extends IIndividualState {
    currplayer: 1;
    board: Map<string, Stack>;
    sky: number;
    cave: number;
    pit: number;
    ground: number;
    frames: FrameState[];
    lastmove?: string;
}

export interface IElOsoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    challengeSeed?: string;
}

const BOARD_SIZE = 5;
const PIECES_PER_SIDE = 12;
const MAX_STACK = 5;
const PLAYER_ROW = 1;
const BEAR_ROW = 5;

const PLAYER_DIRS: readonly Direction[] = ["E", "W", "NE", "NW", "SE", "SW"];

interface ILegendObj {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
}

export class ElOsoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "El Oso",
        uid: "elOso",
        playercounts: [1],
        version: "20260827",
        dateAdded: "2026-08-27",
        description: "apgames:descriptions.elOso",
        notes: "apgames:notes.elOso",
        urls: [
            "https://crabfragmentlabs.com/el-oso",
            "https://boardgamegeek.com/boardgame/371926/el-oso",
        ],
        bggid: "371926",
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
        categories: [
            "goal>score>eog",
            "mechanic>move",
            "mechanic>capture",
            "mechanic>stack",
            "mechanic>random>setup",
            "mechanic>random>play",
            "board>shape>rect",
            "board>connect>rect",
            "components>simple>1per",
            "components>dice",
        ],
        flags: ["scores", "random-start", "experimental", "automove", "no-explore"],
        displays: [{ uid: "nums" }],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }

    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }

    public static cloneBoard(board: Map<string, Stack>): Map<string, Stack> {
        return new Map([...board.entries()].map(([cell, stack]) => [cell, { ...stack }]));
    }

    public static snapshotZones(game: Pick<ElOsoGame, "board" | "sky" | "cave" | "pit" | "ground">): FrameState {
        return {
            board: ElOsoGame.cloneBoard(game.board),
            sky: game.sky,
            cave: game.cave,
            pit: game.pit,
            ground: game.ground,
        };
    }

    public static dieToCol(die: number): number {
        return die - 1;
    }

    public static colToDie(col: number): number {
        return col + 1;
    }

    public static homeCell(owner: playerid, col: number): string {
        const row = owner === 1 ? PLAYER_ROW : BEAR_ROW;
        return ElOsoGame.coords2algebraic(col, BOARD_SIZE - row);
    }

    public static topCell(col: number): string {
        return ElOsoGame.coords2algebraic(col, 0);
    }

    public static rowOf(cell: string): number {
        return BOARD_SIZE - ElOsoGame.algebraic2coords(cell)[1];
    }

    public static isTopRow(cell: string): boolean {
        return ElOsoGame.algebraic2coords(cell)[1] === 0;
    }

    /** Merge consecutive place results for the same actor and cell (chat-friendly). */
    public static consolidatePlaceResults(results: APMoveResult[]): APMoveResult[] {
        const out: APMoveResult[] = [];
        for (const r of results) {
            if (r.type !== "place") {
                out.push(r);
                continue;
            }
            const who = (r as { who?: number }).who;
            const where = r.where;
            const add = r.count ?? 1;
            const prev = out[out.length - 1];
            if (
                prev !== undefined
                && prev.type === "place"
                && prev.where === where
                && (prev as { who?: number }).who === who
            ) {
                prev.count = (prev.count ?? 1) + add;
            } else {
                out.push({ type: "place", count: add, where, who });
            }
        }
        return out;
    }

    private static flushGroupedPlaces(
        pending: Map<string, { who: playerid; where: string; count: number }>,
        results: APMoveResult[],
    ): void {
        const places = [...pending.values()].sort((a, b) => a.where.localeCompare(b.where));
        for (const p of places) {
            results.push({ type: "place", count: p.count, where: p.where, who: p.who });
        }
        pending.clear();
    }

    private static recordSetupPlace(
        board: Map<string, Stack>,
        pending: Map<string, { who: playerid; where: string; count: number }>,
        owner: playerid,
        cell: string,
        count = 1,
    ): void {
        const existing = board.get(cell);
        if (existing === undefined) {
            board.set(cell, { owner, count });
        } else {
            existing.count += count;
        }
        const key = `${owner}:${cell}`;
        const cur = pending.get(key);
        if (cur === undefined) {
            pending.set(key, { who: owner, where: cell, count });
        } else {
            cur.count += count;
        }
    }

    public numplayers = 1;
    public currplayer = 1 as const;
    public board!: Map<string, Stack>;
    public sky = 0;
    public cave = 0;
    public pit = 0;
    public ground = 0;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public frames: FrameState[] = [];
    private selected?: string;
    private dotTargets: string[] = [];
    private showNorthBuffer = false;

    public constructor(state?: IElOsoState | string, challengeSeed?: string) {
        super();
        if (state === undefined) {
            const seed = resolveChallengeSeed(challengeSeed);
            this.initRng(seed);
            const { board, results } = ElOsoGame.runSetup(this.rng!);
            const fresh: IMoveState = {
                _version: ElOsoGame.gameinfo.version,
                _results: results,
                _timestamp: new Date(),
                currplayer: 1,
                board,
                sky: 0,
                cave: 0,
                pit: 0,
                ground: 0,
                frames: [],
                challengeSeed: seed,
                rngCounter: this.rng!.getCounter(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IElOsoState;
            }
            if (state.game !== ElOsoGame.gameinfo.uid) {
                throw new Error(`The El Oso engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.challengeSeed = state.challengeSeed;
            this.stack = state.stack.map((entry) => ({
                ...entry,
                _results: [...entry._results],
                board: ElOsoGame.cloneBoard(entry.board),
                frames: entry.frames.map((f) => ({
                    ...f,
                    board: ElOsoGame.cloneBoard(f.board),
                })),
            }));
        }
        this.load();
    }

    public static runSetup(rng: { randomInt(max: number, min?: number): number }): {
        board: Map<string, Stack>;
        results: APMoveResult[];
    } {
        const board = new Map<string, Stack>();
        const results: APMoveResult[] = [];
        const pending = new Map<string, { who: playerid; where: string; count: number }>();

        const rollPlacement = (owner: playerid, remaining: number): number[] => {
            const dice: number[] = [];
            for (let i = 0; i < remaining; i++) {
                let placed = false;
                while (!placed) {
                    const die = rng.randomInt(6);
                    dice.push(die);
                    if (die === 6) {
                        continue;
                    }
                    const col = ElOsoGame.dieToCol(die);
                    const cell = ElOsoGame.homeCell(owner, col);
                    const stack = board.get(cell)!;
                    if (stack.count >= MAX_STACK) {
                        continue;
                    }
                    ElOsoGame.recordSetupPlace(board, pending, owner, cell);
                    placed = true;
                }
            }
            return dice;
        };

        results.push({ type: "announce", payload: ["playerSetup"] });
        for (let col = 0; col < BOARD_SIZE; col++) {
            ElOsoGame.recordSetupPlace(board, pending, 1, ElOsoGame.homeCell(1, col));
        }

        const playerDice = rollPlacement(1, PIECES_PER_SIDE - BOARD_SIZE);
        results.push({ type: "roll", values: playerDice, who: 1 });
        ElOsoGame.flushGroupedPlaces(pending, results);

        results.push({ type: "announce", payload: ["bearSetup"] });
        for (let col = 0; col < BOARD_SIZE; col++) {
            ElOsoGame.recordSetupPlace(board, pending, 2, ElOsoGame.homeCell(2, col));
        }

        const bearDice = rollPlacement(2, PIECES_PER_SIDE - BOARD_SIZE);
        results.push({ type: "roll", values: bearDice, who: 2 });
        ElOsoGame.flushGroupedPlaces(pending, results);

        return { board, results };
    }

    public load(idx = -1): ElOsoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = 1;
        this.board = ElOsoGame.cloneBoard(state.board);
        this.sky = state.sky;
        this.cave = state.cave;
        this.pit = state.pit;
        this.ground = state.ground;
        this.frames = deepclone(state.frames) as FrameState[];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.clearMoveHints();
        this.restoreSoloRngFromEntry(state);
        return this;
    }

    private clearMoveHints(): void {
        this.selected = undefined;
        this.dotTargets = [];
        this.showNorthBuffer = false;
    }

    private applyMoveHints(from: string): void {
        this.clearMoveHints();
        const legal = this.moves().filter((m) => m.startsWith(`${from}-`));
        if (legal.length === 0) {
            return;
        }
        this.selected = from;
        this.dotTargets = legal
            .map((m) => m.split("-")[1]!)
            .filter((dest) => dest !== "pass" && dest !== "sky");
        this.showNorthBuffer = legal.includes(`${from}-sky`);
    }

    public playerPiecesOnBoard(): number {
        let n = 0;
        for (const stack of this.board.values()) {
            if (stack.owner === 1) {
                n += stack.count;
            }
        }
        return n;
    }

    public stacksInColumn(col: number): string[] {
        const cells: string[] = [];
        for (let y = 0; y < BOARD_SIZE; y++) {
            const cell = ElOsoGame.coords2algebraic(col, y);
            if (this.board.has(cell)) {
                cells.push(cell);
            }
        }
        return cells;
    }

    public highestBearInColumn(col: number): string | undefined {
        for (let y = 0; y < BOARD_SIZE; y++) {
            const cell = ElOsoGame.coords2algebraic(col, y);
            const stack = this.board.get(cell);
            if (stack !== undefined && stack.owner === 2) {
                return cell;
            }
        }
        return undefined;
    }

    public isAllowedPlayerDirection(fx: number, fy: number, tx: number, ty: number): boolean {
        const bearing = RectGrid.bearing(fx, fy, tx, ty);
        return bearing !== undefined && PLAYER_DIRS.includes(bearing);
    }

    public pathClear(fx: number, fy: number, tx: number, ty: number): boolean {
        let between: [number, number][];
        try {
            between = RectGrid.between(fx, fy, tx, ty);
        } catch {
            return false;
        }
        for (const [bx, by] of between) {
            const cell = ElOsoGame.coords2algebraic(bx, by);
            if (this.board.has(cell)) {
                return false;
            }
        }
        return true;
    }

    public annihilateAt(cell: string, movingOwner: playerid, movingCount: number): number {
        const dest = this.board.get(cell);
        if (dest === undefined) {
            this.board.set(cell, { owner: movingOwner, count: movingCount });
            return movingCount;
        }

        if (dest.owner === movingOwner) {
            dest.count += movingCount;
            return dest.count;
        }

        const paired = Math.min(dest.count, movingCount);
        this.pit += paired;
        this.cave += paired;
        const destRemain = dest.count - paired;
        const moveRemain = movingCount - paired;

        if (destRemain === 0 && moveRemain === 0) {
            this.board.delete(cell);
            return 0;
        }
        if (destRemain > 0) {
            dest.count = destRemain;
            return destRemain;
        }
        this.board.set(cell, { owner: movingOwner, count: moveRemain });
        return moveRemain;
    }

    public moveStack(from: string, to: string): void {
        const stack = this.board.get(from)!;
        this.board.delete(from);
        this.annihilateAt(to, stack.owner, stack.count);
    }

    public addToZone(stack: Stack, count: number): void {
        if (stack.owner === 1) {
            this.pit += count;
        } else {
            this.cave += count;
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        void piece;
        try {
            let cell: string | undefined;
            if (row >= 0 && col >= 0) {
                cell = ElOsoGame.coords2algebraic(col, row);
            }
            let newmove = "";
            if (move.length === 0) {
                if (cell === undefined || !this.board.has(cell)) {
                    return {
                        move: "",
                        message: i18next.t("apgames:validation.elOso.INITIAL_INSTRUCTIONS"),
                    } as IClickResult;
                }
                const stack = this.board.get(cell)!;
                if (stack.owner !== 1) {
                    return {
                        move: "",
                        message: i18next.t("apgames:validation.elOso.INITIAL_INSTRUCTIONS"),
                    } as IClickResult;
                }
                newmove = cell;
            } else {
                const parts = move.split("-");
                const start = parts[0];
                if (cell === undefined) {
                    if (parts.length === 1 && ElOsoGame.isTopRow(start)) {
                        newmove = `${start}-sky`;
                    } else {
                        newmove = move;
                    }
                } else if (!this.board.has(start)) {
                    newmove = this.board.has(cell) ? cell : move;
                } else if (parts.length === 1) {
                    if (cell === start) {
                        newmove = `${start}-pass`;
                    } else if (!this.board.has(cell)) {
                        newmove = `${start}-${cell}`;
                    } else {
                        newmove = cell;
                    }
                } else {
                    newmove = `${start}-${cell}`;
                }
            }

            let result = this.validateMove(newmove) as IClickResult;
            if (result.autocomplete !== undefined) {
                newmove = result.autocomplete;
                result = this.validateMove(newmove) as IClickResult;
            }
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
                    move,
                    row,
                    col,
                    piece,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        if (this.gameover) {
            result.message = i18next.t("apgames:validation._general.GAMEOVER");
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.elOso.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase().replace(/\s+/g, "");

        if (m === "pass") {
            result.message = i18next.t("apgames:validation.elOso.SELECT_STACK_FOR_PASS");
            return result;
        }

        const parts = m.split("-");
        if (parts.length === 1) {
            const from = parts[0];
            try {
                ElOsoGame.algebraic2coords(from);
            } catch {
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: from });
                return result;
            }
            if (!this.board.has(from)) {
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }
            if (this.board.get(from)!.owner !== 1) {
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = ElOsoGame.isTopRow(from)
                ? i18next.t("apgames:validation.elOso.VALID_PARTIAL_TOP")
                : i18next.t("apgames:validation.elOso.VALID_PARTIAL");
            const matches = this.moves().filter((mv) => mv.startsWith(`${from}-`));
            if (matches.length === 1) {
                result.autocomplete = matches[0];
            }
            return result;
        }

        if (parts.length !== 2) {
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }

        const [from, dest] = parts;
        try {
            ElOsoGame.algebraic2coords(from);
        } catch {
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: from });
            return result;
        }

        if (!this.board.has(from)) {
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
            return result;
        }

        const stack = this.board.get(from)!;
        if (stack.owner !== 1) {
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        if (dest === "pass") {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            result.complete = 1;
            return result;
        }

        if (dest === "sky") {
            if (!ElOsoGame.isTopRow(from)) {
                result.message = i18next.t("apgames:validation.elOso.SKY_FROM_TOP");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        try {
            ElOsoGame.algebraic2coords(dest);
        } catch {
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: dest });
            return result;
        }

        if (this.board.has(dest)) {
            result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", { where: dest });
            return result;
        }

        const [fx, fy] = ElOsoGame.algebraic2coords(from);
        const [tx, ty] = ElOsoGame.algebraic2coords(dest);

        if (!this.isAllowedPlayerDirection(fx, fy, tx, ty)) {
            result.message = i18next.t("apgames:validation.elOso.INVALID_DIRECTION");
            return result;
        }

        const dist = RectGrid.distance(fx, fy, tx, ty);
        if (dist > stack.count) {
            result.message = i18next.t("apgames:validation.elOso.TOO_FAR", { dist: stack.count });
            return result;
        }

        if (!this.pathClear(fx, fy, tx, ty)) {
            result.message = i18next.t("apgames:validation._general.OBSTRUCTED", { from, to: dest, obstruction: "" });
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }

        const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);
        const out: string[] = [];

        for (const [from, stack] of this.board.entries()) {
            if (stack.owner !== 1) {
                continue;
            }

            out.push(`${from}-pass`);

            if (ElOsoGame.isTopRow(from)) {
                out.push(`${from}-sky`);
            }

            const [fx, fy] = ElOsoGame.algebraic2coords(from);
            for (const dir of PLAYER_DIRS) {
                const ray = grid.ray(fx, fy, dir);
                for (let i = 0; i < Math.min(stack.count, ray.length); i++) {
                    const [tx, ty] = ray[i]!;
                    const to = ElOsoGame.coords2algebraic(tx, ty);
                    if (this.board.has(to)) {
                        break;
                    }
                    const m = `${from}-${to}`;
                    const v = this.validateMove(m);
                    if (v.valid && v.complete === 1) {
                        out.push(m);
                    }
                }
            }
        }

        return out.sort((a, b) => a.localeCompare(b));
    }

    protected pushGroup(who: number, groupResults: APMoveResult[]): void {
        if (groupResults.length === 0) {
            return;
        }
        this.results.push({
            type: "_group",
            who,
            results: groupResults as [APMoveResult, ...APMoveResult[]],
        });
        this.frames.push(ElOsoGame.snapshotZones(this));
    }

    protected appendBearResults(bearResults: APMoveResult[], nested: APMoveResult[]): void {
        bearResults.push(...nested);
    }

    protected rollDie(): number {
        return this.rng!.randomInt(6);
    }

    protected executePlayerMove(m: string): { height: number; playerPart: string } {
        const [from, dest] = m.split("-");
        const stack = this.board.get(from)!;
        const height = stack.count;
        const group: APMoveResult[] = [];

        if (dest === "pass") {
            group.push({ type: "pass", who: 1 });
            this.pushGroup(1, group);
            return { height, playerPart: `${from}-pass` };
        }

        if (dest === "sky") {
            this.board.delete(from);
            this.sky += stack.count;
            group.push({ type: "move", from, to: "sky", count: stack.count });
            this.pushGroup(1, group);
            return { height, playerPart: `${from}-sky` };
        }

        this.moveStack(from, dest);
        group.push({ type: "move", from, to: dest, count: stack.count });
        this.pushGroup(1, group);
        return { height, playerPart: `${from}-${dest}` };
    }

    protected spawnFromCave(col: number, bearResults: APMoveResult[]): string[] {
        if (this.cave === 0) {
            return [];
        }
        const count = Math.min(MAX_STACK, this.cave);
        this.cave -= count;
        const cell = ElOsoGame.topCell(col);
        const group: APMoveResult[] = [{ type: "place", count, where: cell, who: 2 }];
        const existing = this.board.get(cell);
        if (existing !== undefined && existing.owner === 1) {
            const paired = Math.min(existing.count, count);
            this.pit += paired;
            this.cave += paired;
            const destRemain = existing.count - paired;
            const bearRemain = count - paired;
            if (destRemain === 0 && bearRemain === 0) {
                this.board.delete(cell);
            } else if (destRemain > 0) {
                this.board.set(cell, { owner: 1, count: destRemain });
                if (bearRemain > 0) {
                    this.cave += bearRemain;
                }
            } else {
                this.board.set(cell, { owner: 2, count: bearRemain });
            }
            if (paired > 0) {
                group.push({ type: "capture", where: cell, count: paired });
            }
        } else if (existing === undefined) {
            this.board.set(cell, { owner: 2, count });
        } else {
            const space = MAX_STACK - existing.count;
            const placed = Math.min(count, space);
            existing.count += placed;
            if (placed < count) {
                this.cave += count - placed;
            }
        }
        this.appendBearResults(bearResults, group);
        return [`${count}@${cell}`];
    }

    protected advanceBearStack(from: string, bearResults: APMoveResult[]): string {
        const stack = this.board.get(from)!;
        const [x, y] = ElOsoGame.algebraic2coords(from);
        const ny = y + 1;

        if (ny >= BOARD_SIZE) {
            this.board.delete(from);
            this.ground += stack.count;
            this.appendBearResults(bearResults, [{ type: "move", from, to: "ground", count: stack.count }]);
            return `${from}-ground`;
        }

        const to = ElOsoGame.coords2algebraic(x, ny);
        const dest = this.board.get(to);
        this.board.delete(from);

        const group: APMoveResult[] = [];
        if (dest !== undefined && dest.owner === 1) {
            const paired = Math.min(dest.count, stack.count);
            this.pit += paired;
            this.cave += paired;
            const destRemain = dest.count - paired;
            const bearRemain = stack.count - paired;
            if (destRemain === 0 && bearRemain === 0) {
                this.board.delete(to);
            } else if (destRemain > 0) {
                this.board.set(to, { owner: 1, count: destRemain });
            } else {
                this.board.set(to, { owner: 2, count: bearRemain });
            }
            group.push({ type: "capture", where: to, count: paired });
            group.push({ type: "move", from, to, count: stack.count });
            this.appendBearResults(bearResults, group);
            return `${from}x${to}`;
        }

        if (dest !== undefined && dest.owner === 2) {
            dest.count += stack.count;
            this.appendBearResults(bearResults, [{ type: "move", from, to, count: stack.count }]);
            return `${from}-${to}`;
        }

        this.board.set(to, { owner: 2, count: stack.count });
        this.appendBearResults(bearResults, [{ type: "move", from, to, count: stack.count }]);
        return `${from}-${to}`;
    }

    protected resolveBearDie(die: number, bearResults: APMoveResult[]): string[] {
        const notations: string[] = [];
        if (die === 6) {
            return notations;
        }
        const col = ElOsoGame.dieToCol(die);
        const bearCells = this.stacksInColumn(col).filter((c) => this.board.get(c)!.owner === 2);

        if (bearCells.length === 0) {
            return this.spawnFromCave(col, bearResults);
        }

        const from = this.highestBearInColumn(col)!;
        notations.push(this.advanceBearStack(from, bearResults));
        return notations;
    }

    protected rainFromGround(): string[] {
        const notations: string[] = [];
        while (this.ground > 0) {
            this.ground -= 1;
            const die = this.rollDie();
            const group: APMoveResult[] = [{ type: "roll", values: [die], who: 2 }];
            if (die === 6) {
                this.cave += 1;
                this.pushGroup(2, group);
                continue;
            }
            const col = ElOsoGame.dieToCol(die);
            const cell = ElOsoGame.topCell(col);
            const existing = this.board.get(cell);
            if (existing !== undefined && existing.owner === 2 && existing.count >= MAX_STACK) {
                this.cave += 1;
                this.pushGroup(2, group);
                continue;
            }
            group.push({ type: "place", count: 1, where: cell, who: 2 });
            if (existing !== undefined && existing.owner === 1) {
                const paired = 1;
                this.pit += paired;
                this.cave += paired;
                if (existing.count > 1) {
                    existing.count -= 1;
                } else {
                    this.board.delete(cell);
                }
                group.push({ type: "capture", where: cell, count: paired });
            } else if (existing === undefined) {
                this.board.set(cell, { owner: 2, count: 1 });
            } else {
                existing.count += 1;
            }
            notations.push(`1@${cell}`);
            this.pushGroup(2, ElOsoGame.consolidatePlaceResults(group));
        }
        return notations;
    }

    protected executeBearPhase(stackHeight: number): string {
        const dice: number[] = [];
        for (let i = 0; i < stackHeight; i++) {
            dice.push(this.rollDie());
        }
        const sorted = [...dice].sort((a, b) => a - b);
        const bearResults: APMoveResult[] = [{ type: "roll", values: dice, who: 2 }];

        const bearNotations: string[] = [];
        for (const die of sorted) {
            bearNotations.push(...this.resolveBearDie(die, bearResults));
        }
        this.pushGroup(2, ElOsoGame.consolidatePlaceResults(bearResults));
        bearNotations.push(...this.rainFromGround());
        return bearNotations.join(",");
    }

    public move(m: string, { partial = false, trusted = false, emulation = false } = {}): ElOsoGame {
        if (this.gameover) {
            throw new UserFacingError("GAMEOVER", i18next.t("apgames:validation._general.GAMEOVER"));
        }

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && result.complete !== 1) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        if (partial) {
            const parts = m.split("-");
            if (parts.length === 1) {
                this.applyMoveHints(parts[0]!);
            } else {
                this.clearMoveHints();
            }
            return this;
        }

        if (emulation) {
            this.clearMoveHints();
            if (m.includes("-")) {
                this.load(this.stack.length - 1);
                this.results = [];
                this.frames = [];
                this.executePlayerMove(m);
            }
            return this;
        }

        this.clearMoveHints();

        this.results = [];
        this.frames = [ElOsoGame.snapshotZones(this)];

        const { height, playerPart } = this.executePlayerMove(m);
        const bearPart = this.executeBearPhase(height);

        this.frames.pop();
        if (this.results.length !== this.frames.length) {
            throw new Error("There's a mismatch in the length of the results array and the frames array.");
        }

        this.lastmove = bearPart.length > 0 ? `${playerPart};${bearPart}` : playerPart;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): ElOsoGame {
        if (this.playerPiecesOnBoard() === 0) {
            this.gameover = true;
            this.winner = [1];
            this.results.push({ type: "eog" });
        }
        return this;
    }

    public getSoloOutcomeMeta(): ISoloOutcomeMeta {
        return {
            outcomeType: "graded",
            scoreDirection: "higher",
            scoreLabel: "apgames:status.elOso.SKY",
        };
    }

    public getGradeTiers(): IGradeTier[] {
        return [
            { id: "loss", label: "apgames:status.elOso.GRADE_LOSS", threshold: 0 },
            { id: "win", label: "apgames:status.elOso.GRADE_WIN", threshold: 10 },
            { id: "superior", label: "apgames:status.elOso.GRADE_SUPERIOR", threshold: 11 },
            { id: "excellent", label: "apgames:status.elOso.GRADE_EXCELLENT", threshold: 12 },
        ];
    }

    public getPlayerScore(player: number): number | undefined {
        if (player !== 1) {
            return undefined;
        }
        return this.sky;
    }

    public sidebarStatuses(): IStatus[] {
        return [
            { key: i18next.t("apgames:status.elOso.SKY"), value: [this.sky.toString()] },
            { key: i18next.t("apgames:status.elOso.CAVE"), value: [this.cave.toString()] },
            { key: i18next.t("apgames:status.elOso.GROUND"), value: [this.ground.toString()] },
            { key: i18next.t("apgames:status.elOso.PIT"), value: [this.pit.toString()] },
        ];
    }

    public sidebarScores(): IScores[] {
        if (!this.gameover) {
            return [];
        }
        return [
            {
                name: i18next.t("apgames:status.elOso.SKY"),
                scores: [this.getPlayerScore(1)!.toString()],
            },
        ];
    }

    public getStartingPosition(): string {
        return this.stack[0]._results
            .filter((r): r is Extract<APMoveResult, { type: "place" }> => r.type === "place")
            .map((r) => `${r.count}@${r.where}`)
            .join(",");
    }

    public state(): IElOsoState {
        return {
            game: ElOsoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            challengeSeed: this.challengeSeed,
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ElOsoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: 1,
            lastmove: this.lastmove,
            board: ElOsoGame.cloneBoard(this.board),
            sky: this.sky,
            cave: this.cave,
            pit: this.pit,
            ground: this.ground,
            frames: deepclone(this.frames),
            challengeSeed: this.challengeSeed,
            rngCounter: this.rng?.getCounter(),
        };
    }

    public render(opts?: IRenderOpts): APRenderRep[] {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        const useNums = altDisplay === "nums";

        const renders: APRenderRep[] = [];
        for (let i = 0; i < this.frames.length + 1; i++) {
            let snapshot: FrameState;
            if (i < this.frames.length) {
                snapshot = this.frames[i];
            } else {
                snapshot = ElOsoGame.snapshotZones(this);
            }

            let frameResults: APMoveResult[] = [];
            if (i > 0 && this.results.length > 0) {
                const group = this.results[i - 1];
                if (group !== undefined && group.type === "_group") {
                    frameResults = group.results;
                }
            }

            let pstr = "";
            for (let y = 0; y < BOARD_SIZE; y++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                const pieces: string[] = [];
                for (let x = 0; x < BOARD_SIZE; x++) {
                    const cell = ElOsoGame.coords2algebraic(x, y);
                    const stack = snapshot.board.get(cell);
                    if (stack !== undefined) {
                        if (useNums) {
                            const prefix = stack.owner === 1 ? "pA" : "pB";
                            pieces.push(`${prefix}${stack.count}`);
                        } else {
                            const glyph = stack.owner === 1 ? "A" : "B";
                            pieces.push(glyph.repeat(stack.count));
                        }
                    } else {
                        pieces.push("-");
                    }
                }
                pstr += pieces.join(",");
            }

            const legend: ILegendObj = {};
            if (useNums) {
                const pcs = new Set<string>(pstr.split(/[,\n]/));
                for (const pc of pcs) {
                    if (pc !== "-") {
                        legend[pc] = [
                            {
                                name: "piece",
                                colour: pc.startsWith("pA") ? 1 : 2,
                            },
                            {
                                text: pc.substring(2),
                            },
                        ];
                    }
                }
            } else {
                legend.A = {
                    name: "piece",
                    colour: 1,
                };
                legend.B = {
                    name: "piece",
                    colour: 2,
                };
            }

            const rep: APRenderRep = {
                renderer: useNums ? "default" : "stacking-offset",
                board: {
                    style: "squares-checkered",
                    width: BOARD_SIZE,
                    height: BOARD_SIZE,
                    markers: [
                        { type: "edge", edge: "N", colour: 1 },
                        { type: "edge", edge: "S", colour: 2 },
                    ],
                    buffer: i === this.frames.length && this.showNorthBuffer
                        ? {
                            width: 0.2,
                            pattern: "slant",
                            show: ["N"],
                        }
                        : undefined,
                },
                legend,
                pieces: pstr,
            };

            rep.annotations = [];
            for (const r of frameResults) {
                if (r.type === "move" && r.from !== undefined && r.to !== undefined) {
                    if (r.to === "sky" || r.to === "ground") {
                        const [fx, fy] = ElOsoGame.algebraic2coords(r.from);
                        rep.annotations.push({
                            type: "exit",
                            targets: [{ row: fy, col: fx }],
                        });
                    } else {
                        const [fx, fy] = ElOsoGame.algebraic2coords(r.from);
                        const [tx, ty] = ElOsoGame.algebraic2coords(r.to);
                        rep.annotations.push({
                            type: "move",
                            targets: [
                                { row: fy, col: fx },
                                { row: ty, col: tx },
                            ],
                        });
                    }
                } else if (r.type === "capture" && r.where !== undefined) {
                    const [x, y] = ElOsoGame.algebraic2coords(r.where);
                    rep.annotations.push({
                        type: "enter",
                        targets: [{ row: y, col: x }],
                    });
                } else if (r.type === "place" && r.where !== undefined) {
                    const [x, y] = ElOsoGame.algebraic2coords(r.where);
                    rep.annotations.push({
                        type: "enter",
                        targets: [{ row: y, col: x }],
                    });
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }

            if (i === this.frames.length && this.selected !== undefined) {
                if (rep.annotations === undefined) {
                    rep.annotations = [];
                }
                const [sx, sy] = ElOsoGame.algebraic2coords(this.selected);
                rep.annotations.push({
                    type: "exit",
                    targets: [{ row: sy, col: sx }],
                });
            }

            if (i === this.frames.length && this.dotTargets.length > 0) {
                if (rep.annotations === undefined) {
                    rep.annotations = [];
                }
                const points: RowCol[] = [];
                for (const dest of this.dotTargets) {
                    const [x, y] = ElOsoGame.algebraic2coords(dest);
                    points.push({ row: y, col: x });
                }
                rep.annotations.push({
                    type: "dots",
                    size: 0.33,
                    colour: "_context_background",
                    opacity: 0.66,
                    targets: points as [RowCol, ...RowCol[]],
                });
                rep.annotations.push({
                    type: "dots",
                    colour: "_context_annotations",
                    targets: points as [RowCol, ...RowCol[]],
                });
            }

            renders.push(rep);
        }
        return renders;
    }

    /** Chat lines for the result group shown on render frame `frameIndex` (1-based among move frames). */
    public frameCaptionLines(frameIndex: number): ChatLogLine[] {
        if (frameIndex <= 0 || frameIndex > this.results.length) {
            return [];
        }
        const group = this.results[frameIndex - 1];
        if (group === undefined) {
            return [];
        }
        const lines: ChatLogLine[] = [];
        this.collectChatLogLines(lines, group, 1);
        return lines;
    }

    public override getChatActorRef(seat: number): ChatActorRef {
        if (seat === 2) {
            return { kind: "label", key: "apresults:ACTOR.elOso.bear" };
        }
        return { kind: "seat", seat };
    }

    private seatFromResult(r: APMoveResult, fallback: number): number {
        const who = (r as { who?: number }).who;
        return who ?? fallback;
    }

    private rollChatKey(seat: number): string {
        return seat === 2 ? "apresults:ROLL.elOso" : "apresults:ROLL.elOso_player";
    }

    private pushElOsoChatLine(lines: ChatLogLine[], r: APMoveResult, defaultWho: number): void {
        const seat = this.seatFromResult(r, defaultWho);
        const actor = this.getChatActorRef(seat);
        const player = chatPlayerToken(seat);
        switch (r.type) {
            case "place":
                lines.push({
                    actor,
                    textKey: "apresults:PLACE.elOso",
                    textParams: { player, count: r.count!, where: r.where! },
                });
                break;
            case "move":
                lines.push({
                    actor,
                    textKey: "apresults:MOVE.elOso",
                    textParams: { player, from: r.from!, to: r.to!, count: r.count! },
                });
                break;
            case "capture":
                lines.push({
                    actor,
                    textKey: "apresults:CAPTURE.elOso",
                    textParams: { player, where: r.where!, count: r.count! },
                });
                break;
            case "roll":
                lines.push({
                    actor,
                    textKey: this.rollChatKey(seat),
                    textParams: { player, dice: r.values.join(", ") },
                });
                break;
            case "pass":
                lines.push({
                    actor,
                    textKey: "apresults:PASS.elOso",
                    textParams: { player },
                });
                break;
            default:
                break;
        }
    }

    private collectChatLogLines(lines: ChatLogLine[], r: APMoveResult, defaultWho: number): void {
        if (forEachGroupResult(r, defaultWho, (nested, who) => this.pushElOsoChatLine(lines, nested, who))) {
            return;
        }
        if (r.type === "announce") {
            const tag = (r.payload as string[])[0];
            if (tag === "playerSetup") {
                lines.push({ actor: { kind: "none" }, textKey: "apresults:ANNOUNCE.elOso.playerSetup" });
            } else if (tag === "bearSetup") {
                lines.push({ actor: { kind: "none" }, textKey: "apresults:ANNOUNCE.elOso.bearSetup" });
            }
            return;
        }
        if (r.type === "eog") {
            lines.push({ actor: { kind: "none" }, textKey: "apresults:EOG.default" });
            return;
        }
        if (r.type === "place" || r.type === "move" || r.type === "pass" || r.type === "capture" || r.type === "roll") {
            this.pushElOsoChatLine(lines, r, defaultWho);
        }
    }


    public chatLogEntries(players: string[] = []): ChatLogEntry[] {
        void players;
        const entries: ChatLogEntry[] = [];
        for (const state of this.stack) {
            if (state._results !== undefined && state._results.length > 0) {
                const lines: ChatLogLine[] = [];
                for (const r of state._results) {
                    this.collectChatLogLines(lines, r, state.currplayer as number);
                }
                entries.push({
                    timestamp: (state._timestamp && new Date(state._timestamp).toISOString()) || "unknown",
                    lines,
                });
            }
        }
        return entries;
    }

    public clone(): ElOsoGame {
        return new ElOsoGame(this.state());
    }
}
