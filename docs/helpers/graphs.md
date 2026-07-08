# Graph topologies

Graph classes in `src/common/graphs/` implement `IGraph`: a graphology graph plus `coords2algebraic`, `algebraic2coords`, `neighbours`, and `path`.

## Choosing a graph

| Board type | Class |
|------------|-------|
| Square, orth + diagonal | `SquareGraph` |
| Square, orthogonal only | `SquareOrthGraph` |
| Square, diagonal only | `SquareDiagGraph` |
| Directed square grid | `SquareDirectedGraph` |
| Fanorona lines | `SquareFanoronaGraph` |
| Snubsquare / Onyx | `SnubSquareGraph`, `OnyxGraph` |
| Hex hexagonal field | `HexTriGraph` |
| Slanted hex rectangle | `HexSlantedGraph` |
| Bao / Mancala pits | `BaoGraph`, `SowingNoEndsGraph` |
| Bent-Y triangle board | `BentTriGraph` |
| 3D stacking on squares | `Square3DGraph`, `SquareOrth3DGraph`, `SquareDiag3DGraph` |

See [Square graphs](/gameslib/helpers/graphs-square/), [Hex graphs](/gameslib/helpers/graphs-hex/), [Specialty graphs](/gameslib/helpers/graphs-specialty/).

## Example games

- **[Cross Control](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/crosscontrol.ts)** — `SquareGraph`
- **[Havannah](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/havannah.ts)** — `HexTriGraph`
- **[Terrace](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/terrace.ts)** — 3D square graphs
