# Plotting and geometry

`src/common/plotting.ts` — angles, bearings, segment intersection, polyomino rotations/reflections, matrix transforms.

## Key API

- `deg2dir`, `dir2deg`, `rotateFacing`, `calcBearing`, `projectPoint`
- `linesIntersect`, `pointOnSegment`, `pointOrientation`
- `allRotationsAndReflections` — polyomino symmetry variants
- `transposeRect`, `matrixRectRot90`

## Example games

- **[Pontedd](https://play.abstractplay.com/games/pontedd)** — line intersection
- **[Minefield](https://play.abstractplay.com/games/minefield)** — polyomino transforms
- **[Armadas](https://play.abstractplay.com/games/armadas)** — bearings and projection
