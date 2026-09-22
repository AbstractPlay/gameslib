# Alternative displays

Game authors declare optional render modes in `gameinfo.displays`. The front end uses `group` for **radio** choices (mutually exclusive, e.g. default 3D vs flat) and omits `group` for independent **checkbox** toggles (e.g. hide overlays). Declarative **constraint fields** match [variants](/gameslib/variants/) so combinations can be validated and sanitized in one place.

Display preferences are **per-user client settings** (not stored in game state). See [Game object](/gameslib/game-object/) for `IRenderOpts` passed into `render()`.

## Overview

Each entry in `gameinfo.displays` is an `AlternativeDisplay` object (see [`gameinfo.json`](/gameslib/src/schemas/gameinfo.json)):

| Field | Purpose |
|-------|---------|
| `uid` | Stable identifier in user settings and `IRenderOpts.altDisplays` |
| `group` | When present, mutually exclusive with other displays in the same group (radio UI) |
| `#group` sentinel | `{ uid: "#projection" }` marks the implicit default when no member uid is active |
| `experimental` | Reserved for production filtering (not applied in v1) |

**Radio vs checkbox:** a `group` field → one active uid per group. No `group` → optional checkbox; multiple checkboxes may be active together.

**Submitted arrays:** clients send active display uids as `string[]` (empty = default renderer). Do not send `#group` sentinels in saved settings.

**Who consumes constraints:**

| Layer | Behaviour |
|-------|-----------|
| Front display picker (Phase 4) | Disables invalid controls; sanitizes selection |
| `GameBase.resolveActiveDisplays()` | Sanitizes before `hasDisplay()` checks in `render()` |
| Legacy `IRenderOpts.altDisplay` | Single string; coalesced to one uid until callers migrate |

## Declaring constraints

Same semantics as [variants](/gameslib/variants/#declaring-constraints): `enabledWhen`, `conflictsWith`, `requires`, `implies`, `impliesLock`.

**Evaluation rule:**

```
selectable(uid) =
  enabledWhen gates pass
  AND requires ⊆ active
  AND conflictsWith ∩ active = ∅
```

## Game `render()` helpers

Prefer **`hasDisplay(opts, uid)`** over comparing `opts.altDisplay` to a single string:

```typescript
const showThreatened = !this.hasDisplay(opts, "hide-threatened");
const vertexStyle = this.hasDisplay(opts, "vertex-style");
```

| Method | Use |
|--------|-----|
| `resolveActiveDisplays(opts)` | Sanitized uid list for this game |
| `hasDisplay(opts, uid)` | Whether a toggle is active |
| `displaySelectionState(opts)` | `{ active, groupChoice }` for radio groups (e.g. flat vs isometric) |

Pass **`altDisplays: string[]`** from the front when multiple toggles are active. **`altDisplay`** remains supported for one uid (including legacy composite uids expanded during sanitize).

## Legacy composite uids

Before combinable toggles, some games used shortcut uids such as `hide-both`. **`LEGACY_DISPLAY_EXPAND`** and gameinfo **`implies`** map these to multiple active uids during sanitize:

| Legacy uid | Expands to |
|------------|------------|
| `hide-both` | `hide-threatened`, `hide-influence` |

Prefer independent checkbox uids in new games instead of encoding every combination.

## FAB cycle (simple projection games)

[`isSimpleDisplayCycleGame()`](/gameslib/src/common/display-cycle.ts) is `true` when every display belongs to a **single** radio group (e.g. default vs `flat`). The board FAB cycles between `displayCycleSteps()`; games with ungrouped checkbox displays hide the FAB (settings modal only).

Add `group: "projection"` on `flat` (and rely on `#projection` sentinel) so Druid/Carnac qualify once metadata is updated (Phase 5b).

## Shared library API

Exported from `@abstractplay/gameslib` (mirrors variant exports):

- `sanitizeDisplaySelection`, `validateDisplaySelection`, `resolveIncomingDisplays`
- `evaluateDisplayAvailability`, `isDisplaySelectable`, `resolveDisplayGroups`
- `isSimpleDisplayCycleGame`, `displayCycleSteps`, `nextDisplayCycleStep`

## Example — overlay toggles (Tumbleweed-shaped)

```typescript
displays: [
    { uid: "hide-threatened" },
    { uid: "hide-influence" },
    {
        uid: "hide-both",
        implies: ["hide-threatened", "hide-influence"],
        impliesLock: true,
    },
],
```

In `render()`, use `hasDisplay(opts, "hide-threatened")` rather than a dedicated `hide-both` branch.

## Example — projection radio (Druid-shaped)

```typescript
displays: [{ uid: "flat", group: "projection" }],
```

Default renderer when `resolveActiveDisplays(opts)` is empty; flat when `hasDisplay(opts, "flat")`.
