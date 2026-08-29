import { CanoeGame, CubeFace } from "../../../src/games/canoe";

type StackCell = [string, { owner: 1 | 2; face: CubeFace; set?: boolean }];

function playCanoeFixture(
    board: StackCell[],
    opts: {
        currplayer?: 1 | 2;
        roll?: [number, number] | [number];
        firstPlayer?: 1 | 2;
        phase?: "setup-1" | "setup-2" | "play";
    } = {},
): CanoeGame {
    const gridCubes = [16, 8] as [CubeFace, CubeFace];
    const state = {
        game: "canoe",
        numplayers: 2,
        variants: [] as string[],
        gameover: false,
        winner: [] as number[],
        stack: [{
            _version: CanoeGame.gameinfo.version,
            _results: [],
            _timestamp: "2026-07-25T00:00:00.000Z",
            currplayer: opts.currplayer ?? 1,
            phase: opts.phase ?? "play",
            board: {
                dataType: "Map",
                value: board.map(([cell, stack]) => [cell, { ...stack, set: stack.set ?? false }]),
            },
            roll: opts.roll,
            gridCubes,
            pocket: [0, 0],
            canoeDone: true,
            firstPlayer: opts.firstPlayer ?? 1,
        }],
    };
    return new CanoeGame(JSON.stringify(state));
}

/** After a full move, end-of-turn roll is attributed to the upcoming player. */
export function buildCanoeEndOfTurnRollGame(): CanoeGame {
    const g = playCanoeFixture(
        [
            ["e5", { owner: 1, face: 16 }],
            ["c7", { owner: 1, face: 8 }],
        ],
        { phase: "play", roll: [3, 5], firstPlayer: 1, currplayer: 1 },
    );
    const full = g.moves().find((m) => m.includes(","));
    if (full === undefined) {
        throw new Error("expected composite move");
    }
    g.move(full, { trusted: true });
    return g;
}

/** Stymie roll is attributed to the active player. */
export function buildCanoeStymieRollGame(): CanoeGame {
    const g = playCanoeFixture(
        [
            ["c3", { owner: 1, face: 8 }],
            ["c5", { owner: 1, face: 8 }],
        ],
        { phase: "play", currplayer: 1 },
    );
    g.move("roll:1", { trusted: true });
    return g;
}

export const canoeRollPlayerNames = ["Alice", "Bob"] as const;
