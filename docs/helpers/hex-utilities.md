# Hex utilities

`src/common/hexes.ts` provides low-level operations on honeycomb `Hex` cells: neighbours, edges, vertices, and procedural field growth.

## Key API

- `hexNeighbours`, `nextHex`, `bearing`
- `hex2edges`, `edge2hexes`, `hex2verts`, `vert2hexes`
- `generateField` — grow a cluster of hex modules

Also see `src/common/aiai.ts` for AiAi coordinate conversion (`hexhexAp2Ai`, `triAp2Ai`, etc.).

## Example games

- **[Streetcar](https://play.abstractplay.com/games/streetcar)** — edge and vertex incidence
- **[Exxit](https://play.abstractplay.com/games/exxit)** — hex neighbour traversal
- **[Tintas](https://play.abstractplay.com/games/tintas)** — `generateField` with `ModularBoard`
