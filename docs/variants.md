# Variants

Game authors declare optional rules in `gameinfo.variants`. The front end uses `group` to render **radio** groups (mutually exclusive) versus independent **checkboxes**. Declarative **constraint fields** tell the challenge picker, API validation, and game constructor when combinations are invalid.

See also [Flags](/gameslib/flags/) — flags describe session capabilities; variant constraints describe which uids may be selected together.

## Overview

Each entry in `gameinfo.variants` is a `Variant` object (see [`gameinfo.json`](/gameslib/src/schemas/gameinfo.json)):

| Field | Purpose |
|-------|---------|
| `uid` | Stable identifier stored in `state.variants` and sent to the API |
| `group` | When present, mutually exclusive with other variants in the same group (radio UI) |
| `default` | `true` on the default radio choice for that group, or on a checkbox to start checked in the challenge picker |
| `#group` sentinel | `{ uid: "#board" }` marks the implicit default for group `board` when no member uid is in the submitted array |
| `experimental` | Omitted from production `gameinfo` and `challengeVariants()` (see [Flags](/gameslib/flags/)) |
| `unrated` | Challenge is not rated when this variant is active |

**Radio vs checkbox:** a `group` field → one active uid per group (radio). No `group` → optional checkbox.

**Submitted arrays:** clients send `variants: string[]` with concrete uids only — never `#group` sentinels. The evaluator derives implicit group defaults from missing group members.

**Who consumes constraints:**

| Layer | Behaviour |
|-------|-----------|
| Front `GameVariants` | Disables invalid controls; auto-sanitizes selection |
| Challenge / tournament / solo API | Rejects invalid combinations (`INVALID_VARIANT_COMBINATION`) |
| Game constructor (fresh init) | `applyVariantConstraints()` drops invalid uids |

## Declaring constraints

| Field | Type | Meaning |
|-------|------|---------|
| `enabledWhen` | `Record<group, uid[]>` | Selectable only when every listed group's current choice is in the allowed list (include `#group` for default). **Back-pressure:** while this variant is active, options in gated groups that would violate its `enabledWhen` are disabled in the UI. |
| `conflictsWith` | `uid[]` | Not selectable while any listed uid is active (evaluator treats this as **symmetric**) |
| `requires` | `uid[]` | Selectable only when all listed uids are also active |
| `implies` | `uid[]` | When this variant is active, `sanitize` / the picker add the listed uids (soft auto-select). Not applied in API `assert` validation. |
| `impliesLock` | `boolean` | With `implies`: implied checkboxes cannot be unchecked while this variant is active; sanitize re-adds them. |

**Evaluation rule** (all must pass for a uid to be selectable):

```
selectable(uid) =
  enabledWhen gates pass
  AND requires ⊆ active
  AND conflictsWith ∩ active = ∅
```

**Baseline group rule:** at most one active uid per `group`. If multiple uids from the same group appear in a submitted array, `sanitizeVariantSelection` keeps the last-listed; `assertValidVariantSelection` fails. This covers games that previously threw manually when two board variants were passed.

### LOA — radio disables another group's option

```typescript
variants: [
    { uid: "classic", group: "board", default: true },
    { uid: "#board" },
    { uid: "hex5", group: "board" },
    { uid: "hex6", group: "board" },
    {
        uid: "scrambled",
        group: "setup",
        enabledWhen: { board: ["#board", "classic"] },
    },
],
```

`scrambled` is not offered when `hex5` or `hex6` is the board choice. While `scrambled` is active, hex boards are disabled automatically (back-pressure from `enabledWhen` — no extra metadata on hex variants).

### Druid — optional rule gated by board shape

```typescript
variants: [
    { uid: "size-8", group: "board" },
    { uid: "#board" },
    { uid: "size-12", group: "board" },
    // … y-* and hex-* board options …
    {
        uid: "walk",
        group: "ruleset",
        enabledWhen: { board: ["#board", "size-8", "size-12"] },
    },
],
```

`walk` applies only on rectangular boards (default or explicit `size-*` variants).

### Frogger-shaped — checkbox requires checkbox

```typescript
{ uid: "courts" },
{ uid: "courtpawns", requires: ["courts"] },
```

### Pairwise conflict

```typescript
{ uid: "advanced" },
{ uid: "beginner-mode", conflictsWith: ["advanced"] },
```

### Magnate — checkbox requires checkbox

```typescript
{ uid: "mega" },
{ uid: "stacked", requires: ["mega"] },
```

`stacked` only affects deck split when `mega` is also active.

### Auto-select — `implies` / `impliesLock`

```typescript
{ uid: "mega", implies: ["stacked"], impliesLock: true },
{ uid: "stacked", requires: ["mega"] },
```

Selecting `mega` auto-checks `stacked`. With `impliesLock`, the user cannot uncheck `stacked` while `mega` remains on.

### Minefield — redundant tile sets

```typescript
{ uid: "pinwheel", conflictsWith: ["cartwheel"] },
{ uid: "cartwheel", experimental: true },
```

`cartwheel` is a superset of `pinwheel`; selecting both is redundant.

## Constructor helper

Game authors apply constraints when `GameFactory(uid, state, variants)` runs on a **fresh** game. Do **not** re-sanitize `state.variants` when deserializing a saved game — historical records may predate metadata or include combinations the engine already played.

| Layer | API | When |
|-------|-----|------|
| Fresh game init | `this.applyVariantConstraints(variants)` | `state === undefined` in constructor |
| Loaded game | assign `state.variants` as-is | deserialize / resume |
| Standalone (tests, tooling) | `resolveIncomingVariants(gameinfo.variants, uids)` | outside `GameBase` |

### Before / after (LOA)

```typescript
// ❌ Manual filter — duplicates metadata, easy to drift
if (variants !== undefined && variants.length > 0) {
    this.variants = [...variants];
    if (this.variants.includes("hex5")) {
        this.variants = this.variants.filter((v) => v !== "scrambled");
    }
}

// ✅ Declarative metadata + shared helper
if (variants !== undefined && variants.length > 0) {
    this.variants = this.applyVariantConstraints(variants);
}
```

### Before / after (Druid)

```typescript
// ❌ Private sanitizeVariants() reimplementing enabledWhen
this.variants = [...variants];
this.sanitizeVariants();

// ✅
this.variants = this.applyVariantConstraints(variants);
```

### `resolveIncomingVariants` modes

```typescript
import { resolveIncomingVariants } from "@abstractplay/gameslib";

// Default: sanitize (constructor behaviour)
const cleaned = resolveIncomingVariants(MyGame.gameinfo.variants, ["hex5", "scrambled"]);
// → ["hex5"]  (scrambled dropped)

// Strict: throw if invalid (API guards, tests)
resolveIncomingVariants(MyGame.gameinfo.variants, ["hex5", "scrambled"], { mode: "assert" });
// → UserFacingError INVALID_VARIANT_COMBINATION
```

### Authoring rules

1. Declare rules once in `gameinfo.variants` — do not duplicate in ad-hoc `.filter()` or private `sanitize*` methods.
2. Call `applyVariantConstraints` only on the **fresh-game** path.
3. Game-specific logic that metadata cannot express (for example parsing `size-*` uids for board dimensions) stays in the constructor **after** `applyVariantConstraints`.
4. Optional: add a test that `GameFactory(uid, n, badCombo).variants` matches expected sanitized output.

## Consumer APIs

Exported from `@abstractplay/gameslib` (detail in [API](/gameslib/api/)):

| API | Use |
|-----|-----|
| `evaluateAvailability(variants, selected)` | Per-control enable map for UI |
| `sanitizeVariantSelection(variants, selected)` | Interactive self-heal in pickers |
| `validateVariantSelection(variants, selected)` | Non-throwing check (`{ ok: true }` or `{ ok: false, errors }`) |
| `assertValidVariantSelection(variants, selected)` | Throws `UserFacingError` with code `INVALID_VARIANT_COMBINATION` |
| `resolveIncomingVariants(variants, incoming, options?)` | Constructor / test entry point (`sanitize` or `assert` mode) |
| `assertChallengeVariants(gameinfo, selected)` | Production allowlist + combination check for new challenges |
| `assertChallengeVariantSelection(gameinfo, selected)` | Combination check only |

`applyVariantConstraints(incoming?, options?)` is a **protected** method on `GameBase` — not part of the package export surface.

On a game instance, `allvariants()` and `challengeVariants()` pass constraint metadata (`enabledWhen`, `conflictsWith`, `requires`, `implies`, `impliesLock`, `unrated`) to the front end.

## i18n

Variant **names** and **descriptions** stay in `locales/en/apgames.json` under `variants.{gameUid}.{variantUid}`.

Constraint violation messages are owned by consumers (front submit guards, backend API). v1 uses generic copy; structured per-reason keys may follow in a later release.
