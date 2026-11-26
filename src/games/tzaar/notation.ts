import type { PieceKind } from "./types.js";
import { KIND_SUFFIX, SUFFIX_KIND } from "./types.js";

export interface PlayLeg {
    from: string;
    to: string;
}

export function parsePlayLeg(segment: string): PlayLeg | undefined {
    if (segment === "pass" || !segment.includes("-")) {
        return undefined;
    }
    const [from, to] = segment.split("-") as [string, string];
    if (from === undefined || to === undefined || to.length === 0) {
        return undefined;
    }
    return { from: from.toLowerCase(), to: to.toLowerCase() };
}

export function formatPlayLeg(leg: PlayLeg): string {
    return `${leg.from}-${leg.to}`;
}

export type ParsedPlayMove =
    | { first: PlayLeg; second?: PlayLeg | "pass" }
    | { partial: string; first?: PlayLeg };

export function parsePlayMove(m: string): ParsedPlayMove | undefined {
    const parts = m.split(",").filter((p) => p.length > 0);
    if (parts.length === 0) {
        return undefined;
    }
    const first = parsePlayLeg(parts[0]!);
    if (first === undefined) {
        if (parts[0]!.includes("-")) {
            return { partial: parts[0]!.toLowerCase() };
        }
        return undefined;
    }
    if (parts.length === 1) {
        return { first };
    }
    if (parts[1] === "pass") {
        return { first, second: "pass" };
    }
    const second = parsePlayLeg(parts[1]!);
    if (second === undefined) {
        if (/^[a-z]+\d+-$/i.test(parts[1]!)) {
            return { first, partial: parts[1]!.toLowerCase() };
        }
        return undefined;
    }
    return { first, second };
}

export function parseSetupPlace(m: string): { cell: string; kind?: PieceKind } | undefined {
    if (m.startsWith("!")) {
        const cell = m.slice(1).toLowerCase();
        return { cell };
    }
    const match = /^([a-z]+\d+)([trz])?$/i.exec(m);
    if (match === null) {
        return undefined;
    }
    const cell = match[1]!.toLowerCase();
    const suffix = match[2]?.toLowerCase();
    const kind = suffix === undefined ? undefined : SUFFIX_KIND[suffix];
    return { cell, kind };
}

export function formatSetupPlace(cell: string, kind: PieceKind): string {
    return `${cell}${KIND_SUFFIX[kind]}`;
}

export function nextSetupKind(current: PieceKind | undefined): PieceKind | undefined {
    if (current === undefined) {
        return "tott";
    }
    if (current === "tott") {
        return "tzarra";
    }
    if (current === "tzarra") {
        return "tzaar";
    }
    return undefined;
}