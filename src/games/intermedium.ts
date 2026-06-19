import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
export type cellcontents = [playerid, number];

const BOARD_ROWS = 10;
const BOARD_COLS = 7;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
}

export interface IIntermediumState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class IntermediumGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Intermedium",
        uid: "intermedium",
        playercounts: [2],
        version: "20260619",
        dateAdded: "2026-06-19",
        // i18next.t("apgames:descriptions.intermedium")
        description: "apgames:descriptions.intermedium",
        urls: [
                "https://jpneto.github.io/world_abstract_games/intermedium.htm",
                "https://boardgamegeek.com/boardgame/8215"
              ],
        people: [
            {
                type: "designer",
                name: "Matt Crispis",
                urls: ["https://boardgamegeek.com/boardgamedesigner/2818/matt-crispis"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>royal-capture", "goal>cripple", "mechanic>move>sow", "mechanic>capture", "mechanic>stack", "mechanic>enclose","board>shape>rect", "board>connect>rect", "components>simple>2c"],
        flags: ["no-moves", "experimental"],
        displays: [{uid: "hide-diagonals"}],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_ROWS);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_ROWS);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _selected: null | [string, number] = null;

    constructor(state?: IIntermediumState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, cellcontents>([  // initial setup
                ["a2", [1,4]], ["c2", [1,4]], ["e2", [1,4]], ["g2", [1,4]],
                        ["b3", [1,4]], ["d3", [1,4]], ["f3", [1,4]],
                ["a4", [1,4]], ["c4", [1,4]], ["e4", [1,4]], ["g4", [1,4]],

                ["a7", [2,4]], ["c7", [2,4]], ["e7", [2,4]], ["g7", [2,4]],
                        ["b8", [2,4]], ["d8", [2,4]], ["f8", [2,4]],
                ["a9", [2,4]], ["c9", [2,4]], ["e9", [2,4]], ["g9", [2,4]],
            ]);
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: IntermediumGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
               state = JSON.parse(state, reviver) as IIntermediumState;
            }
            if (state.game !== IntermediumGame.gameinfo.uid) {
                throw new Error(`The Intermedium game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): IntermediumGame {
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
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if ( move === "" ) { // starting fresh
                newmove = `${cell}>1`;
            } else if ( !move.includes('@')) { // sowing still not started (eg, b1>1)
                const [sowingStack, n] = move.split('>');
                if ( sowingStack === cell ) {
                    newmove = `${sowingStack}>${Number(n)+1}`; // add a new piece for sowing
                } else if (Number(n) === 1) {
                    newmove = `${sowingStack}@${cell}`; // sow just one stone
                } else {
                    newmove = `${sowingStack}>${Number(n)-1}@${cell}`; // start sowing
                }
            } else if ( move.includes('>') && move.includes('@') ) { // in the middle of sowing (eg, b1>3@c1)
                const [sowingStack, n, sowingPath] = move.split(/[>@]/);
                if ( Number(n) > 1 ) {
                    newmove = `${sowingStack}>${Number(n)-1}@${sowingPath}-${cell}`; // continue sowing
                } else { // all pieces were sowed (eg, b1>1@c1-d1  becomes  b1@c1-d1-cell)
                    newmove = `${sowingStack}@${sowingPath}-${cell}`; // end sowing
                }
            } else {
                throw new Error(`Unexpected move syntax: previous move ${move}, current cell ${cell}`);
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : "";
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    // check diagonal adjacency
    private isDiagAdjacent(a: string, b: string): boolean {
      const [x1, y1] = this.algebraic2coords(a);
      const [x2, y2] = this.algebraic2coords(b);
      return Math.abs(x1 - x2) === 1 && Math.abs(y1 - y2) === 1;
    }

    // checks if the given path is legal according to Intermedium's rules
    private isValidPath(start: string, remainingSowSize: number, path: string[]): boolean {
      if (path.length === 0) return true;

      // first step must be adjacent to start
      if (! this.isDiagAdjacent(start, path[0]) ) {
          return false;
      }

      let prev = start;
      let prevDir: [number, number] | null = null;

      for (const cell of path) {
        if (! this.isDiagAdjacent(prev, cell) ) { return false; }
        const [x1, y1] = this.algebraic2coords(prev);
        const [x2, y2] = this.algebraic2coords(cell);
        const dir: [number, number] = [x2 - x1, y2 - y1];

        if (prevDir && (dir[0] !== 0 || dir[1] !== 0)) {  // check no 180° turn
          const isOpposite = dir[0] === -prevDir[0] && dir[1] === -prevDir[1];
          if (isOpposite) { return false; }
        }

        prevDir = dir;
        prev = cell;
      }

      return true;
    }

    /** Move type | Requirements
     *  c1>n      | friend(c1), n <= size(c1)
     *  c1>n@path | path diagonal
     *  c1@path   | (same)
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false,
                                            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.intermedium.INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const initialCell = m.split(/[>@]/)[0];

        try {
            this.algebraic2coords(initialCell); // check if valid cell
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }

        const isEmpty   = !this.board.has(initialCell);
        const hasEnemy  =  this.board.has(initialCell) && this.board.get(initialCell)![0] !== this.currplayer;

        if ( isEmpty || hasEnemy || this.board.get(initialCell)![1] === 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.intermedium.NOT_FRIENDLY_STACK");
            return result;
        }

        if (! m.includes('@') ) { // we are still finding how many pieces are to be sowed
            const info = m.split(/[>]/); // eg, c1>n1
            const sowingStack = info[0];
            const n1 = Number(info[1]);

            if ( n1 > this.board.get(sowingStack)![1] ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.intermedium.SOW_TOO_LARGE");
                return result;
            }
            result.valid = true;
            result.complete = -1; // still necessary to state the sowing path, next
            result.canrender = true;
            result.message = i18next.t("apgames:validation.intermedium.SOW_INSTRUCTIONS");
            return result;
        }

        // there is already a (partial) path; check if path is correct
        const tokens = m.split(/[>@]/);
        const sowingStack = tokens[0];
        let remainingSowSize : number = 0;
        let cellsPath : string[];

        if ( m.includes('>') ) { // eg, c1>n1@path
            remainingSowSize = Number(tokens[1]); // get n1
            cellsPath = tokens[2].split('-');
        } else {                 // eg, c1@path
            cellsPath = tokens[1].split('-');
        }

        try { // check if cells in path are valid
            for (const cell of cellsPath) { this.algebraic2coords(cell); }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if (! this.isValidPath(sowingStack, remainingSowSize, cellsPath) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.intermedium.INVALID_SOW_PATH");
            return result;
        }

        result.valid = true;
        result.complete = m.includes('>') ? -1 : 1; // incomplete until all pieces are sowed
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // returns all opponent's that are surrounded, and adjacent to `ownPiece`
    private performCaptures(ownPiece: string): string[] {
        const g = new SquareOrthGraph(BOARD_COLS, BOARD_ROWS);
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const oppPieces = this.getPieces(prevplayer);
        const captured = [];

        for (const piece of oppPieces) {
            let surrounded = true, foundMyPiece = false;
            for (const neigh of g.neighbours(piece)) {
                surrounded = surrounded && this.board.has(neigh);
                foundMyPiece = foundMyPiece || (neigh === ownPiece);
            }
            if ( surrounded && foundMyPiece ) { captured.push(piece); }
        }

        return captured;
    }

    public move(m: string, {partial = false, trusted = false} = {}): IntermediumGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        if (m.length === 0) { return this; }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message); }
        }

        this.results = [];
        // the possible commands have format "c2>n1@path" or "c2@path"
        const commands: string[] = m.split(/[>@]/);

        // populate _selected (used in rendering)
        if ( m.includes(">") ) {
            const sowingStack = commands[0];
            const n1 = Number(commands[1]); // pieces that await their turn to be sowed
            this._selected = [sowingStack, n1];
        }

        // do the partial sowing (eg, c2>n1@path )
        if ( m.includes('>') && m.includes('@') ) {
            const sowingStack = commands[0];
            const originalSize = this.board.get(sowingStack)![1];
            const n1 = Number(commands[1]); // pieces that await their turn to be sowed
            const cells = m.split(/[@]/)[1].split(/[-]/);
            const totalSowed = n1 + cells.length; // the total number of pieces in the sowing move

            this.board.set(sowingStack, [this.currplayer, originalSize - totalSowed + n1]);

            for (const cell of cells) {
                const size = this.board.has(cell) && this.board.get(cell)![0] == this.currplayer
                             ? this.board.get(cell)![1] : 0;
                this.board.set(cell, [this.currplayer, size+1]); // place a friendly piece (possibly w/capture)
            }

            const sowingPath = [sowingStack, ...cells]
            for(let i = 0; i < sowingPath.length-1; i++ ) { // mark path
                this.results.push({type: "move", from: sowingPath[i], to: sowingPath[i+1]});
            }
            return this;
        }

        // or do the complete sowing (eg, c2@path )
        if ( m.includes('@') ) {
            const sowingStack = commands[0];
            const cells = commands[1].split(/[-]/);
            const n1: number = cells.length; // number of pieces to be removed from sowingStack

            if ( this.board.get(sowingStack)![1] === n1 ) { // the entire stack is moving
                this.board.delete(sowingStack);
            } else { // otherwise, just update the stack's size
                this.board.set(sowingStack, [this.currplayer, this.board.get(sowingStack)![1] - n1]);
            }

            for (const cell of cells) {
                const size: number = this.board.has(cell) && this.board.get(cell)![0] == this.currplayer
                                     ? this.board.get(cell)![1] : 0;
                this.board.set(cell, [this.currplayer, size+1]); // place a friendly piece (possibly w/capture)
            }

            if ( this.board.get(cells.at(-1)!)![1] === 2 ) { // the last piece landed over a stack of size 1
                // check if there are any captures to be made after sowing
                const captures = this.performCaptures(cells.at(-1)!);
                for (const captured of captures) {
                    this.board.delete(captured);
                }
                if ( captures.length > 0 ) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }
            }

            const sowingPath = [sowingStack, ...cells]
            for(let i = 0; i < sowingPath.length-1; i++ ) { // mark path
                this.results.push({type: "move", from: sowingPath[i], to: sowingPath[i+1]});
            }
        }

        if ( partial ) { return this; }

        this.lastmove = m;
        this._selected = null;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private isCitySurrounded(): boolean {
        const cityNeighs = this.currplayer === 1 ? ["c1", "d2", "e1"] : ["c10", "d9", "e10"];

        for (const neigh of cityNeighs) {
            if (! this.board.has(neigh) ) {
                return false;
            }
        }
        return true;
    }

    protected checkEOG(): IntermediumGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;

        // win by surrounding the opponent's city
        if ( this.isCitySurrounded() ) {
            this.gameover = true;
            this.winner = [prevplayer];
        } else {
            // a stalemated player loses the game
            const stalematedCurr = this.getStacks().length === 0;
            const stalematedPrev = this.getStacks(prevplayer).length === 0;

            if ( stalematedCurr ) {
                this.gameover = true;
                this.winner = [prevplayer];
            } else if ( stalematedPrev ) {
                this.gameover = true;
                this.winner = [this.currplayer]; // avoids an extra turn
            }
        }

        if (this.gameover) {
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showDiagonals = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-diagonals") {
                showDiagonals = false;
            }
        }
        // Build piece string
        let pstr = "";
        for (let row = 0; row < BOARD_ROWS; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            const pieces: string[] = [];
            for (let col = 0; col < BOARD_COLS; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    let idxSelected: null|number = null;
                    if (this._selected !== null && this._selected[0] === cell) {
                        idxSelected = contents[1] - this._selected[1];
                    }
                    let str = "";
                    for (let i = 0; i < contents[1]; i++) {
                        if (idxSelected !== null && i === idxSelected) {
                            str += "X";
                        }
                        if (contents[0] === 1) {
                            str += "A";
                        } else {
                            str += "B";
                        }
                    }
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/-{9}/g, "_");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> = [
            {
              type: "shading",
              colour: 1,
              opacity: 0.2,
              points: [{row:10, col:3}, {row:10, col:4}, {row:9, col:4}, {row:9, col:3} ]
            },
            {
              type: "glyph",
              glyph: "Center1",
              points: [ {row: 9, col: 3} ]
            },
            {
              type: "shading",
              colour: 2,
              opacity: 0.2,
              points: [{row:1, col:3}, {row:1, col:4}, {row:0, col:4}, {row:0, col:3} ]
            },
            {
              type: "glyph",
              glyph: "Center2",
              points: [ {row: 0, col: 3} ]
            },
        ];

        if (showDiagonals) {
            const diagonals1 = [
                [{ row: 8, col: 0 }, { row: 9, col: 1 }],
                [{ row: 6, col: 0 }, { row: 9, col: 3 }],
                [{ row: 4, col: 0 }, { row: 9, col: 5 }],
                [{ row: 2, col: 0 }, { row: 8, col: 6 }],
                [{ row: 0, col: 0 }, { row: 6, col: 6 }],
                [{ row: 0, col: 2 }, { row: 4, col: 6 }],
                [{ row: 0, col: 4 }, { row: 2, col: 6 }],

                [{ row: 2, col: 0 }, { row: 0, col: 2 }],
                [{ row: 4, col: 0 }, { row: 0, col: 4 }],
                [{ row: 6, col: 0 }, { row: 0, col: 6 }],
                [{ row: 8, col: 0 }, { row: 2, col: 6 }],
                [{ row: 9, col: 1 }, { row: 4, col: 6 }],
                [{ row: 9, col: 3 }, { row: 6, col: 6 }],
                [{ row: 9, col: 5 }, { row: 8, col: 6 }],
            ]
            for (const diagonal of diagonals1) {
                markers.push({
                    type: "line",
                    points: diagonal,
                    colour: 1,
                    width: 5,
                    opacity: 0.2,
                    centered: true,
                })
            }

            const diagonals2 = [
                [{ row: 1, col: 0 }, { row: 0, col: 1 }],
                [{ row: 3, col: 0 }, { row: 0, col: 3 }],
                [{ row: 5, col: 0 }, { row: 0, col: 5 }],
                [{ row: 7, col: 0 }, { row: 1, col: 6 }],
                [{ row: 9, col: 0 }, { row: 3, col: 6 }],
                [{ row: 9, col: 2 }, { row: 5, col: 6 }],
                [{ row: 9, col: 4 }, { row: 7, col: 6 }],

                [{ row: 0, col: 5 }, { row: 1, col: 6 }],
                [{ row: 0, col: 3 }, { row: 3, col: 6 }],
                [{ row: 0, col: 1 }, { row: 5, col: 6 }],
                [{ row: 1, col: 0 }, { row: 7, col: 6 }],
                [{ row: 3, col: 0 }, { row: 9, col: 6 }],
                [{ row: 5, col: 0 }, { row: 9, col: 4 }],
                [{ row: 7, col: 0 }, { row: 9, col: 2 }],
            ]
            for (const diagonal of diagonals2) {
                markers.push({
                    type: "line",
                    points: diagonal,
                    colour: 2,
                    width: 5,
                    opacity: 0.2,
                    centered: true,
                })
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares",
                width: BOARD_COLS,
                height: BOARD_ROWS,
                markers
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                X: [{ name: "piece-borderless", opacity: 0 }],
                Center1: {
                    name: "chess-king-solid-millenia",
                    colour: 1,
                    opacity: 0.8,
                    scale: 0.85
                },
                Center2: {
                    name: "chess-king-solid-millenia",
                    colour: 2,
                    opacity: 0.8,
                    scale: 0.85
                },
            },
            pieces: pstr,
        };

        rep.annotations = [];

        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                }
            }
        }

        return rep;
    }

    // return all `player` pieces
    private getPieces(player?: playerid): string[] {
        player ??= this.currplayer;
        return [...this.board.entries()].filter(e => e[1][0] === player).map(e => e[0]);
    }

    // return all stack pieces
    private getStacks(player?: playerid): [string, cellcontents][] {
        player ??= this.currplayer;
        return [...this.board.entries()].filter(e => e[1][0] === player && e[1][1] > 1);
    }

    public cloneBoard(): Map<string, cellcontents> {
        return new Map([...this.board].map(([k, v]) => [k, [...v]]));
    }

    public state(): IIntermediumState {
        return {
            game: IntermediumGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: IntermediumGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
        };
    }

    public clone(): IntermediumGame {
        return new IntermediumGame(this.serialize());
    }
}
