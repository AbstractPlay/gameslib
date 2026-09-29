# Sidebar status glyphs

Sidebar **status** and **score** cells can show plain text, structured labels, or inline SVG glyphs. Composite decktet cards, polymatrix tiles, and isometric pieces use the same legend-entry shapes as board rendering.

Types live in [`src/games/_base.ts`](/gameslib/src/games/_base.ts). The front resolves labels in `resolveSidebarStatus` and draws glyphs via `renderStatusGlyph` (`renderSheetGlyph` / `renderLegendGlyph` from `@abstractplay/renderer`). See [Structured render labels](/gameslib/structured-render-labels/) for text keys.

## `StatusValue`

| Shape | Rendering |
|-------|-----------|
| `string` | Shown as-is (or i18n when namespaced) |
| `RenderLabel` | Resolved like status row keys |
| `{ kind: "sheet", name, colour }` | `renderSheetGlyph` |
| `{ kind: "legend", entry }` | `renderLegendGlyph` — `entry` is renderer `LegendEntry` |
| `{ glyph, colour }` | Legacy shorthand → sheet glyph (still accepted) |
| `Glyph`, `[Glyph, …]`, polymatrix, iso piece | Treated as `LegendEntry` on the front |

Prefer tagged helpers on `GameBase` so intent is obvious in game code.

## Helpers on `GameBase`

```typescript
// Single sheet glyph (Ice Palace pyramids, Tintas discs, …)
this.statusSheetGlyph("piece", player);

// Full legend entry (decktet composite, etc.)
this.statusLegendGlyph(card.toGlyph());
```

Emit row keys with `neutralAreaLabel("apgames:status.…")` or `seatStatusValue(seat)`; add English under `locales/en/apgames.json` → `status`.

Replace legacy `{ glyph: "…", colour }` in `sidebarStatuses()` / `sidebarScores()` with `statusSheetGlyph`. Stash entries (`IStashEntry.glyph` as a `Glyph` with `name`/`colour`) are unchanged.

Games migrated to tagged sheet glyphs: Ice Palace, Arimaa, Catapult, Entropy, Tintas, Mega-Volcano.

Use `statusLegendGlyph(card.toGlyph())` when a sidebar cell should show a full legend entry (e.g. decktet composite). Contract tests live in `test/games/sidebar-status-glyphs.test.ts`; no game is required to add new sidebar rows solely to exercise legend mode.

## Playground

The gameslib designer playground renders the same shapes in the status/score panel (`renderLegendGlyph` for `kind: "legend"` and raw legend entries).

## Related

- Renderer: `LegendEntry`, `renderLegendGlyph`, `renderSheetGlyph` (renderer package docs / playground `glyph-inline-composite` sample)
- Front: `src/lib/renderStatusGlyph.js`, `.statusGlyphImage` in game sidebar UI
