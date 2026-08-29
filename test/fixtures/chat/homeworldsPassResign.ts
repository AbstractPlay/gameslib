import { readFileSync } from "fs";
import { join } from "path";
import { HomeworldsGame } from "../../../src/games/homeworlds";

/** 4p passFree game with homeworlds.PASS + RESIGN chat lines (synthetic, Aug 2026). */
export function buildHomeworldsPassResignGame(): HomeworldsGame {
    const raw = readFileSync(join(__dirname, "homeworldsPassResignState.json"), "utf8");
    return new HomeworldsGame(raw);
}

export const homeworldsPassResignPlayerNames = ["Alice", "Bob", "Carol", "Dave"] as const;

export function homeworldsHasPassResult(game: HomeworldsGame): boolean {
    return game.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => r.type === "pass"),
    );
}

export function homeworldsHasResignResult(game: HomeworldsGame): boolean {
    return game.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => r.type === "resigned"),
    );
}
