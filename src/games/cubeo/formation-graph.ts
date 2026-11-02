import { SquareGraph, SquareOrthGraph } from "../../common/index.js";
import type { EdgeData } from "../../common/graphs/square.js";
import type { CubeoBoard } from "./board.js"; // type-only — avoids runtime cycle with board.ts
import { CubeoDie } from "./die.js";

/** Formation graph: dice plus fringe empties, with legal slide diagonals. */
export function buildCubeoFormationGraph(board: CubeoBoard, ignore?: string): SquareGraph {
    const g = new SquareGraph(board.width + 2, board.height + 2);
    const gOrth = new SquareOrthGraph(board.width + 2, board.height + 2);
    for (const node of g.graph.nodes()) {
        const [relx, rely] = g.algebraic2coords(node);
        const die = board.getDieAt(...board.rel2abs(relx, rely));
        if (die === undefined) {
            let isAdj = false;
            for (const n of gOrth.neighbours(node)) {
                const [relnx, relny] = g.algebraic2coords(n);
                if (board.getDieAt(...board.rel2abs(relnx, relny)) !== undefined) {
                    isAdj = true;
                    break;
                }
            }
            if (!isAdj) {
                g.graph.dropNode(node);
            }
        } else {
            g.graph.setNodeAttribute(node, "contents", die);
        }
    }

    const todrop: string[] = [];
    for (const edge of g.graph.edgeEntries()) {
        const {edge: eid, attributes, source, target, sourceAttributes, targetAttributes} = edge;
        if ((attributes as EdgeData).type === "orth") {
            continue;
        }
        if ("contents" in sourceAttributes && "contents" in targetAttributes) {
            todrop.push(eid);
            continue;
        }

        const [sx, sy] = g.algebraic2coords(source);
        const [tx, ty] = g.algebraic2coords(target);
        let left: string;
        let right: string;
        if (tx > sx) {
            if (ty < sy) {
                left = g.coords2algebraic(sx, sy - 1);
                right = g.coords2algebraic(sx + 1, sy);
            } else {
                left = g.coords2algebraic(sx, sy + 1);
                right = g.coords2algebraic(sx + 1, sy);
            }
        } else {
            if (ty < sy) {
                left = g.coords2algebraic(sx, sy - 1);
                right = g.coords2algebraic(sx - 1, sy);
            } else {
                left = g.coords2algebraic(sx, sy + 1);
                right = g.coords2algebraic(sx - 1, sy);
            }
        }
        if (g.graph.hasNode(left) && g.graph.hasNodeAttribute(left, "contents") &&
            g.graph.hasNode(right) && g.graph.hasNodeAttribute(right, "contents") && ignore !== left && ignore !== right) {
            todrop.push(eid);
        } else if (
            g.graph.hasNode(left) && !g.graph.hasNodeAttribute(left, "contents") &&
            g.graph.hasNode(right) && !g.graph.hasNodeAttribute(right, "contents")) {
            todrop.push(eid);
        }
    }
    todrop.forEach(eid => g.graph.dropEdge(eid));

    return g;
}

/** Move graph for sliding from die or empty cell at absolute (x, y). */
export function buildCubeoMoveGraph(board: CubeoBoard, x: number, y: number, pass?: CubeoGraphPassCache): SquareGraph {
    const die = board.getDieAt(x, y);
    let startCell: string | undefined;
    const rel = board.abs2rel(x, y);
    if (rel === undefined) {
        throw new Error(`Coordinates ${x},${y} are outside the formation padding.`);
    }
    const pad = new SquareGraph(board.width + 2, board.height + 2);
    const ignoreCell = pad.coords2algebraic(...rel);
    const g = pass === undefined
        ? buildCubeoFormationGraph(board, ignoreCell)
        : pass.formation(ignoreCell);
    const gOrth = pass === undefined ? buildCubeoFormationGraphOrth(board) : pass.formationOrth();

    if (die !== undefined) {
        startCell = g.coords2algebraic(...rel);
        const empties = g.graph.nodes().filter(node => !g.graph.hasNodeAttribute(node, "contents"));
        for (const node of empties) {
            const ndice: CubeoDie[] = [];
            for (const n of gOrth.neighbours(node)) {
                if (g.graph.hasNode(n) && g.graph.hasNodeAttribute(n, "contents")) {
                    ndice.push(CubeoDie.deserialize(g.graph.getNodeAttribute(n, "contents") as CubeoDie));
                }
            }
            if (ndice.length === 1 && ndice[0].uid === die.uid) {
                g.graph.dropNode(node);
            }
        }
    }

    for (const edge of g.graph.edges()) {
        const [left, right] = g.graph.extremities(edge);
        if ((g.graph.hasNodeAttribute(left, "contents") && left !== startCell) || (g.graph.hasNodeAttribute(right, "contents") && right !== startCell)) {
            continue;
        }
        const nLeft = new Set<string>(gOrth.graph.neighbors(left).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")));
        const nRight = new Set<string>(gOrth.graph.neighbors(right).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")));
        let shared = new Set<string>([...nLeft].filter(n => nRight.has(n)));
        if (shared.size > 0) {
            continue;
        }
        const nnLeft = new Set<string>();
        nLeft.forEach(n => gOrth.graph.neighbors(n).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")).forEach(nn => nnLeft.add(nn)));
        const nnRight = new Set<string>();
        nRight.forEach(n => gOrth.graph.neighbors(n).filter(node => node !== startCell && g.graph.hasNode(node) && g.graph.hasNodeAttribute(node, "contents")).forEach(nn => nnRight.add(nn)));
        shared = new Set<string>([...nnLeft, ...nLeft].filter(n => nnRight.has(n) || nRight.has(n)));
        if (shared.size > 0) {
            continue;
        }
        g.graph.dropEdge(edge);
    }

    for (const node of g.graph.nodes()) {
        if (g.graph.hasNodeAttribute(node, "contents")) {
            const other = CubeoDie.deserialize(g.graph.getNodeAttribute(node, "contents") as CubeoDie);
            if (die === undefined || other.uid !== die.uid) {
                g.graph.dropNode(node);
            }
        }
    }
    const target = g.coords2algebraic(...rel);
    for (const node of g.graph.nodes()) {
        if (g.path(node, target) === null) {
            g.graph.dropNode(node);
        }
    }
    return g;
}

/** Caches formation / orth graphs for one `moves()` pass (shared by slide topology). */
export class CubeoGraphPassCache {
    private base?: SquareGraph;
    private readonly byIgnore = new Map<string, SquareGraph>();
    private orth?: SquareGraph;

    public constructor(private readonly board: CubeoBoard) {}

    public formation(ignore?: string): SquareGraph {
        if (ignore === undefined) {
            this.base ??= buildCubeoFormationGraph(this.board);
            return this.base;
        }
        let cached = this.byIgnore.get(ignore);
        if (cached === undefined) {
            cached = buildCubeoFormationGraph(this.board, ignore);
            this.byIgnore.set(ignore, cached);
        }
        return cached;
    }

    public formationOrth(): SquareGraph {
        this.orth ??= buildCubeoFormationGraphOrth(this.board);
        return this.orth;
    }
}

export function buildCubeoFormationGraphOrth(board: CubeoBoard): SquareGraph {
    const g = buildCubeoFormationGraph(board);
    for (const edge of g.graph.edges()) {
        if (g.graph.getEdgeAttribute(edge, "type") === "diag") {
            g.graph.dropEdge(edge);
        }
    }
    return g;
}
