# Game object

Every game is a class extending one of the `GameBase` hierarchy:

| Base class | `turnModel()` | When to use |
|------------|---------------|-------------|
| `GameBase` | `"sequential"` | Default — one stack entry per ply; turns advance in seat order |
| `GameBaseSimultaneous` | `"simultaneous"` | One stack entry per round; `lastmove` is comma-split per seat (Pigs, Entropy, …) |
| `GameBaseSkipTurn` | `"skip-turn"` | Inactive seats skipped in turn order; `null` in export for eliminated players (Armadas, Homeworlds) |
| `GameBaseSequenced` | `"sequenced"` | Seat may act **multiple times** before the cycle completes; sparse one-row-per-ply export (optional sugar — see mixin hooks) |

See **[Creating games — Choosing a base class](/gameslib/creating-games/#choosing-a-base-class)** for a decision guide and worked examples.

## Required abstract methods

| Method | Purpose |
|--------|---------|
| `move(m, opts?)` | Apply a move string; return updated game |
| `render(opts?)` | Return `APRenderRep` (or array) for the renderer |
| `state(opts?)` | Return `IAPGameState` snapshot |
| `load(idx)` | Load stack position (default: latest) |
| `clone()` | Deep copy |
| `moveState()` | Snapshot for pushing onto stack (protected) |

`GameBaseSkipTurn` also requires `isSeatActive(seat, stackIndex)` — whether a 1-based seat may act at the pre-move state for `stack[stackIndex]`.

### Mixin hooks (`plyActor`, `shouldCloseRound`)

All bases inherit overridable hooks from `GameBase` (implemented in `_turn-plies.ts` and base `getRounds()`). Override these when turn structure is **not** strict round-robin but you are **not** using skip-turn nulls or simultaneous comma-moves:

| Hook | Default behaviour |
|------|-------------------|
| `plyActor(stackIndex)` | Actor = `stack[stackIndex - 1].currplayer` |
| `shouldCloseRound(roundPlies, stackIndex)` | Close every `numplayers` plies (every ply when `numplayers === 1`) |
| `getRounds()` | Pack plies into `numplayers`-wide rows via `buildRoundRow` |
| `compactExportRounds()` | Trim trailing `null` seats per row (sequential export) |

**`GameBaseSequenced`** sets `turnModel()` → `"sequenced"`, uses seat-cycle `shouldCloseRound`, sparse `getRounds()` (one row per ply), and skips trailing-null compaction. See **[Sequenced turn model](/gameslib/sequenced-turn-model/)** for a full example (duplicate actions per round, round-close rules, Frogger `refills`).

**[Frogger](https://play.abstractplay.com/games/frogger)** (`refills` variant) overrides these hooks on **`GameBase`** instead of extending `GameBaseSequenced`, because only that variant needs sequenced export and legacy stack `skipto` handling.

Do **not** override `moveHistory()` for export fixes — bots and legacy tests depend on the frozen stride shape.

## State shape (`IAPGameState`)

```ts
{
  game: string;        // uid
  numplayers: number;
  variants: string[];
  gameover: boolean;
  winner: number[];
  stack: IIndividualState[];
}
```

You typically don't need to alter `IAPGameState`, but if there is game-wide information you need to store (information that doesn't change move to move), this is the most efficient place to store it.

Each `IIndividualState` requires `_version`, `_results`, `_timestamp`. The rest is up to the game itself. It's really up to the developer how they want to structure things. As long as the game code will correctly hydrate a saved state, you're good.

## Provided by `GameBase`

Serialization: `serialize()`, `undo()`, `resign()`, `timeout()`, `draw()`, `abandoned()`.

UI: `handleClick()`, `moves()`, `validateMove()`, `sidebarStatuses()`, `getButtons()` (when flagged).

History and records: `moveHistory()`, `getPlies()`, `getRounds()`, `recordExportExclude()`, `resultsHistory()`, `chatLog()`, `chat()`, `genRecord()`.

## Turn model and record export

There are two related layers:

1. **Canonical turn structure** — `getPlies()` / `getRounds()` walk the stack with ply-correct round boundaries. Slots include full `_results` (no export filtering).
2. **Published gamerecord** — `genRecord().moves` comes from the export pipeline below.

```mermaid
flowchart LR
  GP[getPlies]
  GR[getRounds]
  RE[recordExportExclude]
  FR[filterRoundsForRecord]
  CE[compactExportRounds]
  GML[getMoveList / genRecord.moves]
  GP --> GR
  GR --> FR
  RE --> FR
  FR --> CE
  CE --> GML
```

### `getPlies()` and `getRounds()`

- **`getPlies()`** — flat list of plies with `actor`, `move`, `results`, `round`, `playOrder`, `stackIndex`.
- **`getRounds()`** — seating-indexed rows (`IGameRound`), one entry per player seat per round. A slot is a move string, `{ move, result? }`, `{ move, sequence, result? }`, or `null` when that seat did not act (eliminated / inactive).

Simultaneous and skip-turn games keep **full row width** (including `null` columns); sequential games may trim trailing `null` seats in export only.

### `recordExportExclude()`

Override this protected hook to control which `_results.type` values are **stripped from published move slots** in `genRecord().moves`. It does **not** change `getRounds()` — only the export copy.

**Default** (no override needed for most games):

```ts
protected recordExportExclude(): string[] {
    return ["eog", "winners"];
}
```

`eog` and `winners` are already in the gamerecord header; omitting them from per-move `result` arrays avoids duplication.

**When to override:** your game previously used `getMoveList()` → `getMovesAndResults([...exclude])` to hide annotation types from the published record (e.g. per-move `move`, `place`, `capture` objects that duplicate the move string). Copy the **same type list** into `recordExportExclude()` — do **not** override `getMoveList()`.

Example (Volcano — omits move annotations from export):

```ts
protected recordExportExclude(): string[] {
    return ["move", "eog", "winners"];
}
```

Example (Tablero — several annotation types):

```ts
protected recordExportExclude(): string[] {
    return ["place", "take", "pass", "eog", "winners"];
}
```

**Do not override `getMoveList()`** for export filtering. The default implementation is:

```ts
protected getMoveList(): any[] {
    return this.compactExportRounds(
        this.filterRoundsForRecord(this.getRounds(), this.recordExportExclude()),
    );
}
```

Only override `getMoveList()` if export row **shape** must differ from `getRounds()` after filtering (rare; Armadas 3+ used to be an example — now handled by `GameBaseSkipTurn` + `buildRoundRow`).

### `genRecord()` header

`genRecord()` sets `header["turn-model"]` from `turnModel()` (Phase 4). Values: `sequential`, `simultaneous`, `sequenced`, `skip-turn`. Recranks and stats consumers use this to replay sequenced/skip-turn rounds and count null-aware move totals; legacy records without the header keep stride replay and `rec.moves.length`.

### `moveHistory()` (frozen)

Legacy stride-based grouping (`i += numplayers`). Still used by bots, AiAi, and some golden tests. **Not** the source for `genRecord().moves` after the Phase 1b export pipeline.

Do not override `moveHistory()` to fix record export — use `getRounds()` / `recordExportExclude()` instead.

### `getMovesAndResults()` (deprecated for export)

Frozen stride shim for old code paths. New games should not call it. Migrating games: replace `getMoveList() { return this.getMovesAndResults([...]); }` with `recordExportExclude()` only.

## `IRenderOpts`

Optional `render()` arguments: `perspective`, `altDisplay`, `hideLayer`. Games with `stacking-expanding` pass click coordinates through render options.

## `IClickResult`

Returned by `handleClick`: `valid`, `message`, `move`, optional `complete` and `canrender`.

## Example games

- **[Complica](https://play.abstractplay.com/games/complica)** — full `GameBase` lifecycle; default `recordExportExclude()`
- **[Volcano](https://play.abstractplay.com/games/volcano)** — `recordExportExclude()` omits `move` annotations from export
- **[Homeworlds](https://play.abstractplay.com/games/homeworlds)** — `GameBaseSkipTurn`; `null` export slots for eliminated seats
- **[Robo Battle Pigs](https://play.abstractplay.com/games/pigs)** — `GameBaseSimultaneous`; one stack entry per round
- **[Frogger](https://play.abstractplay.com/games/frogger)** — `GameBase`; `refills` variant overrides mixin hooks for `sequenced` export (`skipto`, sparse rows)
