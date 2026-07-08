# Hex utilities

`src/common/hexes.ts` provides low-level operations on honeycomb-grid `Hex` cells: neighbours, edges, vertices, and procedural field growth.

Coordinates use axial `(q, r)` values. Edge and vertex records (`IEdge`, `IVertex`) include a compass `dir`, stable `uid`, and the hex `orientation` (pointy-top vs flat-top). Valid compass directions depend on orientation — pointy hexes use NE/E/SE/SW/W/NW; flat hexes use N/NE/SE/S/SW/NW.

## Neighbours and bearings

| Export | Description |
|--------|-------------|
| `hexNeighbours(hex)` | All six adjacent `{q, r}` coordinates; no in-bounds checking |
| `nextHex(hex, dir)` | Single neighbour in `dir`, or `undefined` if `dir` is invalid for the hex orientation |
| `bearing(from, to)` | Compass direction from `from` to `to` when they share a line of sight (same row, column, or diagonal); otherwise `undefined` |

## Edges

| Export | Description |
|--------|-------------|
| `hex2edges(hex)` | Map from compass direction to canonical `IEdge` records (one per edge of the hex) |
| `edge2hexes(edge)` | The two `{q, r}` coordinates sharing `edge` |
| `edge2verts(edge)` | The two vertices at the ends of `edge` |

## Vertices

| Export | Description |
|--------|-------------|
| `hex2verts(hex)` | Map from compass direction to canonical `IVertex` records (one per corner of the hex) |
| `vert2hexes(vert)` | The three `{q, r}` coordinates meeting at `vert` |
| `vert2edges(vert)` | The three edges meeting at `vert` |
| `vertNeighbours(vert)` | The three vertices adjacent to `vert` (each shares an edge with it) |

## Procedural growth

| Export | Description |
|--------|-------------|
| `generateField(numModules)` | Grows a cluster of `numModules` hex-module centre points; each module is a 7-hex flower and new modules attach edge-to-edge without overlap |

## Types

| Type | Description |
|------|-------------|
| `CompassDirection` | `"N"` \| `"NE"` \| `"E"` \| `"SE"` \| `"S"` \| `"SW"` \| `"W"` \| `"NW"` |
| `IHexCoord` | Axial coordinate `{ q, r }` |
| `IEdge` / `IVertex` | `IQRDir` — `{ q, r, dir, uid, orientation }` identifying an edge or vertex |

Also see `src/common/aiai.ts` for AiAi coordinate conversion (`hexhexAp2Ai`, `triAp2Ai`, etc.).

## Example games

- **[Streetcar Suburb](https://play.abstractplay.com/games/streetcar)** — edge and vertex incidence
- **[Exxit](https://play.abstractplay.com/games/exxit)** — hex neighbour traversal
- **[Tintas](https://play.abstractplay.com/games/tintas)** — `generateField` with `ModularBoard`
