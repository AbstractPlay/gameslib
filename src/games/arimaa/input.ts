/**
 * Click entry for Arimaa: what a click on the board does to the move being
 * entered, in each of the two input modes.
 *
 * The entry is a move string: tokens, then the squares of the selected pieces,
 * oldest first. Clicks name squares of the board as it is drawn, which is the
 * board after the turn the tokens are shown as (`display`).
 *
 * Basic plays what it is told and nothing else. A destination click adds the
 * steps of the selected pieces, written as step tokens, after the steps
 * already entered, so that steps happen in the order they were entered.
 *
 * Advanced says where pieces end up and leaves the rest to the engine. Its
 * tokens name a piece by the square it started the turn on, and sending a
 * piece somewhere else replaces what was said of it. What is left open it
 * settles by preferences of its own (`choose`), which are not the notation's:
 * above all it moves no piece it was not told to if it can help it, even at
 * the cost of steps. An entry is read by the notation wherever it goes next,
 * so when the notation would read what was said as some other turn, the entry
 * ends with the steps of the turn meant, and those it can read no other way.
 */
import {
    arrowToken, captureToken, joinSelections, parseMove, stepsToken, surviveToken,
    type Dir, type ParsedMove, type Piece, type Token, type playerid,
} from "./notation.js";
import {
    NEIGHBOURS, STRENGTH, TRAP_SQUARES as TRAPS, boardSignature, canMoveWithin, choose, dirBetween, display, fewestDisplaced, manhattan,
    preferences, resolve, serializeTurn, sqIndex, sqName, standing,
    type CellContents, type Displayed, type Found, type Turn, type TurnStep,
} from "./turns.js";

export type ArimaaInputMode = "basic" | "advanced";
export interface InputClick {
    move: string;
    complete?: boolean;
    /** Advanced: how many moves what was said fits, when the one shown is no better than another of them */
    oneOf?: number;
}

/**
 * Reserved renderer-only legend key for the Advanced alternative trap outcome.
 *
 * This is not a real board occupant. It is a single custom SVG triangle in
 * the render representation, and the renderer forwards its identifier with
 * ordinary board-piece clicks.
 */
export const ARIMAA_CAPTURE_CHOICE = "ARIMAA_CAPTURE_CHOICE";

/** The same control drawn as an outline, where clicking it keeps the piece alive. */
export const ARIMAA_SPARE_CHOICE = "ARIMAA_SPARE_CHOICE";


type Board = Map<string, CellContents>;

/** A piece as drawn, with the square it started the turn on. */
interface Shown {
    piece: Piece;
    owner: playerid;
    origin: string;
}

/** What the player is looking at: the turn the tokens are shown as and the board after it. */
interface View {
    /** the position the turn starts from: the board, whose turn it is, and the steps it may take */
    board: Board;
    player: playerid;
    limit: number;
    tokens: Token[];
    /** whether the tokens end with the list of the steps of the turn shown, as an Advanced entry may */
    listed: boolean;
    /** what Advanced takes the tokens to say of the turn */
    said: Token[];
    /** false when no turn fits the tokens */
    fits: boolean;
    turn?: Turn;
    /** whether the tokens denote `turn` on their own, with no preference applied */
    settled: boolean;
    shown: Map<string, Shown>;
    after: Board;
    /** steps not yet spent */
    left: number;
}

const text = (tokens: Token[]): string => tokens.map(t => t.text).join(" ");

function look(board: Board, player: playerid, limit: number, tokens: Token[]): View {
    const shown = new Map<string, Shown>();
    for (const [cell, [piece, owner]] of board) {
        shown.set(cell, {piece, owner, origin: cell});
    }
    const d = display(board, player, limit, tokens);
    const turn = d.status === "turn" ? d.turn : undefined;
    if (turn !== undefined) {
        let next = 0;
        turn.steps.forEach((st, i) => {
            const from = sqName(st.from);
            shown.set(sqName(st.to), shown.get(from)!);
            shown.delete(from);
            for (; next < turn.captures.length && turn.captures[next].afterStep === i; next++) {
                shown.delete(sqName(turn.captures[next].square));
            }
        });
    }
    const after: Board = new Map([...shown].map(([cell, p]): [string, CellContents] => [cell, [p.piece, p.owner]]));
    const stated = declared(tokens, turn);
    return {
        board, player, limit, tokens, turn, shown, after,
        listed: stated.length < tokens.length,
        said: turn === undefined ? stated : endings(stated, turn),
        fits: d.status !== "unsatisfiable",
        settled: d.status === "turn" && d.by === "notation",
        left: limit - (turn?.steps.length ?? 0),
    };
}

/** The same position with other tokens entered. */
const lookAgain = (v: View, tokens: Token[]): View => look(v.board, v.player, v.limit, tokens);

/** One step token for each run of consecutive steps by one piece. */
function runs(steps: TurnStep[]): Token[] {
    const out: Token[] = [];
    for (let i = 0; i < steps.length;) {
        const first = steps[i];
        const dirs: Dir[] = [];
        for (; i < steps.length && steps[i].pid === first.pid; i++) {
            dirs.push(steps[i].dir);
        }
        out.push(stepsToken(first.piece, first.owner, sqName(first.from), dirs));
    }
    return out;
}

/**
 * The tokens of an entry less the list of the steps of the turn it is shown
 * as, when it ends with one after saying something else. That list is how an
 * Advanced entry makes the notation read it as the turn meant; it is not
 * something the player said.
 */
export function declared(tokens: Token[], turn: Turn | undefined): Token[] {
    const listed = turn === undefined ? [] : runs(turn.steps);
    const at = tokens.length - listed.length;
    if (listed.length > 0 && at > 0 && listed.every((t, i) => tokens[at + i].text === t.text)) {
        return tokens.slice(0, at);
    }
    return tokens;
}

// What tokens say of where pieces end up. Advanced goes by nothing else, and
// a step token, typed or entered in Basic, says only that a piece took a
// step: left at that, the piece would be walked back to where it started.
// So in place of step tokens, every piece the turn shown displaces or
// captures is said to end as it does there.
function endings(tokens: Token[], turn: Turn): Token[] {
    if (!tokens.some(t => t.prop.kind === "steps")) {
        return tokens;
    }
    const out = tokens.filter(t => t.prop.kind !== "steps");
    for (const tr of turn.trajectories) {
        const start = sqName(tr.start);
        const t = tr.captured ? captureToken(tr.type, tr.owner, start) :
            tr.final !== tr.start ? arrowToken(tr.type, tr.owner, start, sqName(tr.final)) : undefined;
        if (t !== undefined && !out.some(o => o.text === t.text)) {
            out.push(t);
        }
    }
    return out;
}

// What an explicit completion submits: the entry itself where it needs no
// preference to be read and holds nothing that is only for input, otherwise
// the turn shown, written so that it does.
function committed(v: View): string {
    if (v.settled && !v.listed && !v.tokens.some(t => t.prop.kind === "survive")) {
        return text(v.tokens);
    }
    return serializeTurn(v.board, v.player, v.limit, v.turn!) ?? text(v.tokens);
}

// ---------------------------------------------------------------------------
// Basic

/** Whether the entry is a step list that is played exactly as it is written. */
function literal(v: View): boolean {
    let steps = 0;
    for (const t of v.tokens) {
        if (t.prop.kind !== "steps" || t.spec.piece === undefined || t.spec.square === undefined) {
            return false;
        }
        steps += t.prop.dirs.length;
    }
    return v.turn !== undefined && v.turn.steps.length === steps;
}

/** The entry as the steps it is shown as. */
function sofar(v: View): Token[] {
    return literal(v) ? v.tokens : v.turn === undefined ? [] : runs(v.turn.steps);
}

// The click result for a step list `tokens` played as `turn`. Steps that only
// bring back the position the turn started from are no entry.
function entered(v: View, tokens: Token[], turn: Turn): InputClick {
    return turn.signature === boardSignature(v.board) ? {move: ""} : {move: text(tokens)};
}

const neighbours = (sq: string): string[] => NEIGHBOURS[sqIndex(sq)].map(sqName);
/** The squares a piece on `start` passes through taking steps `dirs`, `start` first. */
const routeOf = (start: string, dirs: Dir[]): string[] => {
    const out = [start];
    for (const d of dirs) {
        const i = sqIndex(out[out.length - 1]);
        out.push(sqName(i + (d === "n" ? 8 : d === "s" ? -8 : d === "e" ? 1 : -1)));
    }
    return out;
};
const beside = (a: string, b: string): boolean => manhattan(sqIndex(a), sqIndex(b)) === 1;

/** One step on the board as drawn, from a square to the one beside it. */
type Hop = [from: string, to: string];

// Step tokens for `hops` taken one after another on `board`, a run of steps
// by one piece being one token, as runs() writes it. Nothing if a hop starts
// from an empty square.
function hopTokens(board: Board, hops: Hop[]): Token[] | undefined {
    const at = new Map(board);
    const out: Array<{piece: Piece; owner: playerid; from: string; dirs: Dir[]}> = [];
    let end: string | undefined;
    for (const [from, to] of hops) {
        const here = at.get(from);
        if (here === undefined) {
            return undefined;
        }
        at.delete(from);
        at.set(to, here);
        const dir = dirBetween(sqIndex(from), sqIndex(to));
        if (from === end) {
            out[out.length - 1].dirs.push(dir);
        } else {
            out.push({piece: here[0], owner: here[1], from, dirs: [dir]});
        }
        end = to;
    }
    return out.map(r => stepsToken(r.piece, r.owner, r.from, r.dirs));
}

// The entry with `hops` added one by one, if they are played as entered:
// each the next step of the turn, and nothing else moving.
function stepped(v: View, hops: Hop[]): View | undefined {
    const added = hopTokens(v.after, hops);
    if (added === undefined) {
        return undefined;
    }
    const next = lookAgain(v, [...sofar(v), ...added]);
    const played = next.turn?.steps.slice(-hops.length) ?? [];
    if (!literal(next) || played.length !== hops.length ||
        played.some((st, i) => sqName(st.from) !== hops[i][0] || sqName(st.to) !== hops[i][1])) {
        return undefined;
    }
    return next;
}

// The entry as it was entered and, if its last arrow is a piece of the
// player's taking several steps, as it would be had that piece gone by
// another route as long between the same squares, ending in the same
// position. The player said only where the piece went, and a later step
// may need it to have come by one way rather than another.
function routes(v: View): View[] {
    const out = [v];
    const all = sofar(v);
    const last = all[all.length - 1];
    if (v.turn === undefined || last === undefined || last.prop.kind !== "steps" || last.prop.dirs.length < 2 ||
        last.spec.owner !== v.player || last.spec.square === undefined) {
        return out;
    }
    const taken = routeOf(last.spec.square, last.prop.dirs);
    const length = last.prop.dirs.length;
    const end = sqIndex(taken[length]);
    const before = lookAgain(v, all.slice(0, -1));
    const walk = (path: string[]): void => {
        const at = path[path.length - 1];
        if (path.length === length + 1) {
            if (sqIndex(at) === end && path.join() !== taken.join()) {
                const other = stepped(before, path.slice(1).map((sq, i): Hop => [path[i], sq]));
                if (other !== undefined && other.turn!.signature === v.turn!.signature) {
                    out.push(other);
                }
            }
            return;
        }
        for (const next of neighbours(at)) {
            if (!path.includes(next) && manhattan(sqIndex(next), end) <= length - path.length) {
                walk([...path, next]);
            }
        }
    };
    walk([taken[0]]);
    return out;
}

// The second half of a pull: the enemy piece on `cell` follows the player's
// piece that has just stepped away from beside it, into the square that
// piece left, by the route entered or another that ends the same way. A
// piece that has just pushed cannot also pull.
function pulls(v: View, cell: string): Array<{into: string; base: View}> {
    const enemy = v.shown.get(cell);
    if (enemy === undefined || enemy.owner === v.player || v.left < 1) {
        return [];
    }
    const out: Array<{into: string; base: View}> = [];
    for (const base of routes(v)) {
        const steps = base.turn?.steps ?? [];
        const last = steps[steps.length - 1];
        const prev = steps[steps.length - 2];
        if (last !== undefined && last.owner === v.player && STRENGTH[last.piece] > STRENGTH[enemy.piece] &&
            beside(cell, sqName(last.from)) && !(prev !== undefined && prev.owner !== v.player && prev.from === last.to) &&
            !out.some(o => o.into === sqName(last.from))) {
            out.push({into: sqName(last.from), base});
        }
    }
    return out;
}

// The first half of a push entered on its own: whether some piece of the
// player's can follow the enemy piece on `from` once it has stepped to the
// empty square `to`.
function pushable(v: View, from: string, to: string): boolean {
    const enemy = v.shown.get(from);
    return enemy !== undefined && enemy.owner !== v.player && v.left >= 2 && !v.after.has(to) && beside(from, to) &&
        [...v.shown].some(([at, p]) => p.owner === v.player && beside(at, from) && STRENGTH[p.piece] > STRENGTH[enemy.piece] &&
            stepped(v, [[from, to], [at, from]]) !== undefined);
}

/**
 * A push being entered one step at a time in Basic: the enemy piece on
 * `from` has been sent to the empty square `to`, which it can only reach by
 * being pushed. The selections hold it until a click on the piece that
 * pushes it enters both steps.
 */
export function pendingPush(after: Board, player: playerid, selections: string[]): {from: string; to: string} | undefined {
    if (selections.length !== 2) {
        return undefined;
    }
    const [from, to] = selections;
    const enemy = after.get(from);
    if (enemy === undefined || enemy[1] === player || after.has(to) || !beside(from, to)) {
        return undefined;
    }
    return {from, to};
}

// The steps that take each selected piece to the square the next one stands
// on, and the last to `target`, moving nothing else: the fewest there are,
// provided every way of taking that few ends in one position.
function basicChain(v: View, squares: string[], target: string): Turn | undefined {
    const starts = squares.map(sqIndex);
    const ends = squares.map((_, i) => sqIndex(i === squares.length - 1 ? target : squares[i + 1]));
    const tokens = squares.map((s, i) => {
        const p = v.shown.get(s)!;
        return arrowToken(p.piece, p.owner, s, sqName(ends[i]));
    });
    const r = resolve(v.after, v.player, v.left, tokens, false, true, turn => {
        const moved = turn.trajectories.filter(tr => tr.visited.length > 1);
        return moved.every(tr => starts.includes(tr.start)) &&
            starts.every((s, i) => moved.some(tr => tr.start === s && tr.final === ends[i]));
    });
    return r.status === "resolved" ? r.turn : undefined;
}

// Whether the newest selection could move onto the clicked piece's square as
// part of the chain: the pieces selected so far follow one another, the
// clicked piece makes way, and whatever else moves does so because a link of
// the chain takes its place (it can be selected next).
function basicChainable(v: View, squares: string[], clicked: string): boolean {
    const starts = squares.map(sqIndex);
    const there = sqIndex(clicked);
    const ends = [...starts.slice(1), there];
    const tokens = squares.map((s, i) => {
        const p = v.shown.get(s)!;
        return arrowToken(p.piece, p.owner, s, sqName(ends[i]));
    });
    const r = resolve(v.after, v.player, v.left, tokens, false, true, turn => {
        const moved = turn.trajectories.filter(tr => tr.visited.length > 1);
        const taken = new Set(moved.map(tr => tr.final));
        return moved.some(tr => tr.start === there) &&
            moved.every(tr => starts.includes(tr.start) || taken.has(tr.start)) &&
            starts.every((s, i) => moved.some(tr => tr.start === s && tr.final === ends[i]));
    });
    return r.status !== "unsatisfiable";
}

function basicClick(v: View, selections: string[], square: string): InputClick {
    const player = v.player;
    const clicked = v.shown.get(square);
    const stay: InputClick = {move: text(v.tokens)};
    const select = (squares: string[]): InputClick => ({move: joinSelections(v.tokens, squares)});
    const movable = (cell: string): boolean => canMoveWithin(v.after, player, v.left, cell) || pulls(v, cell).length > 0;

    if (selections.length === 0) {
        if (clicked === undefined) {
            return v.turn === undefined ? stay : {move: committed(v), complete: true};
        }
        if (movable(square)) {
            return select([square]);
        }
        if (clicked.owner === player) {
            return stay;
        }
        // undo one token, and with it whatever of a push or pull it leaves unplayable
        let rest = v.tokens.slice(0, -1);
        if (literal(v)) {
            while (rest.length > 0 && !literal(lookAgain(v, rest))) {
                rest = rest.slice(0, -1);
            }
        }
        return {move: text(rest)};
    }

    // A push entered as two steps: the enemy piece's, then a click on the
    // piece that pushes it, which can only follow it into the square it left.
    const push = pendingPush(v.after, player, selections);
    if (push !== undefined) {
        if (clicked !== undefined && clicked.owner === player) {
            const pushed = stepped(v, [[push.from, push.to], [square, push.from]]);
            if (pushed !== undefined) {
                return entered(v, pushed.tokens, pushed.turn!);
            }
        }
        if (clicked === undefined || selections.includes(square)) {
            return stay;
        }
        return movable(square) ? select([square]) : stay;
    }

    if (selections.some(s => !v.shown.has(s))) {
        return stay;
    }
    // A click on the first selection closes a loop: three pieces rotating.
    // Two pieces trading places is left to Advanced; in Basic that click
    // deselects them, as a click on any selected piece does.
    if (clicked === undefined || (square === selections[0] && selections.length > 2)) {
        const turn = basicChain(v, selections, square);
        if (turn !== undefined) {
            // the entry as the steps it is shown as, followed by the new ones
            return entered(v, [...sofar(v), ...runs(turn.steps)], turn);
        }
    }
    if (clicked === undefined && selections.length === 1) {
        // An enemy piece's steps, entered after the puller's or before the
        // pusher's: following the piece that has just stepped away from beside
        // it, then perhaps on to the start of a push, which waits for its
        // pusher. It can take no more steps in a row than that.
        const [from] = selections;
        const pulled = pulls(v, from).map(({into, base}) => ({into, after: stepped(base, [[from, into]])}));
        for (const {into, after} of pulled) {
            if (after !== undefined && into === square) {
                return entered(v, after.tokens, after.turn!);
            }
        }
        for (const {into, after} of pulled) {
            if (after !== undefined && pushable(after, into, square)) {
                return {move: joinSelections(after.tokens, [into, square])};
            }
        }
        if (pushable(v, from, square)) {
            return select([from, square]);
        }
    }
    if (clicked === undefined || selections.includes(square)) {
        return stay;
    }
    if (basicChainable(v, selections, square)) {
        return select([...selections, square]);
    }
    return movable(square) ? select([square]) : stay;
}

// ---------------------------------------------------------------------------
// Advanced

/** Where a piece ends up in a turn, and by way of which squares. */
interface Fate {
    final: number;
    captured: boolean;
    visited: number[];
}

function fate(turn: Turn | undefined, origin: string): Fate {
    const start = sqIndex(origin);
    const tr = turn?.trajectories.find(t => t.start === start);
    return tr === undefined ? {final: start, captured: false, visited: [start]} : tr;
}

// Whether, in the turn shown, token `t` is said of `piece`. A token that
// names no square is taken to be only if it names where the piece ends up.
function describes(t: Token, piece: Shown, f: Fate): boolean {
    if (t.spec.piece !== undefined && (t.spec.piece !== piece.piece || t.spec.owner !== piece.owner)) {
        return false;
    }
    if (t.spec.square === undefined) {
        return t.prop.kind === "dest" && f.final === sqIndex(t.prop.square);
    }
    if (!f.visited.includes(sqIndex(t.spec.square))) {
        return false;
    }
    switch (t.prop.kind) {
        case "dest": return f.final === sqIndex(t.prop.square);
        case "capture": return f.captured;
        case "survive": return !f.captured;
        // no step token is among what Advanced takes to be said
        default: return false;
    }
}

/** A selected piece, the square it is drawn on, and the square it is being sent to. */
interface Link {
    piece: Shown;
    at: string;
    to: string;
}

function links(v: View, squares: string[], target: string): Link[] | undefined {
    const out: Link[] = [];
    for (let i = 0; i < squares.length; i++) {
        const piece = v.shown.get(squares[i]);
        if (piece === undefined) {
            return undefined;
        }
        out.push({piece, at: squares[i], to: i === squares.length - 1 ? target : squares[i + 1]});
    }
    return out;
}

// What was said with what it said of each link replaced by an arrow to where
// the link is now sent, newest selection first.
function sent(v: View, chain: Link[], tokens = v.said): Token[] {
    const fates = chain.map(l => fate(v.turn, l.piece.origin));
    return [
        ...tokens.filter(t => !chain.some((l, i) => describes(t, l.piece, fates[i]))),
        ...chain.map(l => arrowToken(l.piece.piece, l.piece.owner, l.piece.origin, l.to)).reverse(),
    ];
}

/** Whether the player put the link's piece on the square it is drawn on, rather than the resolver. */
function placed(v: View, l: Link): boolean {
    if (l.at === l.piece.origin) {
        return true;
    }
    const f = fate(v.turn, l.piece.origin);
    const at = sqIndex(l.at);
    return v.said.some(t => t.prop.kind === "dest" && sqIndex(t.prop.square) === at && describes(t, l.piece, f));
}

// What a turn must do to be the chain: every link ends where it was sent, and
// a link whose square another link moves into has stood on that square if the
// player put it there (a piece the resolver put there is simply planned anew).
function obeys(v: View, chain: Link[]): (turn: Turn) => boolean {
    const via = chain.map((l, i) => i > 0 && placed(v, l));
    return turn => chain.every((l, i) => {
        const f = fate(turn, l.piece.origin);
        return f.final === sqIndex(l.to) && (!via[i] || f.visited.includes(sqIndex(l.at)));
    });
}

// The entry for `said` when it is to be shown, and played, as `turn`, which
// fits it: the tokens alone if the notation reads them as that turn, and
// otherwise the steps of the turn after them.
function entry(v: View, said: Token[], turn: Turn): string {
    const r = resolve(v.board, v.player, v.limit, said, false);
    if (r.status === "resolved" && r.turn.signature === turn.signature) {
        return text(said);
    }
    return text([...said, ...runs(turn.steps)]);
}

// The click result for `said` shown as the turn chosen for it, which is one
// of several where nothing but the order positions sort in chose it.
function chosen(v: View, said: Token[], c: Extract<Displayed, {status: "turn"}>): InputClick {
    return {move: entry(v, said, c.turn), oneOf: c.by === "choice" ? c.positions : undefined};
}

// The entry for what is now said, shown as the turn Advanced takes it to mean.
function restated(v: View, said: Token[]): InputClick {
    const c = choose(v.board, v.player, v.limit, said);
    return c.status === "turn" ? chosen(v, said, c) : {move: text(said)};
}

// The entry after a chain is sent on its way: what is now said, shown as the
// turn Advanced prefers of those in which the chain happens. `captured` is
// what a trap's triangle asks of the newest selection, which is then said
// too. It is asked of that very piece: the token alone would be met by
// another piece of its kind that crossed the square it started on.
function advancedChain(v: View, chain: Link[], captured?: boolean): InputClick | undefined {
    const {board, player, limit} = v;
    const last = chain[chain.length - 1].piece;
    const tokens = sent(v, chain);
    if (captured !== undefined) {
        tokens.push((captured ? captureToken : surviveToken)(last.piece, last.owner, last.origin));
    }
    if (standing(board, tokens)) {
        return {move: text(tokens)};
    }
    const follows = obeys(v, chain);
    const want = choose(board, player, limit, tokens, captured === undefined ? follows :
        turn => follows(turn) && fate(turn, last.origin).captured === captured);
    if (want.status !== "turn") {
        return undefined;
    }
    // A link sent on from a square the player had put it on is said to have
    // been there, if the arrows alone would be taken some other way.
    const through = chain.filter((l, i) => i > 0 && l.at !== l.piece.origin && placed(v, l))
        .map(l => arrowToken(l.piece.piece, l.piece.owner, l.at, l.to));
    let said = tokens;
    if (through.length > 0) {
        const plain = choose(board, player, limit, tokens);
        if (plain.status !== "turn" || plain.turn.signature !== want.turn.signature) {
            said = [...tokens, ...through];
        }
    }
    return chosen(v, said, want);
}

// Whether the chain could go on through the clicked piece: the newest
// selection ends on its square and it ends somewhere else.
function advancedChainable(v: View, squares: string[], clicked: string): boolean {
    const chain = links(v, squares, clicked);
    const x = v.shown.get(clicked);
    if (chain === undefined || x === undefined) {
        return false;
    }
    const f = fate(v.turn, x.origin);
    const tokens = sent(v, chain, v.said.filter(t => !describes(t, x, f)));
    const follows = obeys(v, chain);
    const there = sqIndex(clicked);
    return display(v.board, v.player, v.limit, tokens, turn => fate(turn, x.origin).final !== there && follows(turn)).status === "turn";
}

/** A turn that brings a piece to the square a target click names, and the arrow that says so. */
interface Aim {
    found: Found;
    arrow: Token;
}

// The move a click on an empty square asks for by itself. Of the turns that
// fit what was said and end with a piece on (or captured on) `target`: those
// taking a rabbit of the player's to goal there if any do, otherwise those
// moving an enemy piece there if any do; then the fewest pieces displaced,
// the fewest steps, and then by the `preferences` Normal Move goes by too. If
// that still leaves more than one position, the one that sorts first where a
// rabbit goes to goal, and otherwise nothing.
function targetSelection(v: View, target: string): InputClick | undefined {
    const {board, player, limit, said} = v;
    const there = sqIndex(target);
    const prefer = preferences(player);
    const goal = target[1] === (player === 1 ? "8" : "1");
    // the pieces within reach, by which of those preferences their coming meets
    const classes: Array<Array<[string, CellContents]>> = [[], [], []];
    for (const [origin, contents] of board) {
        const [piece, owner] = contents;
        // an enemy piece takes two steps a square
        if (manhattan(sqIndex(origin), there) * (owner === player ? 1 : 2) <= limit) {
            classes[owner !== player ? 1 : goal && piece === "R" ? 0 : 2].push([origin, contents]);
        }
    }
    for (const [kind, pieces] of classes.entries()) {
        let aims: Aim[] = [];
        for (const [origin, [piece, owner]] of pieces) {
            const start = sqIndex(origin);
            const arrow = arrowToken(piece, owner, origin, target);
            const found = fewestDisplaced(board, player, limit, [...said, arrow], turn =>
                turn.trajectories.some(tr => tr.start === start && tr.final === there && (tr.visited.length > 1 || tr.captured)));
            if (found.length === 0) {
                continue;
            }
            const sooner = aims.length === 0 ? -1 :
                found[0].turn.displaced - aims[0].found.turn.displaced || found[0].turn.steps.length - aims[0].found.turn.steps.length;
            if (sooner < 0) {
                aims = [];
            }
            if (sooner <= 0) {
                aims.push(...found.map(f => ({found: f, arrow})));
            }
        }
        if (aims.length === 0) {
            continue;
        }
        const order = (a: Aim, b: Aim): number => prefer(a.found, b.found);
        aims.sort(order);
        const best = aims.filter(a => order(a, aims[0]) === 0);
        const tied = best.some(a => a.found.turn.signature !== best[0].found.turn.signature);
        // only a tie between rabbits going to goal (the first class) is broken
        if (tied && kind !== 0) {
            return undefined;
        }
        const pick = best.reduce((a, b) => b.found.turn.signature < a.found.turn.signature ? b : a);
        return {
            move: entry(v, [...said, pick.arrow], pick.found.turn),
            oneOf: tied ? new Set(aims.map(a => a.found.turn.signature)).size : undefined,
        };
    }
    return undefined;
}

/**
 * The piece sitting on a trap: the one drawn there, or the one the turn shown
 * captures there without its having moved.
 */
function onTrap(v: View, square: string): Shown | undefined {
    if (!TRAPS.includes(square)) {
        return undefined;
    }
    const drawn = v.shown.get(square);
    if (drawn !== undefined) {
        return drawn;
    }
    const at = sqIndex(square);
    const tr = v.turn?.trajectories.find(t => t.captured && t.start === at && t.final === at);
    return tr === undefined ? undefined : {piece: tr.type, owner: tr.owner, origin: square};
}

/** What was said, less whatever it said of whether `p` is captured. */
function unfated(v: View, p: Shown): Token[] {
    return v.said.filter(t => !((t.prop.kind === "capture" || t.prop.kind === "survive") && t.spec.square === p.origin &&
        t.spec.piece === p.piece && t.spec.owner === p.owner));
}

// A trap's triangle does the opposite of what a plain click would show: it
// has the piece captured where it would survive, and survive where it would
// be captured. These say which, or nothing where the opposite cannot happen.

// For the chain sent to the trap it ends on.
function sendChoice(v: View, chain: Link[]): boolean | undefined {
    const {board, player, limit} = v;
    const last = chain[chain.length - 1].piece;
    const tokens = sent(v, chain);
    const follows = obeys(v, chain);
    const shown = choose(board, player, limit, tokens, follows);
    if (shown.status !== "turn") {
        return undefined;
    }
    const captured = !fate(shown.turn, last.origin).captured;
    return display(board, player, limit, tokens, turn =>
        follows(turn) && fate(turn, last.origin).captured === captured).status === "turn" ? captured : undefined;
}

// For a piece sitting on its trap.
function sitChoice(v: View, p: Shown): boolean | undefined {
    if (!fateOpen(v, p)) {
        return undefined;
    }
    return !(v.turn !== undefined && fate(v.turn, p.origin).captured);
}

// Whether what was said leaves it open if `p` is captured: some turn that
// fits it captures the piece, and some other leaves it alive. The turn shown
// answers one of the two; a capture token lets the search for a capture
// skip what cannot lead to one.
function fateOpen(v: View, p: Shown): boolean {
    const said = unfated(v, p);
    const can = (captured: boolean): boolean => display(v.board, v.player, v.limit,
        captured ? [...said, captureToken(p.piece, p.owner, p.origin)] : said,
        turn => fate(turn, p.origin).captured === captured).status === "turn";
    const shown = v.turn === undefined ? undefined : fate(v.turn, p.origin).captured;
    return (shown === true || can(true)) && (shown === false || can(false));
}

// The entry once it says that `p` is captured, or that it is not.
function fated(v: View, p: Shown, captured: boolean): InputClick | undefined {
    const said = [...unfated(v, p), (captured ? captureToken : surviveToken)(p.piece, p.owner, p.origin)];
    if (standing(v.board, said)) {
        return {move: text(said)};
    }
    const c = choose(v.board, v.player, v.limit, said, turn => fate(turn, p.origin).captured === captured);
    return c.status === "turn" ? chosen(v, said, c) : undefined;
}

/**
 * The trap squares that get the advanced-mode triangle while pieces are
 * selected, and for each whether clicking it has the newest selection
 * captured (true) or keeps it alive (false): the opposite of what a click on
 * the square would show. The traps are those the newest selection can be sent
 * to, and the trap it sits on, where it can end up either way.
 */
export function captureChoices(board: Board, player: playerid, limit: number, move: string): Map<string, boolean> {
    const out = new Map<string, boolean>();
    let parsed: ParsedMove;
    try {
        parsed = parseMove(move, true);
    } catch {
        return out;
    }
    const squares = parsed.selections ?? [];
    const v = look(board, player, limit, parsed.tokens);
    if (squares.length === 0 || !v.fits) {
        return out;
    }
    const sitting = squares.length === 1 ? onTrap(v, squares[0]) : undefined;
    const own = sitting === undefined ? undefined : sitChoice(v, sitting);
    if (own !== undefined) {
        out.set(squares[0], own);
    }
    for (const trap of TRAPS) {
        const chain = v.shown.has(trap) ? undefined : links(v, squares, trap);
        const captured = chain === undefined ? undefined : sendChoice(v, chain);
        if (captured !== undefined) {
            out.set(trap, captured);
        }
    }
    return out;
}

/** The trap squares of `captureChoices`. */
export function captureAlternatives(board: Board, player: playerid, limit: number, move: string): string[] {
    return [...captureChoices(board, player, limit, move).keys()];
}

function advancedClick(v: View, selections: string[], square: string, triangle: boolean): InputClick {
    const {board, player, limit} = v;
    const clicked = v.shown.get(square);
    const stay: InputClick = {move: text(v.tokens)};
    const select = (squares: string[]): InputClick => ({move: joinSelections(v.tokens, squares)});
    // A piece can be selected if it can still move once the turn shown has
    // been played, if it moves in that turn (it can be sent elsewhere), or
    // if what was said leaves room for it to move in place of what was inferred.
    const movable = (cell: string): boolean => {
        const p = v.shown.get(cell);
        if (p === undefined) {
            return false;
        }
        if (canMoveWithin(v.after, player, v.left, cell)) {
            return true;
        }
        const f = fate(v.turn, p.origin);
        if (f.visited.length > 1) {
            return true;
        }
        return v.turn !== undefined && canMoveWithin(board, player, limit, p.origin, v.said.filter(t => !describes(t, p, f)));
    };
    // A piece on a trap can also be selected if whether it is captured is
    // still open, so that its triangle can settle that.
    const open = (cell: string): boolean => {
        const p = onTrap(v, cell);
        return p !== undefined && fateOpen(v, p);
    };
    // A piece is selected where it stands, as in Basic, so a square a piece
    // has left is free for a target click. A piece captured on the trap it
    // stood on is not drawn, but it is still there to be selected.
    const capturedHere = (cell: string): InputClick | undefined => open(cell) ? select([cell]) : undefined;
    const aimed = (): InputClick | undefined => targetSelection(v, square);

    if (selections.length === 0) {
        if (clicked === undefined) {
            return capturedHere(square) ?? aimed() ??
                (v.turn === undefined ? stay : {move: committed(v), complete: true});
        }
        if (movable(square) || open(square)) {
            return select([square]);
        }
        // undo: one thing less is said
        return clicked.owner === player ? stay : restated(v, v.said.slice(0, -1));
    }

    // A piece on a trap: its triangle settles whether it is captured, the
    // other way from the turn shown, and a click on its square deselects it.
    // A piece captured there is not drawn, so it cannot be sent anywhere.
    const sitting = selections.length === 1 ? onTrap(v, selections[0]) : undefined;
    if (sitting !== undefined && square === selections[0]) {
        const captured = triangle ? sitChoice(v, sitting) : undefined;
        return (captured === undefined ? undefined : fated(v, sitting, captured)) ?? stay;
    }
    if (sitting !== undefined && !v.shown.has(selections[0])) {
        if (clicked !== undefined) {
            return movable(square) || open(square) ? select([square]) : stay;
        }
        return capturedHere(square) ?? aimed() ?? stay;
    }

    const chain = links(v, selections, square);
    if (chain === undefined) {
        return stay;
    }
    if (clicked === undefined) {
        // a trap's triangle: the opposite of what a click on the square shows
        const captured = triangle && TRAPS.includes(square) ? sendChoice(v, chain) : undefined;
        return advancedChain(v, chain, captured) ?? capturedHere(square) ?? aimed() ?? stay;
    }
    if (square === selections[0]) {
        if (selections.length === 1) {
            // a second click on the selected piece deselects it
            return stay;
        }
        const looped = advancedChain(v, chain);
        if (looped !== undefined) {
            return looped;
        }
    }
    if (!selections.includes(square) && advancedChainable(v, selections, square)) {
        return select([...selections, square]);
    }
    return movable(square) || open(square) ? select([square]) : stay;
}

export function inputClick(
    board: Board, player: playerid, limit: number,
    move: string, square: string, mode: ArimaaInputMode, alternativeCapture = false,
): InputClick {
    let parsed: ParsedMove;
    try {
        parsed = parseMove(move, true);
    } catch {
        parsed = {tokens: [], selections: []};
    }
    const v = look(board, player, limit, parsed.tokens);
    const selections = parsed.selections ?? [];
    if (!v.fits) {
        // nothing can be added to an entry no turn fits; an enemy click still takes its last token back
        const clicked = v.shown.get(square);
        return {move: text(clicked !== undefined && clicked.owner !== player ? v.tokens.slice(0, -1) : v.tokens)};
    }
    return mode === "advanced" ? advancedClick(v, selections, square, alternativeCapture) : basicClick(v, selections, square);
}
