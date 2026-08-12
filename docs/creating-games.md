# Creating games

Guide for adding a new game to gameslib. For API details see [Game object](/gameslib/game-object/) and [Helpers](/gameslib/helpers/).

## Workflow

1. **Fork** [gameslib](https://github.com/AbstractPlay/gameslib) and work on the `develop` branch.
2. Before first `npm install`, run `npm run npm-login` for GitHub Packages access.
3. **Create** `src/games/<uid>.ts` extending `GameBase` (or `GameBaseSimultaneous`).
4. **Run** `npm run generate-registry` (or any build/test) — the game registry is auto-generated from `static gameinfo`.
5. **Add i18n** strings to `locales/en/apgames.json` (and `apresults.json` if needed).
6. **Flag** new games with `experimental` in `gameinfo`.
7. **Test** locally — [Testing](/gameslib/testing/).
8. **PR** against `develop`; test on [play.dev.abstractplay.com](https://play.dev.abstractplay.com) after merge.

## Implementation checklist

- [ ] `static readonly gameinfo: APGamesInformation` (flag `experimental` must be set for all new games)
- [ ] State interfaces (`IMoveState`, `I<Name>State`)
- [ ] Constructor (new + deserialize via `reviver`)
- [ ] `move`, `render`, `state`, `load`, `clone`, `moveState`
- [ ] `moves()` unless using `no-moves` flag
- [ ] `handleClick` for interactive placement
- [ ] `validateMove` / `checkEOG` as needed
- [ ] Unit tests under `test/games/`
- [ ] Renderer JSON validated against [renderer schema](/renderer/schema-reference/)

Start from [/gameslib/templates/new-game-template.ts](/gameslib/templates/new-game-template.ts) and [Complica](https://play.abstractplay.com/games/complica).

## Choosing helpers

Most board games use either:

- **`RectGrid`** — rectangular boards with directions and algebraic coords ([Hnefatafl](https://play.abstractplay.com/games/tafl), [Go](https://play.abstractplay.com/games/go))
- **Graph classes** — hex, snubsquare, sowing, etc. ([Helpers overview](/gameslib/helpers/))

Use the [examples by feature](/gameslib/examples/by-feature/) index to find games similar to yours.

## Renderer

Implement `render(opts?)` returning `APRenderRep` for `@abstractplay/renderer`. Prototype JSON in the [renderer playground](https://renderer.dev.abstractplay.com).

## Example games

- **[Complica](https://play.abstractplay.com/games/complica)** — template baseline
- **[Yavalath](https://play.abstractplay.com/games/yavalath)** — hex graph game
