# RectGrid

`RectGrid` (`src/common/rectGrid.ts`) models a bounded rectangular board with helpers for movement, adjacency, distances, and rays.

## Key API

- `move(x, y, direction)` — new coordinates or off-board
- `inBounds(x, y)`, `adjacencies(x, y)`, `ray(x, y, direction)`
- `manhattan`, `distance`, `trueDistance`, `bearing`
- `knights(x, y)` — knight moves from a cell

Barrel exports: `Direction`, `allDirections`, `orthDirections`, `diagDirections`, `coords2algebraic`, `algebraic2coords`.

## When to use

Square or vertex boards where you track `(x, y)` integer coordinates and do not need a full graphology graph.

## Example games

- **[Tafl](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/tafl.ts)** — orthogonal movement and capture
- **[Go](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/go.ts)** — large grid, vertex rendering
- **[Reversi](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/reversi.ts)** — direction scans for flips
