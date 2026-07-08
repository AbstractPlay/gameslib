# Specialty graphs and boards

Less common topologies and board helpers.

| Module | Purpose | Example games |
|--------|---------|---------------|
| `BaoGraph` | Bao la mema pit layout | [bao](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/bao.ts) |
| `SowingNoEndsGraph` | Two-row mancala | [toguz](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/toguz.ts), [oware](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/oware.ts) |
| `BentTriGraph` | Commercial bent-Y triangle | [y](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/y.ts) |
| `ModularBoard` | Growable modular hex | [tintas](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/tintas.ts), [abande](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/abande.ts) |
| `UnboundedSquareBoard` | Infinite sparse square grid | [trax](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/trax.ts) |

## Example games

- **[Trax](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/trax.ts)** — only consumer of `UnboundedSquareBoard`
- **[Bao](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/bao.ts)** — `BaoGraph` sowing
