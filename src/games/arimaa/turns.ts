/**
 * Turn enumeration, Lightvector-notation resolution, and canonical
 * serialization for Arimaa.
 *
 * Squares are indexed `rank * 8 + file` with rank 0 being rank "1", so `n` is
 * +8, `s` is -8, `e` is +1 and `w` is -1.
 */
import { arrowToken, captureToken, pieceChar, stepsToken, tokenText, type Dir, type Piece, type playerid, type Token } from "./notation.js";

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

export const NEIGHBOURS: number[][] = [];
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

export const TRAP_SQUARES: readonly string[] = ["c3", "f3", "c6", "f6"];
export const TRAPS: number[] = TRAP_SQUARES.map(sqIndex);

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

export function dirBetween(from: number, to: number): Dir {
    const d = to - from;
    return d === 8 ? "n" : d === -8 ? "s" : d === 1 ? "e" : "w";
}

export const STRENGTH: Record<Piece, number> = { R: 1, C: 2, D: 3, H: 4, M: 5, E: 6 };

/** Whether the piece on `cell` is frozen: no piece of its own is beside it, and a stronger enemy piece is. */
export function isFrozen(board: Map<string, CellContents>, cell: string): boolean {
    const here = board.get(cell);
    if (here === undefined) {
        throw new Error("You can't check the frozen status of a nonexistent piece.");
    }
    let stronger = false;
    for (const n of NEIGHBOURS[sqIndex(cell)]) {
        const there = board.get(sqName(n));
        if (there === undefined) {
            continue;
        }
        if (there[1] === here[1]) {
            return false;
        }
        if (STRENGTH[there[0]] > STRENGTH[here[0]]) {
            stronger = true;
        }
    }
    return stronger;
}

/** Whether no piece of its own is beside the piece on `cell`, as on a trap that captures it. An empty square counts as alone. */
export function isAlone(board: Map<string, CellContents>, cell: string): boolean {
    const here = board.get(cell);
    return here === undefined || NEIGHBOURS[sqIndex(cell)].every(n => board.get(sqName(n))?.[1] !== here[1]);
}

// Whether strength `strong` is exactly one rank above `weak` among the pieces
// on a board, `held[s]` being how many of either colour have strength `s`. A
// strength nobody holds is no rank: with no dog left, a horse is one rank
// above a cat.
function oneRankAbove(held: Int8Array, strong: number, weak: number): boolean {
    if (strong <= weak) {
        return false;
    }
    for (let s = weak + 1; s < strong; s++) {
        if (held[s] > 0) {
            return false;
        }
    }
    return true;
}

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
    /** how many pieces of each strength, of either colour, are on the board */
    public readonly held = new Int8Array(7);
    public readonly startSig: string;

    constructor(board: Map<string, CellContents>, public readonly player: playerid) {
        const cells = [...board.entries()].map(([cell, [type, owner]]) => ({ i: sqIndex(cell), type, owner })).sort((a, b) => a.i - b.i);
        for (const { i, type, owner } of cells) {
            const id = this.pieces.length;
            this.pieces.push({ id, type, owner, strength: STRENGTH[type], start: i, cur: i, capturedAt: -1, visited: [i] });
            this.cells[i] = owner === 1 ? STRENGTH[type] : -STRENGTH[type];
            this.ids[i] = id;
            this.held[STRENGTH[type]]++;
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
            this.held[qp.strength]--;
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
            this.held[this.pieces[pid].strength]++;
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

    // The fewest pieces that can still be displaced `remaining` steps from
    // now. A piece off its square needs a step for every square of the way
    // back; one captured away from home stays away, and so does a rabbit of
    // the mover's that has gone forward.
    public leastDisplaced(remaining: number): number {
        let n = 0;
        const back: number[] = [];
        for (const p of this.pieces) {
            if (p.visited.length === 1) {
                continue;
            }
            if (p.cur < 0) {
                if (p.capturedAt !== p.start) {
                    n++;
                }
            } else if (p.cur !== p.start) {
                n++;
                if (p.type !== "R" || p.owner !== this.player || (p.cur >> 3) === (p.start >> 3)) {
                    back.push(DIST[p.cur * 64 + p.start]);
                }
            }
        }
        back.sort((a, b) => a - b);
        for (const d of back) {
            if (d > remaining) {
                break;
            }
            remaining -= d;
            n--;
        }
        return n;
    }

    /** Whether a push or pull is made by a piece exactly one rank above the piece it moves, as the board stands. */
    public rightSized(atom: TurnStep[]): boolean {
        if (atom.length !== 2) {
            return false;
        }
        const [own, other] = atom[0].owner === this.player ? atom : [atom[1], atom[0]];
        return oneRankAbove(this.held, STRENGTH[own.piece], STRENGTH[other.piece]);
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
    kind: "dest" | "steps" | "capture" | "survive";
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
 * A turn a search found for a position, and the most pushes and pulls made by
 * a piece exactly one rank above the piece it moves that any way of playing
 * that position has, in as many steps and displacing as few pieces. Only a
 * search that puts displaced pieces first counts them.
 */
export interface Found {
    turn: Turn;
    rightSized: number;
}

/** What `firstBucket` looks for. `prune` and `accept` are described at `resolve`. */
interface Wanted {
    prune: boolean;
    accept?: (turn: Turn) => boolean;
    /** order buckets by displaced pieces and then by steps */
    displacedFirst?: boolean;
    /** the square of a piece that has to take a step, or be pushed or pulled, during the turn */
    mover?: number;
    /** stop at the first turn found */
    any?: boolean;
}

// Every position that a turn fitting the tokens reaches, with a turn for each,
// from the first bucket holding any. The notation orders buckets by steps and
// then by displaced pieces. With `displacedFirst` they are ordered by
// displaced pieces and then by steps, as click entry in Advanced mode asks,
// which can put a longer turn before a shorter one.
function firstBucket(board: Map<string, CellContents>, player: playerid, maxSteps: number, tokens: Token[], wanted: Wanted): Found[] {
    const { prune, accept, displacedFirst = false, mover, any = false } = wanted;
    const s = new Search(board, player);
    const moving = mover === undefined ? undefined : s.pieces[s.ids[mover]];
    if (mover !== undefined && moving === undefined) {
        return [];
    }
    const toks = prepare(tokens);
    const destGroups = new Map<number, PTok[]>();
    const captureToks: PTok[] = [];
    const surviveToks: PTok[] = [];
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
        } else if (t.kind === "survive") {
            surviveToks.push(t);
        } else {
            stepToks.push(t);
        }
    }

    const typeMatch = (p: PieceState, t: PTok): boolean => t.type === undefined || (p.type === t.type && p.owner === t.owner);
    const visitedOk = (p: PieceState, t: PTok): boolean => t.sq < 0 || p.visited.includes(t.sq);
    const finalOf = (p: PieceState): number => p.cur < 0 ? p.capturedAt : p.cur;

    // How far the steps taken after index `after` go towards a step token:
    // the index at which some piece first completes it, or failing that the
    // longest prefix of it any piece has taken.
    const witness = (t: PTok, after: number): { end: number; prefix: number } => {
        let end = Infinity;
        let prefix = 0;
        for (const p of s.pieces) {
            if (!typeMatch(p, t)) {
                continue;
            }
            let j = 0;
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
                    if (j === t.dirs.length) {
                        if (i < end) {
                            end = i;
                        }
                        break;
                    }
                }
            }
            if (j > prefix) {
                prefix = j;
            }
        }
        return { end, prefix };
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

    // Steps still needed before `moving` has moved: none once it has. An
    // enemy piece needs its own step and its pusher's or puller's, once a
    // stronger piece of the mover's is next to it. A piece of the mover's
    // needs its own step, and before it a step by another piece if it is
    // frozen and another if every square it could step to is taken. One step
    // cannot do both: what frees it is a friend arriving next to it, which
    // empties no square there since no friend stood there to leave, or a push
    // or pull, which is two steps.
    const movingPrice = (): number => {
        const p = moving!;
        if (p.visited.length > 1) {
            return 0;
        }
        if (p.cur < 0) {
            return Infinity;
        }
        if (p.owner !== s.player) {
            return enemyPrice(p, 1);
        }
        const open = NEIGHBOURS[p.cur].some(n => s.cells[n] === 0 && !(ownRabbit(p) && behind(p.cur, n)));
        return 1 + (s.frozen(p.cur) ? 1 : 0) + (open ? 0 : 1);
    };

    // An admissible lower bound on the steps still needed, or any value above
    // `limit` as soon as the bound is known to exceed it. Two bounds are
    // combined by max: (1) one step per square for every witness, summed over
    // distinct destinations, which need distinct witnesses; (2) per token, the
    // full price of its cheapest witness, including an enemy's partner and
    // approach steps, a frozen piece's release, and clearing the destination,
    // and likewise what it takes for the piece that has to move to move.
    const heuristic = (limit: number): number => {
        stamp++;
        let sum = 0;
        let max = moving === undefined ? 0 : movingPrice();
        if (max > limit) {
            return max;
        }
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
        // Step tokens are witnessed in the order written, each by steps taken
        // after the one before it was completed, so what they still lack adds
        // up: the rest of the first one not yet completed and every step of
        // those after it.
        let after = -1;
        let lacking = 0;
        let open = false;
        for (const t of stepToks) {
            if (t.type === "R" && t.owner === s.player && t.dirs.includes(backwardDir)) {
                return Infinity;
            }
            if (open) {
                lacking += t.dirs.length;
                continue;
            }
            const w = witness(t, after);
            if (w.end === Infinity) {
                open = true;
                lacking += t.dirs.length - w.prefix;
            } else {
                after = w.end;
            }
        }
        return Math.max(sum, max, lacking);
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
        for (const t of surviveToks) {
            if (!s.pieces.some(p => typeMatch(p, t) && visitedOk(p, t) && p.cur >= 0)) {
                return false;
            }
        }
        // step tokens must be witnessed in the order written; the earliest
        // completion of each leaves the most room for the next
        let after = -1;
        for (const t of stepToks) {
            after = witness(t, after).end;
            if (after === Infinity) {
                return false;
            }
        }
        return true;
    };

    // Everything the search asks of a state, except the order of the steps
    // that led to it, is in the board and each moved piece's visited squares.
    // Step tokens are the exception, so the memo is off while any is present.
    // `accept` is held to the same rule.
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

    // No turn that fits displaces fewer pieces than this: a destination that
    // the piece standing on it does not answer for takes a piece from
    // elsewhere, and distinct destinations take distinct pieces.
    let floor = 0;
    for (const [dest, group] of destGroups) {
        const there = s.ids[dest];
        if (there < 0 || !group.every(t => typeMatch(s.pieces[there], t))) {
            floor++;
        }
    }

    let best: Found[] = [];
    // displaced pieces a turn has to stay under to be worth its extra steps
    let under = Infinity;
    let rightSized = 0;
    // set once a turn is found when any will do
    let done = false;
    for (let k = 1; k <= maxSteps; k++) {
        const found = new Map<string, Found>();
        // States already searched with at least as many steps left, and as
        // many right-sized pushes and pulls behind them. Whatever a state
        // leads to with fewer steps left was within reach of a shallower
        // iteration, which either came up empty or found it in fewer steps.
        const seen = new Map<string, number>();
        const dfs = (remaining: number): void => {
            if (done) {
                return;
            }
            if (remaining === 0) {
                if (moving !== undefined && moving.visited.length === 1) {
                    return;
                }
                const sig = s.signature();
                if (sig === s.startSig || !satisfies()) {
                    return;
                }
                const displaced = s.displaced();
                if (displaced >= under) {
                    return;
                }
                const candidate = s.snapshot(displaced, sig);
                if (accept !== undefined && !accept(candidate)) {
                    return;
                }
                const existing = found.get(sig);
                if (existing === undefined || displaced < existing.turn.displaced ||
                    (displaced === existing.turn.displaced && rightSized > existing.rightSized)) {
                    found.set(sig, { turn: candidate, rightSized });
                }
                done = any;
                return;
            }
            if (prune && heuristic(remaining) > remaining) {
                return;
            }
            if (prune && under !== Infinity && s.leastDisplaced(remaining) >= under) {
                return;
            }
            if (prune && memo && remaining < k) {
                const key = stateKey();
                const reached = remaining * (maxSteps + 1) + rightSized;
                const before = seen.get(key);
                if (before !== undefined && before >= reached) {
                    return;
                }
                seen.set(key, reached);
            }
            for (const atom of s.atoms(remaining)) {
                if (atom.length > remaining) {
                    continue;
                }
                const counts = displacedFirst && s.rightSized(atom) ? 1 : 0;
                const undos: Undo[] = [];
                for (const st of atom) {
                    undos.push(s.apply(st));
                }
                rightSized += counts;
                dfs(remaining - atom.length);
                rightSized -= counts;
                while (undos.length > 0) {
                    s.undo(undos.pop()!);
                }
                if (done) {
                    return;
                }
            }
        };
        dfs(k);
        if (found.size === 0) {
            continue;
        }
        let minDisplaced = Infinity;
        for (const f of found.values()) {
            if (f.turn.displaced < minDisplaced) {
                minDisplaced = f.turn.displaced;
            }
        }
        best = [...found.values()].filter(f => f.turn.displaced === minDisplaced);
        if (!displacedFirst || minDisplaced <= floor) {
            break;
        }
        under = minDisplaced;
    }
    return best;
}

/**
 * Find the move a token list denotes from `board` with `player` to move.
 * Strict resolution is the notation's meaning; lenient resolution breaks a
 * tie in the first bucket by fewest own captures, then most enemy captures.
 * `prune` disables the search heuristic; it exists so tests can check that
 * pruning never changes an answer. `accept` narrows the turns considered to
 * those it returns true for; click entry uses it to ask for more than tokens
 * can say. It may look only at where each piece starts, passes and ends, not
 * at the order of the steps: the search does not try every order that reaches
 * a state.
 */
export function resolve(board: Map<string, CellContents>, player: playerid, maxSteps: number, tokens: Token[], lenient: boolean, prune = true, accept?: (turn: Turn) => boolean): Resolution {
    const candidates = firstBucket(board, player, maxSteps, tokens, {prune, accept}).map(f => f.turn);
    if (candidates.length === 0) {
        return { status: "unsatisfiable" };
    }
    const bucket: [number, number] = [candidates[0].steps.length, candidates[0].displaced];
    if (candidates.length === 1) {
        return { status: "resolved", bucket, turn: candidates[0], positions: 1, lenient: false };
    }
    if (lenient) {
        let best = candidates[0];
        let tie = false;
        for (const t of candidates.slice(1)) {
            const c = byCaptures(t, best);
            if (c < 0) {
                best = t;
                tie = false;
            } else if (c === 0) {
                tie = true;
            }
        }
        if (!tie) {
            return { status: "resolved", bucket, turn: best, positions: candidates.length, lenient: true };
        }
    }
    return { status: "ambiguous", bucket, positions: candidates.length, candidates };
}

/**
 * The turns that fit a token list when what is asked of a turn is, before
 * anything else, to displace as few pieces as it can, and only then to take as
 * few steps: one for each position in the first such bucket, and none if no
 * turn fits. This is how click entry in Advanced mode reads what a player has
 * said so far. It is not what the notation means: `resolve` is.
 */
export function fewestDisplaced(board: Map<string, CellContents>, player: playerid, maxSteps: number, tokens: Token[], accept?: (turn: Turn) => boolean, prune = true): Found[] {
    return firstBucket(board, player, maxSteps, tokens, {prune, accept, displacedFirst: true});
}

/**
 * Whether every token already holds of the position as it stands: holds and
 * survival assertions about pieces that are where the tokens say.
 */
export function standing(board: Map<string, CellContents>, tokens: Token[]): boolean {
    return tokens.every(t => {
        if (t.prop.kind !== "dest" && t.prop.kind !== "survive") {
            return false;
        }
        const matches = ([piece, owner]: CellContents): boolean => t.spec.piece === undefined || (t.spec.piece === piece && t.spec.owner === owner);
        const at = t.prop.kind === "dest" ? t.prop.square : t.spec.square;
        if (at === undefined) {
            return [...board.values()].some(matches);
        }
        if (t.spec.square !== undefined && t.spec.square !== at) {
            return false;
        }
        const there = board.get(at);
        return there !== undefined && matches(there);
    });
}

export type Displayed =
    | { status: "unsatisfiable" }
    /** every token already holds of the position as it stands: nothing moves yet */
    | { status: "idle" }
    /**
     * `by` says what settled on the turn: the notation's own meaning, a
     * preference for some captures over others, the whole of Advanced click
     * entry's preferences (`choose`), or, with "choice", nothing but the
     * order positions sort in. `positions` is how many the first bucket holds.
     */
    | { status: "turn"; turn: Turn; by: "notation" | "captures" | "preference" | "choice"; positions: number };

/**
 * What a token list is shown as and, once the player completes it, played as:
 * the notation's own meaning where it has one, and otherwise, of the turns in
 * its first bucket, the one capturing the fewest own pieces, then the most
 * enemy pieces, then (so that there is always an answer) the one whose
 * position sorts first. What is stored for a turn is always written by
 * `serializeTurn`, which needs none of these preferences to be read back.
 */
export function display(board: Map<string, CellContents>, player: playerid, maxSteps: number, tokens: Token[], accept?: (turn: Turn) => boolean): Displayed {
    if (accept === undefined && standing(board, tokens)) {
        return { status: "idle" };
    }
    const r = resolve(board, player, maxSteps, tokens, true, true, accept);
    if (r.status === "unsatisfiable") {
        return r;
    }
    if (r.status === "resolved") {
        return { status: "turn", turn: r.turn, by: r.lenient ? "captures" : "notation", positions: r.positions };
    }
    let best = r.candidates[0];
    for (const t of r.candidates) {
        const c = byCaptures(t, best);
        if (c < 0 || (c === 0 && t.signature < best.signature)) {
            best = t;
        }
    }
    return { status: "turn", turn: best, by: "choice", positions: r.positions };
}

/** Turns that capture fewer own pieces first, then those capturing more enemy pieces. */
export function byCaptures(a: Turn, b: Turn): number {
    return a.ownCaptured - b.ownCaptured || b.enemyCaptured - a.enemyCaptured;
}

/**
 * How Advanced click entry orders the turns of a first bucket, which already
 * displace the fewest pieces in the fewest steps: the fewest own pieces
 * captured, the most enemy pieces captured, the most pushes and pulls of a
 * piece exactly one rank weaker, then the most enemy pieces less own pieces
 * left beside an opposing piece exactly one rank stronger (`wrongPieces`).
 * Normal Move (`choose`) and Target Selection both order by this.
 */
export function preferences(player: playerid): (a: Found, b: Found) => number {
    const enemy: playerid = player === 1 ? 2 : 1;
    const wrongs = new Map<string, number>();
    const wrong = ({turn: {signature}}: Found): number => {
        let n = wrongs.get(signature);
        if (n === undefined) {
            n = wrongPieces(signature, enemy) - wrongPieces(signature, player);
            wrongs.set(signature, n);
        }
        return n;
    };
    return (a, b) => byCaptures(a.turn, b.turn) || b.rightSized - a.rightSized || wrong(b) - wrong(a);
}

/**
 * What click entry in Advanced mode takes a token list to mean, which is not
 * what the notation means by it (`display`). Beyond what the tokens say it
 * asks for as little as it can: of every turn that fits, the fewest pieces
 * displaced, then the fewest steps, then by `preferences`, and then (so that
 * there is always an answer) the position that sorts first. An entry that is
 * to be played as this turn has to say so in terms the notation reads the
 * same way.
 */
export function choose(board: Map<string, CellContents>, player: playerid, maxSteps: number, tokens: Token[], accept?: (turn: Turn) => boolean): Displayed {
    if (accept === undefined && standing(board, tokens)) {
        return { status: "idle" };
    }
    const found = fewestDisplaced(board, player, maxSteps, tokens, accept);
    if (found.length === 0) {
        return { status: "unsatisfiable" };
    }
    const preference = preferences(player);
    let best = found[0];
    let tied = false;
    for (const f of found.slice(1)) {
        const c = preference(f, best);
        if (c < 0) {
            best = f;
            tied = false;
        } else if (c === 0) {
            tied = true;
            if (f.turn.signature < best.turn.signature) {
                best = f;
            }
        }
    }
    return { status: "turn", turn: best.turn, by: tied ? "choice" : "preference", positions: found.length };
}

/**
 * How many of `side`'s pieces, in the position a signature describes, stand
 * next to an enemy piece exactly one rank stronger. Ranks are counted over
 * the pieces on the board, as for a right-sized push.
 */
export function wrongPieces(signature: string, side: playerid): number {
    const cells = new Int8Array(64);
    const held = new Int8Array(7);
    for (let i = 0; i < 64; i++) {
        const ch = signature[i];
        if (ch !== "-") {
            const strength = STRENGTH[ch.toUpperCase() as Piece];
            cells[i] = ch === ch.toUpperCase() ? strength : -strength;
            held[strength]++;
        }
    }
    let n = 0;
    for (let i = 0; i < 64; i++) {
        const c = cells[i];
        if (c === 0 || (c > 0) !== (side === 1)) {
            continue;
        }
        if (NEIGHBOURS[i].some(j => cells[j] !== 0 && (cells[j] > 0) !== (c > 0) && oneRankAbove(held, Math.abs(cells[j]), Math.abs(c)))) {
            n++;
        }
    }
    return n;
}

/** The position signature turns are compared by. */
export function boardSignature(board: Map<string, CellContents>): string {
    return new Search(board, 1).signature();
}

/**
 * Whether the piece on `origin` can take a step, or be pushed or pulled, in
 * some turn of at most `maxSteps` steps that fits `tokens`.
 */
export function canMoveWithin(board: Map<string, CellContents>, player: playerid, maxSteps: number, origin: string, tokens: Token[] = []): boolean {
    if (maxSteps <= 0 || !board.has(origin)) {
        return false;
    }
    return firstBucket(board, player, maxSteps, tokens, {prune: true, mover: sqIndex(origin), any: true}).length > 0;
}

/**
 * Whether the player to move has any legal step, or, with at least two steps
 * to spend, any push or pull. Only Dicey Moves allows fewer than two.
 */
export function hasAnyMove(board: Map<string, CellContents>, player: playerid, maxSteps = 4): boolean {
    return new Search(board, player).atoms(Math.min(2, maxSteps)).length > 0;
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
    return stepsToken(st.piece, st.owner, sqName(st.from), [st.dir]);
}

function bareToken(t: Token): Token {
    const piece = pieceChar(t.spec.piece!, t.spec.owner!);
    let text: string;
    if (t.prop.kind === "dest") {
        text = `${piece}${t.prop.square}`;
    } else if (t.prop.kind === "capture") {
        text = `${piece}x`;
    } else if (t.prop.kind === "steps") {
        text = `${piece}${t.prop.dirs.join("")}`;
    } else {
        text = `${piece}o`;
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
