import { HexTriGraph } from "../../common/graphs/hextri.js";
import type { BoardVariant } from "./types.js";

export interface ZertzBoardLayout {
    graph: HexTriGraph;
    minWidth: number;
    maxWidth: number;
    alternatingSymmetry: boolean;
    rotate: 90 | -90;
    reverseNumbers: boolean;
    reverseLetters: boolean;
}

export function boardVariantFromVariants(variants: string[]): BoardVariant {
    if (variants.includes("tournament")) {
        return "tournament";
    }
    if (variants.includes("oversize")) {
        return "oversize";
    }
    return "default";
}

export function blitzFromVariants(variants: string[]): boolean {
    return variants.includes("blitz");
}

export function assertValidVariants(variants: string[]): void {
    if (blitzFromVariants(variants) && boardVariantFromVariants(variants) !== "default") {
        throw new Error("Blitz may only be played on the default board.");
    }
}

export function layoutFor(variant: BoardVariant): ZertzBoardLayout {
    switch (variant) {
        case "default":
            return {
                graph: new HexTriGraph(4, 7, false, true),
                minWidth: 4,
                maxWidth: 7,
                alternatingSymmetry: false,
                rotate: 90,
                reverseNumbers: true,
                reverseLetters: false,
            };
        case "tournament": {
            // Letter reversal is render-only (`reverse-letters`); node ids are fixed at graph build time.
            const graph = new HexTriGraph(5, 8, true);
            return {
                graph,
                minWidth: 5,
                maxWidth: 8,
                alternatingSymmetry: true,
                rotate: -90,
                reverseNumbers: false,
                reverseLetters: true,
            };
        }
        case "oversize":
            return {
                graph: new HexTriGraph(5, 9, false, true),
                minWidth: 5,
                maxWidth: 9,
                alternatingSymmetry: false,
                rotate: 90,
                reverseNumbers: true,
                reverseLetters: false,
            };
    }
}

export function initialRingCells(layout: ZertzBoardLayout): Set<string> {
    const cells = layout.graph.listCells() as string[];
    return new Set(cells);
}