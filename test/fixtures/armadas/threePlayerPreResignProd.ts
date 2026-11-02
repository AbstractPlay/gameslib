import { ArmadasGame } from "../../../src/games/armadas";
import { Ship } from "../../../src/games/armadas/ship";

/** Prod game e9dbcad8-702e-4efa-89ac-0be955b00de9 immediately before P1 resigned (playground move 39). */
export const ARMADAS_PROD_PRE_RESIGN_GAME_ID = "e9dbcad8-702e-4efa-89ac-0be955b00de9";

export function playersWithShips(g: ArmadasGame): number[] {
    const withShips: number[] = [];
    for (let p = 1; p <= g.numplayers; p++) {
        if (g.ships.some((s) => s.owner === p)) {
            withShips.push(p);
        }
    }
    return withShips;
}

/**
 * Board after P2 sank P3's last ship (Ajespo); P1 still has Quohin; P2 holds the only other fleet.
 * Game not over because rules EOG requires one player to own every ship on the board.
 */
export function buildArmadasThreePlayerPreResignProd(): ArmadasGame {
    const g = new ArmadasGame(3, ["twoislands"]);
    g.load(-1);
    g.phase = "play";
    g.gameover = false;
    g.winner = [];
    g.currplayer = 1;
    g.lastmove =
        "Phiyap move 93.26 69.7 144.7, Phiyap attack Ajespo, Thoospe move 169.14 174.28";
    g.ships = [
        new Ship({ id: "Quohin", owner: 1, size: 3, cx: 470.41002, cy: 695.78075, facing: 254.06 }),
        new Ship({ id: "Thoospe", owner: 2, size: 3, cx: 292.82636, cy: 336.74366, facing: 174.28 }),
        new Ship({ id: "Tyevo", owner: 2, size: 1, cx: 328.50373, cy: 321.59668, facing: 201.35 }),
        new Ship({ id: "Atretev", owner: 2, size: 3, cx: 502.52429, cy: 277.37014, facing: 248.96, dmg: 2 }),
        new Ship({ id: "Phiyap", owner: 2, size: 2, cx: 326.61145, cy: 586.40182, facing: 144.7, dmg: 1 }),
        new Ship({ id: "Ocrichraf", owner: 2, size: 1, cx: 588.6332, cy: 453.17816, facing: 224.95 }),
    ];
    g.ghosts = [];
    g.results = [];

    const top = g.stack[g.stack.length - 1]!;
    top.phase = "play";
    top.currplayer = 1;
    top.lastmove = g.lastmove;
    top.ships = g.ships.map((s) => Ship.deserialize(s));
    top.ghosts = [];
    top._results = [];

    return g;
}
