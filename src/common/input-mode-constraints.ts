import type { InputMode } from "../schemas/gameinfo.js";
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

export type ResolveIncomingInputModesMode = ResolveIncomingUidsMode;
export type InputModeConstraintReason = UidConstraintReason;
export type InputModeConstraintError = UidConstraintError;
export type InputModeAvailability = UidAvailability;
export type InputModeSelectionState = UidSelectionState;
export type ValidateInputModeSelectionResult = ValidateUidSelectionResult;

export const resolveInputModeGroups = resolveUidGroups;
export const resolveInputModeSelection = resolveUidSelection;
export const isInputModeSelectable = isUidSelectable;
export const evaluateInputModeAvailability = evaluateUidAvailability;

export function validateInputModeSelection(
    modes: InputMode[] | undefined,
    activeUids: string[] | undefined,
): ValidateInputModeSelectionResult {
    return validateUidSelection(modes, activeUids);
}

export function sanitizeInputModeSelection(
    modes: InputMode[] | undefined,
    activeUids: string[] | undefined,
): string[] {
    return sanitizeUidSelection(modes, activeUids);
}

export function assertValidInputModeSelection(
    modes: InputMode[] | undefined,
    activeUids: string[] | undefined,
): void {
    assertValidUidSelection(modes, activeUids, "INVALID_INPUT_MODE_COMBINATION", "input mode");
}

/**
 * Resolve stored preference to at most one valid mode uid, or undefined when the game has no input modes.
 * Uses constraint sanitization; if nothing survives (unknown/invalid stored value), picks the first
 * non-`#group` sentinel from gameinfo.
 */
export function sanitizeInputModeForGame(
    modes: InputMode[] | undefined,
    stored: string | null | undefined,
): string | undefined {
    if (modes === undefined || modes.length === 0) {
        return undefined;
    }
    const known = new Set(modes.map((m) => m.uid));
    const raw =
        stored !== undefined && stored !== null && String(stored).length > 0
            ? [String(stored)]
            : [];
    const incoming = raw.filter((u) => known.has(u));
    const sanitized = sanitizeUidSelection(modes, incoming);
    if (sanitized.length > 0) {
        return sanitized[0];
    }
    const first = modes.find((m) => !m.uid.startsWith("#"));
    return first?.uid;
}

export function resolveIncomingInputModes(
    modes: InputMode[] | undefined,
    incoming: string[] | undefined,
    options?: { mode?: ResolveIncomingInputModesMode },
): string[] {
    const mode = options?.mode ?? "sanitize";
    if (mode === "assert") {
        assertValidInputModeSelection(modes, incoming);
        return [...(incoming ?? [])].filter((u) => !u.startsWith("#"));
    }
    return sanitizeInputModeSelection(modes, incoming);
}
