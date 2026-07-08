# Helpers overview

Shared code lives in [`src/common/`](https://github.com/AbstractPlay/gameslib/tree/develop/src/common). Import from the barrel (`../common`) or specific subpaths (`../common/graphs`, `../common/hexes`).

## When to use what

| Need | Use |
|------|-----|
| Rectangular board, directions, distances | [`RectGrid`](rect-grid/) |
| Hex / square / specialty topology with graph adjacency | [Graph classes](graphs/) |
| Hex edge/vertex math | [Hex utilities](hex-utilities/) |
| Serialize `Map`/`Set` in game state | [Serialization](serialization/) |
| Decktet card games | [Decktet](decktet/) |
| Growing hex boards from centres | `ModularBoard` — [Specialty graphs](graphs-specialty/) |
| Infinite square grid | `UnboundedSquareBoard` — [Specialty graphs](graphs-specialty/) |

Full cross-index: [Examples by feature](../examples/by-feature/).

## Example games

- **[Zola](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/zola.ts)** — directions + `RectGrid`
- **[Yavalath](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/yavalath.ts)** — `HexTriGraph`
