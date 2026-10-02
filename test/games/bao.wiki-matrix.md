# Bao la Kiswahili (Zanzibar) — wiki test matrix

Source: [Mancala World — Bao la Kiswahili § Rules](https://mancala.fandom.com/wiki/Bao_la_Kiswahili#Rules)

Automated contracts live in `bao.rules.test.ts` (and legacy cases in `bao.test.ts`).  
**Kunamua** opening ritual is out of scope (engine starts at the standard diagram + 22 in reserve).

| Wiki ref | Rule (summary) | Test id / describe |
|----------|----------------|-------------------|
| Initial | 22 seeds in reserve; standard diagram | `setup — Zanzibar initial position` |
| General | Captures mandatory when possible | `namu — mandatory capture` |
| General | Takata lap ⇒ no captures in that move | `namu — takata`, `general — first lap` |
| General | First lap capture ⇒ chains (incl. non-capturing laps between) | `general — capture chains` |
| General | Mtaji first lap ≥16 seeds ⇒ no capture | `mtaji — 16-seed first lap` |
| General | Only opponent **front** row captured | `only opponent inner row is capturable` |
| Namu NC | Place only in non-empty front pit | `namu takata — placement` |
| Namu NC | Cannot place in nyumba if other front pits occupied | `namu takata — nyumba placement` |
| Namu NC | Without nyumba: 2+ unless all front pits are singletons | `namu takata — two-plus rule` |
| Namu NC | Place in nyumba ⇒ sow only two seeds | `namu takata — nyumba two-seed sow (tax)` |
| Namu NC | Relay until empty; lap in nyumba ends turn (takata) | `namu takata — nyumba lap ends` |
| Namu CAP | Chain only if last seed in **occupied** inner pit | `namu — capturing laps` |
| Namu CAP | Optional safari (`+`) on capture lap in nyumba | `namu — nyumba safari` |
| Namu CAP | Kimbi capture ⇒ same-side kichwa | `namu capture — kimbi kichwa` |
| Mtaji NC | Front 2+ kutakata; no singleton starts | `mtaji — lap endings` |
| Mtaji NC | Front all singletons ⇒ back row 2+ only | `mtaji takata — back row` |
| Mtaji NC | Sole front kichwa 2+ ⇒ sow toward center | `mtaji takata — lone kichwa` |
| Mtaji NC | Front row never emptied, even temporarily (kutakata) | `mtaji takata — front row never empty` |
| Mtaji CAP | Capture from either row; ends in empty hole | `mtaji — lap endings` |
| Mtaji CAP | Mandatory safari if lap ends in nyumba | `mtaji capture — mandatory safari` |
| Takasia | Blocked pit; forced capture; no start on blocked | `takasia — kutakatia` |
| Takasia | Lap may end in blocked unless first lap from nyumba | `takasia — first lap from nyumba` |
| Goal | Empty opponent front row | `goal — bao hamna` |
| Goal | Opponent only singletons, no legal move | `goal — immobilization` |
| — | Reporter `d3<` relay | `integration — reported position` |

After each CI run, any failing row indicates a rules mismatch to investigate.

## Out of scope

| Item | Notes |
|------|--------|
| Kunamua opening | Engine begins at the diagram + 22 in reserve (post-kunamua position). |

## Recently aligned (see `RULE GAPS` in `bao.rules.test.ts`)

| Wiki | Tests |
|------|--------|
| Mtaji — mandatory safari when a lap ends in the functional nyumba | `mandatory mtaji safari…` |
| Takasia — first lap from nyumba through a blocked pit | `relays through a takasiaed pit…` + control case |
| Namu takata — 2+ unless all occupied front pits are singletons | `does not offer singleton kutakata…` |

Mtaji capture candidates still use the static marker heuristic, confirmed with `processMove` when the heuristic applies (`bao.regression.test.ts`).
