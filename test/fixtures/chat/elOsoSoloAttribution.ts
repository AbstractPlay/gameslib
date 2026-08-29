import { ElOsoGame } from "../../../src/games/elOso";

/** Fixed seed used across El Oso setup / bear attribution tests. */
export const elOsoAttributionSeed = "el-oso-setup-20260827";

export const elOsoSoloPlayerNames = ["Alice"] as const;

/** Fresh game at opening — setup rolls and placements. */
export function buildElOsoSetupGame(): ElOsoGame {
    return new ElOsoGame(undefined, elOsoAttributionSeed);
}

/** After one bear ply — label actors for bear moves, not seat 2. */
export function buildElOsoAfterBearMoveGame(): ElOsoGame {
    const g = new ElOsoGame(undefined, elOsoAttributionSeed);
    g.move("c1-pass", { trusted: true });
    return g;
}
