import type { AlternativeDisplay } from "../schemas/gameinfo.js";
import {
    assertValidUidSelection,
    evaluateUidAvailability,
    isUidSelectable,
    resolveUidGroups,
    resolveUidSelection,
    sanitizeUidSelection,
    validateUidSelection,
    type ResolveIncomingUidsMode,
    type UidAvailability,
    type UidConstraintError,
    type UidConstraintReason,
    type UidSelectionState,
    type ValidateUidSelectionResult,
} from "./selectable-uid-constraints.js";

export type ResolveIncomingDisplaysMode = ResolveIncomingUidsMode;
export type DisplayConstraintReason = UidConstraintReason;
export type DisplayConstraintError = UidConstraintError;
export type DisplayAvailability = UidAvailability;
export type DisplaySelectionState = UidSelectionState;
export type ValidateDisplaySelectionResult = ValidateUidSelectionResult;

/** Composite display uids from before combinable toggles; expanded before sanitize. */
export const LEGACY_DISPLAY_EXPAND: Readonly<Record<string, readonly string[]>> = {
    "hide-both": ["hide-threatened", "hide-influence"],
};

export function expandLegacyDisplayIncoming(incoming: string[] | undefined): string[] | undefined {
    if (incoming === undefined) {
        return undefined;
    }
    const next: string[] = [];
    for (const uid of incoming) {
        const expanded = LEGACY_DISPLAY_EXPAND[uid];
        if (expanded !== undefined) {
            next.push(...expanded);
        } else {
            next.push(uid);
        }
    }
    return next;
}

export const resolveDisplayGroups = resolveUidGroups;
export const resolveDisplaySelection = resolveUidSelection;
export const isDisplaySelectable = isUidSelectable;
export const evaluateDisplayAvailability = evaluateUidAvailability;

export function validateDisplaySelection(
    displays: AlternativeDisplay[] | undefined,
    activeUids: string[] | undefined,
): ValidateDisplaySelectionResult {
    return validateUidSelection(displays, expandLegacyDisplayIncoming(activeUids));
}

export function sanitizeDisplaySelection(
    displays: AlternativeDisplay[] | undefined,
    activeUids: string[] | undefined,
): string[] {
    return sanitizeUidSelection(displays, expandLegacyDisplayIncoming(activeUids));
}

export function assertValidDisplaySelection(
    displays: AlternativeDisplay[] | undefined,
    activeUids: string[] | undefined,
): void {
    assertValidUidSelection(
        displays,
        expandLegacyDisplayIncoming(activeUids),
        "INVALID_DISPLAY_COMBINATION",
        "display",
    );
}

export function resolveIncomingDisplays(
    displays: AlternativeDisplay[] | undefined,
    incoming: string[] | undefined,
    options?: { mode?: ResolveIncomingDisplaysMode },
): string[] {
    const expanded = expandLegacyDisplayIncoming(incoming);
    const mode = options?.mode ?? "sanitize";
    if (mode === "assert") {
        assertValidDisplaySelection(displays, expanded);
        return [...(expanded ?? [])].filter((u) => !u.startsWith("#"));
    }
    return sanitizeDisplaySelection(displays, expanded);
}
