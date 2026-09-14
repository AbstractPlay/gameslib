/**
 * Parse Storisende regular-move strings ({@link StorisendeGame}).
 * Row labels use multi-letter algebraics (a, z, aa, …); only the first `-` and `:` are delimiters.
 */
export type StorisendeRegularMoveParts = {
    from: string;
    /** Present when moving a strict substack (`from:h-to`). */
    height?: number;
    /** Absent while the player is still choosing a destination. */
    to?: string;
};

/** Opening placement list (`cell,cell,...`). */
export function splitStorisendeOpeningCells(m: string): string[] {
    return m.length === 0 ? [] : m.split(",");
}

/**
 * Parse a regular (post-opening) move or partial UI string.
 * Examples: `aa1`, `aa1:2`, `aa1-ad5`, `aa1:2-ad5`.
 */
export function parseStorisendeRegularMove(m: string): StorisendeRegularMoveParts {
    let rest = m;
    let to: string | undefined;
    const dash = rest.indexOf("-");
    if (dash !== -1) {
        to = rest.slice(dash + 1);
        rest = rest.slice(0, dash);
    }
    const colon = rest.indexOf(":");
    if (colon === -1) {
        return to === undefined ? {from: rest} : {from: rest, to};
    }
    const from = rest.slice(0, colon);
    const heightStr = rest.slice(colon + 1);
    if (heightStr.length === 0) {
        return to === undefined ? {from} : {from, to};
    }
    const height = parseInt(heightStr, 10);
    if (Number.isNaN(height)) {
        throw new Error(`Could not interpret substack height in "${m}".`);
    }
    return to === undefined ? {from, height} : {from, height, to};
}

/** Destination cell from a complete regular-move notation. */
export function storisendeRegularMoveDestination(m: string): string | undefined {
    const dash = m.indexOf("-");
    if (dash === -1) {
        return undefined;
    }
    return m.slice(dash + 1);
}

/** Source cell while building a move in the UI (before or after `:`). */
export function storisendeRegularMoveSourceCell(partial: string): string {
    const dash = partial.indexOf("-");
    const left = dash === -1 ? partial : partial.slice(0, dash);
    const colon = left.indexOf(":");
    return colon === -1 ? left : left.slice(0, colon);
}
