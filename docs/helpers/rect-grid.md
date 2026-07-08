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

- **[Tafl](https://play.abstractplay.com/games/tafl)** — orthogonal movement and capture
- **[Go](https://play.abstractplay.com/games/go)** — large grid, vertex rendering
- **[Reversi](https://play.abstractplay.com/games/reversi)** — direction scans for flips
