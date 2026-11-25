import type { Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";

export type playerid = 1 | 2;
export type MarbleColour = "W" | "G" | "B";

export const MARBLE_COLOURS: readonly MarbleColour[] = ["W", "G", "B"];

/** Default marble fills (AP theme palettes 1–3: red, blue, green). */
export const ZERTZ_MARBLE_W_FILL = "#e31a1c";
export const ZERTZ_MARBLE_G_FILL = "#1f78b4";
export const ZERTZ_MARBLE_B_FILL = "#33a02c";

export const ZERTZ_RING_FILL: Colourfuncs = {
    func: "custom",
    default: "_context_board",
    palette: 4,
};

export const ZERTZ_RING_BORDER: Colourfuncs = {
    func: "custom",
    default: "_context_strokes",
    palette: 5,
};

export const ZERTZ_MARBLE_WHITE: Colourfuncs = {
    func: "custom",
    default: ZERTZ_MARBLE_W_FILL,
    palette: 1,
};

export const ZERTZ_MARBLE_GREY: Colourfuncs = {
    func: "custom",
    default: ZERTZ_MARBLE_G_FILL,
    palette: 2,
};

export const ZERTZ_MARBLE_BLACK: Colourfuncs = {
    func: "custom",
    default: ZERTZ_MARBLE_B_FILL,
    palette: 3,
};

export function marblePaint(colour: MarbleColour): Colourfuncs {
    switch (colour) {
        case "W":
            return ZERTZ_MARBLE_WHITE;
        case "G":
            return ZERTZ_MARBLE_GREY;
        case "B":
            return ZERTZ_MARBLE_BLACK;
    }
}

export type MarbleCounts = Record<MarbleColour, number>;

export function emptyMarbleCounts(): MarbleCounts {
    return { W: 0, G: 0, B: 0 };
}

export function poolEmpty(pool: MarbleCounts): boolean {
    return pool.W + pool.G + pool.B === 0;
}

export function standardPool(blitz: boolean): MarbleCounts {
    if (blitz) {
        return { W: 5, G: 7, B: 9 };
    }
    return { W: 6, G: 8, B: 10 };
}

export type BoardVariant = "default" | "tournament" | "oversize";