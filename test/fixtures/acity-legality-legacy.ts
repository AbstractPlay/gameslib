/**
 * Frozen clone-based placement legality from pre-refactor Alien City.
 * Used to guard refactors: {@link canPlaceLegacy} must match {@link ACityGame.goldenPlacementResult}.
 * Delete this module once the refactor ships and {@link test/fixtures/acity-golden-oracle.json} remains the long-term oracle.
 */
import { ACityGame, type ACityColor, type ACityPiece, type ACityPlacementResult } from "../../src/games/acity";
import { cloneState } from "../../src/common/index.js";

function buildGraph(g: ACityGame): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to private buildGraph
    (g as any).buildGraph();
}

function placePiece(g: ACityGame, piece: ACityPiece, cell: string): void {
    g.board.set(cell, piece);
    for (const n of g.graph.neighbours(cell)) {
        if (g.board.has(n)) {
            g.graph.graph.dropEdge(cell, n);
        }
    }
}

function isConnectedLegacy(g: ACityGame): boolean {
    const cloned = Object.assign(new ACityGame(), cloneState(g) as ACityGame);
    buildGraph(cloned);
    for (const cell of g.board.keys()) {
        cloned.graph.graph.dropNode(cell);
    }
    return cloned.graph.isConnected();
}

function getEmptyGuild(g: ACityGame, color: ACityColor): string[] {
    const empties = (g.graph.listCells() as string[]).filter((cell) => !g.board.has(cell));
    const cells: string[] = [];
    for (const cell of empties) {
        const [c] = g.cell2guild(cell);
        if (c === color) {
            cells.push(cell);
        }
    }
    return cells;
}

/** Legacy {@link ACityGame} placement check (verbatim pre-refactor algorithm). */
export function canPlaceLegacy(g: ACityGame, piece: ACityPiece, cell: string): ACityPlacementResult {
    let cloned = Object.assign(new ACityGame(), cloneState(g) as ACityGame);
    buildGraph(cloned);
    placePiece(cloned, piece, cell);
    if (!isConnectedLegacy(cloned)) {
        return "ROAD";
    }

    for (const c of cloned.board.keys()) {
        if (cloned.graph.neighbours(c).length === 0) {
            return "ISOLATED";
        }
    }

    const pcColor = piece[0] as ACityColor;
    const [cellColor] = g.cell2guild(cell);
    if (piece.endsWith("D")) {
        if (pcColor !== cellColor) {
            const cells = getEmptyGuild(cloned, pcColor);
            let broken = true;
            for (const c of cells) {
                cloned = Object.assign(new ACityGame(), cloneState(g) as ACityGame);
                buildGraph(cloned);
                placePiece(cloned, piece, c);
                if (isConnectedLegacy(cloned)) {
                    let isolated = false;
                    for (const c2 of cloned.board.keys()) {
                        if (cloned.graph.neighbours(c2).length === 0) {
                            isolated = true;
                            break;
                        }
                    }
                    if (!isolated) {
                        broken = false;
                        break;
                    }
                }
            }
            if (!broken) {
                return "DOMES";
            }
        }
    }

    if (cellColor !== "N" && piece.endsWith("T") && pcColor !== cellColor) {
        const built = g.cell2tile(cell).cells.filter((c) => g.board.has(c)).length;
        if (built < 2) {
            return "TOWERS";
        }
    }

    const tile = g.cell2tile(cell);
    if (tile.marker === cell) {
        const empties = tile.cells.filter((c) => c !== cell && !g.board.has(c));
        const allPieces = new Set<string>(...g.stashes[0], ...g.stashes[1]);
        let otherOptions = false;
        for (const other of empties) {
            for (const pc of allPieces) {
                if (canPlaceLegacy(g, pc as ACityPiece, other) === "GOOD") {
                    otherOptions = true;
                    break;
                }
            }
            if (otherOptions) {
                break;
            }
        }
        if (otherOptions) {
            return "MARKER";
        }
    }

    return "GOOD";
}
