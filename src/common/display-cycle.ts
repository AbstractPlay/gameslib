import type { AlternativeDisplay } from "../schemas/gameinfo.js";
import { resolveUidGroups } from "./selectable-uid-constraints.js";

/**
 * True when the game supports FAB cycling between default and one radio group only
 * (e.g. default isometric vs flat). False when any ungrouped checkbox display exists.
 */
export function isSimpleDisplayCycleGame(displays: AlternativeDisplay[] | undefined): boolean {
    if (displays === undefined || displays.length === 0) {
        return false;
    }
    for (const d of displays) {
        if (d.uid.startsWith("#")) {
            continue;
        }
        if (d.group === undefined) {
            return false;
        }
    }
    const groups = resolveUidGroups(displays);
    if (groups.size !== 1) {
        return false;
    }
    const members = [...groups.values()][0]!;
    return members.length >= 2;
}

/**
 * Ordered cycle steps as active display uid lists (empty = default renderer).
 * Only defined when {@link isSimpleDisplayCycleGame} is true.
 */
export function displayCycleSteps(displays: AlternativeDisplay[] | undefined): string[][] {
    if (!isSimpleDisplayCycleGame(displays)) {
        return [];
    }
    const groups = resolveUidGroups(displays);
    const members = [...groups.values()][0]!;
    const steps: string[][] = [[]];
    for (const uid of members) {
        if (!uid.startsWith("#")) {
            steps.push([uid]);
        }
    }
    return steps;
}

/** Next step after `currentActive` in the cycle; wraps at end. */
export function nextDisplayCycleStep(
    displays: AlternativeDisplay[] | undefined,
    currentActive: string[] | undefined,
): string[] {
    const steps = displayCycleSteps(displays);
    if (steps.length === 0) {
        return currentActive ?? [];
    }
    const normalized = currentActive ?? [];
    const key = (a: string[]) => a.slice().sort().join("\0");
    const currentKey = key(normalized);
    let idx = steps.findIndex((s) => key(s) === currentKey);
    if (idx < 0) {
        idx = 0;
    }
    return steps[(idx + 1) % steps.length]!;
}
