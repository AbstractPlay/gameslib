/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import {
    ColorfieldGame, cfBorder, cfCanMove, cfCheck, cfDotName, cfDraw, cfEmpty, cfEnclosed, cfFindDot, cfFindSegment, cfGrid, cfLayout,
    cfLegalSegments, cfScore, cfSegmentName,
    type ICfEnclosure, type ICfGrid, type ICfPosition, type playerid,
} from "../../src/games/colorfield";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { addResource } from "../../src";

// Notation.  A dot is named by its column letter and its row number, rows
// counted from the bottom: a1 is the bottom left dot.  On the 3D and 4D
// boards the name of a dot of the back grid ends in "z" (c3z is the dot
// behind c3), and on the 4D board the name of a dot of Board 2 ends in "w".
// A segment is written as its two dots: "a1-b1", a diagonal segment between
// the two grids "c3-c3z", a connector between the two boards "c3-c3w".  A
// unit (square, cube, 4D unit) is named here by its bottom left front dot:
// on a 4x4 grid "b2" is the centre unit.
//
// The figures of the rule sheet (https://www.marksteeregames.com/Colorfield_rules.pdf).
// Each one is given as an order of play that ends in exactly the position of
// the figure: Red first, the players alternating, every move legal, and where
// the text of the rule sheet says which segment has just been drawn, that
// segment last.  The segments were read off the rule sheet, and the orders of
// play and the sample games below were worked out with a separate
// implementation of the rules, not with the code under test.  Figures 1 to 5
// are on the 6x6 grid, Figures 6 to 10 on the 4x4x2 grid, Figures 11 to 20 on
// the 4x4x2x2 grid.
const FIGURE_1 = [
    "b3-c3", "c3-c4", "d1-e1", "d1-d2", "c4-d4", "f1-f2", "b5-c5", "b3-b4", "e1-f1", "e2-f2", "c5-d5", "d4-d5", "b4-b5", "d2-e2",
];
const FIGURE_2 = [
    "b3-b4", "b2-c2", "c4-d4", "d4-e4", "e3-e4", "c2-d2", "c3-c4", "b2-b3", "b4-c4", "b5-b6", "d2-d3", "e2-e3",
];
const FIGURE_3 = [
    "c2-c3", "b5-c5", "d2-e2", "e4-e5", "b2-b3", "d5-e5", "d4-d5", "e3-e4", "b2-c2", "c2-d2", "c4-d4", "f4-f5", "e2-e3", "b3-b4", "b4-b5", "c5-d5",
];
const FIGURE_4 = [
    "f5-f6", "e3-e4", "c6-d6", "d4-d5", "d3-d4", "f2-f3", "e6-f6", "d3-e3", "d5-e5", "a2-a3", "b5-b6", "a3-b3", "c2-d2", "d6-e6", "b2-c2", "d2-e2",
    "f3-f4", "a6-b6", "a2-b2", "f4-f5", "b3-b4", "e4-e5", "e2-f2", "b6-c6", "b4-b5",
];
const FIGURE_5 = [
    "d1-e1", "c1-d1", "a5-a6", "e4-f4", "c3-d3", "a1-b1", "c6-d6", "c3-c4", "d3-e3", "d6-e6", "a2-a3", "f3-f4", "e2-e3", "d3-d4", "c4-c5", "d4-e4",
    "f2-f3", "b1-b2", "b2-b3", "a4-b4", "f4-f5", "e1-f1", "b5-b6", "b5-c5", "f5-f6", "c2-c3", "d5-d6", "a3-a4", "e5-f5", "b1-c1", "a1-a2", "c1-c2",
    "e1-e2", "a4-a5", "a3-b3", "b4-c4", "e3-f3", "b6-c6", "f1-f2", "a6-b6", "d5-e5", "e6-f6",
];
const FIGURE_6 = [
    "b1-c1", "c3-c3z", "b1z-c1z", "b3-b3z", "d3-d3z", "b1-b2", "b3-b4", "a1z-b1z", "b4-c4", "b1z-b2z", "c4-c4z", "d3-d4", "c1-c1z", "a1-a1z", "d3z-d4z",
    "b2z-c2z", "a1-b1", "c2-c2z", "b3z-c3z", "b3z-b4z", "c3-c4", "c1-c2", "a3-a4", "b3-c3", "a2z-b2z", "b4-b4z", "c3-d3", "c1z-c2z", "c4z-d4z",
    "d4-d4z", "a1z-a2z", "b4z-c4z", "a2-b2", "b1-b1z", "b2-c2", "c3z-d3z", "a1-a2", "c3z-c4z", "c4-d4", "a2-a2z",
];
const FIGURE_7 = [
    "b3z-c3z", "d2-d3", "b3-c3", "d3-d3z", "b2-b2z", "d2z-d3z", "c3z-d3z", "c2-c3", "c3-d3", "d2-d2z", "b2-c2", "c3-c3z", "b1-c1", "c2z-c3z", "b2z-c2z",
    "b2z-b3z", "b1z-c1z", "b1-b1z", "c2z-d2z", "c1-c2", "b1z-b2z", "b2-b3", "c2-d2", "c1z-c2z", "b1-b2", "c1-c1z", "b3-b3z",
];
const FIGURE_8 = [
    "b1z-c1z", "a1-a1z", "a3-b3", "d4-d4z", "a1z-b1z", "a2z-a3z", "b3z-c3z", "a2-a3", "c4z-d4z", "c1z-c2z", "d1-d2", "d3-d3z", "a3z-b3z", "c1-c1z",
    "b3-c3", "c3z-c4z", "c3-d3", "c2-c3", "a1-a2", "a3-a3z", "a1z-a2z", "c3-c4", "a1-b1", "d3-d4", "a4-b4", "d3z-d4z", "c4-d4", "c1-c2", "c3z-d3z",
    "c4-c4z", "b1-c1", "c2z-c3z", "c3-c3z",
];
const FIGURE_9 = [
    "c3-d3", "d3z-d4z", "c4z-d4z", "c3-c3z", "c3-c4", "d3-d3z", "a1-a2", "d4-d4z", "c3z-c4z", "c4-c4z", "c3z-d3z", "d3-d4",
];
const FIGURE_10 = [
    "b1-c1", "c1-c1z", "b1z-c1z", "a2-a2z", "a1-b1", "c1z-c2z", "a1z-b1z", "b1-b2", "c4-d4", "a1-a1z", "b2-c2", "b1-b1z", "a1-a2", "c1-c2", "b2z-c2z",
    "b1z-b2z", "a2z-b2z", "c2-c2z", "a2-b2", "a1z-a2z", "b2-b2z",
];
const FIGURE_11 = [
    "b3-c3", "c1zw-c2zw", "b2-b2w", "a1w-b1w", "c2-c2z", "c3z-c3zw",
];
const FIGURE_12 = [
    "b2z-c2z", "b3w-c3w", "b2-b3", "c2zw-c3zw", "b2zw-b3zw", "b3-b3w", "b2-b2w", "a4-b4", "c3-c3z", "c3w-c3zw", "c2z-c2zw", "c2-c2w", "b2w-b3w",
    "c2z-c3z", "b2-c2", "b2w-b2zw", "c2w-c3w", "b2z-b2zw", "b3w-b3zw", "b3-b3z", "b2z-b3z", "b3z-c3z", "b3zw-c3zw", "c3z-c3zw", "b3-c3", "c2-c2z",
    "c2-c3", "c3-c3w", "c2w-c2zw", "b2-b2z", "b2w-c2w", "b2zw-c2zw", "b3z-b3zw",
];
const FIGURE_13 = [
    "b3z-c3z", "b2-b2z", "a2w-b2w", "b2z-b3z", "b3z-b3zw", "a2-a2z", "a3w-b3w", "b3-b3z", "c3-c3w", "a3z-a3zw", "a2-a3", "a2zw-a3zw", "a2z-a2zw",
    "b2z-b2zw", "b2w-b2zw", "b3-b3w", "a2z-a3z", "b3zw-c3zw", "a3z-b3z", "b3w-b3zw", "b2-b3", "c2-c2z", "a3-a3w", "b2zw-c2zw", "b2-b2w", "a2-b2",
    "c2w-c3w", "b2-c2", "b3w-c3w", "a2zw-b2zw", "b2zw-b3zw", "a2w-a2zw", "a3zw-b3zw", "c2z-c2zw", "c2-c2w", "a3w-a3zw", "c3z-c3zw", "b2z-c2z",
    "a2w-a3w", "c3w-c3zw", "c2-c3", "b3-c3", "c3-c3z", "c2zw-c3zw", "c2w-c2zw", "c2z-c3z", "b2w-b3w", "a2-a2w", "a3-b3", "b2w-c2w", "a3-a3z", "a2z-b2z",
];
const FIGURE_15 = [
    "a2w-b2w", "c3-c3w", "c2-c2z", "b3z-c3z", "b3w-c3w", "b2-c2", "c3w-c3zw", "c4-d4", "b3zw-c3zw", "c2w-c3w", "a2-a3", "c3z-c3zw", "a2zw-b2zw",
    "a3zw-b3zw", "c2w-c2zw", "c2zw-c3zw", "a3-a3z", "a2w-a2zw", "a2-a2w", "b2w-c2w", "b2z-c2z", "c2z-c3z", "b2zw-c2zw", "c2-c2w", "b3-c3", "c3-c3z",
    "a2z-a3z", "c2-c3", "a3z-b3z", "a2-b2", "a3-b3", "a2zw-a3zw", "a3w-a3zw", "c2z-c2zw", "a3z-a3zw", "a2z-a2zw", "a2z-b2z", "a2w-a3w", "a3w-b3w",
    "a2-a2z", "a3-a3w",
];
const FIGURE_16 = [
    "b2zw-b3zw", "c2zw-c3zw", "c3zw-d3zw", "c1-c1w", "c3-d3", "b1z-b1zw", "c2zw-d2zw", "c1w-c2w", "c1zw-c2zw", "b2w-c2w", "b2-c2", "b1-c1", "d2w-d3w",
    "b1zw-c1zw", "c2w-c3w", "b3-b3z", "b1-b1w", "c1z-c2z", "d2-d2z", "b2zw-c2zw", "b1w-b1zw", "d3-d3z", "b1w-c1w", "c3-c3w", "b2-b2w", "d2z-d3z",
    "c2z-d2z", "d2-d3", "b1w-b2w", "c3w-c3zw", "b3w-c3w", "b3zw-c3zw", "d3w-d3zw", "a4-b4", "b1-b2", "b1z-c1z", "b3-c3", "b3z-b3zw", "b3w-b3zw",
    "b2-b2z", "d2-d2w", "c1z-c1zw", "c3z-c3zw", "c1w-c1zw", "b2z-b2zw", "d2w-d2zw", "b3z-c3z", "c3w-d3w", "c2-c3", "b1z-b2z", "b2z-b3z", "c3z-d3z",
    "b2z-c2z", "c2w-d2w", "d2zw-d3zw", "c1-c2", "b1-b1z", "d3z-d3zw", "b2w-b2zw", "c3-c3z", "b2w-b3w", "c2z-c3z", "d3-d3w", "c1-c1z", "b2-b3", "c2-d2",
    "b1zw-b2zw", "d2z-d2zw", "b3-b3w",
];
const FIGURE_17 = [
    "b3-b3z", "d3w-d4w", "a1-a2", "b3-c3", "c2-c3", "b3zw-c3zw", "c3-c3z", "d4w-d4zw", "d3-d4", "c2z-c2zw", "b3z-b3zw", "c3w-d3w", "c4w-c4zw",
    "b2zw-c2zw", "c1-d1", "c4-c4z", "c2z-c3z", "b2w-b3w", "b2z-b2zw", "c3-d3", "b2-b2w", "c2zw-c3zw", "c2w-c3w", "c3z-c3zw", "c4z-c4zw", "c4-d4",
    "d3zw-d4zw", "c4zw-d4zw", "c2-c2z", "c3w-c3zw", "c4z-d4z", "d3-d3w", "c3-c4", "d4-d4w", "d4-d4z", "b2-c2", "c2-c2w", "d3-d3z", "c4-c4w",
    "c3zw-d3zw", "b3w-c3w", "c4w-d4w", "a4-b4", "d3z-d3zw", "c3z-d3z", "b3z-c3z", "b3-b3w", "d3z-d4z", "d4z-d4zw", "b3w-b3zw", "b2-b3", "b2z-b3z",
    "b2zw-b3zw", "c3z-c4z", "c3w-c4w", "c2w-c2zw", "d3w-d3zw", "b2z-c2z", "b2w-b2zw", "b2-b2z", "b2w-c2w", "c3zw-c4zw", "c3-c3w",
];
const FIGURE_19 = [
    "d3-d4", "c4w-c4zw", "c4-c4w", "d3-d3z", "c3-c3w", "c3w-c4w", "c3z-d3z", "c3-c4", "d4w-d4zw", "d4-d4z", "d3-d3w", "d3z-d3zw", "c4w-d4w", "d4-d4w",
    "c3w-d3w", "c3zw-c4zw", "d3z-d4z", "c3-c3z", "c3z-c4z", "c4-c4z", "c4zw-d4zw", "c4z-d4z", "c3-d3", "d4z-d4zw", "a1-a2", "d3w-d3zw", "d3w-d4w",
    "c3z-c3zw", "d3zw-d4zw", "c4z-c4zw", "c3zw-d3zw", "c3w-c3zw",
];
const FIGURE_20 = [
    "a3-a3w", "a2-a2z", "b2zw-c2zw", "c2-c3", "a3w-b3w", "c3-c3z", "c3w-c3zw", "b2-c2", "c2w-c2zw", "c3z-c3zw", "a2-a3", "a3zw-b3zw", "a2w-b2w",
    "c4-d4", "b3w-c3w", "b3z-c3z", "a3z-a3zw", "b2-b2z", "b3-c3", "b2zw-b3zw", "b2-b2w", "a2zw-a3zw", "b2-b3", "a2w-a2zw", "a3-a3z", "a2w-a3w",
    "b3zw-c3zw", "c3-c3w", "a2z-b2z", "b2w-c2w", "a3-b3", "b3w-b3zw", "c2-c2z", "c2-c2w", "b2z-b3z", "c2zw-c3zw", "a2zw-b2zw", "c2z-c2zw", "b3z-b3zw",
    "c2z-c3z", "a3z-b3z", "b3-b3w", "b2z-c2z", "b2w-b2zw", "a3w-a3zw", "a2z-a2zw", "b2w-b3w", "c2w-c3w", "a2-a2w", "b2z-b2zw", "a2z-a3z", "a2-b2",
    "b3-b3z",
];

// Figure 14 shows only the 12 edges of the cube shared by the two units of
// Figure 13, and Figure 18 only the square where the two units of Figure 17
// touch.  They are not positions of a game.
const FIGURE_14_RED = [
    "b2-b2w", "b2-b3", "b2w-b2zw", "b2w-b3w", "b2zw-b3zw", "b3z-b3zw",
];
const FIGURE_14_BLUE = [
    "b2-b2z", "b2z-b2zw", "b2z-b3z", "b3-b3w", "b3-b3z", "b3w-b3zw",
];
const FIGURE_18_RED = [
    "c3-c3w", "c3-c3z",
];
const FIGURE_18_BLUE = [
    "c3w-c3zw", "c3z-c3zw",
];

// Sample games, one on each of the three grids above.
const GAME_2D = [
    "a4-a5", "b1-b2", "e4-f4", "d6-e6", "f3-f4", "b5-c5", "b6-c6", "a3-b3", "b1-c1", "e5-e6", "c1-d1", "e3-e4", "c3-c4", "a1-a2", "c1-c2", "d1-d2",
    "f4-f5", "a5-a6", "b3-c3", "c2-c3", "a3-a4", "d2-d3", "d5-e5", "e1-e2", "d3-d4", "f1-f2", "c4-d4", "e2-e3", "e6-f6", "a5-b5", "a6-b6", "d1-e1",
    "d3-e3", "f2-f3", "c6-d6", "e1-f1", "a2-a3", "c5-d5", "a4-b4", "b4-c4", "e5-f5", "pass", "a1-b1",
];
const GAME_3D = [
    "c1-c2", "a2-a2z", "b2-c2", "c2-d2", "a4-b4", "b2z-b3z", "c2z-c3z", "a3-a4", "c1z-c2z", "b3z-c3z", "c2-c3", "a2z-a3z", "b4-b4z", "c3z-d3z",
    "d1-d1z", "b2-b3", "b2z-c2z", "c3z-c4z", "c1-c1z", "a3-b3", "a1-b1", "a1z-b1z", "a4-a4z", "c1z-d1z", "a3z-b3z", "d3-d3z", "a2z-b2z", "c2-c2z",
    "b2-b2z", "d2-d2z", "c3-c4", "b3-b4", "a2-a3", "c2z-d2z", "a2-b2", "c3-c3z", "d3-d4", "a1z-a2z", "d3z-d4z", "c4-d4", "c4z-d4z", "a3z-a4z", "b1-b1z",
    "b1-b2", "b1-c1", "c3-d3", "d2z-d3z", "b1z-b2z", "b3-b3z", "d1-d2", "a1-a1z", "c1-d1", "b3z-b4z", "b4-c4", "b4z-c4z", "d1z-d2z", "b3-c3", "b1z-c1z",
    "d4-d4z", "c4-c4z", "d2-d3", "pass", "a1-a2",
];
const GAME_4D = [
    "b3zw-b4zw", "d1z-d2z", "c4-c4w", "a3z-b3z", "a1-a1w", "c1-c1w", "a1z-b1z", "a1w-b1w", "d2z-d3z", "b3z-b3zw", "a2-a3", "a4z-b4z", "a1z-a1zw",
    "d3-d3w", "b1z-b2z", "a2z-a2zw", "b1z-b1zw", "c1-c2", "d2w-d2zw", "c3w-d3w", "c2w-d2w", "a4w-b4w", "a2zw-a3zw", "b1w-b2w", "a3zw-a4zw", "d3z-d3zw",
    "a1-a1z", "c1zw-d1zw", "d2zw-d3zw", "d1-d1w", "d3zw-d4zw", "a3-b3", "b1-b1w", "d3-d3z", "a1zw-a2zw", "c1z-c2z", "c1w-c1zw", "b4zw-c4zw", "c2-c3",
    "a2-a2z", "b2z-b2zw", "b1z-c1z", "b1w-b1zw", "d3z-d4z", "c2-d2", "d2-d2z", "c2w-c3w", "a2w-b2w", "b3w-c3w", "b2w-b2zw", "c3z-d3z", "b2z-b3z",
    "b3w-b4w", "d1-d2", "c1z-d1z", "c2z-c2zw", "d4z-d4zw", "c1-c1z", "a1w-a1zw", "c3w-c3zw", "b2z-c2z", "d2w-d3w", "a1w-a2w", "a2-a2w", "b1w-c1w",
    "b2-b2z", "a3w-b3w", "b3zw-c3zw", "b3-b3z", "c1w-d1w", "c3-c3w", "b2w-b3w", "d2z-d2zw", "a4-b4", "b1-c1", "a2z-a3z", "c2w-c2zw", "a3-a3z",
    "a3w-a4w", "a3z-a4z", "a3-a4", "c2-c2w", "b2-b3", "c2zw-d2zw", "c3-d3", "c4z-c4zw", "a3z-a3zw", "d4w-d4zw", "c1w-c2w", "c1-d1", "c4w-d4w", "b3-b4",
    "a3w-a3zw", "d1w-d2w", "d1-d1z", "c2z-d2z", "c2z-c3z", "a4w-a4zw", "c4z-d4z", "a1z-a2z", "a2w-a2zw", "a1-a2", "a1-b1", "b4-c4", "b3z-c3z", "c3-c4",
    "d4-d4z", "b2-c2", "b4-b4w", "a2zw-b2zw", "d3w-d3zw", "a3zw-b3zw", "a1zw-b1zw", "c2zw-c3zw", "c4zw-d4zw", "a4z-a4zw", "b2w-c2w", "c4-c4z", "b1-b2",
    "b2zw-c2zw", "d3-d4", "d3w-d4w", "b4w-c4w", "d2-d2w", "b4z-c4z", "c3-c3z", "d2-d3", "d1zw-d2zw", "b4z-b4zw", "b4w-b4zw", "c3z-c3zw", "b1-b1z",
    "b2zw-b3zw", "c3zw-c4zw", "b4-b4z", "c4-d4", "a2-b2", "b1zw-c1zw", "c3z-c4z", "d1z-d1zw", "a4-a4z", "c4w-c4zw", "c3zw-d3zw", "b1zw-b2zw", "a4-a4w",
    "b3-c3", "d1w-d1zw", "a4zw-b4zw", "a3-a3w", "b2-b2w", "c1zw-c2zw", "a2w-a3w", "b3z-b4z", "b3w-b3zw", "c3w-c4w", "a2z-b2z", "c1z-c1zw", "pass",
    "c2-c2z",
];

// What the sample games enclose, as the separate implementation of the rules
// played them: [ply, number of units, owner, red bordering segments, blue
// bordering segments].  In each game one turn is skipped (the move "pass").
const GAME_2D_CLAIMS = [[27, 3, 1, 5, 3], [33, 2, 2, 1, 5], [36, 3, 2, 2, 6], [38, 4, 2, 4, 6], [40, 2, 1, 4, 2], [41, 6, 1, 9, 5], [43, 4, 1, 5, 3]];
const GAME_3D_CLAIMS = [[56, 1, 2, 4, 8], [57, 1, 1, 7, 5], [58, 1, 1, 8, 4], [59, 2, 1, 9, 7], [61, 1, 2, 4, 8], [63, 1, 1, 7, 5]];
const GAME_4D_CLAIMS = [[150, 3, 2, 25, 27], [153, 3, 1, 29, 19], [159, 2, 1, 21, 19]];

const G2 = cfGrid(6, 6);
const G3 = cfGrid(4, 4, 2);
const G4 = cfGrid(4, 4, 2, 2);

/** The unit with the given bottom left front dot. */
function unit(grid: ICfGrid, name: string): number {
    const [x, y] = grid.dots[cfFindDot(grid, name)!];
    return x + (grid.size[0] - 1) * y;
}

function unitName(grid: ICfGrid, u: number): string {
    const columns = grid.size[0] - 1;
    return "abcdefghijk"[u % columns] + (Math.floor(u / columns) + 1).toString();
}

function segment(grid: ICfGrid, name: string): number {
    const s = cfFindSegment(grid, name);
    if (s === undefined) {
        throw new Error(`The grid has no segment ${name}.`);
    }
    return s;
}

/** The segments two units have in common, by name. */
function shared(grid: ICfGrid, a: string, b: string): string[] {
    const mine = grid.unitSegments[unit(grid, a)];
    return grid.unitSegments[unit(grid, b)].filter(s => mine.includes(s)).map(s => cfSegmentName(grid, s)).sort();
}

interface IReplay {
    position: ICfPosition;
    /** what every move enclosed */
    enclosed: ICfEnclosure[][];
}

/** Plays an order of play with the rule helpers: Red first, the players alternating. */
function replay(grid: ICfGrid, moves: string[]): IReplay {
    const position = cfEmpty(grid);
    const enclosed: ICfEnclosure[][] = [];
    moves.forEach((m, i) => {
        enclosed.push(cfDraw(grid, position, segment(grid, m), i % 2 === 0 ? 1 : 2));
    });
    return {position, enclosed};
}

/** The segments bordering a set of units: how many there are, and how many of them are red, blue, and not drawn. */
function border(grid: ICfGrid, position: ICfPosition, names: string[]): {all: number; red: number; blue: number; open: number} {
    const segments = cfBorder(grid, names.map(n => unit(grid, n)));
    return {
        all: segments.length,
        red: segments.filter(s => position.drawn[s] === 1).length,
        blue: segments.filter(s => position.drawn[s] === 2).length,
        open: segments.filter(s => position.drawn[s] === 0).length,
    };
}

/** The units a player owns, by name and sorted. */
function owned(grid: ICfGrid, position: ICfPosition, player: playerid): string[] {
    const names: string[] = [];
    position.owner.forEach((who, u) => {
        if (who === player) {
            names.push(unitName(grid, u));
        }
    });
    return names.sort();
}

/** An enclosure as [units, red, blue]. */
function described(grid: ICfGrid, e: ICfEnclosure): [string[], number, number] {
    return [e.units.map(u => unitName(grid, u)).sort(), e.red, e.blue];
}

/** The ply (counted from 1) at which a unit was enclosed. */
function enclosedAt(grid: ICfGrid, r: IReplay, name: string): number {
    return r.enclosed.findIndex(list => list.some(e => e.units.includes(unit(grid, name)))) + 1;
}

function play(moves: string[], variants: string[] = []): ColorfieldGame {
    const g = new ColorfieldGame(undefined, variants);
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

/** What the last move of a game enclosed: [number of units, owner, red, blue] for every enclosure. */
function claims(g: ColorfieldGame): number[][] {
    const out: number[][] = [];
    for (const r of g.results) {
        if (r.type === "claim") {
            const [red, blue] = r.how!.split(",").map(n => parseInt(n, 10));
            out.push([r.count!, r.who!, red, blue]);
        }
    }
    return out;
}

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

describe("Colorfield", () => {
    describe("Grids", () => {
        it("outlines 25 squares on the 6x6 grid, 9 cubes on the 4x4x2 grid and 9 units on the 4x4x2x2 grid", () => {
            expect(G2.units).to.equal(25);
            expect(G3.units).to.equal(9);
            expect(G4.units).to.equal(9);
            // 6 rows of 5 segments and 6 columns of 5 segments
            expect(G2.segments.length).to.equal(60);
            // 24 segments on each of the two grids and 16 between them
            expect(G3.segments.length).to.equal(64);
            // 64 segments on each of the two boards and 32 connectors
            expect(G4.segments.length).to.equal(160);
            expect(G4.segments.filter(s => s.axis === 3).length).to.equal(32);
            expect(cfGrid(8, 8).units).to.equal(49);
            expect(cfGrid(10, 10).units).to.equal(81);
            expect(cfGrid(12, 12).units).to.equal(121);
            expect(cfGrid(6, 6, 2).units).to.equal(25);
            expect(cfGrid(6, 6, 2).segments.length).to.equal(156);
            expect(() => cfGrid(4, 4, 1, 2)).to.throw();
        });

        it("names the dots and the segments", () => {
            expect(cfDotName(G2, 0)).to.equal("a1");
            expect(cfDotName(G2, 35)).to.equal("f6");
            expect(cfDotName(G3, cfFindDot(G3, "c3z")!)).to.equal("c3z");
            expect(G3.dots[cfFindDot(G3, "c3z")!]).to.deep.equal([2, 2, 1, 0]);
            expect(G4.dots[cfFindDot(G4, "d4zw")!]).to.deep.equal([3, 3, 1, 1]);
            expect(cfFindDot(G2, "g1")).to.be.undefined;
            expect(cfFindDot(G2, "a7")).to.be.undefined;
            expect(cfFindDot(G2, "a1z")).to.be.undefined;
            expect(cfFindDot(G3, "a1w")).to.be.undefined;
            // a segment connects two orthogonally adjacent dots; its dots may be given in either order
            expect(cfSegmentName(G2, segment(G2, "b1-a1"))).to.equal("a1-b1");
            expect(cfSegmentName(G2, segment(G2, "c4-c3"))).to.equal("c3-c4");
            expect(cfSegmentName(G3, segment(G3, "c3z-c3"))).to.equal("c3-c3z");
            expect(cfSegmentName(G4, segment(G4, "c3w-c3"))).to.equal("c3-c3w");
            expect(cfFindSegment(G2, "a1-c1")).to.be.undefined;
            expect(cfFindSegment(G2, "a1-b2")).to.be.undefined;
            expect(cfFindSegment(G2, "a1-a1")).to.be.undefined;
            expect(cfFindSegment(G3, "a1-b1z")).to.be.undefined;
            expect(cfFindSegment(G4, "a1-a1zw")).to.be.undefined;
            // every segment has its own name
            for (const grid of [G2, G3, G4]) {
                const names = grid.segments.map((_, s) => cfSegmentName(grid, s));
                expect(new Set(names).size).to.equal(grid.segments.length);
                names.forEach((n, s) => expect(cfFindSegment(grid, n)).to.equal(s));
            }
        });

        it("gives a square 4 edges, a cube 12 edges and a 4D unit 32 edges", () => {
            expect(G2.unitSegments[unit(G2, "a1")].map(s => cfSegmentName(G2, s)).sort()).to.deep.equal(["a1-a2", "a1-b1", "a2-b2", "b1-b2"]);
            expect(G3.unitSegments[unit(G3, "b2")].length).to.equal(12);
            // a unit has 32 edges: the 12 edges of its cube on Board 1, the 12 edges of its cube on Board 2, and the 8 connectors
            const edges = G4.unitSegments[unit(G4, "b2")].map(s => G4.segments[s]);
            expect(edges.length).to.equal(32);
            expect(edges.filter(s => s.axis === 3).length).to.equal(8);
            expect(edges.filter(s => s.axis !== 3 && G4.dots[s.ends[0]][3] === 0).length).to.equal(12);
            expect(edges.filter(s => s.axis !== 3 && G4.dots[s.ends[0]][3] === 1).length).to.equal(12);
        });

        it("lets two units side by side share a side, a face or a cube", () => {
            expect(shared(G2, "a1", "b1")).to.deep.equal(["b1-b2"]);
            expect(shared(G3, "a1", "b1")).to.deep.equal(["b1-b1z", "b1-b2", "b1z-b2z", "b2-b2z"]);
            // The shared cube has 12 edges: the 4 edges of the shared face on Board 1, the 4 edges of the
            // shared face on Board 2, and the 4 connectors between the two shared faces (Figure 14).
            const cube = shared(G4, "a2", "b2");
            expect(cube).to.deep.equal([...FIGURE_14_RED, ...FIGURE_14_BLUE].sort());
            expect(cube.length).to.equal(12);
            expect(cube.filter(n => G4.segments[segment(G4, n)].axis === 3).length).to.equal(4);
            expect(cube.filter(n => !n.includes("w")).length).to.equal(4);
            expect(G3.neighbours[unit(G3, "a1")].map(u => unitName(G3, u)).sort()).to.deep.equal(["a2", "b1"]);
            expect(G3.neighbours[unit(G3, "b2")].map(u => unitName(G3, u)).sort()).to.deep.equal(["a2", "b1", "b3", "c2"]);
            // Two cubes that touch only along an edge don't form a combined volume.  In 4D two such units
            // touch along a square (Figure 18).
            expect(shared(G3, "b2", "c3")).to.deep.equal(["c3-c3z"]);
            expect(shared(G4, "b2", "c3")).to.deep.equal([...FIGURE_18_RED, ...FIGURE_18_BLUE].sort());
            expect(G4.neighbours[unit(G4, "b2")]).to.not.include(unit(G4, "c3"));
        });

        it("leaves the edges of a shared wall out of the bordering segments", () => {
            const nothing = cfEmpty(G3);
            expect(border(G2, cfEmpty(G2), ["a1"]).all).to.equal(4);
            expect(border(G2, cfEmpty(G2), ["a1", "b1"]).all).to.equal(6);
            expect(border(G2, cfEmpty(G2), ["a1", "b1", "a2", "b2"]).all).to.equal(8);
            expect(border(G3, nothing, ["b2"]).all).to.equal(12);
            // two cubes side by side form a volume bordered by 16 segments (Figure 6)
            expect(border(G3, nothing, ["a1", "b1"]).all).to.equal(16);
            expect(cfBorder(G3, [unit(G3, "a1"), unit(G3, "b1")]).map(s => cfSegmentName(G3, s))).to.not.include.members(shared(G3, "a1", "b1"));
            expect(border(G4, cfEmpty(G4), ["b2"]).all).to.equal(32);
            // a volume of two units has 40 bordering segments (Figure 15)
            expect(border(G4, cfEmpty(G4), ["a2", "b2"]).all).to.equal(40);
        });
    });

    describe("2D rules", () => {
        it("gives an enclosed region to whoever has more segments bordering the enclosure (Figure 1)", () => {
            const {position} = replay(G2, FIGURE_1);
            expect(owned(G2, position, 1)).to.deep.equal(["b3", "b4", "c4"]);
            expect(owned(G2, position, 2)).to.deep.equal(["d1", "e1"]);
            // The red region is bordered by 5 red segments and 3 blue segments.
            expect(border(G2, position, ["b3", "b4", "c4"])).to.deep.equal({all: 8, red: 5, blue: 3, open: 0});
            // The blue region is bordered by 2 red segments and 4 blue segments.
            expect(border(G2, position, ["d1", "e1"])).to.deep.equal({all: 6, red: 2, blue: 4, open: 0});
            expect(cfScore(position, 1)).to.equal(3);
            expect(cfScore(position, 2)).to.equal(2);
        });

        it("forbids an enclosure bordered by an equal number of red and blue segments (Figure 2)", () => {
            const {position} = replay(G2, FIGURE_2);
            // Red must not draw a segment on the dotted line: 5 red segments and 5 blue segments
            expect(cfCheck(G2, position, segment(G2, "d2-e2"), 1)).to.deep.equal({legal: false, reason: "equal", count: 5});
            expect(cfLegalSegments(G2, position, 1)).to.not.include(segment(G2, "d2-e2"));
            // nothing is drawn or owned by a check
            expect(position.drawn[segment(G2, "d2-e2")]).to.equal(0);
            expect(cfScore(position, 1) + cfScore(position, 2)).to.equal(0);
        });

        it("forbids subdividing an enclosed region, but allows other segments inside it (Figure 3)", () => {
            const {position} = replay(G2, FIGURE_3);
            const region = ["b2", "b3", "b4", "c2", "c3", "c4", "d2", "d3", "d4"];
            expect(owned(G2, position, 2)).to.deep.equal(region);
            expect(owned(G2, position, 1)).to.deep.equal([]);
            // Red must not draw a segment on the dotted line: it would subdivide the enclosed region
            expect(cfCheck(G2, position, segment(G2, "c3-c4"), 1)).to.deep.equal({legal: false, reason: "subdivide"});
            expect(cfCheck(G2, position, segment(G2, "c3-c4"), 2)).to.deep.equal({legal: false, reason: "subdivide"});
            // b3-c3 would cut the square b2 off the region
            expect(cfCheck(G2, position, segment(G2, "b3-c3"), 1)).to.deep.equal({legal: false, reason: "subdivide"});
            // c3-d3 ends at a dot inside the region that no segment touches, so it subdivides nothing
            expect(cfCheck(G2, position, segment(G2, "c3-d3"), 1)).to.deep.equal({legal: true, enclosures: []});
            expect(cfDraw(G2, position, segment(G2, "c3-d3"), 1)).to.deep.equal([]);
            expect(owned(G2, position, 2)).to.deep.equal(region);
            // after it, d3-d4 would complete a line of segments from the bottom of the region to its top
            expect(cfCheck(G2, position, segment(G2, "d3-d4"), 2)).to.deep.equal({legal: false, reason: "subdivide"});
        });

        it("counts all bordering segments of a region that encloses another region (Figure 4)", () => {
            const r = replay(G2, FIGURE_4);
            const red = ["a2", "b2", "b3", "b4", "b5", "c2", "c3", "c4", "c5", "d2", "d5", "e2", "e3", "e4", "e5"];
            expect(owned(G2, r.position, 1)).to.deep.equal(red);
            // the previously enclosed blue region retains its ownership
            expect(owned(G2, r.position, 2)).to.deep.equal(["d3", "d4"]);
            expect(enclosedAt(G2, r, "d3")).to.be.lessThan(enclosedAt(G2, r, "b2"));
            expect(enclosedAt(G2, r, "d3")).to.equal(enclosedAt(G2, r, "d4"));
            // The red region is bordered by 13 red segments and 11 blue segments, not just by its outermost segments.
            expect(border(G2, r.position, red)).to.deep.equal({all: 24, red: 13, blue: 11, open: 0});
            expect(described(G2, r.enclosed[enclosedAt(G2, r, "b2") - 1][0])).to.deep.equal([red, 13, 11]);
        });

        it("is won by whoever owns the most territory when the whole grid is partitioned (Figure 5)", () => {
            const {position} = replay(G2, FIGURE_5);
            // Red has won with 16 squares against Blue's 9 squares.
            expect(cfScore(position, 1)).to.equal(16);
            expect(cfScore(position, 2)).to.equal(9);
            expect(owned(G2, position, 2)).to.deep.equal(["a3", "a4", "a5", "b1", "b2", "b3", "b4", "d3", "e3"]);
            expect(cfEnclosed(G2, position)).to.deep.equal([]);
        });

        it("leaves a player without a move when his only segment would form an equal enclosure", () => {
            // one square: Red, Blue and Red have each drawn a side
            const grid = cfGrid(2, 2);
            const position = cfEmpty(grid);
            cfDraw(grid, position, segment(grid, "a1-b1"), 1);
            cfDraw(grid, position, segment(grid, "a1-a2"), 2);
            cfDraw(grid, position, segment(grid, "a2-b2"), 1);
            // the fourth side would give Blue 2 red segments and 2 blue segments
            expect(cfCheck(grid, position, segment(grid, "b1-b2"), 2)).to.deep.equal({legal: false, reason: "equal", count: 2});
            expect(cfCanMove(grid, position, 2)).to.be.false;
            // so Blue's turn is skipped, and Red encloses the square with 3 red segments to 1 blue
            expect(cfCanMove(grid, position, 1)).to.be.true;
            expect(cfDraw(grid, position, segment(grid, "b1-b2"), 1)).to.deep.equal([{units: [0], red: 3, blue: 1}]);
            expect(position.owner).to.deep.equal([1]);
            expect(() => cfDraw(grid, position, segment(grid, "b1-b2"), 2)).to.throw();
        });
    });

    describe("3D rules", () => {
        it("counts the bordering segments of a volume, leaving out the face between its cubes (Figure 6)", () => {
            const r = replay(G3, FIGURE_6);
            expect(owned(G3, r.position, 1)).to.deep.equal(["a1", "b1", "c3"]);
            expect(owned(G3, r.position, 2)).to.deep.equal(["b3"]);
            // Red owns the volume at the bottom with 9 red segments to Blue's 7.
            expect(border(G3, r.position, ["a1", "b1"])).to.deep.equal({all: 16, red: 9, blue: 7, open: 0});
            // The three blue edges of the face between the two cubes are not bordering segments.
            expect(shared(G3, "a1", "b1").map(n => r.position.drawn[segment(G3, n)]).sort()).to.deep.equal([0, 2, 2, 2]);
            // The two cubes at the top were enclosed on different turns.
            expect(enclosedAt(G3, r, "b3")).to.not.equal(enclosedAt(G3, r, "c3"));
            expect(enclosedAt(G3, r, "a1")).to.equal(enclosedAt(G3, r, "b1"));
            // Blue owns the one on the left with 5 red segments to 7 blue, and Red owns the one on the right with 7 red segments to 5 blue.
            expect(border(G3, r.position, ["b3"])).to.deep.equal({all: 12, red: 5, blue: 7, open: 0});
            expect(border(G3, r.position, ["c3"])).to.deep.equal({all: 12, red: 7, blue: 5, open: 0});
        });

        it("encloses the union of the intersecting volumes a segment completes (Figure 7)", () => {
            const before = replay(G3, FIGURE_7.slice(0, -1)).position;
            // Red has just drawn the diagonal segment at the top left corner of the centre cube
            expect(FIGURE_7[FIGURE_7.length - 1]).to.equal("b3-b3z");
            expect(FIGURE_7.length % 2).to.equal(1);
            // it is the last bordering segment of the centre cube with the cube below it, and of the centre cube with the cube to its right
            expect(border(G3, before, ["b2", "b1"]).open).to.equal(1);
            expect(border(G3, before, ["b2", "c2"]).open).to.equal(1);
            expect(cfScore(before, 1) + cfScore(before, 2)).to.equal(0);
            const r = replay(G3, FIGURE_7);
            // Red claimed this maximal volume with 11 red segments to 10 blue.
            expect(r.enclosed[r.enclosed.length - 1].map(e => described(G3, e))).to.deep.equal([[["b1", "b2", "c2"], 11, 10]]);
            expect(owned(G3, r.position, 1)).to.deep.equal(["b1", "b2", "c2"]);
            expect(owned(G3, r.position, 2)).to.deep.equal([]);
        });

        it("encloses two volumes that share no cube separately, each with its own owner (Figure 8)", () => {
            const r = replay(G3, FIGURE_8);
            // Red has just drawn the diagonal segment at the top right corner of the four-cube volume
            expect(FIGURE_8[FIGURE_8.length - 1]).to.equal("c3-c3z");
            expect(FIGURE_8.length % 2).to.equal(1);
            // Red owns the four-cube volume with 11 red segments to 9 blue.  Blue owns the one-cube volume with 5 red segments to 7 blue.
            expect(r.enclosed[r.enclosed.length - 1].map(e => described(G3, e))).to.deep.equal([
                [["a1", "a2", "b1", "b2"], 11, 9],
                [["c3"], 5, 7],
            ]);
            expect(owned(G3, r.position, 1)).to.deep.equal(["a1", "a2", "b1", "b2"]);
            expect(owned(G3, r.position, 2)).to.deep.equal(["c3"]);
            // the two volumes touch only along that segment
            expect(shared(G3, "b2", "c3")).to.deep.equal(["c3-c3z"]);
        });

        it("forbids enclosing a volume with an equal number of red and blue bordering segments (Figure 9)", () => {
            const {position} = replay(G3, FIGURE_9);
            // Red must not draw a segment on the dotted line: 6 red segments and 6 blue segments
            expect(cfCheck(G3, position, segment(G3, "c4-d4"), 1)).to.deep.equal({legal: false, reason: "equal", count: 6});
            // Blue may draw that segment, enclosing the cube with 7 blue segments and 5 red segments.
            expect(cfCheck(G3, position, segment(G3, "c4-d4"), 2)).to.deep.equal({legal: true, enclosures: [{units: [unit(G3, "c3")], red: 5, blue: 7}]});
            cfDraw(G3, position, segment(G3, "c4-d4"), 2);
            expect(owned(G3, position, 2)).to.deep.equal(["c3"]);
        });

        it("lets an enclosed volume be subdivided, and the whole volume keeps its owner (Figure 10)", () => {
            const before = replay(G3, FIGURE_10.slice(0, -1)).position;
            expect(owned(G3, before, 1)).to.deep.equal(["a1", "b1"]);
            // Red has drawn the last of the four segments on the face between the two cubes of the red volume
            const face = shared(G3, "a1", "b1");
            expect(face).to.include(FIGURE_10[FIGURE_10.length - 1]);
            expect(face.filter(n => before.drawn[segment(G3, n)] !== 0).length).to.equal(3);
            const r = replay(G3, FIGURE_10);
            expect(face.filter(n => r.position.drawn[segment(G3, n)] !== 0).length).to.equal(4);
            expect(r.enclosed[r.enclosed.length - 1]).to.deep.equal([]);
            // the volume is now two separately enclosed cubes, and it keeps its original owner
            expect(border(G3, r.position, ["a1"]).open).to.equal(0);
            expect(border(G3, r.position, ["b1"]).open).to.equal(0);
            expect(owned(G3, r.position, 1)).to.deep.equal(["a1", "b1"]);
            expect(owned(G3, r.position, 2)).to.deep.equal([]);
        });
    });

    describe("4D rules", () => {
        it("has segments on either board and connectors between the boards (Figure 11)", () => {
            const {position} = replay(G4, FIGURE_11);
            const kinds = (player: playerid): string[] => G4.segments
                .filter((_, s) => position.drawn[s] === player)
                .map(s => s.axis === 3 ? "connector" : G4.dots[s.ends[0]][3] === 0 ? "Board 1" : "Board 2")
                .sort();
            // Red has drawn two segments on Board 1 and one connector.  Blue has drawn two segments on Board 2 and one connector.
            expect(kinds(1)).to.deep.equal(["Board 1", "Board 1", "connector"]);
            expect(kinds(2)).to.deep.equal(["Board 2", "Board 2", "connector"]);
        });

        it("encloses a unit when all 32 of its edges are drawn (Figure 12)", () => {
            const r = replay(G4, FIGURE_12);
            // Red has just formed a connector and enclosed the centre unit: 17 red and 15 blue
            expect(G4.segments[segment(G4, FIGURE_12[FIGURE_12.length - 1])].axis).to.equal(3);
            expect(FIGURE_12.length % 2).to.equal(1);
            expect(r.enclosed[r.enclosed.length - 1].map(e => described(G4, e))).to.deep.equal([[["b2"], 17, 15]]);
            expect(border(G4, r.position, ["b2"])).to.deep.equal({all: 32, red: 17, blue: 15, open: 0});
            expect(owned(G4, r.position, 1)).to.deep.equal(["b2"]);
        });

        it("counts the 12 edges of a shared cube toward both units (Figures 13 and 14)", () => {
            const r = replay(G4, FIGURE_13);
            // Red owns the one on the left with 17 red segments to 15 blue, and Blue owns the one on the right with 15 red segments to 17 blue.
            expect(owned(G4, r.position, 1)).to.deep.equal(["a2"]);
            expect(owned(G4, r.position, 2)).to.deep.equal(["b2"]);
            expect(border(G4, r.position, ["a2"])).to.deep.equal({all: 32, red: 17, blue: 15, open: 0});
            expect(border(G4, r.position, ["b2"])).to.deep.equal({all: 32, red: 15, blue: 17, open: 0});
            // The two units were enclosed on different turns.
            expect(enclosedAt(G4, r, "a2")).to.not.equal(enclosedAt(G4, r, "b2"));
            // Figure 14 shows the 12 edges of the cube shared by the two units, in the colours they have in Figure 13
            for (const n of FIGURE_14_RED) {
                expect(r.position.drawn[segment(G4, n)]).to.equal(1);
            }
            for (const n of FIGURE_14_BLUE) {
                expect(r.position.drawn[segment(G4, n)]).to.equal(2);
            }
        });

        it("leaves the 12 edges of a shared cube out of the bordering segments of a volume (Figure 15)", () => {
            const {position} = replay(G4, FIGURE_15);
            // Red owns a volume of two units.  Its 40 bordering segments are drawn, 21 red and 19 blue.
            expect(owned(G4, position, 1)).to.deep.equal(["a2", "b2"]);
            expect(border(G4, position, ["a2", "b2"])).to.deep.equal({all: 40, red: 21, blue: 19, open: 0});
            // The 12 edges of the cube shared by the two units are not bordering segments, and here none of them is drawn.
            expect(shared(G4, "a2", "b2").filter(n => position.drawn[segment(G4, n)] !== 0)).to.deep.equal([]);
        });

        it("encloses the union of the intersecting volumes a connector completes (Figure 16)", () => {
            const before = replay(G4, FIGURE_16.slice(0, -1)).position;
            // Red has just formed the connector at the front top left corner of the centre unit
            expect(FIGURE_16[FIGURE_16.length - 1]).to.equal("b3-b3w");
            expect(FIGURE_16.length % 2).to.equal(1);
            expect(border(G4, before, ["b2", "b1"]).open).to.equal(1);
            expect(border(G4, before, ["b2", "c2"]).open).to.equal(1);
            const r = replay(G4, FIGURE_16);
            // Red claimed this maximal volume with 27 red segments to 25 blue.
            expect(r.enclosed[r.enclosed.length - 1].map(e => described(G4, e))).to.deep.equal([[["b1", "b2", "c2"], 27, 25]]);
            expect(owned(G4, r.position, 1)).to.deep.equal(["b1", "b2", "c2"]);
        });

        it("encloses two volumes that share no unit separately (Figures 17 and 18)", () => {
            const r = replay(G4, FIGURE_17);
            // Red has just formed the connector at the front top right corner of the centre unit
            expect(FIGURE_17[FIGURE_17.length - 1]).to.equal("c3-c3w");
            expect(FIGURE_17.length % 2).to.equal(1);
            // Red owns the centre unit with 17 red segments to 15 blue.  Blue owns the corner unit with 14 red segments to 18 blue.
            expect(r.enclosed[r.enclosed.length - 1].map(e => described(G4, e))).to.deep.equal([
                [["b2"], 17, 15],
                [["c3"], 14, 18],
            ]);
            expect(owned(G4, r.position, 1)).to.deep.equal(["b2"]);
            expect(owned(G4, r.position, 2)).to.deep.equal(["c3"]);
            // Figure 18 shows the square where the two units touch, in the colours of Figure 17
            expect(shared(G4, "b2", "c3")).to.include("c3-c3w");
            for (const n of FIGURE_18_RED) {
                expect(r.position.drawn[segment(G4, n)]).to.equal(1);
            }
            for (const n of FIGURE_18_BLUE) {
                expect(r.position.drawn[segment(G4, n)]).to.equal(2);
            }
        });

        it("forbids enclosing a unit with an equal number of red and blue bordering segments (Figure 19)", () => {
            const {position} = replay(G4, FIGURE_19);
            // Red must not draw a segment on the dotted line: 16 red segments and 16 blue segments
            expect(cfCheck(G4, position, segment(G4, "c4-d4"), 1)).to.deep.equal({legal: false, reason: "equal", count: 16});
            // Blue may draw that segment, enclosing the unit with 17 blue segments and 15 red segments.
            expect(cfCheck(G4, position, segment(G4, "c4-d4"), 2)).to.deep.equal({legal: true, enclosures: [{units: [unit(G4, "c3")], red: 15, blue: 17}]});
        });

        it("lets an enclosed volume be subdivided along the cube its units share (Figure 20)", () => {
            const {position} = replay(G4, FIGURE_20);
            // all 12 edges of the cube shared by the two units of the red volume have been drawn
            expect(shared(G4, "a2", "b2").filter(n => position.drawn[segment(G4, n)] === 0)).to.deep.equal([]);
            // the two units are separately enclosed, and the entire volume keeps its original owner
            expect(border(G4, position, ["a2"]).open).to.equal(0);
            expect(border(G4, position, ["b2"]).open).to.equal(0);
            expect(owned(G4, position, 1)).to.deep.equal(["a2", "b2"]);
            expect(owned(G4, position, 2)).to.deep.equal([]);
        });
    });

    describe("Game", () => {
        it("starts on the empty 6x6 grid with Red to move", () => {
            const g = new ColorfieldGame();
            expect(g.grid.size).to.deep.equal([6, 6, 1, 1]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves().length).to.equal(60);
            expect(g.moves()).to.include("a1-b1");
            expect(g.getPlayerScore(1)).to.equal(0);
            expect(g.gameover).to.be.false;
            expect(ColorfieldGame.gameinfo.flags).to.include.members(["experimental", "pie", "autopass", "scores"]);
        });

        it("honours the board variants", () => {
            const boards: [string, number[], number, number][] = [
                ["size-8", [8, 8, 1, 1], 49, 112],
                ["size-10", [10, 10, 1, 1], 81, 180],
                ["size-12", [12, 12, 1, 1], 121, 264],
                ["3d-4x4x2", [4, 4, 2, 1], 9, 64],
                ["3d-6x6x2", [6, 6, 2, 1], 25, 156],
                ["4d-4x4x2x2", [4, 4, 2, 2], 9, 160],
            ];
            for (const [variant, size, units, segments] of boards) {
                const g = new ColorfieldGame(undefined, [variant]);
                expect(g.grid.size).to.deep.equal(size);
                expect(g.grid.units).to.equal(units);
                expect(g.moves().length).to.equal(segments);
                expect(new ColorfieldGame(g.serialize()).grid.size).to.deep.equal(size);
            }
        });

        it("offers the pie rule to Blue on his first turn only", () => {
            const g = new ColorfieldGame();
            expect(g.isPieTurn()).to.be.false;
            g.move("c3-c4");
            expect(g.currplayer).to.equal(2);
            expect(g.isPieTurn()).to.be.true;
            g.move("a1-b1");
            expect(g.isPieTurn()).to.be.false;
        });

        it("draws a segment in the mover's colour and records it with its dots in order", () => {
            const g = new ColorfieldGame();
            g.move("B1 - A1");
            expect(g.lastmove).to.equal("a1-b1");
            expect(g.segmentsOf(1)).to.deep.equal(["a1-b1"]);
            g.move("c4-c3");
            expect(g.lastmove).to.equal("c3-c4");
            expect(g.segmentsOf(2)).to.deep.equal(["c3-c4"]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves().length).to.equal(58);
            const cube = play(["a1-a1z", "a1z-b1z"], ["3d-4x4x2"]);
            expect(cube.segmentsOf(1)).to.deep.equal(["a1-a1z"]);
            expect(cube.segmentsOf(2)).to.deep.equal(["a1z-b1z"]);
            const hyper = play(["a1-a1w", "a1zw-a1z", "d4w-d4zw"], ["4d-4x4x2x2"]);
            expect(hyper.segmentsOf(1)).to.deep.equal(["d4w-d4zw", "a1-a1w"]);
            expect(hyper.segmentsOf(2)).to.deep.equal(["a1z-a1zw"]);
        });

        it("rejects what is not a legal segment, with the right explanation", () => {
            addResource("en");
            const t = (key: string, params?: Record<string, string | number>): string => i18next.t(`apgames:validation.colorfield.${key}`, params);
            let g = new ColorfieldGame();
            for (const m of ["a1-c1", "a1-b2", "a1", "a1-b1-c1", "a6-a7", "f1-g1", "a1-a1z", "a1-a1w", "x"]) {
                expect(g.validateMove(m).valid, m).to.be.false;
                expect(g.validateMove(m).message, m).to.equal(t("INVALID_SEGMENT", {move: m, example: "a1-b1"}));
                expect(() => g.move(m), m).to.throw();
            }
            expect(g.validateMove("pass").message).to.equal(t("NO_PASS"));
            expect(() => g.move("pass")).to.throw();
            expect(g.validateMove("").valid).to.be.true;
            expect(g.validateMove("").complete).to.equal(-1);
            expect(g.validateMove("").message).to.equal(t("INITIAL_INSTRUCTIONS"));
            expect(g.validateMove("a1-b1").valid).to.be.true;
            expect(g.validateMove("a1-b1").complete).to.equal(1);
            // Figure 2, Red to move
            g = play(FIGURE_2);
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("d2-e2").valid).to.be.false;
            expect(g.validateMove("d2-e2").message).to.equal(t("EQUAL_REGION", {where: "d2-e2", num: 5}));
            expect(g.validateMove("d2-e2").message).to.equal("You must not draw the segment d2-e2. It would form an enclosure bordered by 5 red segments and 5 blue segments - an equal number.");
            expect(g.validateMove("e2-d2").message).to.equal(t("EQUAL_REGION", {where: "d2-e2", num: 5}));
            expect(g.validateMove("b3-b4").message).to.equal(t("ALREADY_DRAWN", {where: "b3-b4"}));
            expect(g.moves()).to.not.include("d2-e2");
            expect(() => g.move("d2-e2")).to.throw();
            // Figure 3, Red to move
            g = play(FIGURE_3);
            expect(g.validateMove("c3-c4").message).to.equal(t("SUBDIVIDE", {where: "c3-c4"}));
            expect(g.validateMove("c3-d3").valid).to.be.true;
            // Figure 9, Red to move: Red must not draw the dotted segment, Blue may
            g = play(FIGURE_9, ["3d-4x4x2"]);
            expect(g.validateMove("c4-d4").message).to.equal(t("EQUAL_VOLUME", {where: "c4-d4", num: 6}));
            expect(g.validateMove("").message).to.equal(t("INITIAL_INSTRUCTIONS"));
            g.move("a1-b1");
            expect(g.validateMove("c4-d4").valid).to.be.true;
            // Figure 19, Red to move
            g = play(FIGURE_19, ["4d-4x4x2x2"]);
            expect(g.validateMove("c4-d4").message).to.equal(t("EQUAL_VOLUME", {where: "c4-d4", num: 16}));
            expect(g.validateMove("").message).to.equal(t("CONNECTOR_INSTRUCTIONS"));
        });

        it("reports what a move encloses (Figures 7, 8, 12 and 17)", () => {
            let g = play(FIGURE_7, ["3d-4x4x2"]);
            expect(claims(g)).to.deep.equal([[3, 1, 11, 10]]);
            expect(g.getPlayerScore(1)).to.equal(3);
            expect(g.gameover).to.be.false;
            g = play(FIGURE_8, ["3d-4x4x2"]);
            expect(claims(g)).to.deep.equal([[4, 1, 11, 9], [1, 2, 5, 7]]);
            expect(g.getPlayerScore(1)).to.equal(4);
            expect(g.getPlayerScore(2)).to.equal(1);
            expect(g.sidebarScores()[0].scores).to.deep.equal([4, 1]);
            g = play(FIGURE_12, ["4d-4x4x2x2"]);
            expect(claims(g)).to.deep.equal([[1, 1, 17, 15]]);
            g = play(FIGURE_17, ["4d-4x4x2x2"]);
            expect(claims(g)).to.deep.equal([[1, 1, 17, 15], [1, 2, 14, 18]]);
        });

        it("ends as soon as a player owns more than half of the grid (Figure 5)", () => {
            // In this order of play Red owns 8 of the 25 squares after ply 40 and 14 after ply 41.
            const g = play(FIGURE_5.slice(0, 40));
            expect(g.getPlayerScore(1)).to.equal(8);
            expect(g.getPlayerScore(2)).to.equal(9);
            expect(g.gameover).to.be.false;
            g.move(FIGURE_5[40]);
            expect(claims(g)).to.deep.equal([[6, 1, 8, 6]]);
            expect(g.getPlayerScore(1)).to.equal(14);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.results.map(r => r.type)).to.deep.equal(["place", "claim", "eog", "winners"]);
            expect(g.moves()).to.deep.equal([]);
            expect(() => g.move(FIGURE_5[41])).to.throw();
        });

        it("skips the turn of a player with no legal move, on the 6x6 grid", () => {
            const g = new ColorfieldGame();
            const seen: number[][] = [];
            GAME_2D.forEach((m, i) => {
                // passing is not allowed, except that a turn is skipped when no move is available
                expect(g.validateMove("pass").valid, `ply ${i + 1}`).to.equal(m === "pass");
                if (m === "pass") {
                    expect(g.moves()).to.deep.equal(["pass"]);
                    expect(g.currplayer).to.equal(2);
                } else {
                    expect(g.moves()).to.include(m);
                }
                g.move(m);
                for (const c of claims(g)) {
                    seen.push([i + 1, ...c]);
                }
            });
            expect(GAME_2D.filter(m => m === "pass").length).to.equal(1);
            expect(seen).to.deep.equal(GAME_2D_CLAIMS);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.getPlayerScore(1)).to.equal(15);
            expect(g.getPlayerScore(2)).to.equal(9);
            expect(() => g.move("a1-a2")).to.throw();
        });

        it("plays a full game on the 4x4x2 grid and on the 4x4x2x2 grid", () => {
            const games: [string[], string, number[][], number, number][] = [
                [GAME_3D, "3d-4x4x2", GAME_3D_CLAIMS, 5, 2],
                [GAME_4D, "4d-4x4x2x2", GAME_4D_CLAIMS, 5, 3],
            ];
            for (const [moves, variant, expected, red, blue] of games) {
                const g = new ColorfieldGame(undefined, [variant]);
                const seen: number[][] = [];
                moves.forEach((m, i) => {
                    expect(g.gameover, `ply ${i + 1}`).to.be.false;
                    expect(g.validateMove("pass").valid, `ply ${i + 1}`).to.equal(m === "pass");
                    g.move(m);
                    for (const c of claims(g)) {
                        seen.push([i + 1, ...c]);
                    }
                });
                expect(moves.filter(m => m === "pass").length).to.equal(1);
                expect(seen).to.deep.equal(expected);
                expect(g.gameover).to.be.true;
                expect(g.winner).to.deep.equal([1]);
                expect(g.getPlayerScore(1)).to.equal(red);
                expect(g.getPlayerScore(2)).to.equal(blue);
            }
        });

        it("builds moves from clicks", () => {
            addResource("en");
            let g = new ColorfieldGame();
            let layout = cfLayout(g.grid);
            const middle = (name: string, along = 0.5): [number, number] => {
                const [from, to] = g.grid.segments[segment(g.grid, name)].ends.map(d => layout.dots[d]);
                return [from[0] + along * (to[0] - from[0]), from[1] + along * (to[1] - from[1])];
            };
            const dot = (name: string): [number, number] => layout.dots[cfFindDot(g.grid, name)!];
            // the freespace renderer reports a click as (row, col) = (y, x) of the drawing
            const click = (move: string, [x, y]: [number, number]) => g.handleClick(move, y, x, "_field");

            const first = click("", middle("c3-c4"));
            expect(first.valid).to.be.true;
            expect(first.move).to.equal("c3-c4");
            expect(first.complete).to.equal(1);
            // a click beside a segment still means that segment
            const [mx, my] = middle("c3-c4");
            expect(click("", [mx + 12, my + 5]).move).to.equal("c3-c4");
            expect(click("", [mx - 12, my - 9]).move).to.equal("c3-c4");
            // another segment replaces the one selected before
            expect(click("c3-c4", middle("a1-b1")).move).to.equal("a1-b1");
            // a click in the middle of a square or on a dot takes the selection back
            const [ax, ay] = dot("a1");
            const [bx, by] = dot("b2");
            const away = click("c3-c4", [(ax + bx) / 2, (ay + by) / 2]);
            expect(away.valid).to.be.true;
            expect(away.move).to.equal("");
            expect(away.complete).to.equal(-1);
            expect(click("c3-c4", dot("c3")).move).to.equal("");
            expect(click("", [1, 1]).move).to.equal("");
            // a click on a segment that is already drawn does nothing, anywhere along the segment
            g.move("c3-c4");
            for (const along of [0.2, 0.3, 0.5, 0.7, 0.8]) {
                const drawn = click("a1-b1", middle("c3-c4", along));
                expect(drawn.valid).to.be.true;
                expect(drawn.move).to.equal("");
                expect(drawn.complete).to.equal(-1);
            }
            // the segments next to it are selected as before
            expect(click("", middle("c3-d3", 0.3)).move).to.equal("c3-d3");
            expect(click("", middle("c4-c5", 0.3)).move).to.equal("c4-c5");
            // a segment that must not be drawn is refused with the reason (Figure 2)
            g = play(FIGURE_2);
            const refused = click("a1-b1", middle("d2-e2"));
            expect(refused.valid).to.be.false;
            expect(refused.move).to.equal("");
            expect(refused.message).to.equal(i18next.t("apgames:validation.colorfield.EQUAL_REGION", {where: "d2-e2", num: 5}));

            // 3D: the front segment a2-b2 and the back segment a1z-a2z cross in the drawing
            g = new ColorfieldGame(undefined, ["3d-4x4x2"]);
            layout = cfLayout(g.grid);
            expect(middle("a2-b2")).to.deep.equal(middle("a1z-a2z"));
            expect(click("", middle("a2-b2")).move).to.equal("a2-b2");
            expect(click("", middle("a1z-a2z", 0.2)).move).to.equal("a1z-a2z");
            expect(click("", middle("a1-a1z")).move).to.equal("a1-a1z");
            expect(click("", middle("c3z-d3z", 0.3)).move).to.equal("c3z-d3z");
            // once the front segment is drawn, a click on the crossing does nothing, and the segment
            // behind it is selected beside the crossing
            g.move("a2-b2");
            expect(click("", middle("a2-b2")).move).to.equal("");
            expect(click("", middle("a1z-a2z", 0.25)).move).to.equal("a1z-a2z");
            expect(click("", middle("a1z-a2z", 0.75)).move).to.equal("a1z-a2z");

            // 4D: a dot is the connector at that dot, on either board
            g = new ColorfieldGame(undefined, ["4d-4x4x2x2"]);
            layout = cfLayout(g.grid);
            expect(click("", dot("c3")).move).to.equal("c3-c3w");
            expect(click("", dot("c3w")).move).to.equal("c3-c3w");
            expect(click("", dot("c3zw")).move).to.equal("c3z-c3zw");
            expect(click("", middle("a1w-b1w")).move).to.equal("a1w-b1w");
            expect(click("", middle("b2-b2z")).move).to.equal("b2-b2z");
            // a connector that has been formed does nothing when its dot is clicked on either board
            g.move("c3-c3w");
            for (const name of ["c3", "c3w"]) {
                const again = click("a1-b1", dot(name));
                expect(again.valid).to.be.true;
                expect(again.move).to.equal("");
            }
            expect(g.validateMove("c3-c3w").message).to.equal(i18next.t("apgames:validation.colorfield.ALREADY_DRAWN", {where: "c3-c3w"}));
            // With the boards stacked, Board 1 is in the same place and Board 2 is below it instead of
            // beside it, so the same clicks work in both drawings.
            const stacked = cfLayout(g.grid, true);
            const below = (name: string): [number, number] => stacked.dots[cfFindDot(g.grid, name)!];
            expect(below("b2")).to.deep.equal(dot("b2"));
            expect(below("b2w")[0]).to.equal(dot("b2")[0]);
            expect(below("b2w")[1]).to.be.greaterThan(layout.height);
            expect(click("", below("b2w")).move).to.equal("b2-b2w");
            expect(click("", below("d4zw")).move).to.equal("d4z-d4zw");
            const [p, q] = [below("a1w"), below("b1w")];
            expect(click("", [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]).move).to.equal("a1w-b1w");
            // the felt between the two sheets of paper
            expect(click("", [stacked.papers[1][0] + 40, stacked.papers[1][1] - 5]).move).to.equal("");
        });

        it("shows a move before it is submitted without changing the game", () => {
            const g = play(FIGURE_7.slice(0, -1), ["3d-4x4x2"]);
            const stack = g.stack.length;
            g.move("b3-b3z", {partial: true});
            expect(g.stack.length).to.equal(stack);
            expect(g.currplayer).to.equal(1);
            expect(g.getPlayerScore(1)).to.equal(3);
            g.load();
            expect(g.getPlayerScore(1)).to.equal(0);
            expect(g.moves()).to.include("b3-b3z");
        });

        it("serializes and clones with the history intact", () => {
            const g = play(GAME_3D, ["3d-4x4x2"]);
            const again = new ColorfieldGame(g.serialize());
            expect(again.stack.length).to.equal(GAME_3D.length + 1);
            expect(again.grid.size).to.deep.equal([4, 4, 2, 1]);
            expect(again.gameover).to.be.true;
            expect(again.winner).to.deep.equal([1]);
            expect(again.segmentsOf(1)).to.deep.equal(g.segmentsOf(1));
            expect(again.segmentsOf(2)).to.deep.equal(g.segmentsOf(2));
            expect(again.getPlayerScore(1)).to.equal(5);
            const c = g.clone();
            expect(c.moves()).to.deep.equal([]);
            expect(c.getPlayerScore(2)).to.equal(2);
            // load() restores the position of stack[idx]
            again.load(2);
            expect(again.currplayer).to.equal(1);
            expect(again.lastmove).to.equal(GAME_3D[1]);
            expect(again.segmentsOf(1)).to.deep.equal([GAME_3D[0]]);
            expect(again.segmentsOf(2)).to.deep.equal([GAME_3D[1]]);
            expect(again.getPlayerScore(1)).to.equal(0);
        });
    });

    describe("Chat log", () => {
        it("reports segments, connectors, enclosures, skipped turns and the winner", () => {
            addResource("en");
            const names = ["Red player", "Blue player"];
            // Figure 8: Red's segment encloses a volume for Red and a volume for Blue
            let g = play(FIGURE_8, ["3d-4x4x2"]);
            let entries = g.chatLogEntries(names);
            expect(entries[0].lines.map(l => l.textKey)).to.deep.equal(["apresults:colorfield.PLACE.segment"]);
            expect(entries[0].lines[0].textParams).to.include({where: FIGURE_8[0]});
            expect(entries[0].lines[0].actor).to.deep.equal({kind: "seat", seat: 1});
            let last = entries[entries.length - 1];
            expect(last.lines.map(l => l.textKey)).to.deep.equal([
                "apresults:colorfield.PLACE.segment",
                "apresults:colorfield.CLAIM.cubes",
                "apresults:colorfield.CLAIM.cubes",
            ]);
            expect(last.lines[1].textParams).to.deep.equal({player: "Red player", count: 4, red: "11", blue: "9"});
            expect(last.lines[2].textParams).to.deep.equal({player: "Blue player", count: 1, red: "5", blue: "7"});
            assertChatLogParity(g, names);
            expect(g.chatLog(names).flat().some(line => line.includes("Blue player claimed a volume of 1 cube with 5 red segments to 7 blue."))).to.be.true;
            expect(g.chatLog(names).flat().some(line => line.includes("Red player claimed a volume of 4 cubes with 11 red segments to 9 blue."))).to.be.true;

            // the 6x6 game: Blue's turn is skipped at ply 42, and Red wins at ply 43
            g = play(GAME_2D);
            entries = g.chatLogEntries(names);
            expect(entries[41].lines.map(l => l.textKey)).to.deep.equal(["apresults:colorfield.PASS.skipped"]);
            expect(entries[41].lines[0].actor).to.deep.equal({kind: "seat", seat: 2});
            last = entries[entries.length - 1];
            expect(last.lines.map(l => l.textKey)).to.deep.equal([
                "apresults:colorfield.PLACE.segment",
                "apresults:colorfield.CLAIM.region",
                "apresults:colorfield.EOG.squares",
                "apresults:_general.WINNERS",
            ]);
            expect(last.lines[2].textParams).to.deep.equal({player: "Red player"});
            assertChatLogParity(g, names);
            const t = (key: string, params?: Record<string, unknown>): string => i18next.t(key, params);
            expect(g.formatEogSummary(names, t)).to.equal("Red player owns more than half of the squares.");
            expect(g.chatLog(names).flat().some(line => line.includes("skipped"))).to.be.true;

            // the 4x4x2 and 4x4x2x2 games
            g = play(GAME_3D, ["3d-4x4x2"]);
            expect(g.formatEogSummary(names, t)).to.equal("Red player owns more than half of the cubes.");
            assertChatLogParity(g, names);
            g = play(GAME_4D, ["4d-4x4x2x2"]);
            expect(g.formatEogSummary(names, t)).to.equal("Red player owns more than half of the units.");
            assertChatLogParity(g, names);
            const connector = GAME_4D.findIndex(m => /^([a-d][1-4]z?)-\1w$/.test(m));
            expect(connector).to.be.greaterThan(-1);
            expect(g.chatLogEntries(names)[connector].lines.map(l => l.textKey)).to.deep.equal(["apresults:colorfield.PLACE.connector"]);
        });
    });

    describe("Rendering", () => {
        type Marker = {type: string; path?: string; fill?: unknown; fillOpacity?: number; stroke?: unknown; strokeOpacity?: number; dashed?: number[]; label?: unknown};
        const markersOf = (g: ColorfieldGame): Marker[] => (g.render().board as {markers: Marker[]}).markers;
        const line = (g: ColorfieldGame, name: string): string => {
            const layout = cfLayout(g.grid);
            const [p, q] = g.grid.segments[segment(g.grid, name)].ends.map(d => layout.dots[d]);
            return `M${p[0]},${p[1]}L${q[0]},${q[1]}`;
        };
        const subpaths = (m: Marker): number => m.path!.split("M").length - 1;
        // bars are filled in a player's colour and opaque; territory is filled in a player's colour and translucent
        const bars = (g: ColorfieldGame, player: number): Marker[] => markersOf(g).filter(m => m.fill === player && m.fillOpacity === undefined && !m.path!.includes("a"));
        const discs = (g: ColorfieldGame, player: number): Marker[] => markersOf(g).filter(m => m.fill === player && m.fillOpacity === undefined && m.path!.includes("a"));
        const territory = (g: ColorfieldGame, player: number): Marker[] => markersOf(g).filter(m => m.fill === player && m.fillOpacity !== undefined);
        const dashed = (g: ColorfieldGame): Marker[] => markersOf(g).filter(m => m.dashed !== undefined);

        it("draws the empty 6x6 grid with the freespace renderer", () => {
            const g = new ColorfieldGame();
            const rep = g.render();
            const layout = cfLayout(g.grid);
            expect(rep.renderer).to.equal("freespace");
            expect(rep.board).to.include({width: layout.width, height: layout.height});
            expect(rep.pieces).to.be.null;
            expect(rep.annotations).to.be.undefined;
            const markers = markersOf(g);
            // the letters a to f and the numbers 1 to 6
            expect(markers.filter(m => m.type === "label").map(m => m.label).sort()).to.deep.equal(["1", "2", "3", "4", "5", "6", "a", "b", "c", "d", "e", "f"]);
            expect(bars(g, 1).length + bars(g, 2).length).to.equal(0);
            expect(territory(g, 1).length + territory(g, 2).length).to.equal(0);
            expect(dashed(g).length).to.equal(0);
            // one sheet of paper; on the 4D grid one for each board, with the name of the board
            expect(layout.papers.length).to.equal(1);
            const hyper = new ColorfieldGame(undefined, ["4d-4x4x2x2"]);
            expect(cfLayout(hyper.grid).papers.length).to.equal(2);
            const captions = markersOf(hyper).filter(m => m.type === "label" && typeof m.label === "object");
            expect(captions.map(m => m.label)).to.deep.equal([
                {textKey: "apgames:validation.colorfield.LABEL_BOARD", actor: {kind: "none"}, textParams: {num: 1}},
                {textKey: "apgames:validation.colorfield.LABEL_BOARD", actor: {kind: "none"}, textParams: {num: 2}},
            ]);
            // the display "stacked" puts Board 2 below Board 1, and changes nothing on the other grids
            const stacked = cfLayout(hyper.grid, true);
            expect(hyper.render({altDisplays: ["stacked"]}).board).to.include({width: stacked.width, height: stacked.height});
            expect(stacked.papers[1][0]).to.equal(stacked.papers[0][0]);
            expect(stacked.papers[1][1]).to.be.greaterThan(stacked.papers[0][1] + stacked.papers[0][3]);
            expect(stacked.width).to.be.lessThan(cfLayout(hyper.grid).width / 2 + 10);
            expect(g.render({altDisplays: ["stacked"]})).to.deep.equal(g.render());
            // every dot lies on a sheet of paper
            for (const [board, l] of [[g, layout], [new ColorfieldGame(undefined, ["3d-6x6x2"]), undefined], [hyper, undefined], [hyper, stacked]] as [ColorfieldGame, ReturnType<typeof cfLayout> | undefined][]) {
                const l2 = l ?? cfLayout(board.grid);
                l2.dots.forEach(([x, y], d) => {
                    const w = board.grid.dots[d][3];
                    const [px, py, pw, ph] = l2.papers[w];
                    expect(x > px + 10 && x < px + pw - 10 && y > py + 10 && y < py + ph - 10, cfDotName(board.grid, d)).to.be.true;
                });
                const [lx, ly, lw, lh] = l2.papers[l2.papers.length - 1];
                expect(lx + lw).to.be.lessThan(l2.width);
                expect(ly + lh).to.be.lessThan(l2.height);
            }
        });

        it("draws the segments and the territory in the players' colours (Figures 1 and 6)", () => {
            let g = play(FIGURE_1);
            expect(bars(g, 1).length).to.equal(7);
            expect(bars(g, 2).length).to.equal(7);
            // one path per player, with a square for every square he owns
            expect(territory(g, 1).map(subpaths)).to.deep.equal([3]);
            expect(territory(g, 2).map(subpaths)).to.deep.equal([2]);
            g = play(FIGURE_6, ["3d-4x4x2"]);
            expect(bars(g, 1).length).to.equal(20);
            expect(bars(g, 2).length).to.equal(20);
            expect(territory(g, 1).map(subpaths)).to.deep.equal([3]);
            expect(territory(g, 2).map(subpaths)).to.deep.equal([1]);
            // on the 4D grid a unit is filled on both boards, and a connector is a disc on both boards (Figure 12)
            g = play(FIGURE_12, ["4d-4x4x2x2"]);
            expect(territory(g, 1).map(subpaths)).to.deep.equal([2]);
            const connectors = (player: playerid): number => g.segmentsOf(player).filter(n => g.grid.segments[segment(g.grid, n)].axis === 3).length;
            expect(discs(g, 1).length).to.equal(2 * connectors(1));
            expect(discs(g, 2).length).to.equal(2 * connectors(2));
            expect(bars(g, 1).length + connectors(1)).to.equal(17);
            expect(bars(g, 2).length + connectors(2)).to.equal(16);
        });

        it("marks with a dotted line the segments the player to move must not draw (Figures 2, 3, 9 and 19)", () => {
            // Figure 2, Red to move
            let g = play(FIGURE_2);
            expect(dashed(g).map(m => m.path)).to.include(line(g, "d2-e2"));
            expect(dashed(g).length).to.equal(60 - 12 - g.moves().length);
            // Figure 3: the dotted line of the figure is marked for Red and for Blue
            g = play(FIGURE_3);
            expect(dashed(g).map(m => m.path)).to.include(line(g, "c3-c4"));
            g.move("a1-b1");
            expect(dashed(g).map(m => m.path)).to.include(line(g, "c3-c4"));
            // Figure 9: marked for Red, not for Blue
            g = play(FIGURE_9, ["3d-4x4x2"]);
            expect(dashed(g).map(m => m.path)).to.deep.equal([line(g, "c4-d4")]);
            g.move("a1-b1");
            expect(dashed(g)).to.deep.equal([]);
            // Figure 19
            g = play(FIGURE_19, ["4d-4x4x2x2"]);
            expect(dashed(g).map(m => m.path)).to.deep.equal([line(g, "c4-d4")]);
            // nothing is marked while a move is being shown, or when the game is over
            g = play(FIGURE_2);
            g.move("a1-b1", {partial: true});
            expect(dashed(g)).to.deep.equal([]);
            expect(dashed(play(GAME_2D))).to.deep.equal([]);
        });

        it("marks the segment drawn last", () => {
            const g = new ColorfieldGame();
            g.move("c3-c4");
            expect(g.render().annotations!.length).to.equal(2);
            g.move("a1-b1", {partial: true});
            expect(g.render().annotations!.length).to.equal(2);
            // a connector is marked on both boards
            const hyper = play(["c3-c3w"], ["4d-4x4x2x2"]);
            const layout = cfLayout(hyper.grid);
            // each mark is a small circle; its path starts at the left end of the circle
            const spots = (hyper.render().annotations as {path: string}[]).map(a => /^M([\d.]+),([\d.]+)/.exec(a.path)!.slice(1).map(Number));
            expect(spots.length).to.equal(2);
            for (const name of ["c3", "c3w"]) {
                const [x, y] = layout.dots[cfFindDot(hyper.grid, name)!];
                expect(spots.some(([sx, sy]) => sy === y && sx < x && sx > x - 10), name).to.be.true;
            }
            // a skipped turn marks nothing
            const skipped = play(GAME_2D.slice(0, 42));
            expect(skipped.lastmove).to.equal("pass");
            expect(skipped.render().annotations).to.be.undefined;
        });
    });

    describe("Random play", () => {
        it("always ends with one player owning more than half of the grid, on every board", function () {
            this.timeout(120000);
            const boards: [string[], number][] = [[[], 20], [["size-8"], 5], [["size-10"], 2], [["size-12"], 1], [["3d-4x4x2"], 20], [["3d-6x6x2"], 4], [["4d-4x4x2x2"], 8]];
            const random = seededRandom(20261127);
            for (const [variants, games] of boards) {
                for (let n = 0; n < games; n++) {
                    const g = new ColorfieldGame(undefined, variants);
                    let plies = 0;
                    while (!g.gameover) {
                        const moves = g.moves();
                        expect(moves.length).to.be.greaterThan(0);
                        g.move(moves[Math.floor(random() * moves.length)]);
                        plies++;
                        expect(plies).to.be.lessThan(2 * g.grid.segments.length);
                    }
                    expect(g.winner.length).to.equal(1);
                    const winner = g.winner[0];
                    expect(2 * g.getPlayerScore(winner)).to.be.greaterThan(g.grid.units);
                    expect(g.getPlayerScore(1) + g.getPlayerScore(2)).to.be.at.most(g.grid.units);
                    // the game ended because of the majority, not because both players were without a move
                    expect(g.results.some(r => r.type === "eog" && r.reason !== undefined)).to.be.true;
                    // no enclosed set of units is left without an owner
                    expect(cfEnclosed(g.grid, g.position)).to.deep.equal([]);
                }
            }
        });
    });
});
