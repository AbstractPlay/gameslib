import type { MarbleColour } from "./types.js";
import type { JumpStep } from "./jumps.js";

export interface PlacementMove {
    kind: "place";
    colour: MarbleColour;
    cell: string;
    remove?: string;
    isolation?: Array<{ colour: MarbleColour; cell: string }>;
}

export interface JumpMove {
    kind: "jump";
    steps: JumpStep[];
}

export type ParsedMove = PlacementMove | JumpMove;

function normalizeRaw(m: string): string {
    return m.toLowerCase().replace(/\s+/g, "");
}

const CELL = "[a-z]+\\d+";
const COLOUR = "[wgb]";

export function parseMove(m: string): ParsedMove | undefined {
    const raw = normalizeRaw(m);
    if (raw.length === 0) {
        return undefined;
    }
    if (raw.startsWith("x")) {
        const body = raw.slice(1);
        const re = new RegExp(`^(${CELL})((?:${COLOUR}${CELL})+)$`, "i");
        const match = body.match(re);
        if (match === null) {
            return undefined;
        }
        const start = match[1]!;
        const tail = match[2]!;
        const stepRe = new RegExp(`${COLOUR}${CELL}`, "gi");
        const pairs: JumpStep[] = [];
        let prev = start;
        let m2: RegExpExecArray | null;
        while ((m2 = stepRe.exec(tail)) !== null) {
            const token = m2[0];
            const overColour = token[0]!.toUpperCase() as MarbleColour;
            const to = token.slice(1);
            pairs.push({ from: prev, over: "", to, overColour });
            prev = to;
        }
        if (pairs.length === 0) {
            return undefined;
        }
        pairs[0]!.from = start;
        return { kind: "jump", steps: pairs };
    }

    const placeRe = new RegExp(
        `^(${COLOUR})(${CELL})(?:,(${CELL}))?(?:x((?:${COLOUR}${CELL})+))?$`,
        "i",
    );
    const match = raw.match(placeRe);
    if (match === null) {
        return undefined;
    }
    const colour = match[1]!.toUpperCase() as MarbleColour;
    const cell = match[2]!;
    const remove = match[3];
    const isoTail = match[4];
    const isolation: Array<{ colour: MarbleColour; cell: string }> = [];
    if (isoTail !== undefined) {
        const stepRe = new RegExp(`${COLOUR}${CELL}`, "gi");
        let m2: RegExpExecArray | null;
        while ((m2 = stepRe.exec(isoTail)) !== null) {
            const token = m2[0];
            isolation.push({
                colour: token[0]!.toUpperCase() as MarbleColour,
                cell: token.slice(1),
            });
        }
    }
    return {
        kind: "place",
        colour,
        cell,
        remove: remove === undefined ? undefined : remove,
        isolation: isolation.length > 0 ? isolation : undefined,
    };
}

export function formatJumpMove(steps: JumpStep[]): string {
    if (steps.length === 0) {
        return "";
    }
    let out = `x${steps[0]!.from}`;
    for (const s of steps) {
        out += `${s.overColour.toLowerCase()}${s.to}`;
    }
    return out;
}

export function formatPlacementMove(move: PlacementMove): string {
    let out = `${move.colour}${move.cell}`;
    if (move.remove !== undefined) {
        out += `,${move.remove}`;
    }
    if (move.isolation !== undefined && move.isolation.length > 0) {
        out += "x";
        for (const iso of move.isolation) {
            out += `${iso.colour.toLowerCase()}${iso.cell}`;
        }
    }
    return out;
}

export function formatMove(move: ParsedMove): string {
    if (move.kind === "jump") {
        return formatJumpMove(move.steps);
    }
    return formatPlacementMove(move);
}

/** Attach over-cell info to parsed jump steps using board state. */
export function resolveJumpOvers(
    steps: JumpStep[],
    resolver: (from: string, to: string) => string | undefined,
): JumpStep[] | undefined {
    const resolved: JumpStep[] = [];
    let from = steps[0]!.from;
    for (let i = 0; i < steps.length; i++) {
        const to = steps[i]!.to;
        const over = resolver(from, to);
        if (over === undefined) {
            return undefined;
        }
        resolved.push({
            from,
            over,
            to,
            overColour: steps[i]!.overColour,
        });
        from = to;
    }
    return resolved;
}