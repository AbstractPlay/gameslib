# Testing

## Unit tests

```bash
npm test
```

Game-specific tests live in `test/games/`. Good unit tests will save future you (and future maintainers) a lot of headaches. No need to test basic stuff tested elsewhere (like graph/grid functions), but it's wise to test end-of-game resolution and any edge cases. See existing tests for patterns.

## CLI example

`bin/example.ts` — run moves from the command line:

```bash
npx ts-node bin/example.ts <uid> [moves...]
```

## Browser playground

The **standalone** gameslib playground is not part of the docs site:

**[gameslib.dev.abstractplay.com](https://gameslib.dev.abstractplay.com)**

### Local setup

1. **Build** — from the gameslib repo root:

   ```bash
   npm run playground
   ```

   This builds `APGames.min.js`, copies `locales/`, and copies `playground.*` into `dist/`.

2. **Serve over HTTP** — required (do not open `playground.html` via `file://`). Use WAMP/LAMP/nginx, or:

   ```bash
   npm run playground:serve
   ```

   Point your server at **`dist/`** as the document root (or copy the contents of `dist/` into your vhost).

3. **Open** — `http://localhost:<port>/` or `http://localhost:<port>/playground.html`

4. **Renderer** — `playground.html` loads `APRender.min.js` from the dev CDN by default. Only build or copy a local renderer bundle if you are working on renderer.

### Translations

Game descriptions, variant names, and other strings are loaded at runtime from `./locales/{lang}/{ns}.json` beside `playground.html`. `npm run playground` copies these into `dist/locales/`.

If descriptions show raw keys like `apgames:descriptions.complica`:

- Confirm `dist/locales/en/apgames.json` exists.
- Confirm you are serving over HTTP, not `file://`.
- Do not serve only `playground/` without `locales/` — serve the full `dist/` output.

The browser console will warn if locale bundles failed to load.

### Troubleshooting (WAMP / subfolder hosting)

If you serve from a subdirectory (e.g. `http://localhost/myproject/playground.html`), locale files must still sit beside `playground.html` in that folder (`myproject/locales/...`). The relative load path resolves from the page URL, not the server document root — so copying the full `dist/` contents into your vhost subfolder is the simplest approach.

## Renderer output

Prototype board JSON at [renderer.dev.abstractplay.com](https://renderer.dev.abstractplay.com) before wiring `render()` in your game.

## Chat log

When you override `collectChatLogLine` or `chatLogEntries`, verify output with `assertChatLogParity(game, playerNames)` from [`test/fixtures/chat/helpers.ts`](/gameslib/test/fixtures/chat/helpers.ts). CI runs [`test/games/chatLogParity.test.ts`](/gameslib/test/games/chatLogParity.test.ts) for registry games with fixtures.

After collector changes, refresh local goldens (gitignored fixtures): `npm run refresh-chat-golden-entries` and/or `npm run refresh-chat-golden`.

See [Structured move log](/gameslib/structured-chat-log/) for simultaneous indexing, aggregated frames, and anti-patterns.

## Example games

- **[Complica tests](https://github.com/AbstractPlay/gameslib/tree/develop/test/games)** — grep `complica` under `test/games/`
