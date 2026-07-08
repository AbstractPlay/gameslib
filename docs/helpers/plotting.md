# Plotting and geometry

`src/common/plotting.ts` — angles, bearings, segment intersection, polyomino rotations/reflections, matrix transforms.

## Key API

- `deg2dir`, `dir2deg`, `rotateFacing`, `calcBearing`, `projectPoint`
- `linesIntersect`, `pointOnSegment`, `pointOrientation`
- `allRotationsAndReflections` — polyomino symmetry variants
- `transposeRect`, `matrixRectRot90`

## Example games

- **[Pontedd](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/pontedd.ts)** — line intersection
- **[Minefield](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/minefield.ts)** — polyomino transforms
- **[Armadas](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/armadas.ts)** — bearings and projection
