# Games Library

`@abstractplay/gameslib` contains TypeScript implementations of all Abstract Play games. The front end and back end load games through a small public API.

## Documentation

- [API](api/) — `gameinfo`, `GameFactory`, `addResource`
- [Creating games](creating-games/) — fork, implement, register, PR workflow
- [Game object](game-object/) — `GameBase` contract and lifecycle
- [Flags](flags/) — `gameinfo` flags reference
- [Helpers](helpers/) — grids, graphs, serialization, and shared utilities
- [i18n](i18n/) — translation files
- [Testing](testing/) — CLI, playground, unit tests
- [Examples by feature](examples/by-feature/) — which games use which helpers

## Resources

- [Renderer docs](/renderer/) — board JSON schema
- [Renderer playground](https://renderer.dev.abstractplay.com) — experiment with `render()` output
- [Gameslib playground](https://gameslib.dev.abstractplay.com) — run games in the browser
- [Wiki (legacy)](https://abstractplay.com/wiki/doku.php?id=coding_docs)
- [Discord #dev-curious](https://discord.abstractplay.com)

*Last verified against `develop` branch.*

When changing `GameBase`, `gameinfo.json`, or public exports, update `/docs` in the same PR.
