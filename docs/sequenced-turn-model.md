# Sequenced turn model

Use **`turn-model: sequenced`** when a seat may submit **more than one ply** before every seat has acted once in the cycle. Strict sequential export (fixed `numplayers`-wide rows) would overwrite or mis-place those extra plies in the wrong column.

See also [Creating games — Choosing a base class](/gameslib/creating-games/#choosing-a-base-class) and [Game object — mixin hooks](/gameslib/game-object/#mixin-hooks-plyactor-shouldcloseround).

## When you need it

| Pattern | Example | Why not plain `GameBase`? |
|---------|---------|---------------------------|
| Supplemental submit after a branch | Frogger `refills`: announce `!`, others pass, announcer finishes | Same seat acts twice before the cycle completes |
| Branch depth before cycle wrap | Future games (e.g. Gnostica) | Play order ≠ one ply per seat per row |

**Not** sequenced:

- **Skip-turn** — a seat is **absent** (`null` column). Use `GameBaseSkipTurn`.
- **Simultaneous** — all seats in one stack entry. Use `GameBaseSimultaneous`.

## Default pattern (new games)

If the **whole game** can have duplicate actors per round, extend **`GameBaseSequenced`**:

```ts
import { GameBaseSequenced } from "@abstractplay/gameslib";

export class MyGame extends GameBaseSequenced {
  // move(), render(), state(), … as usual

  // Optional — only if actor ≠ pre-move currplayer:
  // protected plyActor(stackIndex: number): number { … }

  // Optional — only if round boundaries differ from seat-cycle wrap:
  // protected shouldCloseRound(roundPlies, stackIndex): boolean { … }
}
```

`GameBaseSequenced` already provides:

- `turnModel()` → `"sequenced"`
- `shouldCloseRound()` → close when `stack[stackIndex].currplayer` wraps to the round opener (not every `numplayers` plies)
- `getRounds()` → **one sparse row per ply** (move in the actor’s column)
- `compactExportRounds()` → keep full seat width (no trailing-null trim)
- `plyActor()` → `stack[stackIndex - 1].currplayer` (override when needed)

Each `move()` still does one `saveState()`; sequenced export only changes how plies are **grouped and labelled** for records and the finished-game move table.

## Worked example: two actions in one round

### Scenario (Frogger `refills`, 4 players)

After normal plies by P1 and P2, **P3** announces a market refill (`l4-k4,9MS!/`). Other seats pass while P3 owes a **supplemental** submit. One logical round contains:

| Ply | Actor | Move |
|-----|-------|------|
| 1 | P1 | ordinary turn |
| 2 | P2 | ordinary turn |
| 3 | P3 | `…9MS!/` (refill announce) |
| 4 | P4 | `pass` |
| 5 | P1 | `pass` |
| 6 | P2 | `pass` |
| 7 | P3 | supplemental follow-up |

P3 appears **twice** (plies 3 and 7). Export must use **two rows** with P3 in column 3, not pack plies 1–4 into one dense row.

### What `getPlies()` should produce

- Every stack entry after the opening position → one ply.
- `actor` = who submitted that stack entry (usually pre-move `currplayer`).
- All seven plies share the **same `round`** until the seat cycle completes **after** the supplemental turn.
- `playOrder` increases 1…7 within that round.

### What `getRounds()` should produce (sparse)

Seven seating-indexed rows, each mostly `null` except the actor’s column:

```ts
// Row for ply 3 (P3 announce) — column index is actor - 1
[null, null, { move: "l4-k4,9MS!/", sequence: 3 }, null]

// Row for ply 7 (P3 follow-up)
[null, null, { move: "k4-j3,NL/…", sequence: 7 }, null]
```

When `playOrder === actor`, `sequence` may be omitted. The finished-game move table uses `header["turn-model"] === "sequenced"` and auto-density: rounds with a **duplicate actor** stay sparse (one row per ply).

### Critical rule: do not close the round mid-cycle

`sequencedShouldCloseRound` closes when the **next** `currplayer` equals the **round opener**. During a refill pass chain, `currplayer` can wrap back to P1 **before** the announcer’s supplemental ply — that must **not** end the round early.

Wrong (round closes after ply 4):

```
Round A (dense): P1 | P2 | P3 announce | P4 pass   ← looks like a full cycle
Round B:         P1 pass | P2 pass | P3 follow-up  ← columns drift in the UI
```

Correct: keep plies 1–7 in **one round** until the supplemental submit clears the pending obligation and the seat cycle genuinely completes.

For new games, express that in **`shouldCloseRound`** (e.g. “while phase === `refillPending`, return false”). Do not rely on stride or `moveHistory()` for export.

## Frogger `refills` (variant-gated legacy)

[Frogger](https://play.abstractplay.com/games/frogger) stays on **`GameBase`** because only the `refills` variant needs sequenced export. It gates hooks on the variant and uses a legacy stack flag **`skipto`** (announcer seat with a pending supplemental obligation):

```ts
import { defaultPlyActor, defaultShouldCloseRound } from "./_turn-plies";
import {
  sequencedSkiptoPlyActor,
  sequencedSkiptoShouldCloseRound,
} from "./_turn-sequenced-skipto";

public turnModel(): TurnModel {
  return this.variants.includes("refills") ? "sequenced" : "sequential";
}

protected plyActor(stackIndex: number): number {
  if (!this.variants.includes("refills")) {
    return defaultPlyActor(this, stackIndex);
  }
  return sequencedSkiptoPlyActor(this, stackIndex);
}

protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
  if (!this.variants.includes("refills")) {
    return defaultShouldCloseRound(this, roundPlies);
  }
  return sequencedSkiptoShouldCloseRound(this, roundPlies, stackIndex);
}

public getRounds(): IGameRound[] {
  if (!this.variants.includes("refills")) {
    return super.getRounds();
  }
  return this.getPlies().map((ply) => this.buildRoundRow([ply]));
}

protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
  if (!this.variants.includes("refills")) {
    return super.compactExportRounds(rounds);
  }
  return rounds;
}
```

Helpers in [`_turn-sequenced-skipto.ts`](/gameslib/src/games/_turn-sequenced-skipto.ts) are **Frogger-only compatibility**. New sequenced games should **not** copy the `skipto` stack field; model supplemental phases in game state and override `shouldCloseRound` / `plyActor` on `GameBaseSequenced` instead.

### In `move()` (game logic, not export)

Typical refill flow:

1. Announcer plays a step ending in `!` → set internal “pending supplemental” state, advance `currplayer` for the pass chain.
2. While pending, other seats’ only legal move is `pass` (autopass on the server).
3. When `currplayer` returns to the announcer, accept the supplemental submit or pass to cancel.
4. Clear pending state on completion → normal seat cycle resumes.

Export hooks read that flow from the stack (`currplayer`, `lastmove`, and in Frogger’s case `skipto` on each `moveState()`).

## Checklist

- [ ] `turnModel()` returns `"sequenced"` when duplicate actors per round are possible
- [ ] `shouldCloseRound()` uses **seat-cycle wrap**, not `roundPlies.length >= numplayers`
- [ ] While a supplemental obligation is open, **`shouldCloseRound` returns false** even if `currplayer` hits the round opener
- [ ] `getRounds()` emits **one row per ply** when the same seat can appear twice in a round
- [ ] `compactExportRounds()` does not trim trailing `null`s
- [ ] Tests assert `getPlies()` actors/rounds and, for refill-like flows, that the cycle is **one round** (see `test/games/sequencedTurnModel.test.ts`, `test/games/sequencedSkipto.test.ts`, `test/games/froggerTurnModel.test.ts`)

## Related source

| Module | Role |
|--------|------|
| [`_turn-sequenced.ts`](/gameslib/src/games/_turn-sequenced.ts) | `GameBaseSequenced`, `sequencedShouldCloseRound` |
| [`_turn-sequenced-skipto.ts`](/gameslib/src/games/_turn-sequenced-skipto.ts) | Legacy Frogger `skipto` helpers |
| [`_turn-plies.ts`](/gameslib/src/games/_turn-plies.ts) | `walkStackPlies`, `defaultPlyActor` |
| [`_turn-skip.ts`](/gameslib/src/games/_turn-skip.ts) | Seat-cycle wrap helper used by sequenced close |
