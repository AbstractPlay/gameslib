# Change log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Since the `1.0.0-beta` release, the version in `package.json` has stayed at `1.0.0-beta`. CI publishes tarballs as `1.0.0-ci-<GitHub Actions run id>.0` (see `.github/workflows/node-dev.js.yml` and `node-prod.js.yml`). Entries below are grouped by theme and approximate **production** ship window (when changes landed on `main` and, for games, when they left the experimental catalogue). The exact CI build is whichever workflow run produced the artifact you installed.

**Going forward:** keep work-in-progress notes under `[Unreleased]`. When a change is merged to `main` and actually visible on the production site (non-`experimental` games and variants, or shared API/schema behaviour), move the bullets into a dated `[1.0.0-ci]` section. Do not log every commit.

## [Unreleased]

### Added

- **New games (dev / experimental only):** Agents of MARS, Bagh Chal, Bashni, Clearpath, Croda, Dama, Ice Palace, Kill-All Go, Neutron, Thricewise, Yodd.

## [1.0.0-ci] - 2026-10-04

### Added

- **Tumbleweed:** "Fog of war" variant (line-of-sight visibility, stale dimmed cells, hidden scores, redacted move tree after the opening ply; explore disabled).
- **Move table presentation API:** `getMoveTableRounds({ density, pathLength })`, `pathIndexForMoveTableCell`, `packPliesForMoveTable`, and exploration wire helpers (`moveTableRoundsFromExplorationPath`, …) on `GameBase` — export `getRounds()` unchanged; compact sequenced UI merges seat cycles.

### Changed

- **Bao:** Now uses frames, letting you visualize multi-lap sowing much more clearly.
- Normalized `localStash` emitters to dense bottom→top columns (no `"-"` spacers in Volcano, Mega-Volcano, Agents of MARS bag, and Ice Palace 3D hand/pool stashes).

### Fixed

- **Weblate sync:** `overlay-weblate-locales` + `reset-weblate-export` for hosted export vs GitHub `develop` (merge conflicts in Diagnostics).
- **Bao:** Fixed a regression introduced a few days ago that blocked taxing the nyumba.
- **Tumbleweed:** standard opening ply `lastmove` is stored as the full `p1,p2` wire; legacy games with only P1 in `lastmove`/`_results` are repaired from the stack-1 board delta for move history, export, and load; chat log uses one combined setup line.
- **Strip export (`state({ strip })`):** clone stack frames before redacting hidden information so `serialize({ strip, player })` no longer mutates the live engine (Jacynth, Biscuit, Quincunx, Frogger, Emu, Magnate, Pigs2, Siege of Jacynth, Cifra setup redaction).

## [1.0.0-ci] - 2026-09-30

### Added

- **New games:** Bridges, El Oso.
- **`gameinfo` metadata:** category and family tags; variant `people` for crediting designers; fan-made variant labelling; **retracted games** registry for removed catalogue entries.
- **Alternative displays:** combinable display groups (`implies`, `impliesLock`, back-pressure constraints, default checkbox behaviour). See [displays](/gameslib/displays/).
- **Crosshairs:** turbulence and concealed-fire variants (designer rules).
- **Arimaa:** lightvector notation and click-based move entry; Harlog leader shown as a coloured piece.
- **Sidebar status aids** for Mega-Volcano and Tintas (spoiler-friendly).
- **Asli:** area-scoring variant; Gonnect cascading variant follow-ups (including outright-win messaging and render fixes).
- **Bao:** `malawi-full` variant (Figure 2 Bawo rules); `malawi` renamed to setup-only (8 kuu / 20 reserve, Zanzibar rules); Zanzibar / kujifunza / Malawi variants share one `rules` radio group.

### Changed

- Production export strips **`experimental`** games, variants, and flags (`filterGameinfoForProduction`). Dev server continues to ship in-progress implementations.
- **Lielow:** “moves until suicide” score marked as a spoiler in status output.
- Button labels for shared UI moved into `apgames.json` (from the front end).

### Fixed

- **Bao:** Zanzibar rule alignment — mtaji mandatory nyumba relay after kutakata laps, takasia first-lap-from-nyumba exception, and namu kutakata placement (2+ unless all front pits are singletons); mtaji captures confirmed with `processMove` when the marker heuristic applies; mtaji kutakata forbids relay through an empty inner row and sole front kichwa kutakata must sow toward the center.
- **CIFRA:** numbered King/Sum pieces and stash labels stay upright when the board is rotated (`orientation: vertical` on piece labels).

### Removed

- Legacy embedded **AI** implementations (explore/automove paths retained where applicable).

## [1.0.0-ci] - 2026-08-30

### Added

- **Full ESM** package (`"type": "module"`, NodeNext emit); dual **browser/node** entry points; hardened CJS/ESM tests.
- **Structured chat** API refinements on top of the March sidebar/chat parameter work.
- **Structured sidebar / render labels** (i18n-ready status and score areas).
- **`ci-deps` prod/dev manifests** and relay pinning for `@abstractplay/renderer` / `@abstractplay/recranks`.
- **Game turn models** (`GameBaseSequenced` and related registry/docs); **dynamic build flags** for optional game subsets.
- **Variant constraints** and display back-pressure (phase 1).
- **Translatable game names**; Esperanto and **es-US** in the managed locale set; Weblate + automated translation pipeline updates.
- **New games:** BITESIZE (renamed from Eat Your Neighbor), Canoe, Carnac, Circle of Life, Druid, Estate, Even at Odds, Fractured, Guerrilla, Intermedium, Knight Line, Mutternland, Scribe, Stapeldammen, Swarm, Unstack.
- **Guerrilla:** match variant.

### Changed

- **`bggid`** on game metadata where BoardGameGeek ids exist.
- Homeworlds critical fix after renderer/Vite migration; Entropy annotation fix; Carnac EOG fix.

## [1.0.0-ci] - 2026-06-30

### Added

- **New games:** Abande Libre, Akimbo, Arimaa, Atarigo, Bamboo, BTT, Compart, Court, Crosscontrol, Enso, Forms, Frogger, Go, Halma, Halma Climbers, Invector, Krypte, Linage, Magnate, Minefield, Minimize, Narrows, Oonpia, Plurality, Pollux, Posit, Product, Rampart, Rincala, Sentinel, Shape Chess, Soccolot, Spora, Squirm, Stiletto, Synapse, Tanbo, Tricouleur, Twin Flames, Unane, Virus War, Waldmeister, Wunchunk, Xana.
- **`unrated` variant property**; expanded **custom colours** and Alien City customization docs.
- Modular **Tintas** layout variant.
- Sidebar API rename: `statuses()` → `sidebarStatuses()`, `getPlayersScores()` → `sidebarScores()`; **`scores` flag** now governs EOG email score lookup only (sidebars no longer need a flag).
- Centralized default **`randomMove()`**; removed per-game copies.
- **`players` parameter on `chat()`** (structured chat groundwork).

### Changed

- **`experimental` variant** property documented and enforced in production filtering.
- Playground support for **multi-render** games.

### Removed

- **Storm Clouds** (withdrawn from the catalogue).

## [1.0.0-ci] - 2025-12-31

### Added

- **New games:** Amoeba, Assembly, Azacru, Basalt, Biscuit, Bloqueo, C1, Catapult, Chameleon, Churn, Cifra, Conspirateurs, Cubeo, Deckfish, Emu, Emergo, Gliss, Gorogo, Gyges, Gyve, Kachit, Lasca, Meg, Morphos, Nakatta, Omny, Owlman, Pacru, Paintbucket, Pahtum, Penguin Soccer, Pilastri, Pontedd, Quincunx, Siege of Jacynth, Squaredance, Stairs, Stibro, Storisende, Sunspot, Surmount, Terrace, Tessella, Yavalath, Yonmoque.
- **`coder` / people metadata** on games; links to Abstract Play profiles; **implementation notes** filled in across many catalogue entries.
- Alternate **Amazons** displays.

### Changed

- **Biscuit** in-hand scoring variants; **Quincunx** hand/status display polish.
- **Homeworlds** variant display tweaks; **Decktet** display fixes for double-deck games.

## [1.0.0-ci] - 2024-12-31

### Added

- **New games:** Connections, Control, Dots and Boxes, Dragon Eyes, Gonnect, Hula, Jacynth, Konane, Lifeline, Logger, Lox, Majorities, Moon Squad, Pods, Pigs 2, Pylon, Query, Shifty, Strands, Subdivision, Tritium.
- **Adere** star board variant (with Connections/Boxes release batch).

### Changed

- **Pigs 2** special-move handling revamp (with Moon Squad release).

## [1.0.0-ci] - 2024-06-30

### Added

- **New games:** Anache, Asli, Atoll, Ayu, Binar, Blockade, Cairo Corridor, Catchup, Clusterfuss, Conect, Conhex, Connecticut, Dameo, Fightopia, Fnap, Four in a Row, Havannah, Hex, Mattock, Meridians, Nex, Onager, Oust, Oware, Pletore, Quax, Queensland, Reversi, Saltire, Spire, Spook, Spline, Sploof, Spree, Stigmergy, Susan, Symple, Tafl, Tablero, TBT, Tumbleweed, Twixt, Valley.
- **`categories` and `dateAdded`** on gameinfo; **`custom-randomization`** flag; **`custom-buttons`** / `getButtons()` (replacing ad-hoc pass buttons); **`custom-rotation`** scaffold.
- **`experimental` on variants** for production filtering.

### Changed

- Removed **`multistep`** flag; **`custom-pass`** retired in favour of custom buttons.
- **Entropy** simultaneous annotation/chat fixes.

## [1.0.0-ci] - 2023-12-31

### Added

- **New games:** Agere, Alien City, Almatafl, Armadas, Bao, Bide, Blooms, Boom & Zoom, Bounce, Clearcut, Complica, Crossway, Dag en Nacht, Diffusion, Fanorona, Flume, Focus, Furl, Generatorb, Hexagonal Y, Iqishiqi, Lielow, Mixtour, Mirador, Murus, Phutball, Pulling Strings, Quagmire, Realm, Robo Battle Pigs, Scaffold, Slither, Streetcar Suburb, Tintas, Toguz, Trike, Witch Stones, Wizard's Garden.
- **`experimental` game flag** so in-progress games can deploy to dev while staying off the production catalogue.
- **`check` flag** for front-end game-ending hints.
- **`notes` property** on `gameinfo` for implementation commentary.
- **Alternative displays** on Volcano and Mega-Volcano (flat vs 3D stack view).
- GitHub Actions **dev/prod CI** publishing `1.0.0-ci-*` tarballs.

### Changed

- **Homeworlds:** renderer and click-handler refresh; catastrophes mid-sacrifice; kamikaze draws; sorted move list.
- **Streetcar Suburb:** dashed newly claimed lines; mandatory second line when legal.
- **Taiji:** sum-of-squares and product scoring variants; **Lines of Action** classic 8×8 variant restored.

### Fixed

- Cross-game **`sameMove`** improvements (default implementation, Ordo, Chase, game-ending moves).
- Notable rule/validation fixes across **Cannon**, **Chase**, **Fendo**, **Homeworlds**, **LoA**, **Martian Chess**, **Pikemen**, **Tintas**, **Volcano**, **Zola**, and others shipped in this window.

## [1.0.0-beta] - 2023-04-30

Initial beta release.

## [0.6.0] - 2021-12-27

### Added

- Added the game Archimedes, with move generation and AI.
- Added the game Zola, with move generation and AI.
- Added the game Monkey Queen, with move generation and AI.
- Added the game Dipole, with move generation and AI.
- Added the game Alfred's Wyke. No move generation or AI.
- Added `pie` flag to signal games where the front end should give the second player a chance to change seats after the first move.

## [0.5.0] - 2021-12-10

### Added

#### New Games
- Added Accasta, with move generation and very slow AI (large move tree).
- Added Epaminondas, with move generation and slow AI. I also added the "stones" variant proposed by Néstor Romeral Andrés.
- Added Taiji (superior variant of Tonga), with three board sizes, three scoring options, and the "Tonga" variant that allows diagonal placement.
- Added Breakthrough, with move generation an stupid AI. Also included the "Bombardment" variant.
- Added Fabrik, including the "Arbeiter" variant. It includes move generation but no AI. The move tree is too big for too long.
- Added Manalath, including move generation but no AI.
- Added Urbino, with move generation but no AI. Includes the "Monuments" variant.

#### New Features

- Click handling, including extensive validation and localized error messages, has been added to all games!
- Added `renderColumn(col: number, row: number): APRenderRep` function to all `stacking-expanding` games. This will return a separate JSON render for *just* the expanded stack. This should greatly improve performance.

## [0.4.0] - 2021-11-15

### Added

- Added `flags` to the `gameinfo` schema to signal to the front-end various features that may need special support. See documentation for details.
- Added Abande, with move generation and AI.
- Added Attangle, with move generation and AI.
- Added Ordo, with move generation and very, very slow AI (need to optimize move generation).
- Added Cephalopod, with move generation and AI (and snubsquare board).
- Added Lines of Action. It's the 9x9 black hole variant, with an optional Scrambled Eggs initial layout. Supports move generation and stupid AI.
- Added Pikemen, with move generation and brain-dead AI.

## [0.3.0] - 2021-11-12

### Added

#### New Games

- Entropy game added. This includes move generation but not AI. Hopefully AI will be doable later.

  This is the first simultaneous game. The engine itself does not accept partial moves. All players' moves must be submitted at the same time. This adds complexity to the API server, which must store partial moves for a time, but prevents the hidden information being stored and transmitted by the game state, which is visible to the client browser.
- Added the modern Volcano, which differs from what was implemented on SDG (no move generation or AI).
- Added the original Mega-Volcano (no move generation or AI).
- Added Chase! Phew! (Includes move generation and rudimentary AI.)

#### Other Features

- i18n is working! Error messages and game chat logs can now all be translated.
- Added a new `eject` move result to signal consequential movement (e.g., eruptions in Volcano).
- Added the `showAnnotations` toggle to the playground.
- Added click handler for Volcano and Mega-Volcano to the playground.

## [0.2.1] - 2021-10-31

### Added

- Homeworlds now uses the expanded annotations feature of the renderer.
- There is now a move generator for Homeworlds! It's not particularly efficient, but it appears to at least function.
- A rudimentary AI has been added, but it's very uneven. The move tree for Homeworlds can balloon quickly with a lot of movement actions.

## [0.2.0] - 2021-10-29

### Added

- Games now produce valid game reports.
- Homeworlds has been implemented. No move generation or AI.

### Changed

- Public API tweaked a little to hide unnecessary details. The `serialize()` function will return a string that can now be handed to the constructor.

## [0.1.0] - 2021-10-21

### Added

- The game "Amazons" has been implemented, including a rudimentary and very slow AI.
- The game "Blam!" has been implemented, including a rudimentary AI.
- The game "Cannon" has been implemented, including a rudimentary AI.
- The game "Martian Chess" (2-player only, including "Of Knights and Kings" variant) has been implemented, including a rudimentary AI.
- Playground added.
- Public API documented
