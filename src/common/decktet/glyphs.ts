import type { Glyph } from "@abstractplay/renderer/build/schemas/schema";

/** Disabled / unplayable decktet card: diagonal cross over the stack. */
export function disabledDecktetCardOverlay(): Glyph {
    return { name: "cross-diag", colour: "#000000", opacity: 0.5 };
}

export function withDisabledDecktetOverlay(glyph: [Glyph, ...Glyph[]]): [Glyph, ...Glyph[]] {
    glyph.push(disabledDecktetCardOverlay());
    return glyph;
}
