# Game flags

Flags in `static gameinfo.flags` tell the front and back ends about special behaviour. See [`gameinfo.json`](https://github.com/AbstractPlay/gameslib/blob/develop/src/schemas/gameinfo.json) for the schema.

Prose descriptions below; the authoritative enum is auto-generated.

| Flag | Meaning |
|------|---------|
| `aiai` | AiAi bot support (`state2aiai`, `translateAiai`) |
| `automove` | Often only one legal move — auto-execute when detected |
| `autopass` | Like automove but only for pass |
| `check` | Implement `inCheck() => number[]` |
| `custom-buttons` | Implement `getButtons()` |
| `custom-colours` | Implement `getPlayerColour(n)` — not with `shared-pieces` |
| `custom-randomization` | `randomMove()` despite `no-moves` |
| `custom-rotation` | `getCustomRotation()` for board angle |
| `experimental` | Hidden on production; visible on dev |
| `no-explore` | Disable exploration mode |
| `no-moves` | Cannot list all legal moves |
| `perspective` | Per-player board rotation |
| `pie` / `pie-even` | Pie rule seat swap |
| `player-stashes` | `getPlayerStash(n)` |
| `random-start` | `getStartingPosition()` for game record |
| `rotate90` | 90° rotation increments |
| `scores` | Final scores in EOG emails |
| `shared-pieces` | No player-owned colours |
| `shared-stash` | `getSharedStash()` |
| `simultaneous` | Use `GameBaseSimultaneous` |
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
