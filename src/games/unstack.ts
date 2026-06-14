import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, SquareOrthGraph, UserFacingError } from "../common";
import { connectedComponents } from "graphology-components";
import i18next from "i18next";

type playerid = 1 | 2;
export type cellcontents = [playerid, number];

const BOARD_SIZE = 7;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
}

export interface IUnstackState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class UnstackGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Unstack",
        uid: "unstack",
        playercounts: [2],
        version: "20260614",
        dateAdded: "2026-06-14",
        // i18next.t("apgames:descriptions.unstack")
        description: "apgames:descriptions.unstack",
        urls: [
                "https://jpneto.github.io/world_abstract_games/unstack.htm",
                "https://boardgamegeek.com/boardgame/27013/unstack",
                "https://mancala.fandom.com/wiki/UnStack"
              ],
        people: [
            {
                type: "designer",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>area", "mechanic>move>sow", "mechanic>capture", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>2c"],
        flags: ["scores", "no-moves", "autopass", "custom-buttons", "experimental"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }

    public get graph(): SquareOrthGraph {
        return new SquareOrthGraph(BOARD_SIZE, BOARD_SIZE);
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

    constructor(state?: IUnstackState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, cellcontents>([  // initial setup
                ["a1", [1,5]], ["c1", [1,5]], ["e1", [1,5]], ["g1", [1,5]],
                        ["b2", [1,3]], ["d2", [1,3]], ["f2", [1,3]],

                        ["b6", [2,3]], ["d6", [2,3]], ["f6", [2,3]],
                ["a7", [2,5]], ["c7", [2,5]], ["e7", [2,5]], ["g7", [2,5]],
            ]);
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: UnstackGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
               state = JSON.parse(state, reviver) as IUnstackState;
            }
            if (state.game !== UnstackGame.gameinfo.uid) {
                throw new Error(`The Unstack game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): UnstackGame {
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

    // there are too many moves to list; however, if no sowing is possible, the only move
    // is to pass, so let's use moves() to activate flag "autopass" in those situations
    public moves(player?: playerid): string[] {
        player ??= this.currplayer;
        return this.canSow(player) ? ["dummy1", "dummy2"] : ["pass"];
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

    // check orthogonal adjacency
    private isOrthAdjacent(a: string, b: string): boolean {
      const [x1, y1] = this.algebraic2coords(a);
      const [x2, y2] = this.algebraic2coords(b);
      return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
    }

    private countPreviousRepetitions(list: string[], i: number): number {
        if (i <= 0 || i >= list.length) { return 0; }
        let count = 0;
        for (let j = 0; j < i; j++) {
            if (list[j] === list[i]) {
                count++;
            }
        }
        return count;
    }

    // checks if the given path is legal according to Unstack's rules
    private isValidPath(start: string, remainingSowSize: number, path: string[]): boolean {
      if (path.length === 0) return true;

      // first step must be adjacent to start
      if (! this.isOrthAdjacent(start, path[0]) ) {
          return false;
      }

      let currentSowSize = remainingSowSize + path.length; // initial amount of pieces to sow
      let prev = start;
      let prevDir: [number, number] | null = null;
      let idx = 0;

      for (const cell of path) {
        if ( !this.isOrthAdjacent(prev, cell) && prev !== cell ) { return false; }
        const [x1, y1] = this.algebraic2coords(prev);
        const [x2, y2] = this.algebraic2coords(cell);
        const dir: [number, number] = [x2 - x1, y2 - y1];

        if (prevDir && (dir[0] !== 0 || dir[1] !== 0)) {  // check no 180° turn
          const isOpposite = dir[0] === -prevDir[0] && dir[1] === -prevDir[1];
          if (isOpposite) { return false; }
        }

        // check if current position is occupied by an un-capturable enemy stack
        if ( this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer ) {
            // this cell has an enemy stack, check if size is compatible
            const size = this.board.get(cell)![1];
            const reps = this.countPreviousRepetitions(path, idx); // get previous cell #repetitions
            if ( currentSowSize + reps < size ) {
                return false; // enemy stack is too big; this path is invalid
            }
        }

        prevDir = dir;
        prev = cell;
        currentSowSize -= 1; // one piece stays here, the rest are to be sowed in the remaining path
        idx += 1;
      }

      return true;
    }

    // a player can sow if he has a stack adjacent to:
    //  * an empty space, or
    //  * a friendly piece, or
    //  * an enemy stack not larger that it
    private canSow(player?: playerid): boolean {
        player ??= this.currplayer;
        const stacks = this.getStacks(player).map(e => e[0]);
        const g = this.graph;

        for (const stack of stacks) {
            for (const neigh of g.neighbours(stack)) {
                if ( !this.board.has(neigh) ||
                      this.board.get(neigh)![0] === player ||
                      this.board.get(neigh)![1] <= this.board.get(stack)![1] ) {
                    return true;
                }
            }
        }
        return false;
    }

    private manhattan(cell1: string, cell2: string): number {
        const [x1, y1] = this.algebraic2coords(cell1);
        const [x2, y2] = this.algebraic2coords(cell2);
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    // shortest-path distance between source and target, considering only nodes in the connected component C
    // returns -1 if either node is not in C or no path exists.
    private distanceInComponent(graph: SquareOrthGraph, C: string[], source: string, target: string): number {
      const component = new Set(C);
      if (!component.has(source) || !component.has(target)) { return -1; }
      if (source === target) { return 0; }

      const visited = new Set<string>([source]);
      const queue: Array<[string, number]> = [[source, 0]];

      while (queue.length > 0) {
        const [node, dist] = queue.shift()!;

        for (const neighbor of graph.neighbours(node)) {
          if (!component.has(neighbor) || visited.has(neighbor))
            continue;
          if (neighbor === target)
            return dist + 1;
          visited.add(neighbor);
          queue.push([neighbor, dist + 1]);
        }
      }
      return -1;
    }

    // since captures are mandatory, need a method to check if they exist for a given `player`
    // the method returns [from, to] with a possible capture, or [] otherwise
    private capturesAvailable(player?: playerid): string[] {
        player ??= this.currplayer;                                   // heuristic: search bigger stacks first
        const ownStacks: [string, cellcontents][] = this.getStacks(player).sort((a, b) => b[1][1] - a[1][1]);

        // for a capture to exist, a path must exist from a friendly stack to a capturable piece
        for (const [stackCell, stackInfo] of ownStacks) {
            const stackSize = stackInfo[1];
            // create a graph where all non-capturing opponent pieces are removed
            const areas = this.graph;
            for (const node of areas.graph.nodes()) {
                if ( !this.board.has(node) || this.board.get(node)![0] === player ) { continue };
                // an opponent piece is not capturable if its (distance-1) + its size > current stack's size
                const distance = this.manhattan(stackCell, node);
                const oppSize = this.board.get(node)![1];
                if ( (distance - 1) + oppSize > stackSize ) {
                    // current `stack` cannot capture opponent's `node`, so make it unreachable
                    areas.graph.dropNode(node);
                }
            }
            const groups : Array<Array<string>> = connectedComponents(areas.graph);

            for (const group of groups) {
                if ( group.includes(stackCell) ) {
                    for (const cell of group) {
                        // any opponent stack in the group of `stack` means a capture might exist
                        if ( this.board.has(cell) && this.board.get(cell)![0] !== player ) {
                            // is the opponent stack is within bounds?
                            const distance = this.distanceInComponent(areas, group, stackCell, cell);
                            const oppSize = this.board.get(cell)![1];
                            if ( (distance - 1) + oppSize <= stackSize ) {
                                return [stackCell, cell]; // found a capture, send it to show as an example
                            }
                        }
                    }
                }
            }
        }
        return [];
    }

    /** Move type | Requirements
     *  c1>n      | friend(c1), n <= size(c1)
     *  c1>n@path | path orthogonal, max 1 valid capture
     *  c1@path   | (same)
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false,
                                            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.unstack.INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            if ( this.canSow() ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.unstack.CAN_SOW");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

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
            result.message = i18next.t("apgames:validation.unstack.NOT_FRIENDLY_STACK");
            return result;
        }

        if (! m.includes('@') ) { // we are still finding how many pieces are to be sowed
            const info = m.split(/[>]/); // eg, c1>n1
            const sowingStack = info[0];
            const n1 = Number(info[1]);

            if ( n1 > this.board.get(sowingStack)![1] ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.unstack.SOW_TOO_LARGE");
                return result;
            }
            result.valid = true;
            result.complete = -1; // still necessary to state the sowing path, next
            result.canrender = true;
            result.message = i18next.t("apgames:validation.unstack.SOW_INSTRUCTIONS");
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
            result.message = i18next.t("apgames:validation.unstack.INVALID_SOW_PATH");
            return result;
        }

        let nCaptures = 0; // get total number of captures
        for (const cell of new Set(cellsPath)) { // set to remove duplicates
            if ( this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer ) {
                nCaptures += 1;
            }
        }

        if ( nCaptures > 1 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.unstack.MULTIPLE_CAPTURES");
            return result;
        }

        // in a complete sowing, if captures are possible there must be one cell with an enemy piece/stack
        const egCapture = this.capturesAvailable();
        if ( !m.includes('>') && nCaptures === 0 && egCapture.length > 0 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.unstack.CAPTURES_MANDATORY", {from: egCapture[0], to:egCapture[1]});
            return result;
        }

        result.valid = true;
        result.complete = m.includes('>') ? -1 : 1; // incomplete until all pieces are sowed
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): UnstackGame {
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

        if (m === "pass") {
            this.results = [{ type: "pass" }];
        } else {
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

                const sowingPath = [sowingStack, ...cells]
                for(let i = 0; i < sowingPath.length-1; i++ ) { // mark path
                    this.results.push({type: "move", from: sowingPath[i], to: sowingPath[i+1]});
                }
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

    protected checkEOG(): UnstackGame {
        if ( this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" ) {
            this.gameover = true;
        }

        if (this.gameover) {
            const scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
            if ( scores[0] === scores[1] ) {
                this.winner = [1, 2];
            } else {
                this.winner = scores[0] > scores[1] ? [1] : [2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public render(): APRenderRep {
        let pstr = "";
        for (let row = 0; row < BOARD_SIZE; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            const pieces: string[] = [];
            for (let col = 0; col < BOARD_SIZE; col++) {
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

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "vertex",
                width: BOARD_SIZE,
                height: BOARD_SIZE,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                X: [{ name: "piece-borderless", opacity: 0 }],
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
                }
            }
        }

        return rep;
    }

    // return all non-stack pieces' cells
    private getPieces(player?: playerid): string[] {
        player ??= this.currplayer;
        return [...this.board.entries()].filter(e => e[1][0] === player && e[1][1] === 1).map(e => e[0]);
    }

    // return all stack pieces
    private getStacks(player?: playerid): [string, cellcontents][] {
        player ??= this.currplayer;
        return [...this.board.entries()].filter(e => e[1][0] === player && e[1][1] > 1);
    }

    public getPlayerScore(player: playerid): number {
        return this.getPieces(player).length;
    }

    public cloneBoard(): Map<string, cellcontents> {
        return new Map([...this.board].map(([k, v]) => [k, [...v]]));
    }

    public getButtons(): ICustomButton[] {
        return this.canSow() ? [] : [ { label: "pass", move: "pass" } ];
    }

    public sidebarScores(): IScores[] {
        return [ {name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)]} ];
    }

    public state(): IUnstackState {
        return {
            game: UnstackGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: UnstackGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
        };
    }

    public clone(): UnstackGame {
        return new UnstackGame(this.serialize());
    }
}
