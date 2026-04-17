import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import type { HexDir } from "../common/graphs/hextri";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ISquirmState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SquirmGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Squirm",
        uid: "squirm",
        playercounts: [2],
        version: "20260417",
        dateAdded: "2026-04-17",
        // i18next.t("apgames:descriptions.squirm")
        description: "apgames:descriptions.squirm",
        urls: ["https://jpneto.github.io/world_abstract_games/squirm.htm"],
        people: [
            {
                type: "designer",
                name: "Bryce Wilcox",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place", "board>shape>hex", "components>simple>1per"],
        variants: [
            { uid: "#board", },
            { uid: "size-4", group: "board" },
            { uid: "size-5", group: "board" },
            { uid: "size-6", group: "board" },
        ],
        flags: ["pie", "custom-buttons", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(3, 7, true);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 3;

    constructor(state?: ISquirmState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SquirmGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISquirmState;
            }
            if (state.game !== SquirmGame.gameinfo.uid) {
                throw new Error(`The Squirm engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SquirmGame {
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
        this.buildGraph();
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
        return 3;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, 2*this.boardSize+1, true);
    }

    private buildGraph(): SquirmGame {
        this.graph = this.getGraph();
        return this;
    }

    // Get all groups of pieces for `player`, sorted by decreasing size
    private getGroupSizes(player: playerid): number[] {
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups.map(g => g.size).sort((a, b) => b - a);
    }

    // checks if a given player has a 'len' in-a-row
    public checkLines(len: number, player: playerid): boolean {
        const collate = (cells: string[], dir: HexDir): string[] => {
            const localLines: string[] = [];
            for (const cell of cells) {
                const [cx, cy] = this.graph.algebraic2coords(cell);
                const ray = this.graph.ray(cx, cy, dir, true)
                                      .map(c => this.graph.coords2algebraic(...c))
                                      .map(n => this.board.has(n) ? this.board.get(n)! : "-")
                                      .join("");
                localLines.push(ray);
            }
            return localLines;
        }

        const g = new HexTriGraph(this.boardSize, 2*this.boardSize+1, true);
        const lines: string[] = [];
        const edges = g.getEdges();

        lines.push(...collate([...new Set<string>([...edges.get("SW")!, ...edges.get("S")!]).values()], "NE"));
        lines.push(...collate([...new Set<string>([...edges.get("SW")!, ...edges.get("NW")!]).values()], "E"));
        lines.push(...collate([...new Set<string>([...edges.get("NW")!, ...edges.get("N")!]).values()], "SE"));

        const target = Array.from({length: len}, () => player).join("");
        for (const line of lines) {
            if (line.includes(target)) {
                return true;
            }
        }
        return false;
    }

    private hasThrees(player: playerid): boolean {
        return this.checkLines(3, player);
    }

    // get all adjacent cells with friendly pieces
    private friendlyNeighbors(cell: string): string[] {
        return (this.graph.neighbours(cell) as string[])
                          .filter(c => this.board.has(c) && this.board.get(c)! === this.currplayer);
    }

    // check if this stone creates a non-serpent group
    private allSerpents(cell: string): boolean {
        // each stone of a serpent can only have one or two adjacent friendly pieces
        for (const neigh of this.graph.neighbours(cell)) {
            // only interested about cells with friendly stones:
            if ( !this.board.has(neigh) || this.board.get(neigh)! !== this.currplayer ) { continue; }
            if ( this.friendlyNeighbors(neigh).length > 2 ) {
                return false;
            }
        }
        return this.friendlyNeighbors(cell).length <= 2;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = ["pass"];

        for (const cell of this.graph.listCells(false) as string[]) {
            if ( this.board.has(cell) ) { continue; }
            // place the stone to check if conditions are valid
            this.board.set(cell, this.currplayer);
            // serpents also cannot have three adjacent stones in a line
            if (this.allSerpents(cell) && !this.hasThrees(this.currplayer) ) {
                moves.push(cell);
            }
            // remove the stone after check
            this.board.delete(cell);
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const newmove = this.graph.coords2algebraic(col, row);
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : "";
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
        const result: IValidationResult =
                {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.squirm.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m)) {
            result.valid = false;
            this.board.set(m, this.currplayer);
            if ( this.hasThrees(this.currplayer) ) {
                result.message = i18next.t("apgames:validation.squirm.INVALID_3ROW");
            } else {
                result.message = i18next.t("apgames:validation.squirm.INVALID_NEIGH");
            }
            this.board.delete(m);
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): SquirmGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            this.board.set(m, this.currplayer);
            this.results.push({ type: "place", where: m });
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    // compare two lists using lexicographic order (+1 if a>b, -1 if a<b, 0 if a==b)
    private compare(a: number[], b: number[]): number {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return  1;
      }
      // all equal so far, so shorter one is "smaller"
      if (a.length < b.length) return -1;
      if (a.length > b.length) return  1;
      return 0;
    }

    protected checkEOG(): SquirmGame {
        // game ends if two consecutive passes occurred
        this.gameover = this.lastmove === "pass" &&
                        this.stack[this.stack.length - 1].lastmove === "pass";

        if (this.gameover) {
            const result = this.compare(this.getGroupSizes(1), this.getGroupSizes(2));
            if (result === 0) {
                this.winner = [1, 2];
            } else {
                this.winner = result > 0 ? [1] : [2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ISquirmState {
        return {
            game: SquirmGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SquirmGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (const row of this.graph.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            pstr += row.map(c => this.board.has(c) ? this.board.get(c)! === 1 ? "A" : "B" : "-").join("");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth:   this.boardSize,
                maxWidth: 2*this.boardSize + 1,
                alternatingSymmetry: true,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public getButtons(): ICustomButton[] {
        return [{ label: "pass", move: "pass" }];
    }

    // First element = integer part
    // Remaining elements = decimal part, each padded to 2 digits
    private encode(list: number[]): number {
      if (list.length === 0) return 0;
      const [head, ...tail] = list;
      const decimal = tail.map(n => n.toString().padStart(2, '0')).join('');
      return Number(`${head}.${decimal}`);
    }

    public getPlayerScore(player: playerid): number {
        return this.encode(this.getGroupSizes(player));
    }

    public sidebarScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"),
              scores: [this.getGroupSizes(1).join(","),
                       this.getGroupSizes(2).join(",")] }
        ]
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SquirmGame {
        return new SquirmGame(this.serialize());
    }
}