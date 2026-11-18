import type { FlagContext, GameFlag } from "../common/flags.js";
import type { GameBase } from "./_base.js";
import { games } from "./_registry.generated.js";

function resolvedFlags(uid: string, context: FlagContext): readonly GameFlag[] {
    const ctor = games.get(uid);
    if (ctor === undefined) {
        return [];
    }
    return ctor.resolveFlags(context);
}

/**
 * Whether this session uses the simultaneous submit / partial-move protocol.
 * Canonical source: effective `simultaneous` flag from `getFlags()` or `resolveGameFlags` —
 * not `turnModel()` or static `gameinfo.flags`.
 */
export function sessionIsSimultaneous(
    engine: GameBase | null | undefined,
    uid: string,
    context: FlagContext = {},
): boolean {
    if (engine != null) {
        return engine.getFlags().includes("simultaneous");
    }
    return resolvedFlags(uid, context).includes("simultaneous");
}
