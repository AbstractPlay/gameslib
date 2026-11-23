import type { HexDir } from "../../common/graphs/hextri.js";
import { HexTriGraph } from "../../common/graphs/hextri.js";

export const DVONN_MIN_WIDTH = 9;
export const DVONN_MAX_WIDTH = 11;

/** Playable intersections on the standard DVONN board (9×11 hex-of-tri). */
export const DVONN_INTERSECTIONS = 49;

/**
 * DVONN board: hex-of-tri 9×11, all intersections in play.
 */
export class DvonnGraph extends HexTriGraph {
  constructor() {
    super(DVONN_MIN_WIDTH, DVONN_MAX_WIDTH);
  }

  public isPlayable(cell: string): boolean {
    return this.graph.hasNode(cell);
  }

  /** Algebraic cells on one line through `from` in direction `dir`, including `from`. */
  public traceLine(from: string, dir: HexDir): string[] {
    const [x, y] = this.algebraic2coords(from);
    const raw = this.ray(x, y, dir, true);
    const line: string[] = [];
    for (const c of raw) {
      line.push(this.coords2algebraic(...c));
    }
    return line;
  }

  public lineBetween(from: string, to: string): string[] | undefined {
    const dir = this.bearing(from, to);
    if (dir === undefined) {
      return undefined;
    }
    const line = this.traceLine(from, dir);
    if (!line.includes(to)) {
      return undefined;
    }
    const i = line.indexOf(from);
    const j = line.indexOf(to);
    if (i === -1 || j === -1) {
      return undefined;
    }
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    return line.slice(lo, hi + 1);
  }

  public playableCells(): string[] {
    return [...this.graph.nodes()].sort();
  }
}