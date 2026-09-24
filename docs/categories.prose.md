# Game categories and tags

Explore and recommendations use **`gameinfo.categories`** on each game: hierarchical tag ids such as `goal>align`, `mechanics>capture`, `board>connect>hex`, and `components>pyramids`. Set them on the static `gameinfo` object in each `src/games/<uid>.ts` file. See [gameinfo metadata](/gameslib/gameinfo/) and [Explore](/front/subsystems/explore/) on the front client.

Player-facing tag labels live in front English i18n (`categories.*` in `apfront.json`). When you add a new tag id, add matching i18n keys there in the same PR.

The **games listed under each tag** are generated at docs build time from the registry (`npm run gen-docs-catalog`). Edit this file (`categories.prose.md`) for narrative sections; do not hand-edit `docs/categories.md`.

---

## Goals (`goal>…`)

Win-condition families (what determines who wins). One game may map to multiple goals in authoring; production tags use the `goal>` prefix.

| Concept | Meaning |
| --- | --- |
| **Align** | Create a particular configuration (often N-in-a-row or a shape) |
| **Annihilate** | Destroy all opposing pieces |
| **Area control** | Control more area than the opponent |
| **Breakthrough** | Reach the opposing home row or space |
| **Connect** | Connect edges or regions |
| **Cripple** | Destroy a critical subset of pieces |
| **Evacuate** | Remove your pieces from the board |
| **Immobilize** | Leave the opponent unable to move |
| **Majority** | Hold more pieces than the opponent |
| **Royal capture** | Capture a specific piece |
| **Royal escape** | Move a specific piece to safety or off the board |
| **Score (race)** | Be first to a score threshold |
| **Score (at EOG)** | Highest score when the game ends |
| **Set collection** | Collect sets of pieces or symbols |
| **Unify** | Join all your pieces into one group |

---

## Mechanics (`mechanics>…`)

How play proceeds — movement, capture, randomness, and similar. Tags describe **mechanisms**, not goals.

Examples used in the catalog:

| Mechanic | Meaning |
| --- | --- |
| **Asymmetry** | Goals or rules differ by side (metadata, not a single move type) |
| **Bear off** | Remove your own pieces from the board |
| **Block** | Block cells or paths |
| **Capture** | Remove opposing (sometimes own) pieces |
| **Convert** | Change piece ownership during play |
| **Co-opt** | Place or move opposing pieces |
| **Differentiate** | Piece types with distinct rules |
| **Displace** | Moves cause consequential movement of other pieces |
| **Enclose** | Enclose areas or groups |
| **Hidden information** | Opponents' pieces or resources are concealed |
| **Manage economy** | Shared bank of resources outside the board |
| **Move** | Move existing pieces (general, group, or sowing) |
| **Merge/Split** | Combine or split stacks beyond basic stacking |
| **Network building** | Build a network on the board |
| **Place** | Place new pieces |
| **Programmed actions** | Pre-programmed moves (e.g. Robo Battle Pigs) |
| **Randomize** | Random setup or random outcomes during play |
| **Set collection** | Collect configurations as a mechanic |
| **Share** | Shared pieces between players |
| **Simultaneous** | Simultaneous action in at least one phase |
| **Stack** | Stack manipulation is central |

---

## Board (`board>…`)

Playing surface — connectivity, shape, dynamic growth, mancala boards, or no fixed board.

| Concept | Meaning |
| --- | --- |
| **None** | No fixed board (e.g. free placement) |
| **Dynamic** | Board grows or changes during play |
| **3D** | Three-dimensional layout |
| **Mancala** | Traditional mancala-style pits |
| **Cell / connectivity** | Square, hex, rect, snubsquare, linear, pent, or other cell connection |
| **Shape** | Overall board shape (rect, hex, tri, circle, …) |

Most rect-grid games share `board>connect>rect`; hex games use `board>connect>hex`, and so on.

---

## Components (`components>…`)

Physical or logical piece sets the game expects.

| Component | Meaning |
| --- | --- |
| **Decktet** | Decktet deck |
| **Dice** | Dice-driven |
| **Looney pyramids** | Icehouse / Looney pyramids |
| **Piecepack** | Piecepack set |
| **Polyominoes** | Polyomino pieces |
| **Shibumi** | Shibumi set |
| **Simple** | Uniform coloured pieces (most abstract games) |
| **Simple: paper & pencil** | Paper-and-pencil style |
| **Other specialized** | Custom or multi-type components |

---
