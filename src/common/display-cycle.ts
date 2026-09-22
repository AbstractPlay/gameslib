import type { AlternativeDisplay } from "../schemas/gameinfo.js";
import { resolveUidGroups } from "./selectable-uid-constraints.js";

/** Non-sentinel display defs from gameinfo (excludes `#group` uids if ever declared). */
function realDisplayDefs(displays: AlternativeDisplay[]): AlternativeDisplay[] {
    return displays.filter((d) => !d.uid.startsWith("#"));
}

/**
 * True when the board FAB may cycle a simple on/off or default-vs-one-choice pattern:
 * - exactly one ungrouped display (checkbox toggle), or
 * - every display in a single radio group with at least default + one member.
 * False when multiple independent toggles could combine (ungrouped count ≠ 1).
 */
export function isSimpleDisplayCycleGame(displays: AlternativeDisplay[] | undefined): boolean {
    if (displays === undefined || displays.length === 0) {
        return false;
    }
    const real = realDisplayDefs(displays);
    if (real.length === 0) {
        return false;
    }
    const ungrouped = real.filter((d) => d.group === undefined);
    const grouped = real.filter((d) => d.group !== undefined);
    if (ungrouped.length === 1 && grouped.length === 0) {
        return true;
    }
    if (ungrouped.length > 0) {
        return false;
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
    const real = realDisplayDefs(displays ?? []);
    const ungrouped = real.filter((d) => d.group === undefined);
    if (ungrouped.length === 1) {
        return [[], [ungrouped[0]!.uid]];
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
