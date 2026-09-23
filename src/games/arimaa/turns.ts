/**
 * Turn enumeration, Lightvector-notation resolution, and canonical
 * serialization for Arimaa.
 *
 * Squares are indexed `rank * 8 + file` with rank 0 being rank "1", so `n` is
 * +8, `s` is -8, `e` is +1 and `w` is -1.
 */
import { arrowToken, captureToken, pieceChar, tokenText, type Dir, type Piece, type playerid, type Token } from "./notation.js";

export type CellContents = [Piece, playerid];

export function sqIndex(cell: string): number {
    return (cell.charCodeAt(1) - 49) * 8 + (cell.charCodeAt(0) - 97);
}

export function sqName(i: number): string {
    return String.fromCharCode(97 + (i % 8)) + String(Math.floor(i / 8) + 1);
}

const DIRS: ReadonlyArray<[Dir, number]> = [["n", 8], ["s", -8], ["e", 1], ["w", -1]];

function stepTo(i: number, d: number): number {
    const f = i % 8;
    const r = (i - f) / 8;
    switch (d) {
        case 8: return r < 7 ? i + 8 : -1;
        case -8: return r > 0 ? i - 8 : -1;
        case 1: return f < 7 ? i + 1 : -1;
        default: return f > 0 ? i - 1 : -1;
    }
}

const NEIGHBOURS: number[][] = [];
for (let i = 0; i < 64; i++) {
    const ns: number[] = [];
    for (const [, d] of DIRS) {
        const j = stepTo(i, d);
        if (j >= 0) {
            ns.push(j);
        }
    }
    NEIGHBOURS.push(ns);
}

export const TRAPS: number[] = ["c3", "f3", "c6", "f6"].map(sqIndex);

export function manhattan(a: number, b: number): number {
    return Math.abs((a % 8) - (b % 8)) + Math.abs(Math.floor(a / 8) - Math.floor(b / 8));
}

/** `DIST[a * 64 + b]` is the manhattan distance between squares `a` and `b`. */
const DIST = new Int8Array(64 * 64);
for (let a = 0; a < 64; a++) {
    for (let b = 0; b < 64; b++) {
        DIST[a * 64 + b] = manhattan(a, b);
    }
}

function dirBetween(from: number, to: number): Dir {
    const d = to - from;
    return d === 8 ? "n" : d === -8 ? "s" : d === 1 ? "e" : "w";
}

const STRENGTH: Record<Piece, number> = { R: 1, C: 2, D: 3, H: 4, M: 5, E: 6 };

interface PieceState {
    id: number;
    type: Piece;
    owner: playerid;
    strength: number;
    start: number;
    /** current square, or -1 once captured */
    cur: number;
    /** the trap it was captured on, or -1 */
    capturedAt: number;
    /** trajectory: start square, then every square stepped to (including a trap it died on) */
    visited: number[];
}

export interface TurnStep {
    pid: number;
    piece: Piece;
    owner: playerid;
    from: number;
    to: number;
    dir: Dir;
}

export interface CaptureRec {
    pid: number;
    piece: Piece;
    owner: playerid;
    square: number;
    /** index of the step after which the capture happened */
    afterStep: number;
}

export interface Trajectory {
    type: Piece;
    owner: playerid;
    start: number;
    /** final square: where it ends the turn, or the trap it was captured on */
    final: number;
    captured: boolean;
    visited: number[];
    /** index of the piece's first step, or of the step that captured it in place */
    firstStep: number;
}

export interface Turn {
    steps: TurnStep[];
    captures: CaptureRec[];
    /** every piece that moved or was captured */
    trajectories: Trajectory[];
    /** pieces of either colour whose final square is not their start square */
    displaced: number;
    signature: string;
    ownCaptured: number;
    enemyCaptured: number;
}

interface Undo {
    st: TurnStep;
    caps: Array<{ pid: number; square: number; code: number }>;
}

class Search {
    public readonly cells = new Int8Array(64);
    public readonly ids = new Int16Array(64).fill(-1);
    public readonly pieces: PieceState[] = [];
    public readonly steps: TurnStep[] = [];
    public readonly captures: CaptureRec[] = [];
    public readonly startSig: string;

    constructor(board: Map<string, CellContents>, public readonly player: playerid) {
        const cells = [...board.entries()].map(([cell, [type, owner]]) => ({ i: sqIndex(cell), type, owner })).sort((a, b) => a.i - b.i);
        for (const { i, type, owner } of cells) {
            const id = this.pieces.length;
            this.pieces.push({ id, type, owner, strength: STRENGTH[type], start: i, cur: i, capturedAt: -1, visited: [i] });
            this.cells[i] = owner === 1 ? STRENGTH[type] : -STRENGTH[type];
            this.ids[i] = id;
        }
        this.startSig = this.signature();
    }

    public signature(): string {
        let s = "";
        for (let i = 0; i < 64; i++) {
            const c = this.cells[i];
            if (c === 0) {
                s += "-";
            } else {
                s += pieceChar(this.pieces[this.ids[i]].type, c > 0 ? 1 : 2);
            }
        }
        return s;
    }

    private hasFriend(i: number, gold: boolean): boolean {
        for (const n of NEIGHBOURS[i]) {
            const c = this.cells[n];
            if (c !== 0 && (c > 0) === gold) {
                return true;
            }
        }
        return false;
    }

    public frozen(i: number): boolean {
        const c = this.cells[i];
        const gold = c > 0;
        let stronger = false;
        for (const n of NEIGHBOURS[i]) {
            const cn = this.cells[n];
            if (cn === 0) {
                continue;
            }
            if ((cn > 0) === gold) {
                return false;
            }
            if (Math.abs(cn) > Math.abs(c)) {
                stronger = true;
            }
        }
        return stronger;
    }

    /**
     * Every legal atom from the current position: a single step by one of the
     * mover's pieces, a push (enemy steps away, pusher follows into its square)
     * or a pull (puller steps away, enemy follows into its square). Legality
     * matches the step-by-step validator exactly.
     */
    public atoms(remaining: number): TurnStep[][] {
        const out: TurnStep[][] = [];
        const gold = this.player === 1;
        for (const p of this.pieces) {
            if (p.owner !== this.player || p.cur < 0) {
                continue;
            }
            const i = p.cur;
            if (this.frozen(i)) {
                continue;
            }
            const backward = p.type === "R" ? (gold ? -8 : 8) : 0;
            for (const [dir, d] of DIRS) {
                if (d === backward) {
                    continue;
                }
                const j = stepTo(i, d);
                if (j < 0) {
                    continue;
                }
                const c = this.cells[j];
                const own: TurnStep = { pid: p.id, piece: p.type, owner: p.owner, from: i, to: j, dir };
                if (c === 0) {
                    out.push([own]);
                    if (remaining >= 2) {
                        for (const n of NEIGHBOURS[i]) {
                            const q = this.ids[n];
                            if (q < 0) {
                                continue;
                            }
                            const qp = this.pieces[q];
                            if (qp.owner === this.player || qp.strength >= p.strength) {
                                continue;
                            }
                            out.push([own, { pid: q, piece: qp.type, owner: qp.owner, from: n, to: i, dir: dirBetween(n, i) }]);
                        }
                    }
                } else if (remaining >= 2 && (c > 0) !== gold && Math.abs(c) < p.strength) {
                    const q = this.ids[j];
                    const qp = this.pieces[q];
                    for (const [dir2, d2] of DIRS) {
                        const t = stepTo(j, d2);
                        if (t < 0 || this.cells[t] !== 0) {
                            continue;
                        }
                        out.push([{ pid: q, piece: qp.type, owner: qp.owner, from: j, to: t, dir: dir2 }, own]);
                    }
                }
            }
        }
        return out;
    }

    public apply(st: TurnStep): Undo {
        const p = this.pieces[st.pid];
        this.cells[st.to] = this.cells[st.from];
        this.cells[st.from] = 0;
        this.ids[st.to] = st.pid;
        this.ids[st.from] = -1;
        p.cur = st.to;
        p.visited.push(st.to);
        this.steps.push(st);
        const undo: Undo = { st, caps: [] };
        for (const t of TRAPS) {
            const c = this.cells[t];
            if (c === 0 || this.hasFriend(t, c > 0)) {
                continue;
            }
            const q = this.ids[t];
            const qp = this.pieces[q];
            this.cells[t] = 0;
            this.ids[t] = -1;
            qp.cur = -1;
            qp.capturedAt = t;
            this.captures.push({ pid: q, piece: qp.type, owner: qp.owner, square: t, afterStep: this.steps.length - 1 });
            undo.caps.push({ pid: q, square: t, code: c });
        }
        return undo;
    }

    public undo(u: Undo): void {
        for (let k = u.caps.length - 1; k >= 0; k--) {
            const { pid, square, code } = u.caps[k];
            this.cells[square] = code;
            this.ids[square] = pid;
            this.pieces[pid].cur = square;
            this.pieces[pid].capturedAt = -1;
            this.captures.pop();
        }
        const p = this.pieces[u.st.pid];
        this.cells[u.st.from] = this.cells[u.st.to];
        this.cells[u.st.to] = 0;
        this.ids[u.st.from] = u.st.pid;
        this.ids[u.st.to] = -1;
        p.cur = u.st.from;
        p.visited.pop();
        this.steps.pop();
    }

    // Net displacement: pieces whose final square, the trap for a captured
    // one, is not their start square. A round trip does not count, nor does
    // a capture in place, nor a piece that steps out and dies back home.
    public displaced(): number {
        let n = 0;
        for (const p of this.pieces) {
            if (p.visited.length > 1 && (p.cur < 0 ? p.capturedAt : p.cur) !== p.start) {
                n++;
            }
        }
        return n;
    }

    public snapshot(displaced: number, signature: string): Turn {
        const trajectories: Trajectory[] = [];
        let ownCaptured = 0;
        let enemyCaptured = 0;
        for (const p of this.pieces) {
            const captured = p.cur < 0;
            if (p.visited.length === 1 && !captured) {
                continue;
            }
            let firstStep = this.steps.findIndex(s => s.pid === p.id);
            if (firstStep < 0) {
                firstStep = this.captures.find(c => c.pid === p.id)!.afterStep;
            }
            trajectories.push({ type: p.type, owner: p.owner, start: p.start, final: captured ? p.capturedAt : p.cur, captured, visited: [...p.visited], firstStep });
            if (captured) {
                if (p.owner === this.player) {
                    ownCaptured++;
                } else {
                    enemyCaptured++;
                }
            }
        }
        trajectories.sort((a, b) => a.firstStep - b.firstStep);
        return { steps: this.steps.map(s => ({ ...s })), captures: this.captures.map(c => ({ ...c })), trajectories, displaced, signature, ownCaptured, enemyCaptured };
    }
}

// ---------------------------------------------------------------------------
// Resolution

interface PTok {
    type?: Piece;
    owner?: playerid;
    /** specifier square index, or -1 */
    sq: number;
    kind: "dest" | "steps" | "capture";
    dest: number;
    dirs: Dir[];
}

function prepare(tokens: Token[]): PTok[] {
    return tokens.map(t => ({
        type: t.spec.piece,
        owner: t.spec.owner,
        sq: t.spec.square === undefined ? -1 : sqIndex(t.spec.square),
        kind: t.prop.kind,
        dest: t.prop.kind === "dest" ? sqIndex(t.prop.square) : -1,
        dirs: t.prop.kind === "steps" ? t.prop.dirs : [],
    }));
}

export type Resolution =
    | { status: "unsatisfiable" }
    | { status: "ambiguous"; bucket: [number, number]; positions: number; candidates: Turn[] }
    | { status: "resolved"; bucket: [number, number]; turn: Turn; positions: number; lenient: boolean };

/**
 * Find the move a token list denotes from `board` with `player` to move.
 * Strict resolution is the notation's meaning; lenient resolution breaks a
 * tie in the first bucket by fewest own captures, then most enemy captures.
 * `prune` disables the search heuristic; it exists so tests can check that
 * pruning never changes an answer.
 */
export function resolve(board: Map<string, CellContents>, player: playerid, maxSteps: number, tokens: Token[], lenient: boolean, prune = true): Resolution {
    const s = new Search(board, player);
    const toks = prepare(tokens);
    const destGroups = new Map<number, PTok[]>();
    const captureToks: PTok[] = [];
    const stepToks: PTok[] = [];
    for (const t of toks) {
        if (t.kind === "dest") {
            const g = destGroups.get(t.dest);
            if (g === undefined) {
                destGroups.set(t.dest, [t]);
            } else {
                g.push(t);
            }
        } else if (t.kind === "capture") {
            captureToks.push(t);
        } else {
            stepToks.push(t);
        }
    }

    const typeMatch = (p: PieceState, t: PTok): boolean => t.type === undefined || (p.type === t.type && p.owner === t.owner);
    const visitedOk = (p: PieceState, t: PTok): boolean => t.sq < 0 || p.visited.includes(t.sq);
    const finalOf = (p: PieceState): number => p.cur < 0 ? p.capturedAt : p.cur;

    // Longest prefix of a step token some piece has taken so far, ignoring the
    // ordering between tokens (a lower bound on what remains).
    const bestPrefix = (t: PTok): number => {
        let best = 0;
        for (const p of s.pieces) {
            if (!typeMatch(p, t)) {
                continue;
            }
            let j = 0;
            for (const st of s.steps) {
                if (st.pid !== p.id) {
                    continue;
                }
                if (j === 0 && t.sq >= 0 && st.from !== t.sq) {
                    continue;
                }
                if (st.dir === t.dirs[j]) {
                    j++;
                    if (j === t.dirs.length) {
                        break;
                    }
                }
            }
            if (j > best) {
                best = j;
            }
        }
        return best;
    };

    // Pieces a token could be witnessed by, and for a destination group the
    // pieces every token of it accepts; fixed for the whole search.
    const cands = new Map<PTok, PieceState[]>();
    for (const t of toks) {
        cands.set(t, s.pieces.filter(p => typeMatch(p, t)));
    }
    const groupCands = new Map<number, PieceState[]>();
    for (const [dest, group] of destGroups) {
        groupCands.set(dest, s.pieces.filter(p => group.every(t => typeMatch(p, t))));
    }

    // Steps before some own piece stronger than `e` is adjacent to it (the
    // precondition for pushing or pulling it); Infinity if there is none.
    // Cached for the duration of one heuristic evaluation.
    const approachStamp = new Int32Array(s.pieces.length);
    const approachValue = new Float64Array(s.pieces.length);
    let stamp = 0;
    const approach = (e: PieceState): number => {
        if (approachStamp[e.id] === stamp) {
            return approachValue[e.id];
        }
        let best = Infinity;
        for (const q of s.pieces) {
            if (q.owner !== s.player || q.cur < 0 || q.strength <= e.strength) {
                continue;
            }
            const d = Math.max(0, DIST[q.cur * 64 + e.cur] - 1);
            if (d < best) {
                best = d;
            }
        }
        approachStamp[e.id] = stamp;
        approachValue[e.id] = best;
        return best;
    };

    const rank = (i: number): number => i >> 3;
    // The mover's rabbits never step backward, and nothing else moves them
    // during the turn, so a square behind one is out of its reach for good.
    const behind = (from: number, to: number): boolean => s.player === 1 ? rank(to) < rank(from) : rank(to) > rank(from);
    const ownRabbit = (p: PieceState): boolean => p.type === "R" && p.owner === s.player;
    const backwardDir: Dir = s.player === 1 ? "s" : "n";
    // Squares `p` must still cover to satisfy a token: to the specifier's
    // square first if it has not been there, then to the target.
    const squaresTo = (p: PieceState, t: PTok, target: number): number => {
        if (t.sq >= 0 && !p.visited.includes(t.sq)) {
            if (ownRabbit(p) && (behind(p.cur, t.sq) || behind(t.sq, target))) {
                return Infinity;
            }
            return DIST[p.cur * 64 + t.sq] + DIST[t.sq * 64 + target];
        }
        if (ownRabbit(p) && behind(p.cur, target)) {
            return Infinity;
        }
        return DIST[p.cur * 64 + target];
    };

    // The full price of an own piece covering `d` squares: a frozen piece
    // cannot step until another piece has, and that step is none of its own.
    const ownPrice = (p: PieceState, d: number): number => {
        if (d === 0 || d === Infinity) {
            return d;
        }
        return s.frozen(p.cur) ? d + 1 : d;
    };

    // The full price of moving an enemy piece `d` squares: two steps a square
    // plus getting a stronger piece next to it. Sound on its own, but not when
    // added to other witnesses' costs, since the partner's steps may be theirs.
    const enemyPrice = (p: PieceState, d: number): number => {
        if (d === 0) {
            return 0;
        }
        const a = approach(p);
        return a === Infinity ? Infinity : 2 * d + a;
    };
    // What a full price is at least, before the partner and release steps are
    // priced: enough to skip a witness that cannot beat the best so far.
    const atLeast = (p: PieceState, d: number): number => p.owner === s.player ? d : 2 * d;

    // An admissible lower bound on the steps still needed, or any value above
    // `limit` as soon as the bound is known to exceed it. Two bounds are
    // combined by max: (1) one step per square for every witness, summed over
    // distinct destinations, which need distinct witnesses; (2) per token, the
    // full price of its cheapest witness, including an enemy's partner and
    // approach steps, a frozen piece's release, and clearing the destination.
    const heuristic = (limit: number): number => {
        stamp++;
        let sum = 0;
        let max = 0;
        for (const [dest, group] of destGroups) {
            let groupCost = 0;
            let groupFull = 0;
            if (TRAPS.includes(dest)) {
                // several pieces can end on a trap (captured on it, then another
                // arrives), so each token finds its own witness
                for (const t of group) {
                    let best = Infinity;
                    let bestFull = Infinity;
                    for (const p of cands.get(t)!) {
                        let c: number;
                        if (p.cur < 0) {
                            c = p.capturedAt === dest && visitedOk(p, t) ? 0 : Infinity;
                            if (c < best) {
                                best = c;
                            }
                            if (c < bestFull) {
                                bestFull = c;
                            }
                            continue;
                        }
                        c = squaresTo(p, t, dest);
                        if (c < best) {
                            best = c;
                        }
                        if (atLeast(p, c) < bestFull) {
                            const full = p.owner === s.player ? ownPrice(p, c) : enemyPrice(p, c);
                            if (full < bestFull) {
                                bestFull = full;
                            }
                        }
                    }
                    if (best === Infinity || bestFull === Infinity) {
                        return Infinity;
                    }
                    if (best > groupCost) {
                        groupCost = best;
                    }
                    if (bestFull > groupFull) {
                        groupFull = bestFull;
                    }
                }
            } else {
                // only one piece can stand on the square at the end, so a single
                // witness has to satisfy every token of the group
                groupCost = Infinity;
                groupFull = Infinity;
                const occupant = s.ids[dest];
                let occCost = Infinity;
                let occFull = Infinity;
                let others = Infinity;
                for (const p of groupCands.get(dest)!) {
                    if (p.cur < 0) {
                        continue;
                    }
                    let c = 0;
                    for (const t of group) {
                        const d = squaresTo(p, t, dest);
                        if (d > c) {
                            c = d;
                        }
                    }
                    if (c < groupCost) {
                        groupCost = c;
                    }
                    if (p.id === occupant) {
                        occCost = c;
                        occFull = p.owner === s.player ? ownPrice(p, c) : enemyPrice(p, c);
                        if (occFull < groupFull) {
                            groupFull = occFull;
                        }
                        continue;
                    }
                    if (c < others) {
                        others = c;
                    }
                    if (atLeast(p, c) < groupFull) {
                        const full = p.owner === s.player ? ownPrice(p, c) : enemyPrice(p, c);
                        if (full < groupFull) {
                            groupFull = full;
                        }
                    }
                }
                if (groupCost === Infinity || groupFull === Infinity) {
                    return Infinity;
                }
                // whatever stands on the destination and does not already satisfy
                // the group either becomes its witness by leaving and returning or
                // has to make way: an enemy by being pushed or pulled, an own
                // piece by a step of its own that is none of the witness's
                if (occupant >= 0 && occCost !== 0) {
                    const x = s.pieces[occupant];
                    const clear = x.owner !== s.player ? enemyPrice(x, 1) : Math.min(occFull, others + 1);
                    if (clear === Infinity) {
                        return Infinity;
                    }
                    if (clear > groupFull) {
                        groupFull = clear;
                    }
                }
            }
            sum += groupCost;
            if (groupFull > max) {
                max = groupFull;
            }
            if (sum > limit || max > limit) {
                return Math.max(sum, max);
            }
        }
        for (const t of captureToks) {
            let bestFull = Infinity;
            for (const p of cands.get(t)!) {
                if (p.cur < 0) {
                    if (visitedOk(p, t)) {
                        bestFull = 0;
                        break;
                    }
                    continue;
                }
                // it dies on some trap: after getting there, and once every
                // neighbour of the trap of its colour has gone. Own
                // neighbours step away; enemy ones are pushed or pulled,
                // two dedicated steps each, after a first approach.
                for (const trap of TRAPS) {
                    const d = squaresTo(p, t, trap);
                    if (d === Infinity || atLeast(p, d) >= bestFull) {
                        continue;
                    }
                    let friends = 0;
                    let nearest = Infinity;
                    for (const n of NEIGHBOURS[trap]) {
                        const q = s.ids[n];
                        if (q < 0 || q === p.id || s.pieces[q].owner !== p.owner) {
                            continue;
                        }
                        friends++;
                        if (p.owner !== s.player) {
                            const a = approach(s.pieces[q]);
                            if (a < nearest) {
                                nearest = a;
                            }
                        }
                    }
                    let cost: number;
                    if (p.owner === s.player) {
                        cost = Math.max(ownPrice(p, d), d + friends);
                    } else if (friends === 0) {
                        cost = enemyPrice(p, d);
                    } else if (nearest === Infinity) {
                        continue;
                    } else {
                        cost = Math.max(enemyPrice(p, d), 2 * (d + friends), 2 * friends + nearest);
                    }
                    if (cost < bestFull) {
                        bestFull = cost;
                    }
                }
            }
            if (bestFull === Infinity) {
                return Infinity;
            }
            if (bestFull > max) {
                max = bestFull;
            }
            if (max > limit) {
                return max;
            }
        }
        for (const t of stepToks) {
            if (t.type === "R" && t.owner === s.player && t.dirs.includes(backwardDir)) {
                return Infinity;
            }
            const left = t.dirs.length - bestPrefix(t);
            if (left > max) {
                max = left;
            }
        }
        return Math.max(sum, max);
    };

    const satisfies = (): boolean => {
        for (const group of destGroups.values()) {
            for (const t of group) {
                if (!s.pieces.some(p => typeMatch(p, t) && visitedOk(p, t) && finalOf(p) === t.dest)) {
                    return false;
                }
            }
        }
        for (const t of captureToks) {
            if (!s.pieces.some(p => typeMatch(p, t) && visitedOk(p, t) && p.cur < 0)) {
                return false;
            }
        }
        // step tokens must be witnessed in the order written; the earliest
        // completion of each leaves the most room for the next
        let after = -1;
        for (const t of stepToks) {
            let bestEnd = Infinity;
            for (const p of s.pieces) {
                if (!typeMatch(p, t)) {
                    continue;
                }
                let j = 0;
                let end = -1;
                for (let i = after + 1; i < s.steps.length; i++) {
                    const st = s.steps[i];
                    if (st.pid !== p.id) {
                        continue;
                    }
                    if (j === 0 && t.sq >= 0 && st.from !== t.sq) {
                        continue;
                    }
                    if (st.dir === t.dirs[j]) {
                        j++;
                        end = i;
                        if (j === t.dirs.length) {
                            break;
                        }
                    }
                }
                if (j === t.dirs.length && end < bestEnd) {
                    bestEnd = end;
                }
            }
            if (bestEnd === Infinity) {
                return false;
            }
            after = bestEnd;
        }
        return true;
    };

    // Everything the search asks of a state, except the order of the steps
    // that led to it, is in the board and each moved piece's visited squares.
    // Step tokens are the exception, so the memo is off while any is present.
    const stateKey = (): string => {
        let key = s.signature();
        for (const p of s.pieces) {
            if (p.visited.length > 1 || p.cur < 0) {
                key += `|${p.id}:${p.cur < 0 ? p.capturedAt : ""}:${[...p.visited].sort((a, b) => a - b).join(",")}`;
            }
        }
        return key;
    };
    const memo = stepToks.length === 0;

    for (let k = 1; k <= maxSteps; k++) {
        const found = new Map<string, Turn>();
        // States already searched with at least as many steps left. Every
        // shallower iteration came up empty, so reaching a state again with
        // fewer steps left can only lead to ends found there or ends that
        // would have satisfied a shallower iteration.
        const seen = new Map<string, number>();
        const dfs = (remaining: number): void => {
            if (remaining === 0) {
                const sig = s.signature();
                if (sig === s.startSig || !satisfies()) {
                    return;
                }
                const displaced = s.displaced();
                const existing = found.get(sig);
                if (existing === undefined || displaced < existing.displaced) {
                    found.set(sig, s.snapshot(displaced, sig));
                }
                return;
            }
            if (prune && heuristic(remaining) > remaining) {
                return;
            }
            if (prune && memo && remaining < k) {
                const key = stateKey();
                const best = seen.get(key);
                if (best !== undefined && best >= remaining) {
                    return;
                }
                seen.set(key, remaining);
            }
            for (const atom of s.atoms(remaining)) {
                if (atom.length > remaining) {
                    continue;
                }
                const undos: Undo[] = [];
                for (const st of atom) {
                    undos.push(s.apply(st));
                }
                dfs(remaining - atom.length);
                while (undos.length > 0) {
                    s.undo(undos.pop()!);
                }
            }
        };
        dfs(k);
        if (found.size === 0) {
            continue;
        }
        let minDisplaced = Infinity;
        for (const t of found.values()) {
            if (t.displaced < minDisplaced) {
                minDisplaced = t.displaced;
            }
        }
        const candidates = [...found.values()].filter(t => t.displaced === minDisplaced);
        const bucket: [number, number] = [k, minDisplaced];
        if (candidates.length === 1) {
            return { status: "resolved", bucket, turn: candidates[0], positions: 1, lenient: false };
        }
        if (lenient) {
            const score = (t: Turn): number => t.ownCaptured * 100 - t.enemyCaptured;
            let best = candidates[0];
            let tie = false;
            for (const t of candidates.slice(1)) {
                if (score(t) < score(best)) {
                    best = t;
                    tie = false;
                } else if (score(t) === score(best)) {
                    tie = true;
                }
            }
            if (!tie) {
                return { status: "resolved", bucket, turn: best, positions: candidates.length, lenient: true };
            }
        }
        return { status: "ambiguous", bucket, positions: candidates.length, candidates };
    }
    return { status: "unsatisfiable" };
}

/** Whether the player to move has any legal step, push or pull. */
export function hasAnyMove(board: Map<string, CellContents>, player: playerid): boolean {
    return new Search(board, player).atoms(2).length > 0;
}

/** Replay an explicit step list (no legality checks) and describe the turn. */
export function turnFromSteps(board: Map<string, CellContents>, player: playerid, steps: Array<{ from: string; to: string }>): Turn {
    const s = new Search(board, player);
    for (const { from, to } of steps) {
        const f = sqIndex(from);
        const t = sqIndex(to);
        const pid = s.ids[f];
        if (pid < 0) {
            throw new Error(`No piece on ${from} to move.`);
        }
        const p = s.pieces[pid];
        s.apply({ pid, piece: p.type, owner: p.owner, from: f, to: t, dir: dirBetween(f, t) });
    }
    return s.snapshot(s.displaced(), s.signature());
}

/** The displaced pieces of `turn` that no token's specifier could refer to. */
export function inferred(turn: Turn, tokens: Token[]): Trajectory[] {
    const named = (tr: Trajectory): boolean => tokens.some(t =>
        (t.spec.piece === undefined || (t.spec.piece === tr.type && t.spec.owner === tr.owner)) &&
        (t.spec.square === undefined || tr.visited.includes(sqIndex(t.spec.square))));
    return turn.trajectories.filter(tr => tr.final !== tr.start && !named(tr));
}

// ---------------------------------------------------------------------------
// Serialization

function stepToken(st: TurnStep): Token {
    const from = sqName(st.from);
    return { spec: { piece: st.piece, owner: st.owner, square: from }, prop: { kind: "steps", dirs: [st.dir] }, text: `${pieceChar(st.piece, st.owner)}${from}${st.dir}` };
}

function bareToken(t: Token): Token {
    const piece = pieceChar(t.spec.piece!, t.spec.owner!);
    let text: string;
    if (t.prop.kind === "dest") {
        text = `${piece}${t.prop.square}`;
    } else if (t.prop.kind === "capture") {
        text = `${piece}x`;
    } else {
        text = `${piece}${t.prop.dirs.join("")}`;
    }
    return { spec: { piece: t.spec.piece, owner: t.spec.owner }, prop: t.prop, text };
}

/** Fewest steps for the mover's piece on `from` to reach `to`, charging 2 to enter a square occupied at the start of the turn. */
function ownReach(cells: Int8Array, from: number, to: number): number {
    const dist = new Array<number>(64).fill(Infinity);
    dist[from] = 0;
    const done = new Array<boolean>(64).fill(false);
    for (;;) {
        let u = -1;
        for (let i = 0; i < 64; i++) {
            if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) {
                u = i;
            }
        }
        if (u < 0 || u === to) {
            break;
        }
        done[u] = true;
        for (const n of NEIGHBOURS[u]) {
            const w = cells[n] === 0 ? 1 : 2;
            if (dist[u] + w < dist[n]) {
                dist[n] = dist[u] + w;
            }
        }
    }
    return dist[to];
}

/**
 * Write `turn` in Lightvector notation: one destination token per displaced
 * survivor, one capture token per captured piece (its origin if it moved),
 * nothing for pieces that return home; discriminated (a returning piece's
 * intermediate square, then holds on pieces the strict reading would move,
 * then step tokens) until it resolves strictly to the turn's position; then
 * specifiers simplified to the bare
 * piece wherever the resolver confirms the square is redundant. Returns
 * nothing for a turn no legal step sequence reaches, which the resolver can
 * never denote (the legacy validator accepts a few such moves).
 */
export function serializeTurn(board: Map<string, CellContents>, player: playerid, maxSteps: number, turn: Turn): string | undefined {
    let tokens: Token[] = [];
    for (const tr of turn.trajectories) {
        if (tr.captured) {
            tokens.push(captureToken(tr.type, tr.owner, sqName(tr.visited.length > 1 ? tr.start : tr.final)));
        } else if (tr.final !== tr.start) {
            tokens.push(arrowToken(tr.type, tr.owner, sqName(tr.start), sqName(tr.final)));
        }
    }
    const ok = (toks: Token[]): boolean => {
        const r = resolve(board, player, maxSteps, toks, false);
        return r.status === "resolved" && r.turn.signature === turn.signature;
    };
    const explicit = tokens.length;
    let resolved = ok(tokens);
    if (!resolved) {
        for (const tr of turn.trajectories) {
            if (!tr.captured && tr.final === tr.start && tr.visited.length > 1) {
                tokens.push(arrowToken(tr.type, tr.owner, sqName(tr.visited[1]), sqName(tr.start)));
                if (ok(tokens)) {
                    resolved = true;
                    break;
                }
            }
        }
    }
    if (!resolved) {
        // hold the pieces the strict reading moves or captures that this turn leaves alone
        const r = resolve(board, player, maxSteps, tokens, false);
        if (r.status !== "unsatisfiable") {
            const touched = new Set(turn.trajectories.filter(tr => tr.captured || tr.final !== tr.start).map(tr => tr.start));
            const held = new Set<number>();
            for (const other of r.status === "resolved" ? [r.turn] : r.candidates) {
                for (const tr of other.trajectories) {
                    if ((tr.captured || tr.final !== tr.start) && !touched.has(tr.start) && !held.has(tr.start)) {
                        held.add(tr.start);
                        tokens.push(arrowToken(tr.type, tr.owner, sqName(tr.start), sqName(tr.start)));
                        if (ok(tokens)) {
                            resolved = true;
                            break;
                        }
                    }
                }
                if (resolved) {
                    break;
                }
            }
        }
    }
    if (!resolved) {
        for (const st of turn.steps) {
            tokens.push(stepToken(st));
            if (ok(tokens)) {
                resolved = true;
                break;
            }
        }
    }
    if (!resolved) {
        return undefined;
    }
    // a discriminator added before the decisive one may have done nothing
    for (let i = tokens.length - 1; i >= explicit; i--) {
        const trial = tokens.filter((_, j) => j !== i);
        if (ok(trial)) {
            tokens = trial;
        }
    }

    // simplification candidates: the piece type is unique on the board, or
    // only one piece of that type could reach the token's target this turn
    const s = new Search(board, player);
    const budget = maxSteps;
    const candidate = (t: Token): boolean => {
        const same = s.pieces.filter(p => p.type === t.spec.piece && p.owner === t.spec.owner);
        if (same.length === 1) {
            return true;
        }
        let targets: number[];
        if (t.prop.kind === "dest") {
            targets = [sqIndex(t.prop.square)];
        } else if (t.prop.kind === "capture") {
            targets = TRAPS;
        } else {
            return false;
        }
        const reachable = same.filter(p => targets.some(target => {
            if (p.owner === player) {
                return ownReach(s.cells, p.start, target) <= budget;
            }
            return manhattan(p.start, target) <= Math.floor(budget / 2);
        }));
        return reachable.length === 1;
    };
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.spec.piece === undefined || t.spec.square === undefined || !candidate(t)) {
            continue;
        }
        const trial = tokens.slice();
        trial[i] = bareToken(t);
        if (ok(trial)) {
            tokens = trial;
        }
    }
    return tokens.map(tokenText).join(" ");
}
