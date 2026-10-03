/** Volcano-style captured piece (colour code + size tier). */
export type VolcanoStashCell = readonly [string, number];

/**
 * One `localStash` column from an internal stack ordered bottom → top.
 * Emits dense legend keys only (no `"-"` spacers).
 */
export const volcanoStashColumn = (
    stack: ReadonlyArray<VolcanoStashCell>,
    expanding: boolean,
): string[] => {
    const column = stack.map((cell) => cell.join(""));
    if (expanding) {
        return column.map((key) => key + "c");
    }
    return column;
};

/** One bag column from pool pieces ordered bottom → top (`*d` legend keys). */
export const bagStashColumn = <TPiece extends readonly [unknown, number]>(
    stack: ReadonlyArray<TPiece>,
    legendKey: (piece: TPiece) => string,
): string[] => {
    return stack.map((piece) => legendKey(piece));
};

/** Stawvs-style solid column (`*c` suffix when expanding). */
export const stawvsStashColumn = (
    stack: ReadonlyArray<{ join: (separator?: string) => string }>,
): string[] => {
    return stack.map((piece) => piece.join("") + "c");
};

/** Copy legend keys bottom → top (identity helper for clarity at call sites). */
export const localStashKeysBottomFirst = (keys: readonly string[]): string[] => {
    return [...keys];
};
