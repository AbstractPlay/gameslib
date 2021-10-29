# Change log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
