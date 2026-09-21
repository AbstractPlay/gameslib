# Kill-All Go — implementation plan

Status: **planning document, no engine code yet.** Branch `claude/kill-all-go-planning-o4ysfq`, based on
upstream `AbstractPlay/gameslib` `develop` (commit `9ecf63c`). This file is a working artefact for the
implementation sessions that follow; drop it from the tree (or squash it away) before the upstream PR is opened.

Reference material that shaped this plan: the existing Go-family engines in this repo
(`src/games/go.ts`, `src/games/atarigo.ts`), Unlur and Pippinzip (openings where players place a shared
colour until someone claims a side), Cross Control / Go (`custom-colours` + `getPlayerColour`), the
front-end sources (`AbstractPlay/front`: `resolveEffectivePalette.js`, `MoveEntry.js`, `NewChallengeModal.js`),
the renderer schema (`AreaButtonBar`, annotations, markers), Sensei's Library (Kill-All Game, Pass-Alive /
Benson, Positional Superko), the Tromp-Taylor rules, and `lightvector/goscorer` (Python + JS sources).

---

## 1. Terminology

| In this document and in code comments / identifiers | In user-facing strings (i18n) |
|---|---|
| **Red** — the side trying to kill everything. Board colour `1`, the default colour of AP seat 1. | **Attacker** |
| **Blue** — the side trying to make one living string. Board colour `2`, the default colour of AP seat 2. | **Defender** |
| **string** — a maximal orthogonally connected set of same-coloured stones (well defined; all rules and code operate on strings). | "string" is fine in help text; never rely on "group". |
| **seat** — AP Player 1 / Player 2. Seats are *not* colours: which seat plays Red is decided by the opening protocol and stored in state. | Never say "switch"; say "choose". |

Colour language stays out of user-facing text entirely ("Attacker stones", "Defender to move", "Play as Defender").
Board colours are fixed (Red stones always render in palette slot 1, Blue in slot 2); what varies is the seat→colour
mapping returned by `getPlayerColour()`.

---

## 2. Decisions taken (and the ones you should confirm)

| # | Topic | Decision | Notes |
|---|---|---|---|
| D1 | uid / name | `killallgo` / "Kill-All Go" | Description: "Go variant where the Defender must make one unconditionally alive string and the Attacker must kill everything." |
| D2 | Boards | 9×9, 13×13, 19×19; **19×19 default** (`#board` sentinel) | Same `size-N` scheme as `go.ts`; more sizes can be appended later without a version bump. |
| D3 | Ko | **Positional superko (PSK)** over every grid colouring reached so far, including setup positions and the intermediate positions inside multi-stone plies. | Passes never create a position; a single-stone suicide is therefore always illegal (it would repeat the position). |
| D4 | Suicide | **Tromp-Taylor: multi-stone suicide is legal** (own stones without liberties are removed after opponent captures). | Your instruction was "if in doubt, Tromp-Taylor". This is the one place the choice has a knock-on effect: Benson's vital-region test must be strengthened (§4.4). AP's `go.ts` forbids suicide, so if you would rather match it, flip one flag and use classic Benson. **Please confirm.** |
| D5 | Passing | Either side may pass during normal play. **Two consecutive passes end the game with a Red win** (Blue had every chance to claim life and did not). | Alternatives considered: forbid Blue passes (rejected: un-Go-like), draw (rejected: rewards stalling). Blue's pass gets a warning message. **Please confirm.** |
| D6 | Immediate Blue win | After any board change, if any Blue string is pass-alive (Benson, exact), the game ends, Blue wins, all pass-alive Blue stones get `enter` annotations. | Checked after every stone, including each stone inside a Red refutation ply (§4.5.6). |
| D7 | Seki | **Manual claim protocol** exactly as you described (§4.5), no automatic verdicts. goscorer-style detection is not sound enough to end games (§6); it can be a later display-only hint. | |
| D8 | Ko-alive | Ignored by the engine: Blue must keep playing. No engine draw offer. | AP already has a per-move "include draw offer" checkbox, so players can agree a draw themselves. Reliable "alive in ko" detection needs search; deferred. |
| D9 | Openings | Radio group `opening`: `#opening` = alternating placement (default), `classic` (19×19 only), `pie`, `hoctaph`. Handicap is a second radio group `handicap` (`#handicap` = none, `handicap-1` … `handicap-12`), enabled only with the default opening. | Handicap needs a designated giver: **Player 1 is the handicap giver (Uwate)**; the challenger uses the challenge form's seating option ("I play first" / "I play second") to seat the stronger player first. There is no other way for the engine to know who gives the handicap, so this convention goes into the variant description and the notes. **Please confirm the 1–12 range and the seat convention.** |
| D10 | Turn model | Plain `GameBase`, strict alternation everywhere. Every "choose a side" action that would otherwise give the same seat two plies in a row is bundled into one ply (§5.6). | No `GameBaseSequenced`, no pass padding. |
| D11 | Buttons | Role / claim buttons are rendered by the game as an `areas: [{type: "buttonBar"}]` with structured labels from `apgames.json`; clicks arrive as `piece === "_btn_<value>"`. `custom-buttons` is used only for `pass` (front already has that label). | Avoids a `front` PR for new button labels. |
| D12 | Colour before roles exist | `getPlayerColour(seat)` returns a neutral grey (`"#999999"`) until Red has been claimed/chosen, then `1` / `2`. | Front renders the seat chip with `renderglyph("piece", colour)` and only uses numeric returns for palette-slot logic, so a hex string is safe. Verify in the playground during M3. |
| D13 | Community credit | The four non-classic protocols get `fans: true` and a `people` entry on the variant (schema now supports both). | Fill in the names you want credited (you for the alternating/handicap/simple-pie designs, "Hoctaph" for the generalized pie?). |
| D14 | Flags | `["experimental", "custom-colours", "custom-buttons"]`. **No `pie` flag** (AP's built-in seat swap would fight the protocols). | |

---

## 3. Rules specification (engine level)

### 3.1 Board and stones
Square grid, `vertex` renderer style, `RectGrid(size, size)` + `SquareOrthGraph` for adjacency as in `go.ts`.
Board is `Map<cell, 1 | 2>`; `1` = Red, `2` = Blue. Algebraic coordinates as everywhere else in gameslib:
columns `a…s` left→right (letters are consecutive, `i` is *not* skipped), rows `1…19` bottom→top, so `a1` is bottom-left.

### 3.2 A placement (all phases)
1. Target must be empty and, in a refutation ply, not a protected (marked) point unless it is the final stone (§4.5).
2. Put the stone down; remove every *opponent* string with no liberties (capture); then remove every *own* string with
   no liberties (Tromp-Taylor suicide, D4). During setup phases only Red stones exist, so "suicide" there simply means the
   placement is illegal (a setup stone may never leave a Red string without liberties).
3. PSK: the resulting colouring must differ from every colouring already reached (D3). Reject otherwise.
4. Run the pass-alive check for Blue (D6).

### 3.3 Passing and game end
* `pass` is legal only in the `play` phase (never during setup, never inside a refutation ply).
* Two consecutive passes → game over, Red wins, `eog.reason = "double-pass"` (D5).
* Resign / timeout / draw-agreed are handled by `GameBase`.

### 3.4 Blue wins
* Any Blue string pass-alive (§4.4) → immediate win, `eog.reason = "pass-alive"`, highlight every stone of every pass-alive Blue string.
* Red concedes a life claim → win, `eog.reason = "claim-upheld"`, highlight the claimed string.

### 3.5 Red wins
* Red captures the claimed string during a refutation ply → `eog.reason = "claim-refuted"`.
* Double pass → `eog.reason = "double-pass"`.
* (Capturing *every* Blue stone is not itself an end condition — Blue may keep placing new stones; the game ends by double pass or a successful claim/pass-alive as usual.)

---

## 4. Life

### 4.4 Pass-alive strings — Benson's algorithm (exact, cheap)

Definitions for colour c (= Blue):
* **chain** = string of colour c.
* **region** = maximal orthogonally connected set of points that are *not* c (empty or Red). Its neighbours are all c stones.
* A region R is **vital** to chain x when every point of R that could ever be empty is a liberty of x, i.e.
  * classic Benson (suicide illegal): every **empty** point of R is adjacent to x;
  * **strict** (suicide legal, our D4 default): **every** point of R, empty or Red-occupied, is adjacent to x.
    Reason: with multi-stone suicide Red can clear its own stones out of a region and then refill it leaving a hole at a point that is not a liberty of x; the prototype below shows a classic-vital region dying that way.
* A region is **X-enclosed** when every chain adjacent to it belongs to the current candidate set X.

Algorithm:
```
X := all Blue chains
R := all regions
repeat
    for each chain x in X: if fewer than 2 regions in R are vital to x, remove x from X
    for each region r in R: if some chain adjacent to r is not in X, remove r from R
until nothing changed
chains left in X are pass-alive
```
Complexity: a handful of flood fills per iteration, at most (#chains) iterations — negligible on 19×19, so run it after every stone.

A 90-line JavaScript prototype of exactly this (both vital tests) was written and checked during planning against these positions; they become the fixtures of `test/games/killallgo-benson.test.ts` (`X` = Blue, `O` = Red, `.` = empty, top row first):

| Position | classic | strict |
|---|---|---|
| `X.X.X.` / `XXXXX.` / `......` two one-point eyes on the edge | alive | alive |
| `X.XX..` / `XXXX..` / `......` one eye | dead | dead |
| `X..XX.X` / `XXXXXXX` / `.......` a two-point eye plus a one-point eye | alive | alive |
| `X.X.O.O` / `XXXXOOO` / `.......` two groups with one eye each (seki-ish) | dead | dead |
| `XXXXXXX` / `X...X.X` / `X...XXX` / `X...X..` / `XXXXX..` 3×3 empty eye + one-point eye | dead | dead |
| same, with a Red stone in the centre of the 3×3 | alive | **dead** |
| `XX.O.` / `XXXO.` / `OOOO.` / `.....` two shared liberties, no eyes | dead | dead |
| `XX.XX` / `X.X.X` / `XX.XX` / `.....` two chains sharing two eyes (mutual life) | alive | alive |
| `X.XO.` / `XX.O.` / `OOOO.` / `.....` false eye at a cutting point | dead | dead |
| `XXXX.` / `XO.X.` / `XXXX.` / `X..X.` / `XXXX.` eye containing a Red stone on a liberty point | alive | alive |

Implementation lives in `src/games/killallgo/benson.ts` as pure functions over `(board, size, colour, {suicideAllowed})` returning the pass-alive chains as `string[][]`, so it is unit-testable without the engine.

### 4.5 Life claims (seki protocol) — precise state machine

**4.5.1 Making a claim (Blue's ply, replaces a move).** Blue names one Blue string S (any one of its stones) and a set M
of currently empty *protected points* (possibly empty). Meaning: "S cannot be captured unless the Attacker first plays on
a point of M, and if they do I get to answer." Move text: `claim:<stone>[:<m1>,<m2>,…]`.

**4.5.2 Refutation (Red's next ply, mandatory).** Red plays any number of consecutive stones (each a normal placement per
§3.2, but never on a point of M), then finishes the ply in exactly one of three ways:
1. **S captured** (by any stone of the sequence, protected or not): the ply ends there, game over, Red wins (`claim-refuted`).
2. **Final stone on a protected point**: the ply ends, all Red stones placed stay, phase returns to `play` with **Blue to move**.
3. **`concede`**: game over, Blue wins (`claim-upheld`), highlight S.
Move text: `[<c1>,<c2>,…,]<protected point>` or `[<c1>,…,]concede`. A ply that has free placements but no terminator is
*incomplete* (`complete: -1`), so the front will not offer Submit until Red either plays a protected point, concedes, or
captures S — no accidental concessions.

**4.5.3 Other consequences during a refutation ply.** Captures of other Blue strings are ordinary captures. PSK applies to
every stone. If a Red stone makes some Blue string pass-alive (possible when capturing a Blue stone merges regions),
Blue wins on the spot (D6) — the string really is unconditionally alive.

**4.5.4 After case 2.** Normal alternation; Blue may claim again immediately (same string, any marks). Termination is
guaranteed: every cycle either ends the game or adds a Red stone to a formerly protected point, and PSK plus a finite
board bound the number of positions.

**4.5.5 Validation of a claim.** S must be a Blue string; every mark must be empty; marks may be any size (an empty set is
allowed but pointless — Benson would already have declared S alive; the validation message says so).

**4.5.6 State while a claim is pending.**
```ts
claim?: { stone: string; stones: string[]; marks: string[] }  // on the stack entry after Blue's claim ply
phase: "refute"
```
Render: `dots` on the marks, a low-opacity `flood` (or `outline`) marker on the claimed string, sidebar line
"Life claim: {Defender} says the string at d4 lives unless the Attacker plays e5, f6".

**4.5.7 Why the marks matter.** In a real seki Blue must protect every point whose occupation by Red changes the count
(shared liberties, Red's outside liberties, approach points). Marking too little loses; marking too much only costs
the free Red moves elsewhere — which is exactly the deterrent against frivolous claims that you wanted.

---

## 5. Opening protocols

Common facts: state carries `redSeat?: 1 | 2` (undefined until decided) and `phase`. Until `redSeat` is set,
`getPlayerColour()` returns the neutral grey (D12), the sidebar shows "Attacker: not yet chosen", and every stone on
the board is a Red stone rendered in slot 1. When the game reaches `play`, **Blue always has the first move**.

### 5.1 `#opening` — alternating placement (default)
1. `phase = "alt-place"`, `currplayer = 1`, empty board.
2. Ply: place one Red stone (`d4`) **or** take the Red stones (`attacker`).
3. When a seat takes Red: `redSeat = that seat`, `phase = "play"`, the other seat moves next as Blue.
Taking Red on the very first ply is legal (and silly).

### 5.2 Handicap (`handicap-n`, only with 5.1)
Player 1 is Uwate (gives). If Player 1 takes Red: `attacker`, game starts. If Player 2 takes Red: the claim ply is
`attacker:c1,…,cn` with **exactly n** extra Red stones (built by clicks; `complete` becomes 1 at n). Then Blue (Player 1) moves.

### 5.3 `classic` — the 17-stone setup (19×19 only, `enabledWhen: { board: ["#board"] }`)
Fixed initial board, no choosing. Blue = **Player 1** moves first, `redSeat = 2` from the start (so Player 1 moves first as
on every other AP game; AP's seat assignment supplies the randomisation you asked for). SGF `AB[…]` converted
(`<col><row>` with SGF row index r → AP row `20 − r`):

```
jb→j18  cc→c17  qc→q17  dd→d16  jd→j16  pd→p16
bj→b10  dj→d10  jj→j10  pj→p10  rj→r10
dp→d4   jp→j4   pp→p4   cq→c3   qq→q3   jr→j2
```
(symmetric under both mirrors, as the diagram is).

### 5.4 `pie` — simple pie
1. Player 1 (Slicer), `phase = "pie-slice"`: places **0 or more** Red stones in one ply (`d4,e5,…` built by clicks, or `pass` for none).
2. Player 2 (Chooser), `phase = "pie-choose"`: `attacker` → `redSeat = 2`, Player 1 is Blue and moves next;
   or `defender:<cell>` → `redSeat = 1`, the click on an empty point is Blue's first stone (bundled to keep alternation; the
   "Play as Defender" button just puts the player into that partial move and asks for the stone).

### 5.5 `hoctaph` — generalized Hoctaph's pie
Let `p = size²`.
1. Player 1: `slice:a,b` typed in the move box (like Go's komi entry), with `a ≥ 1, b ≥ 1, a + b ≤ p − 2, b ≤ 2a, a ≤ 2b`.
2. Player 2 chooses an option:
   * `iplace:c1,…,ca` — option 1: Chooser places the `a` stones (bundled). Then Player 1 chooses the colour.
   * `youplace` — option 2: Slicer places the `a` stones on the next ply (`c1,…,ca`). Then Player 2 chooses the colour.
3. Colour choice by seat Y: `attacker:c1,…,cb` (takes Red and places the `b` stones, bundled), after which the other seat
   moves as Blue; or `defender` (standalone ply), after which the other seat places `b` stones as Red (`c1,…,cb`) and then Y
   moves as Blue.
Batches must contain exactly `a` / `b` stones, all legal setup placements.

### 5.6 Ply tables (strict alternation holds in every branch)
```
alt-place : P1 place, P2 place, …, Pk attacker[:handicap]  → other seat (Blue) moves
classic   : P1 (Blue) moves first
pie       : P1 slice | P2 attacker → P1 Blue move          | P2 defender:x → P1 Red move
hoctaph   : P1 slice:a,b
            P2 youplace | P1 batch a | P2 attacker:batch b → P1 Blue | P2 defender → P1 batch b → P2 Blue
            P2 iplace:batch a       | P1 attacker:batch b → P2 Blue | P1 defender → P2 batch b → P1 Blue
```

---

## 6. Automatic seki detection — assessment (goscorer)

goscorer (MIT, Python + JS ports of the same algorithm, ~1 400 lines) is a *scoring* tool: given a finished position and
player-supplied dead-stone marks, it builds reachability regions, chains, "macrochains", potential eyes and eye values,
and flags a region as `belongs_to_seki_group` when its total eye value is ≤ 1. Its own documentation says seki detection
"might not be perfect", that failures should be "rare and exotic", and that eye values "will NOT be tactically accurate
outside of finished game positions". Kill-All positions are mid-game by definition and the verdict would decide the game,
so it must not be used as a win condition. Verdict: **manual protocol now (D7)**; optionally later, run goscorer's region/eye
analysis on the current position as a *hint* ("this string looks alive in seki — consider claiming"), clearly labelled as
advisory. The manual protocol needs no algorithm at all, only the string/liberty/capture machinery we already need.

---

## 7. Engine design

### 7.1 Files
```
src/games/killallgo.ts                 engine (class KillAllGoGame extends GameBase)
src/games/killallgo/benson.ts          pass-alive (pure)
src/games/killallgo/board.ts           strings, liberties, capture/suicide application, board signature (pure helpers)
test/games/killallgo-benson.test.ts    fixtures from §4.4
test/games/killallgo.test.ts           engine behaviour (§9)
locales/en/apgames.json, locales/en/apresults.json   strings (§7.9); eo via the $ap-eo skill in the implementation session
```
Subfolders under `src/games/` are established practice (`armadas/`, `cifra/`, `homeworlds/`, …) and the registry
generator only picks up game classes, so helper modules there are safe.

### 7.2 State
```ts
type Phase = "alt-place" | "pie-slice" | "pie-choose" | "hoc-slice" | "hoc-option" | "hoc-batch-a"
           | "hoc-choose" | "hoc-batch-b" | "play" | "refute";

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, 1 | 2>;        // 1 = Red, 2 = Blue
    lastmove?: string;
    phase: Phase;
    redSeat?: playerid;                // undefined until Red is claimed / chosen
    setup?: {                          // protocol bookkeeping, cleared when phase becomes "play"
        a?: number; b?: number;        // hoctaph
        batchBy?: playerid;            // who owes the pending batch and how big
        batchSize?: number;
        handicapOwed?: number;         // alt-place with handicap: n (only used when Player 2 takes Red)
    };
    claim?: { stone: string; stones: string[]; marks: string[] };   // pending life claim
    interim: string[];                 // board signatures of intermediate positions inside this ply (PSK)
    alive?: string[];                  // stones highlighted at EOG
}
```
`interim` is what makes PSK exact for multi-stone plies; single-stone plies leave it empty. (If long refutation plies ever
make states heavy, switch to 64-bit Zobrist hashes without changing any rule.)

### 7.3 Move grammar
```
cell      := [a-z]+[0-9]+
cells     := cell ("," cell)*
placement := cell                                 alt-place (Red), play (mover's colour)
batch     := cells | "pass"                       pie-slice (pass = zero stones); hoc-batch-a/b (exact size, no pass)
attacker  := "attacker" [":" cells]               take/choose Red; cells = handicap stones or Hoctaph's b-batch
defender  := "defender" [":" cell]                choose Blue; the cell (simple pie only) is Blue's first stone
slice     := "slice:" int "," int                 hoctaph a,b
option    := "iplace" [":" cells] | "youplace"    hoctaph chooser
pass      := "pass"                               play only
claim     := "claim:" cell [":" cells]            Blue, play phase
refute    := [cells ","] (cell | "concede")       Red, refute phase; last cell must be a protected point
```
Everything is lower-cased and whitespace-stripped in `move()` as in the template. `:` separates an action from its cells,
`,` separates cells — no other separators.

### 7.4 Behaviour of the standard hooks
* **`moves()`** — enumerates what is enumerable: single placements (+ `pass`, + `attacker`, + `defender:<cell>` per empty
  cell in `pie-choose`, + `concede` and each legal protected point in `refute`). Claims, batches and `slice` are combinatorial
  and are *not* enumerated; `move()` skips the failsafe for those shapes (Go does the same for its komi turn). No `no-moves` flag.
* **`validateMove()`** — the authority for every shape above; returns `complete: -1 / 0 / 1` per §7.5 and `canrender: true`
  for anything that changes the board (partial batches, partial refutations, partial claims).
* **`handleClick(move, row, col, piece)`** —
  `piece === "_btn_attacker" | "_btn_defender" | "_btn_iplace" | "_btn_youplace" | "_btn_concede"` from the button bar;
  otherwise a board click: in `play` an empty point = placement, a Blue stone (when Blue is on move) = start `claim:<stone>`,
  while a claim is being built an empty point toggles a mark (re-click removes, Pippinzip style); in `refute` an empty point
  appends to the sequence; in batch phases an empty point toggles membership.
* **`move(m, {partial})`** — applies the whole string from the ply's base state on every call (so partial re-renders are
  consistent), running capture/suicide, PSK against the stack *and* the ply's `interim`, and the Benson check after each stone.
  Sets `phase`, `redSeat`, `setup`, `claim` transitions; `checkEOG()`; `saveState()`.
* **`getPlayerColour(seat)`** — `redSeat === undefined ? "#999999" : (seat === redSeat ? 1 : 2)`.
* **`getButtons()`** — `[{label: "pass", move: "pass"}]` in `play`, else `[]`.
* **`sidebarStatuses()`** — Attacker / Defender (via `seatStatusValue`, or "not yet chosen"), Phase, Handicap (when set),
  Hoctaph `a`/`b` and who owes the next batch, pending claim summary.
* **`collectChatLogLine()`** — `place` (with `what: "setup"` for opening stones), `capture` (count), `pass`,
  `claim` lines, `eog` reasons; everything else to `super`.
* **`render()`** — `vertex` board; legend `A` = `{name: "piece", colour: 1}`, `B` = colour 2 (fixed); `enter` for stones placed
  this ply, `exit` for captures; while a claim is pending/being built: `dots` on marks + `flood`/`outline` on the claimed
  string; at EOG with a Blue win: `enter` on every stone in `alive`; `areas: [buttonBar]` with the context buttons of §7.6.

### 7.5 Completeness rules (`validateMove.complete`)
| Shape | −1 | 0 | 1 |
|---|---|---|---|
| batch (pie-slice) | — | ≥ 1 stone | `pass` |
| batch (hoctaph, size k) | < k stones | — | exactly k |
| `attacker:` with owed stones | fewer than owed | — | exactly owed |
| `defender` in pie-choose | no cell yet | — | cell given |
| `claim:` | — | stone chosen, any number of marks | — (submit when ready) |
| refute | free stones only | — | ends with protected point, `concede`, or S captured |

### 7.6 Button bar (rendered by the game, labels via `neutralAreaLabel("apgames:validation.killallgo.BTN_…")`)
| Phase | Buttons (`value`) |
|---|---|
| alt-place | Take the Attacker stones (`attacker`) |
| pie-choose / hoc-choose | Play as Attacker (`attacker`), Play as Defender (`defender`) |
| hoc-option | I place the first batch (`iplace`), Opponent places the first batch (`youplace`) |
| refute | Concede the claim (`concede`) |
| play | none (pass is a `custom-buttons` button; claims start by clicking a Defender stone) |

### 7.7 Results and EOG reasons
* `{type: "place", where, what: "setup"}` for opening stones; `{type: "place", where}` in play.
* `{type: "capture", where: "a1,b2", count}` per captured string (as `go.ts`).
* `{type: "claim", how: "attacker" | "defender"}` for side choices; `{type: "claim", how: "life", where: stone, what: marks}`;
  `{type: "claim", how: "concede"}`; `{type: "announce", payload: [a, b]}` for the slice; `{type: "select", what: "iplace" | "youplace"}`.
* `{type: "eog", reason: "pass-alive" | "claim-upheld" | "claim-refuted" | "double-pass"}` + `winners`.
All of these exist in `src/schemas/moveresults.json`; no schema change needed.

### 7.8 `gameinfo`
```ts
name: "Kill-All Go", uid: "killallgo", playercounts: [2], version: "<YYYYMMDD of implementation>",
description: "apgames:descriptions.killallgo",
urls: ["https://senseis.xmp.net/?KillAllGame", "https://senseis.xmp.net/?ShapeGame"],
people: [
    { type: "designer", name: "Traditional" },
    { type: "coder", name: "<you>", apid: "<your AP id>" },
],
variants: [
    { uid: "size-9",  group: "board" },
    { uid: "size-13", group: "board" },
    { uid: "#board" },                                                     // 19×19
    { uid: "#opening" },                                                   // alternating placement (default)
    { uid: "classic", group: "opening", enabledWhen: { board: ["#board"] } },
    { uid: "pie",     group: "opening", fans: true, people: [ … ] },
    { uid: "hoctaph", group: "opening", fans: true, people: [ … ] },
    { uid: "#handicap" },                                                  // no handicap
    { uid: "handicap-1", group: "handicap", enabledWhen: { opening: ["#opening"] }, fans: true }, … "handicap-12",
],
categories: ["goal>annihilate", "mechanic>place", "mechanic>capture", "mechanic>enclose", "mechanic>asymmetry",
             "board>shape>rect", "board>connect>rect", "components>simple>1per"],
flags: ["experimental", "custom-colours", "custom-buttons"],
customizations: [
    { num: 1, default: 1, explanation: "Colour of the Attacker's stones" },
    { num: 2, default: 2, explanation: "Colour of the Defender's stones" },
],   // no `player` tags: the seat→slot mapping is dynamic, exactly like Go's swapped colours
```
The default opening is also a fan design, but a `#group` sentinel cannot carry `fans`/`people`; credit it in `notes` instead
(or make it an explicit uid with `default: true` if the chip matters to you).

### 7.9 Localization (English; Esperanto through `$ap-eo` during implementation)
* `names.killallgo`, `descriptions.killallgo`, `notes.killallgo` (rules summary: roles, life claims, double pass, openings,
  handicap seat convention, suicide/PSK statement).
* `variants.killallgo.{size-9,size-13,#board,#opening,classic,pie,hoctaph,#handicap,handicap-1…12}` — `name` (+ `description`
  for the openings and for the handicap group's seat convention). Keep names neutral (the front shows the community chip).
* `validation.killallgo.*` — instructions per phase, `BTN_*` button labels, errors: OCCUPIED (general), SELF_CAPTURE_SETUP,
  KO_PSK, PROTECTED_POINT, BATCH_SIZE, HANDICAP_COUNT, SLICE_FORMAT / SLICE_RANGE / SLICE_RATIO, CLAIM_NOT_OWN_STONE,
  CLAIM_MARK_NOT_EMPTY, CLAIM_EMPTY_MARKS (warning), REFUTE_INCOMPLETE, PASS_WARNING (Defender), INVALID_PASS, NOT_YOUR_PHASE.
* `status.killallgo.{ATTACKER, DEFENDER, UNDECIDED, PHASE, HANDICAP, SLICE, CLAIM}`.
* `apresults`: `PLACE.killallgo_setup`, `CLAIM.killallgo_attacker`, `CLAIM.killallgo_defender`, `CLAIM.killallgo_life`,
  `CLAIM.killallgo_concede`, `ANNOUNCE.killallgo_slice` (or reuse a generic key), `SELECT.killallgo_option`,
  `EOG.killallgo_pass_alive`, `EOG.killallgo_claim_upheld`, `EOG.killallgo_claim_refuted`, `EOG.killallgo_double_pass`.
Do not touch any locale other than `en` (and `eo` via the skill); `check-game-names-locale` will report the managed locales as
missing until upstream CI seeds them — expected.

---

## 8. Tests (`test/games/`)
* **benson**: the ten fixtures of §4.4 in both modes; a 19×19 position with several chains; corner/edge eyes; region containing
  Red stones adjacent vs non-adjacent to the chain.
* **board helpers**: capture of one/many strings, multi-stone suicide removal, single-stone suicide rejected by PSK, PSK across
  plies and across `interim` positions inside one ply.
* **classic**: initial 17 stones at the listed cells; Player 1 (Blue) to move; `getPlayerColour(1) === 2`.
* **alt-place**: alternation; `attacker` on either seat sets `redSeat` and hands Blue the move; handicap: Player 1 takes → no
  stones; Player 2 takes → exactly n stones required; sidebar strings.
* **pie / hoctaph**: every branch of the ply tables in §5.6, batch size enforcement, `slice` validation (range, ratio, a+b ≤ p−2),
  `getRounds()` has no duplicate actors, `getPlayerColour` neutral until decided.
* **play**: pass-alive win with highlight; Blue win triggered by a Red move; double pass → Red wins; Blue pass warning text.
* **claims**: refuted (S captured mid-sequence, and captured by the final protected stone); upheld by concede; continued after a
  protected point with all Red stones kept and Blue to move; free stones cannot touch marks; incomplete without terminator;
  re-claim after continuation; pass-alive arising during a refutation.
* **serialization**: `serialize()` → `GameFactory` round trip in every phase; `clone()` mid-partial.
* **chat**: `assertChatLogParity` for a full game (needs the golden-fixture flow described in `docs/testing.md`).

---

## 9. Milestones and validation
1. **M1** `benson.ts` + `board.ts` + their tests (pure, fast; no engine yet).
2. **M2** Engine with the `classic` opening only: play phase, PSK, TT captures, pass-alive win, double pass, render, chat,
   English strings, `npm run generate-registry`, playground smoke test (verify the grey colour chip and the button bar there).
3. **M3** Life-claim protocol + tests.
4. **M4** Alternating placement + handicap; simple pie; Hoctaph; tests for §5.6.
5. **M5** Polish: notes/help text, Esperanto (`$ap-eo`), chat-log parity, `npm run lint`, `npm test`, final read-through of
   every user-facing string for colour language.
Commands: `npm run generate-registry`, `npm run typecheck`, `npx mocha --require tsx/cjs --extension ts test/games/killallgo*.test.ts`
(the repo's `.mocharc` also runs everything via `npm test`), `npm run lint`.

---

## 10. Open questions for you (answers change small, well-contained parts)
1. D4 suicide: Tromp-Taylor (legal, strict Benson) as planned, or forbid it like AP's Go?
2. D5 double pass = Attacker wins?
3. D9 handicap: 1–12 as the offered range, and "Player 1 gives; use challenge seating" as the convention?
4. Hoctaph: `a, b ≥ 1` (I excluded 0 so the ratio is defined), exact batch sizes, and are "I place the first batch" /
   "Opponent places the first batch" acceptable wordings for the two options?
5. Names/AP ids to credit in `people` for the fan protocols (and for "Hoctaph").
6. Anything you want shown differently while a claim is pending (marker style, sidebar wording)?
7. `classic` seats the Defender as Player 1 (so Player 1 keeps the first move, as in every other AP game) and the Attacker as Player 2, i.e. the Attacker is *not* the seat whose default colour is red there. Fine, or would you rather have the Attacker as Player 1 with Player 2 moving first?
