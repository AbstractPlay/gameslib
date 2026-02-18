import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaButtonBar, AreaPieces, AreaKey, ButtonBarButton, Glyph, MarkerFlood, MarkerOutline, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Multicard, Multideck, cardSortAsc, cardsBasic, cardsExtended, suits } from "../common/decktet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type moveType = "B"|"D"|"S"|"A"|"T"|"P"|"C"|"E";

//Deeds: the column, up to three counts of added resources, and a hidden preferred suit (for resource collection).
export type DeedContents = {
    district: string,
    suit1: number,
    suit2?: number,
    suit3?: number,
    preferred?: string
};

const columnLabels = "abcdefghij".split("");
const moveTypes = ["B","D","S","A","T","P","C"];
const suitColors: string[] = ["#c7c8ca","#e08426","#6a9fcc","#bc8a5d","#6fc055","#d6dd40"];
const suitOrder = suits.map(suit => suit.uid); //["M","S","V","L","Y","K"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: [string[], string[][], string[][]];
    crowns: [number[], number[]];
    deeds: Map<string, DeedContents>[];
    discards: string[];
    hands: string[][];
    tokens: [number[], number[]];
    shuffled: boolean;
    roll: number[];
    choose: string[];
    lastmove?: string;
};

export interface IMagnateState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IMagnateMove {
    type: string;
    card?: string;
    district?: string;
    spend?: number[];
    suit?: string;
    incomplete?: boolean;
    valid: boolean;
}

export class MagnateGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Magnate",
        uid: "magnate",
        playercounts: [2],
        version: "20260218",
        dateAdded: "2026-02-18",
        // i18next.t("apgames:descriptions.magnate")
        description: "apgames:descriptions.magnate",
        // i18next.t("apgames:notes.magnate")
        notes: "apgames:notes.magnate",
        urls: [
            "http://wiki.decktet.com/game:magnate",
            "https://boardgamegeek.com/boardgame/41090/magnate",
        ],
        people: [
            {
                type: "designer",
                name: "Cristyn Magnus",
                urls: ["http://wiki.decktet.com/designer:cristyn-magnus"],
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        variants: [
            { uid: "courts", default: true }, //include courts
            { uid: "courtpawns" }, //courts for pawns
            { uid: "deucey" }, //ace scoring variant
            { uid: "mega" }, //double deck double hand 
            { uid: "stacked" }, //stacking the deck(s)
            { uid: "taxtax" }, //double taxation
        ],
        categories: ["goal>area", "goal>score>eog", "mechanic>place", "mechanic>economy", "mechanic>hidden", "mechanic>random>play", "board>none", "components>decktet"],
        flags: ["custom-randomization", "no-explore", "no-moves", "perspective", "scores"],
    };

    //The UI is quite simple because we only need to specify a column.
    public coord2algebraic(x: number): string {
        return columnLabels[x];
    }
    public algebraic2coord(district: string): number {
        return columnLabels.indexOf(district);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board: [string[], string[][], string[][]] = [[],[],[]];
    public crowns: [number[], number[]] = [[], []];
    public deeds!: [Map<string, DeedContents>,Map<string, DeedContents>];
    public discards: string[] = [];
    public hands: string[][] = [];
    public tokens: [number[], number[]] = [[], []];
    //public roll: number[] = [];
    public roll: number[] = [];
    public choose: string[] = [];
    public shuffled: boolean = false;
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private pawnrank: string = "P";
    private courtrank: string = "T";
    private districts: number = 5;
    private deck: Multideck[] = [];
    private highlights: string[] = []; //A mix of suit uids, card uids, and districts.

    constructor(state?: IMagnateState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            if (this.variants.includes("courtpawns")) {
                this.pawnrank = "T";
                this.courtrank = "P";
            }
            const deckCount = (this.variants.includes("mega") ? 2 : 1);
            const handCount = (this.variants.includes("mega") ? 6 : 3);

            if (this.variants.includes("mega"))
                this.districts = 9; //8 pawns plus the excuse

            // init board
            const board: [string[], string[][], string[][]] = [[],[],[]];

            const districtCards = [...cardsExtended.filter(c => c.rank.uid === this.pawnrank)]
            const districtDeck = new Multideck(districtCards, deckCount);
            districtDeck.shuffle();

            for (let d = 0; d < this.districts; d++) {
                if ( d === Math.round(this.districts / 2) - 1 ) {
                    board[0][d] = this.variants.includes("mega") ? "01" : "0"; //the Excuse
                } else {
                    const [card] = districtDeck.draw();
                    board[0][d] = card.uid;
                }
                //Also init player boards.
                board[1][d] = [];
                board[2][d] = [];
            }
            
            //init crowns and tokens
            const crowns: [number[], number[]] = [[0,0,0,0,0,0],[0,0,0,0,0,0]];
            const tokens: [number[], number[]] = [[0,0,0,0,0,0],[0,0,0,0,0,0]];
            
            const crownCards = [...cardsBasic.filter(c => c.rank.name === "Crown")];
            const crownDeck = new Multideck(crownCards, deckCount);
            crownDeck.shuffle();

            //initial roll
            const roll: number[] = this.roller();

            //Taxation and rank rolls have no impact on the first turn,
            //but we may have to process a Christmas roll.

            for (let c = 0; c < handCount; c++) {
                for (let p = 0; p < 2; p++) {
                    const [card] = crownDeck.draw();
                    const suit = card.suits.map(s => s.uid)[0];
                    crowns[p][suitOrder.indexOf(suit)]++;
                    //Could do this with the inappropriate function.
                    tokens[p][suitOrder.indexOf(suit)]++;
                    if (roll[0] === 10) {//Christmas!
                        //Could do this with the appropriate function.
                        tokens[p][suitOrder.indexOf(suit)]++;
                    }
                }
            }
            
            const deck = this.initDeck(deckCount);

            if ( this.variants.includes("mega") && this.variants.includes("stacked") ) {
                //The division process also shuffles (a lot).
                this.divideDeck(deck);
            } else {
                deck[0].shuffle();
            }

            const hands: [string[], string[]] = [[],[]];

            for (let h = 0; h < handCount; h++) {
                for (let p = 0; p < 2; p++) {
                    const drawDeckIdx = ( this.variants.includes("mega") && this.variants.includes("stacked") ) ? p + 1 : 0;
                    const [card] = deck[drawDeckIdx].draw();
                    hands[p][h] = card.uid;
                }
            }
            
            const fresh: IMoveState = {
                _version: MagnateGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                crowns,
                deeds: [new Map(), new Map()],
                discards: [],
                hands,
                tokens,
                roll,
                choose: [],
                shuffled: false
            };
            
            this.stack = [fresh];
            
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMagnateState;
            }
            if (state.game !== MagnateGame.gameinfo.uid) {
                throw new Error(`The Magnate engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.variants = state.variants;
        }
        this.load();
    }

    private divideDeck(deck: Multideck[]): void {
        //Divides a double draw deck (for the stacked deck variant, pre-shuffle).
        //Requires the deck argument because sometimes it's not yet this.deck.
        deck[1] = new Multideck([], 2);
        deck[2] = new Multideck([], 2);
        
        while (deck[0].size > 0) {
            const [card] = deck[0].draw() as Multicard[];
            if (card.deck === 1)
                deck[1].add(card.uid);
            else
                deck[2].add(card.uid);
        }
        return;
    }

    private initDeck(deckCount: number, forRender?: boolean): Multideck[] {
        //Init draw deck and hands.

        //Remove the crowns from the basic deck.
        const cards = [...cardsBasic.filter(c => c.rank.name !== "Crown")];

        //Usually add the courts.
        if (this.variants.includes("courts"))
            cards.push(...[...cardsExtended.filter(c => c.rank.uid === this.courtrank)]);
        
        if (forRender) {
            //Add the center row.
            cards.push(...[...cardsExtended.filter(c => c.rank.uid === this.pawnrank)]);
            cards.push([...cardsExtended.filter(c => c.rank.name === "Excuse")][0]);
        }

        return [new Multideck(cards, deckCount), new Multideck([], deckCount), new Multideck([], deckCount)];
    }

    private roller(): number[] {
        const d1 = randomInt(10);
        const d2 = randomInt(10);
        const rolled: number[] = [Math.max(d1, d2)];
        if (d1 === 1 || d2 === 1) {
            const t1 = randomInt(6);
            rolled.push(t1);
            if ( this.variants.includes("taxtax") ) {
                const t2 = randomInt(6);
                if (t1 !== t2)
                    rolled.push(t2);
            }
        }
        return rolled;
    }
    
    public load(idx = -1): MagnateGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as [string[], string[][], string[][]];
        this.crowns = [[...state.crowns[0]], [...state.crowns[1]]];
        this.deeds = [new Map(state.deeds[0]),new Map(state.deeds[1])];
        this.discards = [...state.discards];
        this.hands = state.hands.map(h => [...h]);
        this.tokens = [[...state.tokens[0]], [...state.tokens[1]]];
        this.shuffled = state.shuffled;
        this.roll = [...state.roll];
        this.choose = [...state.choose];
        this.lastmove = state.lastmove;

        if (this.variants.includes("courtpawns")) {
            this.pawnrank = "T";
            this.courtrank = "P";
        }

        if (this.variants.includes("mega"))
            this.districts = 9; //8 pawns plus the excuse

        // Deck is reset every time you load
        const deckCount = (this.variants.includes("mega") ? 2 : 1);
        this.deck = this.initDeck(deckCount);
        
        // remove cards from the deck that are on the board, the discard, or in known hands
        for (const uid of [...this.board[1].flat(), ...this.board[2].flat(), ...this.discards]) {
            this.deck[0].remove(uid);
        }

        for (const hand of this.hands) {
            for (const uid of hand) {
                if (uid !== "") {
                    this.deck[0].remove(uid);
                }
            }
        }

        this.deeds[0].forEach((value, key) => this.deck[0].remove(key));
        this.deeds[1].forEach((value, key) => this.deck[0].remove(key));

        if ( (!this.shuffled) && this.variants.includes("mega") && this.variants.includes("stacked") ) {
            //The division process also shuffles (a lot).
            this.divideDeck(this.deck);
        } else {
            this.deck[0].shuffle();
        }

        return this;
    }


    
    /* helper functions for general gameplay */

    private add2deed(card: string, spend: number[]): boolean {
        //Adds tokens to deeds.
        //Returns true if the deed is completed by the addition.
        const deed = this.deeds[this.currplayer - 1].get(card)!;
        const cardObj = Multicard.deserialize(card)!;
        const suitIdxs = cardObj.suits.map(s => s.seq - 1);
        const price = this.getPriceFromRank(cardObj.rank.seq);
        let paid = 0;
        let test = true;
        
        deed.suit1 += spend[suitIdxs[0]];
        paid += deed.suit1;
        test = (deed.suit1 > 0);
        if ( deed.suit2 !== undefined ) {
            deed.suit2 += spend[suitIdxs[1]];
            paid += deed.suit2;
            test = test && (deed.suit2 > 0);
            if ( deed.suit3 !== undefined ) {
                deed.suit3 += spend[suitIdxs[2]];
                paid += deed.suit3;
                test = test && (deed.suit3 > 0);
            }
        }
        
        return (test && paid === price);
    }

    private canDeed(card: string): boolean {
        //Test if currplayer can afford to deed the card.
        
        //We make the array version.
        const tokens = Array(6).fill(0);
        const cardObj = Multicard.deserialize(card)!;
        const suitIdxs = cardObj.suits.map(s => s.seq - 1);
        suitIdxs.forEach(suitIdx => tokens[suitIdx]++);

        return this.creditCheck(tokens, this.currplayer);
    }

    private canPay(card: string): boolean {
        //Test if currplayer can afford to build the card outright.
        
        //Check for the suit tokens with canDeed.
        if (! this.canDeed(card) ) {        
            return false;
        }

        const cardObj = Multicard.deserialize(card)!;
        const price = this.getPriceFromRank(cardObj.rank.seq);

        const suitIdxs = cardObj.suits.map(s => s.seq - 1);
        let reserves = 0;
        suitIdxs.forEach(suitIdx =>
            reserves += this.tokens[this.currplayer - 1][suitIdx]
        );

        return reserves >= price;
    }

    private canPlace(card: string, district: string): boolean {
        const col = this.algebraic2coord(district);
        
        //Check for a deeded card.
        if (this.hasDeed(district, this.currplayer)) {
            return false;
        }

        //Find the card to match.
        let matchMe = this.board[0][col];
        const myBoard = this.board[this.currplayer];
        if (myBoard[col].length > 0)
            matchMe = myBoard[col][myBoard[col].length - 1];

        //Check for suit mismatch.
        return this.matched(card, matchMe);
    }

    private card2tokens(card: string, type: string, highlight?: boolean): number[] {
        //Interpret the card as a cost or payment in suit tokens.
        //Results can vary by rank and by action type.
        const tokens = Array(6).fill(0);
        const cardObj = Multicard.deserialize(card)!;

        if (highlight)
            cardObj.suits.forEach(s => this.highlights.push(s.uid));
        
        const suitIdxs = cardObj.suits.map(s => s.seq - 1);
        suitIdxs.forEach(suitIdx => tokens[suitIdx]++);

        //For most purposes, a single suit token per suit
        // but Aces vary.
        if (cardObj.rank.name === "Ace") {
            if ( type === "B") {
                //Aces cost three tokens of the same suit.
                tokens[suitIdxs[0]] += 2;
            } else if ( type === "S") {
                //Aces pay out two tokens of the same suit.
                tokens[suitIdxs[0]]++;
            } //else if ( type === "D") {
                //Aces may be deeded for one token, though that's usually a bad idea.
                //No change to the existing array.
              //} 
        }

        return tokens;
    }
    
    private checkChange(card: string): string[] {
        //Returns exactly the tokens currplayer must spend to buy card,
        // that is, returns a partial or full payment for autocompletes.
        //Assumes canPay.
        
        const cardObj = Multicard.deserialize(card)!;
        
        //Sets correct "Court" cost, with exception for Aces.
        let price = this.getPriceFromRank(cardObj.rank.seq);

        const suitIdxs = cardObj.suits.map(s => s.seq - 1);
        const tokens = this.tokens[this.currplayer - 1].slice().map( (v, i) =>
            suitIdxs.indexOf(i) === -1 ? 0 : v);
        
        if ( tokens.reduce( (cur, acc) => cur + acc, 0) === price ) {
            //Can pay the whole price, but check distribution.
            if ( tokens.filter( v => v > 0 ).length === cardObj.suits.length )
                return this.unspender(tokens);
        }
        
        const spendy = Array(6).fill(0);

        //Required diversification.
        suitIdxs.forEach( (suitIdx) => {
            if ( tokens[suitIdx] > 0 ) {
                tokens[suitIdx]--;
                spendy[suitIdx]++;
                price--;
            } // else not a complete payment.
        });

        //Special case of 2.
        if ( cardObj.rank.seq === 2 ) {
            //May not be complete.
            return this.unspender(spendy);
        }
        
        const remaining = tokens.filter(v => v > 0);

        //Special cases of ace or paying the rest from a single suit.
        if (remaining.length === 1 || suitIdxs.length === 1) {
            suitIdxs.forEach( (suitIdx) => {
                spendy[suitIdx] += Math.min(price, tokens[suitIdx]);
            });
            return this.unspender(spendy);
        }

        //TODO: more partial payment improvements?
        
        return this.unspender(spendy);
    }
    
    private checkSpend(card: string, spend: number[], type: string): number {
        //Checks that an intermediate or final addition to a deed is legal,
        //or that an intermediate or final payment on a buy is legal.
        // Also prevent overpayment, addition of inapplicable suits,
        //  and additions that would prevent completing payment later.
        // DOES NOT prevent deeding a card and completing it 
        //  in the same turn,  even though no sane player would do that.

        //Return:
        // -1 for bad payments,
        //  0 for partial payment,
        //  1 for any addition that completes the deed or buy.

        const cardObj = Multicard.deserialize(card)!;
        
        //Sets correct "Court" cost, with exception for Aces.
        const price = this.getPriceFromRank(cardObj.rank.seq);

        const suitIdxs = cardObj.suits.map(s => s.seq - 1);
        const spendy = spend.slice();

        let sheltered = Array(6).fill(0);

        if (type === "A") {
            const deed = this.deeds[this.currplayer - 1].get(card)!;
            //reconstruct the sheltered array.
            sheltered = this.getDeedAsTokens(cardObj, deed);
        }
        
        let payment = 0;
        let numSuits = 0;
        suitIdxs.forEach( (suitIdx) => {
            payment += spendy[suitIdx] + sheltered[suitIdx];
            if (spendy[suitIdx] + sheltered[suitIdx] > 0)
                numSuits++;
            //Dock clone.
            spendy[suitIdx] = 0;
        });

        //Return the three logical values.
        
        if ( payment > price ) {
            //Overpaid.
            return -1;
        } else if ( payment === price && numSuits < suitIdxs.length ) {
            //Didn't hit all suits.
            return -1;
        } else if ( price - payment < suitIdxs.length - numSuits ) {
            //Cannot hit the remaining suits with the remaining tokens to be paid.
            return -1;
        } else if ( spendy.reduce( (acc, cur) => acc + cur, 0) > 0 ) {
            //Interloper suits.
            return -1;
        } else if ( payment < price ) {
            //So far, so good.
            return 0;
        } else if ( payment === price) {
            //The caller is responsible for closing out a deed.
            return 1;
        } else {
            //I don't know how you got here so...
            throw new Error("Unexpected fallthrough in checkSpend().");
        }
    }
    
    private collectOn(rank: number, player: playerid, isRoller: boolean): number[] {
        //Credits the player for the rolled rank.
        //Also returns the token string of credits for logging.
        
        let tokens = Array(6).fill(0);
        const p = player - 1;
        //Special ranks:
        if (rank === 10) {
            //Crownmas for everyone.
            tokens = this.crowns[p];
            //          for (const suit in this.crowns[p])
            //             tokens[suitOrder.indexOf(suit)]++;
        } else {
            const board = this.board[player];
            for (let d = 0; d < this.districts; d++) {
                for (let c = 0; c < board[d].length; c++) {
                    const card = board[d][c];
                    if (card[0] === rank.toString()) {
                        //Correct rank, so collect the suits.
                        tokens[suitOrder.indexOf(card[1])]++;
                        if (rank > 1) {
                            tokens[suitOrder.indexOf(card[2])]++;
                        }
                    }
                }
            }
            const deeds = this.deeds[player - 1];
            for (const [card, deed] of deeds) {
                if (card[0] === rank.toString()) {
                    //Correct rank, so collect a suit.
                    if (rank === 1) //Xtreme corner case.
                        tokens[suitOrder.indexOf(card[1])]++;
                    else if (isRoller)
                        this.choose.push(card);
                    else if (deed.preferred) //Player set a preference.
                        tokens[suitOrder.indexOf(deed.preferred)]++;
                    else {
                        const suit = this.suitPicker(card, player);
                        tokens[suitOrder.indexOf(suit)]++;
                    }
                }
            }
        }
        this.credit(tokens, player);
        
        return tokens;
    }

    private createDeed(card: string, district: string): void {
        //Creates a deed and adds it to the map.
        const deed: DeedContents = {
            district: district,
            suit1: 0
        }

        //Need the other suits to finish the deed.
        const cardObj = Multicard.deserialize(card)!;
        if (cardObj.suits.length > 1) {
            deed.suit2 = 0;
            if (cardObj.suits.length === 3 ) 
                deed.suit3 = 0;
        }
        
        this.deeds[this.currplayer - 1].set(card, deed);
        return;
    }

    private credit(tokenArray: number[], player: playerid): boolean {
        //Debits and credits are forumlated as arrays of 6 numbers.
        //Credits should never fail.
        return this.edit(1, tokenArray, player);
    }

    private credit1(suit: string, player: playerid): boolean {
        //Wrapper function for trades.
        const tokenArray: number[] = Array(6).fill(0);
        tokenArray[suitOrder.indexOf(suit)]++;
        return this.credit(tokenArray, player);
    }

    private creditCheck(tokenArray: number[], player: playerid): boolean {
        //Check the player can pay without debiting.
        const playerIdx = player - 1;
        const tokens = this.tokens[playerIdx];

        if (tokens.filter( (value, index) => tokenArray[index] > value ).length > 0)
            return false;
        else
            return true;
    }
    
    private debit(tokenArray: number[], player: playerid): boolean {
        //Debits and credits are forumlated as arrays of 6 numbers.
        return this.edit(-1, tokenArray, player);
    }

    private drawUp(): void {
        //First, try to draw what we need from the deck.
        const toDraw = this.variants.includes("mega") ? 2 : 1;

        const drawDeckIdx = ( (! this.shuffled) && this.variants.includes("mega") && this.variants.includes("stacked") ) ? this.currplayer : 0;
       
        let drawn = this.deck[drawDeckIdx].draw(Math.min(this.deck[drawDeckIdx].size, toDraw)).map(c => c.uid);

        drawn.forEach(c => this.hands[this.currplayer - 1].push(c));
        
        if (drawn.length === toDraw)
            return;

        const stillToDraw = toDraw - drawn.length;

        if (this.shuffled) {
            return;
        } else {
            //Can shuffle the discards, once.
            this.discards.forEach( card => {
                this.deck[0].add(card);
            });
            this.discards = [];
            this.deck[0].shuffle();

            this.shuffled = true;
            this.results.push({type: "deckDraw"});

            //Draw the rest.
            drawn = this.deck[0].draw(Math.min(this.deck[0].size, stillToDraw)).map(c => c.uid);
            drawn.forEach(c => this.hands[this.currplayer - 1].push(c));
        }
        return;
    }

    private edit(operation: number, tokenArray: number[], player: playerid): boolean {
        //Debits and credits are forumlated as arrays of 6 numbers.
        const playerIdx = player - 1;
        const tokens = this.tokens[playerIdx];

        if (operation === -1) {
            //Test before editing.  There is no going into debt in Magnate.
            if (tokens.filter( (value, index) => tokenArray[index] > value ).length > 0)
                return false;
        }

        //Safe to edit.
        tokens.forEach((value, index) => {
            tokens[index] = value + (tokenArray[index] * operation);
        });
            
        return true;
    }

    private getDeedAsTokens(card: Multicard, deed: DeedContents): number[] {
        //Convert deed format into a token payment array.
        const sheltered = Array(6).fill(0);

        const suitIdxs = card.suits.map(s => s.seq - 1);

        sheltered[suitIdxs[0]] = deed.suit1;

        if ( deed.suit2 !== undefined ) {
            sheltered[suitIdxs[1]] = deed.suit2;

            if ( deed.suit3 !== undefined ) {
                sheltered[suitIdxs[2]] = deed.suit3;
            }
        }
        
        return sheltered;
    }

    private getDeedCard(district: string, player: playerid): string {
        //Check if a district has a deed.
        //Inefficient, but in practice there should only be a handful to check.
        let deeded = "";
        this.deeds[player - 1].forEach((deed, key) => {
            if (deed.district === district)
                deeded = key;
        }); 

        return deeded;
    }

    private getPriceFromRank(rank: number): number {
        //Sets correct "Court" cost with exception for Aces.
        //Rank is of the type/form card.rank.seq.
        return rank === 1 ? 3 : Math.ceil(rank) ;
    }
    
    private getRandomPayment(card: string, full?: boolean): string {
        //Construct a full or partial payment for use in random moves.
        //It may not qualify as a deed payment so don't rely on success.
        
        const cardObj = Multicard.deserialize(card)!;
        
        const payment: string[] = [];
        const resources = this.tokens[this.currplayer - 1].slice();

        const price = this.getPriceFromRank(cardObj.rank.seq);

        const suits = cardObj.suits.map(s => s.uid);

        //Guarantee of suit coverage for buys.
        suits.forEach(s => {
            if (resources[suitOrder.indexOf(s)] > 0) {
                payment.push(s);
                resources[suitOrder.indexOf(s)]--;
            }
        });

        if ( full && payment.length < price ) {
            //We may have already paid in full.
            while (payment.length < price) {
                //Select a random suit and push if available.
                const randi = randomInt(suits.length) - 1;
                const suit = suits[randi];
                if (resources[suitOrder.indexOf(suit)] > 0) {
                    payment.push(suit);
                    resources[suitOrder.indexOf(suit)]--;
                }
            }
        }

        return payment.join(",");
    }

    private hasDeed(district: string, player: playerid): boolean {
        //Check if a district has a deed.
        return (this.getDeedCard(district, player) !== "");
    }

    private matched(card1: string, card2: string): boolean {
        const c1 = Multicard.deserialize(card1);
        const c2 = Multicard.deserialize(card2);
        
        //This shouldn't happen.
        if (c1 === undefined || c2 === undefined)
            return false;

        //This should only happen in a particular order but whatevs.
        if (c1.rank.name === "Excuse" || c2.rank.name === "Excuse")
            return true;
        
        return c1.sharesSuitWith(c2);
    }

    public parseMove(submove: string): IMagnateMove {
        //Parse a submove (single action) into an IMagnateMove object.
        //Does only structural validation.
        //Expects at leat a choice of move type (X:).

        //Because the Excuse and Crowns don't appear in moves, 
        // the card format is: 
        const cardex = /^(\d?[A-Z]{1,2}[1-2]?||[A-Z]{4}[1-2]?)$/;
        //The cell format is: 
        const cellex = /^[a-j]$/;
        //The suit format is: 
        const suitex = /^[MSVLYK][2-8]?$/;
        //A regex to check for illegal characters is:
        const illegalChars = /[^A-Za-n1-9:,]/;

        //The move formats depend on the main action:
        // Buy:    card, district, spend
        // Deed:   card, district
        // Sell:   card
        // Add:    card, spend
        // Trade:  suit, suit
        // Prefer: card, suit
        // Choose: card, suit
        // Error:  for internal use only

        const mm: IMagnateMove = {
            type: "E",
            valid: false
        }

        //Once we have a legit type we can default to valid = true.
        
        //Incomplete starts out undefined.
        //A partial submove that can't be submitted is set to incomplete.

        //Check for legal characters.
        if (illegalChars.test(submove)) {
            mm.valid = false;
            return mm;
        }

        let card, district, suit: string;

        //Next, split the string on type.
        const typed = submove.split(/:/);

        if (typed.length < 2) {
            //Malformed move string.  We require at least X:
            mm.valid = false;
            return mm;
        }

        //Next, test the type.
        const type = typed[0];
        if (moveTypes.indexOf(type) < 0) {
            //Malformed move string.  We require at least X:
            mm.valid = false;
            return mm;
        } else {
            mm.type = type;
            mm.valid = true;
        }

        //That may be everything.
        if (typed[1] === "") {
            mm.incomplete = true;
            return mm;
        }

        //Split the remaining items.
        
        const split = typed[1].split(",");

        if ( split[0] === "" ) {
            //Malformed move string.  We require at least X:
            mm.valid = false;
            return mm;
        }
        
        //The only case without a card.
        if (type === "T") {
            const value = split.shift()!;
            if (! suitex.test(value) ) {
                //Malformed suit string.
                mm.valid = false;
                return mm;
            } else {
                mm.spend = this.spender([value]);
            }
        } else {
            card = split.shift()!;
            if (! cardex.test(card) ) {
                //Malformed card.
                mm.valid = false;
                return mm;
            } else {
                mm.card = card;
            }
        }

        //The only case without more info.
        if ( type === "S" ) {
            mm.incomplete = false;
            return mm;
        } else if ( split.length === 0 || split[0] === "" ) {
            mm.incomplete = true;
            return mm;
        }

        //The district cases.
        if ( type === "B" || type === "D" ) {
            district = split.shift()!;
            if (! cellex.test(district) ) {
                //Malformed district.
                mm.valid = false;
                return mm;
            } else {
                mm.district = district; 
            }
        } else if ( type === "T" || type === "P" || type === "C" ) {
            //The suit cases har har.
            suit = split.shift()!;
            if (! suitex.test(suit) ) {
                //Malformed suit.
                mm.valid = false;
                return mm;
            }  else {
                mm.suit = suit; 
            }
        } //Skipping add for a minute.

        if ( type === "D" || type === "T" || type === "P" || type === "C" ) {
            //These cases are now complete.
            mm.incomplete = false;
            return mm;
        }

        //Only tokens left...if that.
        if ( split.length === 0 || split[0] === "" ) {
            mm.incomplete = true;
            return mm;
        }

        if ( split.filter(s => ! suitex.test(s)).length > 0 ) {
            //Malformed suit.
            mm.valid = false;
            return mm;
        }

        //amalgamapping the spend
        mm.spend = this.spender(split);
        
        //Finished buy and add cases.
        mm.incomplete = false;
        return mm;
    }
    
    public pickleMove(pact: IMagnateMove): string {
        //Pickle is how the cool kids say "serialize".
        //Cycling through parseMove and pickleMove is handy
        // for making the submove string shorter.

        //Expects a legal parsed move.
        if (pact.valid === false) {
            throw new Error("Cannot reserialize an invalid move object.");
        }
        
        if (pact.type === undefined || moveTypes.indexOf(pact.type) < 0) {
            throw new Error("Could not reserialize the move object: missing type.");
        }

        let move = pact.type + ":";

        //The move formats depend on the main action:
        // Buy:    card, district, spend
        // Deed:   card, district
        // Sell:   card
        // Add:    card, spend
        // Trade:  spend, suit
        // Prefer: card, suit
        // Choose: card, suit
        // Error:  for internal use only
        
        if (pact.card)
            move += pact.card;
        else if (pact.spend) {
            move += this.unspender(pact.spend).join(",");
            if (pact.suit)
                move += "," + pact.suit;
            return move;
        } else {
            //assume incomplete rather than in error.
            return move;
        }

        //If we're here, we have a card.
        if (pact.district)
            move += "," + pact.district;
        
        if (pact.spend)
            move += "," + this.unspender(pact.spend).join(",");
        else if (pact.suit) 
            move += "," + pact.suit;

        return move;
    }

    private placeCard(card: string, district: string): void {
        const col = this.algebraic2coord(district);
        this.board[this.currplayer][col].push(card);
        return;
    }
    
    private removeCard(card: string, arr: string[]): boolean {
        //Remove a card from an array.
        //It's up to the caller to put the card somewhere else.
        const index = arr.indexOf(card);
        if (index > -1) {
            arr.splice(index, 1);
            return true;
        } //else...
        return false;
    }
    
    private spender(values: string[]): number[] {
        //Parses a pre-split spend into a token array.
        const spend: number[] = Array(6).fill(0);

        values.forEach(value => {
            const suit = value[0];
            const quantity = value.length > 1 ? parseInt(value[1],10) : 1;
            spend[suitOrder.indexOf(suit)] += quantity;
        });
 
        return spend;
    }

    private splitMove(move: string): string[] {
        //Parses a pre-split move into an action array without empties.
        const actions = move.split("/");

        if (actions[actions.length - 1] === "") {
            //Trim the dummy move.
            //Could also test that the last character of move first.
            actions.length--;
        }

        return actions;
    }
    
    private suitPicker(card: string, player: playerid): string {
        const choices = [card[1], card[2]];
        const crowns = suitOrder.filter((s,i) => this.crowns[player - 1][i] > 0);

        const notMyCrowns = choices.filter( s => crowns.indexOf(s) < 0 );
        if (notMyCrowns.length === 1)
            return notMyCrowns[0];

        const choiceCounts = choices.map( s => this.tokens[player - 1][suitOrder.indexOf(s)] );
        if (choiceCounts[1] > choiceCounts[0])
            return choices[0];
        else
            return choices[1];
    }
    
    private unspender(tokenArray: number[]): string[] {
        //Parses a token array into a pre-split spend.
        const spend: string[] = [];

        tokenArray.forEach((value, index) => {
            if (value > 0) {
                const suit = suitOrder[index];
                const quantity = (value === 1 ? "" : value.toString());
                spend.push(`${suit}${quantity}`);
            }
        });
 
        return spend;
    }

    
    //Not autopassing (or passing) so don't need a moves function?
    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }

        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        let move: string = "";

        if (this.gameover)
            return move;

        const cloned = Object.assign(new MagnateGame(), deepclone(this) as MagnateGame);
        const usedCardCount = (cloned.variants.includes("mega") ? 2 : 1);
        const leverageCount = usedCardCount * 2 + 1;

        let premove = "";
        for (const choice of cloned.choose) {
            const suit = cloned.suitPicker(choice, cloned.currplayer);
            cloned.tokens[cloned.currplayer - 1][suitOrder.indexOf(suit)]++;
            premove += "C:" + choice + "," + suit + "/";
        }
        cloned.choose = [];

        //We can generate a sensible move from the player's hand, if we sort it.
        const sortedHand = cloned.hands[this.currplayer - 1].slice().sort((a,b) => parseInt(b[0]) - parseInt(a[0]));
        
        let card = "";
        for ( let m = 0; m < usedCardCount; m++ ) { 
            //Don't pick a random index; try to build or deed a card.
            //Failing that, sell a card and try to pay on a deed.
            //But don't get over leveraged.
            const leverage = leverageCount - cloned.deeds[cloned.currplayer - 1].size;
            
            let submove = "";
            for (let c = 0; c < sortedHand.length; c++) {
                card = sortedHand[c];
                
                //Test if the card can be placed.
                for (let d = 0; d < cloned.districts; d++) {
                    if (submove === "" && m === 0) {
                        const dist = cloned.coord2algebraic(d);
                        if (cloned.canPlace(card, dist)) {
                            if ( cloned.canPay(card) ) {
                                // If we can deed a 2 we can pay for it, so doesn't try to deed one.
                                const payment = cloned.getRandomPayment(card, true);
                                submove = "B:" + card + "," + dist + "," + payment;
                                //Need to remove the card and spend the tokens for the next step.
                                sortedHand.splice(c,1);

                                const tokenArray = cloned.spender(payment.split(","));
                                cloned.debit(tokenArray, cloned.currplayer);
                                
                            } else if (cloned.canDeed(card) && leverage > 0) {
                                submove = "D:" + card + "," + dist;
                                //Need to remove the card and spend the tokens for the next step.
                                sortedHand.splice(c,1);
                                const spend = cloned.card2tokens(card, "D");
                                cloned.debit(spend, cloned.currplayer);

                                
                            } //else move is unchanged and we continue.
                        }
                    }
                }
            }

            //If we fell through, we sell the "final" card.
            //We always sell for our second move in mega
            //so we don't have to do extensive clone support.
            if (submove === "") {
                card = sortedHand.pop()!;
                submove = "S:" + card;
                //Nice to collect on card for the next step.
                const profit = cloned.card2tokens(card, "S");
                cloned.credit(profit, cloned.currplayer);
            }
            
            
            //In all cases, we also attempt to pay on a deed.
            let subsubmove = "";
            
            for (let d = 1; d <= cloned.districts; d++) {
                if (subsubmove === "") {
                    const deedCard = cloned.getDeedCard(cloned.coord2algebraic(d), cloned.currplayer);
                    
                    if (deedCard) {
                        const spend = cloned.getRandomPayment(deedCard, false);
                        subsubmove = "A:" + deedCard + "," + spend;
                        
                        //Manually validate here.
                        const validationObj = cloned.validateMove(submove + "/" + subsubmove);
                        const parsedSS = cloned.parseMove(subsubmove);
                        if (validationObj.valid === false || parsedSS.incomplete === true) { 
                            subsubmove = "";
                        } else {
                            const tokenArray = cloned.spender(spend.split(","));
                            cloned.debit(tokenArray, cloned.currplayer);
                            //Credit the cloned deed to prevent errors in mega.
                            cloned.add2deed(deedCard, tokenArray);
                        }
                    }
                }
            }
            
            move += (move === "" || move.slice(-1) === "/" ? "" : "/") + submove + "/" + subsubmove;
        }
        
        return premove + move;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        //First click should be on a move button.
        //Subsequent clicks should be:
        // * hand card > district > tokens (if not autocompleted)
        // * hand card > district (deeds)
        // * hand card (sales)
        // * deed card > add tokens
        // * token pile > token pile (for trades)
        // * deed card > preferred or chosen suit
        
        try {
            let newmove = "";
            // clicking on hand pieces or token pieces.
            if (row < 0 && col < 0) {
                if ( piece?.startsWith("_btn_")) {
                    const type = piece.split("_")[2].charAt(0);
                    if ( move && move.endsWith(":") )  //Reset type.
                        newmove = `${move.substring(0,move.length - 2)}${type}:`;
                    else if (move) {//Next action.
                        const submoves = this.splitMove(move);
                        const subparse = this.parseMove(submoves[submoves.length - 1]);
                        if ( subparse.incomplete === true ) {
                            return {
                                move,
                                valid: false,
                                message: i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION")
                            }
                        } else if (move.slice(-1) === "/") {
                            //Still can fail to be a complete buy payment,
                            // but it's too difficult to detect here.
                            newmove = `${move}${type}:`;
                        } else {
                            newmove = `${move}/${type}:`;
                        }
                    } else //First action.
                        newmove = `${type}:`;
                } else if (!move) {
                    //it's too early to click on other stuff.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.magnate.INITIAL_BUTTON_INSTRUCTIONS")
                    }
                } else if ( piece?.startsWith("k") && move.endsWith(":") ) {
                    //clicking a hand card for buy/deed/sell.
                    const card = piece.split("k")[1];
                    newmove = `${move}${card}`; 
                } else if ( piece?.startsWith("k") ) {
                    //Too late to choose a hand card.
                    //Just ignore it.
                } else if (piece?.startsWith("s")) {
                    //clicking a suit token.
                    const suit = piece.charAt(1);
                    if ( move && move.endsWith(":") ) {
                        //Assume it's a trade.
                        newmove = `${move}${suit}3`; 
                    } else {
                        const submoves = this.splitMove(move);
                        const pmv = this.parseMove(`${submoves.pop()},${suit}`);
                        if (pmv.valid === true)
                            newmove = submoves.join("/") + (submoves.length > 0 ? "/" : "") + this.pickleMove(pmv);
                        else {
                            //Default message.
                            let message = i18next.t("apgames:validation.magnate.INVALID_MOVE", {move: newmove});

                            //Common mistake.
                            if ( (pmv.type === "B" || pmv.type === "D") && pmv.district === undefined )
                                message = i18next.t("apgames:validation.magnate.DISTRICT_INSTRUCTIONS");

                            return {
                                move,
                                valid: false,
                                message: message
                            }
                        }
                    }
                } 
            } else {
                // otherwise, clicked on the board
                if (!move) {
                    //it's too early to click on other stuff.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.magnate.INITIAL_BUTTON_INSTRUCTIONS")
                    }
                } else if (move && move.endsWith("/")) {
                    //it's too early to click on other stuff.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.magnate.BUTTON_INSTRUCTIONS")
                    }
                } else if ( piece?.startsWith("k") && move.endsWith(":") ) {
                    //clicking a deed card
                    const card = piece.split("k")[1];
                    newmove = `${move}${card}`;
                } else if ( piece?.startsWith("k") ) {
                    //clicking a board card, which in this case we interpret as its district.
                    const district = this.coord2algebraic(col);
                    newmove = `${move},${district}`;
                } else if (move && move.endsWith(":")) {
                    //it's too early to click on a district,
                    //unless you misclicked a card.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.magnate.DEEDED_CARD_INSTRUCTIONS")
                    }
                } else {
                    const district = this.coord2algebraic(col);
                    newmove = `${move},${district}`;
                }
            }
            
            let result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if (result.autocomplete !== undefined) {
                    //Internal autocompletion.
                    const automove = result.autocomplete;
                    result = this.validateMove(automove) as IClickResult;
                    result.move = automove;
                } else {
                    result.move = newmove;
                }
                return result;
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

        if (this.gameover) {
            if (m.length === 0) {
                result.message = "";
            } else {
                result.message = i18next.t("apgames:MOVES_GAMEOVER");
            }
            return result;
        }

        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.magnate.INITIAL_BUTTON_INSTRUCTIONS")
            return result;
        }

        //If the move is complicated, we need a clone here.
        const cloned = Object.assign(new MagnateGame(), deepclone(this) as MagnateGame);

        const moves: string[] = cloned.splitMove(m);
        const cards2use = cloned.variants.includes("mega") ? 2 : 1;
        let usedCards = 0;

        for (let s = 0; s < moves.length; s++) {
            const action = moves[s];
/*            //Trim any dangling commas.
            if (action[action.length - 1] === ",")
                action = action.substring(0,action.length - 1);
*/
            const isLast = s === moves.length - 1;

            //Parse.
            const pact = cloned.parseMove(action);
            if (pact.valid === false) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.magnate.INVALID_MOVE", {move: action});
                return result;
            }

            //New ordering requirement.
            if (cloned.choose.length > 0 && pact.type !== "C") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.magnate.MUST_CHOOSE");
                return result;
            }

            //Low-hanging fruit.
            if (pact.type === "T") {
                if (pact.spend === undefined) {
                    if (isLast) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.magnate.SPEND_INSTRUCTIONS");
                        return result;
                    } else {
                        //Return error if this is not the final, incomplete action.
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                        return result;
                    }
                }
                //TODO: Would be quicker to change debit to return success or failure.
                //Credit should always succeed.
                const suitIndex = pact.spend.indexOf(3);
                if (suitIndex < 0 || pact.spend.reduce((cur,acc) =>
                    cur + acc, 0) !== 3 ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.magnate.MALFORMED_TRADE");
                    return result;
                } else if ( cloned.tokens[cloned.currplayer - 1][suitIndex] < 3 ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.magnate.INVALID_TRADE");
                    return result; 
                }

                //Dock the cloned user (for subsequent submove validation).
                cloned.debit(pact.spend,cloned.currplayer);

                if (pact.suit === undefined) {
                    if (isLast) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.magnate.TOKEN_TRADE_INSTRUCTIONS");
                        return result;
                    } else {
                        //Return error if this is not the final, incomplete action.
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                        return result;
                    }
                }
                    

                //Credit the user (for subsequent submove validation).
                cloned.credit1(pact.suit, cloned.currplayer);
                
            } else {//In all other cases we should have a card.
                if (pact.card === undefined) {
                    if (isLast) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;

                        if (pact.type ===  "A" || pact.type === "P") {
                            result.message = i18next.t("apgames:validation.magnate.DEEDED_CARD_INSTRUCTIONS");
                        } else if (pact.type === "C") {
                            if (cloned.choose.length === 1)
                                result.autocomplete = m + cloned.choose[0];
                            result.message = i18next.t("apgames:validation.magnate.CHOICE_BUTTON_INSTRUCTIONS");
                        } else {
                            result.message = i18next.t("apgames:validation.magnate.HAND_CARD_INSTRUCTIONS");
                        }
                        
                        return result;
                    } else {
                        //Return error if this is not the final, incomplete action.
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                        return result;
                    }
                }

                if ( pact.type === "A" || pact.type === "P" || pact.type === "C" ) {
                    //Card must be already deeded.
                    if (! cloned.deeds[cloned.currplayer - 1].has(pact.card)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.NOT_DEEDED");
                        return result; 
                    } //nothing is done to the card per se
                    
                } else if ( pact.type === "B" || pact.type === "D" || pact.type === "S" ) {

                    if ( cloned.hands[cloned.currplayer - 1].indexOf(pact.card) < 0 ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.NOT_IN_HAND");
                        return result; 
                    } else if ( usedCards === cards2use ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.INVALID_ACTION");
                        return result;
                    } else {
                        //We can remove the card now (for ongoing validation).
                        cloned.removeCard(pact.card, cloned.hands[cloned.currplayer - 1]);
                        usedCards++;
                    }
                }
                        

                //We pause for a corner case.
                if ( pact.type === "D" && pact.card[0] === "2" ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.magnate.INVALID_DEED_TWO");
                    return result; 
                }

                //In all remaining cases we need to know the card's suits.
                //We get them in an array format.
                const tokens = this.card2tokens(pact.card, pact.type);
 
                if ( pact.type === "P" || pact.type === "C" ) {
                    if ( pact.suit === undefined ) {
                        if (isLast) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            if (pact.type === "P")
                                result.message = i18next.t("apgames:validation.magnate.PREFER_SUIT_INSTRUCTIONS");
                            else
                                result.message = i18next.t("apgames:validation.magnate.CHOOSE_SUIT_INSTRUCTIONS");
                            return result;
                        } else {
                            //Return error if this is not the final, incomplete action.
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                            return result;
                        }
                    } else {
                        //Test suit against card using tokens.
                        const suitIdx = suitOrder.indexOf(pact.suit);
                        if ( tokens[suitIdx] === 0 ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.magnate.INVALID_SUIT");
                            return result; 
                        } else {
                            if (pact.type === "P") {
                                //We set the preference and display it.
                                const deed = cloned.deeds[cloned.currplayer - 1].get(pact.card)!;
                                deed.preferred = pact.suit;
                            } else {
                                //We credit the chosen token for future validation.
                                cloned.tokens[cloned.currplayer - 1][suitOrder.indexOf(pact.suit)]++;
                                cloned.removeCard(pact.card, cloned.choose);
                            }
                        }
                    }
                }
                
                if ( pact.type === "S" ) {
                    //We're done. Credit (for ongoing validation).
                    cloned.credit(tokens, cloned.currplayer);
                }

                if ( pact.type === "B" || pact.type === "D" ) {
                    //Need to check the district.
                    if (! pact.district ) {
                        if (isLast) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.magnate.DISTRICT_INSTRUCTIONS");
                            return result;
                        } else {
                            //Return error if this is not the final, incomplete action.
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                            return result;
                        }
                    } else if (! cloned.canPlace(pact.card, pact.district) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.magnate.INVALID_PLACEMENT");
                        return result; 
                    }   //The district is good.  Place 
                        
                    if ( pact.type === "D" ) {
                        //Test if we're done.
                        if (! cloned.debit(tokens, cloned.currplayer) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.magnate.INVALID_DEED_PAYMENT");
                            return result; 
                        } else {
                            //Debited and districted.  Need a deed.
                            cloned.createDeed(pact.card, pact.district);
                        }
                    }
                }

                //Lastly, the (variably) spendy actions. (B, A)
                //Check there's a spend.
                if ( pact.type === "A" || pact.type === "B" ) {
                    if ( pact.spend === undefined ) {
                        if (isLast) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            if (pact.type === "B")
                                result.autocomplete = m + "," + cloned.checkChange(pact.card).join(",");
                            result.message = i18next.t("apgames:validation.magnate.SPEND_INSTRUCTIONS");
                            return result;
                        } else {
                            //Return error if this is not the final, incomplete action.
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                            return result;
                        }
                    } else {

                        const success = cloned.checkSpend(pact.card, pact.spend, pact.type);

                        if ( success < 0 ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.magnate.INVALID_PAYMENT");
                            return result; 
                        } else {

                            //Attempt to dock the spent tokens here.
                            if (! cloned.debit(pact.spend, cloned.currplayer) ) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.magnate.INVALID_OTHER_PAYMENT");
                                return result;
                            } //else spent successfully and can post-process.
                            
                            if (success < 1) {
                            
                                if ( pact.type === "B" ) {
                                    if (isLast) {
                                        //Return incomplete for a buy.
                                        result.valid = true;
                                        result.complete = -1;
                                        result.canrender = true;
                                        result.message = i18next.t("apgames:validation.magnate.SPEND_INSTRUCTIONS");
                                        return result;
                                    } else {
                                        //Return error if this is not the final, incomplete action.
                                        result.valid = false;
                                        result.message = i18next.t("apgames:validation.magnate.INCOMPLETE_ACTION");
                                        return result;
                                    }
                                } else if ( pact.type === "A" ) {
                                    //Augment the deed.
                                    cloned.add2deed(pact.card, pact.spend);                                }
                            
                            } else {//success === 1

                                const district = pact.type === "B" ? pact.district : cloned.deeds[cloned.currplayer - 1].get(pact.card)!.district;

                                // Place real card.
                                cloned.placeCard(pact.card, district!);

                                if ( pact.type === "A" ) {
                                    // Remove deed.
                                    cloned.deeds[cloned.currplayer - 1].delete(pact.card);
                                }
                            }
                        }
   
                    }//end payment processing

                }//end spend cases
                
            }//end card cases
            
        }//End actions.

        // we're good!
        result.valid = true;
        result.canrender = true;
        
        if (usedCards < cards2use) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.magnate.BUTTON_INSTRUCTIONS");
        } else {
            //A turn is never complete, only submissible.
            result.complete = 0;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
        
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): MagnateGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        //m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && ( result.complete === undefined || result.complete < 0) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];

        if (this.stack.length === 1) {
            //Need to log the initial roll.
            this.results.push({type: "roll", values: [this.roll[0]], who: this.currplayer});
            if (this.roll[0] === 10)
                this.results.push({type: "claim", how: "crowns"});
        };

        const actions = this.splitMove(m);

        for (const action of actions) {
            const pact = this.parseMove(action);
            this.highlights = [];

            //Spend first, other stuff later.
            if (pact.spend !== undefined) {
                this.debit(pact.spend, this.currplayer);
            }
            
            //Low-hanging fruit.
            if (pact.type === "T") {
                if (pact.spend !== undefined && pact.suit !== undefined) {
                    this.credit1(pact.suit, this.currplayer);
                    this.results.push({
                        type: "convert",
                        what: suitOrder[pact.spend.indexOf(3)],
                        into: pact.suit
                    });
                }
            }//end trade type
            
            if ( pact.card ) {

                if ( pact.type === "B" || pact.type === "D" || pact.type === "S" ) {
                    //Card consumption types.
                    const tokens = this.card2tokens(pact.card, pact.type, true);

                    if (pact.type === "S") {
                        this.discards.push(pact.card);
                        this.removeCard(pact.card, this.hands[this.currplayer - 1]);
                        this.highlights.push(pact.card);

                        //Profit!
                        this.credit(tokens, this.currplayer);
                        
                        this.results.push({
                            type: "place",
                            what: pact.card,
                            where: "discards",
                            who: this.currplayer
                        });

                    } else if (pact.district) {
                        
                        if (pact.type === "D") {
                            //Create a deed.
                            this.createDeed(pact.card, pact.district);
                            this.debit(tokens, this.currplayer);
                            this.removeCard(pact.card, this.hands[this.currplayer - 1]);

                            //Shared result type
                            this.results.push({
                                type: "place",
                                what: pact.card,
                                where: pact.district,
                                how: pact.type,
                                who: this.currplayer
                            });
                            
                        } else if (pact.type === "B") {
                            //Place the card.
                            this.placeCard(pact.card, pact.district);
                            this.removeCard(pact.card, this.hands[this.currplayer - 1]);

                            if (pact.spend !== undefined) {
                                //Shared result type
                                this.results.push({
                                    type: "place",
                                    what: pact.card,
                                    where: pact.district,
                                    how: pact.type,
                                    who: this.currplayer
                                });
                            }
                        }
                    } else {
                        this.highlights.push(pact.card);
                        //Also highlight available districts.
                        for (let d = 0; d < this.districts; d++) {
                            const dist = this.coord2algebraic(d);
                            if (this.canPlace(pact.card, dist))
                                this.highlights.push(dist);
                        }
                    }
                                
                } else if ( pact.type === "A" || pact.type === "P" || pact.type === "C" ) {
                    
                    this.highlights.push(pact.card);
                    //Also highlight the card suits in the player tokens.
                    if (pact.suit === undefined) {
                        this.highlights.push(pact.card[1]);
                        if (pact.card[0] !== "1")
                            this.highlights.push(pact.card[2]);
                        if (pact.card[0] === this.courtrank)
                            this.highlights.push(pact.card[3]);
                    }
                    
                    const deed = this.deeds[this.currplayer - 1].get(pact.card)!;
                    if (pact.type === "P" && pact.suit !== undefined) {
                        deed.preferred = pact.suit;
                        //Don't chatlog.
                    }
                    
                    if (pact.type === "C" && pact.suit !== undefined) {
                        this.tokens[this.currplayer - 1][suitOrder.indexOf(pact.suit)]++;
                        this.removeCard(pact.card,this.choose);
                    }
                    
                    if (pact.type === "A" && pact.spend !== undefined) {
                        const done = this.add2deed(pact.card, pact.spend);

                        this.results.push({
                            type: "add",
                            where: pact.card,
                            num: pact.spend.reduce( (cur, acc) => cur + acc, 0 )
                        });

                        //If the deed is done, remove it and place the card.
                        if (done) {
                            const district = this.deeds[this.currplayer - 1].get(pact.card)!.district;
                            this.deeds[this.currplayer - 1].delete(pact.card);
                            this.placeCard(pact.card, district!);
                            
                            this.results.push({
                                type: "place",
                                what: pact.card,
                                where: district,
                                how: pact.type,
                                who: this.currplayer
                            });
                        }
                    }
                }//end deed adjustment types
            } else {
                //No card selected.
                //If we need to burn a hand card, highlight the choices.
                if ( pact.type === "B" || pact.type === "D" || pact.type === "S" ) {
                    //Check for cards player can afford/use.
                    this.hands[this.currplayer - 1].forEach(card => {
                        if ( (pact.type === "S") || (pact.type === "B" && this.canPay(card)) || (pact.type === "D" && this.canDeed(card)) )
                            this.highlights.push(card);
                    });
                }
            }
        }//end action loop

        if (partial) { return this; }
        
        // draw up
        this.drawUp();

        this.lastmove = m;
        //this.roll = this.roll;

        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }

        this.checkEOG();

        //Rolling the dice is simple.  Logging the roll is complicated.
        if (! this.gameover ) {
            //Roll the dice!

            //const payArray:string[] = [];
            
            this.roll = this.roller();
            const theDie = this.roll[0];

            //We cannot report the roll as associated with the new player.
            this.results.push({type: "roll", values: [theDie], who: newplayer});
            
            [1, 2].forEach((p) => {

                //The taxman cometh?
                if (this.roll.length > 1) {
                    for (let t = 1; t < this.roll.length; t++) {
                        const taxrollIdx = this.roll[t] - 1;
                        if (this.tokens[p - 1][taxrollIdx] > 1) {           //Taxable?
                            const tax = this.tokens[p - 1][taxrollIdx] - 1; //Save amount for logging.
                            this.tokens[p - 1][taxrollIdx] = 1;             //Taxing
                            this.results.push({type: "capture", whose: p, count: tax, where: suitOrder[taxrollIdx]});
                        }
                    }
                }

                //Collecting tokens.
                const isRoller: boolean = p === (newplayer as playerid);
                const gains = this.collectOn(theDie, p as playerid, isRoller); //Does the increments, returns tokenArray.

                //Log individually unless it was crown tokens.
                if (theDie !== 10) {
                    const gainStringArray: string[] = [];
                    gains.forEach( (value, index) => {
                        if (value > 0)
                            gainStringArray.push(value.toString() + " " + suitOrder[index]);
                    });
                    if (gainStringArray.length > 0) {
                        //Oxford gainString.
                        const gainString = gainStringArray.reduce( (a, b, i, array) => a + ( i < array.length - 1 ? ', ' : (array.length > 2 ? ', and ' : ' and ') ) + b);
                        this.results.push({type: "claim", who: p, what: gainString});
                    }
                }
            });

            if (theDie === 10) {
                //Only one message for crown tokens.
                this.results.push({type: "claim", how: "Crowns"});
            }
        }

        this.currplayer = newplayer as playerid;

        this.saveState();
        return this;
    }

    protected checkEOG(): MagnateGame {
        //The attempt to draw up has already happened, so we check hand size.
        const handSize = (this.variants.includes("mega") ? 6 : 3);

        //Final hand size may not be predictable in mega.
        if (this.shuffled && this.deck[0].size === 0 && this.hands[0].length < handSize && this.hands[1].length < handSize ) {
            this.gameover = true;

            //Evaluates main scores and tiebreakers.
            this.winner = this.getWinner();
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(opts?: {strip?: boolean, player?: number}): IMagnateState {
        const state: IMagnateState = {
            game: MagnateGame.gameinfo.uid,
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
                    //Hide hands.
                    mstate.hands[p - 1] = mstate.hands[p - 1].map(() => "");
                    //Hide prefs.
                    mstate.deeds[p - 1].forEach( value => value.preferred = undefined );
                    //Tokens are public information.
                }
                return mstate;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: MagnateGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            board: deepclone(this.board) as [string[], string[][], string[][]],
            crowns: [[...this.crowns[0]],[...this.crowns[1]]],
            deeds: [new Map(this.deeds[0]),new Map(this.deeds[1])],
            discards: [...this.discards],
            hands: this.hands.map(h => [...h]),
            tokens: [[...this.tokens[0]],[...this.tokens[1]]],
            shuffled: this.shuffled,
            roll: [...this.roll],
            choose: [...this.choose],
            lastmove: this.lastmove,
        };
    }

    

    /* render functions */
    private deed2coords(card: string, player: playerid): number[] {
        const deed = this.deeds[player - 1].get(card);
        const col = this.algebraic2coord(deed!.district);
        
        const centerrow = this.getBoardSize()[0];
        const multiplier = player === 1 ? 1 : -1;
        const colsize = this.board[player][col].length;
        const rowAdjust =  ( this.deeds[player - 1].has(card) ) ? 1 : 0;

        return [col, centerrow + ((colsize + rowAdjust) * multiplier)];
    }
    
    private result2coords(district: string, card: string, player: number): number[] {
        //We pass the player in all relevant messages in order to 
        // check the correct element of the board or deed array.
        if (this.deeds[player - 1].has(card))
            return this.deed2coords(card, player as playerid);
 
        //The player can sometimes acquire two cards in the same column in the same turn,
        //so can't just use the terminal column space.
        const col = this.algebraic2coord(district);
        
        const boardRow = this.board[player][col].indexOf(card) + 1;
        const centerrow = this.getBoardSize()[0];
        const multiplier = player === 1 ? 1 : -1;

        return [col, centerrow + (boardRow * multiplier)];
    }
    
    private getActionButtons(): [ButtonBarButton, ...ButtonBarButton[]] {
        //Get the appropriate buttons.
        let buttons:  [ButtonBarButton, ...ButtonBarButton[]] = [
            {label: "Buy"},
            {label: "Deed"},
            {label: "Sell"}
        ];

        if ( this.choose.length > 0 ) {
            buttons = [ 
                {label: "Choose"}
            ];
            return buttons;
        }

        const deedy = this.deeds[this.currplayer - 1].size > 0;

        if (deedy)
            buttons.push({label: "Add"});

        if (this.tokens[this.currplayer - 1].filter( v => v >= 3).length > 0)
            buttons.push({label: "Trade"});

        if (deedy)
            buttons.push({label: "Prefer"});

        return buttons;
    }
    
    private getBoardSize(): number[] {
        //Calculate the unknown dimension of the board (rows),
        //and the location of the center row.
        const p1rows = this.getMaxDistrictSize(1);
        const p2rows = this.getMaxDistrictSize(2);
        const centerrow = p2rows + 1;
        const rows = p1rows + p2rows + 3;
        return [centerrow, rows];
    }
    
    private getMaxDistrictSize(player: number): number {
        //Gets max district size (disregarding deeds).
        let max = 0;
        const board = this.board[player];
        for (let d = 0; d < this.districts; d++) {
            const districtLength = board ? ( board[d] ? board[d].length : 0 ) : 0;
            max = Math.max(districtLength, max);
        }
        return max;
    }

    public renderDecktetGlyph(card: Card | Multicard, border?: boolean, deed?: DeedContents, opacity?: number, fill?: string|number): [Glyph, ...Glyph[]] {
        //Refactored from the toGlyph method of Card for opacity, verticality, deed tokens, etc.
        if (border === undefined) {
            border = false;
        }
        if (opacity === undefined) {
            opacity = 1;
        }

        let preflight = "";
        if (deed && this.deeds[this.currplayer - 1].has(card.uid)) {
            if (deed.preferred)
                preflight = deed.preferred;
            else if (card.suits.length === 2)
                preflight = this.suitPicker(card.uid, this.currplayer);
        }

        const glyph: [Glyph, ...Glyph[]] = [
            {
                name: border ? "piece-square" : "piece-square-borderless",
                scale: border? 1.1 : 1,
                colour: fill ? fill : "_context_background",
                opacity: opacity/4,
            },
        ]
        
        if (card.rank.glyph !== undefined) {
            glyph.push({
                name: card.rank.glyph,
                scale: 0.5,
                colour: "_context_strokes",
                nudge: {
                    dx: 250,
                    dy: -250,
                },
                opacity: opacity,
                orientation: "vertical",
            });
        }

        const nudges: [number,number][] = [[-250, -250], [-250, 250], [250, 250]];
        for (let i = 0; i < card.suits.length; i++) {
            const suit = card.suits[i];
            const nudge = nudges[i];
            if ( preflight === suit.uid )
                glyph.push({
                    name: "piece",
                    scale: 0.5,
                    nudge: {
                        dx: nudge[0],
                        dy: nudge[1],
                    },
                    colour: suitColors[suit.seq - 1],
                    opacity: opacity,
                    orientation: "vertical",
                });
            else if ( deed ) // && tokens[i] > 0)
                glyph.push({
                    name: "piece-borderless",
                    scale: 0.5,
                    nudge: {
                        dx: nudge[0],
                        dy: nudge[1],
                    },
                    colour: suitColors[suit.seq - 1],
                    opacity: opacity,
                    orientation: "vertical",
                });

            glyph.push({
                name: suit.glyph,
                scale: 0.5,
                nudge: {
                    dx: nudge[0],
                    dy: nudge[1],
                },
                opacity: opacity,
                orientation: "vertical",
            });

            if ( deed && i === 0) 
                //suit1 always present
                glyph.push({
                    text: deed.suit1.toString(),
                    scale: 0.5,
                    nudge: {
                        dx: nudge[0],
                        dy: nudge[1],
                    },
//                    colour: "#000",
                    orientation: "vertical",
                });

            if ( deed && deed.suit2 !== undefined && i === 1)
                glyph.push({
                    text: deed.suit2!.toString(),
                    scale: 0.5,
                    nudge: {
                        dx: nudge[0],
                        dy: nudge[1],
                    },
//                    colour: "#000",
                    orientation: "vertical",
                });
            
            if ( deed && deed.suit3 !== undefined && i === 2 )
                glyph.push({
                    text: deed.suit3!.toString(),
                    scale: 0.5,
                    nudge: {
                        dx: nudge[0],
                        dy: nudge[1],
                    },
//                    colour: "#000",
                    orientation: "vertical",
                });
        
        }

        return glyph;
    }
    
    private renderableCards(forRender: boolean): Multideck {
        //Init draw deck and hands.
        const deckCount = (this.variants.includes("mega") ? 2 : 1);
        const renderDeck = this.initDeck(deckCount, forRender);
        return renderDeck[0];
    }

    private renderPlayerPieces(player: number): string[] {
        const pstra: string[] = [];
        const maxRows = this.getMaxDistrictSize(player);

        //A player's tableau.
        const board = this.board[player];
        for (let r = 0; r <= maxRows; r++) {
            const row = [];
            for (let d = 0; d < this.districts; d++) {
                if (board[d].length > r) {
                    const c = board[d][r];
                    row.push("k" + c);
                } else if (board[d].length === r) {
                    //Check for a deed.
                    const dist = this.coord2algebraic(d);
                    if (this.hasDeed(dist, player as playerid)) {
                        const c = this.getDeedCard(dist, player as playerid);
                        row.push("k" + c);
                    } else {
                        row.push("-");
                    }
                } else {
                    row.push("-");
                }
            }
            pstra.push(row.join(","));
        }

        return pstra;
    }
    
    public render(): APRenderRep {
        //Need to determine the number of rows every time.
        const [centerrow, rows] = this.getBoardSize();

        //Player 2 on top.
        let pstrArray = this.renderPlayerPieces(2);
        //Invert here.
        pstrArray.reverse();

        //the center row
        const row = [];
        for (let bc = 0; bc < this.districts; bc++) {
            const c = this.board[0][bc];
            row.push("k" + c);
        }
        pstrArray.push(row.join(","));

        //Player 1 below.
        const pstr1 = this.renderPlayerPieces(1);
        pstrArray = pstrArray.concat(pstr1);
        
        const pstr = pstrArray.join("\n");

        
        
        // Mark live spots, deeds, and control.
        const markers: (MarkerOutline|MarkerFlood)[] = [];
        const annotationPoints = [];

        let sideboard = this.board[1];
        const points1 = [];
        for (let col = 0; col < this.districts; col++) {
            const rawrow = sideboard[col] ? sideboard[col].length : 0;
            points1.push({col: col, row: rawrow + centerrow + 1} as RowCol);
            if (this.currplayer === 1 && this.highlights.indexOf(this.coord2algebraic(col)) > -1)
                annotationPoints.push({col: col, row: rawrow + centerrow + 1} as RowCol);
        }
        markers.push({
            type: "flood",
            colour: 1,
            opacity: 0.15,
            points: points1 as [RowCol, ...RowCol[]],
        });
        
        sideboard = this.board[2];
        const points2 = [];
        for (let col = 0; col < this.districts; col++) {
            const rawrow = sideboard[col] ? sideboard[col].length : 0;
            points2.push({col: col, row: centerrow - rawrow - 1} as RowCol);
            if (this.currplayer === 2 && this.highlights.indexOf(this.coord2algebraic(col)) > -1)
                annotationPoints.push({col: col, row: centerrow - rawrow - 1} as RowCol);
        }
        markers.push({
            type: "flood",
            colour: 2,
            opacity: 0.15,
            points: points2 as [RowCol, ...RowCol[]],
        });

        const controlled = this.getDistrictsWinners();
        controlled.forEach((dc, i) => {
            if (dc > 0)
                markers.push({
                    type: "outline",
                    colour: dc,
                    points: [{col: i, row: centerrow}] as [RowCol, ...RowCol[]],
                });
        });
        
        // Build legend of all cards, including an Excuse.
        const allcards = this.renderableCards(true).cards;
        //Assemble the visible cards as we go.
        const visibleCards: string[] = [...this.board[1].flat(), ...this.board[2].flat()];
              
        const legend: ILegendObj = {};
        for (const card of allcards) {
            let glyph = this.renderDecktetGlyph(card);
            const isHighlighted: boolean = this.highlights.indexOf(card.uid) > -1;

            if ( visibleCards.indexOf(card.uid) > - 1 ) {
                //Board cards get borders.
                glyph = this.renderDecktetGlyph(card, true);
            } else if ( card.rank.uid === this.pawnrank || card.rank.name === "Excuse" ) {
                // the pawny pieces and the excuse (center row)
                glyph = this.renderDecktetGlyph(card); // no borders
            } else if ( this.deeds[0].has(card.uid) ) {
                glyph = this.renderDecktetGlyph(card, isHighlighted, this.deeds[0].get(card.uid), 0.4, 1);
                visibleCards.push(card.uid);
            } else if ( this.deeds[1].has(card.uid) ) {
                glyph = this.renderDecktetGlyph(card, isHighlighted, this.deeds[1].get(card.uid), 0.4, 2);
                visibleCards.push(card.uid);
            } else if ( isHighlighted ) {
                glyph = this.renderDecktetGlyph(card, true, undefined, 1, this.currplayer);
            }
            
            legend["k" + card.uid] = glyph;
        }

        //Suit tokens
        
        for (let s = 0; s < 6; s++) {
            const suit = suits[s];
            
   /*         legend["s" + suit.uid] = {
                name: suit.glyph!,
                scale: 0.5
            }
   */         
            const color = suitColors[s];
            for (let p = 0; p < 2; p++) {
                const pcount = this.tokens[p][s];
                const lname = "s" + suit.uid + (p + 1).toString();
                const border = (this.currplayer === p + 1 && this.highlights.indexOf(suit.uid) > - 1);

                legend[lname] = [
                    {
                        name: border ? "piece" : "piece-borderless",
                        scale: 0.75,
                        colour: color,
                        opacity: 0.75,
                        nudge: {
                            dx: 0,
                            dy: 100,
                        },
                        orientation: "vertical",
                    },
                    {
                        name: suit.glyph!,
                        scale: 0.60,
                        opacity: 0.3,
                        nudge: {
                            dx: 0,
                            dy: 125,
                        },
                        orientation: "vertical",
                    },
                    {
                        text: pcount.toString(),
                        scale: 0.70,
//                        colour: "#000",
                        nudge: {
                            dx: 0,
                            dy: 100,
                        },
                        orientation: "vertical",
                    }
                ];

                if (this.crowns[p][s] === 2) {
                    
                    legend[lname].push(
                        {
                            name: "decktet-crown",
                            scale: 0.30,
                            colour: "_context_strokes",
                            nudge: {
                                dx: -275,
                                dy: -625,
                            },
                            orientation: "vertical",
                        }
                    );
                    legend[lname].push(
                        {
                            name: "decktet-crown",
                            scale: 0.30,
                            colour: "_context_strokes",
                            nudge: {
                                dx: 275,
                                dy: -625,
                            },
                            orientation: "vertical",
                        }
                    );
                    
                } else if (this.crowns[p][s] === 1) {
                    
                    legend[lname].push(
                        {
                            name: "decktet-crown",
                            scale: 0.30,
                            colour: "_context_strokes",
                            nudge: {
                                dx: 0,
                                dy: -650,
                            },
                            orientation: "vertical",
                        }
                    );
                
                } //End crown additions.
            } //end p
        } //end suit
    
        if (this.roll[0] < 10) {
            legend["Die"] = {
                name: `d6-${this.roll[0]}`,
                colour: {
                    func: "lighten",
                    colour:  this.currplayer,
                    ds: 5,
                    dl: 2,
                },          
                colour2: {
                    func: "bestContrast",
                    fg: ["_context_background", "_context_fill", "_context_strokes"],
                    bg: {
                        func: "lighten",
                        colour:  this.currplayer,
                        ds: 5,
                        dl: 2,
                    },
                },
                orientation: "vertical",
            };
        } else {
            legend["Die"] = [
                {
                    name: "d6-empty",
                    colour: {
                        func: "lighten",
                        colour:  this.currplayer,
                        ds: 5,
                        dl: 2,
                    },
                    orientation: "vertical",
                },
                {
                    text: "10",
                    scale: 0.75,
                    colour: {
                        func: "bestContrast",
                        fg: ["_context_background", "_context_fill", "_context_strokes"],
                        bg: {
                            func: "lighten",
                            colour:  this.currplayer,
                            ds: 5,
                            dl: 2,
                        },
                    },
                    orientation: "vertical",
                }
            ];
        }
        
        legend["Tax"] = {
            name: "d6-empty",
            colour: "_context_fill",
            opacity: 0.15,
            orientation: "vertical",
        };
        legend["TaxTax"] = {
            name: "d6-empty",
            colour: "_context_fill",
            opacity: 0.15,
            orientation: "vertical",
        };

        if (this.roll.length > 1) {

            legend["Tax"] = [
                {name: "d6-empty", colour: "_context_fill", opacity: 0.15, orientation: "vertical"},
                {name: suits[this.roll[1] - 1].glyph!, scale: 0.75, orientation: "vertical"}
            ];

            //Note that the taxtax variant does not always result in double taxation.
            if (this.roll.length > 2) {
                legend["TaxTax"] = [
                    {name: "d6-empty", colour: "_context_fill", opacity: 0.15, orientation: "vertical"},
                    {name: suits[this.roll[2] - 1].glyph!, scale: 0.75, orientation: "vertical"}
                ];
            }
        }


        // build pieces areas
        const areas: (AreaPieces|AreaKey|AreaButtonBar)[] = [];

        //hands
        for (let p = 1; p <= this.numplayers; p++) {
            this.hands[p - 1].forEach(c => {
                if (c !== "")
                    visibleCards.push(c)
            });
            const hand = this.hands[p - 1].map(c => "k" + (c === "" ? "UNKNOWN" : c));
            const tokens = this.tokens[p - 1].map((cnt, idx) => "s" + suitOrder[idx] + p.toString());
            const width = this.variants.includes("mega") ? 12 : 9;

            //This should always be true.
            if (hand.length + tokens.length > 0) {
                
                areas.push({
                    type: "pieces",
                    pieces: hand.concat(tokens) as [string, ...string[]],
                    label: i18next.t("apgames:validation.magnate.LABEL_BOTH", {playerNum: p}) || `P${p}'s Hand and Tokens`,
                    spacing: 0.25,
                    width: width,
                    ownerMark: p
                });
            }
        }

        //Build die roll area
        areas.push({
            type: "key",
            list: this.variants.includes("taxtax") ? [
                {piece: "Die", name: ""},
                {piece: "Tax", name: ""},
                {piece: "TaxTax", name: ""}
            ] : [
                {piece: "Die", name: ""},
                {piece: "Tax", name: ""}
            ],
            position: "right",
            clickable: false,
            height: 1
        });

        //Button area.
        areas.push({                      
            type: "buttonBar",
            position: "left",
            height: 0.75,
            buttons: this.getActionButtons()
        });

        //discards
        if (this.discards.length > 0) {
            this.discards.forEach(c => visibleCards.push(c));
            areas.push({
                type: "pieces",
                pieces: this.discards.map(c => "k" + c) as [string, ...string[]],
                label: this.shuffled ? i18next.t("apgames:validation.magnate.LABEL_DISCARDS_NONE") : i18next.t("apgames:validation.magnate.LABEL_DISCARDS_ONE") || "Discards",
                spacing: 0.25,
                width: this.districts + 2,
            });
        }

        //TODO: stacked deck changes
        //const remaining = this.deck[0].clone().draw(this.deck[0].size).sort(cardSortAsc).map(c => "k" + c.uid) as [string, ...string[]];
        const mostcards = this.renderableCards(false).cards;
        const remaining = mostcards.sort(cardSortAsc).filter(c => visibleCards.indexOf(c.uid) < 0).map(c => "k" + c.uid);

        if (remaining.length > 0) {

            if ( (!this.shuffled) && this.variants.includes("mega") && this.variants.includes("stacked") ) {
                for (let p = 1; p <=2; p++) {
                    const ps = p.toString();
                    const pr = remaining.filter(c => c.endsWith(ps));
                    if (pr.length > 0)
                        areas.push({
                            type: "pieces",
                            label: i18next.t("apgames:validation.magnate.LABEL_STACKED_DECK", {playerNum: p}) || `Cards in P${p}'s deck`,
                            spacing: 0.25,
                            width: this.districts + 2,
                            pieces: pr as [string, ...string[]]
                        });
                }
            }  else {
                areas.push({
                    type: "pieces",
                    label: i18next.t("apgames:validation.magnate.LABEL_DECK") || "Cards in deck",
                    spacing: 0.25,
                    width: this.districts + 2,
                    pieces: remaining as [string, ...string[]]
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            //options: ["hide-labels-half"],
            board: {
                style: "squares",
                width: this.districts,
                height: rows,
                tileHeight: 1,
                tileWidth: 1,
                tileSpacing: 0.15,
                strokeOpacity: 0,
                rowLabels: [],
                labelColour: "#888",
                markers,
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Add annotations.
        rep.annotations = [];
        
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place" && move.where !== "discards") {
                    const [x, y] = this.result2coords(move.where!, move.what!, move.who!);
                    rep.annotations.push({type: "enter", occlude: false, dashed: [6,8], targets: [{row: y, col: x}]});
                } 
            }
        }
        
        for (const choice of this.choose) {
            const [x, y] = this.deed2coords(choice, this.currplayer);
            rep.annotations.push({type: "enter", dashed: [8,8], targets: [{row: y, col: x}], colour: this.currplayer});
        }
        
        if (annotationPoints.length > 0)
            rep.annotations.push({type: "dots", targets: annotationPoints as [RowCol, ...RowCol[]]});

        if (rep.annotations.length === 0)
            delete rep.annotations;

        return rep;
    }


    
    /* scoring functions */
    private getAceScore(index: number, playernum: number, c1: Multicard): number {
        let acescore = 0;
        const myDistrict = this.board[playernum][index];
        for (let c = 0; c < myDistrict.length; c++) {
            const c2 = Multicard.deserialize(myDistrict[c])!;
            if (c1.sharesSuitWith(c2))
                acescore++;
        }

        if (this.variants.includes("deucey")) {
            //Ace variant with more matches.
            const c2 = Multicard.deserialize(this.board[0][index])!;
            if (c1.sharesSuitWith(c2))
                acescore++;

            const them = playernum === 1 ? 2 : 1; 
            const theirDistrict = this.board[them][index];
            for (let c = 0; c < theirDistrict.length; c++) {
                const c2 = Multicard.deserialize(theirDistrict[c])!;
                if (c1.sharesSuitWith(c2))
                    acescore++;
            }
        }

        return acescore;
    }

    private getDistrictScoreForPlayer(district: string, player: playerid): number {
        //Returns the raw score of a district for a player.
        const index = this.algebraic2coord(district);
        const myDistrict = this.board[player as number][index];
        let subscore = 0;
        for (let c = 0; c < myDistrict.length; c++) {
            const card = Multicard.deserialize(myDistrict[c])!;
            if (card.rank.name === "Ace")
                subscore += this.getAceScore(index, player, card);
            else 
                subscore += Math.ceil(card.rank.seq); //Rounds all "Courts" up to 10. 
        }
        return subscore;
    }

    private getDistrictWinner(district: string): number {
        //Returns (numeric) playerid of the controller of a single district, or 0 if tied.
        const control = this.getDistrictScoreForPlayer(district,1) - this.getDistrictScoreForPlayer(district,2);

        if (control > 0) return 1;
        if (control < 0) return 2;
        return 0;
    }

    private getDistrictsTotals(): number[] {
        //Returns total *number* of districts controlled per player, in an array of length 2.
        const controllers: number[] = [0,0,0];
        for (let d = 0; d < this.districts; d++) {
            const controller = this.getDistrictWinner(this.coord2algebraic(d));
            controllers[controller]++;
        }
        controllers.shift();
        return controllers;
    }

    private getDistrictsWinners(): number[] {
        //Returns an array of length this.districts, indicating which player controls each one (for rendering).
        const controllers: number[] = [];
        for (let d = 0; d < this.districts; d++) {
            const controller = this.getDistrictWinner(this.coord2algebraic(d));
            controllers.push(controller);
        }
        return controllers;
    }

    public getPlayersScores(): IScores[] {
        //Returns the district and total scores for display.
        //Not to be used for determining the winner.
        let scores: string[] = [];
        const districts: number[] = this.getDistrictsTotals();
        scores = districts.map((s, i) => 
            s + " (" + this.getTotalScore((i + 1) as playerid) + ")"
                              );
        return [
            { name: i18next.t("apgames:status.SCORES"), scores },
        ];
    }

    private getTotalScore(player: playerid): number {
        //Returns a player's overall total raw score, which is the first tiebreaker.
        let total = 0;
        for (let d = 0; d < this.districts; d++) {
            const dist = this.coord2algebraic(d);
            total += this.getDistrictScoreForPlayer(dist, player)
        }
        return total;
    }
 
    private getWinner(): playerid[] {
        //Evaluate the primary endpoint.
        const districts: number[] = this.getDistrictsTotals();
        if (districts[0] !== districts[1]) {
            const winner = (districts[0] > districts[1] ? 1 : 2) as playerid;
            return [winner];
        }

        //Evaluate tiebreakers.
        let tieWinner: playerid[] = [];
        const tieArray: number[][] = [[],[]];
        for (let p = 1; p <=2; p++) {
            tieArray[0][p - 1] = this.getTotalScore(p as playerid);
            tieArray[1][p - 1] = this.tokens[p - 1].reduce(
                (acc, cur) => acc + cur,
                0
            );
        }
        const winArray = tieArray.filter( arry => arry[0] !== arry [1] ).map( arry => arry[0] - arry[1]);

        if (winArray.length === 0) {
            tieWinner = [1,2] as playerid[];
        } else {
            tieWinner.push((winArray[0] > 0 ? 1 : 2) as playerid);
        }
        return tieWinner;
    }
    
    /* end scoring functions */


    
    public status(): string {
        let status = super.status();

        status += "**Scores**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chatLog(players: string[]): string[][] {
        // chatLog to get players' names.
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {

                        switch (r.type) {
                            case "roll":
                                if (r.values[0] === 8)
                                    node.push(i18next.t("apresults:ROLL.magnate_eight", {values: r.values, who: r.who !== state.currplayer ? name : players.filter(p => p !== name)[0]}));
                                else
                                    node.push(i18next.t("apresults:ROLL.magnate", {values: r.values, who: r.who !== state.currplayer ? name : players.filter(p => p !== name)[0]}));
                                break;
                            case "claim":
                                if (r.how)
                                    node.push(i18next.t("apresults:CLAIM.magnate_initial"));
                                else
                                    node.push(i18next.t("apresults:CLAIM.magnate", {what: r.what, who: r.who !== state.currplayer ? name : players.filter(p => p !== name)[0]}));
                                break;
                            case "capture": //taxation
                                node.push(i18next.t("apresults:CAPTURE.magnate", {count: r.count, where: r.where, whose: r.whose !== state.currplayer ? name : players.filter(p => p !== name)[0]}));
                                break;
                            case "place":
                                if (r.where === "discards")
                                    node.push(i18next.t("apresults:PLACE.magnate_sell", {player: name, what: r.what}));
                                else if (r.how === "D")
                                    node.push(i18next.t("apresults:PLACE.magnate_deed_start", {player: name, where: r.where, what: r.what}));
                                else if (r.how === "A")
                                    node.push(i18next.t("apresults:PLACE.magnate_deed_end", {player: name, where: r.where, what: r.what}));
                                else
                                    node.push(i18next.t("apresults:PLACE.magnate_buy", {player: name, where: r.where, what: r.what}));
                                break;
                            case "add": //to a deed
                                node.push(i18next.t("apresults:ADD.magnate", {player: name, where: r.where, count: r.num}));
                                break;
                            case "convert": //Complete deed.
                                if (r.into) 
                                    node.push(i18next.t("apresults:CONVERT.magnate_trade", {player: name, what: r.what, into: r.into}));
                                else
                                    node.push(i18next.t("apresults:CONVERT.magnate_deed", {player: name, what: r.what, where: r.where}));
                                break;
                            case "deckDraw": //For the single shuffle.
                                node.push(i18next.t("apresults:DECKDRAW.magnate"));
                                break;
                            case "eog":
                                node.push(i18next.t("apresults:EOG.default"));
                                break;
                       /* boilerplate cases */
                            case "resigned": {
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1];
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            }
                            case "timeout": {
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1];
                                }
                                node.push(i18next.t("apresults:TIMEOUT", {player: tname}));
                                break;
                            }
                            case "gameabandoned":
                                node.push(i18next.t("apresults:ABANDONED"));
                                break;
                            case "winners": {
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                                break;
                            }
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): MagnateGame {
        return Object.assign(new MagnateGame(), deepclone(this) as MagnateGame);
    }
}
