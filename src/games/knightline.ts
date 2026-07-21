import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, Direction, oppositeDirections, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UnboundedSquareBoard } from "../common/unbounded-square-board";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

type playerid = 1 | 2 | 3 ;
type ColorID = 0 | 1 | 2 | 3 ;

type CellContents = [ColorID, number];

const colLabels = "abcdefghijklmnopqrstuvwxyz".split("");
const revColLabels = "abcdefghijklmnopqrstuvwxyz".split("").reverse();
const pieceInitials = ["X","A","B","C"];
const lineDirections: Direction[] = ["N", "NE", "E", "SE"];

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: UnboundedSquareBoard<CellContents>;
    size: number;
    lastmove?: string;
    eliminated: playerid[];
}

export interface IKnightLineState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface IKLMove {
    cell: string;
    targetCell?: string;
    restack?: number;
    complete?: boolean;
    errorID?: string;
}

export class KnightLineGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Knight Line",
        uid: "knightline",
        playercounts: [2, 3],
        version: "20260721",
        dateAdded: "2026-07-21",
        // i18next.t("apgames:descriptions.knightline")
        description: "apgames:descriptions.knightline",
        urls: [
            "http://www.nestorgames.com/rulebooks/KNIGHTLINE_EN.pdf",
            "https://boardgamegeek.com/boardgame/146989/knight-line",
        ],
        people: [
            {
                type: "designer",
                name: "Stephen Tavener",
                urls: ["http://www.mrraow.com"],
                apid: "151518d9-dcec-4900-8277-f86830befb64",
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        variants: [
            { uid: "blocker", group: "setup" },
            { uid: "wildcard", group: "setup" },
            { uid: "#size" },
            { uid: "size-24", group: "size" },
        ],
        categories: ["goal>arrange", "mechanic>merge", "board>dynamic", "board>shape>rect", "board>connect>rect", "other>2+players"],
        flags: ["autopass", "experimental"],
    };

    /* Three coordinate systems */
    
    private absXCoord2algebraic(x: number): string {
        // In knightline, the y axis uses cartesian coordinates, 
        // and the x axis is lettered.
        // The origin and first placement is at m0, aka (0,0).
        // Cells retain the same algebraic coordinates thoughout the game.
        let xval: string;
        if (x > 13) {
            x = x - 14;
            xval = colLabels[Math.floor(x/26)] + colLabels[x % 26];
        } else if (x < -12) {
            x = Math.abs(x) - 13;
            xval = revColLabels[Math.floor(x/26)] + revColLabels[x % 26];
        } else {
            xval = colLabels[x + 12];
        }
        return xval;
    }

    public absCoords2algebraic(x: number, y: number): string {
        // In knightline, the y axis uses cartesian coordinates, 
        // and the x axis is lettered.
        // The origin and first placement is at m0, aka (0,0).
        // Cells retain the same algebraic coordinates thoughout the game.
        const xval = this.absXCoord2algebraic(x);
        const yval = y === 0 ? 0 : -y;
        return xval + yval.toString();
    }

    public algebraic2absCoords(cell: string): [number, number] {
        // In knightline, the y axis uses cartesian coordinates,
        // and the x axis is lettered.
        // The origin and first placement is at (m, 0).
        // The double indices are divided at m,
        // which is assigned the positive value.
        const temp = cell.match(/[a-z]+|-?[0-9]+/g);
        let x = 0;
        if (!temp || !temp[0] || temp[0].length > 2 || (!temp[1] && temp[1] !== "0"))
            throw new Error(`An invalid cell '${cell}' was passed to algebraic2absCoords.`);
        const y = parseInt(temp[1],10);
        if (temp[0].length === 1) {
            //All the single letter cases.
            x = colLabels.indexOf(temp[0]) - 12;
        } else {
            const let1 = temp[0][0];
            const let2 = temp[0][1];
            let let1val = colLabels.indexOf(let1);
            if (let1val < 13) {
                const let2val = colLabels.indexOf(let2);
                x = let1val * 26 + let2val + 14;
            } else {
                let1val = revColLabels.indexOf(let1);
                const let2val = revColLabels.indexOf(let2);
                x = -(let1val * 26 + let2val + 13);
            }
        }
        const yval = y === 0 ? 0 : -y;
        return [x, yval];
    }

    public abs2relCoords(x: number, y: number): [number, number] {
        //The relative coordinates provided by unbounded-square-board
        // merely move the origin.
        //We need to move the origin one more square down and right
        // in order to leave blank spaces around the board.
        const [relx, rely] = this.board.abs2rel(x, y);
        return [relx + 1, rely + 1];
    }

    public rel2absCoords(x: number, y: number): [number, number] {
        // Convert from relCoords to absCoords.
        return this.board.rel2abs(x - 1, y - 1);
    }

    public algebraic2relCoords(cell: string): [number, number] {
        const coords = this.algebraic2absCoords(cell);
        return this.abs2relCoords(coords[0],coords[1]);
    }

    public relCoords2algebraic(x: number, y: number): string {
        const coords = this.rel2absCoords(x, y);
        return this.absCoords2algebraic(coords[0],coords[1]);
    }
    
    public numplayers!: number;
    public currplayer!: playerid;
    public board!: UnboundedSquareBoard<CellContents>;
    public size!: number;
    public gameover = false;
    public eliminated: playerid[] = [];
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private highlight?: IKLMove;

    constructor(state: number | IKnightLineState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const board: UnboundedSquareBoard<CellContents> = new UnboundedSquareBoard();

            const size = this.variants.includes("size-24") ? 24 : 20;

            const fresh: IMoveState = {
                _version: KnightLineGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                size,
                eliminated: [],
            };

            //Set up the starting stacks.
            if (this.variants.includes("blocker") || this.variants.includes("wildcard")) {
                board.set(0,0,[0,1]);
            } else {
                board.set(0,0,[1,size]);
                board.set(1,0,[2,size]);
                if (this.numplayers > 2) {
                    board.set(0,1,[3,size]);
                }
            }
            
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IKnightLineState;
            }
            if (state.game !== KnightLineGame.gameinfo.uid) {
                throw new Error(`The KnightLine game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.variants = state.variants;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.stack.map((s) => {
                s.board = UnboundedSquareBoard.from(s.board);
            });

        }
        this.load();
    }

    public load(idx = -1): KnightLineGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = state.board.deepClone();
        this.size = state.size;
        this.eliminated = [...state.eliminated];
        this.lastmove = state.lastmove;
        return this;
    }

    /* Game logic functions */
    
    private getActiveStacks(player?: playerid) {
        if (player === undefined) {
            player = this.currplayer;
        }

        const allPositions = this.board.getAllPositions();
        
        return allPositions.filter( ([absX, absY]) => {
            const cellContent = this.board.get(absX, absY);
            if (cellContent![0] !== player)
                return false;
            else if (cellContent![1] === 1)
                return false;
            else
                return true;
        });
    }

    private getFreeMoves(): string[] {
        //Returns an array of unoccupied cells that are connected to the board.
        //Used for randomizing opening moves.
        const freeMoves: string[] = [];

        //Get all board locations.
        //Collect all unoccupied neighbors thereof.
        const allPositions = this.board.getAllPositions();
        for (let a = 0; a < allPositions.length; a++) {
            const [absX, absY] = allPositions[a];
            allDirections.map( dir => {
                const [nX, nY] = this.getNext(absX, absY, dir);
                if (! this.board.has(nX, nY) )
                    freeMoves.push(this.absCoords2algebraic(nX, nY));
            });                   
        }
        
        return [...new Set(freeMoves)];
    }

    private getKnightMoves(absX: number, absY:number): [number, number][] {
        //Takes an absolute board location.
        //Returns an array of unoccupied cells that are connected to the board,
        //and reachable by a knight move.
        const knightMoves: [number, number][] = [];
        const knightAdjust = [[-1,-2],[-1,2],[1,-2],[1,2],[-2,-1],[-2,1],[2,-1],[2,1]];

        for (const [dx,dy] of knightAdjust) {
            const [newX, newY] = [absX + dx, absY + dy];
            if ( (! this.board.has(newX, newY) ) && this.hasNeighbors(newX, newY) ) {
                knightMoves.push([newX, newY]);
            }
        }
        return knightMoves;
    }

    private getKnightMovesRel(relX: number, relY:number): RowCol[] {
        //A wrapper for getKnightMoves() for the renderer.
        //Takes a relative board location.
        //Returns an array of unoccupied cells that are connected to the board,
        // in RowCol format.
        const [absX, absY] = this.rel2absCoords(relX, relY);

        const knightMoves = this.getKnightMoves(absX, absY);
        const relKnightMoves: RowCol[] = [];
        knightMoves.forEach( ([absX, absY]) => {
            const [col, row] = this.abs2relCoords(absX, absY);
            relKnightMoves.push({row, col});
        });
 
        return relKnightMoves;
    }

    private hasMoves(player?: playerid): boolean {
        // Check if a player has any moves left.
        // Needed to determine the move list for autopassing.

        if (player === undefined) {
            player = this.currplayer;
        }

        if (this.stack.length <= this.numplayers)
            return true;

        const activeStacks = this.getActiveStacks(player);

        for (let s = 0; s < activeStacks.length; s++) {
            const [x, y] = activeStacks[s];
            const knightMoves = this.getKnightMoves(x, y);
            if (knightMoves.length > 0)
                return true;
        }

        return false;
    }

    private hasNeighbors(absX: number, absY: number): boolean {
        // Check if an empty cell has any neighbors.
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.board.has(absX + dx, absY + dy)) {
                    return true;
                }
            }
        }
        return false;
    }

    /* Move parsing functions */

    private isOpeningMove(): boolean {
        //Opening moves (placements) are only made in variant games.
        if (! (this.variants.includes("blocker") || this.variants.includes("wildcard") ) )
            return false;
        if ( this.stack.length > this.numplayers )
            return false;
        return true;
    }

    private isRestrictedMove(): boolean {
        //The first player's first move is restricted only in a 2p game.
        //It's unclear what's intended for the variants so we retain the restriction for 2p.
        //This function takes both the restriction status and the move count status into account.
        if ( this.numplayers > 2 )
            return false;

        if ( this.variants.includes("blocker") || this.variants.includes("wildcard") )
            return (this.stack.length === 3);
        
        return (this.stack.length === 1);
    }

    public parseMove(m: string): IKLMove {
        //Parse a move into an IKLMove object.
        //Does only structural validation.

        //Complete is a special flag for validation.

        //Pretreat.
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        //Regexes.
        const legalChars = /^([a-z]|\d|-|,)+$/;
        const legalCell = /^([a-z][a-z]?-?\d+$)/;
        const legalSize = /^([1-9][0-9]?$)/;

        const mm: IKLMove = {
            cell: "",
            complete: false
        }

        if (m === "")
            return mm;

        if (! legalChars.test(m)) {
            mm.errorID = "INVALID_NOTATION";
            return mm;
        }

        let moves = m.split(",");

        if (moves.length === 4 && moves[3] === "")
            mm.complete = true;

        moves = moves.filter(move => move.length > 0);

        if ( moves.length === 0
            || moves.length > 3 
            || (! legalCell.test(moves[0]) )
            || ( moves[1] !== undefined && (! legalCell.test(moves[1])) )
            || ( moves[2] !== undefined && (! legalSize.test(moves[2])) ) 
           ) {
            mm.errorID = "INVALID_NOTATION";
            return mm;
        }

        mm.cell = moves[0];
        
        if ( moves[1] !== undefined ) {
            mm.targetCell = moves[1];
            if ( moves[2] !== undefined ) {
                mm.restack = parseInt(moves[2],10);
            }
        } else {
            if ( this.isOpeningMove() )
                mm.complete = true;
        }
        
        return mm;
    }

    public pickleMove(pm: IKLMove): string {
        if ( ! pm.cell || pm.cell === "" ) {
            throw new Error("Could not pickle the move because it didn't include a cell.");
        }

        const move = [pm.cell];

        if (pm.targetCell) {
            move.push(pm.targetCell);
            if (pm.restack)
                move.push(pm.restack.toString());
        }

        return move.join(",");
    }

    public randomMove(): string {
        //Does not generate a full move list, but chooses a random stack,
        // a random jump, and a random split of the stack.
        if (this.gameover)
            return "";

        const player = this.currplayer;
        if (this.eliminated.indexOf(player) > -1)
            return "pass";

        let moves: string[] = [];

        if (this.isOpeningMove()) {
            
            moves = this.getFreeMoves().map( cell => {
                const move: IKLMove = {
                    cell: cell
                };
                return this.pickleMove(move);
            });

        } else {
        
            const activeStacks = this.getActiveStacks(player);
        
            for (let s = 0; s < activeStacks.length; s++) {
                const [x, y] = activeStacks[s];
                const cell = this.absCoords2algebraic(x, y);
                const stackHeight = this.board.get(x, y)![1];
                const restackArray = [...Array(stackHeight).keys()].map(r => r + 1);
                restackArray.length = stackHeight - 1;
                const dots = this.getKnightMoves(x, y);
                const submoves = dots.map(([a,b]) => {
                    const submove: IKLMove = {cell: cell};
                    submove.targetCell = this.absCoords2algebraic(a, b);
                    if ( this.isRestrictedMove() )
                        submove.restack = 1;
                    else
                        submove.restack =  restackArray[Math.floor(Math.random() * restackArray.length)];

                    return this.pickleMove(submove);
                });
                moves = moves.concat(submoves);
            }
            
            if (moves.length === 0)
                moves = ["pass"];
        }
        
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public moves(player?: playerid): string[] {
        //Generates either "pass" or the empty list, for autopassing.
        //Random moves are available from randomMoves().
        if (player === undefined) {
            player = this.currplayer;
        }

        if ( this.eliminated.indexOf(player) > -1 )
            return ["pass"];
        else if (! this.hasMoves(player) )
            return ["pass"];
        else
            return [];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const newcell = this.relCoords2algebraic(col, row);
            const mm = this.parseMove(move);
            //console.log("rel: ", col, row, " alg: ", newcell, " abs: ", this.algebraic2absCoords(newcell));

            //There are some setup moves in the variants.
            if ( this.isOpeningMove() ) {
                //This is an initial placement.
                newmove = newcell;
            } else if (move && mm.targetCell && newcell === mm.targetCell && mm.restack !== undefined) {
                //If there's already a target cell, we're clicking it again for stack splitting.
                mm.restack++;
                newmove = this.pickleMove(mm);
            } else if (move && mm.targetCell && newcell !== mm.cell && mm.restack !== undefined) {
                //This is the special shortcut to end splitting.
                newmove = this.pickleMove(mm) + ",";
            } else if (piece !== undefined && piece !== "") {
                //Clicked on a piece.
                //If it's not the current source cell, it overrides.
                if (newcell !== mm.cell) {
                    //Set, or reset mid-move when clicking on an uninvolved piece.
                    move = "";
                    newmove = newcell;
                } else if (mm.restack !== undefined && mm.restack > 1) {
                    //Re-clicked the source cell, so deduct from restack.
                    mm.restack--;
                    newmove = this.pickleMove(mm);
                }
            } else if (move === "") {
                //If there is no move, must click a piece and didn't, so no-op.
                newmove = "";
            } else {
                //Else there's a source cell and we're choosing a target cell.
                mm.targetCell = newcell;
                //We also auto-populate restack.
                const [absX, absY] = this.algebraic2absCoords(mm.cell);
                const cellContent = this.board.get(absX, absY);
                if ( cellContent && cellContent.length > 1 ) {
                    if ( this.isRestrictedMove() )
                        mm.restack = 1;
                    else 
                        mm.restack = Math.ceil(cellContent[1] / 2);
                }
                
                newmove = this.pickleMove(mm);
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( this.isOpeningMove() )
                result.message = i18next.t("apgames:validation.knightline.INITIAL_INSTRUCTIONS_VARIANTS");
            else
                result.message = i18next.t("apgames:validation.knightline.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (this.eliminated.indexOf(this.currplayer) > -1) {
                //This would be caught by the next condition but why calculate the moves?
                result.valid = true;
                result.complete = 1;
                return result;
            } else if ( this.moves().includes("pass") ) {
                result.valid = true;
                result.complete = 1;
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.BAD_PASS");
                return result;
            }
        }

        if (m !== "pass" && this.eliminated.indexOf(this.currplayer) > -1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.MUST_PASS");
            return result;
        }


        const mm = this.parseMove(m);

        if (mm.errorID !== undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline." + mm.errorID, { move: m });
            return result;
        }

        //Validate content.
        const cell = mm.cell;
        const [absX, absY] = this.algebraic2absCoords(cell);

        //Validate variant openings.
        if ( this.isOpeningMove() ) {
            //An opening move must be an initial placement of a stack.
            if (mm.restack !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.BAD_OPENING_MOVE");
                return result;
            } else if (mm.targetCell !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.BAD_OPENING_MOVE");
                return result;
            } else if (this.board.has(absX, absY) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.BAD_START_PLACE", { cell: cell });
                return result;
            } else if (! this.hasNeighbors(absX, absY) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.BAD_START_PLACE", { cell: cell });
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        //Validate source stack.
        //moves[0] should be a stack of size > 1 owned by the player.
        const cellContent = this.board.get(absX,absY);

        if (cellContent === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.NO_STACK", { cell: cell });
            return result;
        } else if ( cellContent[0] !== this.currplayer ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.INVALID_STACK", { cell: cell });
            return result;
        } else if ( cellContent[1] < 2 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.SHORT_STACK", { cell: cell });
            return result;
        }

        const count = cellContent[1];
             
        if ( mm.targetCell === undefined ) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.knightline.SELECT_CELL");
            return result;
        }

        //Validate target cell.
        //moves[1] should be an unoccupied cell a knight move away, with neighbors.
        const targetCell = mm.targetCell;
        const [tabsX, tabsY] = this.algebraic2absCoords(targetCell);
        if ( this.board.has(tabsX,tabsY) ) {
            //This also handles the case of cell === targetCell.
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.INVALID_TARGET", { cell: targetCell });
            return result;
        } else if (! this.hasNeighbors(tabsX, tabsY) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.NO_NEIGHBORS", { cell: targetCell });
            return result;
        } else {
            const dx = Math.abs(absX - tabsX);
            const dy = Math.abs(absY - tabsY);
            if (! ( (dx === 1 && dy === 2) || (dx === 2 && dy === 1) )) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.NO_KNIGHT", { cell: targetCell });
                return result;
            }
        }

        if ( mm.restack === undefined ) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.knightline.SPLIT_STACK");
            return result;
        }

        //Validate stacked quantity.
        //moves[2] should be a legal value to pop off the original stack.
        const restack = mm.restack;
        if ( restack < 0 || restack > count - 1 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.knightline.BAD_VALUE", { what: restack });
            return result;
        }
        
        if ( this.isRestrictedMove() ) {
            if (restack === 1) {
                //One of our few complete moves.
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.knightline.INVALID_FIRST_MOVE", { move: m });
                return result;
            }
        }

        //In most cases the restack quantity can be adjusted,
        //so the move is only provisionally complete.
        result.valid = true;
        result.complete = mm.complete ? 1 : 0;
        result.canrender = true;
        result.message = i18next.t("apgames:validation.knightline.SPLIT_STACK");
        return result;
    }
 
    public move(m: string, { partial = false, trusted = false } = {}): KnightLineGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];

        if (m === "pass") {
            this.results.push({type: "pass"});
            //passing is forevah
            if (this.eliminated.indexOf(this.currplayer) < 0) {
                this.eliminated.push(this.currplayer);
            }
        } else {

            const mm = this.parseMove(m);
            const [absX, absY] = this.algebraic2absCoords(mm.cell);

            if ( this.isOpeningMove() ) {
                this.board.set(absX, absY, [this.currplayer, this.size]);
                this.results = [{type: "place", where: mm.cell, what: this.size.toString() }];
            } else if ( partial ) {
                if ( mm.targetCell )
                    this.results = [{type: "move", from: mm.cell, to: mm.targetCell, what: mm.restack ? mm.restack.toString() : undefined}];
                else
                    this.results = [{type: "select", what: mm.cell}];

                this.highlight = deepclone(mm);
                
                return this;
            } else if ( mm.targetCell !== undefined && mm.restack !== undefined ) {
                const cellContent = this.board.get(absX,absY);
                const count = cellContent![1];
                const destack = count - mm.restack;
                const [tabsX, tabsY] = this.algebraic2absCoords(mm.targetCell);     
                this.board.set(absX, absY, [this.currplayer, destack]);
                this.board.set(tabsX, tabsY, [this.currplayer, mm.restack]);
                this.results = [{type: "move", from: mm.cell, to: mm.targetCell, what: mm.restack.toString()}];
            } else {
                //Got a partial move that wasn't marked partial.
                //Maybe this is just a playground kind of issue.
                throw new Error("Partial move passed to move() as complete.");
            }
        }
        
        this.lastmove = m;
        this.checkEOG();

        this.currplayer = (this.currplayer % this.numplayers + 1) as playerid;

        this.saveState();
        return this;
    }

    /* Graph functions */

    private expandLine(line: [number, number][], dir: Direction): [number, number][] {
        //Expand candidate n-in-a-row in both directions if possible.
        //Expand the first piece in the primary direction,
        // and the last piece in the opposite direction.
        // (They may be the same piece.)
        
        if (line.length < 1)
            throw new Error("Bad array passed to expandLine.");

        let [mX, mY] = line[0]; 
        let [lX, lY] = this.getNext(mX, mY, dir);
        while ( this.goodNeighbor(lX, lY) && line.length < 4 ) {
            //Go as far as necessary in the primary direction.
            line.unshift([lX, lY]);
            [mX, mY] = line[0];
            [lX, lY] = this.getNext(mX, mY, dir);
        }

        //Don't bother with the second half if this completed the line.
        if (line.length >= 4)
            return line;
        
        const oppDir = oppositeDirections.get(dir)!;
        
        let [nX, nY] = line[line.length - 1];
        let [oX, oY] = this.getNext(nX, nY, oppDir);
        while ( this.goodNeighbor(oX, oY) &&  line.length < 4 ) {
            //Go as far as necessary in the secondary direction.
            line.push([oX, oY]);
            [nX, nY] = line[line.length - 1];
            [oX, oY] = this.getNext(nX, nY, oppDir);
        }

        return line;
    }
    
    private getNext(x: number, y: number, dir: Direction): [number, number] {
        //Wrote my own adjacency function for some reason.
        let xNew = x;
        let yNew = y;

        switch (dir) {
            case "NE":
                yNew++;
                // eslint-disable-next-line no-fallthrough
            case "E":
                xNew++;
                break;
            case "SE":
                xNew++;
                // eslint-disable-next-line no-fallthrough
            case "S":
                yNew--;
                break;
            case "SW":
                yNew--;
                // eslint-disable-next-line no-fallthrough
            case "W":
                xNew--;
                break;
            case "NW":
                xNew--;
                // eslint-disable-next-line no-fallthrough
            case "N":
                yNew++;
                break;
            default:
                throw new Error("Invalid direction passed to getNext().");
        }
        return [xNew, yNew];
    }
    
    private goodNeighbor(x: number, y: number): boolean {
        //Can this neighbor contribute to the current player's n-in-a-row?
        const cellContent = this.board.get(x, y);
        if (cellContent !== undefined) {
            if ( cellContent[0] === this.currplayer || (this.variants.includes("wildcard") && cellContent[0] === 0) ) {
                return true;
            }
        }
        return false;
    }

    private getKnightLines(absX: number, absY: number): boolean {
        //Determine whether there is a 4-in-a-row through the cell.

        for (const dir of lineDirections) {
            const line = this.expandLine([[absX, absY]], dir);
            if (line.length >= 4)
                return true;
        }

        return false;
    }
    
    protected checkEOG(): KnightLineGame {
        if (this.lastmove === "pass") {
            if (this.eliminated.length === this.numplayers) {
                this.gameover = true;
                this.results.push({ type: "eog", reason: "stalemate" });

                // Second player wins in 2p.
                // All draw (win) in 3p.
                if (this.numplayers === 2)
                    this.winner.push(2 as playerid);
                else
                    this.winner = [...this.eliminated];
                
            } else {
                //The game is not over.
                return this;
            }
        } else {
            const allPositions = this.board.getAllPositions();
        
            //Precheck: Check that enough stacks are split to make a 4-in-a-row.
            //Since someone might be forced to pass, we don't just count the (game) stack.
            const numPlayedPerPlayer = 4 - 1 - (this.variants.includes("wildcard") ? 1 : 0); //not including this play
            if ( allPositions.length < this.numplayers * numPlayedPerPlayer + 1 ) //including this play
                return this;
            
            //Check for 4-in-a-row.  We're far enough into the game that there must be a targetCell.
            const [absX, absY] = this.algebraic2absCoords(this.parseMove(this.lastmove!).targetCell!);
            if ( this.getKnightLines(absX, absY) ) {
                this.gameover = true;
                this.results.push({ type: "eog" });
                //It's not possible to make 4 in a row for another player, so we know it's you.
                this.winner = [this.currplayer];
            }
        }
        
         if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IKnightLineState {
        return {
            game: KnightLineGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: KnightLineGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            size: this.size,
            lastmove: this.lastmove,
            board: this.board.deepClone(),
            eliminated: [...this.eliminated],
        };
    }

    /* Rendering functions */

    private createPiece(cell: CellContents, forHighlight?: boolean): Glyph {
        //Turn cellContents into a piece for rendering.
        if (!cell || cell.length < 2)
            throw new Error("Bad cellContents passed to createPiece.");

        const color = cell[0];
        const count = cell[1];

        if (color === 0 && count === 1 && this.variants.includes("blocker") ) {
            return [
                {
                    name: "piece-square",
                    opacity: 1,
                    colour: "#888"
                },
                {
                    name: "x",
                    colour: "#000",
                    scale: 0.75
                }
            ] as Glyph;
        } else if (color === 0 && count === 1) {
            return [
                {
                    name: "piece-square",
                    opacity: 1,
                    colour: "#888"
                },
                {
                    text: "\u2731",
                    colour: "#000",
                    scale: 0.75
                }
            ] as Glyph;
        } else {
            return [
                {
                    name: "piece-square",
                    opacity: forHighlight? 0.66 : 1,
                    colour: color
                },
                {
                    text: count.toString(),
                    colour: "#000",
                    scale: 0.75
                }
            ] as Glyph;
        }
    }

    private encodePiece(cell: CellContents): string {
        //Turn cellContents into the name of a piece for rendering.
        if (!cell || cell.length < 2)
            throw new Error("Bad cellContents passed to encodePiece.");
        
        const color = cell[0];
        const count = cell[1];
        return `${pieceInitials[color]}${count}`;
    }

    private getRenderWidthHeight(): [number, number] {
        // Get the width and height of the board for rendering.
        if (this.board.size === 0) {
            //This case should not occur.  Error trap it?
            return [1, 1];
        } else
            return [this.board.width + 2, this.board.height + 2];
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[] = [];
        const legend: ILegendObj = {};
        let firstAX = -1, firstAY = -1;
        const [width, height] = this.getRenderWidthHeight();

        //console.log("rendering highlight: ", this.highlight);
        //Create some transient pieces.
        let sX = -1, sY = -1, tX = -1, tY = -1;
        if ( this.highlight !== undefined ) {
            [sX, sY] = this.algebraic2relCoords(this.highlight.cell);
            if ( this.highlight.targetCell !== undefined ) {
                [tX, tY] = this.algebraic2relCoords(this.highlight.targetCell);
                legend["H"] = this.createPiece([this.currplayer, this.highlight.restack || 1], true);
            }
        }

        //Create the piece list and pieces in one fell swoop.
        for (let y = 0; y < height; y++) {
            const pstr: string[] = [];
            for (let x = 0; x < width; x++) {
                const [absX, absY] = this.rel2absCoords(x, y);
                
                if ( x === 0 && y === 0 )
                    [firstAX, firstAY] = [absX, absY];

                const cellContent = this.board.get(absX, absY);

                if (x === tX && y === tY) {
                    pstr.push("H");
                } else if (cellContent === undefined) {
                    pstr.push("-");
                } else if (x === sX && y === sY && this.highlight && this.highlight.restack) {
                    const name = this.encodePiece(cellContent) + "H";
                    pstr.push(name);
                    //We may occasionally overwrite an identical legend element.
                    legend[name] = this.createPiece([cellContent[0], cellContent[1] - this.highlight.restack]);
                } else {
                    const name = this.encodePiece(cellContent);
                    pstr.push(name);
                    //We may occasionally overwrite an identical legend element.
                    legend[name] = this.createPiece(cellContent);
                }
            }
            pieces.push(pstr.join(","));
        }

        //Label my funny coordinate system.
        const rowLabels = [...Array(height).keys()].map(l => ( -(l + firstAY) ).toString()).reverse();
        const columnLabels = (Array.from(Array(width).keys())).map(c =>
            this.absXCoord2algebraic(firstAX + c) );
        
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width,
                height,
                columnLabels,
                rowLabels,
                strokeColour: {
                    func: "flatten",
                    fg: "_context_strokes",
                    bg: "_context_board",
                    opacity: 0,
                },
            },
            legend: legend,
            pieces: pieces.join("\n"),
        };

        // Build annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if ( move.type === "select" ) {
                    const [col, row] = this.algebraic2relCoords(move.what!);
                    rep.annotations.push({ type: "exit", targets: [{ row, col }] });

                    const targets = this.getKnightMovesRel(col, row);
                    if (targets.length)
                        rep.annotations.push({ type: "dots", targets: targets as [RowCol, ...RowCol[]] });
                } else if ( move.type === "move" ) {
                    const [col, row] = this.algebraic2relCoords(move.from!);
                    const [tcol, trow] = this.algebraic2relCoords(move.to!);
                    rep.annotations.push({ type: "eject", targets: [{ row, col },{ row: trow, col: tcol }] });

                    rep.annotations.push({ type: "enter", targets: [{ row: trow, col: tcol }] });
                }
            }
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.knightline", { player, from: r.from, to: r.to, what: r.what }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.knightline", { player, where: r.where }));
                resolved = true;
                break;
            case "eliminated":
                node.push(i18next.t("apresults:ELIMINATED", {player}));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate_all"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): KnightLineGame {
        return new KnightLineGame(this.serialize());
    }
}
