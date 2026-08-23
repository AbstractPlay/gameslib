# Sequenced turn model

Use **`turn-model: sequenced`** when a seat may submit **more than one ply** before every seat has acted once in the cycle. Strict sequential export (fixed `numplayers`-wide rows) would overwrite or mis-place those extra plies in the wrong column.

See also [Creating games — Choosing a base class](/gameslib/creating-games/#choosing-a-base-class) and [Game object — mixin hooks](/gameslib/game-object/#mixin-hooks-plyactor-shouldcloseround).

## When you need it

| Pattern | Example | Why not plain `GameBase`? |
|---------|---------|---------------------------|
| Supplemental submit after a branch | [Frogger](https://play.abstractplay.com/games/frogger) `refills`: announce `!`, same seat finishes | Same seat acts twice before the cycle completes |
| Branch depth before cycle wrap | Future games (e.g. Gnostica) | Play order ≠ one ply per seat per row |

**Not** sequenced:

- **Skip-turn** — a seat is **absent** (`null` column). Use `GameBaseSkipTurn`.
- **Simultaneous** — all seats in one stack entry. Use `GameBaseSimultaneous`.

## Core idea

**Sequenced export does not require fake passes, `skipto`, or advancing `currplayer` through other seats** so the move table “lines up.” Those were workarounds from the old stride layout.

The elegant pattern:

1. **One stack entry per ply** — each `saveState()` is one row in history.
2. **`actor` = who submitted** — default `stack[stackIndex - 1].currplayer`; override `plyActor` only when that is not enough.
3. **Same seat, consecutive plies** — keep `currplayer` on that seat until the supplemental obligation is done, then advance to the next seat.
4. **One logical round** — override `shouldCloseRound` so the round does not close while a supplemental obligation is still open.
5. **Sparse `getRounds()`** — one seating-indexed row per ply (`GameBaseSequenced` does this by default).

Other seats can be **blocked from acting** in `moves()` / `validateMove()` during the refill without emitting `pass` stack entries for them. The record only needs the plies that actually happened.

## Base class

Extend **`GameBaseSequenced`** when the game (or variant) always uses sequenced export:

```ts
import { GameBaseSequenced } from "@abstractplay/gameslib";

export class MyGame extends GameBaseSequenced {
  // move(), render(), state(), moveState(), …
}
```

`GameBaseSequenced` already provides:

| Hook | Default |
|------|---------|
| `turnModel()` | `"sequenced"` |
| `plyActor()` | pre-move `currplayer` |
| `shouldCloseRound()` | seat cycle wraps to round opener |
| `getRounds()` | one sparse row per ply |
| `compactExportRounds()` | full seat width (no trailing-null trim) |

Variant-gated games (e.g. Frogger without `refills`) can stay on **`GameBase`** and override the same hooks only when the variant is active — see the worked example below.

## Worked example: Frogger-style refills (recommended shape)

### Scenario (4 players)

After P1 and P2 take ordinary turns, **P3** announces a market refill (`l4-k4,9MS!/`). The rules require one more partial submit by P3 before the seat cycle continues. **No pass plies** appear in the stack for P4, P1, or P2 — they simply cannot act until P3 finishes.

| Ply | Actor | Move | Notes |
|-----|-------|------|--------|
| 1 | P1 | ordinary turn | |
| 2 | P2 | ordinary turn | |
| 3 | P3 | `l4-k4,9MS!/` | refill announce (`!`); `refillPending` set |
| 4 | P3 | `k4-j3,NL/…` | supplemental submit; `refillPending` cleared |
| 5 | P4 | ordinary turn | `currplayer` advanced to 4 after ply 4 |

P3 appears **twice in a row** (plies 3 and 4). Both plies belong to the **same round** until the cycle completes after P4 (and later seats) act.

### Game state (not export hooks)

Track the obligation in **`moveState()`**, not a turn-table hack:

```ts
interface IRefillPending {
  seat: number;      // who owes the supplemental submit
  remaining: number; // partial-turn hop count (from announce payload)
}

interface IMoveState extends IIndividualState {
  currplayer: number;
  refillPending?: IRefillPending;
  // … board, hands, market, …
}
```

### `move()` flow

```ts
move(m: string): this {
  if (this.refillPending !== undefined) {
    if (this.currplayer !== this.refillPending.seat) {
      // Other seats cannot act — no pass stack entries needed.
      throw new UserFacingError(/* … */);
    }
    // P3 supplemental submit (or pass to decline follow-up)
    this.applyPartialMove(m);
    this.refillPending = undefined;
    this.advanceCurrplayer(); // now P4
  } else if (isRefillAnnounce(m)) {
    this.applyAnnounceStep(m);
    this.refillPending = {
      seat: this.currplayer,
      remaining: hopsRemainingFromAnnounce(m),
    };
    // Stay on P3 — do NOT advance currplayer yet.
  } else {
    this.applyNormalMove(m);
    this.advanceCurrplayer();
  }
  this.saveState();
  return this;
}
```

While `refillPending` is set and `currplayer === refillPending.seat`, **`moves()`** lists only that seat’s legal supplemental moves (and maybe `pass`). Other seats get an empty list or validation errors — the server/UI blocks them without recording passes.

After the supplemental ply, clear `refillPending`, **then** advance `currplayer` to the next seat in order.

### Export hooks

**`plyActor`** — default is enough if `currplayer` on the pre-move stack entry is always the submitter. Both P3 plies have `prev.currplayer === 3`.

**`shouldCloseRound`** — do not close while a supplemental obligation is still open on the post-move stack entry:

```ts
protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
  const after = this.stack[stackIndex] as IMoveState;
  if (after.refillPending !== undefined) {
    return false;
  }
  return sequencedShouldCloseRound(this, roundPlies, stackIndex);
}
```

Without that guard, `sequencedShouldCloseRound` can close the round when `currplayer` wraps to the opener **before** the supplemental ply is saved — that was the root cause of mis-packed move tables under the old pass-chain layout.

**`getRounds()` / `compactExportRounds()`** — use `GameBaseSequenced` defaults (sparse one row per ply). No custom packing.

### What `getPlies()` should produce

For the table above (before P4’s turn ends the round):

```ts
[
  { actor: 1, move: "…", round: 0, playOrder: 1 },
  { actor: 2, move: "…", round: 0, playOrder: 2 },
  { actor: 3, move: "l4-k4,9MS!/", round: 0, playOrder: 3 },
  { actor: 3, move: "k4-j3,NL/…", round: 0, playOrder: 4 },
  // after P4 acts and cycle wraps to P1, round 0 closes
]
```

### What `getRounds()` should produce

Four sparse rows for plies 1–4 (five once P4 moves), each with the move only in the actor’s column:

```ts
[null, null, "l4-k4,9MS!/", null]                    // ply 3 — P3
[null, null, { move: "k4-j3,NL/…", sequence: 4 }, null]  // ply 4 — P3 again
```

When `playOrder === actor`, `sequence` may be omitted. The finished-game move table uses `header["turn-model"] === "sequenced"` and **auto-density**: any round where an actor appears twice stays sparse (one UI row per ply).

### Variant-gated Frogger (sketch)

Frogger without `refills` stays sequential. Only enable sequenced hooks when the variant is on:

```ts
import type { TurnModel, IGamePly, IGameRound } from "./_turn-model";
import { defaultShouldCloseRound } from "./_turn-plies";
import { sequencedShouldCloseRound } from "./_turn-sequenced";

public turnModel(): TurnModel {
  return this.variants.includes("refills") ? "sequenced" : "sequential";
}

protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
  if (!this.variants.includes("refills")) {
    return defaultShouldCloseRound(this, roundPlies);
  }
  const after = this.stack[stackIndex] as IMoveState;
  if (after.refillPending !== undefined) {
    return false;
  }
  return sequencedShouldCloseRound(this, roundPlies, stackIndex);
}

public getRounds(): IGameRound[] {
  if (!this.variants.includes("refills")) {
    return super.getRounds();
  }
  return this.getPlies().map((ply) => this.buildRoundRow([ply]));
}

protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
  return this.variants.includes("refills") ? rounds : super.compactExportRounds(rounds);
}
```

A full **`extends GameBaseSequenced`** refactor is fine if you split classes or use composition for the non-`refills` constructor path — the important part is the **state + `move()` shape**, not the legacy `skipto` flag.

### Tests to add when refactoring

Assert **behaviour**, not stack flags:

- After announce + supplemental, `getPlies()` actors are `[…, 3, 3, …]` with **no pass plies** in between.
- All plies from round opener through supplemental share **`round`** (until the cycle genuinely completes).
- `getRounds()` has **one row per ply** and duplicate P3 rows land in column 3.
- With `refillPending` still set on a stack entry, `shouldCloseRound` is **false** even if `currplayer` equals the round opener.

See `test/games/sequencedTurnModel.test.ts` for base sequenced behaviour. Legacy `skipto` tests in `test/games/sequencedSkipto.test.ts` document the **old** stack shape only.

## Legacy: `skipto` and pass chains (current shipped Frogger)

Production Frogger `refills` today still uses a stack flag **`skipto`** and records **`pass`** plies for other seats (“market hiding”) while advancing `currplayer` round-robin. That layout was designed for the old sequential move table, not for sequenced export.

Compatibility helpers live in [`_turn-sequenced-skipto.ts`](/gameslib/src/games/_turn-sequenced-skipto.ts). **Do not copy this into new games.** When refactoring Frogger, replace `skipto` with explicit `refillPending` (or similar) and the flow above; remove pass stack entries if they are not real player actions you need in the permanent record.

## Checklist

- [ ] Supplemental turns = **consecutive plies by the same `actor`**, not passes in other columns
- [ ] `currplayer` stays on the obligated seat until supplemental completes, **then** advances
- [ ] `shouldCloseRound()` returns **false** while `refillPending` (or equivalent) is set on the post-move stack entry
- [ ] `turnModel()` → `"sequenced"` when duplicate actors per round are possible
- [ ] Sparse `getRounds()` (use `GameBaseSequenced` or equivalent overrides)
- [ ] Tests on `getPlies()` actors/rounds and one-round refill cycle (see above)

## Related source

| Module | Role |
|--------|------|
| [`_turn-sequenced.ts`](/gameslib/src/games/_turn-sequenced.ts) | `GameBaseSequenced`, `sequencedShouldCloseRound` |
| [`_turn-sequenced-skipto.ts`](/gameslib/src/games/_turn-sequenced-skipto.ts) | **Legacy** — current Frogger `skipto` only; scheduled for removal after refactor |
| [`_turn-plies.ts`](/gameslib/src/games/_turn-plies.ts) | `walkStackPlies`, `defaultPlyActor` |
| [`_turn-skip.ts`](/gameslib/src/games/_turn-skip.ts) | Seat-cycle wrap helper used by sequenced close |
