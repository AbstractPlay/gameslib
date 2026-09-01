# Consumer API

The root module (`src/index.ts`) exports the public API used by the front end and node-backend.

## Exports

| Symbol | Role |
|--------|------|
| `gameinfo` | `Map<string, APGamesInformation>` of all games |
| `gameinfoSorted` | Same metadata, sorted by name |
| `GameFactory(uid, ...args)` | Instantiate or resume a game |
| `resolveGameFlags(uid, context?)` | Effective flags for a challenge context (variants, player count) |
| `getFlags()` (on game instances) | Effective flags for the active session — see [Flags](/gameslib/flags/) |
| `GameFlag`, `FlagContext` | Types for flag resolution |
| `addResource(lang?)` | Merge i18n bundles into host or internal i18next |
| `supportedLocales` | e.g. `["en", "fr", "es-US"]` |
| `resolveLocale` | Map a browser/user language tag to a supported locale (e.g. `es-MX` → `es-US`) |
| `GameBase`, `GameBaseSequenced`, `GameBaseSimultaneous`, `GameBaseSkipTurn` | Base classes for game authors |
| `filterGameinfoForProduction`, `allowedChallengeVariantUids`, `assertAllowedChallengeVariants` | Production filtering for challenge metadata |
| `validateVariantSelection`, `assertValidVariantSelection`, `sanitizeVariantSelection`, `evaluateAvailability`, `resolveIncomingVariants` | Declarative variant constraint evaluation — see [Variants](/gameslib/variants/) |
| `assertChallengeVariantSelection`, `assertChallengeVariants` | Challenge API guards (combination + production allowlist) |
| `TurnModel`, `IGamePly`, `IGameRound`, `IGameRoundSlot` | Turn-model types (`getPlies` / `getRounds`) |
| `ChatActorRef`, `ChatLogLine`, `ChatLogEntry`, `ChatLogCollectContext`, `ChatLogTranslate` | Structured move-log types ([`chat-log.ts`](/gameslib/src/common/chat-log.ts)) |
| `formatChatLogEntries`, `formatChatLogEntryNodes` | Format structured entries with i18n + seat display names |
| `chatPlayerToken`, `applyChatPlayerNames` | `Player N` token helpers for seat-actor lines |
| `RenderLabel`, `StructuredRenderLabel`, `isStructuredRenderLabel`, `resolveRenderLabel`, `resolveRenderLabels` | Structured area/board labels ([`render-label.ts`](/gameslib/src/common/render-label.ts)) |

AI helpers (`AIFactory`, etc.) exist for testing only and are not part of the public release API.

## Usage

**Browser:** load `APGames.min.js`, then `APGames.GameFactory("complica")`.

**Node:** `import { GameFactory, gameinfo } from "@abstractplay/gameslib"`.

## `gameinfo`

Self-describing metadata per game, matching [`gameinfo.json`](https://github.com/AbstractPlay/gameslib/blob/develop/src/schemas/gameinfo.json). Each entry includes uid, name, description (i18n key), URLs, people, player counts, variants, and flags.

In production builds, `gameinfo` omits experimental games and experimental variants. Use `gameinfo` / `gameinfoSorted` variants for new challenges and tournaments. On a game instance, use `challengeVariants()` for the same filtered picker UI. Use `allvariants()` for historical games and in-game display of active variant uids.

See [Flags](/gameslib/flags/) for flag semantics. Static `gameinfo.flags` is the default set; use `resolveGameFlags` or `game.getFlags()` when flags may vary by variant or player count. Variant **combinations** are separate — see [Variants](/gameslib/variants/).

## `resolveGameFlags`

```ts
import { resolveGameFlags } from "@abstractplay/gameslib";

const flags = resolveGameFlags("basalt", { variants: ["pie"], numplayers: 2 });
// → includes "pie-even" when pie variant selected
```

Looks up the game class and calls `GameClass.resolveFlags(context)`. Returns `[]` for unknown uids. Use in challenge UI when variants or player count change and no engine instance exists yet.

`FlagContext`: `{ variants?: string[]; numplayers?: number }`. `GameFlag` is the union of allowed flag strings from `gameinfo.json`.

## `GameFactory`

```ts
const game = GameFactory("complica");           // new game
const resumed = GameFactory("complica", saved); // from serialize() string or state
```

Returns `undefined` for unknown uids.

## `addResource`

```ts
const i18n = APGames.addResource("en");
const { t } = i18n;
// namespaces: apgames, apresults
```

Player-facing errors use `UserFacingError` with localized `client` messages.

## Game object

Games returned by `GameFactory` implement the [game object](/gameslib/game-object/) interface: `move`, `render`, `state`, `serialize`, UI hooks, turn model (`getPlies`, `getRounds`, `turnModel`), record export (`recordExportExclude`, `genRecord`), move log (`chatLogEntries`), and **`getFlags()`** for effective session flags.

**Flags (consumers):** call `game.getFlags()` for optional UI (pie, stashes, check display, etc.). For challenge setup before an instance exists, use `resolveGameFlags(uid, { variants, numplayers })`. See [Flags](/gameslib/flags/).

**Variants (consumers):** call `validateVariantSelection` or `evaluateAvailability` when building variant pickers; use `assertChallengeVariants` on the server for new challenges. See [Variants](/gameslib/variants/).

**Move log (consumers):** call `formatChatLogEntryNodes(game.chatLogEntries(playerNames), playerNames, t)`. For solo games pass one human name. See [Structured move log](/gameslib/structured-chat-log/#consumer-integration).

**Render labels (consumers):** call `resolveRenderLabels(rep, playerNames, t)` before drawing (exported from gameslib; playground and Abstract Play front use this). Resolves structured `label` fields only.

**Move log (game authors):** see [Structured move log](/gameslib/structured-chat-log/).

**Render labels (game authors):** use `seatAreaLabel()` / `neutralAreaLabel()` in `render()` — see [Structured render labels](/gameslib/structured-render-labels/).

## Example games

- **[Complica](https://play.abstractplay.com/games/complica)** — minimal reference implementation (see also [template](/gameslib/templates/new-game-template.ts))
- **[Hnefatafl](https://play.abstractplay.com/games/tafl)** — `RectGrid` on a square board
