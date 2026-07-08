# Square graphs

Classes for square-grid topologies (`src/common/graphs/`).

| Class | Connectivity | Example games |
|-------|--------------|---------------|
| `SquareGraph` | Orth + diagonal | [viruswar](https://play.abstractplay.com/games/viruswar), [loa](https://play.abstractplay.com/games/loa) |
| `SquareOrthGraph` | Orthogonal only | [tanbo](https://play.abstractplay.com/games/tanbo), [intermedium](https://play.abstractplay.com/games/intermedium) |
| `SquareDiagGraph` | Diagonal only | [stapeldammen](https://play.abstractplay.com/games/stapeldammen), [lasca](https://play.abstractplay.com/games/lasca) |
| `SquareDirectedGraph` | Directed edges | [yonmoque](https://play.abstractplay.com/games/yonmoque), [squaredance](https://play.abstractplay.com/games/squaredance) |
| `SquareFanoronaGraph` | Fanorona jump graph | [fanorona](https://play.abstractplay.com/games/fanorona) |
| `SnubSquareGraph` | Snub square tiling | [ceph](https://play.abstractplay.com/games/ceph) |
| `OnyxGraph` | Onyx board | [onyx](https://play.abstractplay.com/games/onyx) |
| `SquareDiamondsDirectedGraph` | Diamond directed grid | [tessella](https://play.abstractplay.com/games/tessella) |

## Example games

- **[Virus War](https://play.abstractplay.com/games/viruswar)** — `SquareGraph` infection spread
- **[Yonmoque](https://play.abstractplay.com/games/yonmoque)** — directed moves
