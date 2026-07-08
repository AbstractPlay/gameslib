# Plotting and geometry

`src/common/plotting.ts` — angles, bearings, segment intersection, polyomino rotations/reflections, and matrix transforms.

Angles use **table facing**: 0° is due north and increases clockwise (matching board-game convention). `toggleFacing` converts to/from standard planar angles (0° east, counterclockwise).

## Direction and angles

| Export | Description |
|--------|-------------|
| `deg2dir` | Maps compass bearings in degrees (multiples of 45) to `Direction` labels |
| `dir2deg` | Maps `Direction` labels to compass bearings in degrees |
| `rotateFacing(facing, delta)` | Rotates a facing by `delta` degrees (rounded to the nearest 45°) |
| `normDeg(deg)` | Normalizes a degree measurement to `[0, 360)` |
| `deg2rad(deg)` | Converts degrees to radians |
| `rad2deg(rad)` | Converts radians to degrees |
| `toggleFacing(n)` | Converts between table facing and planar angles |
| `smallestDegreeDiff(deg1, deg2)` | Signed shortest angular difference from `deg2` to `deg1`, in `(-180, 180]` |

## Points and bearings

| Export | Description |
|--------|-------------|
| `projectPoint(x, y, dist, deg)` | Projects from `(x, y)` by `dist` along table-facing `deg`; returns `[newX, newY]` |
| `calcBearing(x1, y1, x2, y2)` | Table-facing bearing from point 1 to point 2 |
| `ptDistance(x1, y1, x2, y2)` | Euclidean distance between two points |
| `midpoint(x1, y1, x2, y2)` | Midpoint between two points |
| `circle2poly(cx, cy, r, steps?)` | Approximates a circle as a polygon (default 64 vertices) |
| `distFromCircle(circle, point)` | Shortest distance from a point to a circle's circumference |

## Segment intersection

| Export | Description |
|--------|-------------|
| `pointOnSegment(p, q, r)` | Whether `q` lies on the closed segment `pr` (bounding-box test) |
| `pointOrientation(p, q, r)` | Orientation of triplet `(p, q, r)`: `0` collinear, `1` clockwise, `2` counterclockwise |
| `linesIntersect(p1, q1, p2, q2)` | Whether segments `p1q1` and `p2q2` intersect (including collinear overlap) |

## Matrix transforms

| Export | Description |
|--------|-------------|
| `transposeRect(lst)` | Transposes a rectangular 2D array (all rows must have equal length) |
| `matrixRectRot90(lst)` | Rotates a square matrix +90° (transpose, then reverse rows) |
| `matrixRectRotN90(lst)` | Rotates a square matrix −90° (reverse rows, then transpose) |

## Polyomino symmetry

| Export | Description |
|--------|-------------|
| `Delta` | Relative offset `{ dx, dy, payload }` for labelled shape points |
| `allRotationsAndReflections(deltas, options?)` | All unique D4 rotations/reflections of a delta-shape; retains each point's `payload`. Options: `includeReflections` (default `true`), `normalize` (`"none"` or `"minToOrigin"`) |

## Example games

- **[Ponte del Diavolo](https://play.abstractplay.com/games/pontedd)** — line intersection
- **[Minefield](https://play.abstractplay.com/games/minefield)** — polyomino transforms
- **[Armadas](https://play.abstractplay.com/games/armadas)** — bearings and projection
