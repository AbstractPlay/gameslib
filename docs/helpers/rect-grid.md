# RectGrid

`RectGrid` (`src/common/rectGrid.ts`) models a bounded rectangular board with helpers for movement, adjacency, distances, and rays. Coordinates are integer `(x, y)` with `(0, 0)` at the top-left; `x` increases east and `y` increases south.

Static methods operate on raw coordinates and ignore board bounds. Instance methods use the grid's `width` and `height` for in-bounds checks.

## Movement and bearings

| Export | Description |
|--------|-------------|
| `RectGrid.move(x, y, dir, dist?)` | Returns `[newX, newY]` after moving `dist` steps (default 1) in `dir`; does not check bounds |
| `RectGrid.bearing(x1, y1, x2, y2)` | General compass direction from point 1 to point 2; `undefined` if the points are equal |
| `RectGrid.between(x1, y1, x2, y2)` | Cells strictly between two orthogonally or diagonally aligned points; throws if not aligned; ignores bounds |
| `RectGrid.isOrth(x1, y1, x2, y2)` | Whether two points share a row or column |
| `RectGrid.isDiag(x1, y1, x2, y2)` | Whether two points lie on a diagonal (`|dx| === |dy|`) |

## Distances

| Export | Description |
|--------|-------------|
| `RectGrid.manhattan(x1, y1, x2, y2)` | Manhattan (L1) distance |
| `RectGrid.distance(x1, y1, x2, y2)` | Chebyshev (king-move) distance: `max(|dx|, |dy|)` |
| `RectGrid.trueDistance(x1, y1, x2, y2)` | Euclidean distance |

## Instance methods

| Export | Description |
|--------|-------------|
| `new RectGrid(width, height)` | Create a `width` × `height` board |
| `inBounds(x, y)` | Whether `(x, y)` lies on the grid |
| `adjacencies(x, y, diag?)` | In-bounds neighbours; orthogonal only when `diag` is `false` (default `true`) |
| `ray(x, y, dir)` | In-bounds cells from `(x, y)` to the board edge in `dir`; excludes the start cell |
| `knights(x, y)` | In-bounds chess-knight destinations from `(x, y)` |

## Barrel exports (`src/common/index.ts`)

Related types and helpers re-exported from the common barrel:

| Export | Description |
|--------|-------------|
| `Direction` | `"N"` \| `"NE"` \| `"E"` \| `"SE"` \| `"S"` \| `"SW"` \| `"W"` \| `"NW"` |
| `allDirections` | All eight compass directions |
| `orthDirections` | Orthogonal directions: N, E, S, W |
| `diagDirections` | Diagonal directions: NE, SE, SW, NW |
| `oppositeDirections` | Map from each direction to its opposite |
| `coords2algebraic(x, y, height, reverseNumbers?)` | Convert grid coords to algebraic notation (e.g. `a1`); row numbers count down from `height` by default |
| `algebraic2coords(cell, height, reverseNumbers?)` | Parse algebraic notation back to `[x, y]` |

## When to use

Square or vertex boards where you track `(x, y)` integer coordinates and do not need a full graphology graph.

## Example games

- **[Hnefatafl](https://play.abstractplay.com/games/tafl)** — orthogonal movement and capture
- **[Go](https://play.abstractplay.com/games/go)** — large grid, vertex rendering
- **[Reversi](https://play.abstractplay.com/games/reversi)** — direction scans for flips
