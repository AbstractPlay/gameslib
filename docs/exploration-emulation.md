# Exploration and `emulation`

Live move-tree exploration on `/move/` calls `move(m, { partial, emulation: true, trusted })` on a disposable engine, then stores `cheapSerialize()` on exploration nodes and reloads with `GameFactory(metaGame, node.state)`.

## When this page applies

Games with the **`no-explore`** flag in `gameinfo.flags` do not allow live move-tree exploration. **For those titles, the exploration-emulation contract is moot on `/move/`** — skip this page unless you care about Lab/playground behaviour or may remove `no-explore` later.

Only a handful of games both implement `emulation` in `move()` and allow exploration. Primary references:

- **[WaldMeister](https://play.abstractplay.com/games/waldmeister)** — suppress end-of-year scoring under emulation, but **push stack** on emulated complete plies (`waldmeister.ts`; tests in `test/games/waldmeister.test.ts`).
- **[Frogger](https://play.abstractplay.com/games/frogger)** — suppress refill/croc/market/turn tail under emulation, but **push stack** on emulated complete plies (`frogger.ts`; tests in `test/games/frogger.test.ts`).

Do **not** use **Canoe** or **Emu** as exploration-emulation templates: both are **`no-explore`** on live play (Canoe’s dice/`syncFromStackEntry` pattern is a different problem).

## Contract (explore-allowed games)

Each game must satisfy:

1. **Fairness** — emulated moves must not reveal hidden outcomes (RNG draws, deck order, opponent reactions, end-of-round scoring, etc.) that the player would not see before committing on the server.
2. **Reloadability** — after a **complete** emulated ply, `state().stack` must match the position the UI shows (`lastmove`, turn, and `saveState()`), without running suppressed side effects.

Recommended `move()` shape:

```ts
// 1) partial-only UI → return, no saveState
// 2) apply player-visible mutations
// 3) if (partial) return;
// 4) if (emulation) { finalizeExplorationPly(); saveState(); return; }
// 5) real ply: hidden tails, saveState()
```

`finalizeExplorationPly()` updates `lastmove` / `currplayer` (and any fields the next click needs), **not** scoring phases or hidden draws.

## Anti-patterns

- `if (partial || emulation) return this` **before** `saveState()` on **complete** plies (stale `stack` on reload).
- `emulation: false` during exploration to force `saveState()` while running scoring or EOY (branch optimization / spoilers).
- `randomInt` / `shuffle` / `deck.draw()` when `emulation: true` (see solo rules in [Game object](/gameslib/game-object/)).

## Secondary explore-allowed games

**Even at odds**, **Moon Squad**, and **Dragon Eyes** use lighter emulation patterns (defer draw, setup shuffle, or RNG flip). Fix only if exploration reload bugs are reported.
