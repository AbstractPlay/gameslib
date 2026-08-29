# Structured move log

Game authors and front/playground consumers use the structured move log API to build and display the finished-game move table chat column. The API separates **who spoke** from **what was said**, so display names and automated actors are resolved at render time instead of being baked into move strings.

Types live in [`src/common/chat-log.ts`](/gameslib/src/common/chat-log.ts).

## Overview

1. Walk `stack` → `chatLogEntries(players)` → `ChatLogEntry[]`.
2. Each entry: `{ timestamp, lines: ChatLogLine[] }`.
3. Each line: `{ actor: ChatActorRef, textKey, textParams? }`.
4. Display: `formatChatLogEntryNodes(entries, playerNames, t)` (grouped by timestamp, matching the legacy node shape) or `formatChatLogEntries` (flat list).

```typescript
formatChatLogEntryNodes(game.chatLogEntries(playerNames), playerNames, t);
```

For solo games (`numplayers === 1`), pass **one** human display name — do not map seat `2` to a second player name.

## Data model

### `ChatActorRef`

| Kind | Shape | Formatting behaviour |
|------|-------|----------------------|
| `seat` | `{ kind: "seat", seat }` | `textParams.player` uses `chatPlayerToken(seat)` (`"Player N"`); `applyChatPlayerNames` substitutes the display name at render time |
| `label` | `{ kind: "label", key, params? }` | Automated or non-seat actor; when `textParams.player` is present, the formatter resolves it via `t(actor.key, actor.params)` before translating the line |
| `none` | `{ kind: "none" }` | Neutral narration (EOG, capture with no actor, etc.) |

### `ChatLogCollectContext`

Passed to `collectChatLogLine` while walking a stack frame:

| Field | Meaning |
|-------|---------|
| `results` | Full `_results` array for the frame |
| `currplayer` | Frame's `currplayer` |
| `defaultSeat` | Seat for player-attributed lines (`resolveChatSeat` on the first result) |
| `players` | Display names passed into `chatLogEntries` |

## Game API

### Primary output: `chatLogEntries(players)`

Default implementation on `GameBase`:

- Walks `stack`.
- Calls `collectChatLogLine` per result in each frame.
- Appends a score-report line for non-simultaneous frames that contain `deltaScore` (skipped when `gameinfo.flags` includes `"simultaneous"` — games with per-seat `deltaScore` must emit score lines in the collector).

Override `chatLogEntries` when frame structure differs from the default walk (simultaneous indexing, aggregation, custom score appendix). See [Patterns beyond one-result-one-line](#patterns-beyond-one-result-one-line).

### Collector hook: `collectChatLogLine(lines, r, ctx)`

- Return `true` when this result produced line(s).
- Return `false` only to **intentionally suppress** a line.
- For unhandled types: **`return super.collectChatLogLine(lines, r, ctx)`** — there is no automatic fallback; unhandled types are silently omitted.

Default `collectChatLogLine` handles standard `APMoveResult` types: `move`, `place`, `pass`, `button`, `take-button`, `play-second`, `komi`, `flip`, `reclaim`, `capture`, `bearoff`, `promote`, `orient`, `add`, `remove`, `claim`, `eog`, `resigned`, `timeout`, `drawagreed`, `gameabandoned`, `winners`.

Games that emit **only** these types need no collector override.

### Helpers (protected on `GameBase`)

- **`pushSeatChatLine(lines, seat, textKey, textParams?)`** — sets `actor` via `getChatActorRef(seat)`, merges `player: chatPlayerToken(seat)` into params.
- **`pushNeutralChatLine(lines, textKey, textParams?)`** — `actor: { kind: "none" }`.

### Optional hooks

| Hook | Default | Override when |
|------|---------|---------------|
| `resolveChatSeat(r, currplayer)` | `currplayer - 1` (wrap) | Single-actor frames where the first result encodes the mover. **Simultaneous games** usually need a custom `chatLogEntries` loop (index → seat or `r.who`), not only this hook |
| `getChatActorRef(seat)` | `{ kind: "seat", seat }` | Non-human seat (bear, dealer label) — return `{ kind: "label", key: "apresults:…" }` |
| `chatLogEntries(players)` | Stack walk + `collectChatLogLine` per result | **Simultaneous indexing** (Strings-style), **frame aggregation** (Volcano-style), custom score appendix (Byte-style), or El Oso-style frame walkers |

## Canonical pattern — custom result types

Reference: [`minimize.ts`](/gameslib/src/games/minimize.ts).

```typescript
public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
    switch (r.type) {
        case "place":
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.complete", {
                where: r.where!,
                what: /* game-specific */,
            });
            return true;
        case "eog":
            this.pushNeutralChatLine(lines, "apresults:EOG.default");
            return true;
        default:
            return super.collectChatLogLine(lines, r, ctx);
    }
}
```

### Authoring rules

1. Emit **i18n keys** only — never `i18next.t()` or pre-translated strings in the collector.
2. Add strings to [`locales/en/apresults.json`](/gameslib/locales/en/apresults.json) (`apresults:` namespace).
3. Do not embed display names in `textParams` for seat lines — use `pushSeatChatLine` / `chatPlayerToken`.
4. Always delegate unknown types to `super.collectChatLogLine`.
5. For `resigned` / `timeout` / `winners`, the base collector uses `resolveChatPlayerName` — follow that pattern if you customize those types.

## Patterns beyond one-result-one-line

Default path: `chatLogEntries` walks `stack` → `collectChatLogLine` per result → one `ctx.defaultSeat` per frame (`resolveChatSeat` on the first result). Two common deviations need dedicated handling:

```mermaid
flowchart TB
  subgraph default [Default path]
    Walk[chatLogEntries walks stack]
    PerResult[collectChatLogLine per result]
    Walk --> PerResult
  end
  subgraph simultaneous [Simultaneous frames]
    IndexLoop[Seat from result index or r.who]
    IndexLoop --> PerResult
  end
  subgraph aggregation [Aggregated frames]
    FrameHook[Override chatLogEntries or frame collector]
    Summarize[Many atomic results to few lines]
    FrameHook --> Summarize
  end
  PerResult --> Lines[ChatLogLine array]
  Summarize --> Lines
```

> **One line per result or not?**
> If each `_results[i]` should produce its own chat line with the correct seat → use default `chatLogEntries` + per-result `collectChatLogLine`, but fix seat via index or `r.who` (simultaneous).
> If many results in one frame should read as one or two summary lines → override `chatLogEntries` (or a frame helper) and aggregate in the collector; do not change move results unless the record itself should change.

### Simultaneous play (per-result seat)

**Problem:** Default `collectChatLogLine` uses one `ctx.defaultSeat` per frame. In simultaneous games, **each result in the same frame may belong to a different seat** — crediting everything to `defaultSeat` is wrong.

| Pattern | When | Implementation |
|---------|------|----------------|
| **Index → seat** | Fixed order: result `[0]` = player 1, `[1]` = player 2 (e.g. pull phase) | Override `chatLogEntries`: build `ctx` per index with `seat = index + 1`, or call `pushSeatChatLine(lines, p + 1, …)` when handling `state._results[p]` |
| **`r.who` on each result** | Result carries explicit actor (`who: 0` = neutral) | In collector: `const seat = (r as {who?: number}).who`; use `pushSeatChatLine` / `pushNeutralChatLine` / `resolveChatPlayerName` — do not assume `ctx.defaultSeat` |
| **`resolveChatSeat` override** | First result encodes frame actor but later results differ | Rare; prefer index/`who` when simultaneous |

**Base behaviour:**

- [`GameBase.chatLogEntries`](/gameslib/src/games/_base.ts) skips the post-frame `SCORE_REPORT` appendix when `gameinfo.flags` includes `"simultaneous"` — games with per-seat `deltaScore` must emit score lines in the collector (see Byte below).
- `ChatLogCollectContext.results` is the **full frame** — safe to inspect sibling results when one result's line depends on others (prefer index/`who` when possible).

**Reference games:**

- [`strings.ts`](/gameslib/src/games/strings.ts) — index loop `state._results[p]` for two `pull` lines, then shared EOG tail
- [`entropy.ts`](/gameslib/src/games/entropy.ts) — simultaneous place/pass per index
- [`frames.ts`](/gameslib/src/games/frames.ts) — `r.who === 0` neutral placements vs per-player `deltaScore`
- [`fnap.ts`](/gameslib/src/games/fnap.ts) — `who` on select/claim/set

**Anti-patterns:**

- Using only `ctx.defaultSeat` for every result in a simultaneous frame
- Calling `super.collectChatLogLine` once per frame instead of per indexed result when types differ by seat

### Aggregated frames (many results → few lines)

**Problem:** Some games push **many atomic** `_results` per ply (`move`, `capture`, `eject`, …) but the move log shows **summaries** (one `MOVE.multiple`, batched eruptions, capture count). Default per-result `collectChatLogLine` would emit duplicate or noisy lines.

| Approach | Description | When to use |
|----------|-------------|-------------|
| **A. Aggregate in collector (recommended)** | Keep atomic `_results` at move time; summarize when building chat lines | Always unless you have a non-chat reason to change record shape. Logic is log-only; matches existing records and goldens. |
| **B. Summary results at move time** | Push fewer, pre-aggregated result types when executing the move | Only when the summary is already part of game/record contract (renderer, analytics, bug fix) — **not** solely to simplify chat |

**Default recommendation:** **Approach A.** Do not add new `APMoveResult` types or change `results.push()` only for chat.

**How to implement Approach A** (simplest first):

1. **Override `chatLogEntries`** — walk each stack frame once; filter/group `state._results` (moves, captures, ejects); push summary lines with `pushSeatChatLine` / `pushNeutralChatLine`; then handle `eog`/`winners`/`resigned` via `super.collectChatLogLine` on those results only.
   - Precedent: [`volcano.ts`](/gameslib/src/games/volcano.ts) — filter moves+places → `MOVE.multiple`, batch `eject` → `ERUPTIONS`, batch captures.

2. **Private frame helper** — e.g. `collectChatLogLinesForFrame(lines, state._results, ctx)` called from overridden `chatLogEntries`; keeps aggregation logic in one place.
   - Precedent: [`elOso.ts`](/gameslib/src/games/elOso.ts) `collectChatLogLines` + custom `chatLogEntries` (also handles `_group`).

3. **Stateful collector pass** — override `collectChatLogLine` to accumulate into frame-level buffers on `ctx.results` identity, flush on last result or on `eog`. Possible but harder to reason about; prefer 1 or 2.

**Reference games for aggregation shapes:**

| Game | Summary behaviour |
|------|-------------------|
| Volcano / Mvolcano | `MOVE.multiple` + `ERUPTIONS` + batched captures |
| Fanorona | `MOVE.multiple` + capture count line |
| Epaminondas | Count `capture` → single `CAPTURE.multiple` |
| Fendo / Chase | Multi-hop moves → `MOVE.chase` or short `MOVE.nowhat` |
| Breakthrough (bombardment) | `detonate` + batched `destroy` counts |

**Anti-patterns:**

- Calling `collectChatLogLine` per atomic `move` when the log should emit one combined line
- Adding summary result types only for chat without updating renderer/record consumers
- `default: return false` on partial types while aggregating others (drops `winners`, etc.)

### Other special cases

| Case | Pattern | Reference |
|------|---------|-----------|
| **Nested `_group` results** | Handle `r.type === "_group"`: iterate `r.results`, dispatch game helper then `super` per nested result | [`frogger.ts`](/gameslib/src/games/frogger.ts) |
| **Label actor (bear, dealer)** | `getChatActorRef` returns `{ kind: "label", key: "apresults:ACTOR.…" }`; seat-specific roll keys if needed | [`elOso.ts`](/gameslib/src/games/elOso.ts) |
| **Custom `deltaScore` narration** | Override `deltaScore` in collector; may need custom `chatLogEntries` if default score-report append is wrong | [`byte.ts`](/gameslib/src/games/byte.ts) |
| **Non-standard stack frames** | Full `chatLogEntries` override when default per-stack-entry walk does not match game result grouping | [`elOso.ts`](/gameslib/src/games/elOso.ts) |
| **Variant EOG lines** | `pushNeutralChatLine` with game-specific `apresults:EOG.*` keys | go, camelot, anache, etc. |
| **Solo games** | Consumers pass one human display name | — |

## Anti-patterns

| Don't | Consequence |
|-------|-------------|
| `default: return false` without `super` | `winners`, `deltaScore`, standard types silently missing from log |
| `i18next.t()` inside collector | Names cannot be substituted at render time; breaks i18n pipeline |
| Hard-coded player names in `textParams` | Use seat tokens or `resolveChatPlayerName` for resign/timeout/winner lists |
| Set translated `textParams.player` for label actors | Formatter expects token or label key — let `formatChatLogEntryNodes` resolve |
| `ctx.defaultSeat` for every result in a simultaneous frame | Wrong player credited — use index or `r.who` ([Simultaneous play](#simultaneous-play-per-result-seat)) |
| Per-atomic `collectChatLogLine` when the log used summaries | Noisy/duplicate lines — aggregate in `chatLogEntries` ([Aggregated frames](#aggregated-frames-many-results--few-lines)) |
| New result types or `results.push()` shape changes only for chat | Record/renderer drift — aggregate at log time instead |

**Frogger case study:** custom `eog` handler without `super` for `winners` → winner line dropped from structured output.

## Consumer integration

```typescript
formatChatLogEntryNodes(game.chatLogEntries(playerNames), playerNames, t);
```

- Solo (`numplayers === 1`): `playerNames` length 1.
- Label actors: optional UI styling on `line.actor.kind === "label"`; formatter substitutes label into `textParams.player` when present.
- Related exports: `formatChatLogEntries`, `chatPlayerToken`, `applyChatPlayerNames`.

`game.chatLog(playerNames)` returns the same formatted strings without actor metadata — convenience only; prefer `chatLogEntries` + formatters when actor styling matters.

## Testing

When overriding `collectChatLogLine` or `chatLogEntries`:

- **`assertChatLogParity(game, playerNames)`** from [`test/fixtures/chat/helpers.ts`](/gameslib/test/fixtures/chat/helpers.ts) — validates collector output against expected formatted strings.
- **CI:** [`test/games/chatLogParity.test.ts`](/gameslib/test/games/chatLogParity.test.ts) for registry games with fixtures.
- **Golden refresh** (local): `npm run refresh-chat-golden-entries` / `npm run refresh-chat-golden`.
- **Aggregation scenarios:** phase fixture gates in [`test/fixtures/turnModel/phase4ChatFixtureGates.ts`](/gameslib/test/fixtures/turnModel/phase4ChatFixtureGates.ts).

See [Testing — Chat log](/gameslib/testing/#chat-log).
