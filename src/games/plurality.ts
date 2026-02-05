import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareOrthGraph } from "../common";

import { connectedComponents } from "graphology-components";

import i18next from "i18next";

export type playerid = 1 | 2 | 3; // 3 is for drawing neutral owned areas

type Territory = {
    cells: string[];
    owner: playerid|undefined;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];    
};

export interface IPluralityState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PluralityGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Plurality",
        uid: "plurality",
        playercounts: [2],
        version: "20260202",
        dateAdded: "2026-02-02",
        // i18next.t("apgames:descriptions.plurality")
        description: "apgames:descriptions.plurality",
        urls: ["https://boardgamegeek.com/boardgame/462846/plurality"],
        people: [
            {
                type: "designer",
                name: "João Pedro Neto",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: [],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>area", "mechanic>place", "board>shape>rect"],
        variants: [
            { uid: "#board", },
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        flags: ["scores", "experimental"]
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public boardSize = 13;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0.5];

    constructor(state?: IPluralityState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: PluralityGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: [0, 0.5],                
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPluralityState;
            }
            if (state.game !== PluralityGame.gameinfo.uid) {
                throw new Error(`The Plurality engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PluralityGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();             
        this.scores = [...state.scores];
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 13;
    }
    
    private neighbors(x: number, y: number): number[][] {
        let result = [];
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (x+dx >= 0 && x+dx < this.boardSize && 
                y+dy >= 0 && y+dy < this.boardSize) {
                const cell = this.coords2algebraic(x+dx, y+dy);
                if (! this.board.has(cell)) {
                    result.push([x+dx, y+dy]);
                }
            }
        }        
        return result;
    }
    
    private isTaboo(x: number, y: number): boolean {
        for (const [x1,y1] of [[x+1,y+1],[x-1,y+1],[x+1,y-1],[x-1,y-1]]) { 
            // (x1,y1) is an adjacent diagonal of cell (x,y)
            if (x1 >= 0 && x1 < this.boardSize && y1 >= 0 && y1 < this.boardSize) {
                let taboo = true;
                for (const [x2,y2] of [[x,y1],[x1,y],[x1,y1]]) {
                    const cell = this.coords2algebraic(x2, y2);
                    // a 2x2 would appear if the other three coordinates are occupied
                    taboo = taboo && this.board.has(cell);
                }
                if (taboo) { return true; }
            }
        }
        return false;
    }
    /**
     * This should generate a full list of valid moves from the current game state. If it is not reasonable for your game to generate such a list, you can remove this function and add the `no-moves` flag to the game's metadata. If you *can* efficiently generate a move list, though, I highly recommend it. It's helpful to players, and it makes your life easier later.
     */
    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        let taboo;

        // can place on any empty space
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell1 = this.coords2algebraic(x, y);
                if (this.board.has(cell1) || this.isTaboo(x,y)) continue;
                
                for (const [x2,y2] of this.neighbors(x,y)) {
                    const cell2 = this.coords2algebraic(x2, y2);
                    if (this.board.has(cell2)) continue;
                    // check for 2nd stone taboo
                    this.board.set(cell1, this.currplayer); // temporary add cell1 to check taboo
                    taboo = this.isTaboo(x2,y2);
                    this.board.delete(cell1);               // remove it!
                    if (taboo) { continue; }
                    // ------------------- end check
                    
                    for (const [x3,y3] of this.neighbors(x2,y2)) {
                        const cell3 = this.coords2algebraic(x3, y3);
                        if (cell1 === cell3 || this.board.has(cell3)) continue;
                        // check for 3rd stone taboo
                        this.board.set(cell1, this.currplayer); // temporary add cell1
                        this.board.set(cell2, this.currplayer); // temporary add cell2
                        let taboo = this.isTaboo(x3,y3);
                        this.board.delete(cell1);               // remove it!
                        this.board.delete(cell2);               // remove it!
                        if (taboo) { continue; }
                        // ------------------- end check
                        
                        // ok, no 2x2 was found, so add the two possible options
                        moves.push(cell1 + ',' + cell2 + ',' + cell3); // cell3 is enemy stone
                        moves.push(cell1 + ',' + cell3 + ',' + cell2); // cell2 is enemy stone
                    }
                }
            }
        }
        moves.push("pass");

        return moves.sort((a,b) => a.localeCompare(b))
    }

    /**
     * This is a helper function only needed for local testing, and only useful if you have a `moves()` function.
     */
    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /**
     * This takes information about the move in progress and the click the user just made and needs to return an updated move string and some description of how valid and complete the move is.
     * - `valid` must be either true or false. As long as the move is even partially valid, it should return true. False tells the front end that it's wholly and unsalvageably invalid.
     * - `complete` has three states: -1, 0, and 1. -1 means the move is for absolutely sure NOT complete. More input is needed. 0 means the move *could* be complete and submitted now, but further moves are possible. And 1 means the move is absolutely complete and no further input should be expected.
     * - `canrender` is for games where the moves consist of multiple steps and need to be rendered as you go. If `canrender` is true, then even if `complete` is -1, it will be send to the renderer for updating.
     * - `message` is a translatable string explaining what the user should do next.
     */
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                newmove = move + "," + cell;
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

    /**
     * This goes hand in hand with `handleClick()` and can be leveraged in other areas of the code as well. It accepts a move string and then returns a description of the move's condition. See description of `handleClick()` for details.
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.plurality.INITIAL_INSTRUCTIONS")
            return result;
        }
        
        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            return result;            
        }
        
        // a complete move corresponds to three placements, ie, three clicks
        const moves = m.split(",");

        // is it a valid cell?
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        
        // is cell empty?
        let lastMove: string = moves[moves.length-1];  // get most recent placement

        let notEmpty;
        if (this.board.has(lastMove)) { 
          notEmpty = lastMove;         
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }            
        
        // Cell is empty, do we have three placements?
        if (moves.length < 3) {
            result.valid = true;
            result.complete = -1; // need more placements!
            result.message = i18next.t("apgames:validation.plurality.INCOMPLETE_TURN");
            return result;
        }
        
        // Three stones were placed, must be a tromino and cannot make a 2x2 forbidden area
        if (! this.moves().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.plurality.TABOO", { where: notEmpty });
            return result;
        }
        
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // --- These next methods are helpers to find territories and their eventual owners ---- //
    
    public getGraph(): SquareOrthGraph { // NB: just orthogonal connections 
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    /**
     * Get all moves() in format [ "a1,a2,a3", "a1,a2,b2", "a1,a3,a2", "a1,b1,b2"...]
     * and returns a set with just the unique coordinates 
     */
    public getUniqueIds(data: string[]): Set<string> {
      // flatMap flattens the resulting arrays into one single array
      const allIds = data.flatMap(item => item.split(','));
      return new Set(allIds); // remove duplicates
    }

    /*
     * An area is owned if it is not possible to play inside it.
     * The set of possible moves are given by validMoves parameter
     */
    public isAreaOwned(myArea: Array<string>, validMoves: Set<string>): boolean {
      return myArea.every(id => !validMoves.has(id));
    }
    
    /**
     * What pieces are orthogonally adjacent to a given area?
     */
    public getAdjacentPieces(area: string[], pieces: string[]): string[] {
      // convert area strings to numeric coordinates
      const areaCoords = area.map(cell => this.algebraic2coords(cell));
      
      return pieces.filter(pieceStr => {   // Filter the pieces array
        const piece = this.algebraic2coords(pieceStr);
        
        return areaCoords.some(square => {  // check adjacency
          const dx = Math.abs(piece[0] - square[0]);
          const dy = Math.abs(piece[1] - square[1]);
          return (dx == 1 && dy == 0) || (dx == 0 && dy == 1);
        });
      });
    }

    /**
     * Get all available territories (based in Asli)
     * This is used in (1) computing scores, and (2) in the render process
     */
    public getTerritories(): Territory[] {
        const allValidMoves : Set<string> = this.getUniqueIds([...this.moves()]);
        const p1Pieces = [...this.board.entries()].filter(([,owner]) => owner === 1).map(pair => pair[0]);
        const p2Pieces = [...this.board.entries()].filter(([,owner]) => owner === 2).map(pair => pair[0]);
        const allPieces = [...p1Pieces, ...p2Pieces];
        
        // compute empty areas
        const gEmpties = this.getGraph();
        for (const node of gEmpties.graph.nodes()) {
            if (allPieces.includes(node)) {  // remove intersections/nodes with pieces
                gEmpties.graph.dropNode(node);
            }
        }
        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);
        
        const territories: Territory[] = [];
        for(const area of emptyAreas) {
            const isOwned = this.isAreaOwned(area, allValidMoves);
            if (isOwned) {
                let owner : playerid = 3; // default value: neutral aea
                // find who owns it
                const p1AdjacentCells = this.getAdjacentPieces(area, p1Pieces);
                const p2AdjacentCells = this.getAdjacentPieces(area, p2Pieces);
                if (p1AdjacentCells.length > p2AdjacentCells.length) {
                    owner = 1;
                }
                if (p1AdjacentCells.length < p2AdjacentCells.length) {
                    owner = 2;
                }
                territories.push({cells: area, owner});
            }
        }
        return territories;
    }
    
    // ------------------------------------------------------------------------------------- //
    
    public move(m: string, {trusted = false} = {}): PluralityGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let valid_moves = this.moves();
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! valid_moves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        if (m.length === 0) { return this; }
        
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const moves = m.split(",");
            this.results.push({ type: "place", where: moves[0] });
            this.board.set(moves[0], this.currplayer);
            
            if (moves.length >= 2) {
                this.results.push({ type: "place", where: moves[1] });
                this.board.set(moves[1], this.currplayer);
            }
            
            if (moves.length === 3) {
                this.results.push({ type: "place", where: moves[2] });
                this.board.set(moves[2], this.currplayer==1 ? 2 : 1);
            }
        }
        
        // compute scores by computing current owned territories
        if ((m === "pass") || (m.split(",").length === 3)) {
            const terr = this.getTerritories();
            this.scores = [
                terr.filter(t => t.owner === 1).reduce((prev, curr) => prev + curr.cells.length, 0.0),
                terr.filter(t => t.owner === 2).reduce((prev, curr) => prev + curr.cells.length, 0.5),
            ];                           
        }
       
        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer === 3) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): PluralityGame {
        this.gameover = this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass";

        if (this.gameover) {
            const p1Score = this.scores[0];
            const p2Score = this.scores[1];
            this.winner = p1Score > p2Score ? [1] : [2]; // draws are not possible
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    /**
     * Anything up in your IPluralityState definition needs to be here.
     */
    public state(): IPluralityState {
        return {
            game: PluralityGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    /**
     * And same here for IMoveState. The base object uses these to save things.
     * If you're new to TypeScript, you will want to familiarize yourself with the difference between reference types and value types. There's a reason you can't just say `board: this.board` in the below. You need to actually create a fresh map that duplicates `this.board`.
     */
    public moveState(): IMoveState {
        return {
            _version: PluralityGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    /**
     * And this is how you turn a game state into something people can see and interact with.
     * The system tries to abstract things as much as possible. You don't have to know anything about computer graphics. You just need to be able to get the rendering engine to do what you want.
     * To learn that, you will want to visit <http://renderer.dev.abstractplay.com> and learn how the renderer works. Basically you need to choose a board, load your pieces, populate the board, and then annotate any recent moves.
     * You will see a fair bit of `// @ts-ignore`. This is not good practice generally, but I have found them necessary here. The type system is very strict, and sometimes that gets in the way. As long as your render actually works in the playground, you're OK, regardless of what type errors are thrown here.
     */
    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },            
            pieces: pstr
        };

        // add territory dots        
        const territories = this.getTerritories();
        let markers: Array<MarkerDots> | undefined = []
        for (const t of territories) {
            if (t.owner !== undefined) {
                const points = t.cells.map(c => this.algebraic2coords(c));
                markers.push({type: "dots", colour: t.owner, points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
            }
        }
        if (markers.length === 0) {
            markers = undefined;
        }
        if (markers !== undefined) {
            (rep.board as BoardBasic).markers = markers;
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    /**
     * This function is only for the local playground.
     */
    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        return status;
    }

    /**
     * This is for rendering each move in the front end's chat log.
     * For simple games, you can start by deleting this and going with the defaults.
     * And then, if you need something special, it might be simpler just to ask for direction in the Discord. But basically you can customize the chat message for your specific game.
     */
     /*
    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                resolved = true;
                break;
        }
        return resolved;
    }*/

    /**
     * Just leave this. You very, very rarely need to do anything here.
     */
    public clone(): PluralityGame {
        return new PluralityGame(this.serialize());
    }
}
