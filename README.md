# Abstract Play Games Library

TypeScript implementations of the core Abstract Play games, intended to be wrapped by the front- and backends.

## Contributing

Currently all Abstract Play games must be coded in TypeScript and included in this library. Eventually externally hosted games will hopefully be supported. Until then, pull requests are welcome.

## Contact

The [main website](https://www.abstractplay.com) houses the development blog and wiki.

## Build

This module is designed specifically for Abstract Play. If someone does use this elsewhere, let me know :)

- Clone the repo.
- From the newly created folder, run the following commands:
  - `npm run npm-login` (provide your personal GitHub credentials; this is necessary to use the GitHub package system)
  - `npm install` (installs dependencies)
  - `npm run test` (makes sure everything is working)
  - `npm run build` (compiles the TypeScript files into the `./build` folder)
  - `npm run dist-dev` (or `dist-prod` if you want it minified; bundles everything for the browser into the `./dist` folder)
- The public-facing API is documented in `./docs/api.md`.

If you modify a schema, "compile" it with (for, e.g. the moveresults schema)
  `npx json2ts .\moveresults.json .\moveresults.d.ts`
or (better)
  `npm run json2ts`
json2ts adds
  /* tslint:disable */
to the header. We need to replace this with
  /* eslint-disable @typescript-eslint/naming-convention */
to keep eslint happy.

## Develop

To test any new code (before you deploy to the dev server) you can use the playground:
From the gameslib\playground folder:
- `npm run dist-dev`
- `cp ..\dist\APGames.js .`
- Also run `npm run dist-dev` in the renderer folder.
- `cp ..\..\renderer\dist\APRender.js .`
Now simply double click 'index.html'.
