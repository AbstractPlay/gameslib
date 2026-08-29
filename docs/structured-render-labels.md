# Structured render labels

Game authors use structured render labels for area titles and other board chrome that name a **seat** (for example, a pieces stash or captured-pieces panel). The API separates **who the label is about** from **what it says**, so display names are resolved in front at draw time instead of being baked into render JSON.

Types live in [`src/common/render-label.ts`](/gameslib/src/common/render-label.ts). The pattern mirrors [Structured move log](/gameslib/structured-chat-log/).

## Overview

1. In `render()`, set `areas[].label` (or other label fields) to a `RenderLabel` object — usually via `seatAreaLabel()`.
2. Do **not** embed `"Player 1"` in strings or call `i18next.t()` for seat-specific labels inside `render()`.
3. Front calls `resolveRenderLabels(rep, players, users, t)` before handing the rep to `@abstractplay/renderer`.
4. Each structured label becomes a plain `string` with the correct username and locale.

```typescript
// Streetcar — taken housing limits (canonical pilot)
label: this.seatAreaLabel(player, "apgames:validation.streetcar.TAKEN_LABEL"),
```

```json
// locales/en/apgames.json — validation.streetcar
"TAKEN_LABEL": "{{player}}'s housing limits"
```

## Data model

### `RenderLabel`

`string | StructuredRenderLabel`

| Field | Purpose |
|-------|---------|
| `textKey` | i18n key (usually `apgames:validation.<game>.…`) |
| `textParams` | Optional interpolation (`side`, `count`, …) — not usernames |
| `actor` | Who the label refers to; usually `{ kind: "seat", seat }` |

Plain strings remain valid for labels with no player reference (deck, market, discard pile).

### `ChatActorRef`

Same actor kinds as the move log:

| Kind | Shape | Resolution |
|------|-------|------------|
| `seat` | `{ kind: "seat", seat }` | `{{player}}` uses `chatPlayerToken(seat)`; display name substituted after `t()` |
| `label` | `{ kind: "label", key, params? }` | When `textParams.player` is present, resolved via `t(actor.key, actor.params)` |
| `none` | `{ kind: "none" }` | Neutral label; no name substitution |

## Game author API

### `seatAreaLabel(seat, textKey, textParams?)`

Protected helper on `GameBase` — preferred for player-owned areas:

```typescript
areas.push({
    type: "pieces",
    label: this.seatAreaLabel(p, "apgames:validation.mygame.LABEL_STASH"),
    ownerMark: p,
    pieces: [...],
});
```

Reference: [Streetcar](https://play.abstractplay.com/games/streetcar) (`TAKEN_LABEL` on taken housing limits).

### Neutral labels

No seat — use a plain string or structured label without a seat actor:

```typescript
label: this.neutralAreaLabel("apgames:validation.mygame.LABEL_REMAINING"),
// or plain string for fixed English:
label: "Cards in deck",
```

`neutralAreaLabel(textKey, textParams?)` is the protected `GameBase` helper (mirrors `seatAreaLabel` without a seat actor).

### Board-level labels

Entropy-style dual boards:

```typescript
board.boardOne!.label = this.seatAreaLabel(seat, "apgames:validation.entropy.BOARD_ORDER");
```

### `localStash` (captured pieces)

```typescript
areas.push({
    type: "localStash",
    label: this.seatAreaLabel(player + 1, "apgames:validation.volcano.CAPTURED_LABEL"),
    stash: [...],
});
```

## i18n

- Add keys under `validation.<game>` in [`locales/en/apgames.json`](/gameslib/locales/en/apgames.json).
- Use `{{player}}` for the seat name placeholder — **not** `{{playerNum}}`, not hard-coded `"Player 1"`.
- Do **not** call `i18next.t()` for seat-specific area labels in `render()`; front resolves `textKey` in the user's locale.
- See [i18n](/gameslib/i18n/) for namespace conventions. English only in repo; CI propagates other languages.

## Where labels appear

| Location | Renderer area / field | Player-specific? |
|----------|----------------------|------------------|
| Pieces stash bar | `areas[]` with `type: "pieces"` | Usually |
| Captured pyramids | `type: "localStash"` | Usually |
| Polyomino picker | `type: "polyomino"` | Sometimes |
| Board marker | `board.markers[]` with `type: "label"` | Sometimes |
| Entropy boards | `board.boardOne.label` / `boardTwo.label` | Yes |
| Button bar | `buttonBar` → `buttons[].label` | Rarely |

Schema: [renderer schema reference](/renderer/schema-reference/) (`renderLabel`).

## Consumer integration

Playground and custom front-ends should resolve labels before drawing:

```typescript
import { resolveRenderLabel } from "@abstractplay/gameslib";

const text = resolveRenderLabel(area.label, playerNames, (key, params) => i18n.t(key, params));
```

Abstract Play front walks the full rep via `resolveRenderLabels()` — game authors normally only set labels in `render()`.

## Comparison with structured move log

| | Move log | Render labels |
|--|----------|---------------|
| Emit in | `collectChatLogLine` / `pushSeatChatLine` | `render()` on `label` fields |
| Shape | `{ actor, textKey, textParams }` | Same (`RenderLabel` object) |
| Resolve in | `formatChatLogEntryNodes` | `resolveRenderLabels` (front) |
| i18n namespace | `apresults:` | `apgames:validation.<game>:` |
| `{{player}}` token | `chatPlayerToken(seat)` | same |

## Anti-patterns

| Don't | Do instead |
|-------|------------|
| `` label: `Player ${p}'s stash` `` | `label: this.seatAreaLabel(p, "apgames:validation.…")` |
| `label: i18next.t(…, { playerNum: p })` in `render()` | structured label; front calls `t()` |
| `"Player {{playerNum}}'s hand"` in locale JSON | `"{{player}}'s hand"` |
| Embed `"Player N"` in label strings | `seatAreaLabel()` with `{{player}}` in the locale key |
| Bake `players[0].name` into the render rep | seat + key only |

## Canonical examples

| Pattern | Reference game | Source |
|---------|---------------|--------|
| Seat-owned `pieces` area | [Streetcar](https://play.abstractplay.com/games/streetcar) | [`streetcar.ts`](/gameslib/src/games/streetcar.ts) — `TAKEN_LABEL` |
| `localStash` captured pieces | [Volcano](https://play.abstractplay.com/games/volcano) | [`volcano.ts`](/gameslib/src/games/volcano.ts) — `CAPTURED_LABEL` |
| Dual board titles | [Entropy](https://play.abstractplay.com/games/entropy) | [`entropy.ts`](/gameslib/src/games/entropy.ts) — `BOARD_ORDER` / `BOARD_CHAOS` |
| Multi-area Decktet (hand + deck) | [Magnate](https://play.abstractplay.com/games/magnate) | [`magnate.ts`](/gameslib/src/games/magnate.ts) — `LABEL_BOTH`, `LABEL_DECK` |
| Seat collection + neutral market | [Deckfish](https://play.abstractplay.com/games/deckfish) | [`deckfish.ts`](/gameslib/src/games/deckfish.ts) — `LABEL_COLLECTION`, `LABEL_MARKET` |
| Hand label with extra param | [Even at Odds](https://play.abstractplay.com/games/evenatodds) | [`evenatodds.ts`](/gameslib/src/games/evenatodds.ts) — `LABEL_HAND` + `{ side }` |
| Sidebar offensive player | [Meg](https://play.abstractplay.com/games/meg) | [`meg.ts`](/gameslib/src/games/meg.ts) — `status.meg.OFFENSE` + `seatStatusValue()` |

## Sidebar status

`sidebarStatuses()` / `sidebarScores()` follow the same `RenderLabel` contract. Use `neutralAreaLabel()` for row keys and table titles; use `seatStatusValue(seat)` when a status **value** is a player display name.

```typescript
returned.push({
    key: this.neutralAreaLabel("apgames:status.meg.OFFENSE"),
    value: [this.seatStatusValue(this.offense)],
});
```

Abstract Play front resolves via `resolveSidebarStatuses()` / `resolveSidebarScores()` inside `setStatus()` before `GameStatus` renders.

**Do not** call `i18next.t()` for `apgames:status.*` keys inside `sidebarStatuses()` or `sidebarScores()`. Emit `this.neutralAreaLabel("apgames:status.…")` (with `textParams` when needed) so front resolves locale at display time. Player name values use `seatStatusValue(seat)`; numeric counts and glyphs stay plain.

## Testing

- Assert `render()` emits a structured object with expected `textKey` and `actor.seat` (not a resolved string).
- Optionally call `resolveRenderLabel(label, names, mockT)` in unit tests to verify wording.
- Play through [Streetcar](https://play.abstractplay.com/games/streetcar) in Lab / GameMove to confirm area titles show usernames.

## Status

**Migration complete (Aug 2026).** All player-named area/board labels use structured `RenderLabel` objects. Abstract Play front resolves labels via `resolveRenderLabels()` before draw; the legacy whole-rep `replaceNames()` regex has been removed.

Phases 1–4 covered foundation, streetcar pilot, hardcoded `Player N` strings, and `i18next.t()` at render time. See the implementation plan for history.
