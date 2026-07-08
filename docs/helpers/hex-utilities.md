# Hex utilities

`src/common/hexes.ts` provides low-level operations on honeycomb `Hex` cells: neighbours, edges, vertices, and procedural field growth.

## Key API

- `hexNeighbours`, `nextHex`, `bearing`
- `hex2edges`, `edge2hexes`, `hex2verts`, `vert2hexes`
- `generateField` — grow a cluster of hex modules

Also see `src/common/aiai.ts` for AiAi coordinate conversion (`hexhexAp2Ai`, `triAp2Ai`, etc.).

## Example games

- **[Streetcar](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/streetcar.ts)** — edge and vertex incidence
- **[Exxit](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/exxit.ts)** — hex neighbour traversal
- **[Tintas](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/tintas.ts)** — `generateField` with `ModularBoard`
