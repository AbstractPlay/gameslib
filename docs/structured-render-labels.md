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
label: "Cards in deck",
// or
label: { textKey: "apgames:validation.mygame.LABEL_REMAINING", actor: { kind: "none" } },
```

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
| Rely on front `replaceNames()` regex | structured label with `actor.seat` |
| Bake `players[0].name` into the render rep | seat + key only |

## Canonical examples

| Pattern | Reference game | Source |
|---------|---------------|--------|
| Seat-owned `pieces` area | [Streetcar](https://play.abstractplay.com/games/streetcar) | [`streetcar.ts`](/gameslib/src/games/streetcar.ts) — `TAKEN_LABEL` |
| `localStash` captured pieces | [Volcano](https://play.abstractplay.com/games/volcano) | [`volcano.ts`](/gameslib/src/games/volcano.ts) — `CAPTURED_LABEL` |
| Dual board titles | [Entropy](https://play.abstractplay.com/games/entropy) | [`entropy.ts`](/gameslib/src/games/entropy.ts) — `BOARD_ORDER` / `BOARD_CHAOS` |

## Testing

- Assert `render()` emits a structured object with expected `textKey` and `actor.seat` (not a resolved string).
- Optionally call `resolveRenderLabel(label, names, mockT)` in unit tests to verify wording.
- Play through [Streetcar](https://play.abstractplay.com/games/streetcar) in Lab / GameMove to confirm area titles show usernames.

## Status

**Phase 2 (Aug 2026):** Streetcar — first migrated game (`TAKEN_LABEL`).

**Phase 3 (Aug 2026):** Hardcoded `Player N` labels removed from volcano, mvolcano, penguin, moonsquad, gyges, gorogo, cifra, acity, and entropy board titles. Remaining games still use `i18next.t(…, { playerNum })` in `render()` (Phase 4). Front `replaceNames()` remains as a shim until migration completes.
