# Change log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

* Pikemen: Fixed bug where unnecessary reorientation was throwing an error instead of just being ignored.
* Volcano: Fixed bug causing Volcano `sameMove` errors in some siutations.
* Blam!: Changed the click handler so it autoselects your smallest piece unless you manually select from your stash.
* Fendo: Fixed a bug where an error was raised when a partial move is legal, but there are no available fence placements. We want to allow this in order to show the move so that you can get reasons for each fence placement being impossible.
* Fixed the default `sameMove` implementation.
* The default `sameMove` was still not working for ambiguous ordo moves in Ordo. Implemented sortedReplacer.
* Chase: Fix (and improve) `sameMove`.
* Fendo: Embarrassingly, I missed an important rule. Moving is optional. I also started players with one too many pieces. Corrected.
* Homeworlds: Added `no-moves` descriptor to disable move generation on the front end.
* Fix sameMove when move1 is a game ending move.
* Martian Chess: Fixed a bug that occurred when someone resigned.
* Fendo: Fixed edge case where a trapped piece couldn't build a wall.
* Fix/improve the Chase move validation and click handler.
* Cannon: Fixed bug where move list shows, correctly, that a cannon could capture the further of two adjacent pieces but the system ultimately wouldn't allow it.
* Martian Chess: allow "undo"ing captures.

### Changed

* Homeworlds: Sorted the move list a little more logically.
* Added piece counts to Cannon and Ordo.

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
