# Kill-All Go — implementation plan

Status: **planning document, no engine code yet; design decisions confirmed by the author on 2026-09-21 (§10).** Branch `claude/kill-all-go-planning-o4ysfq`, based on
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
| D4 | Suicide | **Tromp-Taylor: multi-stone suicide is legal** (own stones without liberties are removed after opponent captures). | Your instruction was "if in doubt, Tromp-Taylor". This is the one place the choice has a knock-on effect: Benson's vital-region test must be strengthened (§4.4). AP's `go.ts` forbids suicide; we deliberately differ. **Confirmed.** |
| D5 | Passing | Either side may pass during normal play. **Two consecutive passes end the game with a Red win** (Blue had every chance to claim life and did not). | Alternatives considered: forbid Blue passes (rejected: un-Go-like), draw (rejected: rewards stalling). Blue's pass gets a warning message. **Confirmed.** |
| D6 | Immediate Blue win | After any board change, if any Blue string is pass-alive (Benson, exact), the game ends, Blue wins, all pass-alive Blue stones get `enter` annotations. | Checked after every stone, including each stone inside a Red refutation ply (§4.5.6). |
| D7 | Seki | **Manual claim protocol** exactly as you described (§4.5), no automatic verdicts. goscorer-style detection is not sound enough to end games (§6); it can be a later display-only hint. | |
| D8 | Ko-alive | Ignored by the engine: Blue must keep playing. No engine draw offer. | AP already has a per-move "include draw offer" checkbox, so players can agree a draw themselves. Reliable "alive in ko" detection needs search; deferred. |
| D9 | Openings | One radio group `opening`: `#opening` = alternating placement (default), `handicap` = alternating placement with a handicap, `classic` (19×19 only), `pie`, `hoctaph`. | Handicap: **Player 1 is Uwate (the giver)** and chooses `n`; the challenger seats the stronger player first with the challenge form's seating option ("I play first" / "I play second"). `n` is typed on the first ply, any integer with `1 ≤ n ≤ floor(p/2)` where `p` is the number of points (180 on 19×19, 84 on 13×13, 40 on 9×9); no variant list. Player 2 (Shitate) then makes the first placement of the alternating protocol, or claims the Attacker stones straight away. **Confirmed.** |
| D10 | Turn model | Plain `GameBase`, strict alternation everywhere. Every "choose a side" action that would otherwise give the same seat two plies in a row is bundled into one ply (§5.6). | No `GameBaseSequenced`, no pass padding. |
| D11 | Buttons | Every fixed choice is a **custom button** (`getButtons()`); nothing is drawn on the board. The front stages a button's move string instead of submitting it, so a button may hand back an incomplete move that board clicks then finish (taking the Attacker side while handicap or batch stones are owed). Choices that involve placing stones have no button at all: the board clicks themselves say which side you took. | Needs three new `buttons.killallgo.*` labels in `front`'s `apfront.json` (en + eo). |
| D12 | Colour before roles exist | `getPlayerColour(seat)` returns a neutral grey (`"#999999"`) until Red has been claimed/chosen, then `1` / `2`. | Front renders the seat chip with `renderglyph("piece", colour)` and only uses numeric returns for palette-slot logic, so a hex string is safe. Verify in the playground during M3. |
| D13 | Community credit | Non-traditional protocols carry `fans: true`; credits go into the variant *descriptions* (§7.8). Alternating placement and its handicap form: OGS-forum community protocols of unknown origin (they predate the similar openings of other AP games). Classic 17-stone setup: traditional, origin unknown. Simple pie: the standard balancing device, nobody to credit. Generalized Hoctaph's pie: Hoctaph (basic structure and insight, OGS forums) and the author of this plan (generalisation to every board size by letting the slicer pick `a` and `b` under incentives instead of splitting a fixed total). `people` on the `hoctaph` variant lists both. | **Confirmed.** Fill in your display name / AP id where the plan says `<you>`. |
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
* Red submits a refutation that neither captures the claimed string nor ends on a protected point → Blue wins,
  `eog.reason = "claim-upheld"`, highlight the claimed string. (Resigning has the same effect, so no separate concede action exists.)

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
3. **Anything else**: Red stopped without capturing S and without a protected point, so the attempt failed: game over, Blue
   wins (`claim-upheld`), highlight S. This is the original protocol's "if they fail without playing on one of the marked
   points they lose"; there is no separate concede action, because giving the claim up is exactly losing the game, which
   Red can also do by resigning.
Move text: `[<c1>,<c2>,…,]<cell>`. A failing sequence is submittable (`complete: 0`) and its message says plainly that
submitting it gives the claim up and loses, so Red is warned at every intermediate step.

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
1. `phase = "alt-place"`, `currplayer = 1`, empty board (in the `handicap` opening Player 2 makes the first placement instead, see 5.2).
2. Ply: place one Red stone (`d4`) **or** take the Red stones (`attacker`).
3. When a seat takes Red: `redSeat = that seat`, `phase = "play"`, the other seat moves next as Blue.
Taking Red on the very first ply is legal (and silly).

### 5.2 `handicap` — alternating placement with a handicap
1. `phase = "hand-n"`, `currplayer = 1`. Player 1 is Uwate (the giver); the challenger seats the stronger player first with the
   challenge form's seating option. Player 1 types `n` in the move box (a bare integer, like Go's komi entry) with
   `1 ≤ n ≤ floor(p/2)`, `p = size²`. Stored as `setup.handicap`.
2. `phase = "alt-place"` with **Player 2 (Shitate) to move**: place one Red stone, or claim.
3. Claims: Player 1 claims with `attacker` and the game starts at once (Blue = Player 2 moves). Player 2 claims with
   `attacker:c1,…,cn`, **exactly n** extra Red stones bundled into the claim ply (built by clicks; `complete` becomes 1 at n),
   then Blue = Player 1 moves.

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
1. Player 1: the two batch sizes, with `a ≥ 1, b ≥ 1, a + b ≤ p − 2, b ≤ 2a, a ≤ 2b`. Either typed as `a,b` in the move box
   (like Go's komi entry), or picked from the **on-board picker** of §7.10, which covers the small sizes worth a single click.
2. Player 2 chooses an option:
   * `iplace:c1,…,ca` — option 1: Chooser places the `a` stones (bundled). Then Player 1 chooses the colour.
   * `youplace` — option 2: Slicer places the `a` stones on the next ply (`c1,…,ca`). Then Player 2 chooses the colour.
3. Colour choice by seat Y: `attacker:c1,…,cb` (takes Red and places the `b` stones, bundled), after which the other seat
   moves as Blue; or `defender` (standalone ply), after which the other seat places `b` stones as Red (`c1,…,cb`) and then Y
   moves as Blue.
Batches must contain exactly `a` / `b` stones, all legal setup placements.

For reference, Hoctaph's original (OGS forums, topic 27365 post 70) fixes the total at five stones and only splits it:
"(0) One player chooses a number n from {0,1,2,3,4,5}. (1) The other player chooses who chooses the intersections for (2).
(2) The player determined by (1) chooses up to n intersections. (3) The other player chooses colors. (4) Black places stones at
the intersections chosen for (2), and up to 5−n more stones, after which it is White's turn." The generalisation lets the
slicer choose both batch sizes for any board, with the ratio bound and the `p − 2` cap keeping the numbers reasonable, and
requires `a, b ≥ 1` so the ratio is always defined.

### 5.6 Ply tables (strict alternation holds in every branch)
```
alt-place : P1 place, P2 place, …, Pk attacker            → other seat (Blue) moves
handicap  : P1 n, P2 place, P1 place, …, Pk attacker[:n stones when Pk = P2] → other seat (Blue) moves
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
src/games/killallgo.ts                 board helpers, Benson pass-alive (exported pure functions), then the engine class
test/games/killallgo.test.ts           Benson fixtures from §4.4, board mechanics, engine behaviour (§9)
locales/en/apgames.json, locales/en/apresults.json   strings (§7.9); eo via the $ap-eo skill in the implementation session
```
One engine file and one test file, matching the usual layout of a game in this repository; the pure helpers are named exports
of the engine module so the tests can exercise them directly.

### 7.2 State
```ts
type Phase = "hand-n" | "alt-place" | "pie-slice" | "pie-choose" | "hoc-slice" | "hoc-option" | "hoc-batch-a"
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
        handicap?: number;             // n typed by Player 1 in the handicap opening (Player 2 owes n stones when claiming)
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
handicap  := int                                  hand-n (Player 1 types n, 1 ≤ n ≤ floor(p/2))
placement := cell                                 alt-place (Red), play (mover's colour)
batch     := cells | "pass"                       pie-slice (pass = zero stones); hoc-batch-a/b (exact size, no pass)
attacker  := "attacker" [":" cells]               take/choose Red; cells = the n handicap stones (Player 2 only) or Hoctaph's b-batch
defender  := "defender" [":" cell]                choose Blue; the cell (simple pie only) is Blue's first stone
slice     := "slice:" int "," int                 hoctaph a,b
option    := "iplace" [":" cells] | "youplace"    hoctaph chooser
pass      := "pass"                               play only
claim     := "claim:" cell [":" cells]            Blue, play phase
refute    := cells                                Red, refute phase; only the last cell may be a protected point
```
Everything is lower-cased and whitespace-stripped in `move()` as in the template. `:` separates an action from its cells,
`,` separates cells — no other separators.

### 7.4 Behaviour of the standard hooks
* **`moves()`** — enumerates what is enumerable: single placements (+ `pass`, + `attacker`, + `defender:<cell>` per empty
  cell in `pie-choose`, + every integer `1…floor(p/2)` in `hand-n`, + every legal placement in `refute`, each of which is a
  complete ply on its own). Claims, multi-stone refutations, batches and `slice` are combinatorial
  and are *not* enumerated; `move()` skips the failsafe for those shapes (Go does the same for its komi turn). No `no-moves` flag.
* **`validateMove()`** — the authority for every shape above; returns `complete: -1 / 0 / 1` per §7.5 and `canrender: true`
  for anything that changes the board (partial batches, partial refutations, partial claims).
* **`handleClick(move, row, col, piece)`** —
  board clicks only (custom buttons bypass `handleClick`): in `hoc-slice` a click on a picker stone sets that batch size
  (§7.10); in `play` an empty point = placement, a Blue stone (when Blue is on move) = start `claim:<stone>`,
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
  string; at EOG with a Blue win: `enter` on every stone in `alive`. No `areas`.

### 7.5 Completeness rules (`validateMove.complete`)
| Shape | −1 | 0 | 1 |
|---|---|---|---|
| handicap `n` | — | — | any integer in range |
| batch (pie-slice) | — | ≥ 1 stone | `pass` |
| batch (hoctaph, size k) | < k stones | — | exactly k |
| `attacker:` with owed stones | fewer than owed | — | exactly owed |
| `defender` in pie-choose | no cell yet | — | cell given |
| `claim:` | — | stone chosen, any number of marks | — (submit when ready) |
| refute | nothing placed yet | an attempt that fails (submitting gives the claim up) | ends on a protected point, or S captured |

### 7.6 Custom buttons (`getButtons()`; labels are `buttons.<label>` keys in `front`'s `apfront.json`)
| Phase | Button | The other choice, by clicking |
|---|---|---|
| alt-place | Play as the Attacker (`killallgo.attacker`) | place one Attacker stone; after the button, the n handicap stones |
| pie-slice | Pass (`pass`, existing label) | place any number of Attacker stones |
| pie-choose | Play as the Attacker (`killallgo.attacker`) | your first Defender stone (`defender:<cell>`) |
| hoc-option | Let the opponent place the first batch (`killallgo.youplace`) | place the a-batch yourself (`iplace:…`) |
| hoc-choose | Play as the Defender (`killallgo.defender`) | take the Attacker side by placing the b-batch (`attacker:…`) |
| play | Pass (`pass`) | place a stone, or click your own stone to start a claim |
| refute | none | place stones; the sequence itself decides the outcome |

Each phase offers at most one button because the alternative always involves placing stones, and the clicks are unambiguous
in that phase. `killallgo.attacker` in `alt-place` is deliberately incomplete while handicap stones are owed.

### 7.10 On-board picker for the Hoctaph batch sizes

The slice ply is the one place where a player types a number into an empty board, so the sizes worth a single click are
offered as dummy stones. It is presentation only: the move string is the same `a,b` either way, and any legal pair may
still be typed.

* **Values** `1 … floor(p/12)`: 6 on 9×9, 14 on 13×13, 30 on 19×19. Larger legal pairs are typed.
* **Layout** two three-wide blocks, values in reading order. The first batch is on the left, starting one intersection in
  from the upper-left corner (`b8` on 9×9); the second is on the right, its last column one intersection in from the
  upper-right corner (`f8…h8` on 9×9). A row and a column of empty points separate each block from the edges and from the
  other block. A Red stone lettered `a` or `b` sits in the top row above the middle of each block.
* **Stones** are all Red: `[{name: "piece", colour: 1}, {text: "<value>", scale: 0.75, rotate: null}]`, the multi-character
  legend keys requiring the comma-delimited `pieces` form.
* **Shading** a value the size already chosen on the *other* side would forbid is drawn at `opacity: 0.5`. It stays
  clickable, and picking it drops that other choice, so the shading is recomputed against the new pick. Nothing is shaded
  before a first pick.
* **Partial moves** `"2"` means the first batch alone and `",3"` the second alone; both validate as `complete: -1` with
  `canrender`, so the front re-renders the shading as the player chooses. Only `a,b` is ever submitted or stored.

### 7.7 Results and EOG reasons
* `{type: "place", where, what: "setup"}` for opening stones; `{type: "place", where}` in play.
* `{type: "capture", where: "a1,b2", count}` per captured string (as `go.ts`).
* `{type: "claim", how: "attacker" | "defender"}` for side choices; `{type: "claim", how: "life", where: stone, what: marks}`;
  `{type: "declare", count: n}` for the handicap; `{type: "announce", payload: [a, b]}` for the
  slice; `{type: "select", what: "iplace" | "youplace"}`.
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
    { uid: "handicap", group: "opening", fans: true },
    { uid: "classic",  group: "opening", enabledWhen: { board: ["#board"] } },
    { uid: "pie",      group: "opening", fans: true },
    { uid: "hoctaph",  group: "opening", fans: true, people: [
        { type: "designer", name: "Hoctaph", urls: ["https://forums.online-go.com/t/27365/70"] },   // verify the URL resolves
        { type: "designer", name: "<you>", apid: "<your AP id>" },
    ] },
],
categories: ["goal>annihilate", "mechanic>place", "mechanic>capture", "mechanic>enclose", "mechanic>asymmetry",
             "board>shape>rect", "board>connect>rect", "components>simple>1per"],
flags: ["experimental", "custom-colours", "custom-buttons"],
customizations: [
    { num: 1, default: 1, explanation: "Colour of the Attacker's stones" },
    { num: 2, default: 2, explanation: "Colour of the Defender's stones" },
],   // no `player` tags: the seat→slot mapping is dynamic, exactly like Go's swapped colours
```
The default opening is also a community design, but a `#group` sentinel cannot carry `fans`/`people`; its credit lives in its
locale description (sentinels do get `name` and `description`, as Go's `#ruleset` shows). Suggested English descriptions:
* `#opening`: "Players alternate placing Attacker stones until one of them claims the Attacker side; the other player then
  moves first as the Defender. A community protocol from the OGS forums, origin unknown."
* `handicap`: "Alternating placement with a handicap. Player 1 (the stronger player, seated first by the challenge) chooses the
  number of extra Attacker stones; Player 2 then starts placing. If Player 2 claims the Attacker side they place that many extra
  stones first. A community protocol from the OGS forums, origin unknown."
* `classic`: "The traditional 17-stone starting position; the Defender moves first. 19×19 only."
* `pie`: "Player 1 places any number of Attacker stones, then Player 2 chooses a side. The usual pie rule."
* `hoctaph`: "Player 1 chooses two batch sizes, Player 2 chooses who places the first batch, the other player chooses a side, and
  the Attacker places the second batch. Hoctaph's pie (OGS forums), generalised to every board size by <you>."


### 7.9 Localization (English; Esperanto through `$ap-eo` during implementation)
* `names.killallgo`, `descriptions.killallgo`, `notes.killallgo` (rules summary: roles, life claims, double pass, openings,
  handicap seat convention, suicide/PSK statement).
* `variants.killallgo.{size-9,size-13,#board,#opening,handicap,classic,pie,hoctaph}` — `name` + `description` (texts in §7.8).
  Keep names neutral (the front shows the community chip).
* `validation.killallgo.*` — instructions per phase (button labels live in `front`), errors: OCCUPIED (general), SELF_CAPTURE_SETUP,
  KO_PSK, PROTECTED_POINT, BATCH_SIZE, HANDICAP_RANGE, HANDICAP_COUNT, SLICE_FORMAT / SLICE_RANGE / SLICE_RATIO, CLAIM_NOT_OWN_STONE,
  CLAIM_MARK_NOT_EMPTY, CLAIM_EMPTY_MARKS (warning), REFUTE_INCOMPLETE, PASS_WARNING (Defender), INVALID_PASS, NOT_YOUR_PHASE.
* `status.killallgo.{ATTACKER, DEFENDER, UNDECIDED, PHASE, HANDICAP, SLICE, CLAIM}`.
* `apresults`: `PLACE.killallgo_setup`, `CLAIM.killallgo_attacker`, `CLAIM.killallgo_defender`, `CLAIM.killallgo_life`,
  `DECLARE.killallgo_handicap`, `ANNOUNCE.killallgo_slice` (or reuse a generic key), `SELECT.killallgo_option`,
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
* **alt-place**: alternation; `attacker` on either seat sets `redSeat` and hands Blue the move; sidebar strings.
* **handicap**: `n` range enforced (`0`, `floor(p/2) + 1` and non-integers rejected on every board size); Player 2 moves first
  after the number; Player 1 claims → no stones; Player 2 claims → exactly n stones required, fewer is incomplete, more is invalid.
* **pie / hoctaph**: every branch of the ply tables in §5.6, batch size enforcement, `slice` validation (range, ratio, a+b ≤ p−2),
  `getRounds()` has no duplicate actors, `getPlayerColour` neutral until decided.
* **play**: pass-alive win with highlight; Blue win triggered by a Red move; double pass → Red wins; Blue pass warning text.
* **claims**: refuted (S captured mid-sequence, and captured by the final protected stone); upheld by a failing attempt; continued after a
  protected point with all Red stones kept and Blue to move; free stones cannot touch marks; incomplete without terminator;
  re-claim after continuation; pass-alive arising during a refutation.
* **serialization**: `serialize()` → `GameFactory` round trip in every phase; `clone()` mid-partial.
* **chat**: `assertChatLogParity` for a full game (needs the golden-fixture flow described in `docs/testing.md`).

---

## 9. Milestones and validation
1. **M1** `benson.ts` + `board.ts` + their tests (pure, fast; no engine yet).
2. **M2** Engine with the `classic` opening only: play phase, PSK, TT captures, pass-alive win, double pass, render, chat,
   English strings, `npm run generate-registry`, playground smoke test (verify the grey colour chip there).
3. **M3** Life-claim protocol + tests.
4. **M4** Alternating placement + handicap; simple pie; Hoctaph; tests for §5.6.
5. **M5** Polish: notes/help text, Esperanto (`$ap-eo`), chat-log parity, `npm run lint`, `npm test`, final read-through of
   every user-facing string for colour language.
Commands: `npm run generate-registry`, `npm run typecheck`, `npx mocha --require tsx/cjs --extension ts test/games/killallgo*.test.ts`
(the repo's `.mocharc` also runs everything via `npm test`), `npm run lint`.

---

## 10. Decisions confirmed by the author (2026-09-21)
1. Suicide stays legal (Tromp-Taylor); strict Benson.
2. Double pass ends the game as an Attacker win.
3. Handicap: `n` in `[1, floor(p/2)]`, typed by Player 1 (Uwate, seated first via the challenge's seating option); Player 2
   (Shitate) makes the first placement or claims at once. No `handicap-N` variant list.
4. Hoctaph: `a, b ≥ 1`, `a + b ≤ p − 2`, `b/2 ≤ a ≤ 2b`.
5. Credits as in D13 / §7.8 (descriptions), `people` on `hoctaph` only.
6. Classic opening seats the Defender as Player 1; claim-pending rendering as specified in §4.5.6.

Still to fill in during implementation: your display name / AP id in `people`, and a check that the OGS forum URL for
Hoctaph's post resolves (topic 27365, post 70).

---

## 11. Implementation status (2026-09-21)

Implemented on this branch: `src/games/killallgo.ts`, `test/games/killallgo.test.ts`, English and Esperanto strings in
`locales/{en,eo}/apgames.json` and `apresults.json`. Everything in §3–§7 is implemented as written, with these notes:

* Red can never make a Blue string pass-alive (its moves only remove Blue chains and merge regions, which never adds a vital,
  X-enclosed region), so the mid-refutation check in D6 is a harmless safeguard rather than a reachable rule.
* `currplayer` always advances after a ply, including game-ending plies, so the default chat collector attributes lines to the
  mover exactly as `go.ts` does.
* The sidebar phase line is a seat-actor label ("{{player}} chooses a side"), so the front substitutes the display name.
* Validation of typed input (`n`, `a,b`) returns `complete: 0`, like Go's komi entry, so the player can keep typing.
* Rendered JSON for every phase was validated against the renderer schema.
* Fixed choices are custom buttons, so `front` needs the three `buttons.killallgo.*` labels
  (branch `kill-all-go-buttons-2026-09-22` in `samtcifihi/ap-front`); until that merges the buttons show their raw keys.
* There is no concede action: a refutation that neither captures the string nor ends on a protected point loses, which is
  what the original protocol specified, and resigning remains available.
* The Hoctaph slice offers the on-board picker of §7.10; its rendered JSON was validated against the renderer schema on
  every board size and in the shaded states.
* The Esperanto title `Ĉiomortiga Goo` was accepted on 2026-09-21 and recorded in the conventions repository.
