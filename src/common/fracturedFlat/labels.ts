const TIER_BASE_VERTS = 3;

const TIER_LETTERS = ["A", "B", "C", "D"];

export const vertsToTierLetter = (verts: number): string => {
    if (verts < TIER_BASE_VERTS) {
        throw new Error(`Vertex count ${verts} is below the minimum tier (${TIER_BASE_VERTS}).`);
    }
    return String.fromCharCode("A".charCodeAt(0) + verts - TIER_BASE_VERTS);
};

export const tierLetterToVerts = (letter: string): number => {
    const code = letter.charCodeAt(0);
    if (code < "A".charCodeAt(0) || code > "Z".charCodeAt(0)) {
        throw new Error(`Invalid tier letter: ${letter}`);
    }
    return code - "A".charCodeAt(0) + TIER_BASE_VERTS;
};

/** `indexInTier` is zero-based within the vertex-count tier. */
export const makeLabel = (verts: number, indexInTier: number): string =>
    vertsToTierLetter(verts) + (indexInTier + 1).toString();

/** Legend/pieces label for a cell: tier letter + 1-based column (e.g. A1, B15). */
export const fracturedFlatCellLabel = (row: number, col: number): string => {
    const letter = TIER_LETTERS[row];
    if (letter === undefined) {
        throw new Error(`Invalid fractured-flat row ${row}.`);
    }
    return `${letter}${col + 1}`;
};

export type ParsedLabel = {
    verts: number;
    indexInTier: number;
};

export const parseLabel = (cell: string): ParsedLabel => {
    const match = cell.match(/^([A-Z])(\d+)$/);
    if (match === null) {
        throw new Error(`Invalid fractured-flat label: ${cell}`);
    }
    const indexInTier = parseInt(match[2], 10) - 1;
    if (isNaN(indexInTier) || indexInTier < 0) {
        throw new Error(`Invalid fractured-flat index: ${match[2]}`);
    }
    return {
        verts: tierLetterToVerts(match[1]),
        indexInTier,
    };
};
