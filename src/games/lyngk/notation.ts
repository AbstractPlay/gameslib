import type { ActiveColour } from "./types.js";

const CLAIM_RE = /^([1-5]),(.*)$/;

export function parseClaimPrefix(move: string): { claim?: ActiveColour; rest: string } {
    const m = CLAIM_RE.exec(move);
    if (m === null) {
        return { rest: move };
    }
    const claim = Number(m[1]) as ActiveColour;
    return { claim, rest: m[2]! };
}

export function parseCellChain(rest: string): string[] | undefined {
    const trimmed = rest.toLowerCase().replace(/\s+/g, "");
    if (trimmed.length === 0) {
        return undefined;
    }
    if (!trimmed.includes("-")) {
        if (/^[a-z]+\d+$/.test(trimmed)) {
            return [trimmed];
        }
        return undefined;
    }
    const parts = trimmed.split("-");
    if (parts.some((p) => !/^[a-z]+\d+$/.test(p))) {
        return undefined;
    }
    return parts;
}

export function formatCellChain(cells: string[]): string {
    return cells.join("-");
}

export function formatMove(claim: ActiveColour | undefined, cells: string[]): string {
    const chain = formatCellChain(cells);
    return claim === undefined ? chain : `${claim},${chain}`;
}