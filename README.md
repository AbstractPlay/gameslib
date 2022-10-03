# Abstract Play Games Library

TypeScript implementations of the core Abstract Play games, intended to be wrapped by the front- and backends.

## Contributing

Currently all Abstract Play games must be coded in TypeScript and included in this library. Eventually externally hosted games will hopefully be supported. Until then, pull requests are welcome.

## Contact

The [main website](https://www.abstractplay.com) houses the development blog and wiki.

## Deploy

This is a basic NPM module; it's just private. It's not meant to be generally useful to anyone outside of myself. It is designed specifically for Abstract Play. If someone does use this elsewhere, let me know :)

- Clone the repo.
- From the newly created folder, run the following commands:
  - `npm install` (installs dependencies)
  - `npm run test` (makes sure everything is working)
  - `npm run build` (compiles the TypeScript files into the `./build` folder)
  - `npm run dist-dev` (or `dist-prod` if you want it minified; bundles everything for the browser into the `./dist` folder)
- The public-facing API is documented in `./docs/api.md`.

If you modify a schema, "compile" it with (for, e.g. the moveresults schema)
  `npx json2ts .\moveresults.json .\moveresults.d.ts`
