import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph, MarkerFlood, MarkerGlyph, RowCol} from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Deck, cardSortAsc, cardsBasic, cardsExtended, suits } from "../common/decktet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2|3|4|5;
export type Suit = "M"|"S"|"V"|"L"|"Y"|"K";
const suitOrder = ["M","S","V","L","Y","K"];

// used to simplify the render function
// we ignore hands and only track the market and current discards
// then go back to a full state on the final frame
export type FrameState = {
    board: Map<string, string>;
    market: string[];
    discards: string[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    skipto?: playerid;
    board: Map<string, string>;
    closedhands: string[][];
    hands: string[][];
    market: string[];
    discards: string[];
    nummoves: number;
    lastmove?: string;
    frames?: FrameState[];
};

export interface IFroggerState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IFrogMove {
    forward: boolean;
    card?: string;
    from?: string;
    to?: string;
    refill: boolean;
    incomplete: boolean;
    valid: boolean;
}

export class FroggerGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Frogger",
        uid: "frogger",
        playercounts: [2,3,4,5],
        version: "20251229",
        dateAdded: "2025-12-29",
        // i18next.t("apgames:descriptions.frogger")
        description: "apgames:descriptions.frogger",
        // i18next.t("apgames:notes.frogger")
        notes: "apgames:notes.frogger",
        urls: [
            "http://wiki.decktet.com/game:frogger",
            "https://boardgamegeek.com/boardgame/41859/frogger",
        ],
        people: [
            {
                type: "designer",
                name: "José Carlos de Diego Guerrero",
                urls: ["https://labsk.net/wkr/autor/"],
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        variants: [
            { uid: "advanced" }, //see Xing in The Decktet Book
            { uid: "crocodiles" }, //see the comments on the Decktet Wiki
            { uid: "courts" }, //include courts in the draw deck
            { uid: "courtpawns" }, //courts for pawns
            { uid: "freeswim" }, //no check on market card claims
            { uid: "#market" }, //Now called the draw pool.  The base setting is no refills.
            { uid: "refills", group: "market", default: true }, //the official rule
            { uid: "continuous", group: "market", experimental: true }, //continuous small refills
        ],
        categories: ["goal>evacuate", "mechanic>move", "mechanic>bearoff", "mechanic>block", "mechanic>random>setup", "mechanic>random>play", "board>shape>rect", "board>connect>rect", "components>decktet", "other>2+players"],
        flags: ["autopass", "custom-buttons", "custom-randomization", "random-start", "experimental"],
        displays: [{uid: "frog-pieces"}]
    };
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.rows);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.rows);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public skipto?: playerid|undefined;
    public board!: Map<string, string>;
    public closedhands: string[][] = [];
    public hands: string[][] = [];
    public market: string[] = [];
    public discards: string[] = [];
    public nummoves = 3;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public frames?: FrameState[] = [];
    private rows: number = 3;
    private columns: number = 14; //12 cards plus two end columns
    private pawnrank: string = "P";
    private courtrank: string = "T";
    private marketsize: number = 6;
    private deck!: Deck;
    private suitboard!: Map<string, string>;
    private _highlight: string[] = [];
    private _points: string[] = [];
    private _button: boolean = true; //for refill button hiding

    constructor(state: number | IFroggerState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            if (this.variants.includes("courtpawns")) {
                this.pawnrank = "T";
                this.courtrank = "P";
            }

            // init deck
            const cards = [...cardsBasic];
            const deck = new Deck(cards);
            deck.shuffle();

            if (this.variants.includes("advanced"))
                this.columns = 12; //10 cards plus two end columns

            //const boardCard = [...cardsExtended.filter(c=> c.rank.uid === "0")];
            const boardDeckCards = [...cardsExtended.filter(c => c.rank.uid === this.pawnrank)].concat(deck.draw(this.columns - 6));
            const boardDeck = new Deck(boardDeckCards);
            boardDeck.shuffle();

            // init board
            this.rows = Math.max(3, this.numplayers) + 1;

            if (this.variants.includes("continuous"))
                this.marketsize = 3;

            const board = new Map<string, string>();
            const suitboard = new Map<string, string>();

            //add cards
            for (let col = 1; col < this.columns - 1; col++) {
                const [card] = boardDeck.draw();
                const cell = this.coords2algebraic(col, 0);
                board.set(cell, card.uid);

                //Set suits.
                const suits = card.suits.map(s => s.uid);
                for (let s = 0; s < suits.length; s++) {
                    const cell = this.coords2algebraic(col, s + 1);
                    suitboard.set(cell,suits[s]);
                }

                //Add crocodiles.  Crocodiles are player 0.
                if (this.variants.includes("crocodiles")) {
                    if (card.rank.uid === this.pawnrank) {
                        const cell = this.coords2algebraic(col, 1);
                        board.set(cell, "X0");
                    }
                }
            }

            //add player pieces, which are Xs to not conflict with Pawns
            for (let row = 1; row <= this.numplayers; row++) {
                const cell = this.coords2algebraic(0, row);
                board.set(cell, "X" + row.toString() + "-6");
            }

            if (this.variants.includes("courts")) {
                const courtDeckCards = [...cardsExtended.filter(c => c.rank.uid === this.courtrank)];
                // note that .add() autoshuffles.
                courtDeckCards.forEach( card => deck.add(card.uid) );
            }

            // init market and hands
            const closedhands: string[][] = [];
            const hands: string[][] = [];
            for (let i = 0; i < this.numplayers; i++) {
                closedhands.push([...deck.draw(4).map(c => c.uid)]);
                hands.push([]);
            }
            const market: string[] = [...deck.draw(this.marketsize).map(c => c.uid)];

            const fresh: IMoveState = {
                _version: FroggerGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                closedhands,
                hands,
                market,
                discards: [],
                nummoves: 3,
                frames: []
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFroggerState;
            }
            if (state.game !== FroggerGame.gameinfo.uid) {
                throw new Error(`The Frogger engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];

        }
        this.load();
    }

    public load(idx = -1): FroggerGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.skipto = state.skipto;
        this.board = new Map(state.board);
        this.closedhands = state.closedhands.map(h => [...h]);
        this.hands = state.hands.map(h => [...h]);
        this.market = [...state.market];
        this.discards = [...state.discards];
        this.nummoves = state.nummoves;
        this.lastmove = state.lastmove;
        this.frames = state.frames ? deepclone(state.frames) as FrameState[] : [];

        if (this.variants.includes("advanced"))
            this.columns = 12;
        if (this.variants.includes("courtpawns")) {
            this.pawnrank = "T";
            this.courtrank = "P";
        }

        this.rows = Math.max(3, this.numplayers) + 1;

        if (this.variants.includes("continuous"))
            this.marketsize = 3;

        //Separate model of the suited part of the board.
        this.suitboard = new Map<string, string>();
        const scards = this.getBoardCards();
        for (let col = 1; col < this.columns - 1; col++) {
            //Suit check on load.
            const suits = this.getSuits(scards[col - 1], "load");
            for (let s = 1; s < suits.length + 1; s++) {
                const cell = this.coords2algebraic(col, s);
                this.suitboard.set(cell,suits[s-1]);
            }
        }

        //The deck is reset every time you load
        const cards = [...cardsBasic];
        if (this.variants.includes("courts")) {
            cards.push(...cardsExtended.filter(c => c.rank.uid === this.courtrank));
        }
        //Some board cards, for removal.
        cards.push(...cardsExtended.filter(c => c.rank.uid === this.pawnrank));

        this.deck = new Deck(cards);

        //Remove cards from the deck that are on the board, in the market, or in known hands.
        this.getBoardCards().forEach( uid =>
            this.deck.remove(uid)
                                    );
        
        //We track the initial closed hand for hiding because all subsequent draws are open.
        //Note that even if closehands become known logically, they remain hidden until played.
        for (const hand of this.closedhands) {
            for (const uid of hand) {
                if (uid !== "") {
                    this.deck.remove(uid);
                }
            }
        }
        for (const hand of this.hands) {
            for (const uid of hand) {
                this.deck.remove(uid);
            }
        }
        
        for (const uid of this.market) {
            this.deck.remove(uid);
        }
        for (const uid of this.discards) {
            this.deck.remove(uid);
        }

        this.deck.shuffle();

        if ( this.variants.includes("refills") ) {
            //Initial standard for showing the refill button is...
            this._button = ( (this.getTrueDeckSize() + this.discards.length) > 0 );
            //Does not consider market length because that is the toggle in the renderer.
        } else {
            this._button = false;
        }

        return this;
    }

    private checkBlocked(): boolean {
        //A player is blocked if their hand is empty, all frogs are already at the Excuse or home,
        // and it's the beginning of their turn.
        
        //This function checks the hand and frog conditions;
        // it's the responsibility of the caller to check the turn condition.
        if (this.closedhands[this.currplayer - 1].length > 0 || this.hands[this.currplayer - 1].length > 0)
            return false;
        if (this.countColumnFrogs() + this.countColumnFrogs(true) < 6)
            return false;
        return true;
    }

    private checkNextBack(from: string, to: string): boolean {
        //Checks a frog has backed up to the correct spot
        //  by checking its spot against the array of all allowed spots
        // (using a function also used in random moves).
        const correctBacks: string[] = this.getNextBack(from);
        return (correctBacks.indexOf(to) > -1);
    }

    private checkNextForward(from: string, to: string, card: string): boolean {
        //Checks a frog has moved forward to the correct spot
        //  by checking its against the allowed spot,
        //  using the function for generating random moves.
        
        //The advanced case is handled inside this function, unlike in getNextForward.
        const cardObj = Card.deserialize(card);
        if (cardObj === undefined) {
            throw new Error(`Could not deserialize the card ${card} in checkNextForward.`);
        }
        
        if (this.variants.includes("advanced") && cardObj.rank.uid !== this.courtrank) {
            //In the advanced game, courts still function like regular game cards,
            // but number cards do not.
            // (Crowns and aces are a degenerate case that can use either function.)
            return this.checkNextForwardAdvanced(from, to, cardObj);
        }

        const suits = cardObj.suits.map(s => s.uid);

        for (let s = 0; s < suits.length; s++) {
            //In the base game, you can use any suit off the card,
            // so we return true if we find a good one.
            const suitto = this.getNextForward(from, suits[s]);
            if (to === suitto)
                return true;
        }
        
        //Otherwise, the move didn't land on any of the legal next spots.
        return false;
    }

    private checkNextForwardAdvanced(from: string, to: string, cardObj: Card): boolean {
        //Checks that {to} is the next available cell under the advanced game movement restriction.
        //Assumes you are not passing in a Court, but handles Aces and Crowns.

        //Uses getNextForwardAdvanced to get the array of legal values for {to}.
        const suits = cardObj.suits.map(s => s.uid);
        const options = this.getNextForwardAdvanced(from, suits);
        return (options.indexOf(to) > -1);
    }

    private checkWhiteMarket(card: string, to: string): boolean {
        const toX = this.algebraic2coords(to)[0];
        if ( toX === 0 || this.variants.includes("freeswim") ) {
            // When backing up to start you can pick any market card.
            return true;
        }

        const suit = this.suitboard.get(to)!;
        const suits = this.getSuits(card, "validateMove");
        return ( suits.indexOf(suit) === -1 )
    }

    private countColumnFrogs(home?: boolean, player?: playerid): number {
        //Returns number of currplayer's frogs in the start (false/undefined) or home (true) column.
        if (player === undefined)
            player = this.currplayer;
        let col = 0;
        if (home)
            col = this.columns - 1;
        
        const cell = this.coords2algebraic(col, player as number);
        if (!this.board.has(cell))
            return 0;
        const piece = this.board.get(cell)!;
        const parts = piece.split("-");
        if (parts.length < 2)
            throw new Error(`The piece at "${cell}" was malformed. This should never happen.`);
        else
            return parseInt(parts[1],10);
    }

    private getBoardCards(): string[] {
        //Returns the top row of cards for various purposes.
        const cards: string[] = [];
        for (let col = 1; col < this.columns - 1; col++) {
            const cell = this.coords2algebraic(col, 0);
            const uid = this.board.get(cell)!;
            cards.push(uid);
        }
        return cards;
    }

    private getFullHand(player: playerid): string[] {
        //Returns concatenated hidden and visible hands for player playerId.
        return this.hands[player - 1].concat(this.closedhands[player - 1]);
    }

    private getNextBack(from: string): string[] {
        //Walk back through the board until we find a free column.
        //Return an array of all available cells in that column.
        //Used in random move generation and move validation.
        const fromX = this.algebraic2coords(from)[0];

        if ( fromX === 0 ) {
            //This can happen now so don't throw it never happens.
            return [];
        }

        for (let c = fromX - 1; c > 0; c--) {
            const cells = [];
            for (let r = 1; r < this.rows; r++) {
                const cell = this.coords2algebraic(c, r);
                if ( !this.board.has(cell) && this.suitboard.has(cell) )
                    cells.push(cell);
            }
            if (cells.length > 0)
                return cells;
        }
        const startCell = this.coords2algebraic(0, this.currplayer);
        return [startCell];
    }

    private getNextForward(from: string, suit: string): string {
        //Get the next available cell by suit.
        //Used in random move generation and move validation.
        const homecell = this.coords2algebraic(this.columns - 1, this.currplayer);

        const fromX = this.algebraic2coords(from)[0];

        if ( fromX === this.columns - 1 ) {
            throw new Error("Could not go forward from home. This should never happen.");
        }

        for (let c = fromX + 1; c < this.columns; c++) {
            if (c === this.columns - 1) {
                return homecell;
            }
            for (let r = 1; r < this.rows; r++) {
                const cell = this.coords2algebraic(c, r);
                if ( !this.board.has(cell) && this.suitboard.has(cell) && this.suitboard.get(cell) === suit )
                    return cell;
            }
        }

        //You shouldn't be here!
        throw new Error(`Something went wrong looking for the next suited cell.`);
    }

    private getNextForwardAdvanced(from: string, suits: string[]): string[] {
        //Get the next available cell under the advanced game movement restriction.
        //Assumes you are not passing in a Court, but handles Aces and Crowns.
        //Used in random move generation and move validation.
        //In certain rare cases you have a choice, so this function returns an array of cells.

        const to1 = this.getNextForward(from, suits[0]); 
        if (suits.length === 1)
            return [to1];

        const to2 = this.getNextForward(from, suits[1]); 

        const col1 = this.algebraic2coords(to1)[0];
        const col2 = this.algebraic2coords(to2)[0];

        if (col1 === col2)
            return [to1,to2];
        else if (col1 < col2)
            return [to1];
        else
            return [to2];
    }

    private getNextForwardsForCard(from: string, cardId: string): string[] {
        //Generates forward points for the renderer.
        let points: string[] = [];
        const card = Card.deserialize(cardId);
        if (card === undefined) {
            //If you can see this, the front end is trying to generate moves
            // for the next player from his hidden hand cards.  Be forgiving...
            return points;
        }
        const suits = card.suits.map(s => s.uid);

        if (this.variants.includes("advanced") && card.rank.uid !== this.courtrank) {
            points = this.getNextForwardAdvanced(from, suits);
        } else {
            for (let s = 0; s < suits.length; s++) {
                points.push(this.getNextForward(from, suits[s]));
            }
        }            
        return points;
    }
    
    private getWhiteMarket(to: string): string[] {
        //Returns a list of available market cards given a frog destination.
        const toX = this.algebraic2coords(to)[0];
        if ( toX === 0 || this.variants.includes("freeswim") ) {
            //Unrestricted choice.
            return this.market.slice();
        }

        const suit = this.suitboard.get(to);
        const whiteMarket: string[] = [];
        //Suit check.
        this.market.forEach(card => {
            if (card !== "") {
                const suits = this.getSuits(card, "getWhiteMarket");
                if (suits.indexOf(suit!) < 0)
                    whiteMarket.push(card);
            }
        });
        
        return whiteMarket;
    }

    private getSuits(cardId: string, callerInfo: string): string[] {
        const card = Card.deserialize(cardId);
        if (card === undefined) {
            throw new Error(`Could not deserialize the card ${cardId} in getSuits for ${callerInfo}.`);
        }
        const suits = card.suits.map(s => s.uid);
        return suits;
    }

    public getTrueDeckSize(): number {
        //On the server, the "deck" can contain duplicates of hidden hand cards.
        //For testing and some corner cases we want to know the true deck size.

        //The full decktet is 45 cards, but we may not be using the courts.
        let truesize = this.variants.includes("courts") ? 45 : 41;
        
        //We are not using the Excuse or the 10--12 board cards.
        truesize = truesize - (this.columns - 1)

        //Anything in the market or discards is not in the deck.
        truesize = truesize - this.market.length - this.discards.length;

        const closedhandsize = this.closedhands.reduce((acc, curr) => acc + curr.length, 0);
        const handsize = this.hands.reduce((acc, curr) => acc + curr.length, 0);
        truesize = truesize - closedhandsize - handsize;
        
        return truesize;
    }

    private getUnsuitedCells(): string[] {
        //Return those board cells that aren't on suitboard but are playable.
        const uncells: string[] = [];
        for (let row = 1; row <= this.numplayers; row++) {
            const startcell = this.coords2algebraic(0, row);
            const homecell = this.coords2algebraic(this.columns - 1, row);
            uncells.push(startcell);
            uncells.push(homecell);
        }
        return uncells;
    }

    private modifyFrogStack(cell: string, increment: boolean): void {
        //Handle the process of incrementing and decrementing the frog stacks
        // in the start and home columns.
        //It's the responsibility of the caller to validate the arguments.
        const [cellX, cellY] =  this.algebraic2coords(cell);

        if (! this.board.has(cell) ) {
            if ( (cellX === this.columns - 1 || cellX === 0) && increment ) {
                //The special case of the first frog home,
                // or the first frog returning to the empty Excuse.
                this.board.set(cell, "X" + cellY + "-1");
            } else {
                throw new Error(`Stack not found at "${cell}" in modifyFrogStack.`);
            }
            return;
        }

        const oldFrog = this.board.get(cell)!;
        const player = oldFrog.charAt(1);
        const oldFrogCount = parseInt(oldFrog.split("-")[1], 10);
        const newFrogCount = increment ? oldFrogCount + 1 : oldFrogCount - 1 ;

        if (newFrogCount === 0) {
            this.board.delete(cell);
        } else {
            const newFrogStack = "X" + player + "-" + newFrogCount.toString();
            this.board.set(cell, newFrogStack);
        }
        
    }

    private moveFrog(from: string, to: string): void {
        //Frog adjustments are complicated by frog piles and crocodiles.
        const frog = this.board.get(from)!;
        const fromX = this.algebraic2coords(from)[0];
        const toX = this.algebraic2coords(to)[0];
        const singleFrog = "X" + frog.charAt(1);
        
        if (fromX > 0 && toX > 0 && toX < this.columns - 1) {
            this.board.set(to, singleFrog);
            this.board.delete(from);
        } else {
            //Unsetting the old:
            if (fromX === 0) {
                this.modifyFrogStack(from, false);
            } else {
                //Normal delete.
                this.board.delete(from);
            }

            //Setting the new:
            if ( toX === 0 || toX === this.columns - 1 ) {
                this.modifyFrogStack(to, true);
            } else {
                this.board.set(to, singleFrog);
            }
        }
    }

    private moveFrogToExcuse(from: string): string {
        //Wrapper for moveFrog that determines the correct Excuse row,
        // because bounced frogs don't necessarily belong to currplayer.
        const frog = this.board.get(from)!;
        const row = parseInt(frog.charAt(1),10);
        const to = this.coords2algebraic(0, row);
        this.moveFrog(from, to);
        return to;
    }

    private moveNeighbors(cell: string, cardId: string): string[][] {
        //Tests for bouncing condition and if so, moves other frogs off your lily pad.
        //Returns a list of who, if anyone, was bounced.
        const bounced: string[][] = [];
        
        //Bouncing occurs when an Ace or Crown was played, not a number card or a Court.
        const card = Card.deserialize(cardId);
        if (card === undefined) {
            throw new Error(`Could not deserialize the card ${cardId} in moveNeighbors`);
        }

        const rank = card.rank.name;
        if ( rank === "Crown" || rank === "Ace" ) {

            //The bounce process.
            const col = this.algebraic2coords(cell)[0];
            
            if (col === 0) {
                throw new Error("Trying to bounce frogs off the Excuse. This should never happen!");
            } else if (col === this.columns - 1) {
                //Can't bounce here.
                return bounced;
            }
            
            for (let row = 1; row < this.rows; row++) {
                const bouncee = this.coords2algebraic(col, row);
                //Don't bounce self or crocodiles.
                if ( bouncee !== cell && this.board.has(bouncee) && this.board.get(bouncee) !== "X0" ) {
                    const to = this.moveFrogToExcuse(bouncee)!;
                    bounced.push([bouncee, to]);
                }
            }
        }
        return bounced;
    }

    public parseMove(submove: string): IFrogMove {
        //Parse a string into an IFrogMove object.
        //Does only structural validation.

        //Because the Excuse does not appear in moves, 
        // the card format is: 
        const cardex = /^(\d?[A-Z]{1,2}||[A-Z]{2,4})$/;
        //The cell format is: 
        const cellex = /^[a-n][1-5]$/;
        //A regex to check for illegal characters (except !) is:
        const illegalChars = /[^A-Za-n1-9:,-]/;

        //The move format is one of:
        // handcard:from-to            a regular move forward
        // from-to,marketcard          a productive move backward
        // from-to,marketcard!         a productive move backward, request refill
        // from-to                     a move backward but no market card taken
        // marketcard//                a whole (blocked) turn to draw a marketcard

        let mv, from, to, card;
        
        const ifm: IFrogMove = {
            incomplete: false,
            forward: false,
            refill: false,
            valid: true
        }

        //To ignore the empty move or passes, we pass out the meaningless defaults.
        if (submove === "" || submove === "pass")
            return ifm;

        //Setting refill (in variant with refill button).
        if (submove.indexOf("!") > - 1) {
            submove = submove.split("!")[0];
            ifm.refill = true;
        }

        //Check for legal characters, after trimming the single legal !.
        if (illegalChars.test(submove)) {
            ifm.valid = false;
            return ifm;
        }

        //A partial move that can't be submitted is set to incomplete.

        //Next, split the string on card punctuation:
        if (submove.split(/:|,/).length > 2 || submove.split("-").length > 2) {
            //Malformed move string.
            ifm.valid = false;
        } else if (submove.indexOf(":") > -1) {
            //Card followed by move is a forward move.
            [card, mv] = submove.split(":");
            ifm.card = card;
            ifm.forward = true;
            //may be incomplete depending on parse of to.
        } else if (submove.indexOf(",") > -1) {
            //Move followed by card is a backwards move.
            [mv, card] = submove.split(",");
            if (card) {
                ifm.card = card;
            }
            //In this case mv is required, so check it now.
            if ( !mv || mv.split("-").length < 2 || mv.split("-").indexOf("") > -1 )
                ifm.valid = false;
        } else if (submove.indexOf("-") > -1) {
            //Raw move is a unproductive or partial backwards move.
            mv = submove;
            //may be incomplete depending on parse of to.
        } else if (/\d/.test(submove.charAt(1))) {
            //A cell has a second digit that's numeric; a card wouldn't.
            mv = submove;
            //From alone is a partial move so...
            ifm.incomplete = true;
        } else {
            //... or a card.  A card alone is a blocked move or a partial move.
            ifm.card = submove;
            mv = "";
            //We aren't validating here so give it the benefit of the doubt and don't mark incomplete.
        }

        //Setting from, to, and remaining completes.
        if (mv) {
            [from, to] = mv.split("-");
            ifm.from = from;
            if (to)
                ifm.to = to;
            else 
                ifm.incomplete = true;
        } else {
            //If we were waiting to parse a move, we didn't find it.
            if (ifm.forward === true)
                ifm.incomplete = true;
            //else if (ifm.forward === false && ifm.card)
        }

        if (ifm.card && !cardex.test(ifm.card)) {
            //Malformed card.
            ifm.valid = false;
        }
        if (ifm.from && !cellex.test(ifm.from)) {
            //Malformed cell.
            ifm.valid = false;
        }
        if (ifm.to && !cellex.test(ifm.to)) {
            //Malformed cell.
            ifm.valid = false;
        }
        
        return ifm;
    }

    private popCrocs(): string[][] {
        //Moves the crocodiles and their victims.
        //Returns a list of the victims for logging and rendering.
        const victims: string[][] = [];
        for (let col = 1; col < this.columns - 1; col++) {
            // check for pawn column using the suit board
            if ( this.suitboard.has(this.coords2algebraic(col, 3)) ) {
                //We have a croc's column; we have to go looking for its row
                // because the stack length is unreliable.
                let crocRow = 1;
                for (let row = 1; row <= 3; row++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.board.has(cell)) {
                        const occupant = this.board.get(cell);
                        if (occupant === "X0") {
                            crocRow = row;
                            break;
                        }
                    }
                }

                const victimRow = (crocRow % 3) + 1;
                const crocFrom = this.coords2algebraic(col, crocRow);
                const victimFrom = this.coords2algebraic(col, victimRow); 
                if ( this.board.has(victimFrom) ) {
                    const victimTo = this.moveFrogToExcuse(victimFrom);
                    victims.push([victimFrom, victimTo]);
                }
                // regardless of squashed frogs, we move the crocodile
                this.moveFrog(crocFrom, victimFrom);
            }
        }
        return victims;
    }

    private popHand(card: string): void {
        if (! this.removeCard(card, this.hands[this.currplayer - 1]))
            this.removeCard(card, this.closedhands[this.currplayer - 1]);
        this.discards.push(card);
    }

    private popMarket(card: string): boolean {
        //Remove the drawn card.
        //For convenience, also tests for an empty market.
        this.removeCard(card, this.market);
        this.hands[this.currplayer - 1].push(card);
        
        return (this.market.length === 0);
    }

    private randomElement(array: string[]): string {
        //Return a random element from an array.
        //Used for random moves.
        const index = Math.floor(Math.random() * array.length);
        return array[index];
    }

    private refillMarket(): number {
        //Fills the market regardless of current size.
        //Shuffles the discards when necessary.
        //Refill variant behavior is mostly handled by the caller,

        //May be called when the market is already full (in the continuous variant).
        if (this.market.length === this.marketsize)
            return 0;
        
        //First, try to draw what we need from the deck.
        let toDraw = Math.min(this.marketsize, this.deck.size);
        
        this.market = [...this.deck.draw(toDraw).map(c => c.uid)];

        if (this.market.length === this.marketsize) {
            return toDraw;
        } else {
            //If we didn't fill the market, shuffle the discards.
            
            //Return the discards to the deck and shuffle.
            this.discards.forEach( card => {
                this.deck.add(card);
            });
            this.discards = [];
            this.deck.shuffle();
            
            //Draw the rest.
            for (let n = this.market.length; n < this.marketsize; n++) {
                const [card] = this.deck.draw();
                if (card) {
                    this.market.push(card.uid);
                    toDraw++;
                } else {
                    return toDraw;
                }
            }
        }
        return toDraw;
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

    public moves(player?: playerid): string[] {
        //Used for the autopasser.
        //Not a full move list, but better than just one random single move.
        if (this.gameover) {
            return [];
        }

        if (player === undefined) {
            player = this.currplayer;
        }

        if (this.skipto !== undefined && this.skipto !== this.currplayer ) {
            //Passing for market hiding.
            return ["pass"];
        }

        //Make a list of all possible first moves (out of the three allowed).
        let moves:string[] = [];
        if (this.checkBlocked()) {
            //Note the market is almost certainly populated at this point.
            moves = this.market.map(card => card + "//");
            if (moves.length > 0)
                return moves;
            else
                return ["pass"];
        }

        //List frogs.
        let firstFrog = "";
        const freeFrogs: string[] = [];
        for (let row = 1; row < this.rows; row++) {
            for (let col = 0; col < this.columns - 1; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const frog = this.board.get(cell)!;
                    if ( frog.charAt(1) === this.currplayer.toString() ) {
                        if (col === 0)
                            firstFrog = cell;
                        else
                            freeFrogs.push(cell);
                    }
                }
            }
        }

        //Get backward moves.
        freeFrogs.forEach( from => {
            const toArray = this.getNextBack(from);
            toArray.forEach( to => {
                moves.push(`${from}-${to}`); //the non-profit move
                this.getWhiteMarket(to).forEach( card => moves.push(`${from}-${to},${card}`) );
            });
        });

        //Get forward moves.
        //Now we can use a first frog.
        if (firstFrog !== "")
            freeFrogs.push(firstFrog);

        const amalgahand = this.getFullHand(this.currplayer);
        amalgahand.forEach( card => {
            freeFrogs.forEach( from => {
                let targets:string[] = this.getNextForwardsForCard(from, card);
                //Can sometimes get duplicate targets, so uniquify.
                targets = [...new Set(targets)];
                targets.forEach( to => moves.push(`${card}:${from}-${to}`) );
            });
        });

        return moves;
    }
    
    public randomMove(): string {
        //We return only one, legal move, for testing purposes.

        //Now that there's a move list we could use it,
        //  but these results are weighted so keeping them.

        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        //Refill/skipto case.  Not reachable from the move list, but useful for testing.
        if ( this.variants.includes("refills") && this.skipto !== undefined && this.skipto !== this.currplayer )
            return "pass";

        if (this.checkBlocked()) {
            if (this.market.length === 0)
                return "pass";
            else {
                const marketCard = this.randomElement(this.market);
                return marketCard + "/";
            }
        }

        //Flip a coin about what to do (if there's an option).
        let handcard = ( Math.random() < 0.66 );
        //But...
        if ( this.closedhands[this.currplayer - 1].length === 0 && this.hands[this.currplayer - 1].length === 0 )
            handcard = false;
        if ( this.countColumnFrogs() + this.countColumnFrogs(true) === 6 )
            handcard = true;
        
        //Pick an appropriate frog for hopping forward or back, randomly.
        //Need a frog that can move, so skip the home row.
        const frarray = [];
        for (let row = 1; row < this.rows; row++) {
            for (let col = 0; col < this.columns - 1; col++) {
                if ( col === 0 && !handcard )
                    continue;
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const frog = this.board.get(cell)!;
                    if ( frog.charAt(1) === this.currplayer.toString() )
                        frarray.push(cell);
                }
            }
        }
        const from = this.randomElement(frarray);
        
        if ( handcard ) {
            //hop forward
            const card = this.randomElement( this.getFullHand(this.currplayer) );
            //Card shouldn't be invisible but if it is we need to give up gracefully.
            if (card === "") {
                return "hidden";
            }
            //Suit check for random move forward.
            const suits = this.getSuits(card, "randomMove (forward)");
            const suit = this.randomElement(suits);

            let to;
            const cardObj = Card.deserialize(card);
            if (cardObj === undefined) {
                //Already handled the hidden case, so something else is wrong.
                throw new Error(`Could not deserialize the card ${card} in randomMove.`);
            }

            if (this.variants.includes("advanced") && cardObj.rank.uid !== this.courtrank) {
                //Courts next forward normally in the advanced game.
                //Aces and Crowns do, too, but this function handles them.
                to = this.randomElement(this.getNextForwardAdvanced(from, suits));
            } else
                to = this.getNextForward(from, suit);

            return `${card}:${from}-${to}`;
            
        } else {
            //fall back.

            const toArray = this.getNextBack(from);
            const to = this.randomElement(toArray);

            const whiteMarket = this.getWhiteMarket(to);
            if (whiteMarket.length > 0) {
                const card = this.randomElement(whiteMarket);
                return `${from}-${to},${card}`;
            } else {
                return `${from}-${to}`;
            }
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {

        if (this.gameover) {
            return {
                valid: false,
                complete: -1,
                move: "",
                message: i18next.t("apgames:MOVES_GAMEOVER")
            };
        }
        
        try {

            if ( this.variants.includes("refills") && this.skipto && this.skipto !== this.currplayer ) {
                //All clicks are bad clicks.  We don't bother with a pass button
                // because the back end should have autopassed you.
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.frogger.MUST_PASS")
                }
            }

            let newmove = "";

            const moves =  move.split("/");

            const isFirstMove = (moves.length === 1);
            const isLastMove = (moves.length === this.nummoves);

            const currmove = moves[moves.length - 1];
            const currIFM = this.parseMove(currmove);
            
            if (moves.length > this.nummoves) {
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.frogger.TOO_HOPPY", {count: this.nummoves})
                }
            }
            
            if (row < 0 && col < 0) {
                //clicking on a hand or market card or refill button

                if (isFirstMove && currmove === "") {
                    //Refill is not possible here.
                    
                    // starting the first move (forward) or possibly the blocked option
                    if (this.checkBlocked()) {
                        //The blocked case (spending your entire turn to draw a market card)
                        newmove = `${piece!.substring(1)}//`;
                    } else {
                        newmove = `${piece!.substring(1)}:`;
                    }
                } else if (currmove === "") {
                    //Deal with the refill button.
                    if (this.variants.includes("refills") && piece === "refill") {
                        if (move.indexOf("!") < 0) {
                            newmove = `${move.slice(0,-1)}!/`;
                            this._button = false;
                        } else
                            newmove = move;
                    } else {
                        // starting another move (forward).
                        newmove = `${move}${piece!.substring(1)}:`;
                    }
                } else if (currIFM.from && currIFM.to === undefined) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.frogger.PLACE_NEXT")
                    }
                } else if (currIFM.card && currIFM.from === undefined) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.frogger.PIECE_NEXT")
                    }
                } else if (currIFM.to && currIFM.forward === false && currIFM.card === undefined) {
                    //Hopefully picking a market card.
                    if (this.variants.includes("refills") && piece === "refill") {
                        //This is not an appropriate time to click the refill button.
                        if ( moves.length === this.nummoves) {
                            return {
                                move,
                                valid: false,
                                message: i18next.t("apgames:validation.frogger.TOO_LATE_FOR_REFILL")
                            }
                        } else {
                            return {
                                move,
                                valid: false,
                                message: i18next.t("apgames:validation.frogger.MISPLACED_REFILL")
                            }
                        }
                    } else {
                        //It would help to be able to check the market for the card
                        //(${piece!.substring(1)}), b/c it may start a new submove,
                        //but that would require cloning.
                        newmove = `${move},${piece!.substring(1)}/`;
                    }
                }
                
            } else {
                
                //Clicking on the board.

                if (row === 0) {
                    //The top row is not allowed.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.frogger.OFFSIDES")
                    }
                }

                const cell = this.coords2algebraic(col, row);

                if (currmove === "" || currIFM.from === undefined) {
                    //Piece picking cases, so need a piece.
                    if ( piece === undefined || piece === "" ) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.frogger.PIECE_NEXT")
                        }
                    } else {
                        //picked a piece to move.
                        if (move)
                            newmove += `${move}${cell}-`;
                        else
                            newmove += `${cell}-`;
                    }
                } else if (currIFM.to === undefined) {
                    //picked the target.  Don't check occupied (piece) here because it's complicated.
                    if (currIFM.card) {
                        //picked the target and finished the move forward.
                        newmove = `${move}${cell}/`;
                    } else {
                        //picked the target but not a market card.
                        newmove = `${move}${cell}`;
                    }
                } else if (currIFM.incomplete === false && !isLastMove) { //complete > -1 && !isLastMove) {
                    //Finished a hop forward or an unproductive hop back,
                    // so can start a new move (back).
                    newmove = `${move}/${cell}-`;
                } else {
                    //Getting hoppy.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.frogger.TOO_HOPPY", {count: this.nummoves})
                    }
                }
            }
            
            let result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if (result.autocomplete !== undefined) {
                    //Internal autocompletion.
                    let automove = result.autocomplete;
                    result = this.validateMove(automove) as IClickResult;

                    //A double auto-completion may be needed.
                    if (result.autocomplete !== undefined) {
                        automove = result.autocomplete;
                        result = this.validateMove(automove) as IClickResult;
                    }
                    result.move = automove;
                } else {
                    result.move = newmove;
                }
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
        const blocked = this.checkBlocked();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;

            if ( blocked && this.market.length === 0 )
                result.message = i18next.t("apgames:validation.frogger.NO_CARDS_BLOCKED");
            else if ( blocked )
                result.message = i18next.t("apgames:validation.frogger.NO_CHOICE_BLOCKED");
            else if ( this.stack.length > this.numplayers )
                result.message = i18next.t("apgames:validation.frogger.LATER_INSTRUCTIONS")
            else
                result.message = i18next.t("apgames:validation.frogger.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (m === "pass") {
            //May only pass in rare/refill situations.
            if ( this.variants.includes("refills") && this.skipto !== undefined ) {

                // && this.skipto !== this.currplayer 
                //You must pass if you're not the player being skipped to.

                // && this.skipto === this.currplayer && this.nummoves < 3
                //But you also may pass if you were skipped to
                //  and it's your supplemental refill turn,
                //  because you already made at least one move in the main turn.
                
                result.valid = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                result.complete = 1;
                return result;
            } else if ( blocked && this.market.length === 0 ) {
                result.valid = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                result.complete = 1;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.NO_PASSING");
                return result;
            }
        }

        const cloned: FroggerGame = Object.assign(new FroggerGame(this.numplayers, [...this.variants]), deepclone(this) as FroggerGame);

        let allcomplete = false;
        let refill = false;
        const moves: string[] = m.split("/");

        if (moves[moves.length - 1] === "") {
            //Trim the dummy move and mark all complete.
            //Could also test that the last character of m is a /.
            moves.length--;
            allcomplete = true;
        }

        if (moves.length > this.nummoves) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.frogger.TOO_HOPPY", {count: this.nummoves});
            return result;
        }

        for (let s = 0; s < moves.length; s++) {
            const submove = moves[s];

            const subIFM = cloned.parseMove(submove);
            if (subIFM.valid === false) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.INVALID_MOVE", {move: submove});
                return result;
            }

            //Check blocked first.
            if (blocked) {
                if (submove === "pass" && cloned.market.length === 0) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else if (subIFM.forward || subIFM.from || ! subIFM.card) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.NO_CHOICE_BLOCKED");
                    return result;
                } else if (s > 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.TOO_LATE_FOR_BLOCKED");
                    return result;
                } else if (moves.length > 1 && moves.join("") !== submove) {
                    //Checks for future moves that aren't the empty move.
                    //(We only trimmed one empty move, not all of them.)
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.NO_MOVE_BLOCKED");
                    return result;
                } else if (cloned.market.indexOf(subIFM.card) === -1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.NO_SUCH_MARKET_CARD");
                    return result;
                } else {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            }

            //Check and set refill.
            if (subIFM.refill) {
                if (! cloned.variants.includes("refills") ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.NO_REFILLS");
                    return result;
                } else if ( s === 2 ) {//refilling only happens in the original 3-move sequence, before the third move.
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.TOO_LATE_FOR_REFILL");
                    return result;
                } else if ( s < moves.length - 1 ) {//refill request needs to end the sequence
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.TOO_EARLY_FOR_REFILL");
                    return result;
                } else if ( cloned.getTrueDeckSize() + cloned.discards.length === 0 ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.NO_CARDS_FOR_REFILL");
                    return result;
                } else {
                    refill = true;
                }
            }
            
            let complete = false;

            //Check if we need to parse this as a partial move.
            if (s < moves.length - 1 || allcomplete)
                complete = true;

            //Check cards.
            //(The case remaining with no card is falling back at no profit.)
            if (subIFM.card) {
                if (subIFM.forward && cloned.getFullHand(cloned.currplayer).indexOf(subIFM.card) < 0 ) {
                    //Bad hand card.
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.NO_SUCH_HAND_CARD", {card: subIFM.card});
                    return result;
                } else if (!subIFM.forward && cloned.market.indexOf(subIFM.card) < 0 ) {
                    //Bad card? Unless...
                    if ( cloned.getFullHand(cloned.currplayer).indexOf(subIFM.card) > -1 ) {
                        //The player clicked on a hand card to start the next move.
                        //We use autocompletion to patch up this case.
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;

                        //Trim the card off the end of the submone to start another.
                        result.autocomplete = m.substring(0,m.lastIndexOf(subIFM.card) - 1) + "/" + subIFM.card + ":";

                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.frogger.NO_SUCH_MARKET_CARD", {card: subIFM.card});
                        return result;
                    }
                }
            }

            //Check moves.
            //There is no case remaining without moves, except partials.
            if ( ! subIFM.from ) {
                if ( ! complete ) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.frogger.PIECE_NEXT");

                    //Internal autocompletion:
                    if (subIFM.card && (cloned.countColumnFrogs() + cloned.countColumnFrogs(true) === 6)) {
                        //If no frogs are on the road, the choice of frog is clear.
                        result.autocomplete = m + cloned.coords2algebraic(0, cloned.currplayer) + "-";
                    }
                    
                    return result;
                } else {
                    //Reachable if an unblocked player submits the blocked move.
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.INVALID_MOVE", {move: submove});
                    return result;
                }
            }

            //Check frog.
            //(Once we have a move from, we have a frog.)
            const frog = cloned.board.get(subIFM.from!);

            //Check frog existence and ownership.
            if (!frog || frog!.charAt(1)! !== cloned.currplayer.toString() ) {
                //Bad frog.
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.INVALID_FROG");
                return result;
            }

            //Check frog location.
            //(Frogs cannot leave home.)
            const fromX = cloned.algebraic2coords(subIFM.from)[0];
            if (fromX === cloned.columns - 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.NO_RETURN");
                return result;
            } else if (fromX === 0 && !subIFM.forward) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.INVALID_HOP_BACKWARD_EXCUSE");
                return result;
            }

            if ( ! subIFM.to ) {
                if ( ! complete ) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.frogger.PLACE_NEXT");

                    //Internal autocompletion:
                    let targets:string[] = subIFM.forward ? cloned.getNextForwardsForCard(subIFM.from, subIFM.card!) : cloned.getNextBack(subIFM.from);
                    //Can sometimes get duplicate targets, so uniquify.
                    targets = [...new Set(targets)];
                    if (targets.length === 1) {
                        result.autocomplete = m + targets[0] + (subIFM.forward ? "/" : "");
                    }
                    
                    return result;
                } else {
                    //malformed, no longer reachable.
                    throw new Error("Received malformed IFMove from parser.  This should never happen!");
                }
            }

            //Check target location is on the board.
            if ( !cloned.suitboard.has(subIFM.to) && cloned.getUnsuitedCells().indexOf(subIFM.to) < 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.OFF_BOARD");
                return result;
            }
            //The source location was tested for frogs so must have been on the board.

            //On to to testing.
            const toX = cloned.algebraic2coords(subIFM.to)[0];

            //It's my interpretation of the rules that you must change cards on a move,
            // not just change space, but I'm not 100% sure about that.
            if (fromX === toX) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.MUST_MOVE");
                return result;  
            }

            //Test the move direction (determined from move structure) against the actual cells provided.
            if (subIFM.forward && toX < fromX) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.MUST_HOP_FORWARD");
                return result;
            } else if (!subIFM.forward && toX > fromX) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.frogger.CARD_FIRST");
                return result;
            }

            //Moving back tests.
            if (!subIFM.forward) {
                if ( !cloned.checkNextBack(subIFM.from, subIFM.to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.frogger.INVALID_HOP_BACKWARD");
                    return result;
                }
                if (subIFM.card) {
                    // We already checked it was in the market.
                    // Suit check on moving backward.
                    if ( !cloned.checkWhiteMarket(subIFM.card, subIFM.to) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.frogger.INVALID_MARKET_CARD");
                        return result;
                    } else {
                        // If we have a valid card, a move back is complete.
                        complete = true;
                    }
                } else if (!complete && cloned.market.length > 0) {
                    // No card.  May be a partial move, or can back up without a card.
                    // We don't autocomplete market picks because it's always optional.
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    if (s < cloned.nummoves - 1)
                        result.message = i18next.t("apgames:validation.frogger.CARD_NEXT_OR");
                    else
                        result.message = i18next.t("apgames:validation.frogger.CARD_NEXT");
                    return result;
                }
            }

            //Moving forward tests.
            if (subIFM.forward && !cloned.checkNextForward(subIFM.from, subIFM.to, subIFM.card!)) {
                result.valid = false;
                if (cloned.variants.includes("advanced"))
                    result.message = i18next.t("apgames:validation.frogger.INVALID_HOP_FORWARD_ADVANCED");
                else
                    result.message = i18next.t("apgames:validation.frogger.INVALID_HOP_FORWARD");
                return result;
            }

            if (s < moves.length - 1) {
                //Passed all tests so make the submove (for validating the rest of the move).
                //Card adjustments.
                if (subIFM.forward) {
                    cloned.popHand(subIFM.card!);

                    //Also pop other frogs if it's a crown or ace.
                    cloned.moveNeighbors(subIFM.to,subIFM.card!);
                } else if (subIFM.card) {
                    cloned.popMarket(subIFM.card);
                }

                if (subIFM.from && subIFM.to) {
                    //Frog adjustments, complicated by frog piles.
                    cloned.moveFrog(subIFM.from, subIFM.to);
                }
                
            } else if ( s === moves.length - 1 ) {
                //Pass completion status to outside.
                allcomplete = complete;
            }
        }

        //Really really done.
        result.valid = true;
        result.canrender = true;
        result.complete = (allcomplete && moves.length === this.nummoves) ? 1 : 0;
        if (refill)
            result.message = i18next.t("apgames:validation.frogger.VALID_REFILL", {count: 3 - moves.length});
        else
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        
        return result;
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): FroggerGame {
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
        }

        this.results = [];
        this.frames = [];

        let marketEmpty = false;
        let refill = false;
        let remaining: number;
        const frameDiscards: string[] = [];

        if ( m === "pass") {

            //Passes only happen in the rare blocked w/no pool situation,
            //  or in the context of the refill option. 
            //Besides the forced passes, the original player can pass
            //  once he sees the market and (perhaps) doesn't like it.
            //In that case, we need to clean up (below).
            
            if ( this.variants.includes("refills") && this.skipto !== undefined && this.skipto === this.currplayer) {
                //Player passed during refill turn.
                this.results.push({type: "pass", why: "to complete their partial turn"});
            } else if (this.checkBlocked() && this.market.length === 0) {
                this.results.push({type: "pass", why: "because they were blocked and there were no cards in the draw pool"});
            } else {
                this.results.push({type: "pass", why: "to permit refilling the draw pool"});
            }
        } else {

            this.frames.push({
                board: new Map(this.board),
                market: [...this.market],
                discards: []
            });

            const steps = m.split("/");
            
            for (let s = 0; s < steps.length; s++) {

                //Really only need these on a final partial submove
                //but it's simpler to do it every submove.
                this._highlight = [];
                this._points = [];
                
                const step = steps[s];
                if ( step === "" )
                    continue;

                const results: APMoveResult[] = [];

                const subIFM = this.parseMove(step);

                if (subIFM.refill) {
                    refill = true;
                    this._button = false;
                }

                //Make the step move.
                //Possible card adjustments.
                if (subIFM.forward && subIFM.card) {
                    if (subIFM.from && subIFM.to) {
                        this.popHand(subIFM.card);
                        frameDiscards.push(subIFM.card);
                        results.push({type: "move", from: subIFM.from, to: subIFM.to, what: subIFM.card, how: "forward"});
                        const bounced = this.moveNeighbors(subIFM.to,subIFM.card);
                        bounced.forEach( ([from, to]) => {
                            results.push({type: "eject", from: from, to: to, what: "a Crown or Ace"});
                        });
                    } else if (subIFM.from) {
                        //Partial.  Highlight the frog.
                        this._points.push(subIFM.from);
                        //Highlight possible moves.
                        const forwardPoints = this.getNextForwardsForCard(subIFM.from, subIFM.card);
                        forwardPoints.forEach(cell => this._points.push(cell));
                    } else {
                        //Partial no points.
                    }
                } else if (subIFM.card) {
                    marketEmpty = this.popMarket(subIFM.card);
                    
                    if (subIFM.from) {
                        results.push({type: "move", from: subIFM.from, to: subIFM.to!, what: subIFM.card!, how: "back"});
                    }
                } else if (subIFM.to) {
                    if (partial) {
                        //Highlight available market cards.
                        this._highlight = this.getWhiteMarket(subIFM.to);
                    } else {
                        results.push({type: "move", from: subIFM.from!, to: subIFM.to, what: "no card", how: "back"});
                    }
                } else if (subIFM.from) {
                    //Partial.  Highlight the frog.
                    this._points.push(subIFM.from);
                    //Highlight possible moves.
                    const backwardPoints = this.getNextBack(subIFM.from);
                    backwardPoints.forEach(cell => this._points.push(cell));
                } else {
                    //Would be the empty move but that's already covered.
                }

                if (subIFM.from && subIFM.to) {
                    this.moveFrog(subIFM.from,subIFM.to);
                }

                if (refill) {
                    remaining = 2 - s;
                    break;
                }

                if (subIFM.card) {
                    //In this situation we only highlight a single card,
                    //but we need an array to highlight legal market cards.
                    this._highlight = [subIFM.card];
                }

                // group the results for each step together
                this.results.push({type: "_group", who: this.currplayer, results: results as [APMoveResult, ...APMoveResult[]]});
                // store current board, market, and discards in frames
                this.frames.push({
                    board: new Map(this.board),
                    market: [...this.market],
                    discards: frameDiscards
                })
            }

            //We may leave the last frame in case of crocodile action, so just check the results length for now.
            if (this.results.length + 1 !== this.frames.length) {
                throw new Error(`There's a mismatch in the length of the results array and the frames array. This should never happen.`);
            } else if (!this.variants.includes("crocodiles") || this.currplayer as number !== this.numplayers || this.skipto) {
                //We don't need the last frame.
                this.frames.pop();
            }
        }

        if (partial || emulation) { return this; }

        if (refill) {
            //Set skipto and nummoves.
            //Don't progress crocodiles.
            //Skip to my lou.
            //After the new turn, we'll need to update nummoves, skipto, and crocs.
            this.results.push({type: "announce", payload: [remaining!]});
            this.skipto = this.currplayer;
            this.nummoves = remaining!;

        } else {

            //If this was the refill turn, unset skipto and nummoves,
            //  regardless of whether currplayer passed or moved.
            if ( this.variants.includes("refills") && this.skipto !== undefined && this.skipto === this.currplayer) {
                this.skipto = undefined;
                this.nummoves = 3;
            }

            //update crocodiles if croccy but don't add a frame.
            if (this.variants.includes("crocodiles") && this.currplayer as number === this.numplayers && !this.skipto) {
                this.results.push({type: "declare"});
                //Advance the crocodiles.
                const victims = this.popCrocs();
                //Memorialize any victims.
                victims.forEach( ([from, to]) => {
                    this.results.push({type: "eject", from: from, to: to, what: "crocodiles"});
                });
            }
        }

        //update market if necessary.  No longer emulating here.
        if (marketEmpty || this.variants.includes("continuous")) {
            const refilled = this.refillMarket();
            let description = "";
            if (refilled < 6)
                description = (refilled === 0 ? "not" : "only partly");
            //Would prefer to add this to the last step here but typescript disagreed.
            this.results.push({type: "deckDraw", what: description});
        }
        
        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): FroggerGame {
        //You can only win on your own turn.
        let prevplayer = this.currplayer - 1;
        if (prevplayer < 1) {
            prevplayer = this.numplayers;
        }
        
        if ( this.countColumnFrogs(true, prevplayer as playerid) === 6 ) {
            this.gameover = true;
            this.winner.push(prevplayer as playerid);
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(opts?: {strip?: boolean, player?: number}): IFroggerState {
        const state: IFroggerState = {
            game: FroggerGame.gameinfo.uid,
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
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    mstate.closedhands[p-1] = mstate.closedhands[p-1].map(c => "");
                }
                return mstate;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: FroggerGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            skipto: this.skipto,
            lastmove: this.lastmove,
            board: new Map(this.board),
            closedhands: this.closedhands.map(h => [...h]),
            hands: this.hands.map(h => [...h]),
            market: [...this.market],
            discards: [...this.discards],
            nummoves: this.nummoves,
            frames: this.frames ? deepclone(this.frames) : [],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep[] {

        //Set up constants applicable to all frames.

        const plainPieces = (opts === undefined || opts.altDisplay === undefined || opts.altDisplay !== "frog-pieces");
        
        //Colors taken from the decktet sheet.
        const suitColors = ["#c7c8ca","#e08426","#6a9fcc","#bc8a5d","#6fc055","#d6dd40"];
        
        //Build blocked sting.
        const blocked = [];
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.columns; col++) {
                const cell = this.coords2algebraic(col, row);
                if (row === 0) {
                    //Blocking not working here?  Probably because they're pieces.
                    blocked.push({col: col, row: row} as RowCol);
                } else if (col === 0 || col === this.columns - 1) {
                    if (row > this.numplayers)
                        blocked.push({col: col, row: row} as RowCol);
                } else if (! this.suitboard.has(cell) ) {
                    blocked.push({col: col, row: row} as RowCol);
                }
            }
        }

        // build claimed markers
        const markers: (MarkerFlood|MarkerGlyph)[] = [];

        markers.push({
            type: "glyph",
            glyph: "start",
            points: [{row: 0, col: 0}],
        });
        markers.push({
            type: "glyph",
            glyph: "home",
            points: [{row: 0, col: this.columns - 1}],
        });

        // add flood markers for the start and end columns
        const points = [];
        for (let row = 0; row <= this.numplayers; row++) {
            points.push({col: 0, row: row} as RowCol);
            points.push({col: this.columns - 1, row: row} as RowCol);
        }
        markers.push({
            type: "flood",
            colour: "_context_fill_",
            opacity: (plainPieces ? 0.05 : 0.15),
            points: points as [RowCol, ...RowCol[]],
        });

        //Need card info on all cards.
        const allcards = [...cardsBasic];
        allcards.push(...cardsExtended.filter(c => c.rank.uid === this.pawnrank));
        if (this.variants.includes("courts"))
            allcards.push(...cardsExtended.filter(c => c.rank.uid === this.courtrank));
        
        //add flood and suit markers for the active spaces
        for (let col = 1; col < this.columns - 1; col++) {
            const cell = this.coords2algebraic(col,0);
            const card = this.board.get(cell)!;
            const cardObj = Card.deserialize(card);
            if (cardObj === undefined) {
                throw new Error(`Could not deserialize the card ${card} in render.`);
            }
            const suits = cardObj!.suits;

            let shadeRow = 1;
            suits.forEach(suit => {
                const color = suitColors[suitOrder.indexOf(suit.uid)];
                markers.push({
                    type: "flood",
                    colour: color,
                    opacity: 0.33,
                    points: [{row: shadeRow, col: col}],
                });
                markers.push({
                    type: "glyph",
                    glyph: suit.uid,
                    points: [{row: shadeRow, col: col}],
                });
                shadeRow++;
            });
        }
        
        // build legend of ALL cards
        const legend: ILegendObj = {};
        for (const card of allcards) {
            let glyph = card.toGlyph();
            if (this._highlight.indexOf(card.uid) > -1) {
                glyph = card.toGlyph({border: true, fill: {
                    func: "flatten",
                    fg: "_context_labels",
                    bg: "_context_background",
                    opacity: 0.2
                }});
            } 
            legend["c" + card.uid] = glyph;
        }
        
        const excuses = [...cardsExtended.filter(c => c.rank.uid === "0")];
        
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

        legend["start"] = excuses[0].toGlyph();

        //Home symbol for the last column.
        legend["home"] = {
            name: "streetcar-house",
            scale: 0.75
        };

        //Player pieces.
        for (let player = 1; player <= this.numplayers; player++) {

            if (plainPieces) {
                legend["X" + player] = {
                    name: "piece",
                    colour: player,
                    scale: 0.75
                }
            } else {
                legend["X" + player] = [
                    {
                        name: "piece-borderless",
                        colour: "_context_background",
                        opacity: 0.55
                    },
                    {
                        name: "frog",
                        colour: player,
                        rotate: 90
                    }
                ]
            }
            
            //The XP-1 token is used in the first and last rows.
            for (let count = 1; count <= 6; count++) {

                if (plainPieces) {
                    legend["X" + player + "-" + count] = [
                        {
                            name: "piece",
                            colour: player,
                            scale: 0.75,
                            opacity: 0.75
                        },
                        {
                            text: count.toString(),
                            colour: "_context_labels",
                            scale: 0.70
                        }
                    ]
                } else {
                    legend["X" + player + "-" + count] = [
                        {
                            name: "frog",
                            colour: player,
                            scale: 1.1,
                            opacity: 0.75
                        },
                        {
                            text: count.toString(),
                            colour: "_context_labels",
                            scale: 0.60
                        }
                    ]
                }
                
            }
        }

        if (this.variants.includes("crocodiles")) {
            legend["X0"] = [
                {
                    name: "piece-borderless",
                    colour: "_context_background",
                    scale: 0.85,
                    opacity: 0.55
                },
                {
                    text: "\u{1F40A}",
                    scale: 0.85
                }
            ]
        }

        if (this.variants.includes("refills")) {
            legend["refill"] = [
                {
                    text: "\u{1F504}",
                    scale: 1.25
                }
            ]
        }

        //Suit glyphs.
        for (const suit of suits) {
            legend[suit.uid] = {
                name: suit.glyph,
                scale: 1,
                opacity: 0.33
            }
        };



        //The beginning of state-dependent display.
        const renders: APRenderRep[] = [];
        if (this.frames === undefined)
            this.frames = [];

        // look at each frame, and then finally the base state
        for (let i = 0; i < this.frames.length + 1; i++) {
            let board: Map<string, string>;
            let market: string[];
            let discards: string[];
            if (i < this.frames.length) {
                board = this.frames[i].board;
                market = this.frames[i].market;
                discards = this.frames[i].discards;
            } else {
                board = this.board;
                market = this.market;
                discards = this.discards;
            }
            let results: APMoveResult[] = [];
            if (i > 0 && this.results.length > 0) {
                const group = this.results[i-1];
                if (group !== undefined && group.type === "_group") {
                    //throw new Error(`The only results that should be present are _group results!`);
                    results = group.results;
                } else if (group !== undefined) {
                    results = [group];
                }
            }

            if (i === this.frames.length && this.results.length > i - 1) {
                //add any extra (ungrouped) results
                for (let r = i; r < this.results.length; r++) {
                    results.push(this.results[r]);
                }
            }

            // Build piece string.
            let pstr = "";
            for (let row = 0; row < this.rows; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                const pieces: string[] = [];
                for (let col = 0; col < this.columns; col++) {
                    const cell = this.coords2algebraic(col, row);

                    if (board.has(cell)) {
                        if (row === 0) 
                            pieces.push("c" + board.get(cell)!);
                        else
                            pieces.push(board.get(cell)!);
                    } else {
                        pieces.push("-");
                    }

                }

                pstr += pieces.join(",");
            }

            // build pieces areas
            const areas: AreaPieces[] = [];

            if (i === this.frames.length) {
                //Only display this stuff on the last frame
                for (let p = 1; p <= this.numplayers; p++) {
                    const hand = this.getFullHand(p as playerid);
                    if (hand.length > 0) {
                        areas.push({
                            type: "pieces",
                            pieces: hand.map(c => "c" + (c === "" ? "UNKNOWN" : c)) as [string, ...string[]],
                            label: i18next.t("apgames:validation.frogger.LABEL_STASH", {playerNum: p}) || `P${p} Hand`,
                            spacing: 0.5,
                            ownerMark: p
                        });
                    }
                }
            }

            if (market.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: market.map(c => "c" + c) as [string, ...string[]],
                    label: i18next.t("apgames:validation.frogger.LABEL_MARKET") || "Market",
                    spacing: 0.375,
                });
            } else if ( this.variants.includes("refills") && this._button ) {
                areas.push({
                    type: "pieces",
                    pieces: ["refill"],
                    label: i18next.t("apgames:validation.frogger.LABEL_MARKET") || "Market",
                    spacing: 0.375,
                });
            }

            if (discards.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: discards.map(c => "c" + c) as [string, ...string[]],
                    label: i18next.t("apgames:validation.frogger.LABEL_DISCARDS") || "Discards",
                    spacing: 0.25,
                    width: this.columns + 2,
                });
            }

            if (i === this.frames.length) {
                //Only display this stuff on the last frame

                // create an area for all visible cards (if there are any cards left)
                const hands = this.hands.map(h => [...h]);
                const closedhands = this.closedhands.map(h => [...h]).flat().filter(c => c !== "");
                const visibleCards = [...this.getBoardCards(), ...hands.flat(), ...this.market, ...this.discards, ...closedhands].map(uid => Card.deserialize(uid));

                if (visibleCards.includes(undefined)) {
                    throw new Error("Could not deserialize one of the cards. This should never happen!");
                }

                const remaining = allcards.sort(cardSortAsc).filter(c => visibleCards.find(cd => cd!.uid === c.uid) === undefined).map(c => "c" + c.uid) as [string, ...string[]]
                if (remaining.length > 0) {
                    areas.push({
                        type: "pieces",
                        label: i18next.t("apgames:validation.frogger.LABEL_REMAINING") || "Cards in deck",
                        spacing: 0.25,
                        width: this.columns + 2,
                        pieces: remaining,
                    });
                }
            }

            // Build rep
            const rep: APRenderRep =  {
                options: ["hide-labels-half"],
                board: {
                    style: "squares",
                    width: this.columns,
                    height: this.rows,
                    tileHeight: 1,
                    tileWidth: 1,
                    tileSpacing: 0.1,
                    strokeOpacity: 0,
                    blocked: blocked as [RowCol, ...RowCol[]],
                    markers,
                },
                legend,
                pieces: pstr,
                areas,
            };

            // Add annotations
            rep.annotations = [];

            if (results.length > 0) {
                for (const move of results) {
                    if (move.type === "move") {
                        const [fromX, fromY] = this.algebraic2coords(move.from!);
                        const [toX, toY] = this.algebraic2coords(move.to!);
                        if (move.how === "back")
                            rep.annotations.push({type: "move",  style: "dashed", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                        else
                            rep.annotations.push({type: "move",  targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    } else if (move.type === "claim") {
                        //TODO: cross off the market card when partial?
                    } else if (move.type === "eject") {
                        const [fromX, fromY] = this.algebraic2coords(move.from!);
                        const [toX, toY] = this.algebraic2coords(move.to!);
                        if (move.what === "crocodiles") {
                            rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX},{row: toY, col: toX}], opacity: 0.9, colour: "#FE019A"});
                            rep.annotations.push({type: "exit", targets: [{row: fromY, col: fromX}], occlude: false, colour: "#FE019A"});
                        } else {
                            rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX},{row: toY, col: toX}]});
                            rep.annotations.push({type: "exit", targets: [{row: fromY, col: fromX}]});
                        }
                    }
                }
            }

            if (this._points.length > 0) {
                const pts = this._points.map(c => this.algebraic2coords(c));

                //The first point is always the frog, so render it more visibly.
                const points: {row: number, col: number}[] = [];
                const point = pts.shift()!;
                rep.annotations.push({type: "exit", targets: [{ row: point[1], col: point[0] }]});
                //The type requires contents so test.
                if (pts.length > 0) {
                    for (const coords of pts) {
                        points.push({ row: coords[1], col: coords[0] });
                    }
                    //Do both for visibility.
                    rep.annotations.push({type: "dots", size: 0.33, colour: "_context_background", opacity: 0.66, targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
                    rep.annotations.push({type: "dots", colour: "_context_annotations", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
                }
            }

            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }

            renders.push(rep);

        }
        return renders;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let chatstring: string = "";
        let resolved = false;
        if (r.type !== "_group") {
            chatstring = this.chatHelper(r, player);
            if (chatstring !== "") {
                node.push(chatstring);
                resolved = true;
            }
        } else {
            for (const nested of r.results) {
                chatstring = this.chatHelper(nested, player);
                if (chatstring !== "") {
                    node.push(chatstring);
                    resolved = true;
                }
            }
        }

        return resolved;
    }

    public chatHelper(r: APMoveResult, player: string): string {

        switch (r.type) {
            case "announce":
                return i18next.t("apresults:ANNOUNCE.frogger", {player, moves: (r.payload as string[]).join("") });
            case "claim":                
                return i18next.t("apresults:CLAIM.frogger", {player, card: r.what});
            case "deckDraw":
                return i18next.t("apresults:DECKDRAW.frogger", {what: r.what});
            case "declare":
                return i18next.t("apresults:DECLARE.frogger");
            case "eject":                
                if (r.what === "crocodiles") {
                    return i18next.t("apresults:EJECT.frogger_croc", {player, from: r.from, to: r.to});
                } else {
                    return i18next.t("apresults:EJECT.frogger_card", {player, from: r.from, to: r.to});
                }
            case "move":
                if (r.how === "forward") {
                    return i18next.t("apresults:MOVE.frogger_forward", {player, from: r.from, to: r.to, card: r.what});
                } else if (r.how === "back") {
                    return i18next.t("apresults:MOVE.frogger_back", {player, from: r.from, to: r.to, card: r.what});
                } else {
                    return i18next.t("apresults:MOVE.frogger_blocked", {player, card: r.what});
                }
            case "pass":                
                return i18next.t("apresults:PASS.frogger", {player, why: r.why});
            case "eog":                
                return i18next.t("apresults:EOG.default");
        }
        return "";
    }

    public clone(): FroggerGame {

        return Object.assign(new FroggerGame(this.numplayers), deepclone(this) as FroggerGame);
    }
}
