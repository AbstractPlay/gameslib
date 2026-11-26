// An independent enumerator of every legal Arimaa turn from a position, used to
// check that each reachable position can be entered with clicks alone, and
// that click entry prefers the turns it is meant to. It deliberately
// re-implements the rules rather than calling the engine's own search, so a
// mistake in one is not mirrored in the other.
export type Owner = 1 | 2;
export type Board = Map<string, [string, Owner]>;

const FILES = "abcdefgh";
const TRAPS = ["c3", "f3", "c6", "f6"];
const STRENGTH: Record<string, number> = { R: 1, C: 2, D: 3, H: 4, M: 5, E: 6 };
const at = (x: number, y: number): string => `${FILES[x]}${y + 1}`;
const xy = (c: string): [number, number] => [FILES.indexOf(c[0]), parseInt(c[1], 10) - 1];

export const neighbours = (c: string): string[] => {
    const [x, y] = xy(c);
    const out: string[] = [];
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
            out.push(at(nx, ny));
        }
    }
    return out;
};

export const boardOf = (spec: string): Board => {
    const b: Board = new Map();
    for (const t of spec.trim().split(/\s+/)) {
        b.set(t.slice(1), [t[0].toUpperCase(), t[0] === t[0].toUpperCase() ? 1 : 2]);
    }
    return b;
};

/** A piece alone on a trap would already be gone, so such a position is not legal. */
export const unsupportedOnTrap = (b: Board): string | undefined =>
    TRAPS.find(t => b.has(t) && !neighbours(t).some(n => b.get(n)?.[1] === b.get(t)![1]));

const frozen = (b: Board, c: string): boolean => {
    const [pc, owner] = b.get(c)!;
    let stronger = false;
    for (const n of neighbours(c)) {
        const o = b.get(n);
        if (o === undefined) {
            continue;
        }
        if (o[1] === owner) {
            return false;
        }
        if (STRENGTH[o[0]] > STRENGTH[pc]) {
            stronger = true;
        }
    }
    return stronger;
};

const step = (b: Board, from: string, to: string): Board => {
    const nb: Board = new Map(b);
    nb.set(to, nb.get(from)!);
    nb.delete(from);
    for (const t of TRAPS) {
        if (nb.has(t) && !neighbours(t).some(n => nb.get(n)?.[1] === nb.get(t)![1])) {
            nb.delete(t);
        }
    }
    return nb;
};

/** Rank 8 first, to match ArimaaGame.signature(). */
export const signature = (b: Board): string => {
    let s = "";
    for (let y = 7; y >= 0; y--) {
        for (let x = 0; x < 8; x++) {
            const o = b.get(at(x, y));
            s += o === undefined ? "-" : (o[1] === 1 ? o[0] : o[0].toLowerCase());
        }
    }
    return s;
};

// one own step, a push (enemy first, pusher follows) or a pull (puller first, enemy follows)
const atoms = (b: Board, player: Owner, remaining: number): Array<Array<[string, string]>> => {
    const out: Array<Array<[string, string]>> = [];
    for (const [from, [pc, owner]] of b.entries()) {
        if (owner !== player || frozen(b, from)) {
            continue;
        }
        const [, fy] = xy(from);
        for (const to of neighbours(from)) {
            const [, ty] = xy(to);
            if (pc === "R" && (player === 1 ? ty < fy : ty > fy)) {
                continue;
            }
            const occ = b.get(to);
            if (occ === undefined) {
                out.push([[from, to]]);
                if (remaining >= 2) {
                    for (const n of neighbours(from)) {
                        const e = b.get(n);
                        if (e !== undefined && e[1] !== player && STRENGTH[e[0]] < STRENGTH[pc]) {
                            out.push([[from, to], [n, from]]);
                        }
                    }
                }
            } else if (remaining >= 2 && occ[1] !== player && STRENGTH[occ[0]] < STRENGTH[pc]) {
                for (const t of neighbours(to)) {
                    if (!b.has(t)) {
                        out.push([[to, t], [from, to]]);
                    }
                }
            }
        }
    }
    return out;
};

/** Every position reachable in at most `maxSteps`, with the step lists that reach it. */
export const allTurns = (b: Board, player: Owner, maxSteps: number): Map<string, Array<Array<[string, string]>>> => {
    const start = signature(b);
    const found = new Map<string, Array<Array<[string, string]>>>();
    const dfs = (cur: Board, steps: Array<[string, string]>, left: number): void => {
        if (steps.length > 0) {
            const s = signature(cur);
            if (s !== start) {
                const seen = found.get(s);
                if (seen === undefined) {
                    found.set(s, [steps.slice()]);
                } else if (seen.length < 4 && steps.length <= seen[0].length) {
                    seen.push(steps.slice());
                }
            }
        }
        if (left === 0) {
            return;
        }
        for (const atom of atoms(cur, player, left)) {
            if (atom.length > left) {
                continue;
            }
            let nb = cur;
            for (const [f, t] of atom) {
                nb = step(nb, f, t);
            }
            dfs(nb, [...steps, ...atom], left - atom.length);
        }
    };
    dfs(b, [], maxSteps);
    return found;
};

/** What became of a piece in a turn: the squares it stood on, in order, and the one it ended up or was captured on. */
export interface Path {
    type: string;
    owner: Owner;
    visited: string[];
    final: string;
    captured: boolean;
}

/** One way of playing a turn. */
export interface Play {
    steps: number;
    board: Board;
    /** by the square it started on, each piece that moved or was captured */
    paths: Map<string, Path>;
    /** pushes and pulls made by a piece exactly one rank above the piece it moved */
    rightSized: number;
}

/**
 * Whether `strong` is exactly one rank above `weak` on a board. A rank that
 * no piece of either colour holds does not count: with no dog on the board, a
 * horse is one rank above a cat.
 */
export const oneRankAbove = (b: Board, strong: string, weak: string): boolean => {
    if (STRENGTH[strong] <= STRENGTH[weak]) {
        return false;
    }
    for (const [pc] of b.values()) {
        if (STRENGTH[pc] > STRENGTH[weak] && STRENGTH[pc] < STRENGTH[strong]) {
            return false;
        }
    }
    return true;
};

/**
 * Every way of playing every legal turn of at most `maxSteps` steps, with each
 * piece followed from the square it started on. A push or pull is judged on
 * the board as it stands when it is made.
 */
export const allPlays = (b: Board, player: Owner, maxSteps: number): Play[] => {
    const start = signature(b);
    const out: Play[] = [];
    // `origin` maps the square a moved piece stands on to the one it started on
    const dfs = (cur: Board, origin: Map<string, string>, paths: Map<string, Path>, steps: number, rightSized: number): void => {
        if (steps > 0 && signature(cur) !== start) {
            out.push({ steps, board: cur, paths, rightSized });
        }
        const left = maxSteps - steps;
        for (const atom of left === 0 ? [] : atoms(cur, player, left)) {
            if (atom.length > left) {
                continue;
            }
            let fits = 0;
            if (atom.length === 2) {
                const first = cur.get(atom[0][0])!;
                const second = cur.get(atom[1][0])!;
                const [mine, theirs] = first[1] === player ? [first, second] : [second, first];
                fits = oneRankAbove(cur, mine[0], theirs[0]) ? 1 : 0;
            }
            let nb = cur;
            const no = new Map(origin);
            const np = new Map([...paths].map(([from, p]): [string, Path] => [from, { ...p, visited: p.visited.slice() }]));
            const pathOf = (from: string, pc: [string, Owner]): Path => {
                let p = np.get(from);
                if (p === undefined) {
                    p = { type: pc[0], owner: pc[1], visited: [from], final: from, captured: false };
                    np.set(from, p);
                }
                return p;
            };
            for (const [f, t] of atom) {
                const pc = nb.get(f)!;
                const from = no.get(f) ?? f;
                no.delete(f);
                no.set(t, from);
                const moved = pathOf(from, pc);
                moved.visited.push(t);
                moved.final = t;
                const standing: Board = new Map(nb);
                standing.set(t, pc);
                standing.delete(f);
                nb = step(nb, f, t);
                for (const trap of TRAPS) {
                    const gone = standing.get(trap);
                    if (gone !== undefined && !nb.has(trap)) {
                        const died = pathOf(no.get(trap) ?? trap, gone);
                        no.delete(trap);
                        died.captured = true;
                        died.final = trap;
                    }
                }
            }
            dfs(nb, no, np, steps + atom.length, rightSized + fits);
        }
    };
    dfs(b, new Map(), new Map(), 0, 0);
    return out;
};
