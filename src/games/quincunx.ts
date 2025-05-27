import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { oppositeDirections, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Deck, cardSortAsc, cardsBasic, cardsExtended } from "../common/decktet";
import { QuincunxBoard } from "./quincunx/board";
import { QuincunxCard } from "./quincunx/card";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2|3;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    scores: number[];
    board: QuincunxBoard;
    hands: string[][];
    lastmove?: string;
    round: number;
};

export interface IQuincunxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

const getNextRank = (curr: number, dir: "A"|"D"): number|null => {
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
        return 10
    }
    // >9 descending
    else {
        return 9;
    }
}

export class QuincunxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Quincunx",
        uid: "quincunx",
        playercounts: [2,3],
        version: "20250518",
        dateAdded: "2024-12-15",
        // i18next.t("apgames:descriptions.quincunx")
        description: "apgames:descriptions.quincunx",
        // i18next.t("apgames:notes.quincunx")
        notes: "apgames:notes.quincunx",
        urls: [
            "http://wiki.decktet.com/game:quincunx",
            "https://boardgamegeek.com/boardgame/37097/quincunx",
        ],
        people: [
            {
                type: "designer",
                name: "Chris DeLeo",
                urls: ["http://wiki.decktet.com/designer:chris-deleo"],
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
                uid: "flush",
            }
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>hidden", "board>dynamic", "board>connect>rect", "components>decktet", "other>2+players"],
        flags: ["experimental", "scores", "no-explore", "shared-pieces", "automove"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: QuincunxBoard;
    public hands: string[][] = [];
    public scores!: number[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public round = 1;
    private deck!: Deck;
    // @ts-expect-error (This is only read by the frontend code)
    private __noAutomove?: boolean;
    private masked: string[] = [];
    private selected: string|undefined;

    constructor(state: number | IQuincunxState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            // init deck
            const cards = [...cardsBasic];
            if (this.variants.includes("excuse")) {
                cards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
            }
            const deck = new Deck(cards);
            deck.shuffle();

            // init board
            const board = new QuincunxBoard();
            const root = new QuincunxCard({x: 0, y: 0, card: deck.draw()[0]});
            board.add(root);

            // init scores and hands
            const hands: string[][] = [];
            const scores: number[] = [];
            for (let i = 0; i < this.numplayers; i++) {
                scores.push(0);
                hands.push([...deck.draw(24/this.numplayers).map(c => c.uid)]);
            }

            const fresh: IMoveState = {
                _version: QuincunxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                round: 1,
                scores,
                board,
                hands,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IQuincunxState;
            }
            if (state.game !== QuincunxGame.gameinfo.uid) {
                throw new Error(`The Quincunx engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): QuincunxGame {
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
        this.round = state.round;
        this.board = QuincunxBoard.deserialize(state.board);
        this.hands = deepclone(state.hands) as string[][];
        this.lastmove = state.lastmove;

        // Deck is reset every time you load
        const cards = [...cardsBasic];
        if (this.variants.includes("excuse")) {
            cards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
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
        this.deck.shuffle();

        return this;
    }

    public moves(p?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (p === undefined) {
            p = this.currplayer;
        }

        const moves: string[] = [];
        for (const empty of this.board.empties) {
            for (const card of this.hands[p-1]) {
                moves.push(`${card}>${empty.join(",")}`);
            }
        }

        // if the board is full, then the only choice is to pass
        // which will trigger the end of the round
        if (moves.length === 0 && this.board.cards.length === 25) {
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
            result.message = i18next.t("apgames:validation.quincunx.INITIAL_INSTRUCTIONS")
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
                result.message = i18next.t("apgames:validation.quincunx.PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public scorePlacement(placed: QuincunxCard): {basics: [string,number][], draws: number, pairs: number, straights: number, sets: number, flushes: number, powerplay: boolean, powerplayScore: number} {
        const basics: [string,number][] = [];
        let draws = 0;
        let pairs = 0;
        let straights = 0;
        let sets = 0;
        let flushes = 0;
        let powerplay = false;
        let powerplayScore = 0;

        // don't need to do any of this if the placed card is the excuse
        if (placed.card.rank.name !== "Excuse") {
            const g = this.board.graph;
            const gOrth = this.board.graphOrth;
            const gOcc = this.board.graphOcc;
            const node = g.coords2algebraic(...this.board.abs2rel(placed.x, placed.y)!)
            // basic scoring first
            for (const n of gOrth.neighbours(node)) {
                const [nrelx, nrely] = g.algebraic2coords(n);
                const [nabsx, nabsy] = this.board.rel2abs(nrelx, nrely);
                const nCard = this.board.getCardAt(nabsx, nabsy);
                if (nCard !== undefined) {
                    // skip if the neighbour is the excuse
                    if (nCard.card.rank.name === "Excuse") {
                        continue;
                    }
                    const sum = placed.card.rank.seq + nCard.card.rank.seq;
                    // 2-9
                    if (sum <= 9) {
                        let hasAce = false;
                        if (placed.card.rank.name === "Ace" || nCard.card.rank.name === "Ace") {
                            hasAce = true;
                        }
                        const suitsMatch = placed.card.sharesSuitWith(nCard.card);
                        if (hasAce && suitsMatch) {
                            basics.push([nCard.card.uid, sum]);
                        } else {
                            basics.push([nCard.card.uid, sum * -1]);
                        }
                    } else if (sum === 10) {
                        basics.push([nCard.card.uid, 0]);
                    } else if (sum === 11) {
                        basics.push([nCard.card.uid, 0]);
                        draws++;
                    } else if (sum < 20) {
                        basics.push([nCard.card.uid, sum - 10]);
                    }
                    // this can only be if the sum is exactly 20
                    else {
                        basics.push([nCard.card.uid, 0]);
                        draws++;
                    }
                }
            }
            // pairs & triples
            for (const dir of ["N", "NE", "E", "SE"] as const) {
                let rayPrime = gOcc.ray(node, dir).map(n => this.board.getCardAt(...this.board.rel2abs(...gOcc.algebraic2coords(n)))!);
                const idxPrime = rayPrime.findIndex(c => c.card.rank.uid !== placed.card.rank.uid);
                if (idxPrime >= 0) {
                    rayPrime = rayPrime.slice(0, idxPrime)
                }
                const oppDir = oppositeDirections.get(dir)!;
                let rayOpp = gOcc.ray(node, oppDir).map(n => this.board.getCardAt(...this.board.rel2abs(...gOcc.algebraic2coords(n)))!);
                const idxOpp = rayOpp.findIndex(c => c.card.rank.uid !== placed.card.rank.uid);
                if (idxOpp >= 0) {
                    rayOpp = rayOpp.slice(0, idxOpp)
                }
                // a triple is present
                if (rayPrime.length + rayOpp.length + 1 >= 3) {
                    sets++;
                }
                // only a pair is present (in an orthogonal direction)
                else if (dir.length === 1 && (rayPrime.length > 0 || rayOpp.length > 0)) {
                    pairs++;
                }
            }
            // straights
            for (const dir of ["N", "NE", "E", "SE"] as const) {
                const rayPrime = gOcc.ray(node, dir).map(n => this.board.getCardAt(...this.board.rel2abs(...gOcc.algebraic2coords(n)))!);
                const oppDir = oppositeDirections.get(dir)!;
                const rayOpp = gOcc.ray(node, oppDir).map(n => this.board.getCardAt(...this.board.rel2abs(...gOcc.algebraic2coords(n)))!);
                for (const ad of ["A", "D"] as const) {
                    const straight: QuincunxCard[] = [placed.clone()];
                    let start = placed.clone();
                    for (const prime of rayPrime) {
                        const expected = getNextRank(start.card.rank.seq, ad);
                        if (prime.card.rank.seq === expected) {
                            straight.unshift(prime.clone());
                            start = prime.clone();
                        } else {
                            break;
                        }
                    }
                    const adOpp = ad === "A" ? "D" : "A";
                    start = placed.clone();
                    for (const opp of rayOpp) {
                        const expected = getNextRank(start.card.rank.seq, adOpp);
                        if (opp.card.rank.seq === expected) {
                            straight.push(opp.clone());
                            start = opp.clone();
                        } else {
                            break;
                        }
                    }
                    // if there's a straight in one up/down direction, there won't be in the other
                    if (straight.length >= 3) {
                        straights++;
                        break;
                    }
                }
            }
            // flushes, if variant set
            if (this.variants.includes("flush")) {
                // lines first
                for (const dir of ["N", "NE", "E", "SE"] as const) {
                    let rayPrime = gOcc.ray(node, dir).map(n => this.board.getCardAt(...this.board.rel2abs(...gOcc.algebraic2coords(n)))!);
                    const idxPrime = rayPrime.findIndex(c => !c.card.sharesSuitWith(placed.card));
                    if (idxPrime >= 0) {
                        rayPrime = rayPrime.slice(0, idxPrime)
                    }
                    const oppDir = oppositeDirections.get(dir)!;
                    let rayOpp = gOcc.ray(node, oppDir).map(n => this.board.getCardAt(...this.board.rel2abs(...gOcc.algebraic2coords(n)))!);
                    const idxOpp = rayOpp.findIndex(c => !c.card.sharesSuitWith(placed.card));
                    if (idxOpp >= 0) {
                        rayOpp = rayOpp.slice(0, idxOpp)
                    }
                    if (rayPrime.length + rayOpp.length + 1 >= 4) {
                        flushes++;
                    }
                }
                // squares, there are four possible configurations
                for (const deltas of [
                    // placed as top left
                    [[1, 0], [0, -1], [1, -1]],
                    // placed as top right
                    [[-1, 0], [0, -1], [-1, -1]],
                    // placed as bottom left
                    [[0, 1], [1, 0], [1, 1]],
                    // placed as bottom right
                    [[-1, 0], [0, 1], [-1, 1]],
                ]) {
                    let isFlush = true;
                    for (const [dx, dy] of deltas) {
                        const [absx, absy] = [placed.x + dx, placed.y + dy];
                        const card = this.board.getCardAt(absx, absy);
                        if (card === undefined || !card.card.sharesSuitWith(placed.card)) {
                            isFlush = false;
                            break;
                        }
                    }
                    if (isFlush) {
                        flushes++;
                    }
                }
            }
            // powerplays
            if (placed.card.rank.name === "Ace" || placed.card.rank.name === "Crown") {
                for (const n of gOrth.neighbours(node)) {
                    const nCard = this.board.getCardAt(...this.board.rel2abs(...g.algebraic2coords(n)));
                    if (nCard !== undefined && (nCard.card.rank.name === "Ace" || nCard.card.rank.name === "Crown")) {
                        if (placed.card.sharesSuitWith(nCard.card)) {
                            powerplay = true;
                            for (const card of this.board.cards) {
                                if (card.card.sharesSuitWith(placed.card)) {
                                    if (card.card.rank.name !== "Ace" && card.card.rank.name !== "Crown") {
                                        powerplayScore += card.card.rank.seq;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return {basics, draws, pairs, straights, sets, flushes, powerplay, powerplayScore};
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): QuincunxGame {
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

        this.selected = undefined;
        let [cardId,] = m.split(">");
        cardId = cardId.toUpperCase();
        if (cardId !== undefined && cardId.length > 0 && !m.includes(">")) {
            this.selected = cardId;
        }

        if (partial) { return this; }
        if (emulation && m === "pass") {
            this.__noAutomove = true;
            return this;
        }
        this.results = [];
        this.masked = [];

        let lastmove = m;
        let tag = "";
        // pass is what signals the end of the round
        // the last player will always make the last play
        // so the player that started the round passes, and the
        // next person around the table will start
        if (m === "pass") {
            this.results.push({type: "pass"});

            // tabulate penalties
            const inhand: Card[][] = [];
            for (let p = 1; p <= this.numplayers; p++) {
                inhand.push(this.hands[p-1].map(c => Card.deserialize(c)!))
            }
            const penalties: number[] = [];
            for (const hand of inhand) {
                let penalty = 0;
                for (const card of hand) {
                    if (card.rank.name === "Ace") {
                        penalty += 15;
                    } else {
                        penalty += card.rank.seq;
                    }
                }
                penalties.push(penalty);
            }
            this.results.push({type: "announce", payload: inhand.map(hand => hand.map(c => c.plain))});
            penalties.forEach((n, idx) =>  {
                this.scores[idx] -= n;
                this.results.push({type: "deltaScore", delta: n, who: idx+1});
            });

            // now check for eog
            this.checkEOG();
            // if the game isn't over yet, reset for the next round
            if (!this.gameover) {
                this.round++;
                this.results.push({type: "reset"});
                // init deck
                const cards = [...cardsBasic];
                if (this.variants.includes("excuse")) {
                    cards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
                }
                const deck = new Deck(cards);
                deck.shuffle();

                // init board
                this.board = new QuincunxBoard();
                const root = new QuincunxCard({x: 0, y: 0, card: deck.draw()[0]});
                this.board.add(root);

                // init hands (but not scores!)
                this.hands = [];
                for (let i = 0; i < this.numplayers; i++) {
                    this.hands.push([...deck.draw(24/this.numplayers).map(c => c.uid)]);
                }
                this.deck = deck;
            }
        }
        // each player will always have a valid move on their turn
        else {
            // eslint-disable-next-line prefer-const
            let [cardId, to] = m.split(">");
            const [x, y] = to.split(",").map(n => parseInt(n, 10));
            cardId = cardId.toUpperCase();
            lastmove = `${cardId}>${to}`;

            // place card
            const card = Card.deserialize(cardId)!;
            const cardObj = new QuincunxCard({x, y, card})
            this.board.add(cardObj);
            this.results.push({type: "place", what: card.plain, where: to});
            this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(cid => cid !== cardId);

            // tabulate scores
            const scores = this.scorePlacement(cardObj);
            // basic first
            for (const [cuid, n] of scores.basics) {
                this.scores[this.currplayer - 1] += n;
                this.results.push({type: "deltaScore", delta: n, description: `basic-${cuid}`});
            }
            // draws
            if (scores.draws > 0) {
                this.results.push({type: "deckDraw", count: scores.draws});
                const drawn = this.deck.draw(scores.draws).map(c => c.uid);
                if (emulation) {
                    this.masked = [...drawn];
                }
                this.hands[this.currplayer - 1].push(...drawn);
            }
            // pairs
            if (scores.pairs > 0) {
                const n = scores.pairs * 5;
                this.scores[this.currplayer - 1] += n;
                this.results.push({type: "set", count: scores.pairs, what: "pairs"});
                this.results.push({type: "deltaScore", delta: n, description: "pairs"});
            }
            // triples
            if (scores.sets > 0) {
                const n = scores.sets * 30;
                this.scores[this.currplayer - 1] += n;
                this.results.push({type: "set", count: scores.sets, what: "sets"});
                this.results.push({type: "deltaScore", delta: n, description: "sets"});
            }
            // straights
            if (scores.straights > 0) {
                const n = scores.straights * 20;
                this.scores[this.currplayer - 1] += n;
                this.results.push({type: "set", count: scores.straights, what: "straights"});
                this.results.push({type: "deltaScore", delta: n, description: "straights"});
            }
            // flushes
            if (scores.flushes > 0) {
                const n = scores.flushes * 10;
                this.scores[this.currplayer - 1] += n;
                this.results.push({type: "set", count: scores.flushes, what: "flushes"});
                this.results.push({type: "deltaScore", delta: n, description: "flushes"});
            }
            // powerplay
            if (scores.powerplay) {
                const n = scores.powerplayScore;
                this.scores[this.currplayer - 1] += n;
                this.results.push({type: "set", what: "powerplay"});
                this.results.push({type: "deltaScore", delta: n, description: "powerplay"});
            }

            // calculate total deltaScore
            let scoreChange = 0;
            for (const {delta} of this.results.filter(r => r.type === "deltaScore")) {
                scoreChange += delta!;
            }
            if (scoreChange > 0) {
                tag += scoreChange.toString();
            }
        }

        // update currplayer
        // Regardless of whether the round just ended,
        // play continues in sequence.
        this.lastmove = lastmove + (tag === "" ? "" : `(${tag})`);
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.saveState();
        return this;
    }

    protected checkEOG(): QuincunxGame {
        if (this.round === this.numplayers) {
            this.gameover = true;
            const maxScore = Math.max(...this.scores);
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

    public state(opts?: {strip?: boolean, player?: number}): IQuincunxState {
        const state: IQuincunxState = {
            game: QuincunxGame.gameinfo.uid,
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
                return mstate;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: QuincunxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as QuincunxBoard,
            scores: [...this.scores],
            round: this.round,
            hands: deepclone(this.hands) as string[][],
        };
    }

    public render(): APRenderRep {
        const {height, width, minX, maxX, minY, maxY} = this.board.dimensions;

        const rowLabels: string[] = [];
        for (let y = (height < 5 ? minY - 1 : minY); y <= (height < 5 ? maxY + 1 : maxY); y++) {
            rowLabels.push(y.toString());
        }
        const columnLabels: string[] = [];
        for (let x = (width < 5 ? minX - 1 : minX); x <= (width < 5 ? maxX + 1 : maxX); x++) {
            columnLabels.push(x.toString());
        }

        // build pieces string and block most cells, for visual clarity
        const pieces: string[][] = [];
        const blocked: RowCol[] = [];
        for (let relRow = 0; relRow < (height < 5 ? height + 2 : 5); relRow++) {
            const pcs: string[] = [];
            for (let relCol = 0; relCol < (width < 5 ? width + 2 : 5); relCol++) {
                const [absx, absy] = this.board.rel2abs(relCol, relRow);
                const card = this.board.getCardAt(absx, absy);
                if (card === undefined) {
                    pcs.push("-")
                    // block all empty spaces to start
                    blocked.push({row: relRow, col: relCol});
                } else {
                    pcs.push(`c${card.card.uid}`);
                }
            }
            pieces.push(pcs);
        }
        const pstr = pieces.map(p => p.join(",")).join("\n");
        // now unblock cells orthogonally adjacent to placed cards
        const g = this.board.graphOrth;
        for (const card of this.board.cards) {
            const [absx, absy] = [card.x, card.y];
            const [relx, rely] = this.board.abs2rel(absx, absy)!;
            const node = g.coords2algebraic(relx, rely);
            for (const n of g.neighbours(node)) {
                const [nrelx, nrely] = g.algebraic2coords(n);
                const [nabsx, nabsy] = this.board.rel2abs(nrelx, nrely);
                const nCard = this.board.getCardAt(nabsx, nabsy);
                if (nCard === undefined) {
                    const idx = blocked.findIndex(({row, col}) => row === nrely && col === nrelx);
                    if (idx >= 0) {
                        blocked.splice(idx, 1);
                    }
                }
            }
        }

        // build legend of ALL cards
        const allcards = [...cardsBasic];
        if (this.variants.includes("excuse")) {
            allcards.push(...cardsExtended.filter(c => c.rank.uid === "0"));
        }
        const legend: ILegendObj = {};
        for (const card of allcards) {
            const glyph = card.toGlyph();
            if (this.selected === card.uid) {
                glyph.unshift({
                    name: "piece-square",
                    colour: {
                        func: "flatten",
                        fg: "_context_fill",
                        bg: "_context_background",
                        opacity: 0.2,
                    },
                });
            }
            legend["c" + card.uid] = glyph;
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
            const hand = [...this.hands[p-1]];
            if (!hand.includes("")) {
                const sorted = hand.map(uid => Card.deserialize(uid)!).sort(cardSortAsc).map(c => c.uid).sort((a,b) => {
                    if (this.masked.includes(a) && this.masked.includes(b)) {
                        return 0;
                    } else if (this.masked.includes(a)) {
                        return 1
                    } else if (this.masked.includes(b)) {
                        return -1;
                    } else {
                        return 0;
                    }
                }).map(c => this.masked.includes(c) ? "cUNKNOWN" : ("c" + c));
                areas.push({
                    type: "pieces",
                    pieces: sorted as [string, ...string[]],
                    label: i18next.t("apgames:validation.jacynth.LABEL_STASH", {playerNum: p}) || `P${p} Hand`,
                    spacing: 0.5,
                    width: width < 6 ? 6 : undefined,
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
                width: width < 6 ? 6 : undefined,
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-beveled",
                width: width < 5 ? width + 2 : 5,
                height: height < 5 ? height + 2 : height,
                blocked: blocked.length > 0 ? blocked as [RowCol, ...RowCol[]] : undefined,
                rowLabels: rowLabels.map(l => l.replace("-", "\u2212")),
                columnLabels: columnLabels.map(l => l.replace("-", "\u2212")),
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [absx, absy] = move.where!.split(",").map(n => parseInt(n, 10));
                    const [relx, rely] = this.board.abs2rel(absx, absy)!;
                    rep.annotations.push({type: "enter", occlude: false, targets: [{row: rely, col: relx}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
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
            { name: i18next.t("apgames:status.CARDSINHAND"), scores: this.hands.map(h => h.length)},
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
                node.push(i18next.t("apresults:SET.quincunx", {player, count: r.count, context: r.what}));
                resolved = true;
                break;
            case "deltaScore":
                // announcing penalties at the end of the round
                if (r.who !== undefined) {
                    node.push(i18next.t("apresults:DELTASCORE.quincunx.penalty", {player, count: r.delta, delta: r.delta, playerNum: r.who}));
                    resolved = true;
                }
                // basic score components
                else if (r.description !== undefined && r.description.startsWith("basic-")) {
                    const idx = r.description.indexOf("-");
                    node.push(i18next.t("apresults:DELTASCORE.quincunx.basic", {player, count: Math.abs(r.delta!), delta: r.delta, card: r.description.substring(idx+1)}));
                    resolved = true;
                }
                // individual score components
                else {
                    node.push(i18next.t(r.delta! >= 0 ? "apresults:DELTA_SCORE_GAIN" : "apresults:DELTA_SCORE_LOSS", {player, count: Math.abs(r.delta!), delta: Math.abs(r.delta!)}));
                    resolved = true;
                }
                break;
            case "announce":
                (r.payload as string[][]).forEach((hand, idx) => {
                    node.push(i18next.t("apresults:ANNOUNCE.quincunx", {playerNum: idx+1, cards: hand.join(", ")}));
                });
                resolved = true;
                break;
            case "reset":
                node.push(i18next.t("apresults:RESET.biscuit", {player}));
                resolved = true;
                break;
            case "deckDraw":
                node.push(i18next.t("apresults:DECKDRAW.quincunx", {player, count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): QuincunxGame {
        return Object.assign(new QuincunxGame(this.numplayers), deepclone(this) as QuincunxGame);
    }
}
