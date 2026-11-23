import type { CellStack, playerid, Reserves, SeatReserves, StackDisc } from "./types.js";
import { PIECES_PER_PLAYER, SETUP_PLIES } from "./types.js";
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
    return { kind: "dvonn" };
  }
  const owner = setupActor(plyIndex);
  return { kind: "basic", owner };
}

export function reserveForDisc(reserves: Reserves, player: playerid, disc: StackDisc): boolean {
  const seat = reserves[player - 1]!;
  if (disc.kind === "dvonn") {
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
  if (disc.kind === "dvonn") {
    return { pieces: [disc] };
  }
  return { owner: disc.owner, pieces: [disc] };
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