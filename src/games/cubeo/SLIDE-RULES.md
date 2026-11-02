# Cubeo slide rules (engine mapping)

Player-facing rules: [Cubeo rules PDF](https://rules.abstractplay.com/cubeo.pdf). Hive vocabulary on the [AP wiki](https://abstractplay.com/wiki/doku.php?id=games:cubeo) (One Hive Rule, Freedom to Move Rule) matches the PDF’s ubiquitous rules.

This document maps those rules to the code that lists legal moves. Move listing uses [`CubeoSlideTopology`](slide-topology.ts) and [`CubeoBoardMoveCache`](board.ts) (one `CubeoGraphPassCache` per `moves()`). [`formation-graph.ts`](formation-graph.ts) builds formation/move graphs; parity gates compare cached topology to uncached `buildCubeoMoveGraph`.

## Ubiquitous rules (PDF)

| Rule | Player meaning | Engine |
|------|----------------|--------|
| **Single Formation** | All dice stay edge-connected (corners do not connect) | `CubeoBoard.isConnected`; enforced when applying add/remove/move |
| **Pinning** | If removing a die would break Single Formation, it cannot move | `CubeoBoard.isPinned` (orthogonal articulation) |
| **Slide (Freedom to Move)** | Enter/leave only via sliding without lifting or shifting other dice | `canSlide` / `buildCubeoMoveGraph` — exterior padding cell reachable (rel coord `0`) |

## Turn actions

### Place (`+x,y`)

- Touch at least one friendly die on an **edge**; no **edge** touch to enemy (diagonal corner contact with enemy is OK per PDF).
- Must slide in from outside (Slide Rule).
- **Code:** [`CubeoGame.computeMoves`](../../cubeo.ts) scans formation fringe empties; `boardCache.canSlide(absx, absy)`.

### Move (`pips,x,y->nx,ny`)

- Unpinned die; walk exactly **pips** steps, one face at a time along the structure; **backtracking allowed**.
- Must not use gaps too narrow to pass without disturbing the structure (Slide Rule / “narrow gap”).
- Default: end cell ≠ start. **Strict:** formation must not be only a rotation/reflection of the start (`formationCanonicalKey`).
- **Code:** BFS on cached `buildCubeoMoveGraph` via `CubeoSlideTopology.moveEndAbsKeys`; drop start cell from targets.

**Gap jump:** Legal when the move graph keeps an edge between empty cells that share appropriate die adjacency through the gap-jump filter in `buildCubeoMoveGraph`. Regression: fixture `gapJump`, move `2,0,2->-1,2` ([`GAP_JUMP_MOVE`](../../../test/fixtures/cubeo/scenarios.ts)).

### Merge (`pips,x,y+>x2,y2`)

- At least three dice in the structure; orth-adjacent pair; mover not pinned; mover can slide (Slide Rule); wiki also requires reaching the outside — engine uses `canSlide` on participants.
- **Code:** merge loop in `computeMoves` with `isPinned` / `canSlide`.

## Formation graph (`buildCubeoFormationGraph`)

1. Pad bounding box by one empty ring (`width+2` × `height+2` relative grid).
2. Keep empty cells orth-adjacent to at least one die.
3. Drop diagonal edges between two dice.
4. For each remaining diagonal through an empty cell, drop if both “channel” orth cells off the diagonal are occupied (unless that cell is `ignore` for move-graph construction), or if both channel cells are empty.

The `ignore` rel cell loosens diagonal filtering when building a move graph from a moving die (treat that padded cell as not blocking the channel).

## Move graph (`buildCubeoMoveGraph`)

1. Start from formation graph with `ignore` at the query cell.
2. If query is a die, drop fringe empties orth-adjacent **only** to that die.
3. **Gap-jump filter:** drop edges between empty nodes unless endpoints share an orth-adjacent die, or share a neighbour-of-neighbour linkage (see implementation comments in `formation-graph.ts`).
4. Remove all other dice nodes; keep only the connected component of the start cell.

## Parity tests

[`test/games/cubeo.slide-parity.test.ts`](../../../test/games/cubeo.slide-parity.test.ts) compares `CubeoSlideTopology` to `CubeoBoard.canSlide` / legacy BFS endpoints on all [`CUBEO_SCENARIOS`](../../../test/fixtures/cubeo/scenarios.ts).

## Out of scope

- Hex grid, “The Bug” variant (PDF only; not in AP registry).
- Changing strict or d8/d10/d12 merge goals.
