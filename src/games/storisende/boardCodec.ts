import { generateField, hexNeighbours } from "../../common/hexes.js";
import type { playerid, Tile } from "../storisende.js";
import { StorisendeBoard } from "./board.js";
import { StorisendeHex } from "./hex.js";

/** Same value as `StorisendeGame.gameinfo.version` for new games (implementation date YYYYMMDD). */
export const COMPACT_BOARD_VERSION = "20260913";

/** Keyframe interval for delta-v1 stacks (compact games only). */
export const BOARD_KEYFRAME_INTERVAL = 20;

/** Prefix for `getStartingPosition()` / record `startingPosition` on modular boards. */
export const MODULAR_STARTING_POSITION_PREFIX = "modular-centres-v1";

export type SparseCellWire = {
    q: number;
    r: number;
    tile?: Tile;
    stack?: playerid[];
};

export type SparseBoardV1 = {
    fmt: "sparse-v1";
    cells: SparseCellWire[];
};

export type BoardDeltaV1 = {
    fmt: "delta-v1";
    changes: SparseCellWire[];
};

export type BoardWire = StorisendeHex[] | SparseBoardV1 | BoardDeltaV1;

export function usesCompactWire(stack: Array<{_version: string}>): boolean {
    if (stack.length === 0) {
        return false;
    }
    return stack[0]._version >= COMPACT_BOARD_VERSION;
}

export function storisendeBoardCentres(variants: string[]): {q: number; r: number}[] {
    const ctrs: {q: number; r: number}[] = [];
    if (variants.includes("board-hex4")) {
        ctrs.push({q: 0, r: 0}, {q: 0, r: -2}, {q: 2, r: -2}, {q: 2, r: 0}, {q: 0, r: 2}, {q: -2, r: 2}, {q: -2, r: 0});
    } else if (variants.includes("board-hex6")) {
        ctrs.push(
            {q: 2, r: -4}, {q: 4, r: -4}, {q: 0, r: -4},
            {q: 1, r: -2}, {q: 4, r: -2}, {q: -2, r: -2},
            {q: 0, r: 0}, {q: 2, r: 0}, {q: 4, r: 0}, {q: -2, r: 0}, {q: -4, r: 0},
            {q: -1, r: 2}, {q: 2, r: 2}, {q: -4, r: 2},
            {q: -2, r: 4}, {q: 0, r: 4}, {q: -4, r: 4},
        );
    } else if (variants.includes("board-hex7")) {
        ctrs.push(
            {q: 0, r: -5}, {q: 2, r: -5}, {q: 3, r: -5}, {q: 5, r: -5},
            {q: -2, r: -3}, {q: 5, r: -3},
            {q: 0, r: -2}, {q: -3, r: -2}, {q: 2, r: -2}, {q: 5, r: -2},
            {q: 0, r: 0}, {q: 2, r: 0}, {q: 5, r: 0}, {q: -2, r: 0}, {q: -5, r: 0},
            {q: 0, r: 2}, {q: 3, r: 2}, {q: -2, r: 2}, {q: -5, r: 2},
            {q: -5, r: 3}, {q: 2, r: 3},
            {q: 0, r: 5}, {q: -2, r: 5}, {q: -3, r: 5}, {q: -5, r: 5},
        );
    } else if (variants.includes("board-modular-13")) {
        ctrs.push(...generateField(13));
    } else if (variants.includes("board-modular-18")) {
        ctrs.push(...generateField(18));
    } else {
        ctrs.push(
            {q: 3, r: -3}, {q: 0, r: -3}, {q: 1, r: -3},
            {q: 1, r: -2},
            {q: 2, r: -1}, {q: -1, r: -1},
            {q: -2, r: -1}, {q: 3, r: -1},
            {q: 0, r: 0}, {q: 3, r: 0}, {q: -3, r: 0},
            {q: -3, r: 1}, {q: 2, r: 1},
            {q: 1, r: 1}, {q: -2, r: 1},
            {q: -1, r: 2},
            {q: 0, r: 3}, {q: -3, r: 3}, {q: -1, r: 3},
        );
    }
    return ctrs;
}

export function emptyBoardHexes(variants: string[]): StorisendeHex[] {
    return new StorisendeBoard({centres: storisendeBoardCentres(variants)}).serialize();
}

export function modularModuleCount(variants: string[]): number | undefined {
    if (variants.includes("board-modular-13")) {
        return 13;
    }
    if (variants.includes("board-modular-18")) {
        return 18;
    }
    return undefined;
}

export function isModularStorisendeVariant(variants: string[]): boolean {
    return modularModuleCount(variants) !== undefined;
}

/**
 * Recover module centre coordinates from a full modular board (e.g. stack[0] wire).
 * Greedy cover until `StorisendeBoard({ centres })` matches the hex set.
 */
export function recoverModularCentresFromHexes(
    hexes: StorisendeHex[],
    numModules: number,
): {q: number; r: number}[] {
    const target = hexCoordKeys(hexes);
    const keys = target;
    const candidates = hexes.filter(h =>
        hexNeighbours(h).every(n => keys.has(`${n.q},${n.r}`)),
    );
    const centres: {q: number; r: number}[] = [];

    while (centres.length < numModules) {
        let best: {q: number; r: number} | undefined;
        let bestNew = -1;
        const builtBefore = centres.length === 0 ? new Set<string>() : hexCoordKeys(
            new StorisendeBoard({centres}).serialize(),
        );
        for (const c of candidates) {
            if (centres.some(x => x.q === c.q && x.r === c.r)) {
                continue;
            }
            const trial = hexCoordKeys(new StorisendeBoard({centres: [...centres, c]}).serialize());
            let newCount = 0;
            for (const k of trial) {
                if (!builtBefore.has(k)) {
                    newCount++;
                }
            }
            if (newCount > bestNew) {
                bestNew = newCount;
                best = {q: c.q, r: c.r};
            }
        }
        if (best === undefined) {
            throw new Error("Could not recover modular board centres from hex topology");
        }
        centres.push(best);
        const built = hexCoordKeys(new StorisendeBoard({centres}).serialize());
        if (built.size === target.size && [...built].every(k => target.has(k))) {
            break;
        }
    }

    const finalBuilt = hexCoordKeys(new StorisendeBoard({centres}).serialize());
    if (finalBuilt.size !== target.size || ![...finalBuilt].every(k => target.has(k))) {
        throw new Error("Recovered modular centres do not reproduce stack[0] board topology");
    }
    return centres;
}

export function formatModularStartingPosition(
    centres: {q: number; r: number}[],
    numModules: number,
): string {
    const sorted = [...centres].sort((a, b) => (a.q !== b.q ? a.q - b.q : a.r - b.r));
    const body = sorted.map(({q, r}) => `${q},${r}`).join(";");
    return `${MODULAR_STARTING_POSITION_PREFIX}/${numModules}/${body}`;
}

export function parseModularStartingPosition(value: string): {numModules: number; centres: {q: number; r: number}[]} {
    if (!value.startsWith(`${MODULAR_STARTING_POSITION_PREFIX}/`)) {
        throw new Error("Not a modular Storisende starting position");
    }
    const rest = value.slice(MODULAR_STARTING_POSITION_PREFIX.length + 1);
    const slash = rest.indexOf("/");
    if (slash === -1) {
        throw new Error("Invalid modular starting position");
    }
    const numModules = parseInt(rest.slice(0, slash), 10);
    const body = rest.slice(slash + 1);
    const centres = body.length === 0 ? [] : body.split(";").map(pair => {
        const [qs, rs] = pair.split(",");
        const q = parseInt(qs!, 10);
        const r = parseInt(rs!, 10);
        if (Number.isNaN(q) || Number.isNaN(r)) {
            throw new Error(`Invalid centre coordinate ${pair}`);
        }
        return {q, r};
    });
    return {numModules, centres};
}

function hexCoordKeys(hexes: StorisendeHex[]): Set<string> {
    return new Set(hexes.map(h => `${h.q},${h.r}`));
}

/** Topology template for sparse decode (modular uses `startingPosition` centres). */
export function topologyHexes(variants: string[], startingPosition = ""): StorisendeHex[] {
    if (
        startingPosition.length > 0
        && startingPosition.startsWith(`${MODULAR_STARTING_POSITION_PREFIX}/`)
    ) {
        const {centres} = parseModularStartingPosition(startingPosition);
        return new StorisendeBoard({centres}).serialize();
    }
    return emptyBoardHexes(variants);
}

export function modularStartingPositionFromLegacyStack(
    stack: Array<{board: BoardWire}>,
    variants: string[],
): string | undefined {
    const numModules = modularModuleCount(variants);
    if (numModules === undefined || stack.length === 0) {
        return undefined;
    }
    const wire = stack[0]!.board;
    if (!Array.isArray(wire)) {
        return undefined;
    }
    const hexes = decodeLegacyBoardWire(wire);
    const centres = recoverModularCentresFromHexes(hexes, numModules);
    return formatModularStartingPosition(centres, numModules);
}

function stacksEqual(a: playerid[], b: playerid[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function applySparseCells(hexes: StorisendeHex[], cells: SparseCellWire[]): StorisendeHex[] {
    const map = new Map(hexes.map(h => [`${h.q},${h.r}`, h]));
    for (const c of cells) {
        const key = `${c.q},${c.r}`;
        const base = map.get(key);
        if (base === undefined) {
            throw new Error(`Sparse cell (${c.q},${c.r}) is not on the board template`);
        }
        map.set(key, StorisendeHex.create({
            q: c.q,
            r: c.r,
            tile: c.tile !== undefined ? c.tile : base.tile,
            stack: c.stack !== undefined ? c.stack : base.stack,
        }));
    }
    return [...map.values()];
}

export function decodeSparseBoardV1(
    wire: SparseBoardV1,
    variants: string[],
    startingPosition = "",
): StorisendeHex[] {
    return applySparseCells(topologyHexes(variants, startingPosition), wire.cells);
}

export function encodeBoardSparse(board: StorisendeBoard): SparseBoardV1 {
    const cells: SparseCellWire[] = [];
    for (const hex of board.serialize()) {
        if (hex.tile !== "virgin" || hex.stack.length > 0) {
            const cell: SparseCellWire = {q: hex.q, r: hex.r};
            if (hex.tile !== "virgin") {
                cell.tile = hex.tile;
            }
            if (hex.stack.length > 0) {
                cell.stack = [...hex.stack];
            }
            cells.push(cell);
        }
    }
    return {fmt: "sparse-v1", cells};
}

export function boardWireDiff(prev: StorisendeHex[], board: StorisendeBoard): BoardDeltaV1 {
    const changes: SparseCellWire[] = [];
    const prevMap = new Map(prev.map(h => [`${h.q},${h.r}`, h]));
    for (const h of board.serialize()) {
        const p = prevMap.get(`${h.q},${h.r}`);
        const tileChanged = p === undefined || p.tile !== h.tile;
        const stackChanged = p === undefined || !stacksEqual(p.stack, h.stack);
        if (!tileChanged && !stackChanged) {
            continue;
        }
        const cell: SparseCellWire = {q: h.q, r: h.r};
        if (tileChanged) {
            cell.tile = h.tile;
        }
        if (stackChanged) {
            cell.stack = [...h.stack];
        }
        changes.push(cell);
    }
    return {fmt: "delta-v1", changes};
}

export function decodeLegacyBoardWire(wire: StorisendeHex[]): StorisendeHex[] {
    return wire.map(h => StorisendeHex.deserialize(h));
}

export function decodeBoardAtIndex(
    stack: Array<{board: BoardWire}>,
    idx: number,
    variants: string[],
    compactGame: boolean,
    startingPosition = "",
): StorisendeHex[] {
    const entry = stack[idx];
    if (entry === undefined) {
        throw new Error(`Missing stack entry ${idx}`);
    }
    const wire = entry.board;

    if (!compactGame) {
        if (!Array.isArray(wire)) {
            throw new Error("Legacy Storisende game expected board hex array");
        }
        return decodeLegacyBoardWire(wire);
    }

    if (Array.isArray(wire)) {
        throw new Error("Compact Storisende game must not store a legacy board array");
    }

    if (wire.fmt === "sparse-v1") {
        return decodeSparseBoardV1(wire, variants, startingPosition);
    }
    if (wire.fmt === "delta-v1") {
        if (idx < 1) {
            throw new Error("delta-v1 cannot be used on stack index 0");
        }
        const prev = decodeBoardAtIndex(stack, idx - 1, variants, compactGame, startingPosition);
        return applySparseCells(prev, wire.changes);
    }

    throw new Error(`Unknown Storisende board wire format: ${String((wire as {fmt?: string}).fmt)}`);
}

export function encodeBoardWireForNewFrame(
    board: StorisendeBoard,
    variants: string[],
    stack: Array<{board: BoardWire}>,
    startingPosition = "",
): BoardWire {
    const newIdx = stack.length;
    if (newIdx < 3 || newIdx % BOARD_KEYFRAME_INTERVAL === 0) {
        return encodeBoardSparse(board);
    }
    const prevHexes = decodeBoardAtIndex(stack, newIdx - 1, variants, true, startingPosition);
    return boardWireDiff(prevHexes, board);
}

export function isSparseBoardV1(wire: BoardWire): wire is SparseBoardV1 {
    return !Array.isArray(wire) && wire.fmt === "sparse-v1";
}

export function isBoardDeltaV1(wire: BoardWire): wire is BoardDeltaV1 {
    return !Array.isArray(wire) && wire.fmt === "delta-v1";
}
