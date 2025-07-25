import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Colourfuncs, Glyph, MarkerGlyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { diagDirections, Direction, oppositeDirections, orthDirections, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Deck, cardsBasic, cardsExtended, suits } from "../common/decktet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Mode = "place"|"collect";
export type Suit = "M"|"S"|"V"|"L"|"Y"|"K";
export type location = [number, number];

const suitOrder = ["M","S","V","L","Y","K"];
const crowdedRanks = ["Pawn","Court"];
const columns = 7;
const rows = 6;
const maxdim = 7;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    mode: Mode;
    board: Map<string, string>;
    market: string[];
    occupied: Map<string, playerid>;
    collected: [number[], number[]];
    lastmove?: string;
    eliminated?: playerid;
};

export interface IDeckfishState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export class DeckfishGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Deckfish",
        uid: "deckfish",
        playercounts: [2],
        version: "20250724",
        dateAdded: "2025-07-24",
        // i18next.t("apgames:descriptions.deckfish")
        description: "apgames:descriptions.deckfish",
        // i18next.t("apgames:notes.deckfish")
        notes: "apgames:notes.deckfish",
        urls: [
            "http://wiki.decktet.com/game:deckfish",
            "https://boardgamegeek.com/boardgame/432405/deckfish",
        ],
        people: [
            {
                type: "designer",
                name: "Alfonso Velasco (Donegal)",
                urls: [],
                apid: "7dbbcf14-42b8-4b4a-87aa-17c35b9852f4",
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        categories: ["goal>score>eog", "mechanic>move", "mechanic>place", "mechanic>random>setup", "mechanic>set", "board>shape>rect", "board>connect>rect", "components>decktet"],
        flags: ["scores", "random-start", "custom-randomization", "autopass", "experimental"],
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, rows);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, rows);
    }
    public loc2algebraic(loc: location): string {
        return DeckfishGame.coords2algebraic(loc[0], loc[1]);
    }
    public algebraic2loc(cell: string): location {
        return DeckfishGame.algebraic2coords(cell);
    }
    public coord2algebraic(m: number): string {
        return "m" + (m + 1);
    }
    public algebraic2coord(cell: string): number {
        return parseInt(cell.substring(1),10) - 1;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public mode!: Mode;
    public board!: Map<string, string>;
    public market!: string[];
    public occupied!: Map<string, playerid>;
    public collected!: [number[], number[]];
    public eliminated?: playerid;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlights: string[] = [];
    private tableau: number[][] = new Array(columns).fill(-1).map(() => 
        new Array(rows).fill(-1));

    constructor(state?: IDeckfishState | string) {
        super();
        if (state === undefined) {

            // init deck
            const cards = [...cardsBasic, ...cardsExtended];

            const deck = new Deck(cards);
            deck.shuffle();

            // init board
            const board = new Map<string, string>();

            for (let x = 0; x < columns; x++) {
                for (let y = 0; y < rows; y++) {
                    const cell = DeckfishGame.coords2algebraic(x, y);
                    if (!board.has(cell)) {
                        const [card] = deck.draw();
                        board.set(cell, card.uid);
                    }
                }
            }

            const market = new Array<string>();
            for (let m = 0; m < 3; m++) {
                const [card] = deck.draw();
                market.push(card.uid);
            }
 
            // init positions
            const occupied = new Map<string, playerid>();
            const mode = "place";

            const fresh: IMoveState = {
                _version: DeckfishGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                mode,
                board,
                market,
                occupied,
                collected: [[0,0,0,0,0,0],[0,0,0,0,0,0]],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDeckfishState;
            }
            if (state.game !== DeckfishGame.gameinfo.uid) {
                throw new Error(`The Deckfish engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DeckfishGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.mode = state.mode;
        this.board = new Map(state.board);
        this.market = [...state.market];
        this.occupied = new Map(state.occupied);
        this.collected = [[...state.collected[0]], [...state.collected[1]]];
        this.lastmove = state.lastmove;
        this.eliminated = state.eliminated;

        if (this.mode === "collect")
            this.populateTableau();

        return this;
    }

    /* helper functions for general gameplay */

    public canMoveFrom(cell: string): boolean {
        if (this.occupied.has(cell) && this.occupied.get(cell) === this.currplayer)
            return true;
        else
            return false;
    }

    public canMoveTo(fromCell: string, toCell: string): boolean {
        //This is going to get complicated.

        //Low-hanging fruit.
        if (! this.board.has(toCell)) {
            //Cannot land in the gaps.
            return false;
        } 
        const card = this.getCardFromCell(toCell);
        if (card.rank.name === "Excuse") {
            //Cannot land on the Excuse.
            return false;
        }
        
        //Need to check the move.
        
        const suits = this.getSuits(fromCell);

        const fromLoc = this.algebraic2loc(fromCell);
        const toLoc = this.algebraic2loc(toCell);

        const targets = this.assembleTargets(fromLoc, suits)!;
        const toTarget = targets.filter(loc => (loc[0] === toLoc[0] && loc[1] === toLoc[1]));

        return (toTarget.length > 0);
    }

    public canPlace(cell: string): boolean {
        if (this.occupied.has(cell)) {
            return false;
        }
        if (this.board.has(cell)) {
            const card = this.getCardFromCell(cell);
            if (card.rank.name === "Ace" || card.rank.name === "Crown") {
                return true;
            } else
                return false;
        } else
            return false;
    }

    public canSwap(cell: string, market: string): boolean {
        return true;
    }

    public getCardFromCell(cell: string): Card {
        if (this.board.has(cell)) {
            return this.getCardFromUID(this.board.get(cell)!);
        } else if (cell[0] === "m") {
            //The market is always fully populated.
            return this.getCardFromUID(this.market[this.algebraic2coord(cell)]!);
        } else {
            //To keep things defined, we return the Excuse.
            throw new Error(`The cell has no card: ${cell}.`);
            return this.getCardFromUID("0");
        }
    }

    public getCardFromUID(uid: string): Card {
        return Card.deserialize(uid)!;
    }

    /* end helper functions for general gameplay */

    /* suit-based movement logic */

    private bounce(fromCell: string, toCell: string): string {
        //Moves the occupant out of the way when toCell is occupied.

        //We know this.occupied.has(toCell).
        const bouncePlayer = this.occupied.get(toCell!)!;

        //Convert to locations for easier calculating.
        const fromLoc = this.algebraic2loc(fromCell);
        const toLoc = this.algebraic2loc(toCell);
        let bounceLoc = toLoc.slice() as location;

        if (fromLoc[0] === toLoc[0]) {
            if (fromLoc[1] > toLoc[1])
                bounceLoc[1] = toLoc[1] - 1;
            else
                bounceLoc[1] = toLoc[1] + 1;
        } else {//fromLoc[1] === toLoc[1]
            if (fromLoc[0] > toLoc[0])
                bounceLoc[0] = toLoc[0] - 1;
            else
                bounceLoc[0] = toLoc[0] + 1;
        }
        const bounceCell = this.loc2algebraic(bounceLoc);
        this.occupied.set(bounceCell,bouncePlayer);

        return bounceCell;
    }

    private getSuits(cell: string): string[] {
        const card = this.getCardFromCell(cell);
        const suits = card.suits.map(s => s.name);
        return suits;
    }

    private getTableau(loc: location): number {
        return this.tableau[loc[0]][loc[1]];
    }

    private getNext(loc: location, dir: Direction): location {
        //Get the next location in a compass direction, not checked.
        const nextLoc = loc.slice() as location;
        switch (dir) {
            case "N":
                nextLoc[1]--;
                break;
            case "NE":
                nextLoc[1]--;
            case "E":
                nextLoc[0]++;
                break;
            case "SE":
                nextLoc[0]++;
            case "S":
                nextLoc[1]++;
                break;
            case "SW":
                nextLoc[1]++;
            case "W":
                nextLoc[0]--;
                break;
            case "NW":
                nextLoc[1]--;
                nextLoc[0]--;
                break;
            default:
                throw new Error(`The direction is invalid: ${dir}.`);
        }

        return nextLoc!;
    }

    private populateTableau(): void {
        //Abstract the data structure to only what is needed for movement.
        for (let x = 0; x < columns; x++) {
            for (let y = 0; y < rows; y++) {
                //The tableau was initialized to all -1's (gaps).  
                const cell = DeckfishGame.coords2algebraic(x, y);
                if (this.board.has(cell)) {
                    // Revise card spaces: 2 is occupied, 1 is unoccupied, 0 is the Excuse.
                    if (this.occupied.has(cell)) {
                        //The card is occupied by a piece.
                        this.tableau[x][y] = 2;
                    } else {
                        //There's an unoccupied card.
                        const card = this.getCardFromCell(cell);
                        //Check for excuse.
                        if (card.rank.name === "Excuse")
                            this.tableau[x][y] = 0;
                        else
                            this.tableau[x][y] = 1;
                    }
                }
            }
        }
    }

    private checkUnoccupied(loc: location): boolean {
        //Check the location is on the board and a legal intermediate/target.
        return (this.onBoard(loc) && this.getTableau(loc) === 1);
    }

    private checkOccupied(loc: location): boolean {
        //Check the location is on the board and occupied (for wyrming).
         return (this.onBoard(loc) && this.getTableau(loc) === 2);
    }

    private checkSolitary(loc: location, source: Direction): boolean {
        //Check the target location is surrounded on all non-source,
        //onBoard sides by unoccupied cards,
        //regardless of source and target contents which are checked elsewhere.
        for (const dir of orthDirections) {
            if (dir !== source) {
                const neighbor = this.getNext(loc,dir);
                if (!this.onBoard(neighbor))
                    continue;
                else {
                    const tabValue = this.getTableau(neighbor);
                    if (tabValue === 2 || tabValue === 0)
                        return false;
                    else 
                        continue;
                }
            }
        }
        //If we found no neighbors, the space is solitary.
        return true;
    }

    private checkGap(loc: location): boolean {
        //Check the location is on the board and a gap (for moon jumping).
        return (this.onBoard(loc) && this.getTableau(loc) === -1);
    }

    private isBlockage(loc: location): boolean {
        //Check for the exact edge of the board.
        
        if (loc[0] === -1 || loc[1] === -1 || loc[0] === columns || loc[1] === rows) {
            return true;
        } else if (this.checkUnoccupied(loc)) {
            //an unoccupied card is the only non-blockage in the tableau
            return false;
        } else {
            //This is occupied, a gap, or the Excuse.
            return true;
        }
    }

    private onBoard(loc: location): boolean {
        //Check for leaving the board with movement math.
        if (loc[0] < 0 || loc[1] < 0 || loc[0] >= columns || loc[1] >= rows)
            return false;
        else
            return true;
    }

    private assembleTargets(meepleLoc: location, suits: string[]): location[] {
        //get targets
        let myTargets: location[] = [];
        if (suits.includes('Moons'))
            myTargets = myTargets.concat(this.collectMoonTargets(meepleLoc));
        if (suits.includes('Suns'))
            myTargets = myTargets.concat(this.collectSunTargets(meepleLoc));
        if (suits.includes('Waves'))
            myTargets = myTargets.concat(this.collectWaveTargets(meepleLoc));
        if (suits.includes('Leaves'))
            myTargets = myTargets.concat(this.collectLeafTargets(meepleLoc));
        if (suits.includes('Wyrms'))
            myTargets = myTargets.concat(this.collectWyrmTargets(meepleLoc));
        if (suits.includes('Knots'))      
            myTargets = myTargets.concat(this.collectKnotTargets(meepleLoc));

        return myTargets;
    }

    private collectMoonTargets(meepleLoc: location): location[] {
        let targets: location[] = [];

        for (const dir of orthDirections) {
            let nextLoc = this.getNext(meepleLoc,dir);

            //The first space orthogonally must be a gap.
            if (this.checkGap(nextLoc)) {
                //Check the next space in the current direction.
                for (let a = 2; a < maxdim; a++) {
                    nextLoc = this.getNext(nextLoc,dir);
                    if (this.checkGap(nextLoc)) {
                        continue;
                    } else if (this.checkUnoccupied(nextLoc)) {
                        targets.push(nextLoc);
                        break;
                    } else {
                        //The excuse, an occupied card, or off the board.
                        break;
                    }
                }
            }
        }

        //these are already legal targets and don't need filtering.
        return targets;
    }
    
    private collectSunTargets(meepleLoc: location): location[] {
        let targets: location[] = [];

        for (const dir of diagDirections) {
            const nextLoc = this.getNext(meepleLoc,dir);
            if (this.checkUnoccupied(nextLoc)) {
                targets.push(nextLoc);
                const secondLoc = this.getNext(nextLoc,dir);
                if (this.checkUnoccupied(secondLoc))
                    targets.push(secondLoc);
            } //Otherwise: 
            //if the first space diagonally is off the board, so is the second.
            //if it's is the Excuse or occupied, we cannot reach the second.
        }

        //these are already legal targets and don't need filtering.
        return targets;
    }

    private collectWaveTargets(meepleLoc: location): location[] {
        let targets: location[] = [];

        for (const dir of orthDirections) {
            let candidateLoc = meepleLoc.slice() as location;

            //Check the next space in the current direction.
            for (let a = 1; a < maxdim; a++) {
                candidateLoc = this.getNext(candidateLoc,dir);
                if (! this.checkUnoccupied(candidateLoc))
                    break;
                else {
                    const stopLoc = this.getNext(candidateLoc,dir);
                    if (this.isBlockage(stopLoc)) {
                        targets.push(candidateLoc);
                        break;
                    } 
                }// else continue
            }
        }

        return targets;
    }

    private collectLeafTargets(meepleLoc: location): location[] {
        let targets: location[] = [];

        for (const dir of orthDirections) {
            let nextLoc = meepleLoc.slice() as location;
            //Check the next space in the current direction.
            for (let a = 1; a < maxdim; a++) {
                nextLoc = this.getNext(nextLoc,dir);
                if (this.checkUnoccupied(nextLoc)) {
                    //We don't need to check the space we're coming from.
                    const source = oppositeDirections.get(dir)!;
                    if (this.checkSolitary(nextLoc,source)) {
                        targets.push(nextLoc);
                    } //Else don't push but continue in this direction.
                } else {
                    //Otherwise, it's a gap, the excuse, an occupied card, or off the board.
                    break;
                }
            }
        }

        // legal targets, don't need filtering.
        return targets;
    }

    private collectWyrmTargets(meepleLoc: location): location[] {
        let targets: location[] = [];

        for (const dir of orthDirections) {
            let candidateLoc = meepleLoc.slice() as location;

            //Check the next space in the current direction.
            for (let a = 1; a < maxdim; a++) {
                candidateLoc = this.getNext(candidateLoc,dir);
                if (this.checkOccupied(candidateLoc)) {
                    //Check the rest of the conditions and push or break.
                    const bounceLoc = this.getNext(candidateLoc,dir);
                    if (this.checkUnoccupied(bounceLoc)) {
                        targets.push(candidateLoc);
                    } 
                    break;
                } else if (!this.checkUnoccupied(candidateLoc)) {
                    //In this case we hit the Excuse, a gap, or the edge.
                    break;
                }// else can continue over this card
            }
        }

        return targets;
    }

    private collectKnotTargets(meepleLoc: location): location[] {
        let targets: location[] = [];
        
        //We take three steps, never backwards.
        for (const dir1 of orthDirections) {
            const loc1 = this.getNext(meepleLoc,dir1);
            if (this.checkUnoccupied(loc1)) {
                for (const dir2 of orthDirections) {
                    const source1 = oppositeDirections.get(dir1)!;
                    if (dir2 !== source1) {
                        const loc2 = this.getNext(loc1,dir2)
                        if (this.checkUnoccupied(loc2)) {
                            for (const dir3 of orthDirections) {
                                const source2 = oppositeDirections.get(dir2)!;
                                if (dir3 !== source2) {
                                    const loc3 = this.getNext(loc2,dir3);
                                    if (this.checkUnoccupied(loc3))
                                        targets.push(loc3);
                                }
                            }
                        }
                    }
                }

            }
        }

        return targets;
    }
 
    /* end suit movement logic */

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }

        if (player === undefined) {
            player = this.currplayer;
        }

        if (this.mode === "place" && this.occupied.size === 6) {
            return ["pass"];
        }

        const moves: string[] = [];

        // if placing
        if (this.mode === "place") {
            //push all unoccupied aces and crown on the board
            for (let x = 0; x < columns; x++) {
                for (let y = 0; y < rows; y++) {
                    const cell = DeckfishGame.coords2algebraic(x, y);
                    if (this.board.has(cell) && ! this.occupied.has(cell)) {
                        //There's an unoccupied card.
                        const card = this.getCardFromCell(cell);
                        //Check rank.
                        if (card.rank.name === "Ace" || card.rank.name === "Crown") {
                            moves.push(`${cell}`);
                        }
                    }
                }
            }
        }
        // otherwise collecting
        else {
            this.occupied.forEach((value, cell) => {
                if (value === this.currplayer) {
                    //push all other card cells in row and column
                    const meepleLoc = this.algebraic2loc(cell);
                    const suits = this.getSuits(cell);
                    const targets = this.assembleTargets(meepleLoc,suits);
                    targets.forEach(t => {
                        moves.push(cell + "-" + this.loc2algebraic(t))
                    });
                }
            });
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            // clicking on the market
            if (row < 0 && col < 0) {
                if (! move.includes("-")) {
                    //it's too early to click on the market.
                    //TODO: invalid partial result
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.deckfish.EARLY_TO_MARKET")
                    }
                } else if (move.includes(",")) {
                    //it's too late to click on the market.
                    //TODO: invalid partial result
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.deckfish.LATE_TO_MARKET")
                    }
                } else {
                    newmove = `${move},` + this.coord2algebraic(this.market.indexOf(piece!.substring(1)));
                }
            }
            // otherwise, clicked on the board
            else {
                const cell = DeckfishGame.coords2algebraic(col, row);
                // continuation of placement
                if (this.mode === "place") {
                    //Selecting initial placement location.
                    newmove = `${cell}`;
                } else if (move === "") {
                    //Selecting initial source location.
                    newmove = `${cell}`;
                } else if (move.includes(",")) {
                    //Selecting market target location.
                    newmove = `${move}-${cell}`;
                } else if (! move.includes("-")) {
                    //Selecting move target location.
                    newmove = `${move}-${cell}`;
                } else { 
                    // move includes a dash but not a comma, 
                    // trying to click on the board instead of market first.
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.deckfish.REVERSED_MARKET")
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                //Revert latest addition to newmove.
                result.move = newmove.includes(",") ? newmove.split(",")[0] : (newmove.includes("-") ? newmove.split("-")[0] : ""); 
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.mode === "place") {
                result.message = i18next.t("apgames:validation.deckfish.INITIAL_PLACEMENT_INSTRUCTIONS")
            } else {
                result.message = i18next.t("apgames:validation.deckfish.INITIAL_MOVE_INSTRUCTIONS")
            }
            return result;
        }

        if (m === "pass") {
            if (this.mode === "place") {
                if (this.occupied.size === 6) {
                    //The "pie"-style pass.
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.deckfish.BAD_PASS");
                    return result;
                }
            } else {
                if (this.moves().includes(m)) {
                    //The end of game passes.
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VAILD_MOVE");
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.deckfish.BAD_PASS");
                    return result;
                }
            }
        }

        const [mv, sw] = m.split(",");
        // eslint-disable-next-line prefer-const
        let [frm, to] = mv.split("-");
        //card = card.toUpperCase();

        //Testing placements.
        if (this.mode === "place") {
            if (this.canPlace(frm)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation.deckfish.VALID_PLACEMENT");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.deckfish.INVALID_PLACEMENT");
            }
            return result;
        } 
        //Otherwise, collecting.

        // if `to` is missing, partial
        if (to === undefined || to.length === 0) {
            if (this.canMoveFrom(frm)) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.deckfish.PARTIAL_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.deckfish.INVALID_FROM");
                return result;
            }
        }

        //Otherwise, evaluate the move destination.
        if (! this.canMoveTo(frm,to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.deckfish.INVALID_TO", {cell: to});
            return result;
        }

        //Now, swapping.

        // if `sw` is missing, possibly partial
        if (sw === undefined || sw.length === 0) {
            result.valid = true;
            result.complete = 0;
            result.message = i18next.t("apgames:validation.deckfish.INITIAL_SWAP_INSTRUCTIONS");
            return result;
 
        } else {

            //otherwise
            let [mark, swap] = sw.split("-");

            //A successful market choice is always valid. 
            //Need to check the click?
            const marketCard = this.market[this.algebraic2coord(mark)];

            // if swap is missing, may or not be complete
            if (swap === undefined || swap.length === 0) {
                result.valid = true;
                result.canrender = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.deckfish.PARTIAL_SWAP", {what: marketCard, where: mark});
                return result;
            }
            // otherwise the swap location needs testing.
            else if (! this.board.has(swap)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.deckfish.NO_SWAP", {cell: swap});
                return result;
            } else if (this.occupied.has(swap)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED_SWAP", {cell: swap});
                return result;
            } else {

                // we're good!
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            }
        }
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): DeckfishGame {
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
        this.highlights = [];

        if (m === "pass") {
            if (this.mode === "place") {
                this.results.push({type: "pie"});
                //change the mode.
                this.mode = "collect";
            } else {
                this.results.push({type: "pass"});
                //eliminate the player.
                if (!this.eliminated) {
                    this.eliminated = this.currplayer;
                    this.results.push({type: "announce", payload: []})
                }
            }

        } else {

            const [mv, sw] = m.split(",");
            // eslint-disable-next-line prefer-const
            let [frm, to] = mv.split("-");
 
            const card = this.getCardFromCell(frm);
            if (card === undefined)
                throw new Error(`Could not load the card at ${frm}.`);

            this.highlights.push(card.uid);
           
            if (to !== undefined && to.length > 0) {
                //Remove the card.
 
                this.highlights.push(card.uid);
                if (!partial)
                    this.board.delete(frm);

                this.results.push({type: "move", from: frm, to: to, what: card.uid});

                //Move the piece from
                this.occupied.delete(frm);
                //In the wyrms case, must also bounce another piece out of the way.
                if (this.occupied.has(to)) {
                    const bounceCell = this.bounce(frm, to);
                    this.results.push({type: "eject", from: to, to: bounceCell});
                    const bounceCard = this.getCardFromCell(bounceCell);
                    this.highlights.push(bounceCard.uid);
                }

                //Move the piece to
                this.occupied.set(to, this.currplayer);

                //TODO
                
                //Score the card.
                const newSuits = card.suits.map(s => s.uid as Suit);
                newSuits.forEach(s => {
                    this.collected[this.currplayer - 1][suitOrder.indexOf(s)]++;
                })

                if (sw !== undefined && sw.length > 0) {
                    let [marketCell, swapCell] = sw.split("-");
                    //highlight market card
                    const marketCard = this.market[this.algebraic2coord(marketCell)];
                    this.highlights.push(marketCard);

                    if (swapCell !== undefined && swapCell.length > 0) {
                        //swap market card
                        const swapCard = this.board.get(swapCell)!;
                        this.highlights.push(swapCard);
                        this.market[this.market.indexOf(marketCard)] = swapCard!;
                        this.board.set(swapCell, marketCard);
                        this.results.push({type: "swap", what: marketCard, with: swapCard, where: swapCell});
                    } else {
                        //TODO
                    }
                }
            } else {
                if (this.mode === "place") {
                    this.occupied.set(frm, this.currplayer);
                    this.results.push({type: "place", where: frm});
                } else {
                    //Partial move already illustrated, though a bit flakily.
                }
            }   
        }

        if (partial) { return this; }

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

    protected checkEOG(): DeckfishGame {
        if (this.lastmove === "pass" && this.eliminated == this.currplayer) {
            this.gameover = true;
            const scores: number[] = [];
            for (let p = 1; p <= this.numplayers; p++) {
                scores.push(this.getPlayerScore(p));
            }
            if (scores[0] === scores[1]) {
                //Evaluate tiebreaker.
                this.winner = this.getTieWinner();
            } else {
                //Simple win.
                const max = Math.max(...scores);
                for (let p = 1; p <= this.numplayers; p++) {
                    if (scores[p-1] === max) {
                        this.winner.push(p as playerid);
                    }
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

    public state(opts?: {strip?: boolean, player?: number}): IDeckfishState {
        const state: IDeckfishState = {
            game: DeckfishGame.gameinfo.uid,
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
                }
                return mstate;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: DeckfishGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            mode: this.mode,
            lastmove: this.lastmove,
            eliminated: this.eliminated,
            board: new Map(this.board),
            market: [...this.market],
            occupied: new Map(this.occupied),
            collected: [[...this.collected[0]],[...this.collected[1]]],
        };
    }

    private makeMeeple(opts: {colour?: string|number|Colourfuncs, opacity?: number, adjust?: boolean} = {}): [Glyph, ...Glyph[]] {
        //Build the pieces that we're not calling pawns (because that's a card)
        //or illustrating with meeples (because they looked too busy).
        let opacity = 1;
        if (opts !== undefined && opts.opacity !== undefined) {
            opacity = opts.opacity;
        }
        let colour: string|number|Colourfuncs|undefined;
        if (opts !== undefined && opts.colour !== undefined) {
            colour = opts.colour;
        }
        let adjust = false;
        if (opts !== undefined && opts.adjust !== undefined) {
            adjust = opts.adjust;
        }
        const dy: number = adjust ? -280 : 280;

        const glyph: [Glyph, ...Glyph[]] = [
            {
                name: "piece-square-borderless",
                scale: 1,
                colour: colour,
                opacity: 0,
            },
        ];
        glyph.push({
            name: "ring-13",
            scale: 0.55,
            opacity: opacity === undefined ? 1 : opacity,
            colour: colour, 
            nudge: {
                dx: 280,
                dy: dy,
            }
        });
        return glyph;
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < rows; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < columns; col++) {
                const cell = DeckfishGame.coords2algebraic(col, row);
                if (this.occupied.has(cell)) {
                    const card = this.getCardFromCell(cell);
                    const adjust = crowdedRanks.includes(card.rank.name) ? "H" : "";
                    pieces.push(this.occupied.get(cell) === 1 ? "A" + adjust : "B" + adjust);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // build card markers
        let markers: (MarkerGlyph)[]|undefined;
        markers = [];
        if (this.board.size > 0) {
            for (const [cell, c] of this.board.entries()) {
                const [x,y] = DeckfishGame.algebraic2coords(cell);
                const card = this.getCardFromUID(c);

                markers.push({
                    type: "glyph",
                    glyph: "c" + card.uid,
                    points: [{row: y, col: x}],
                });
            }
        }
        /*
        if (this.occupied.size > 0) {
           for (const [cell,p] of this.occupied.entries()) {
                const [x,y] = DeckfishGame.algebraic2coords(cell);

                markers.push({
                    type: "outline",
                    colour: p,
                    opacity: 0.2,
                    points: [{row: y, col: x}],
                });
            }
        }
        */

        // build legend of ALL cards
        const allcards = [...cardsBasic, ...cardsExtended];

        const legend: ILegendObj = {};
        
        let lastMarketCard = "";
        if (this.highlights.length === 0 && this.lastmove  && this.lastmove.length > 0) {
            const lastMarketCell = this.lastmove!.split(/\W+/).find((elt) => elt[0] == "m");
            if (lastMarketCell)
                lastMarketCard = this.market[this.algebraic2coord(lastMarketCell!)];
        }
        
        const occupiedCards = new Map<string, playerid>();
        this.occupied.forEach((player,cell) => {
            occupiedCards.set(this.board.get(cell)!,player);
        });

        for (const card of allcards) {
            const border = (this.highlights.indexOf(card.uid) > -1 || card.uid === lastMarketCard);
            if (occupiedCards.has(card.uid)) {
                const player = occupiedCards.get(card.uid);
                legend["c" + card.uid] = card.toGlyph({border: border, fill: player, opacity: 0.2});
            } else {
                legend["c" + card.uid] = card.toGlyph({border: border});
            }
        }

        for (const suit of suits) {
            legend[suit.uid] = {
                name: suit.glyph!,
                scale: 0.5
            }
        }
        legend["A"] = this.makeMeeple({
            colour: 1,
        });
        legend["AH"] = this.makeMeeple({
            colour: 1,
            adjust: true,
        });
        legend["B"] = this.makeMeeple({
            colour: 2,
        });
        legend["BH"] = this.makeMeeple({
            colour: 2,
            adjust: true,
        });

        // build pieces areas
        const areas: AreaPieces[] = [];

        //market
        if (this.market.length > 0) {
            const marketCards = this.market.map(uid => Card.deserialize(uid)!).map(c => "c" + c.uid) as [string, ...string[]];

            areas.push({
                type: "pieces",
                label: i18next.t("apgames:validation.deckfish.LABEL_MARKET") || "Market cards",
                spacing: 0.25,
                pieces: marketCards,
                width: 3,
            });
        }

        // suits
        for (let p = 1; p <= this.numplayers; p++) {
            let captive = this.collected[p-1].reduce((partialSum, a) => partialSum + a, 0);
            if (captive > 0) {
                let captives: string[] = [];
                this.collected[p-1].forEach((cnt,idx) => {
                    if (cnt > 0) {
                        for (let c = 0; c<cnt; c++) 
                            captives.push(suitOrder[idx]);
                    }
                });
                areas.push({
                    type: "pieces",
                    pieces: captives as [string, ...string[]],
                    label: i18next.t("apgames:validation.deckfish.LABEL_COLLECTION", {playerNum: p}) || `P${p} suits`,
                    spacing: -0.25,
                    ownerMark: p,
                    width: 16,
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 7,
                height: 6,
                tileHeight: 1,
                tileWidth: 1,
                tileSpacing: 0.25,
                strokeOpacity: 0.2,
                labelColour: "#888",
                markers,
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
                    const [x, y] = DeckfishGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", occlude: false, dashed: [6,8], targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = DeckfishGame.algebraic2coords(move.from);
                    const [toX, toY] = DeckfishGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    rep.annotations.push({type: "enter", occlude: false, targets: [{row: toY, col: toX}]});
                } else if (move.type === "swap") {
                    const [x, y] = DeckfishGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", occlude: false, dashed: [2,4], targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    /* scoring functions */

    private getTieWinner(): playerid[] {
        //Evaluate tiebreaker.
        let tieWinner: playerid[] = [];
        //Sort.
        const sortedArrays = this.collected.map(collection => collection.slice().sort());
        //Subtract.
        const winArray = sortedArrays[0].map((item, index) => item - (sortedArrays[1])[index]).filter((item) => item !== 0);

        if (winArray.length === 0) {
            tieWinner = [1,2] as playerid[];
        } else {
            tieWinner.push((winArray[0] > 0 ? 1 : 2) as playerid);
        }
        return tieWinner;
    } 

    public getPlayerScore(player: number): number {
        //gets min of suits
        const score = this.collected[player - 1].slice().sort()[0];
        return score;
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

    /* end scoring functions */

    public getStartingPosition(): string {
        const pcs: string[] = [];
        const board = this.stack[0].board;
        const market = this.stack[0].market;
        for (let x = 0; x < columns; x++) {
            for (let y = 0; y < rows; y++) {
                const cell = DeckfishGame.coords2algebraic(x, y);
                if (board.has(cell)) {
                    pcs.push(board.get(cell)!);
                }
            }
            pcs.push("/")
        }

        pcs.push("/");
        market.map(m => pcs.push(m));

        return pcs.join(",");
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.deckfish", {player, where: r.where}));
                resolved = true;
                break;
            case "pie":
                node.push(i18next.t("apresults:PIE.deckfish", {player}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.deckfish", {player, from: r.from, to: r.to, what: r.what}));
                resolved = true;
                break;
            case "eject":
                node.push(i18next.t("apresults:EJECT.deckfish", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "swap":
                node.push(i18next.t("apresults:SWAP.deckfish", {player, what: r.what, with: r.with, where: r.where}));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.simple", {player}));
                resolved = true;
                break;
            case "announce":
                node.push(i18next.t("apresults:ANNOUNCE.deckfish", {player, payload: r.payload}));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.deckfish", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): DeckfishGame {
        return Object.assign(new DeckfishGame(), deepclone(this) as DeckfishGame);
    }
}
