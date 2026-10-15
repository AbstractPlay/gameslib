/** Frozen territory scores and threatened cells (baseline before shared LOS refactor). */
export const tumbleweedScoresGolden: {
    name: string;
    scores: [number, number];
    threatened: string[];
}[] = [
    { name: "midgame-sparse", scores: [13, 27], threatened: [] },
    { name: "reinforce-notation", scores: [74, 0], threatened: [] },
    { name: "neutral-blocks-los", scores: [63, 0], threatened: [] },
    { name: "capture-notation", scores: [50, 17], threatened: ["h7"] },
];
