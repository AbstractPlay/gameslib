import { shuffle } from "../../common/shuffle.js";
import type { GameRng } from "../../common/rng.js";
import type { DvonnGraph } from "../../common/graphs/dvonn.js";
import type { CellStack, playerid, Reserves, SeatReserves, StackDisc } from "./types.js";
import { DVONN_DISC, isDvonnDisc, PIECES_PER_PLAYER, SETUP_PLIES } from "./types.js";
import type { Phase } from "./types.js";

export function initialReserves(): Reserves {
  return [
    { dvonn: 2, basic: PIECES_PER_PLAYER },
    { dvonn: 1, basic: PIECES_PER_PLAYER },
  ];
}

/** Seat that places the `plyIndex`th disc (0-based, before the placement). */
export function setupActor(plyIndex: number): playerid {
  if (plyIndex < 3) {
    return plyIndex === 1 ? 2 : 1;
  }
  return plyIndex % 2 === 1 ? 2 : 1;
}

/** Which disc type is placed on setup ply `plyIndex`. */
export function setupDisc(plyIndex: number): StackDisc {
  if (plyIndex < 3) {
    return DVONN_DISC;
  }
  return setupActor(plyIndex);
}

export function reserveForDisc(reserves: Reserves, player: playerid, disc: StackDisc): boolean {
  const seat = reserves[player - 1]!;
  if (isDvonnDisc(disc)) {
    if (seat.dvonn <= 0) {
      return false;
    }
    seat.dvonn--;
    return true;
  }
  if (seat.basic <= 0) {
    return false;
  }
  seat.basic--;
  return true;
}

export function formatReserveLine(seat: SeatReserves): string {
  return `D${seat.dvonn}/B${seat.basic}`;
}

export function stackFromDisc(disc: StackDisc): CellStack {
  if (isDvonnDisc(disc)) {
    return { pieces: [disc] };
  }
  return { owner: disc, pieces: [disc] };
}

export function playStartStackIndex(stack: Array<{ phase: Phase }>): number {
  for (let i = 0; i < stack.length; i++) {
    if (stack[i]!.phase === "play") {
      if (i === 0) {
        return 0;
      }
      if (stack[i - 1]!.phase === "setup") {
        return i;
      }
    }
  }
  return 0;
}

export function setupComplete(boardSize: number): boolean {
  return boardSize >= SETUP_PLIES;
}

export function cloneReserves(r: Reserves): Reserves {
  return [
    { dvonn: r[0]!.dvonn, basic: r[0]!.basic },
    { dvonn: r[1]!.dvonn, basic: r[1]!.basic },
  ];
}

export function emptyReserves(): Reserves {
  return [
    { dvonn: 0, basic: 0 },
    { dvonn: 0, basic: 0 },
  ];
}

function discSerialGlyph(disc: StackDisc): string {
  if (isDvonnDisc(disc)) {
    return "D";
  }
  return disc === 1 ? "W" : "X";
}

/** Random quickstart: full setup sequence on shuffled empty cells. */
export function buildRandomSetupBoard(graph: DvonnGraph, rng?: GameRng): Map<string, CellStack> {
  const cells = graph.playableCells();
  if (cells.length !== SETUP_PLIES) {
    throw new Error(`Expected ${SETUP_PLIES} cells, got ${cells.length}`);
  }
  const shuffledCells = shuffle([...cells], rng);
  const board = new Map<string, CellStack>();
  for (let ply = 0; ply < SETUP_PLIES; ply++) {
    const disc = setupDisc(ply);
    board.set(shuffledCells[ply]!, stackFromDisc(disc));
  }
  return board;
}

export function serializeBoard(board: Map<string, CellStack>): string {
  const cells = [...board.keys()].sort();
  return cells
    .map((c) => {
      const s = board.get(c)!;
      const glyphs = s.pieces.map(discSerialGlyph).join("");
      const owner = s.owner === undefined ? "" : String(s.owner);
      return `${c}:${owner}${glyphs}`;
    })
    .join(";");
}