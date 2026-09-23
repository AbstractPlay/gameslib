/**
 * Lightvector notation for Arimaa: tokenizer, parser, and legacy dispatch.
 *
 * A move is a space-separated list of tokens `<specifier><property>`:
 *   specifier := piece | square | piece square      e.g. `E`, `d4`, `Ed4`
 *   property  := square | [nsew]+ | x               e.g. `e5`, `nn`, `x`
 * Upper-case pieces are Gold, lower-case Silver. Squares are algebraic from
 * Gold's side and directions are absolute (`n` is toward rank 8 for both).
 * A token asserts that some piece satisfying its specifier (at any point in
 * the turn) ends on the square, took those steps in that order, or was
 * captured. The move meant is found in the first (steps, displaced pieces)
 * bucket holding a satisfying turn, provided every satisfying turn there
 * reaches the same position.
 */

export type Piece = "E" | "M" | "H" | "D" | "C" | "R";
export type playerid = 1 | 2;
export type Dir = "n" | "s" | "e" | "w";

const pieceRe = /^[EMHDCRemhdcr]$/;
const squareRe = /^[a-h][1-8]$/;

export interface Specifier {
    piece?: Piece;
    owner?: playerid;
    square?: string;
}

export type Property =
    | { kind: "dest"; square: string }
    | { kind: "steps"; dirs: Dir[] }
    | { kind: "capture" };

export interface Token {
    spec: Specifier;
    prop: Property;
    text: string;
}

export interface ParsedMove {
    tokens: Token[];
    /** A trailing bare square: the selected piece awaiting a destination. Input only. */
    pending?: string;
    /** The selection before `pending`, kept while a second click on `pending` could complete an arrow from it. Input only. */
    previous?: string;
}

export class NotationError extends Error {
    public readonly token: string;
    constructor(token: string) {
        super(`Cannot parse token '${token}'`);
        this.name = "NotationError";
        this.token = token;
    }
}

export function isSquare(s: string): boolean {
    return squareRe.test(s);
}

/** Trim and collapse runs of whitespace to single spaces. */
export function normalize(m: string): string {
    return m.trim().replace(/\s+/g, " ");
}

export function tokenize(m: string): string[] {
    const n = normalize(m);
    return n.length === 0 ? [] : n.split(" ");
}

/**
 * The pre-Lightvector notation: comma-separated `<piece><from><to>` steps with
 * optional `(x<piece><trap>)` parentheticals, plus prefix-`x` capture tokens
 * (`xRc3`) written at the end of free setup. None of those characters can
 * appear in Lightvector notation, so their presence is the whole test.
 */
export function isLegacy(m: string): boolean {
    if (m.includes(",") || m.includes("(")) {
        return true;
    }
    return tokenize(m).some(t => t.startsWith("x"));
}

function pieceFrom(ch: string): Specifier {
    return { piece: ch.toUpperCase() as Piece, owner: ch === ch.toUpperCase() ? 1 : 2 };
}

export function parseSpecifier(s: string): Specifier | undefined {
    if (s.length === 1 && pieceRe.test(s)) {
        return pieceFrom(s);
    }
    if (s.length === 2 && squareRe.test(s)) {
        return { square: s };
    }
    if (s.length === 3 && pieceRe.test(s[0]) && squareRe.test(s.slice(1))) {
        return { ...pieceFrom(s[0]), square: s.slice(1) };
    }
    return undefined;
}

/**
 * Properties are self-delimiting, so one pass from the right splits a token:
 * a trailing `x` is a capture; a trailing digit ends a square; otherwise the
 * maximal trailing run of `[nsew]` is the step list, backing off one character
 * if that would leave no specifier (`ee` is the Silver elephant stepping east).
 */
export function parseToken(text: string): Token {
    if (text.length < 2) {
        throw new NotationError(text);
    }
    const last = text[text.length - 1];
    let specText: string;
    let prop: Property;
    if (last === "x") {
        prop = { kind: "capture" };
        specText = text.slice(0, -1);
    } else if (/[1-8]/.test(last)) {
        const square = text.slice(-2);
        if (!squareRe.test(square)) {
            throw new NotationError(text);
        }
        prop = { kind: "dest", square };
        specText = text.slice(0, -2);
    } else if (/[nsew]/.test(last)) {
        let i = text.length;
        while (i > 0 && /[nsew]/.test(text[i - 1])) {
            i--;
        }
        if (i === 0) {
            i = 1;
        }
        prop = { kind: "steps", dirs: text.slice(i).split("") as Dir[] };
        specText = text.slice(0, i);
    } else {
        throw new NotationError(text);
    }
    const spec = parseSpecifier(specText);
    if (spec === undefined) {
        throw new NotationError(text);
    }
    return { spec, prop, text };
}

/**
 * Parse a whole move. With `allowPending`, up to two final bare squares are
 * returned separately, as the pending selection and the selection before it,
 * instead of being rejected.
 */
export function parseMove(m: string, allowPending = false): ParsedMove {
    const parts = tokenize(m);
    let end = parts.length;
    let pending: string | undefined;
    let previous: string | undefined;
    if (allowPending && end > 0 && squareRe.test(parts[end - 1])) {
        pending = parts[end - 1];
        end--;
        if (end > 0 && squareRe.test(parts[end - 1])) {
            previous = parts[end - 1];
            end--;
        }
    }
    const tokens = parts.slice(0, end).map(parseToken);
    return { tokens, pending, previous };
}

export function pieceChar(piece: Piece, owner: playerid): string {
    return owner === 1 ? piece : piece.toLowerCase();
}

export function tokenText(t: Token): string {
    return t.text;
}

/** Rebuild a move string from tokens, keeping the selections last (the pending square at the very end). */
export function joinMove(tokens: Token[], pending?: string, previous?: string): string {
    const parts = tokens.map(tokenText);
    if (pending !== undefined) {
        if (previous !== undefined) {
            parts.push(previous);
        }
        parts.push(pending);
    }
    return parts.join(" ");
}

/** Build a destination token for `piece` on `from` ending on `to`. */
export function arrowToken(piece: Piece, owner: playerid, from: string, to: string): Token {
    const text = `${pieceChar(piece, owner)}${from}${to}`;
    return { spec: { piece, owner, square: from }, prop: { kind: "dest", square: to }, text };
}

/** A hold: `piece` on `square` ends the turn where it stands (a zero-length arrow). */
export function holdToken(piece: Piece, owner: playerid, square: string): Token {
    return arrowToken(piece, owner, square, square);
}

/** A destination token drawn from a piece's square to another square. */
export function isArrow(t: Token): boolean {
    return t.prop.kind === "dest" && t.spec.square !== undefined && t.spec.square !== t.prop.square;
}

/** A destination token that keeps a piece on its own square. */
export function isHold(t: Token): boolean {
    return t.prop.kind === "dest" && t.spec.square !== undefined && t.spec.square === t.prop.square;
}

/** A capture token for the piece on `square`: it is captured during the turn. */
export function captureToken(piece: Piece, owner: playerid, square: string): Token {
    return { spec: { piece, owner, square }, prop: { kind: "capture" }, text: `${pieceChar(piece, owner)}${square}x` };
}

/** A capture token naming a square: a mark on the piece standing there. */
export function isMark(t: Token): boolean {
    return t.prop.kind === "capture" && t.spec.square !== undefined;
}
