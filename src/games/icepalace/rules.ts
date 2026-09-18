/**
 * Shared vocabulary and legality checks for Ice Palace.
 *
 * Both structures (the Yard and the Ice Palace) are built on imaginary grids that
 * stretch to infinity, so cells are stored as `"x,y"` keys rather than on a fixed
 * board. `y` is positive upwards, matching `UnboundedSquareBoard.abs2notation`.
 */

/** 1 = small, 2 = medium, 3 = large. */
export type Size = 1 | 2 | 3;

/** Black is Null: it matches no colour, not even itself. */
export const NULL_COLOUR = "B";
/** White is Wild: it matches every colour except Black. */
export const WILD_COLOUR = "W";

/** A colour char followed by a size char, e.g. `"3L"`, `"BS"`, `"WM"`. */
export type PieceId = string;

export const SIZE_CHARS = ["S", "M", "L"] as const;
export type SizeChar = (typeof SIZE_CHARS)[number];

export type Cell = string;
/** Cell key to the pyramids sitting there, ordered bottom to top. */
export type Structure = Map<Cell, PieceId[]>;

export const colourOf = (piece: PieceId): string => piece.substring(0, piece.length - 1);

export const sizeOf = (piece: PieceId): Size => {
    const idx = SIZE_CHARS.indexOf(piece[piece.length - 1] as SizeChar);
    if (idx < 0) {
        throw new Error(`Could not read a pyramid size from "${piece}".`);
    }
    return (idx + 1) as Size;
};

export const makePiece = (colour: string, size: Size): PieceId => `${colour}${SIZE_CHARS[size - 1]}`;

export const cellOf = (x: number, y: number): Cell => `${x},${y}`;

export const coordsOf = (cell: Cell): [number, number] => {
    const parts = cell.split(",");
    return [Number(parts[0]), Number(parts[1])];
};

/** Adjacency is side-by-side only; the four diagonals are not adjacent. */
export const neighbours = (cell: Cell): Cell[] => {
    const [x, y] = coordsOf(cell);
    return [cellOf(x + 1, y), cellOf(x - 1, y), cellOf(x, y + 1), cellOf(x, y - 1)];
};

export const topOf = (struct: Structure, cell: Cell): PieceId | undefined => {
    const stack = struct.get(cell);
    if (stack === undefined || stack.length === 0) {
        return undefined;
    }
    return stack[stack.length - 1];
};

/** Yard matching, where Black is Null and White is Wild. */
export const coloursMatch = (a: string, b: string): boolean => {
    if (a === NULL_COLOUR || b === NULL_COLOUR) {
        return false;
    }
    if (a === WILD_COLOUR || b === WILD_COLOUR) {
        return true;
    }
    return a === b;
};

/** Every empty cell touching the structure. */
export const frontier = (struct: Structure): Cell[] => {
    const cells = new Set<Cell>();
    for (const cell of struct.keys()) {
        for (const n of neighbours(cell)) {
            if (!struct.has(n)) {
                cells.add(n);
            }
        }
    }
    return [...cells];
};

/**
 * The empty cells connected to the infinite outside, computed over the bounding box
 * grown by one ring. Enclosed pockets are excluded: a stack that touches only a pocket
 * cannot be grown away from indefinitely, which the build solver relies on.
 */
export const exteriorCells = (struct: Structure): Set<Cell> => {
    const exterior = new Set<Cell>();
    if (struct.size === 0) {
        return exterior;
    }
    const coords = [...struct.keys()].map(coordsOf);
    const minX = Math.min(...coords.map(c => c[0])) - 1;
    const maxX = Math.max(...coords.map(c => c[0])) + 1;
    const minY = Math.min(...coords.map(c => c[1])) - 1;
    const maxY = Math.max(...coords.map(c => c[1])) + 1;

    const queue: Cell[] = [cellOf(minX, minY)];
    while (queue.length > 0) {
        const cell = queue.pop()!;
        if (exterior.has(cell) || struct.has(cell)) {
            continue;
        }
        const [x, y] = coordsOf(cell);
        if (x < minX || x > maxX || y < minY || y > maxY) {
            continue;
        }
        exterior.add(cell);
        queue.push(...neighbours(cell));
    }
    return exterior;
};

const canFound = (
    struct: Structure,
    piece: PieceId,
    cell: Cell,
    match: (a: string, b: string) => boolean,
): boolean => {
    for (const n of neighbours(cell)) {
        const top = topOf(struct, n);
        if (top !== undefined && match(colourOf(piece), colourOf(top))) {
            return true;
        }
    }
    return false;
};

/**
 * Yard building code: any colour may be added to a stack if it is bigger than the
 * current top pyramid, and a new stack may be started next to any existing stack whose
 * top pyramid matches its colour. The lead may go anywhere.
 */
export const legalYardPlacement = (struct: Structure, piece: PieceId, cell: Cell): boolean => {
    if (struct.size === 0) {
        return true;
    }
    const top = topOf(struct, cell);
    if (top !== undefined) {
        return sizeOf(piece) > sizeOf(top);
    }
    return canFound(struct, piece, cell, coloursMatch);
};

/**
 * Ice Palace building code: the size rule is reversed, and a new stack must exactly match
 * the colour of an adjacent top pyramid. Black and White never reach the Palace, so Wild
 * and Null have no role here. The rules never say how the first pyramid is placed into an
 * empty Palace, so it goes anywhere.
 */
export const legalPalacePlacement = (struct: Structure, piece: PieceId, cell: Cell): boolean => {
    if (struct.size === 0) {
        return true;
    }
    const top = topOf(struct, cell);
    if (top !== undefined) {
        return sizeOf(piece) < sizeOf(top);
    }
    return canFound(struct, piece, cell, (a, b) => a === b);
};

export const placeInto = (struct: Structure, piece: PieceId, cell: Cell): void => {
    const stack = struct.get(cell);
    if (stack === undefined) {
        struct.set(cell, [piece]);
    } else {
        stack.push(piece);
    }
};

export const cloneStructure = (struct: Structure): Structure => {
    const copy: Structure = new Map();
    for (const [cell, stack] of struct.entries()) {
        copy.set(cell, [...stack]);
    }
    return copy;
};

/** Every cell a piece could legally go, for either building code. */
export const legalCellsFor = (
    struct: Structure,
    piece: PieceId,
    legal: (struct: Structure, piece: PieceId, cell: Cell) => boolean,
): Cell[] => {
    if (struct.size === 0) {
        return [cellOf(0, 0)];
    }
    const cells: Cell[] = [];
    for (const cell of struct.keys()) {
        if (legal(struct, piece, cell)) {
            cells.push(cell);
        }
    }
    for (const cell of frontier(struct)) {
        if (legal(struct, piece, cell)) {
            cells.push(cell);
        }
    }
    return cells;
};
