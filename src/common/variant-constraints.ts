import type { Variant } from "../schemas/gameinfo.js";
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

export type { SelectableUidDef } from "./selectable-uid-constraints.js";

export type ResolveIncomingVariantsMode = ResolveIncomingUidsMode;
export type VariantConstraintReason = UidConstraintReason;
export type VariantConstraintError = UidConstraintError;
export type VariantAvailability = UidAvailability;
export type VariantSelectionState = UidSelectionState;
export type ValidateVariantSelectionResult = ValidateUidSelectionResult;

export const resolveVariantGroups = resolveUidGroups;
export const resolveSelection = resolveUidSelection;
export const isVariantSelectable = isUidSelectable;
export const evaluateAvailability = evaluateUidAvailability;
export const validateVariantSelection = validateUidSelection;
export const sanitizeVariantSelection = sanitizeUidSelection;

export function assertValidVariantSelection(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): void {
    assertValidUidSelection(variants, activeUids, "INVALID_VARIANT_COMBINATION", "variant");
}

export function resolveIncomingVariants(
    variants: Variant[] | undefined,
    incoming: string[] | undefined,
    options?: { mode?: ResolveIncomingVariantsMode },
): string[] {
    const mode = options?.mode ?? "sanitize";
    if (mode === "assert") {
        assertValidVariantSelection(variants, incoming);
        return [...(incoming ?? [])].filter((u) => !u.startsWith("#"));
    }
    return sanitizeVariantSelection(variants, incoming);
}
