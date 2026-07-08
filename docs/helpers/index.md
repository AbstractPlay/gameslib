# Helpers overview

Shared code lives in [`src/common/`](https://github.com/AbstractPlay/gameslib/tree/develop/src/common). Import from the barrel (`../common`) or specific subpaths (`../common/graphs`, `../common/hexes`).

## When to use what

| Need | Use |
|------|-----|
| Rectangular board, directions, distances | [`RectGrid`](/gameslib/helpers/rect-grid/) |
| Hex / square / specialty topology with graph adjacency | [Graph classes](/gameslib/helpers/graphs/) |
| Hex edge/vertex math | [Hex utilities](/gameslib/helpers/hex-utilities/) |
| Serialize `Map`/`Set` in game state | [Serialization](/gameslib/helpers/serialization/) |
| Decktet card games | [Decktet](/gameslib/helpers/decktet/) |
| Growing hex boards from centres | `ModularBoard` — [Specialty graphs](/gameslib/helpers/graphs-specialty/) |
| Infinite square grid | `UnboundedSquareBoard` — [Specialty graphs](/gameslib/helpers/graphs-specialty/) |

Full cross-index: [Examples by feature](/gameslib/examples/by-feature/).

## Example games

- **[Zola](https://play.abstractplay.com/games/zola)** — directions + `RectGrid`
- **[Yavalath](https://play.abstractplay.com/games/yavalath)** — `HexTriGraph`
