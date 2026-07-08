# Games Library

`@abstractplay/gameslib` contains TypeScript implementations of all Abstract Play games. The front end and back end load games through a small public API.

## Documentation

- [Creating games](/gameslib/creating-games/) — fork, implement, register, PR workflow
- [Testing](/gameslib/testing/) — CLI, playground, unit tests
- [API](/gameslib/api/) — `gameinfo`, `GameFactory`, `addResource`
- [Game object](/gameslib/game-object/) — `GameBase` contract and lifecycle
- [Flags](/gameslib/flags/) — `gameinfo` flags reference
- [Helpers](/gameslib/helpers/) — grids, graphs, serialization, and shared utilities
- [i18n](/gameslib/i18n/) — translation files
- [Examples by feature](/gameslib/examples/by-feature/) — which games use which helpers

## Resources

- [Renderer docs](/renderer/) — board JSON schema
- [Renderer playground](https://renderer.dev.abstractplay.com) — experiment with `render()` output
- [Gameslib playground](https://gameslib.dev.abstractplay.com) — run games in the browser
- [Wiki (legacy)](https://abstractplay.com/wiki/doku.php?id=coding_docs)
- [Discord #dev-curious](https://discord.abstractplay.com)

*Last verified against `develop` branch.*

When changing `GameBase`, `gameinfo.json`, or public exports, update `/docs` in the same PR.
