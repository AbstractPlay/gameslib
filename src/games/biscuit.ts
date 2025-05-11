import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Deck, cardSortAsc, cardsBasic, cardsExtended } from "../common/decktet";
import { BiscuitBoard } from "./biscuit/board";
import { BiscuitCard } from "./biscuit/card";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2|3;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    scores: number[];
    board: BiscuitBoard;
    hands: string[][];
    facedown?: string;
    lastmove?: string;
    round: number;
    passes: number;
};

export interface IBiscuitState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export class BiscuitGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Biscuit",
        uid: "biscuit",
        playercounts: [2,3],
        version: "20250428",
        dateAdded: "2024-12-15",
        // i18next.t("apgames:descriptions.biscuit")
        description: "apgames:descriptions.biscuit",
        // i18next.t("apgames:notes.biscuit")
        notes: "apgames:notes.biscuit",
        urls: [
            "http://wiki.decktet.com/game:biscuit",
            "https://boardgamegeek.com/boardgame/37096/biscuit",
        ],
        people: [
            {
                type: "designer",
                name: "David L. Van Slyke",
                urls: ["http://wiki.decktet.com/designer:david-l-van-slyke"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "excuse",
            },
            {
                uid: "pawns-only",
                group: "extended",
            },
            {
                uid: "pawns+courts",
                group: "extended",
            },
            {
                uid: "goal-40",
                group: "eog",
            },
            { uid: "#eog" },
            {
                uid: "goal-80",
                group: "eog",
            }
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>hidden", "board>dynamic", "board>connect>rect", "components>decktet", "other>2+players"],
        flags: ["experimental", "scores", "no-explore", "shared-pieces"],
    };

    public static card2glyph(card: Card): [Glyph, ...Glyph[]] {
        const glyph: [Glyph, ...Glyph[]] = [
            {
                name: "piece-square-borderless",
                opacity: 0,
            },
        ];
        // rank
        if (card.rank.glyph !== undefined) {
            glyph.push({
                name: card.rank.glyph,
                scale: 0.5,
                colour: "_context_strokes",
                nudge: {
                    dx: 250,
                    dy: -250,
                }
            });
        }
        const nudges: [number,number][] = [[-250, -250], [-250, 250], [250, 250]];
        for (let i = 0; i < card.suits.length; i++) {
            const suit = card.suits[i];
            const nudge = nudges[i];
            glyph.push({
                name: suit.glyph,
                scale: 0.5,
                nudge: {
                    dx: nudge[0],
                    dy: nudge[1],
                }
            });
        }
        return glyph;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: BiscuitBoard;
    public hands: string[][] = [];
    public scores!: number[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public passes = 0;
    public round = 1;
    public facedown?: string;
    private deck!: Deck;
    private highlights: [number,number][] = [];

    constructor(state: number | IBiscuitState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            // init deck
            const cards = [...cardsBasic];
            if (this.variants.includes("excuse") && this.variants.includes("pawns+courts")) {
                cards.push(...cardsExtended);
            } else {
                if (this.variants.includes("excuse")) {
                    cards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
                }
                if (this.variants.includes("pawns-only") || this.variants.includes("pawns+courts")) {
                    cards.push(...cardsExtended.filter(c => c.rank.uid === "P"));
                }
                if (this.variants.includes("pawns+courts")) {
                    cards.push(...cardsExtended.filter(c => c.rank.uid === "T"));
                }
            }
            const deck = new Deck(cards);
            deck.shuffle();
            // faceup card can't be the excuse
            while ([...deck.cards][1].rank.uid === "0") {
                deck.shuffle();
            }

            // init board
            const board = new BiscuitBoard();
            const facedown = deck.draw()[0];
            const root = new BiscuitCard({x: 0, y: 0, card: deck.draw()[0]});
            board.add(root);

            // init scores and hands
            const hands: string[][] = [];
            const scores: number[] = [];
            for (let i = 0; i < this.numplayers; i++) {
                scores.push(0);
                hands.push([...deck.draw(6).map(c => c.uid)]);
            }

            // if first player has no valid moves to start, draw another card
            const results: APMoveResult[] = [];
            let hasPlay = false;
            for (const carduid of hands[0]) {
                const card = Card.deserialize(carduid)!;
                const suits = new Set<string>(root.card.suits.map(s => s.uid));
                let matches = false;
                for (const suit of card.suits) {
                    if (suits.has(suit.uid)) {
                        matches = true;
                        break;
                    }
                }
                if (matches) {
                    hasPlay = true;
                    break;
                }
            }
            if (!hasPlay) {
                results.push({type: "deckDraw"});
                hands[0].push(deck.draw()[0].uid);
            }

            const fresh: IMoveState = {
                _version: BiscuitGame.gameinfo.version,
                _results: results,
                _timestamp: new Date(),
                currplayer: 1,
                round: 1,
                passes: 0,
                scores,
                facedown: facedown.uid,
                board,
                hands,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBiscuitState;
            }
            if (state.game !== BiscuitGame.gameinfo.uid) {
                throw new Error(`The Biscuit engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BiscuitGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.scores = [...state.scores];
        this.passes = state.passes;
        this.round = state.round;
        this.facedown = state.facedown;
        this.board = BiscuitBoard.deserialize(state.board);
        this.hands = deepclone(state.hands) as string[][];
        this.lastmove = state.lastmove;

        // Deck is reset every time you load
        const cards = [...cardsBasic];
        if (this.variants.includes("excuse") && this.variants.includes("pawns+courts")) {
            cards.push(...cardsExtended);
        } else {
            if (this.variants.includes("excuse")) {
                cards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
            }
            if (this.variants.includes("pawns-only") || this.variants.includes("pawns+courts")) {
                cards.push(...cardsExtended.filter(c => c.rank.uid === "P"));
            }
            if (this.variants.includes("pawns+courts")) {
                cards.push(...cardsExtended.filter(c => c.rank.uid === "T"));
            }
        }
        this.deck = new Deck(cards);
        // remove cards from the deck that are on the board or in known hands
        for (const uid of this.board.cards.map(c => c.card.uid)) {
            this.deck.remove(uid);
        }
        for (const hand of this.hands) {
            for (const uid of hand) {
                if (uid !== "") {
                    this.deck.remove(uid);
                }
            }
        }
        // remove the facedown card, if known
        if (this.facedown !== undefined) {
            this.deck.remove(this.facedown);
        }
        this.deck.shuffle();

        return this;
    }

    // Moves can be generated and automoved because the `move` function
    // will forcibly draw a card for a player who has no legal move at
    // the start of their turn. If there's still no legal move,
    // then `pass` is allowed.
    public moves(p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }

        const {main, cross} = this.board.lines;
        const moves: string[] = [];

        for (const uid of this.hands[p - 1]) {
            // skip if you're looking at hands you can't see
            if (uid === "") {
                continue;
            }
            const card = Card.deserialize(uid)!;
            const suits = new Set<string>(card.suits.map(s => s.uid));
            // mainline first
            const left = main[0];
            const right = main[main.length - 1];
            const comps = [left];
            if (left.uid !== right.uid) {
                comps.push(right);
            }
            for (const comp of comps) {
                let matches = false;
                for (const suit of comp.card.suits) {
                    if (suits.has(suit.uid)) {
                        matches = true;
                        break;
                    }
                }
                // You may always place The Excuse or place something next to it
                if (card.rank.uid === "0" || comp.card.rank.uid === "0") {
                    matches = true;
                }
                if (matches) {
                    if (comp.uid === left.uid) {
                        moves.push(`${uid}>${comp.x - 1},0`);
                    }
                    if (comp.uid === right.uid) {
                        moves.push(`${uid}>${comp.x + 1},0`);
                    }
                }
            }
            // now crosslines
            for (const line of cross) {
                const top = line[0];
                const bottom = line[line.length - 1];
                const comps = [top];
                if (top.uid !== bottom.uid) {
                    comps.push(bottom);
                }
                for (const comp of comps) {
                    let matches = false;
                    for (const suit of comp.card.suits) {
                        if (suits.has(suit.uid)) {
                            matches = true;
                            break;
                        }
                    }
                    // You may always place The Excuse or place something next to it
                    if (card.rank.uid === "0" || comp.card.rank.uid === "0") {
                        matches = true;
                    }
                    if (matches) {
                        if (comp.uid === top.uid) {
                            moves.push(`${uid}>${comp.x},${comp.y + 1}`);
                        }
                        if (comp.uid === bottom.uid) {
                            moves.push(`${uid}>${comp.x},${comp.y - 1}`);
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            // clicking on your hand
            if (row < 0 && col < 0) {
                newmove = piece!.substring(1);
            }
            // otherwise, on the board
            else {
                const cell = this.board.rel2abs(col, row).join(",");
                newmove = `${move}>${cell}`;
            }

            // autocomplete
            const matches = this.moves().filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // if parenthetical is present, strip it
        const idx = m.indexOf("(");
        if (idx >= 0) {
            m = m.substring(0, idx);
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.biscuit.INITIAL_INSTRUCTIONS")
            return result;
        }

        // normalize case
        if (m !== "pass") {
            const [card, to] = m.split(">");
            m = `${card.toUpperCase()}>${to || ""}`;
        }
        const allMoves = this.moves();

        if (allMoves.includes(m)) {
            // we're good!
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.biscuit.PARTIAL");
                return result;
            } else {
                if (m === "pass") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.biscuit.BAD_PASS");
                    return result;
                }
                result.valid = false;
                result.message = i18next.t("apgames:validation.biscuit.INVALID_MOVE");
                return result;
            }
        }
    }

    public scoreBoard(placed: BiscuitCard): {straight: number, elevens: boolean, biscuits: ("hot"|"cross"|"biscuit")[]} {
        const lines = this.board.lines;
        // biscuits
        const biscuits: ("hot"|"cross"|"biscuit")[] = [];
        const matched = new Set<string>();
        // hot cross
        if (lines.idxs.includes(placed.x)) {
            const found = lines.cross.find(cards => cards.map(c => c.uid).includes(placed.uid))!;
            // cross lines only count as lines if there are at least two cards in the line
            if (found.length > 1) {
                for (const card of [found[0], found[found.length - 1]]) {
                    if (card.uid !== placed.uid && card.card.rank.uid === placed.card.rank.uid) {
                        biscuits.push("cross");
                        matched.add(card.uid);
                        break;
                    }
                }
            }
        }
        // just hot
        if (placed.y === 0) {
            for (const card of [lines.main[0], lines.main[lines.main.length - 1]]) {
                if (card.uid !== placed.uid && card.card.rank.uid === placed.card.rank.uid) {
                    biscuits.push("hot");
                    matched.add(card.uid)
                    break;
                }
            }
        }
        // regular biscuits
        for (const line of [lines.main, ...lines.cross]) {
            if (line.length > 1) {
                for (const card of [line[0], line[line.length - 1]]) {
                    if (card.uid !== placed.uid && !matched.has(card.uid) && card.card.rank.uid === placed.card.rank.uid) {
                        biscuits.push("biscuit");
                        matched.add(card.card.uid);
                    }
                }
            }
        }

        // elevensies
        let elevens = false;
        let other: BiscuitCard;
        // main line
        if (placed.y === 0) {
            other = lines.main[0].uid === placed.uid ? lines.main[lines.main.length - 1] : lines.main[0];
        }
        // cross line
        else {
            const found = lines.cross.find(cards => cards.map(c => c.uid).includes(placed.uid))!;
            other = found[0].uid === placed.uid ? found[found.length - 1] : found[0];
        }

        // pawns only
        if (this.variants.includes("pawns-only")) {
            if (
                (placed.card.rank.uid === "P") &&
                (other.card.rank.uid === "1" || other.card.rank.uid === "N" || other.card.rank.uid === "P")
            ) {
                elevens = true;
            } else if (
                (other.card.rank.uid === "P") &&
                (placed.card.rank.uid === "1" || placed.card.rank.uid === "N" || placed.card.rank.uid === "P")
            ) {
                elevens = true;
            } else if (placed.card.rank.uid !== "P" && other.card.rank.uid !== "P") {
                elevens = placed.card.rank.seq + other.card.rank.seq === 11;
            }
        }
        // both pawns AND courts
        else if (this.variants.includes("pawns+courts")) {
            if (
                (placed.card.rank.uid === "P" && other.card.rank.uid === "T") ||
                (placed.card.rank.uid === "T" && other.card.rank.uid === "P")
            ) {
                elevens = true;
            } else {
                elevens = placed.card.rank.seq + other.card.rank.seq === 11;
            }
        }
        // default rules
        else {
            if (placed.card.rank.seq + other.card.rank.seq === 11) {
                elevens = true;
            }
        }

        // straights
        let straight = 1;
        const found = [...[lines.main, ...lines.cross].find(cards => cards.map(c => c.uid).includes(placed.uid))!];
        if (found[0].uid !== placed.uid) {
            found.reverse();
        }
        if (found.length > 1 && found[0].card.rank.uid !== found[1].card.rank.uid) {
            const dir: "A"|"D" = found[0].card.rank.seq < found[1].card.rank.seq ? "A" : "D";
            // INFINITE LOOP
            let i = 0;
            while (true) {
                const curr = found[i].card.rank.seq;
                const expected = this.getNextRank(curr, dir);
                if (expected === null) { break; }
                const next = found[i+1].card.rank.seq;
                if (next === expected) {
                    straight++;
                    i++;
                    if (found.length === i + 1) {
                        break;
                    }
                } else {
                    break;
                }
            }
        }

        return {straight, elevens, biscuits};
    }

    public getNextRank(curr: number, dir: "A"|"D"): number|null {
        // excuse
        if (curr === 0) {
            return null;
        }
        // Ace doesn't wrap around
        if (curr === 1 && dir === "D") {
            return null;
        }
        // Crown doesn't wrap around
        if (curr === 10 && dir === "A") {
            return null;
        }
        // 2 through 8 and 9 descending
        if (curr <= 8 || (curr === 9 && dir === "D")) {
            return dir === "A" ? curr + 1 : curr - 1;
        }
        // 9+ ascending
        if (dir === "A") {
            switch (curr) {
                case 9:
                    return (this.variants.includes("pawns-only") || this.variants.includes("pawns+courts")) ? 9.3 : 10;
                case 9.3:
                    return this.variants.includes("pawns+courts") ? 9.6 : 10;
                case 9.6:
                    return 10
                default:
                    throw new Error(`Unrecognized card rank ${curr}`);
            }
        }
        // >9 descending
        else {
            switch (curr) {
                case 9.3:
                    return 9;
                case 9.6:
                    return 9.3;
                case 10:
                    return this.variants.includes("pawns+courts") ? 9.6 : this.variants.includes("pawns-only") ? 9.3 : 9;
                default:
                    throw new Error(`Unrecognized card rank ${curr}`);
            }
        }
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): BiscuitGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // if parenthetical is present, strip it
        const idx = m.indexOf("(");
        if (idx >= 0) {
            m = m.substring(0, idx);
        }
        if (m !== "pass") {
            const [c,t] = m.split(">");
            m = `${c.toUpperCase()}>${t || ""}`;
        }
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.highlights = [];

        if (partial) {
            let [c,] = m.split(">");
            c = c.toUpperCase();
            this.highlights = allMoves.filter(mv => mv.startsWith(c)).map(mv => {
                const [,t] = mv.split(">");
                const [l, r] = t.split(",");
                return [l, r].map(n => parseInt(n, 10)) as [number,number];
            });
            return this;
        }

        let lastmove = m;
        if (m === "pass") {
            this.passes++;
            this.results.push({type: "pass"});
        } else {
            this.passes = 0;
            // eslint-disable-next-line prefer-const
            let [cardId, to] = m.split(">");
            const [x, y] = to.split(",").map(n => parseInt(n, 10));
            cardId = cardId.toUpperCase();
            lastmove = `${cardId}>${to}`;

            // place card
            const card = Card.deserialize(cardId)!;
            const cardObj = new BiscuitCard({x, y, card})
            this.board.add(cardObj);
            this.results.push({type: "place", what: card.plain, where: to});
            this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(cid => cid !== cardId);

            // tabulate scores
            let deltaScore = 0;
            const scores = this.scoreBoard(cardObj);
            if (scores.straight > 1) {
                deltaScore += scores.straight;
                this.results.push({type: "set", count: scores.straight, what: "straight"});
            }
            if (scores.biscuits.length > 0) {
                if (scores.biscuits.includes("hot")) {
                    deltaScore += 2;
                    this.results.push({type: "set", what: "hot"});
                } else if (scores.biscuits.includes("cross")) {
                    deltaScore += 4;
                    this.results.push({type: "set", what: "cross"});
                }
                const norm = scores.biscuits.filter(b => b === "biscuit").length;
                if (norm > 0) {
                    deltaScore += norm;
                    this.results.push({type: "set", count: norm, what: "biscuit"});;
                }
            }
            if (deltaScore > 0) {
                this.scores[this.currplayer - 1] += deltaScore;
                this.results.push({type: "deltaScore", delta: deltaScore});
            }

            // elevensies
            if (scores.elevens) {
                this.results.push({type: "set", what: "elevensies"});
                for (let i = 1; i <= this.numplayers; i++) {
                    if (i === this.currplayer) {
                        continue;
                    }
                    const [d] = this.deck.draw();
                    if (d !== undefined) {
                        this.hands[i - 1].push(d.uid);
                    }
                }
            }
        }

        // if emulated, don't go any further
        if (emulation) { return this; }

        // is the round over?
        let roundOver = false;
        const handEmpty = this.hands[this.currplayer - 1].length === 0;
        const handStale = this.deck.cards.length === 0 && this.passes >= this.numplayers;
        // gone out
        if (handEmpty) {
            roundOver = true;
            this.results.push({type: "declare"});
            let bonus = 5;
            for (let i = 1; i < this.numplayers; i++) {
                if (i === this.currplayer) {
                    continue;
                }
                for (const cuid of this.hands[i - 1]) {
                    const card = Card.deserialize(cuid)!;
                    // Excuse is worth nothing
                    if (card.rank.uid === "0") {
                        continue;
                    } else if (card.rank.uid === "P" || card.rank.uid === "T") {
                        bonus += 3;
                    } else if (card.rank.uid === "1" || card.rank.uid === "N") {
                        bonus += 1;
                    } else {
                        bonus += 2;
                    }
                }
            }
            this.scores[this.currplayer - 1] += bonus;
            this.results.push({type: "deltaScore", delta: bonus});
        }
        // stale hand
        if (handStale) {
            roundOver = true;
            this.results.push({type: "stalemate"});
            // no bonus points awarded
        }

        // calculate total deltaScore
        let scoreChange = 0;
        for (const {delta} of this.results.filter(r => r.type === "deltaScore")) {
            scoreChange += delta!;
        }
        let tag = "";
        if (scoreChange > 0) {
            tag += scoreChange.toString();
        }
        if (roundOver) {
            tag += "*";
        }

        // update currplayer
        // Regardless of whether the round just ended,
        // play continues in sequence. Other approaches require
        // more complicated state manipulation.
        this.lastmove = lastmove + (tag === "" ? "" : `(${tag})`);
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        // round is over
        if (roundOver) {
            // this is the only time we check for EOG
            this.checkEOG();
            // if the game isn't over yet, reset for the next round
            // yes this means that the final state of the previous round is never visible,
            // except for the game-ending round
            if (!this.gameover) {
                this.round++;
                this.results.push({type: "reset"});
                // init deck
                const cards = [...cardsBasic];
                if (this.variants.includes("excuse") && this.variants.includes("pawns+courts")) {
                    cards.push(...cardsExtended);
                } else {
                    if (this.variants.includes("excuse")) {
                        cards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
                    }
                    if (this.variants.includes("pawns-only") || this.variants.includes("pawns+courts")) {
                        cards.push(...cardsExtended.filter(c => c.rank.uid === "P"));
                    }
                    if (this.variants.includes("pawns+courts")) {
                        cards.push(...cardsExtended.filter(c => c.rank.uid === "T"));
                    }
                }
                const deck = new Deck(cards);
                deck.shuffle();
                // faceup card can't be the excuse
                while ([...deck.cards][1].rank.uid === "0") {
                    deck.shuffle();
                }

                // init board
                this.board = new BiscuitBoard();
                const [facedown] = deck.draw();
                this.facedown = facedown.uid;
                const root = new BiscuitCard({x: 0, y: 0, card: deck.draw()[0]});
                this.board.add(root);

                // init scores and hands
                this.hands = [];
                for (let i = 0; i < this.numplayers; i++) {
                    this.hands.push([...deck.draw(6).map(c => c.uid)]);
                }
                this.deck = deck;
            }
        }

        // round over or not, if current player has no moves, auto-draw a card for them
        if (!this.gameover && this.moves().includes("pass")) {
            this.results.push({type: "deckDraw"});
            const [drawn] = this.deck.draw();
            if (drawn !== undefined) {
                this.hands[this.currplayer - 1].push(drawn.uid);
            }
        }

        this.saveState();
        return this;
    }

    public get target(): number {
        if (this.variants.includes("goal-40")) {
            return 40;
        } else if (this.variants.includes("goal-80")) {
            return 80;
        }
        return 60;
    }

    protected checkEOG(): BiscuitGame {
        const maxScore = Math.max(...this.scores);
        if (maxScore >= this.target) {
            this.gameover = true;
            for (let i = 1; i <= this.numplayers; i++) {
                if (this.scores[i - 1] === maxScore) {
                    this.winner.push(i as playerid);
                }
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(opts?: {strip?: boolean, player?: number}): IBiscuitState {
        const state: IBiscuitState = {
            game: BiscuitGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
        if (opts !== undefined && opts.strip) {
            state.stack = state.stack.map(mstate => {
                for (let p = 1; p <= this.numplayers; p++) {
                    if (p === opts.player) { continue; }
                    mstate.hands[p-1] = mstate.hands[p-1].map(() => "");
                }
                mstate.facedown = undefined;
                return mstate;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: BiscuitGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as BiscuitBoard,
            scores: [...this.scores],
            facedown: this.facedown,
            round: this.round,
            passes: this.passes,
            hands: deepclone(this.hands) as string[][],
        };
    }

    public render(): APRenderRep {
        const {height, width, minX, maxX, minY, maxY} = this.board.dimensions;

        const rowLabels: string[] = [];
        for (let y = minY - 1; y <= maxY + 1; y++) {
            rowLabels.push(y.toString());
        }
        const columnLabels: string[] = [];
        for (let x = minX - 1; x <= maxX + 1; x++) {
            columnLabels.push(x.toString());
        }

        // build pieces string and block most cells, for visual clarity
        const pieces: string[][] = [];
        const blocked: RowCol[] = [];
        for (let relRow = 0; relRow < height + 2; relRow++) {
            const pcs: string[] = [];
            for (let relCol = 0; relCol < width + 2; relCol++) {
                const [absx, absy] = this.board.rel2abs(relCol, relRow);
                const card = this.board.getCardAt(absx, absy);
                if (card === undefined) {
                    pcs.push("-")
                    // block all empty spaces not on the main line, to start
                    if (absy !== 0) {
                        blocked.push({row: relRow, col: relCol});
                    }
                } else {
                    pcs.push(`c${card.card.uid}`);
                    // block all occupied cells
                    blocked.push({row: relRow, col: relCol});
                }
            }
            pieces.push(pcs);
        }
        const pstr = pieces.map(p => p.join(",")).join("\n");
        // now unblock cells at either end of each cross line
        const {cross} = this.board.lines;
        for (const line of cross) {
            const top = line[0];
            const bottom = line[line.length - 1];
            const [tRelX, tRelY] = this.board.abs2rel(top.x, top.y)!;
            const [bRelX, bRelY] = this.board.abs2rel(bottom.x, bottom.y)!;
            const tidx = blocked.findIndex(({row, col}) => row === tRelY - 1 && col === tRelX);
            blocked.splice(tidx, 1);
            const bidx = blocked.findIndex(({row, col}) => row === bRelY + 1 && col === bRelX);
            blocked.splice(bidx, 1);
        }

        // build legend of ALL cards
        const allcards = [...cardsBasic];
        if (this.variants.includes("excuse") && this.variants.includes("pawns+courts")) {
            allcards.push(...cardsExtended);
        } else {
            if (this.variants.includes("excuse")) {
                allcards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
            }
            if (this.variants.includes("pawns-only") || this.variants.includes("pawns+courts")) {
                allcards.push(...cardsExtended.filter(c => c.rank.uid === "P"));
            }
            if (this.variants.includes("pawns+courts")) {
                allcards.push(...cardsExtended.filter(c => c.rank.uid === "T"));
            }
        }
        const legend: ILegendObj = {};
        for (const card of allcards) {
            legend["c" + card.uid] = BiscuitGame.card2glyph(card);
        }
        legend["cUNKNOWN"] = {
            name: "piece-square-borderless",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5,
            },
        }

        // build pieces areas
        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const hand = this.hands[p-1];
            if (hand.length > 0 && !hand.includes("")) {
                areas.push({
                    type: "pieces",
                    pieces: hand.map(c => "c" + c) as [string, ...string[]],
                    label: i18next.t("apgames:validation.jacynth.LABEL_STASH", {playerNum: p}) || `P${p} Hand`,
                    spacing: 0.5,
                    width: 6,
                });
            } else if (hand.includes("")) {
                areas.push({
                    type: "pieces",
                    pieces: hand.map(() => "cUNKNOWN") as [string, ...string[]],
                    label: i18next.t("apgames:validation.jacynth.LABEL_STASH", {playerNum: p}) || `P${p} Hand`,
                    spacing: 0.5,
                    width: 6,
                });
            }
        }
        // create an area for all invisible cards (if there are any cards left)
        const hands = this.hands.map(h => [...h]);
        const onboard = this.board.cards.map(c => c.card.uid);
        const visibleCards = [...onboard, ...hands.flat().filter(c => c !== "")].map(uid => Card.deserialize(uid));
        if (visibleCards.includes(undefined)) {
            throw new Error(`Could not deserialize one of the cards. This should never happen!`);
        }
        const remaining = allcards.sort(cardSortAsc).filter(c => visibleCards.find(cd => cd!.uid === c.uid) === undefined).map(c => "c" + c.uid) as [string, ...string[]]
        if (remaining.length > 0) {
            areas.push({
                type: "pieces",
                label: i18next.t("apgames:validation.jacynth.LABEL_REMAINING") || "Cards in deck",
                spacing: 0.25,
                pieces: remaining,
                width: 6,
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-beveled",
                width: width + 2,
                height: height + 2,
                tileHeight: 1,
                tileWidth: 1,
                tileSpacing: 0.1,
                // strokeOpacity: 0.05,
                blocked: blocked as [RowCol, ...RowCol[]],
                rowLabels: rowLabels.map(l => l.replace("-", "\u2212")),
                columnLabels: columnLabels.map(l => l.replace("-", "\u2212")),
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Add annotations (but only if we didn't just start a new round)
        if (this.results.length > 0 && this.results.find(r => r.type === "reset") === undefined) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [absx, absy] = move.where!.split(",").map(n => parseInt(n, 10));
                    const [relx, rely] = this.board.abs2rel(absx, absy)!;
                    rep.annotations.push({type: "enter", occlude: false, targets: [{row: rely, col: relx}]});
                }
            }
        }

        // highlights, if any
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const [absx, absy] of this.highlights) {
                const [col, row] = this.board.abs2rel(absx, absy)!;
                rep.annotations!.push({type: "enter", targets: [{row, col}]});
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        return [
            { name: i18next.t("apgames:status.SCORES"), scores},
            // { name: i18next.t("apgames:status.CARDSINHAND"), scores: this.hands.map(h => h.length)},
        ];
    }

    public statuses(): IStatus[] {
        return [{ key: i18next.t("apgames:status.ROUND"), value: [this.round.toString()] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Round**: " + this.round.toString() + "\n\n";

        status += "**Scores**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.decktet", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "set":
                node.push(i18next.t("apresults:SET.biscuit", {player, count: r.count, context: r.what}));
                resolved = true;
                break;
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {player, count: r.delta, delta: r.delta}));
                resolved = true;
                break;
            case "declare":
                node.push(i18next.t("apresults:DECLARE.biscuit", {player}));
                resolved = true;
                break;
            case "stalemate":
                node.push(i18next.t("apresults:STALEMATE.biscuit", {player}));
                resolved = true;
                break;
            case "reset":
                node.push(i18next.t("apresults:RESET.biscuit", {player}));
                resolved = true;
                break;
            case "deckDraw":
                node.push(i18next.t("apresults:DECKDRAW.biscuit", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BiscuitGame {
        return Object.assign(new BiscuitGame(this.numplayers), deepclone(this) as BiscuitGame);
    }
}
