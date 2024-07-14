import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";
import { connectedComponents } from "graphology-components";

// In this implementation, the Y colour is always 1, and the Line colour is always 2.
type playerid = 1 | 2;
type LineY = [string[], string[], string[]];
type LineLine = [string[], string[]];
type directionsP = "N" | "NE" | "SE" | "S" | "SW" | "NW";  // For describing edges

export const intersects = (left: string[], right: string[]): string | undefined => {
    // Return a cell that is in both left and right arrays.
    for (const l of left) {
        if (right.includes(l)) {
            return l;
        }
    }
    return undefined;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    linePlayer: playerid | undefined;
    lastmove?: string;
    connPaths: string[][];
}

export interface IUnlurState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class UnlurGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Unlur",
        uid: "unlur",
        playercounts: [2],
        version: "20240619",
        dateAdded: "2024-07-14",
        // i18next.t("apgames:descriptions.unlur")
        description: "apgames:descriptions.unlur",
        urls: [
            "http://www.di.fc.ul.pt/~jpn/gv/unlur.htm",
            "https://boardgamegeek.com/boardgame/3826/unlur",
        ],
        people: [
            {
                type: "designer",
                name: "Jorge Gomez Arrausi",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1544/jorge-gomez-arrausi"]
            },
        ],
        variants: [
            {uid: "size-6", group: "board"},
            {uid: "size-10", group: "board"},
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>asymmetry", "board>shape>hex", "board>connect>hex", "components>simple"],
        flags: ["custom-colours"],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public linePlayer!: playerid | undefined;
    public connPaths: string[][] = [];
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private linesY: [LineY, LineY];
    private linesLine: [LineLine, LineLine, LineLine]

    constructor(state?: IUnlurState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: UnlurGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                linePlayer: undefined,
                connPaths: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IUnlurState;
            }
            if (state.game !== UnlurGame.gameinfo.uid) {
                throw new Error(`The Unlur game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        [this.linesY, this.linesLine] = this.getLines();
    }

    public load(idx = -1): UnlurGame {
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
        this.board = new Map(state.board);
        this.linePlayer = state.linePlayer;
        this.connPaths  = state.connPaths.map(a => [...a]);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
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

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    }

    private buildGraph(): UnlurGame {
        this.graph = this.getGraph();
        return this;
    }

    private getEdges(): Map<directionsP, Set<string>> {
        // Cells that are associated with edges on the board.
        const edges = new Map<directionsP, Set<string>>();
        for (const dir of ["N", "NE", "SE", "S", "SW", "NW"] as directionsP[]) {
            edges.set(dir, new Set());
        }
        for (let i = 0; i < this.boardSize; i++) {
            edges.get("N")!.add(this.graph.coords2algebraic(i, 0));
            edges.get("S")!.add(this.graph.coords2algebraic(i, this.boardSize * 2 - 2));
            edges.get("NW")!.add(this.graph.coords2algebraic(0, i));
            edges.get("SW")!.add(this.graph.coords2algebraic(0, this.boardSize + i - 1));
            edges.get("NE")!.add(this.graph.coords2algebraic(this.boardSize + i - 1, i));
            edges.get("SE")!.add(this.graph.coords2algebraic(this.boardSize * 2 - 2 - i, this.boardSize + i - 1));
        }
        return edges;
    }

    private getLines(): [[LineY, LineY], [LineLine, LineLine, LineLine]] {
        // Get the edges that form the Y and Line connections.
        const edges = this.getEdges();
        const N = Array.from(edges.get("N")!);
        const S = Array.from(edges.get("S")!);
        const NE = Array.from(edges.get("NE")!);
        const SE = Array.from(edges.get("SE")!);
        const SW = Array.from(edges.get("SW")!);
        const NW = Array.from(edges.get("NW")!);
        return [
            [
                [N, SE, SW],
                [S, NE, NW],
            ],
            [
                [N, S],
                [NE, SW],
                [NW, SE]
            ]
        ];
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell)) { continue }
            if (this.linePlayer === undefined && this.graph.distFromEdge(cell) === 0) { continue; }
            moves.push(cell);
        }
        if (this.linePlayer === undefined) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            newmove = cell;
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.linePlayer === undefined) {
                result.message = i18next.t("apgames:validation.unlur.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.unlur.INITIAL_INSTRUCTIONS_PASSED");
            }
            return result;
        }
        if (m === "pass") {
            if (this.linePlayer !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.unlur.BAD_PASS")
                return result;
            }
        } else {
            try {
                const [, y] = this.graph.algebraic2coords(m);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m })
                return result;
            }
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            }
            if (this.linePlayer === undefined && this.graph.distFromEdge(m) === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.unlur.CONTRACT_EDGE");
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): UnlurGame {
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
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        this.dots = [];
        this.results = [];
        if (m === "pass") {
            this.linePlayer = this.currplayer % 2 + 1 as playerid;
            this.results.push({ type: "pie" })
        } else {
            if (this.linePlayer === undefined) {
                this.board.set(m, 1);
                this.results.push({ type: "place", where: m, who: 1 });
            } else {
                const colour = this.getPlayerColour(this.currplayer) as playerid;
                this.board.set(m, colour);
                this.results.push({ type: "place", where: m, who: colour });
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getColourGraph(colour: playerid): UndirectedGraph {
        // start with the full board graph
        const graph = this.getGraph().graph;
        // drop any nodes not occupied by currplayer
        for (const node of [...graph.nodes()]) {
            if (! this.board.has(node)) {
                graph.dropNode(node);
            } else {
                if (this.board.get(node) !== colour) {
                    graph.dropNode(node);
                }
            }
        }
        return graph;
    }

    private connectedY(colour: playerid): string[][] {
        // Check if there is a Y connection for colour.
        const graph = this.getColourGraph(colour);
        for (const g of connectedComponents(graph)) {
            outer:
            for (const edges of this.linesY) {
                const point1 = intersects(g, edges[0]);
                if (point1 === undefined) { continue outer; }
                const point2 = intersects(g, edges[1]);
                if (point2 === undefined) { continue outer; }
                const point3 = intersects(g, edges[2]);
                if (point3 === undefined) { continue outer; }
                const path = bidirectional(graph, point1, point2)!;
                const path2 = bidirectional(graph, point3, point2)!;
                // path2 contains nodes from point3 to point2, but it includes some points in path.
                // Only keep the first common point.
                for (let i = 0; i < path2.length; i++) {
                    if (path.includes(path2[i])) {
                        path2.splice(i + 1)
                        return [path, path2];
                    }
                }
            }
        }
        return [];
    }

    private connectedLine(colour: playerid): string[][] {
        // Check if there is a line connection for colour.
        const graph = this.getColourGraph(colour);
        for (const [sources, targets] of this.linesLine) {
            for (const source of sources) {
                for (const target of targets) {
                    if (graph.hasNode(source) && graph.hasNode(target)) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            return [path];
                        }
                    }
                }
            }
        }
        return [];
    }

    private isWin(player: playerid): string[][] {
        // Check if the win condition is met for player.
        if (this.linePlayer === player) {
            return this.connectedLine(2);
        }
        return this.connectedY(1);
    }

    private isLose(player: playerid): string[][] {
        // Check if the lose condition is met for player.
        if (this.linePlayer === player) {
            return this.connectedY(2);
        }
        return this.connectedLine(1);
    }

    protected checkEOG(): UnlurGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const win = this.isWin(otherPlayer);
        if (win.length > 0) {
            this.connPaths = win;
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog" });
        }
        if (!this.gameover) {
            const lose = this.isLose(otherPlayer);
            if (lose.length > 0) {
                this.connPaths = lose;
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push({ type: "eog", reason: "foul" });
            }
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IUnlurState {
        return {
            game: UnlurGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: UnlurGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            linePlayer: this.linePlayer,
            connPaths: this.connPaths.map(a => [...a]),
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
                    const colour = this.board.get(cell)!;
                    if (colour === 1) {
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
            areas: [
                {
                    type: "key",
                    list: [
                        {
                            name: "Y",
                            piece: "A",
                        },
                        {
                            name: "Line",
                            piece: "B",
                        }
                    ],
                    position: "left",
                    height: 0.5,
                    clickable: false,
                }
            ],

        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{row: y, col: x}] });
                }
            }
            if (this.connPaths.length > 0) {
                for (const connPath of this.connPaths) {
                    if (connPath.length < 2) { continue; }
                    const targets: RowCol[] = [];
                    for (const cell of connPath) {
                        const [x,y] = this.algebraic2coords(cell);
                        targets.push({row: y, col: x})
                    }
                    rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
                }

            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations!.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
        }
        return rep;
    }

    public getPlayerColour(p: playerid): number | string {
        // Always return the colour of the Y unless the Line player is set.
        if (p === this.linePlayer) { return 2; }
        return 1;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "pie":
                node.push(i18next.t("apresults:PIE.unlur", { player }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "foul") {
                    node.push(i18next.t("apresults:EOG.unlur_foul"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): UnlurGame {
        return new UnlurGame(this.serialize());
    }
}
