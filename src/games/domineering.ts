import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2; // 1 is vertical, 2 is horizontal

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IDomineeringState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class DomineeringGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Domineering",
        uid: "domineering",
        playercounts: [2],
        version: "20260425",
        dateAdded: "2026-04-25",
        // i18next.t("apgames:descriptions.domineering")
        description: "apgames:descriptions.domineering",
        notes: "apgames:notes.domineering",
        urls: [
                "https://boardgamegeek.com/boardgame/7450/stop-gate",
                "https://jpneto.github.io/world_abstract_games/modern_rules/2025_Quelhas.pdf"
              ],
        people: [
            {
                type: "designer",
                name: "Göran Andersson",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>place", "board>shape>rect", "components>simple>1per"],
        variants: [
            { uid: "size-6",  group: "board" },
            { uid: "size-7",  group: "board" },
            { uid: "#board", },  // 8x8
            { uid: "size-9",  group: "board" },
            { uid: "size-10", group: "board" },
            { uid: "quelhas", group: "ruleset" },
        ],
        flags: ["pie", "experimental"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private _points: [number, number][] = []; // if there are points here, the renderer will show them
    private ruleset: "default" | "quelhas";

    constructor(state?: IDomineeringState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            this.boardSize = this.getBoardSize();
            const fresh: IMoveState = {
                _version: DomineeringGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDomineeringState;
            }
            if (state.game !== DomineeringGame.gameinfo.uid) {
                throw new Error(`The Domineering game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): DomineeringGame {
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
        this.results = [...state._results];
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 &&
            this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 8;
    }

    private getRuleset(): "default" | "quelhas" {
        if (this.variants.includes("quelhas")) { return "quelhas"; }
        return "default";
    }

    // get the orthogonal adjacent cells of cell (x,y)
    private neighbors(x: number, y: number, dirs: number[][]): number[][] {
        const result = [];
        for (const [dx,dy] of dirs) {
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

    private sort(a: string, b: string): number {
        // sort the two cells; necessary because "a10" should come after "a9"
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ay < by) { return  1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return  1; }
        return 0;
    }

    private normaliseMove(move: string): string {
        // sort the move list so that there is a unique representation.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        player ??= this.currplayer;
        const isVertical: boolean = player === 1;

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = this.coords2algebraic(x, y);
                if ( this.board.has(cell) ) continue;

                if (this.ruleset === "quelhas") {
                    if ( isVertical ) {
                        for (let y1 = y+1; y1 < this.boardSize; y1++) {
                            const neigh = this.coords2algebraic(x, y1);
                            if ( this.board.has(neigh) ) { break; }
                            moves.push(this.normaliseMove(`${cell},${neigh}`));
                        }
                    } else {
                        for (let x1 = x+1; x1 < this.boardSize; x1++) {
                            const neigh = this.coords2algebraic(x1, y);
                            if ( this.board.has(neigh) ) { break; }
                            moves.push(this.normaliseMove(`${cell},${neigh}`));
                        }
                    }
                } else { // default rules for Domineering
                    const dirs = isVertical ? [[0,1]] : [[1,0]];
                    for(const [xn, yn] of this.neighbors(x, y, dirs)) {
                        const neigh = this.coords2algebraic(xn, yn);
                        if (! this.board.has(neigh) ) {
                            moves.push(this.normaliseMove(`${cell},${neigh}`));
                        }
                    }
                }
            }
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string = "";
            const cell = this.coords2algebraic(col, row);

            if ( move === "" ) {
                newmove = cell;
            } else if ( move === cell ) { // if first cell is reclicked, clear everything
                newmove = "";
            } else {
                newmove = this.normaliseMove(`${move},${cell}`);
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            };
        }
    }

    // return the list of cells that a given piece at 'cell' can move to
    // requires: cell is still empty
    private findPoints(cell: string): string[] {
        const allMoves = this.moves();
        const list1 = allMoves.map(move => move.split(','))         // ["a1,b1"] --> ["a1", "b1"]
                              .filter(([from,]) => from === cell)   // keep moves starting at cell
                              .map(([, to]) => to);                 // extract destination
        const list2 = allMoves.map(move => move.split(','))
                              .filter(([,to]) => to === cell)       // keep moves ending at cell
                              .map(([from, ]) => from);             // extract source
        return [...list1, ...list2];
    }

    private areAdjacent(cell1: string, cell2: string): boolean {
      const [x1, y1] = this.algebraic2coords(cell1);
      const [x2, y2] = this.algebraic2coords(cell2);
      if ( this.currplayer === 1 ) {
          return Math.abs(y1 - y2) === 1 && Math.abs(x1 - x2) === 0;
      } else {
          return Math.abs(y1 - y2) === 0 && Math.abs(x1 - x2) === 1;
      }
    }

    private areLinear(cell1: string, cell2: string): boolean {
      const [x1, y1] = this.algebraic2coords(cell1);
      const [x2, y2] = this.algebraic2coords(cell2);
      if ( this.currplayer === 1 ) {
          return Math.abs(y1 - y2)  >  0 && Math.abs(x1 - x2) === 0;
      } else {
          return Math.abs(y1 - y2) === 0 && Math.abs(x1 - x2)  >  0;
      }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false,
                                            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.ruleset === "quelhas") {
                result.message = i18next.t("apgames:validation.domineering.INITIAL_INSTRUCTIONS_QUELHAS");
            } else{
                result.message = i18next.t("apgames:validation.domineering.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = this.normaliseMove(m);
        const moves = m.split(',');

        for (const cell of moves) {
            if ( this.board.has(cell) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.domineering.OCCUPIED_CELL");
                return result;
            }
        }

        if (moves.length === 1) {
            const legalMoves = this.findPoints(m);
            if ( legalMoves.length === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.domineering.NO_SPACE_LEFT");
                return result;
            }
            result.valid = true;
            result.complete = -1; // still need to complete the domino
            result.canrender = true;
            if (this.ruleset === "quelhas") {
                if ( this.currplayer === 1 ) {
                    result.message = i18next.t("apgames:validation.domineering.PLACE_NEXT_STONE_LINE_VERT");
                } else  {
                    result.message = i18next.t("apgames:validation.domineering.PLACE_NEXT_STONE_LINE_HORZ");
                }
            } else {
                if ( this.currplayer === 1 ) {
                    result.message = i18next.t("apgames:validation.domineering.PLACE_NEXT_STONE_VERT");
                } else  {
                    result.message = i18next.t("apgames:validation.domineering.PLACE_NEXT_STONE_HORZ");
                }
            }
            return result;
        }

        if (this.ruleset === "quelhas") {
            if (! this.areLinear(moves[0], moves[1]) ) {
                result.valid = false;
                if ( this.currplayer === 1 ) {
                    result.message = i18next.t("apgames:validation.domineering.MUST_BE_LINE_VERT");
                } else  {
                    result.message = i18next.t("apgames:validation.domineering.MUST_BE_LINE_HORZ");
                }
                return result;
            }
        } else {
            if (! this.areAdjacent(moves[0], moves[1]) ) {
                result.valid = false;
                if ( this.currplayer === 1 ) {
                    result.message = i18next.t("apgames:validation.domineering.MUST_BE_DOMINO_VERT");
                } else  {
                    result.message = i18next.t("apgames:validation.domineering.MUST_BE_DOMINO_HORZ");
                }
                return result;
            }
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private squaresBetween(a: string, b: string): string[] {
      const fileToNum = (c: string) => c.charCodeAt(0) - "a".charCodeAt(0);
      const numToFile = (n: number) => String.fromCharCode(n + "a".charCodeAt(0));

      const f1 = fileToNum(a[0]);
      const r1 = Number(a.slice(1));
      const f2 = fileToNum(b[0]);
      const r2 = Number(b.slice(1));

      const result: string[] = [];

      // Same column
      if (f1 === f2) {
        const step = r1 <= r2 ? 1 : -1;
        for (let r = r1; r !== r2 + step; r += step) {
          result.push(`${a[0]}${r}`);
        }
      }
      // Same row
      else if (r1 === r2) {
        const step = f1 <= f2 ? 1 : -1;
        for (let f = f1; f !== f2 + step; f += step) {
          result.push(`${numToFile(f)}${r1}`);
        }
      } else {
        throw new Error("Coordinates are not in the same row or column");
      }

      return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): DomineeringGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = this.normaliseMove(m);

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        if (m.length === 0) { return this; } // note: this allows the re-click cell reset

        if (partial) {
            this._points = this.findPoints(m).map(c => this.algebraic2coords(c));
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        this.results = [];
        if (this.ruleset === "quelhas") {
            const moves = m.split(",");
            if ( moves.length === 1 ) {
                this.board.set(moves[0], this.currplayer);
                this.results.push({type: "place", where: moves[0]});
            } else {
                const [cell1, cell2] = m.split(",");
                for (const cell of this.squaresBetween(cell1, cell2)) {
                    this.board.set(cell, this.currplayer);
                    this.results.push({type: "place", where: cell});
                }
            }
        } else {
            for (const move of m.split(",")) {
                this.board.set(move, this.currplayer);
                this.results.push({type: "place", where: move});
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): DomineeringGame {
        this.gameover = this.moves(this.currplayer).length == 0;

        if (this.gameover) {
            if (this.ruleset === "quelhas") {
                this.winner = [this.currplayer]; // Quelhas is Misère
            } else {
                this.winner = [this.currplayer% 2 + 1 as playerid];
            }
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IDomineeringState {
        return {
            game: DomineeringGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: DomineeringGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    // get cells occupied by each player
    private influenceMarkers(): Map<playerid, {row: number, col: number}[]> {
        const markers = new Map<playerid, {row: number, col: number}[]>([ [1, []], [2, []] ]);

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = this.coords2algebraic(x, y);
                if ( this.board.has(cell) ) {
                    const player = this.board.get(cell)!;
                    const [x, y] = this.algebraic2coords(cell);
                    const cellCoords = {row: y, col: x};
                    markers.get(player)!.push(cellCoords);
                }
            }
        }
        return markers;
    }

    public render(): APRenderRep {
        // for each placement, show the entire filled square instead of a regular piece
        let points1: {row: number, col: number}[] = [];
        let points2: {row: number, col: number}[] = [];
        const points = this.influenceMarkers();
        points1 = points.get(1)!;
        points2 = points.get(2)!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let markers: Array<any> | undefined = []
        if (points1.length > 0) {
            markers.push({ type   : "flood",
                           colour : 1,
                           opacity: 1,
                           points : points1 as [RowCol, ...RowCol[]] });
        }
        if (points2.length > 0) {
            markers.push({ type   : "flood",
                           colour : 2,
                           opacity: 1,
                           points : points2 as [RowCol, ...RowCol[]] });
        }
        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: null, // pstr, // just show the floods, to better emulate dominoes
        };

        // Add annotations
        rep.annotations = [];
        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // show the dots where the selected piece can move to
        if (this._points.length > 0) {
            const points = [];
            for (const [x,y] of this._points) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    public clone(): DomineeringGame {
        return new DomineeringGame(this.serialize());
    }
}