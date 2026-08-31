import type { GameBase, IIndividualState, IAPGameState } from "../games/_base.js";

export type SoloReplayFactory = (seed: string, variants?: string[]) => GameBase;

/**
 * Apply committed moves from stack[1] through stack[targetIndex - 1] on a fresh
 * seeded instance. Requires the game to expose moves via `stack[n].lastmove`.
 */
export function replayToStackIndex(game: GameBase, targetIndex: number): GameBase {
    const seed = game.getChallengeSeed();
    if (seed === undefined) {
        throw new Error("replayToStackIndex requires a game with challengeSeed");
    }
    if (targetIndex < 0 || targetIndex > game.stack.length) {
        throw new Error(`Invalid targetIndex ${targetIndex} for stack length ${game.stack.length}`);
    }

    const ctor = game.constructor as typeof GameBase & {
        create: (state?: string) => GameBase;
        gameinfo: { uid: string };
    };
    const initialState: IAPGameState = {
        game: ctor.gameinfo.uid,
        numplayers: game.numplayers,
        variants: [...game.variants],
        gameover: false,
        winner: [],
        challengeSeed: seed,
        stack: [game.stack[0]],
    };
    const fresh = ctor.create(JSON.stringify(initialState));

    for (let i = 1; i < targetIndex; i++) {
        const entry = game.stack[i] as IIndividualState & { lastmove?: string };
        const move = entry.lastmove;
        if (move === undefined || move.length === 0) {
            throw new Error(`stack[${i}] has no lastmove for replay`);
        }
        fresh.move(move, { trusted: true });
    }

    return fresh;
}

/** Validate seed + moves reproduce a golden stack snapshot (tests / recranks). */
export function assertReplayMatches(
    factory: SoloReplayFactory,
    seed: string,
    moves: string[],
    goldenStack: IIndividualState[],
    variants: string[] = [],
): void {
    const game = factory(seed, variants);
    for (const move of moves) {
        game.move(move, { trusted: true });
    }

    if (game.stack.length !== goldenStack.length) {
        throw new Error(
            `Replay stack length ${game.stack.length} !== golden ${goldenStack.length}`,
        );
    }

    for (let i = 0; i < goldenStack.length; i++) {
        const actual = game.stack[i] as Record<string, unknown>;
        const expected = goldenStack[i] as Record<string, unknown>;
        const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
        for (const key of keys) {
            if (key === "_timestamp" || key === "_version" || key === "_results") {
                continue;
            }
            const a = actual[key];
            const e = expected[key];
            if (JSON.stringify(a) !== JSON.stringify(e)) {
                throw new Error(`stack[${i}].${key}: ${JSON.stringify(a)} !== ${JSON.stringify(e)}`);
            }
        }
    }
}
