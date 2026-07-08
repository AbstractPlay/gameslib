# Testing

## Unit tests

```bash
npm test
```

Game-specific tests live in `test/games/`. See existing tests for patterns.

## CLI example

`bin/example.ts` — run moves from the command line:

```bash
npx ts-node bin/example.ts <uid> [moves...]
```

## Browser playground

The **standalone** gameslib playground is not part of the docs site:

**[gameslib.dev.abstractplay.com](https://gameslib.dev.abstractplay.com)**

To run locally you need:

1. A local web server (LAMP or similar)
2. `playground/index.html`
3. `APRender.min.js` from [renderer playground](https://renderer.dev.abstractplay.com/APRender.min.js) or `npm run dist-dev` in renderer
4. `APGames.min.js` from `npm run dist-dev` in gameslib

## Renderer output

Prototype board JSON at [renderer.dev.abstractplay.com](https://renderer.dev.abstractplay.com) before wiring `render()` in your game.

## Example games

- **[Complica tests](https://github.com/AbstractPlay/gameslib/tree/develop/test/games)** — grep `complica` under `test/games/`
