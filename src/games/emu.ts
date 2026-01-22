import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { AnnotationFreespace, APRenderRep, AreaPieces, Freepiece, Glyph, MarkerFreespaceLabel, MarkerPath } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { findLastIndex, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Deck, cardSortAsc, cardsBasic, cardsExtended } from "../common/decktet";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");
import { PowerSet } from "js-combinatorics";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: [string[][], string[][]];
    hands: string[][];
    discard: string[];
    drawn: string[];
    scores: [number,number];
    year: number;
    eoy?: boolean;
    lastmove?: string;
};

export interface IEmuState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

// assumes that any bird it receives is valid
export const birdDir = (bird: string[]): "A"|"D"|null => {
    const cards = bird.map(c => Card.deserialize(c)!);
    const rank1 = cards[0].rank.seq;
    // if hatched with an Ace, must be ascending
    if (rank1 === 1) {
        return "A";
    }
    // if hatched with a Crown, must be descending
    else if (rank1 === 10) {
        return "D"
    }
    // otherwise, use context
    else {
        // find next numbered card
        const rank2 = cards.slice(1).find(c => c.rank.uid !== "P" && c.rank.uid !== "T")?.rank.seq;
        // if there isn't one, then it's undetermined
        // but sometimes it can still be determined by pure numbers alone
        if (rank2 === undefined) {
            const numWilds = bird.length - 1;
            if (rank1 + numWilds > 9) {
                return "D";
            } else if (rank1 - numWilds < 2) {
                return "A";
            } else {
                return null;
            }
        }
        // otherwise, compare the sequences
        else {
            if (rank1 < rank2) {
                return "A";
            } else if (rank1 > rank2) {
                return "D";
            } else {
                throw new Error("Found cards of the same rank.");
            }
        }
    }
}

export const getBirdSuits = (bird: string[]): string[] => {
    const cards = bird.map(c => Card.deserialize(c)!);
    // find suits of initial card
    const initSuits = new Set<string>(cards[0].suits.map(s => s.uid));
    // narrow it down to the one (or potentially two) suits that all cards share
    for (const c of cards.slice(1)) {
        const cardSuits = new Set<string>(c.suits.map(s => s.uid))
        for (const init of [...initSuits]) {
            if (!cardSuits.has(init)) {
                initSuits.delete(init);
            }
        }
    }
    // if there are no suits left, then the bird is invalid
    if (initSuits.size === 0) {
        throw new Error("The cards in this bird do not all share a suit.");
    }
    return [...initSuits];
}

export const canGrowBird = (bird: string[], card: string): boolean => {
    const cards = bird.map(c => Card.deserialize(c)!);
    const cardObj = Card.deserialize(card);
    if (cardObj === undefined) {
        throw new Error(`Could not deserialize the card ${card}. Bird: ${JSON.stringify(bird)}`);
    }

    // suits first
    // find suits of initial card
    const initSuits = new Set<string>(cards[0].suits.map(s => s.uid));
    // narrow it down to the one (or potentially two) suits that all cards share
    for (const c of cards.slice(1)) {
        const cardSuits = new Set<string>(c.suits.map(s => s.uid))
        for (const init of [...initSuits]) {
            if (!cardSuits.has(init)) {
                initSuits.delete(init);
            }
        }
    }
    // if there are no suits left, then the bird is invalid
    if (initSuits.size === 0) {
        throw new Error("The cards in this bird do not all share a suit.");
    }
    // if the card doesn't share any suits, it can't be used
    const shared = cardObj.suits.map(s => s.uid).filter(s => initSuits.has(s));
    if (shared.length === 0) {
        return false;
    }

    // now rank
    // get index of last non-wild card in the bird (there will always be at least one: the first card)
    const lastIdx = findLastIndex(cards, c => c.rank.uid !== "P" && c.rank.uid !== "T");
    // get the rank of that last non-wild card
    const lastRank = cards[lastIdx].rank.seq;
    // get the number of wilds that come after that last non-wild card (usually 0)
    const numWilds = cards.slice(lastIdx + 1).length;
    // calculate effective rank of the card being placed
    const dir = birdDir(bird);
    let effRank = cardObj.rank.seq;
    // if it's a wild, we need to do some math
    if (cardObj.rank.uid === "P" || cardObj.rank.uid === "T") {
        if (dir === "A") {
            effRank = lastRank + numWilds + 1;
            // wilds can't be Crowns
            if (effRank >= 10) {
                return false;
            }
        } else if (dir === "D") {
            effRank = lastRank - numWilds - 1;
            // wilds can't be Aces
            if (effRank <= 1) {
                return false;
            }
        } else {
            // add the card and test if that determines the direction
            const newdir = birdDir([...bird, card]);
            if (newdir === "A") {
                effRank = lastRank + numWilds + 1;
                // wilds can't be Crowns
                if (effRank >= 10) {
                    return false;
                }
            } else if (newdir === "D") {
                effRank = lastRank - numWilds - 1;
                // wilds can't be Aces
                if (effRank <= 1) {
                    return false;
                }
            }
            // at this point, if it's still null, then either direction is fine
            else {
                return true;
            }
        }
    }

    // get the difference of the new card rank and the last non-wild
    const dRank = effRank - lastRank;
    // abs(dRank) must be strictly greater than the number of intervening wilds
    if (Math.abs(dRank) <= numWilds) {
        return false;
    }
    // if ascending, dRank must be positive
    if (dir === "A" && dRank < 0) {
        return false;
    }
    // if descending, dRank must be negative
    if (dir === "D" && dRank > 0) {
        return false;
    }

    // in all other cases (undetermined direction or going in the right direction), we're good
    return true;
}

// assumes that any bird it receives contains a wild
const interpolateIndividual = (bird: string[]): string[][] => {
    const allBirds: string[][] = [];
    const suits = getBirdSuits(bird);
    let dir = birdDir(bird);
    // in any undetermined scenario, the score will always be better if
    // the bird is calculated as ascending
    if (dir === null) {
        dir = "A";
    }
    // find index of first wild card (will always be >0)
    const idxWild = bird.findIndex(c => c.startsWith("P") || c.startsWith("T"));
    // get rank of non-wild just before this wild (will always be one)
    const initRank = Card.deserialize(bird[idxWild-1])!.rank.seq;
    // find index of next non-wild card (not guaranteed to exist)
    const nextNonWild = bird.slice(idxWild + 1).findIndex(c => !c.startsWith("P") && !c.startsWith("T"));
    const numInterveningWilds = nextNonWild === -1 ? bird.slice(idxWild).length : nextNonWild;
    // calculate what the next number card is or would be
    let nextLimit: number;
    if (nextNonWild === -1) {
        if (dir === "A") {
            nextLimit = 11 - numInterveningWilds;
        } else {
            nextLimit = 0 + numInterveningWilds;
        }
    } else {
        const nextCard = bird.slice(idxWild + 1)[nextNonWild];
        if (/^\d/.test(nextCard)) {
            nextLimit = parseInt(nextCard[0], 10);
        } else {
            nextLimit = 10;
        }
    }
    // console.log(JSON.stringify({bird, dir, idxWild, initRank, nextNonWild, numInterveningWilds, nextLimit}));
    // push a new version of the bird for each possible value this wild could have
    for (
        let newRank = dir === "A" ? initRank + 1 : initRank - 1;
        dir === "A" ? newRank < nextLimit : newRank > nextLimit;
        dir === "A" ? newRank++ : newRank--
    ) {
        // find any valid Decktet card that has this rank and is the right suit
        const found = cardsBasic.find(c => c.rank.seq === newRank && c.suits.some(s => suits.includes(s.uid)));
        if (found === undefined) {
            throw new Error(`Could not find a Decktet card with the rank ${newRank} and one of the suits [${suits.join(", ")}]`);
        }
        const newbird = [...bird];
        newbird.splice(idxWild, 1, found.uid);
        allBirds.push(newbird);
    }

    return allBirds;
}

export const interpolateWilds = (bird: string[]): string[][] => {
    let allBirds: string[][] = [bird];
    while (allBirds.some(b => b.find(c => c.startsWith("P") || c.startsWith("T")) !== undefined)) {
        // all birds that still contain wilds
        const wilds = allBirds.filter(b => b.find(c => c.startsWith("P") || c.startsWith("T")) !== undefined);
        // all other birds
        allBirds = allBirds.filter(b => b.find(c => c.startsWith("P") || c.startsWith("T")) === undefined);
        for (const wild of wilds) {
            allBirds.push(...interpolateIndividual(wild));
        }
    }
    return allBirds;
}

type ScoreReport = {
    // the final evaluated score
    value: number;
    // the list of number card ranks, including interpolated wilds
    ranks: (number|string)[];
    // the number cards thrown away to cover the cost
    upkeep?: number[];
};

const scoreIndividual = (bird: string[]): ScoreReport => {
    const cards = bird.map(b => Card.deserialize(b)!);
    const numbers = cards.filter(c => c.rank.seq > 1 && c.rank.seq < 10).map(c => c.rank.seq);
    const sum = numbers.reduce((acc, curr) => acc + curr, 0);
    if (sum < 18) {
        let value = sum - 18;
        let ac = "";
        if (cards.find(c => c.rank.seq === 1) !== undefined) {
            value -= 5;
            ac += "A";
        }
        if (cards.find(c => c.rank.seq === 10) !== undefined) {
            value -= 5;
            ac += "C";
        }
        const ranks: (string|number)[] = [...numbers];
        if (ac.length > 0) {
            ranks.push(`(${ac})`);
        }
        return {
            value,
            ranks: ranks,
        };
    } else {
        const pset = new PowerSet(numbers);
        let value: number = 0;
        let upkeep: number[] = [...numbers];
        for (const set of pset) {
            const sum = set.reduce((acc, curr) => acc + curr, 0);
            if (sum >= 18) {
                const remaining = numbers.filter(n => !set.includes(n));
                const remainder = remaining.reduce((acc, curr) => acc + curr, 0);
                if (remainder > value) {
                    value = remainder;
                    upkeep = [...set];
                }
            }
        }
        let ac = "";
        if (cards.find(c => c.rank.seq === 1) !== undefined) {
            value += 5;
            ac += "A";
        }
        if (cards.find(c => c.rank.seq === 10) !== undefined) {
            value += 5;
            ac += "C"
        }
        const ranks: (string|number)[] = [...numbers];
        if (ac.length > 0) {
            ranks.push(`(${ac})`);
        }
        return {
            value,
            ranks,
            upkeep,
        }
    }
}

export const scoreBird = (bird: string[]): ScoreReport => {
    let maxValue: ScoreReport|undefined;
    const allBirds = interpolateWilds(bird);
    for (const bird of allBirds) {
        const score = scoreIndividual(bird);
        if (maxValue === undefined || score.value > maxValue.value) {
            maxValue = score;
        }
    }
    return maxValue!;
}

export const eoyMoves =
    (hand: string[], birds: string[][]): string[] =>
{
    const moves: string[] = [];
    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        for (let j = 0; j < birds.length; j++) {
            const bird = birds[j];
            if (canGrowBird(bird, card)) {
                const newbirds = deepclone(birds) as string[][];
                newbirds[j].push(card);
                // if card is an Ace or Crown, don't continue this line
                // if the new bird is negative scoring
                if (card.startsWith("1") || card.startsWith("N")) {
                    const newScore = scoreBird(newbirds[j]);
                    if (newScore.value < 0) {
                        continue;
                    }
                }
                const newhand = [...hand].filter(c => c !== card);
                const continuations = eoyMoves(newhand, newbirds);
                if (continuations.length > 0) {
                    for (const c of continuations) {
                        moves.push([`${card}-${j+1}`, c].join(","));
                    }
                } else {
                    moves.push(`${card}-${j+1}`);
                }
            }
        }
    }
    return moves;
}

export class EmuGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Emu Ranchers",
        uid: "emu",
        playercounts: [2],
        version: "20250610",
        dateAdded: "2025-11-22",
        // i18next.t("apgames:descriptions.emu")
        description: "apgames:descriptions.emu",
        // i18next.t("apgames:notes.emu")
        notes: "apgames:notes.emu",
        urls: [
            "http://wiki.decktet.com/game:emu-ranchers",
        ],
        people: [
            {
                type: "designer",
                name: "P.D. Magnus",
                urls: ["https://www.fecundity.com/pmagnus/gaming.html"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "years-2", group: "length" },
            { uid: "#length" },
            { uid: "years-6", group: "length" },
            { uid: "courts", group: "deck" },
            { uid: "both", group: "deck" },
            { uid: "none", group: "deck" },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>hidden", "mechanic>random>setup", "mechanic>random>play", "board>none", "components>decktet"],
        flags: ["no-explore", "scores", "custom-buttons", "autopass"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board: [string[][], string[][]] = [[],[]];
    public hands: string[][] = [];
    public discard: string[] = [];
    public drawn: string[] = [];
    public scores!: [number,number];
    public year = 1;
    // only defined after the first player makes their end-of-year turn
    public eoy: boolean|undefined;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private deck!: Deck;
    private selected: string|undefined;
    // @ts-expect-error (This is only read by the frontend code)
    private __noAutomove?: boolean;

    public static readonly BOARD_UNIT_DIMENSIONS = 50; // 48.61114501953125;

    constructor(state?: IEmuState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            // init deck
            const deck = this.initDeck();
            deck.shuffle();

            // init hands
            const hands: string[][] = [];
            const handSize = 6;
            for (let i = 0; i < this.numplayers; i++) {
                hands.push(deck.draw(handSize).map(c => c.uid));
            }

            // init board
            const board: [string[][], string[][]] = [[], []];

            const fresh: IMoveState = {
                _version: EmuGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands,
                discard: [],
                drawn: [],
                scores: [0,0],
                year: 1,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEmuState;
            }
            if (state.game !== EmuGame.gameinfo.uid) {
                throw new Error(`The Emu engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    private initDeck(): Deck {
        const cards = [...cardsBasic];
        if (!this.variants.includes("none")) {
            // both pawns & courts
            if (this.variants.includes("both")) {
                cards.push(...[...cardsExtended]);
            }
            // just Excuse + courts
            else if (this.variants.includes("courts")) {
                cards.push(...[...cardsExtended].filter(card => card.uid === "0" || card.rank.uid === "T"));
            }
            // default Excuse + pawns
            else {
                cards.push(...[...cardsExtended].filter(card => card.uid === "0" || card.rank.uid === "P"));
            }
        }
        return new Deck(cards);
    }

    public load(idx = -1): EmuGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as [string[][], string[][]];
        this.hands = state.hands.map(h => [...h]);
        this.discard = [...state.discard];
        this.drawn = [...state.drawn];
        this.scores = [...state.scores];
        this.year = state.year;
        this.eoy = state.eoy;
        this.lastmove = state.lastmove;

        // Deck is reset every time you load
        this.deck = this.initDeck();
        // remove cards from the deck that are on the board, the discard, or in known hands
        const board = this.board.flat().flat();
        for (const uid of [...board, ...this.discard]) {
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

    public getButtons(): ICustomButton[] {
        if (this.moves().includes("pass")) {
            return [{ label: "pass", move: "pass" }];
        }
        return [];
    }

    public get goal(): number {
        const found = this.variants.find(v => v.startsWith("years-"));
        if (found !== undefined) {
            const [,nStr] = found.split("-");
            const n = parseInt(nStr, 10);
            return n;
        }
        return 4;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // if this is the last move of the year, return eoy move list
        if (this.deck.size === 0) {
            moves.push(...eoyMoves(this.hands[player - 1], this.board[player - 1]));
        }
        // otherwise, normal play
        else {
            for (const card of this.hands[player - 1]) {
                if (card === "") {
                    continue;
                }
                // any card may be discarded
                moves.push(`${card}-discard,deck`);
                if (card !== "0") {
                    // any basic card can be used to hatch a new bird
                    if (!card.startsWith("P") && !card.startsWith("T")) {
                        const move = `${card}-new`;
                        moves.push(`${move},deck`);
                        if (this.discard.length > 0) {
                            moves.push(`${move},discard`);
                        }
                    }
                    // some cards may be used to grow a bird
                    for (let i = 0; i < this.board[player - 1].length; i++) {
                        const bird = this.board[player - 1][i];
                        if (canGrowBird(bird, card)) {
                            moves.push(`${card}-${i+1},deck`);
                            if (this.discard.length > 0) {
                                moves.push(`${card}-${i+1},discard`);
                            }
                        }
                    }
                }
            }
        }

        // if moves is empty, add "pass"
        // this can only happen at the end of a year where a player can't lay off any of their cards
        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // in this handler, row and col are ignored, and piece is always passed
    public handleClick(move: string, row: number, col: number, piece: string): IClickResult {
        try {
            let newmove = "";
            const hand = this.hands[this.currplayer - 1];
            let clicked = "";
            if (piece.startsWith("bird")) {
                clicked = piece.substring(4);
            } else if (["deck", "discard", "new"].includes(piece)) {
                clicked = piece;
            } else if (piece.startsWith("c")) {
                clicked = piece.substring(1);
            }
            // clicking on your hand
            if (hand.includes(clicked) || move === "") {
                if (move === "") {
                    newmove = clicked;
                } else {
                    const parts = move.split(",");
                    const last = parts[parts.length - 1];
                    // if last was complete, start new
                    if (last.includes("-")) {
                        newmove = [...parts, clicked].join(",");
                    }
                    // otherwise, ignore last and add the new
                    else {
                        if (parts.length > 1) {
                            newmove = [...parts.slice(0, -1), clicked].join(",");
                        } else {
                            newmove = clicked;
                        }
                    }
                }
            }
            // otherwise, on the board
            else {
                // normal play
                if (this.deck.size > 0) {
                    const [left,] = move.split(",");
                    const [card,] = left.split("-");
                    // if clicking a card in your hand, reset everything
                    if (piece.startsWith("c")) {
                        newmove = clicked;
                    }
                    // if clicking a bird, reset destination
                    else if (piece.startsWith("bird") || piece === "new") {
                        if (card !== undefined && card.length > 0) {
                            newmove = `${card}-${clicked}`;
                        } else {
                            newmove = move;
                        }
                    }
                    // if clicking the deck or discard
                    else if (piece === "deck" || piece === "discard") {
                        if (left !== undefined && left.length > 0) {
                            if (!left.includes("-") && piece === "discard") {
                                newmove = `${card}-${clicked}`;
                            } else {
                                newmove = `${left},${clicked}`
                            }
                        } else {
                            newmove = move;
                        }
                    }
                }
                // end of year play
                else {
                    const parts = move.split(",");
                    const last = parts[parts.length - 1];
                    // if clicking on a card in your hand
                    if (piece.startsWith("c")) {
                        // if the last part is complete, start a new part
                        if (last.includes("-")) {
                            newmove = `${move},${clicked}`;
                        }
                        // otherwise reset the last part
                        else {
                            if (parts.length > 1) {
                                newmove = `${parts.slice(0, -1).join(",")},${clicked}`;
                            } else {
                                newmove = clicked;
                            }
                        }
                    }
                    // if clicking on a bird
                    else if (piece.startsWith("bird")) {
                        // if the last part is complete, adjust the last part
                        if (last.includes("-")) {
                            const [left,] = last.split("-");
                            newmove = `${left}-${clicked}`;
                        }
                        // otherwise complete the last part
                        else {
                            if (parts.length > 1) {
                                newmove = `${parts.slice(0, -1).join(",")},${last}-${clicked}`;
                            } else {
                                newmove = `${last}-${clicked}`;
                            }
                        }
                    }
                    // anything else is an error
                    else {
                        newmove = move;
                    }
                }
            }

            // autocomplete
            const matches = this.moves().filter(m => m.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
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

        m = m.toUpperCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/DISCARD/g, "discard");
        m = m.replace(/DECK/g, "deck");
        m = m.replace(/NEW/g, "new");
        m = m.replace(/PASS/g, "pass");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.emu.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                const parts = m.split(",");
                const last = parts[parts.length - 1];
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                if (!last.includes("-")) {
                    result.message = i18next.t("apgames:validation.emu.SELECT_DEST");
                } else if (this.deck.size === 0) {
                    result.message = i18next.t("apgames:validation.emu.INITIAL_INSTRUCTIONS");
                } else {
                    result.message = i18next.t("apgames:validation.emu.SELECT_SRC");
                }
                return result;
            // either select bird, discard card, or choose draw source
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): EmuGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toUpperCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/DISCARD/g, "discard");
        m = m.replace(/DECK/g, "deck");
        m = m.replace(/NEW/g, "new");
        m = m.replace(/PASS/g, "pass");
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
        this.selected = undefined;
        if (partial && !m.includes("-")) {
            this.selected = m;
            return this;
        }

        const parts = m.split(",");
        let drawNew = false;
        for (const part of parts) {
            // pass
            if (part === "pass") {
                this.results.push({type: "pass"});
            }
            // place a card
            else if (part.includes("-")) {
                const [card, dest] = part.split("-");
                const cardObj = Card.deserialize(card);
                if (cardObj === undefined) {
                    throw new Error(`Unable to deserialize the card ${card}`);
                }
                this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(c => c !== card);
                // existing bird
                if (/^\d+$/.test(dest)) {
                    const n = parseInt(dest, 10);
                    this.board[this.currplayer - 1][n - 1].push(card);
                }
                // new bird
                else if (dest === "new") {
                    this.board[this.currplayer - 1].push([card]);
                }
                // discard pile
                else if (dest === "discard") {
                    this.discard.push(card);
                }
                // error
                else {
                    throw new Error(`Unrecognized destination for a card: ${dest}`);
                }
                this.results.push({type: "place", what: cardObj.plain, where: dest, how: cardObj.uid});
            }
            // draw from the deck
            else if (part === "deck") {
                drawNew = true;
                this.results.push({type: "deckDraw", from: "deck"});
            }
            // draw from discard
            else if (part === "discard") {
                const drawn = this.discard.pop()!;
                const drawnObj = Card.deserialize(drawn);
                if (drawnObj === undefined) {
                    throw new Error(`Could not deserialize the card ${drawn}`);
                }
                this.hands[this.currplayer - 1].push(drawn);
                this.drawn.push(drawn);
                this.results.push({type: "deckDraw", what: drawnObj.plain, from: "discard"});
            }
            // error
            else {
                if (!partial) {
                    throw new Error(`Unrecognized move part: ${part}`);
                }
            }
        }

        // draw new card
        if (drawNew) {
            if (partial || emulation) {
                this.hands[this.currplayer - 1].push("");
            } else {
                const [drawn] = this.deck.draw();
                if (drawn !== undefined) {
                    this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(c => c !== "");
                    this.hands[this.currplayer - 1].push(drawn.uid);
                }
            }
        }

        if (partial || emulation ) {
            if (emulation) {
                this.__noAutomove = true;
            }
            return this;
        }

        this.lastmove = m;
        // update currplayer
        // this is also where we handle year changeovers
        // undefined means that player should change as normal
        if (this.eoy === undefined) {
            // if the deck is empty, then the last card of the year has been drawn
            // set eoy to false and let the next player take their eoy turn
            if (this.deck.size === 0) {
                this.eoy = false;
                this.results.push({type: "declare", count: this.year});
            }
            // otherwise the year is ongoing
            let newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            this.currplayer = newplayer as playerid;
        }
        // if it's defined but false, then the first player of the year
        // just took their eoy turn
        else if (this.eoy === false) {
            // score this player's birds
            const birds = this.board[this.currplayer - 1];
            let minScore = Infinity;
            for (const bird of birds) {
                const score = scoreBird(bird);
                minScore = Math.min(minScore, score.value);
                this.scores[this.currplayer - 1] += score.value;
                this.results.push({type: "deltaScore", delta: score.value, description: score.ranks.join(", ")});
            }
            // check for Excuse
            if (this.hands[this.currplayer - 1].includes("0")) {
                if (minScore < 0) {
                    this.scores[this.currplayer - 1] += Math.abs(minScore);
                    this.results.push({type: "deltaScore", delta: Math.abs(minScore), description: "excuse"});
                }
            }

            //set eoy to true and let the next player take their last turn
            this.eoy = true;
            let newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            this.currplayer = newplayer as playerid;
        }
        // otherwise, the year is truly over
        else {
            // score this player's birds
            const birds = this.board[this.currplayer - 1];
            let minScore = Infinity;
            for (const bird of birds) {
                const score = scoreBird(bird);
                minScore = Math.min(minScore, score.value);
                this.scores[this.currplayer - 1] += score.value;
                this.results.push({type: "deltaScore", delta: score.value, description: score.ranks.join(", ")});
            }
            // check for Excuse
            if (this.hands[this.currplayer - 1].includes("0")) {
                if (minScore < 0) {
                    this.scores[this.currplayer - 1] += Math.abs(minScore);
                    this.results.push({type: "deltaScore", delta: Math.abs(minScore), description: "excuse"});
                }
            }

            // advance year
            const newyear = this.year + 1;
            // if still under goal
            if (newyear <= this.goal) {
                let newplayer = (this.currplayer as number) + 1;
                if (newplayer > this.numplayers) {
                    newplayer = 1;
                }
                this.currplayer = newplayer as playerid;
                // determine who the next first player is supposed to be
                const nextp = newyear % 2 === 0 ? 2 : 1;
                // manipulate game state to make sure the correct player
                // starts the next round
                // if the player who made the last move is also supposed to play
                // first in the next year, insert a pass
                if (nextp !== this.currplayer) {
                    // save the state
                    this.saveState();
                    this.results = [{type: "pass"}];
                    this.lastmove = "pass"
                } else {
                    // insert TWO passes so the final board state is rendered
                    // save the state
                    this.saveState();
                    this.results = [{type: "pass"}];
                    this.lastmove = "pass"
                    // save the state
                    this.saveState();
                    this.results = [{type: "pass"}];
                    this.lastmove = "pass"
                }
                this.currplayer = nextp;
                // reset the game
                this.year = newyear;
                const deck = this.initDeck();
                deck.shuffle();
                this.deck = deck;
                const hands: string[][] = [];
                const handSize = 6;
                for (let i = 0; i < this.numplayers; i++) {
                    hands.push(deck.draw(handSize).map(c => c.uid));
                }
                this.hands = hands;
                this.board = [[], []];
                this.discard = [];
                this.drawn = [];
                this.eoy = undefined;
                // let the outer saveState() call save this
            }
            // otherwise the game is now over
            // we need to set gameover here
            else {
                let newplayer = (this.currplayer as number) + 1;
                if (newplayer > this.numplayers) {
                    newplayer = 1;
                }
                this.currplayer = newplayer as playerid;
                this.gameover = true;
            }
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): EmuGame {
        if (this.gameover) {
            const [s1, s2] = this.scores;
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public state(opts?: {strip?: boolean, player?: number}): IEmuState {
        const state: IEmuState = {
            game: EmuGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
        if (opts !== undefined && opts.strip) {
            if (this.deck.size > 0) {
                state.stack = state.stack.map(mstate => {
                    for (let p = 1; p <= this.numplayers; p++) {
                        if (p === opts.player) { continue; }
                        mstate.hands[p-1] = mstate.hands[p-1].map(c => this.drawn.includes(c) ? c : "");
                    }
                    return mstate;
                });
            }
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: EmuGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as [string[][], string[][]],
            hands: this.hands.map(h => [...h]),
            discard: [...this.discard],
            drawn: [...this.drawn],
            scores: [...this.scores],
            year: this.year,
            eoy: this.eoy,
        };
    }

    public render({perspective}: IRenderOpts = {perspective: undefined}): APRenderRep {
        // build legend of real cards
        const freshDeck = this.initDeck();
        const allcards = freshDeck.cards.sort(cardSortAsc);
        const legend: ILegendObj = {};
        for (const card of allcards) {
            let glyph = card.toGlyph();
            // colour the selected card in their hand
            if (this.selected === card.uid) {
                glyph = card.toGlyph({border: true, fill: {
                            func: "flatten",
                            fg: "_context_fill",
                            bg: "_context_background",
                            opacity: 0.2,
                        }
                });
            }
            else {
                glyph = card.toGlyph();
            }
            legend["c" + card.uid] = glyph;
        }
        // add glyph for unknown cards
        legend["cUNKNOWN"] = {
            name: "piece-square-borderless",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5,
            },
        }
        // add glyphs for bird numbers
        const maxBird = Math.max(...this.board.map(h => h.length));
        if (maxBird > 0) {
            for (let i = 1; i <= maxBird; i++) {
                legend[`birdNum${i}`] = [
                    {name: "piece-square-borderless", colour: "_context_background",},
                    {text: i.toString(),}
                ];
            }
        }
        // add glyph for deck countdown
        // the deck count here has to take into account any face-down cards
        // in players' hands (observers don't see any cards, for example,
        // but the count should be consistent)
        let facedown = 0;
        for (const hand of this.hands) {
            const down = hand.filter(c => c === "");
            facedown += down.length;
        }
        legend["deck"] = [
            {name: "piece-square", colour: "_context_background",},
            {text: (this.deck.size - facedown).toString(),}
        ];
        // add glyph for empty discard
        legend["discard"] = [
            {name: "piece-square", colour: "_context_background",},
            {text: "\u{1F5D1}",}
        ];
        // add glyph for new bird
        legend[`new`] = [
            {name: "piece-square", colour: "_context_background",},
            {text: "+",}
        ];

        // build pieces areas
        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const hand = this.hands[p-1];
            if (hand.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: hand.map(c => "c" + (c === "" ? "UNKNOWN" : c)) as [string, ...string[]],
                    label: i18next.t("apgames:validation.jacynth.LABEL_STASH", {playerNum: p}) || `P${p} hand`,
                    spacing: 0.5,
                    width: 6,
                    ownerMark: p,
                });
            }
        }
        // discard pile (if >2 cards)
        if (this.discard.length > 1) {
            areas.push({
                type: "pieces",
                pieces: this.discard.map(c => `c${c}`) as [string, ...string[]],
                label: i18next.t("apgames:validation.emu.LABEL_DISCARD") || `Discard pile`,
                spacing: 0.25,
                width: 8,
            });
        }
        // create an area for all invisible cards (if there are any cards left)
        // start with `freshDeck` created at the top of this function
        // remove cards from the deck that are on the board, the discard, or in known hands
        const board = this.board.flat().flat();
        for (const uid of [...board, ...this.discard]) {
            freshDeck.remove(uid);
        }
        for (const hand of this.hands) {
            for (const uid of hand) {
                if (uid !== "") {
                    freshDeck.remove(uid);
                }
            }
        }
        const remaining = freshDeck.cards.sort(cardSortAsc).map(c => c.uid);
        if (remaining.length > 0) {
            areas.push({
                type: "pieces",
                label: i18next.t("apgames:validation.jacynth.LABEL_REMAINING") || "Cards in deck",
                spacing: 0.25,
                pieces: remaining.map(c => "c" + c) as [string, ...string[]],
                width: 8,
            });
        }

        // build the board
        const ox = 0; const oy = 0;
        const unit = EmuGame.BOARD_UNIT_DIMENSIONS;
        const halfUnit = unit * 0.5;
        const bufferInner = EmuGame.BOARD_UNIT_DIMENSIONS * 0.25;
        const bufferOuter = EmuGame.BOARD_UNIT_DIMENSIONS * 0.5;
        const rowsRed = 1 + this.board[0].length;
        const rowsBlue = 1 + this.board[1].length;
        const birdLengths = this.board.flat().map(h => h.length);
        let maxBirdCards = 1;
        if (birdLengths.length > 0) {
            maxBirdCards = 1 + Math.max(...birdLengths);
        }
        const playWidth =
            // outer buffer
            bufferOuter +
            // max number of bird cards plus one for the numbers
            ((1 + maxBirdCards) * unit) +
            // inner spacing between each column (except the first)
            ((maxBirdCards - 1) * bufferInner)
        const topHeight =
            // number of birds + newBird square
            (rowsRed * unit) +
            // inner spacing between each row
            ((rowsRed - 1) * bufferInner) +
            // bottom buffer
            bufferOuter;
        const botHeight =
            // top buffer
            bufferOuter +
            // number of birds + newBird square
            (rowsBlue * unit) +
            // inner spacing between each row
            ((rowsBlue - 1) * bufferInner);
        const deckWidth = unit + (bufferOuter * 2);
        const deckHeight = (2 * unit) + bufferInner;

        // console.log(JSON.stringify({unit, halfUnit, bufferInner, bufferOuter, rowsRed, rowsBlue, maxBirdCards, playWidth, topHeight, botHeight, deckWidth, deckHeight}, null, 2));

        const pieces: Freepiece[] = [];
        const markers: (MarkerFreespaceLabel|MarkerPath)[] = [];
        // deck/discard first
        const halfPlay = (topHeight + botHeight + unit + (bufferOuter * 2)) / 2;
        const halfDeck = deckHeight / 2;
        const deckTop = halfPlay - halfDeck;
        pieces.push({
            glyph: "deck",
            x: ox + bufferOuter + halfUnit,
            y: deckTop + halfUnit,
        });
        pieces.push({
            glyph: this.discard.length === 0 ? "discard" : ("c" + this.discard[this.discard.length - 1]),
            id: "discard",
            x: ox + bufferOuter + halfUnit,
            y: deckTop + unit + bufferInner + halfUnit,
        });

        // deck/discard labels
        markers.push({
            type: "label",
            label: "Deck",
            points: [
                {x: ox + (bufferOuter / 3), y: deckTop + unit},
                {x: ox + (bufferOuter / 3), y: deckTop},
            ]
        });
        markers.push({
            type: "label",
            label: "Discard",
            points: [
                {x: ox + (bufferOuter / 3), y: deckTop + unit + bufferInner + unit},
                {x: ox + (bufferOuter / 3), y: deckTop + unit + bufferInner},
            ]
        });

        // each play area with owner marks
        let currY = oy + bufferInner;
        for (const p of [1,2] as const) {
            // owner mark
            markers.push({
                type: "path",
                path: `M${deckWidth},${currY} v${p === 1 ? (topHeight - bufferOuter) : (botHeight - bufferOuter)}`,
                stroke: p,
                strokeWidth: 5,
            });
            currY += halfUnit;
            // birds
            for (let i = 0; i < this.board[p - 1].length; i++) {
                let currX = deckWidth + bufferOuter + halfUnit;
                // bird number
                pieces.push({
                    glyph: `birdNum${i+1}`,
                    x: currX,
                    y: currY,
                });
                currX += unit;
                // each card
                for (let j = 0; j < this.board[p - 1][i].length; j++) {
                    const card = this.board[p - 1][i][j];
                    pieces.push({
                        glyph: "c" + card,
                        x: currX,
                        y: currY,
                    });
                    currX += unit + bufferInner;
                }
                // plus sign (if it's the player's turn and they're the ones viewing)
                if (perspective === p && p === this.currplayer) {
                    pieces.push({
                        glyph: "new",
                        id: `bird${i+1}`,
                        x: currX,
                        y: currY,
                    });
                }
                currY += unit + bufferInner;
            }
            // new bird (if it's the player's turn and they're the ones viewing)
            if (perspective === p && p === this.currplayer) {
                pieces.push({
                    glyph: "new",
                    x: deckWidth + bufferOuter + halfUnit + unit,
                    y: currY
                });
            }
            // horizontal dividing line after the first player
            if (p === 1) {
                markers.push({
                    type: "path",
                    path: `M${deckWidth},${oy + topHeight + bufferOuter} h${playWidth}`,
                    strokeWidth: 5,
                });
                currY = oy + topHeight + (bufferOuter * 2);
            }
        }

        // add annotations
        const annotations: AnnotationFreespace[] = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    let piece: Freepiece|undefined;
                    if (move.where === "discard") {
                        piece = pieces.find(p => p.id === "discard");
                    } else if (move.how !== undefined) {
                        piece = pieces.find(p => p.glyph === "c" + move.how)
                    }
                    if (piece === undefined) {
                        // don't throw an error
                        // this can happen when ending a year and there's no intervening pass
                        // so just continue
                        continue;
                        // throw new Error(`Could not find the card to annotate (where: ${move.where}, how: ${move.how}).\n${JSON.stringify(pieces)}`);
                    }
                    const xStart = piece.x - halfUnit;
                    const yStart = piece.y - halfUnit;
                    annotations.push({
                        type: "path",
                        path: `M${xStart},${yStart} h${unit} v${unit} h${unit * -1} v${unit * -1}`,
                        dashed: [4],
                        fillOpacity: 0,
                    });
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "freespace",
            board: {
                width: deckWidth + playWidth,
                height: topHeight + botHeight + halfUnit,
                markers,
            },
            legend,
            pieces: pieces as Freepiece[],
            areas: areas.length > 0 ? areas : undefined,
            annotations: annotations.length > 0 ? annotations : undefined,
        };

        return rep;
    }

    public statuses(): IStatus[] {
        return [{ key: i18next.t("apgames:status.YEAR"), value: [this.year.toString()] }];
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
        ];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Year**: " + this.year + "\n\n";
        status += "**CurrPlayer**: " + this.currplayer + "\n\n";
        status += "**Scores**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place": {
                const context = r.where === "new" ? "new" : r.where === "discard" ? "discard" : "existing";
                node.push(i18next.t("apresults:PLACE.emu", {context, player, where: r.where, what: r.what}));
                resolved = true;
                break;
            }
            case "deckDraw":
                node.push(i18next.t("apresults:DECKDRAW.emu", {context: r.from, player, what: r.what}));
                resolved = true;
                break;
            case "declare":
                node.push(i18next.t("apresults:DECLARE.emu", {player, year: r.count}));
                resolved = true;
                break;
            case "deltaScore":
                node.push(i18next.t("apresults:DELTASCORE.emu", {context: r.description === "excuse" ? "excuse" : "score", player, delta: r.delta, ranks: r.description}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): EmuGame {
        return Object.assign(new EmuGame(), deepclone(this) as EmuGame);
    }
}
