import type { UndirectedGraph } from "graphology";
import { type SquareGraph } from "../../common/index.js";
import type { CubeoBoard } from "./board.js";
import type { CubeoDie } from "./die.js";
import {
    buildCubeoMoveGraph,
    CubeoGraphPassCache,
} from "./formation-graph.js";

/** Cells reachable in exactly `steps` moves on an undirected graph (backtracking allowed). */
export function moveEndNodesOnGraph(graph: UndirectedGraph, start: string, steps: number): Set<string> {
    let frontier = new Set<string>([start]);
    for (let i = 0; i < steps; i++) {
        const next = new Set<string>();
        for (const v of frontier) {
            for (const n of graph.neighbors(v)) {
                next.add(n);
            }
        }
        frontier = next;
    }
    return frontier;
}

/**
 * Slide queries for one board position. Uses {@link CubeoGraphPassCache} and per-cell move graphs
 * so a single `moves()` pass does not rebuild the same formation/move graphs repeatedly.
 */
export class CubeoSlideTopology {
    private readonly pass: CubeoGraphPassCache;
    private readonly moveGraphByCell = new Map<string, SquareGraph>();
    private readonly moveEndByDieUid = new Map<string, Set<string>>();

    public static fromBoard(board: CubeoBoard): CubeoSlideTopology {
        return new CubeoSlideTopology(board);
    }

    public constructor(private readonly board: CubeoBoard) {
        this.pass = new CubeoGraphPassCache(board);
    }

    /** Cached formation graph (no ignore cell). */
    public formationGraph(): SquareGraph {
        return this.pass.formation();
    }

    private moveGraphAt(x: number, y: number): SquareGraph {
        const key = `${x},${y}`;
        let g = this.moveGraphByCell.get(key);
        if (g === undefined) {
            g = buildCubeoMoveGraph(this.board, x, y, this.pass);
            this.moveGraphByCell.set(key, g);
        }
        return g;
    }

    /** True when a die can slide in or out of (x, y) without lifting other dice. */
    public canSlideAt(x: number, y: number): boolean {
        const g = this.moveGraphAt(x, y);
        const coords = g.graph.nodes().map(n => g.algebraic2coords(n)).flat();
        return coords.includes(0);
    }

    /** Absolute coords `"x,y"` reachable in exactly die.pips steps (includes start). */
    public moveEndAbsKeys(die: CubeoDie): Set<string> {
        const cached = this.moveEndByDieUid.get(die.uid);
        if (cached !== undefined) {
            return cached;
        }
        const rel = this.board.abs2rel(die.x, die.y);
        if (rel === undefined) {
            return new Set();
        }
        const gMove = this.moveGraphAt(die.x, die.y);
        const start = gMove.coords2algebraic(...rel);
        const relCells = moveEndNodesOnGraph(gMove.graph, start, die.pips);
        const out = new Set<string>();
        for (const cell of relCells) {
            const [relx, rely] = gMove.algebraic2coords(cell);
            const [absx, absy] = this.board.rel2abs(relx, rely);
            out.add(`${absx},${absy}`);
        }
        this.moveEndByDieUid.set(die.uid, out);
        return out;
    }
}
