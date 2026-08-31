# Game flags

Flags tell the front and back ends which optional features a game may use: pie-rule UI, stash panels, `inCheck()` display, exploration restrictions, and so on. The authoritative enum is in [`gameinfo.json`](/gameslib/src/schemas/gameinfo.json); prose below explains how to read and override flags.

## How to read flags

There are three sources. Pick the one that matches your context:

| Source | When to use |
|--------|-------------|
| `gameinfo.flags` | Browse/catalog UI, structural checks (`simultaneous`, `experimental`), or before you know variants and player count |
| `resolveGameFlags(uid, context)` | Challenge setup — variants and player count are chosen but no engine instance exists yet |
| `game.getFlags()` | Active game session — resumed or in-progress state is loaded |

**Consumer rule:** for UI and optional-feature gating, prefer `game.getFlags()` (in-game) or `resolveGameFlags(uid, context)` (challenge setup) over raw `gameinfo.flags`. Static metadata alone is wrong whenever a game overrides `resolveFlags()` (for example Basalt `pie-even` only with the `pie` variant).

**Authoring rule:** override `static resolveFlags(context)` on the game class. Do not add one-off `shouldOfferX()` methods.

## Overriding flags

The categories below describe **typical** usage, not hard rules. Any flag may be added or removed in `resolveFlags()` / `getFlags()` unless noted for structural flags.

- `gameinfo.flags` is the **starting set** — what `resolveFlags()` returns with no override logic and default context.
- Games that vary flags should list them on `gameinfo.flags` when they apply in the **default** challenge configuration; use `resolveFlags()` to add or remove flags for other contexts.
- Flags that are never true in the default config (for example Basalt `pie-even` without the `pie` variant) belong only in `resolveFlags()`, not on static `gameinfo.flags`.

**Structural caveat:** `simultaneous`, `aiai`, and `experimental` affect engine class selection, registry inclusion, or build filtering. Gameslib reads these from `ctor.gameinfo.flags` at factory/registry time. You may reflect them in `getFlags()` for display, but they cannot change which base class was instantiated.

**Deferred requests (no overrides yet):** `random-start`, `no-moves`, and `perspective` have been requested as variant- or context-dependent. Use `resolveFlags()` when implementing them — not ad-hoc helper methods.

### Example (Basalt)

```typescript
public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
    const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
    if (context.variants?.includes("pie")) {
        flags.push("pie-even");
    }
    return flags;
}
```

## Flag classification

### 1. Structural (typically static `gameinfo.flags`)

| Flag | Meaning |
|------|---------|
| `simultaneous` | Use `GameBaseSimultaneous`; affects resign and chat-log behaviour |
| `aiai` | AiAi bot support (`state2aiai`, `translateAiai`) |
| `experimental` | Omitted from production registry and `gameinfo` export |

Variants marked `experimental: true` in `gameinfo.variants` are omitted from production `gameinfo` exports and from `challengeVariants()`, but remain in `allvariants()` for historical games.

### 2. Capability (typically static; optional game methods)

| Flag | Method |
|------|--------|
| `check` | `inCheck(): number[]` |
| `custom-buttons` | `getButtons()` |
| `custom-colours` | `getPlayerColour(n)` |
| `custom-rotation` | `getCustomRotation()` |
| `player-stashes` | `getPlayerStash(n)` |
| `shared-stash` | `getSharedStash()` |

Consumer pattern: `game.getFlags().includes("check")` then call the method.

### 3. Automation (typically static)

| Flag | Meaning |
|------|---------|
| `automove` | Auto-execute when only one legal move |
| `autopass` | Auto-execute pass when it is the only move |
| `no-moves` | Cannot enumerate all legal moves |
| `no-explore` | Disable exploration mode |
| `custom-randomization` | `randomMove()` despite `no-moves` |

### 4. Presentation (typically static)

| Flag | Meaning |
|------|---------|
| `perspective` | Per-player board rotation |
| `shared-pieces` | No player-owned piece colours |
| `scores` | Final scores in EOG emails |
| `rotate90` | 90° rotation increments |
| `stacking-expanding` | Pass click row/col into `render()` |
| `random-start` | `getStartingPosition()` for game record |

### 5. Conditional (first `resolveFlags` overrides: `pie` / `pie-even`)

| Flag | Meaning |
|------|---------|
| `pie` | Seat swap only — second player may accept pie to swap seats |
| `pie-even` | Seat swap **and** insert a pass (komi-style opening) |

These are the first flags migrated off `shouldOfferPie()`. Other flags may use the same override mechanism.

## `pie` vs `pie-even`

These are **distinct** flags with different front-end behaviour — not gradations of the same feature.

| Flag | Behaviour |
|------|-----------|
| `pie` | Seat swap only |
| `pie-even` | Seat swap and insert a pass |

## `getFlags()` vs turn-phase methods

| Question | API |
|----------|-----|
| Does this session support pie / pie-even at all? | `game.getFlags().includes("pie")` or `"pie-even"` |
| Are we on the pie decision turn right now? | `game.isPieTurn()` (per-game; not on `GameBase`) |
| Are we on the komi placement turn? | `game.isKomiTurn()` (`pie-even` games only) |

Front enables pie UI when the resolved flag is present **and** uses `isPieTurn()` / `getButtons()` for the actual turn.

## Quick reference (all flags)

| Flag | Meaning |
|------|---------|
| `aiai` | AiAi bot support |
| `automove` | Often only one legal move — auto-execute when detected |
| `autopass` | Like automove but only for pass |
| `check` | Implement `inCheck() => number[]` |
| `custom-buttons` | Implement `getButtons()` |
| `custom-colours` | Implement `getPlayerColour(n)` — not with `shared-pieces` |
| `custom-randomization` | `randomMove()` despite `no-moves` |
| `custom-rotation` | `getCustomRotation()` for board angle |
| `experimental` | Omitted from production builds and `gameinfo` |
| `no-explore` | Disable exploration mode |
| `no-moves` | Cannot list all legal moves |
| `perspective` | Per-player board rotation |
| `pie` | Pie rule: seat swap only |
| `pie-even` | Pie rule: seat swap and pass (komi-style) |
| `player-stashes` | `getPlayerStash(n)` |
| `random-start` | `getStartingPosition()` for game record |
| `rotate90` | 90° rotation increments |
| `scores` | Final scores in EOG emails |
| `shared-pieces` | No player-owned colours |
| `shared-stash` | `getSharedStash()` |
| `simultaneous` | Turn-based simultaneous rounds — use **`GameBaseSimultaneous`** |
| `stacking-expanding` | Pass click row/col into `render()` |

<!-- generated-flags -->

## Flag enum (from gameinfo.json)

| Flag |
| --- |
| `aiai` |
| `automove` |
| `autopass` |
| `check` |
| `custom-buttons` |
| `custom-colours` |
| `custom-randomization` |
| `experimental` |
| `no-explore` |
| `no-moves` |
| `perspective` |
| `pie-even` |
| `pie` |
| `player-stashes` |
| `random-start` |
| `rotate90` |
| `scores` |
| `shared-pieces` |
| `shared-stash` |
| `simultaneous` |
| `stacking-expanding` |
| `custom-rotation` |
