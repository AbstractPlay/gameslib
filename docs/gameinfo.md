# gameinfo metadata

Each game class exposes `static readonly gameinfo: APGamesInformation`. That object is merged into the exported `gameinfo` map (`gameinfo.get(uid)`). The **schema** for this shape lives in source control as JSON; TypeScript types are generated from it.

## Schema source of truth

| File | Role |
|------|------|
| [`src/schemas/gameinfo.json`](/gameslib/src/schemas/gameinfo.json) | **Edit this** when adding or changing metadata fields |
| [`src/schemas/gameinfo.d.ts`](/gameslib/src/schemas/gameinfo.d.ts) | **Generated** — do not edit by hand |

After changing `gameinfo.json`, regenerate types:

```bash
npm run json2ts
```

Commit **both** the JSON and the updated `.d.ts` in the same PR. The `json2ts` script also refreshes `moveresults.d.ts` and `tafl/ruleset.d.ts`; commit those outputs if they change.

`APGamesInformation` and related interfaces (`CustomizationPalette`, `Variant`, …) are produced by [`json-schema-to-typescript`](https://github.com/bcherny/json-schema-to-typescript) from the JSON Schema definitions under `src/schemas/`.

## Per-game `gameinfo` objects

In each `src/games/<uid>.ts` file, set fields on the static `gameinfo` object: `name`, `uid`, `version`, `playercounts`, `categories`, `flags`, `variants`, `customizations`, and so on. Values must satisfy the generated TypeScript types.

See [Creating games](/gameslib/creating-games/) for the overall workflow. [Flags](/gameslib/flags/) and [Variants](/gameslib/variants/) document those sub-schemas in prose.

## `customizations` (palette and board context)

Games with `custom-colours` (or games that document palette usage for Customize) may list `customizations`: an array of **palette** entries and/or **context** entries.

### Palette entries (`num` + `default` + `explanation`)

Each entry describes one renderer palette slot (1–12). Users can override these in **Customize → Player Colours**.

| Field | Required | Meaning |
|-------|----------|---------|
| `num` | yes | Renderer palette slot number (1-based) |
| `default` | yes | Default colour (hex string or palette index) |
| `explanation` | yes | Short help text shown in Customize |
| `player` | no | **Player seat** (1-based) when this slot is that player's **piece colour** |

### When to set `player`

Add `player: N` only on slots that are a **player's piece colour**. Do **not** tag pawns, trees, walls, permits, shared pieces, symbol overlays, or other non-player palette entries.

Examples:

| Game | Player slots | Leave untagged |
|------|--------------|----------------|
| Standard 2P (slots 1–2) | `num: 1, player: 1` and `num: 2, player: 2` | — |
| Bloqueo | slots **4** (P1), **5** (P2) | pawn slots 1–3 |
| Bluestone | slots **1** (P1), **3** (P2) | slot 2 (perimeter) |
| WaldMeister | slots **1**, **2** | tree shades 3–5 |

The front end uses `player` (together with `engine.getPlayerColour()` at runtime) to know which slots participate in **preferred-colour swap** — swapping the viewer's colour with another player slot on collision, without touching non-player slots.

When `player` is omitted on all hints, consumers fall back to seats `1 … numPlayers` for standard contiguous layouts.

### Context entries (`name` + `explanation`)

Optional board/surround colours (`background`, `board`, `strokes`, …). See existing games with `name: "fill"` or `name: "background"` in their `customizations` arrays.

## Runtime `gameinfo` map

- **Node / bundler:** `import { gameinfo } from "@abstractplay/gameslib"` then `gameinfo.get("bloqueo")`.
- Production builds omit experimental games and experimental variants from the exported map; see [API — `gameinfo`](/gameslib/api/#gameinfo).
