/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable max-classes-per-file */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2;
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
type directionsP = "N"|"NE"|"SE"|"S"|"SW"|"NW";  // For describing edges
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];
const allDirectionsP: directionsP[] = ["N","NE","SE","S","SW","NW"];  // All edges
const nextDirections: Map<directions, directions[]> = new Map([
    ["NE", ["NW", "NE", "E"]],
    ["E", ["NE", "E", "SE"]],
    ["SE", ["E", "SE", "SW"]],
    ["SW", ["SE", "SW", "W"]],
    ["W", ["SW", "W", "NW"]],
    ["NW", ["W", "NW", "NE"]],
])  // Next directions to check.

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IHavannahState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

class WinningStructure {
    public loop: string[] | undefined;
    public corner: Map<directions, string[]>;
    public edge: Map<directionsP, string[]>;
    constructor() {
        this.corner = new Map();
        this.edge = new Map();
    }

    public win(): boolean {
        return this.ringWin() || this.bridgeWin() || this.forkWin();
    }

    public ringWin(): boolean {
        return this.loop !== undefined;
    }

    public bridgeWin(): boolean {
        return this.corner.size === 2;
    }

    public forkWin(): boolean {
        return this.edge.size === 3;
    }

    public getPaths(): string[][] {
        // Get all paths for display in renderer.
        if (this.ringWin()) {
            return [this.loop!];
        }
        if (this.bridgeWin()) {
            return [...this.corner.values()];
        }
        if (this.forkWin()) {
            return [...this.edge.values()];
        }
        return [];
    }

}

export class HavannahGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Havannah",
        uid: "havannah",
        playercounts: [2],
        version: "20240101",
        dateAdded: "2024-01-01",
        // i18next.t("apgames:descriptions.havannah")
        description: "apgames:descriptions.havannah",
        urls: [
            "https://www.mindsports.nl/index.php/arena/havannah",
            "https://en.wikipedia.org/wiki/Havannah_(board_game)",
            "https://boardgamegeek.com/boardgame/2759/havannah",
        ],
        people: [
            {
                type: "designer",
                name: "Christian Freeling",
                urls: ["https://www.mindsports.nl/"],
                apid: "b12bd9cd-59cf-49c7-815f-af877e46896a",
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        categories: ["goal>align", "goal>connect", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["automove", "pie"],
        variants: [
            {
                uid: "size-4",
                group: "board",
            },
            {
                uid: "size-6",
                group: "board",
            },
            { uid: "#board", },
            {
                uid: "size-10",
                group: "board",
            }
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private corners: Map<directions, string>;
    private edges: Map<directionsP, Set<string>>;

    constructor(state?: IHavannahState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: HavannahGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHavannahState;
            }
            if (state.game !== HavannahGame.gameinfo.uid) {
                throw new Error(`The Havannah engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.corners = this.getCorners();
        this.edges = this.getEdges();
    }

    public load(idx = -1): HavannahGame {
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
        this.results = [...state._results];
        this.boardSize = this.getBoardSize();
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
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

    private getCorners(): Map<directions, string> {
        // Cells that are associated with corners on the board.
        return new Map([
            ["NW", this.graph.coords2algebraic(0, 0)],
            ["NE", this.graph.coords2algebraic(this.boardSize - 1, 0)],
            ["W", this.graph.coords2algebraic(0, this.boardSize - 1)],
            ["E", this.graph.coords2algebraic(this.boardSize * 2 - 2, this.boardSize - 1)],
            ["SW", this.graph.coords2algebraic(0, this.boardSize * 2 - 2)],
            ["SE", this.graph.coords2algebraic(this.boardSize - 1, this.boardSize * 2 - 2)],
        ]);
    };

    private getEdges(): Map<directionsP, Set<string>> {
        // Cells that are associated with edges on the board.
        const edges = new Map<directionsP, Set<string>>();
        for (const dir of allDirectionsP) {
            edges.set(dir, new Set());
        }
        for (let i = 0; i < this.boardSize - 2; i++) {
            edges.get("N")!.add(this.graph.coords2algebraic(i + 1, 0));
            edges.get("S")!.add(this.graph.coords2algebraic(i + 1, this.boardSize * 2 - 2));
            edges.get("NW")!.add(this.graph.coords2algebraic(0, i + 1));
            edges.get("SW")!.add(this.graph.coords2algebraic(0, this.boardSize + i));
            edges.get("NE")!.add(this.graph.coords2algebraic(this.boardSize + i, i + 1));
            edges.get("SE")!.add(this.graph.coords2algebraic(this.boardSize * 2 - 3 - i, this.boardSize + i));
        }
        return edges;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    }

    private buildGraph(): HavannahGame {
        this.graph = this.getGraph();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const empties = (this.graph.listCells() as string[]).filter(c => ! this.board.has(c));
        for (const cell of empties) {
            moves.push(cell);
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            // If you click on an occupied cell, clear the entry
            if (this.board.has(cell)) {
                return {move: "", message: ""} as IClickResult;
            } else {
                newmove = cell;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.havannah.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cell = m;
        // valid cell
        try {
            this.graph.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }
        // cell is empty
        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, {trusted = false} = {}): HavannahGame {
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
        this.board.set(m, this.currplayer);
        this.results.push({type: "place", where: m});

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


    protected checkEOG(): HavannahGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        if ( (this.lastmove !== undefined) && (this.lastmove !== "timeout") && (this.lastmove !== "abandoned") && (this.lastmove !== "resign") ) {
            const winningStructure = this.getWinningStructure(this.lastmove);
            if (winningStructure.win()) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    private getWinningStructure(cell: string): WinningStructure {
        // Start search for winning structures a placed cell.
        const player = this.board.get(cell)!;
        const winnnigStructure = new WinningStructure();
        for (const dir of allDirections) {
            this.traversePaths(player, cell, dir, [cell], cell, winnnigStructure);
        }
        return winnnigStructure;
    }

    private traversePaths(
        player: playerid,
        cell: string,
        direction: directions,
        currPath: string[],
        startCell: string,
        winningStructure: WinningStructure
    ): void {
        // Traverse all paths from `cell` for `player` from `direction`.
        // Adds paths to `winningStructure` if they are winning structures.
        // Exit when win condition is found.
        if (winningStructure.win()) { return; }
        if (currPath.length > 1 && cell === startCell) {
            winningStructure.loop = [...currPath];
        }
        for (const dir of allDirections) {
            if (this.corners.get(dir) === cell && !winningStructure.corner.has(dir)) {
                winningStructure.corner.set(dir, [...currPath]);
            }
        }
        for (const dir of allDirectionsP) {
            if (this.edges.get(dir)!.has(cell) && !winningStructure.edge.has(dir)) {
                winningStructure.edge.set(dir, [...currPath]);
            }
        }
        const coords = this.graph.algebraic2coords(cell);
        for (const dir of nextDirections.get(direction)!) {
            const nextCoords = this.graph.move(...coords, dir);
            if (nextCoords === undefined) { continue; }
            const nextCell = this.graph.coords2algebraic(...nextCoords);
            if (!this.board.has(nextCell) || this.board.get(nextCell) !== player) { continue; }
            this.traversePaths(player, nextCell, dir, [...currPath, nextCell], startCell, winningStructure);
        }
    }

    public state(): IHavannahState {
        return {
            game: HavannahGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HavannahGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
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
            if (this.winner.length === 1) {
                if ( (this.lastmove !== undefined) && (this.lastmove !== "timeout") && (this.lastmove !== "abandoned") && (this.lastmove !== "resign") ) {
                    // draw lines to show winning connections.
                    type RowCol = {row: number; col: number;};
                    for (const path of this.getWinningStructure(this.lastmove).getPaths()) {
                        if (path.length === 1) { continue; }  // Don't draw lines for single points.
                        const targets: RowCol[] = [];
                        for (const cell of path) {
                            const [x, y] = this.graph.algebraic2coords(cell);
                            const lastTarget = targets[targets.length - 1];
                            if ( lastTarget === undefined || lastTarget.row !== y || lastTarget.col !== x ) {
                                targets.push({row: y, col: x});
                            }
                        }
                        rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                    }
                }
            }
        }
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): HavannahGame {
        return new HavannahGame(this.serialize());
    }
}
