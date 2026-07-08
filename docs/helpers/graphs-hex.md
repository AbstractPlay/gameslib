# Hex graphs

Hex and hex-derived board graphs.

| Class | Use case | Example games |
|-------|----------|---------------|
| `HexTriGraph` | Standard hex-hex boards | [yavalath](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/yavalath.ts), [waldmeister](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/waldmeister.ts) |
| `HexSlantedGraph` | Rectangular slanted hex | [pollux](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/pollux.ts), [nex](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/nex.ts) |
| `HexConeGraph` | Conical hex board | [conect](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/conect.ts) |
| `HexMoonGraph` | Fixed moon shape | [moonsquad](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/moonsquad.ts) |
| `PentaHexGraph` | Pentagonal hex rings | [bluestone](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/bluestone.ts) |

Related low-level helpers: [Hex utilities](/gameslib/helpers/hex-utilities/).

## Example games

- **[Yavalath](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/yavalath.ts)** — `HexTriGraph` placement rules
- **[Havannah](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/havannah.ts)** — connection game on hex board
