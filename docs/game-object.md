# Game object

Every game is a class extending `GameBase` (or `GameBaseSimultaneous` for simultaneous moves).

## Required abstract methods

| Method | Purpose |
|--------|---------|
| `move(m, opts?)` | Apply a move string; return updated game |
| `render(opts?)` | Return `APRenderRep` (or array) for the renderer |
| `state(opts?)` | Return `IAPGameState` snapshot |
| `load(idx)` | Load stack position (default: latest) |
| `clone()` | Deep copy |
| `moveState()` | Snapshot for pushing onto stack (protected) |

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

Each `IIndividualState` requires `_version`, `_results`, `_timestamp`.

## Provided by `GameBase`

Serialization: `serialize()`, `undo()`, `resign()`, `timeout()`, `draw()`, `abandoned()`.

UI: `handleClick()`, `moves()`, `validateMove()`, `sidebarStatuses()`, `getButtons()` (when flagged).

History: `moveHistory()`, `resultsHistory()`, `chatLog()`, `chat()`, `genRecord()`.

## `IRenderOpts`

Optional `render()` arguments: `perspective`, `altDisplay`, `hideLayer`. Games with `stacking-expanding` pass click coordinates through render options.

## `IClickResult`

Returned by `handleClick`: `valid`, `message`, `move`, optional `complete` and `canrender`.

## Example games

- **[Complica](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/complica.ts)** — full `GameBase` lifecycle
- **[Volcano](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/volcano.ts)** — `stacking-expanding` renderer integration
- **[Homeworlds](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/homeworlds.ts)** — complex multi-system state (advanced reference)
