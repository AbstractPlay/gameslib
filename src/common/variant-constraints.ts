import type { Variant } from "../schemas/gameinfo.js";
import { UserFacingError } from "./errors.js";

export type ResolveIncomingVariantsMode = "sanitize" | "assert";

export type VariantConstraintReason =
    | "enabledWhen"
    | "requires"
    | "conflictsWith"
    | "duplicateGroup"
    | "unknown"
    | "impliesLock";

export interface VariantConstraintError {
    uid: string;
    reason: VariantConstraintReason;
    /** Other uids involved (conflict target, missing requirement, duplicate peer, etc.) */
    related?: string[];
}

export interface VariantAvailability {
    selectable: boolean;
    reasons: VariantConstraintReason[];
}

export interface VariantSelectionState {
    /** Active uids excluding `#group` sentinels */
    active: string[];
    /** Resolved radio choice per group (includes `#group` when no member is active) */
    groupChoice: Record<string, string>;
}

export type ValidateVariantSelectionResult =
    | { ok: true }
    | { ok: false; errors: VariantConstraintError[] };

function groupSentinelUid(group: string): string {
    return `#${group}`;
}

function variantByUid(variants: Variant[] | undefined): Map<string, Variant> {
    return new Map((variants ?? []).map((v) => [v.uid, v]));
}

function allGroups(variants: Variant[] | undefined): Set<string> {
    const groups = new Set<string>();
    for (const v of variants ?? []) {
        if (v.group !== undefined) {
            groups.add(v.group);
        }
    }
    return groups;
}

/**
 * Build group → member uid lists from variant definitions (including explicit `#group` entries).
 */
export function resolveVariantGroups(variants: Variant[] | undefined): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const v of variants ?? []) {
        if (v.group === undefined) {
            continue;
        }
        const list = groups.get(v.group) ?? [];
        list.push(v.uid);
        groups.set(v.group, list);
    }
    for (const group of groups.keys()) {
        const list = groups.get(group)!;
        if (!list.includes(groupSentinelUid(group))) {
            list.unshift(groupSentinelUid(group));
        }
    }
    return groups;
}

/**
 * Derive active uids and per-group radio choices from a submitted uid list.
 */
export function resolveSelection(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): VariantSelectionState {
    const byUid = variantByUid(variants);
    const active = (activeUids ?? []).filter((u) => !u.startsWith("#"));
    const groupChoice: Record<string, string> = {};
    for (const group of allGroups(variants)) {
        groupChoice[group] = groupSentinelUid(group);
    }
    for (const uid of active) {
        const def = byUid.get(uid);
        if (def?.group !== undefined) {
            groupChoice[def.group] = uid;
        }
    }
    return { active, groupChoice };
}

function symmetricConflicts(variants: Variant[] | undefined, uid: string): Set<string> {
    const byUid = variantByUid(variants);
    const conflicts = new Set<string>(byUid.get(uid)?.conflictsWith ?? []);
    for (const v of variants ?? []) {
        if (v.conflictsWith?.includes(uid)) {
            conflicts.add(v.uid);
        }
    }
    return conflicts;
}

function enabledWhenPasses(def: Variant, groupChoice: Record<string, string>): boolean {
    if (def.enabledWhen === undefined) {
        return true;
    }
    for (const [group, allowed] of Object.entries(def.enabledWhen)) {
        const current = groupChoice[group];
        if (current === undefined || !allowed.includes(current)) {
            return false;
        }
    }
    return true;
}

/** State if the user selected this uid (radio choice or checkbox on). */
function hypotheticalSelectState(
    uid: string,
    variants: Variant[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): VariantSelectionState {
    const byUid = variantByUid(variants);
    const def = byUid.get(uid);
    if (def?.group !== undefined) {
        const nextGroupChoice = { ...groupChoice, [def.group]: uid };
        const nextActive = active.filter((u) => byUid.get(u)?.group !== def.group);
        if (!uid.startsWith("#")) {
            nextActive.push(uid);
        }
        return { active: nextActive, groupChoice: nextGroupChoice };
    }
    if (active.includes(uid)) {
        return { active: [...active], groupChoice: { ...groupChoice } };
    }
    return { active: [...active, uid], groupChoice: { ...groupChoice } };
}

function enabledWhenBackpressureReasons(
    variants: Variant[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): VariantConstraintReason[] {
    const byUid = variantByUid(variants);
    for (const uid of active) {
        const activeDef = byUid.get(uid);
        if (activeDef?.enabledWhen === undefined) {
            continue;
        }
        if (!enabledWhenPasses(activeDef, groupChoice)) {
            return ["enabledWhen"];
        }
    }
    return [];
}

function isImpliedLocked(
    variants: Variant[] | undefined,
    uid: string,
    active: string[],
): boolean {
    const activeSet = new Set(active);
    if (!activeSet.has(uid)) {
        return false;
    }
    for (const trigger of variants ?? []) {
        if (!activeSet.has(trigger.uid) || trigger.implies === undefined) {
            continue;
        }
        if (trigger.impliesLock && trigger.implies.includes(uid)) {
            return true;
        }
    }
    return false;
}

function forwardConstraintReasonsForUid(
    uid: string,
    variants: Variant[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): VariantConstraintReason[] {
    const byUid = variantByUid(variants);
    const def = byUid.get(uid);
    if (def === undefined) {
        return [];
    }
    const reasons: VariantConstraintReason[] = [];
    const activeSet = new Set(active);

    if (!enabledWhenPasses(def, groupChoice)) {
        reasons.push("enabledWhen");
    }
    for (const req of def.requires ?? []) {
        if (!activeSet.has(req)) {
            reasons.push("requires");
        }
    }
    for (const conflict of symmetricConflicts(variants, uid)) {
        if (activeSet.has(conflict)) {
            reasons.push("conflictsWith");
            break;
        }
    }
    return reasons;
}

function constraintReasonsForState(
    uid: string,
    variants: Variant[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): VariantConstraintReason[] {
    const byUid = variantByUid(variants);
    const def = byUid.get(uid);
    if (def === undefined) {
        return [];
    }
    const reasons: VariantConstraintReason[] = [];
    const activeSet = new Set(active);

    if (!enabledWhenPasses(def, groupChoice)) {
        reasons.push("enabledWhen");
    }
    reasons.push(...enabledWhenBackpressureReasons(variants, active, groupChoice));
    for (const req of def.requires ?? []) {
        if (!activeSet.has(req)) {
            reasons.push("requires");
        }
    }
    for (const conflict of symmetricConflicts(variants, uid)) {
        if (activeSet.has(conflict)) {
            reasons.push("conflictsWith");
            break;
        }
    }
    return reasons;
}

function constraintReasonsForUid(
    uid: string,
    variants: Variant[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): VariantConstraintReason[] {
    const byUid = variantByUid(variants);
    const def = byUid.get(uid);
    const isActive = active.includes(uid);

    if (def?.group !== undefined) {
        const hypo = hypotheticalSelectState(uid, variants, active, groupChoice);
        return constraintReasonsForState(uid, variants, hypo.active, hypo.groupChoice);
    }

    if (isActive) {
        if (isImpliedLocked(variants, uid, active)) {
            return ["impliesLock"];
        }
        return constraintReasonsForState(uid, variants, active, groupChoice);
    }

    const hypo = hypotheticalSelectState(uid, variants, active, groupChoice);
    return constraintReasonsForState(uid, variants, hypo.active, hypo.groupChoice);
}

/**
 * Whether a single variant uid may appear in the active selection.
 */
export function isVariantSelectable(
    uid: string,
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): boolean {
    const { active, groupChoice } = resolveSelection(variants, activeUids);
    return constraintReasonsForUid(uid, variants, active, groupChoice).length === 0;
}

/**
 * Per-variant availability for UI disable states.
 */
export function evaluateAvailability(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): Map<string, VariantAvailability> {
    const { active, groupChoice } = resolveSelection(variants, activeUids);
    const result = new Map<string, VariantAvailability>();
    for (const v of variants ?? []) {
        if (v.uid.startsWith("#")) {
            continue;
        }
        const reasons = constraintReasonsForUid(v.uid, variants, active, groupChoice);
        result.set(v.uid, { selectable: reasons.length === 0, reasons });
    }
    return result;
}

function duplicateGroupErrors(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): VariantConstraintError[] {
    const byUid = variantByUid(variants);
    const seen = new Map<string, string>();
    const errors: VariantConstraintError[] = [];
    for (const uid of activeUids ?? []) {
        if (uid.startsWith("#")) {
            continue;
        }
        const group = byUid.get(uid)?.group;
        if (group === undefined) {
            continue;
        }
        const prior = seen.get(group);
        if (prior !== undefined) {
            errors.push({ uid, reason: "duplicateGroup", related: [prior] });
        } else {
            seen.set(group, uid);
        }
    }
    return errors;
}

/**
 * Non-throwing validation of a variant uid list against declarative constraints.
 */
export function validateVariantSelection(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): ValidateVariantSelectionResult {
    const errors: VariantConstraintError[] = [...duplicateGroupErrors(variants, activeUids)];
    const { active, groupChoice } = resolveSelection(variants, activeUids);
    const byUid = variantByUid(variants);

    for (const uid of active) {
        if (!byUid.has(uid)) {
            errors.push({ uid, reason: "unknown" });
            continue;
        }
        for (const reason of forwardConstraintReasonsForUid(uid, variants, active, groupChoice)) {
            errors.push({ uid, reason });
        }
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true };
}

function uidsConflict(variants: Variant[] | undefined, a: string, b: string): boolean {
    return symmetricConflicts(variants, a).has(b);
}

/**
 * When two active uids conflict, drop the earlier-listed one.
 */
function resolveConflictsKeepLast(variants: Variant[] | undefined, uids: string[]): string[] {
    const toRemove = new Set<string>();
    for (let i = 0; i < uids.length; i++) {
        for (let j = i + 1; j < uids.length; j++) {
            const a = uids[i]!;
            const b = uids[j]!;
            if (uidsConflict(variants, a, b)) {
                toRemove.add(a);
            }
        }
    }
    return uids.filter((u) => !toRemove.has(u));
}

function applyImplies(variants: Variant[] | undefined, uids: string[]): string[] {
    const byUid = variantByUid(variants);
    const next = [...uids];
    const activeSet = new Set(next);
    let changed = true;
    while (changed) {
        changed = false;
        for (const uid of [...next]) {
            for (const implied of byUid.get(uid)?.implies ?? []) {
                if (!activeSet.has(implied)) {
                    next.push(implied);
                    activeSet.add(implied);
                    changed = true;
                }
            }
        }
    }
    return next;
}

function applyImpliesLock(variants: Variant[] | undefined, uids: string[]): string[] {
    const byUid = variantByUid(variants);
    const next = [...uids];
    const activeSet = new Set(next);
    for (const uid of next) {
        const def = byUid.get(uid);
        if (def?.impliesLock !== true || def.implies === undefined) {
            continue;
        }
        for (const implied of def.implies) {
            if (!activeSet.has(implied)) {
                next.push(implied);
                activeSet.add(implied);
            }
        }
    }
    return next;
}

function dedupeRadioGroups(variants: Variant[] | undefined, uids: string[]): string[] {
    const byUid = variantByUid(variants);
    const lastIndexByGroup = new Map<string, number>();
    uids.forEach((uid, index) => {
        const group = byUid.get(uid)?.group;
        if (group !== undefined) {
            lastIndexByGroup.set(group, index);
        }
    });
    return uids.filter((uid, index) => {
        const group = byUid.get(uid)?.group;
        if (group === undefined) {
            return true;
        }
        return lastIndexByGroup.get(group) === index;
    });
}

function pruneInvalidUids(variants: Variant[] | undefined, uids: string[]): string[] {
    const { active, groupChoice } = resolveSelection(variants, uids);
    return active.filter(
        (uid) =>
            forwardConstraintReasonsForUid(uid, variants, active, groupChoice).length === 0,
    );
}

/**
 * Keep the last-listed uid per radio group; drop uids that violate constraints.
 */
export function sanitizeVariantSelection(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): string[] {
    let uids = (activeUids ?? []).filter((u) => !u.startsWith("#"));
    uids = dedupeRadioGroups(variants, uids);
    uids = resolveConflictsKeepLast(variants, uids);

    let changed = true;
    let passes = 0;
    const maxPasses = 32;
    while (changed && passes < maxPasses) {
        passes++;
        changed = false;
        const withImplies = applyImplies(variants, uids);
        if (withImplies.length !== uids.length || withImplies.some((u, i) => u !== uids[i])) {
            uids = withImplies;
            changed = true;
        }
        const locked = applyImpliesLock(variants, uids);
        if (locked.length !== uids.length || locked.some((u, i) => u !== uids[i])) {
            uids = locked;
            changed = true;
        }
        const pruned = pruneInvalidUids(variants, uids);
        if (pruned.length !== uids.length || pruned.some((u, i) => u !== uids[i])) {
            uids = pruned;
            changed = true;
        }
    }
    return uids;
}

/**
 * Throw when the selection violates declarative variant constraints.
 */
export function assertValidVariantSelection(
    variants: Variant[] | undefined,
    activeUids: string[] | undefined,
): void {
    const result = validateVariantSelection(variants, activeUids);
    if (!result.ok) {
        const detail = result.errors
            .map((e) => `${e.uid} (${e.reason}${e.related ? `: ${e.related.join(", ")}` : ""})`)
            .join("; ");
        throw new UserFacingError(
            "INVALID_VARIANT_COMBINATION",
            `Invalid variant combination: ${detail}`,
        );
    }
}

/**
 * Constructor entry point: sanitize by default, or assert when callers expect upstream validation.
 */
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
