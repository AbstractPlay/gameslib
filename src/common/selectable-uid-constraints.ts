import { UserFacingError } from "./errors.js";

/** Declarative constraint fields shared by variants and alternative displays. */
export interface SelectableUidDef {
    uid: string;
    group?: string;
    enabledWhen?: Record<string, string[]>;
    conflictsWith?: string[];
    requires?: string[];
    implies?: string[];
    impliesLock?: boolean;
}

export type ResolveIncomingUidsMode = "sanitize" | "assert";

export type UidConstraintReason =
    | "enabledWhen"
    | "requires"
    | "conflictsWith"
    | "duplicateGroup"
    | "unknown"
    | "impliesLock";

export interface UidConstraintError {
    uid: string;
    reason: UidConstraintReason;
    related?: string[];
}

export interface UidAvailability {
    selectable: boolean;
    reasons: UidConstraintReason[];
}

export interface UidSelectionState {
    active: string[];
    groupChoice: Record<string, string>;
}

export type ValidateUidSelectionResult =
    | { ok: true }
    | { ok: false; errors: UidConstraintError[] };

function groupSentinelUid(group: string): string {
    return `#${group}`;
}

function defByUid(defs: SelectableUidDef[] | undefined): Map<string, SelectableUidDef> {
    return new Map((defs ?? []).map((v) => [v.uid, v]));
}

function allGroups(defs: SelectableUidDef[] | undefined): Set<string> {
    const groups = new Set<string>();
    for (const v of defs ?? []) {
        if (v.group !== undefined) {
            groups.add(v.group);
        }
    }
    return groups;
}

export function resolveUidGroups(defs: SelectableUidDef[] | undefined): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const v of defs ?? []) {
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

export function resolveUidSelection(
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
): UidSelectionState {
    const byUid = defByUid(defs);
    const active = (activeUids ?? []).filter((u) => !u.startsWith("#"));
    const groupChoice: Record<string, string> = {};
    for (const group of allGroups(defs)) {
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

function symmetricConflicts(defs: SelectableUidDef[] | undefined, uid: string): Set<string> {
    const byUid = defByUid(defs);
    const conflicts = new Set<string>(byUid.get(uid)?.conflictsWith ?? []);
    for (const v of defs ?? []) {
        if (v.conflictsWith?.includes(uid)) {
            conflicts.add(v.uid);
        }
    }
    return conflicts;
}

function enabledWhenPasses(def: SelectableUidDef, groupChoice: Record<string, string>): boolean {
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

function hypotheticalSelectState(
    uid: string,
    defs: SelectableUidDef[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): UidSelectionState {
    const byUid = defByUid(defs);
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
    defs: SelectableUidDef[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): UidConstraintReason[] {
    const byUid = defByUid(defs);
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
    defs: SelectableUidDef[] | undefined,
    uid: string,
    active: string[],
): boolean {
    const activeSet = new Set(active);
    if (!activeSet.has(uid)) {
        return false;
    }
    for (const trigger of defs ?? []) {
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
    defs: SelectableUidDef[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): UidConstraintReason[] {
    const byUid = defByUid(defs);
    const def = byUid.get(uid);
    if (def === undefined) {
        return [];
    }
    const reasons: UidConstraintReason[] = [];
    const activeSet = new Set(active);

    if (!enabledWhenPasses(def, groupChoice)) {
        reasons.push("enabledWhen");
    }
    for (const req of def.requires ?? []) {
        if (!activeSet.has(req)) {
            reasons.push("requires");
        }
    }
    for (const conflict of symmetricConflicts(defs, uid)) {
        if (activeSet.has(conflict)) {
            reasons.push("conflictsWith");
            break;
        }
    }
    return reasons;
}

function constraintReasonsForState(
    uid: string,
    defs: SelectableUidDef[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): UidConstraintReason[] {
    const byUid = defByUid(defs);
    const def = byUid.get(uid);
    if (def === undefined) {
        return [];
    }
    const reasons: UidConstraintReason[] = [];
    const activeSet = new Set(active);

    if (!enabledWhenPasses(def, groupChoice)) {
        reasons.push("enabledWhen");
    }
    reasons.push(...enabledWhenBackpressureReasons(defs, active, groupChoice));
    for (const req of def.requires ?? []) {
        if (!activeSet.has(req)) {
            reasons.push("requires");
        }
    }
    for (const conflict of symmetricConflicts(defs, uid)) {
        if (activeSet.has(conflict)) {
            reasons.push("conflictsWith");
            break;
        }
    }
    return reasons;
}

function constraintReasonsForUid(
    uid: string,
    defs: SelectableUidDef[] | undefined,
    active: string[],
    groupChoice: Record<string, string>,
): UidConstraintReason[] {
    const byUid = defByUid(defs);
    const def = byUid.get(uid);
    const isActive = active.includes(uid);

    if (def?.group !== undefined) {
        const hypo = hypotheticalSelectState(uid, defs, active, groupChoice);
        return constraintReasonsForState(uid, defs, hypo.active, hypo.groupChoice);
    }

    if (isActive) {
        if (isImpliedLocked(defs, uid, active)) {
            return ["impliesLock"];
        }
        return constraintReasonsForState(uid, defs, active, groupChoice);
    }

    const hypo = hypotheticalSelectState(uid, defs, active, groupChoice);
    return constraintReasonsForState(uid, defs, hypo.active, hypo.groupChoice);
}

export function isUidSelectable(
    uid: string,
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
): boolean {
    const { active, groupChoice } = resolveUidSelection(defs, activeUids);
    return constraintReasonsForUid(uid, defs, active, groupChoice).length === 0;
}

export function evaluateUidAvailability(
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
): Map<string, UidAvailability> {
    const { active, groupChoice } = resolveUidSelection(defs, activeUids);
    const result = new Map<string, UidAvailability>();
    for (const v of defs ?? []) {
        if (v.uid.startsWith("#")) {
            continue;
        }
        const reasons = constraintReasonsForUid(v.uid, defs, active, groupChoice);
        result.set(v.uid, { selectable: reasons.length === 0, reasons });
    }
    return result;
}

function duplicateGroupErrors(
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
): UidConstraintError[] {
    const byUid = defByUid(defs);
    const seen = new Map<string, string>();
    const errors: UidConstraintError[] = [];
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

export function validateUidSelection(
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
): ValidateUidSelectionResult {
    const errors: UidConstraintError[] = [...duplicateGroupErrors(defs, activeUids)];
    const { active, groupChoice } = resolveUidSelection(defs, activeUids);
    const byUid = defByUid(defs);

    for (const uid of active) {
        if (!byUid.has(uid)) {
            errors.push({ uid, reason: "unknown" });
            continue;
        }
        for (const reason of forwardConstraintReasonsForUid(uid, defs, active, groupChoice)) {
            errors.push({ uid, reason });
        }
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true };
}

function uidsConflict(defs: SelectableUidDef[] | undefined, a: string, b: string): boolean {
    return symmetricConflicts(defs, a).has(b);
}

function resolveConflictsKeepLast(defs: SelectableUidDef[] | undefined, uids: string[]): string[] {
    const toRemove = new Set<string>();
    for (let i = 0; i < uids.length; i++) {
        for (let j = i + 1; j < uids.length; j++) {
            const a = uids[i]!;
            const b = uids[j]!;
            if (uidsConflict(defs, a, b)) {
                toRemove.add(a);
            }
        }
    }
    return uids.filter((u) => !toRemove.has(u));
}

function applyImplies(defs: SelectableUidDef[] | undefined, uids: string[]): string[] {
    const byUid = defByUid(defs);
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

function applyImpliesLock(defs: SelectableUidDef[] | undefined, uids: string[]): string[] {
    const byUid = defByUid(defs);
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

function dedupeRadioGroups(defs: SelectableUidDef[] | undefined, uids: string[]): string[] {
    const byUid = defByUid(defs);
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

function pruneInvalidUids(defs: SelectableUidDef[] | undefined, uids: string[]): string[] {
    const { active, groupChoice } = resolveUidSelection(defs, uids);
    return active.filter(
        (uid) =>
            forwardConstraintReasonsForUid(uid, defs, active, groupChoice).length === 0,
    );
}

export function sanitizeUidSelection(
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
): string[] {
    let uids = (activeUids ?? []).filter((u) => !u.startsWith("#"));
    uids = dedupeRadioGroups(defs, uids);
    uids = resolveConflictsKeepLast(defs, uids);

    let changed = true;
    let passes = 0;
    const maxPasses = 32;
    while (changed && passes < maxPasses) {
        passes++;
        changed = false;
        const withImplies = applyImplies(defs, uids);
        if (withImplies.length !== uids.length || withImplies.some((u, i) => u !== uids[i])) {
            uids = withImplies;
            changed = true;
        }
        const locked = applyImpliesLock(defs, uids);
        if (locked.length !== uids.length || locked.some((u, i) => u !== uids[i])) {
            uids = locked;
            changed = true;
        }
        const pruned = pruneInvalidUids(defs, uids);
        if (pruned.length !== uids.length || pruned.some((u, i) => u !== uids[i])) {
            uids = pruned;
            changed = true;
        }
    }
    return uids;
}

export function assertValidUidSelection(
    defs: SelectableUidDef[] | undefined,
    activeUids: string[] | undefined,
    errorCode: string,
    label: string,
): void {
    const result = validateUidSelection(defs, activeUids);
    if (!result.ok) {
        const detail = result.errors
            .map((e) => `${e.uid} (${e.reason}${e.related ? `: ${e.related.join(", ")}` : ""})`)
            .join("; ");
        throw new UserFacingError(
            errorCode,
            `Invalid ${label} combination: ${detail}`,
        );
    }
}

export function resolveIncomingUids(
    defs: SelectableUidDef[] | undefined,
    incoming: string[] | undefined,
    options?: { mode?: ResolveIncomingUidsMode },
): string[] {
    const mode = options?.mode ?? "sanitize";
    if (mode === "assert") {
        assertValidUidSelection(defs, incoming, "INVALID_SELECTION", "selection");
        return [...(incoming ?? [])].filter((u) => !u.startsWith("#"));
    }
    return sanitizeUidSelection(defs, incoming);
}
