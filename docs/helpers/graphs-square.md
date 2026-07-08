# Square graphs

Classes for square-grid topologies (`src/common/graphs/`).

| Class | Connectivity | Example games |
|-------|--------------|---------------|
| `SquareGraph` | Orth + diagonal | [viruswar](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/viruswar.ts), [loa](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/loa.ts) |
| `SquareOrthGraph` | Orthogonal only | [tanbo](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/tanbo.ts), [intermedium](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/intermedium.ts) |
| `SquareDiagGraph` | Diagonal only | [stapeldammen](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/stapeldammen.ts), [lasca](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/lasca.ts) |
| `SquareDirectedGraph` | Directed edges | [yonmoque](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/yonmoque.ts), [squaredance](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/squaredance.ts) |
| `SquareFanoronaGraph` | Fanorona jump graph | [fanorona](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/fanorona.ts) |
| `SnubSquareGraph` | Snub square tiling | [ceph](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/ceph.ts) |
| `OnyxGraph` | Onyx board | [onyx](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/onyx.ts) |
| `SquareDiamondsDirectedGraph` | Diamond directed grid | [tessella](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/tessella.ts) |

## Example games

- **[Virus War](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/viruswar.ts)** — `SquareGraph` infection spread
- **[Yonmoque](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/yonmoque.ts)** — directed moves
