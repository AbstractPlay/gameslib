/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    boardVertex: Map<string, playerid>;
    boardSpace: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface IConhexState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

export class ConhexGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "ConHex",
        uid: "conhex",
        playercounts: [2],
        version: "20240127",
        // i18next.t("apgames:descriptions.conhex")
        description: "apgames:descriptions.conhex",
        urls: ["https://boardgamegeek.com/boardgame/10989/conhex"],
        people: [
            {
                type: "designer",
                name: "Michail Antonow",
            }
        ],
        variants: [
            {
                uid: "size-15",
                group: "board",
            },
        ],
        flags: ["experimental", "pie", "rotate90"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public boardVertex!: Map<string, playerid>;
    public boardSpace!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 0;
    private lines: [PlayerLines,PlayerLines];
    private allVertices: string[];
    private spaceVertexMap: Map<string, string[]>;
    private vertexSpaceMap: Map<string, string[]>;

    public coords2vertex(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public vertex2coords(vertex: string): [number, number] {
        return ConhexGame.algebraic2coords(vertex, this.boardSize);
    }

    public coords2space(x: number, y: number): string {
        return `${x + 1},${y + 1}`;
    }

    public space2coords(space: string): [number, number] {
        const [x, y] = space.split(",");
        return [Number(x) - 1, Number(y) - 1];
    }

    constructor(state?: IConhexState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: ConhexGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                boardVertex: new Map<string, playerid>(),
                boardSpace: new Map<string, playerid>(),
                connPath: [],
            };
            this.stack = [fresh];
            if (variants !== undefined) {
                this.variants = [...variants];
            }
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConhexState;
            }
            if (state.game !== ConhexGame.gameinfo.uid) {
                throw new Error(`The Conhex engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
        this.allVertices = this.getAllVertices();
        this.spaceVertexMap = this.getSpaceVertexMap();
        this.vertexSpaceMap = this.getVertexSpaceMap(this.spaceVertexMap);
    }

    public load(idx = -1): ConhexGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.boardVertex = new Map(state.boardVertex);
        this.boardSpace = new Map(state.boardSpace);
        this.lastmove = state.lastmove;
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
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
        return 11;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const rowCount = (this.boardSize - 1) / 2;
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < rowCount; x++) {
            const N = this.coords2space(x, 0);
            const S = this.coords2space(2 * (rowCount - 1) + x, 0);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < rowCount; y++) {
            const E = this.coords2space(rowCount - 1 + y, 0);
            const W = this.coords2space(y === rowCount - 1 ? 0 : 3 * (rowCount - 1) + y, 0);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS],[lineE,lineW]];
    }

    private getAllVertices(): string[] {
        const cells: string[] = [];
        // Add corners and centre.
        cells.push(this.coords2vertex(0, 0));
        cells.push(this.coords2vertex(0, this.boardSize - 1));
        cells.push(this.coords2vertex(this.boardSize -1 , 0));
        cells.push(this.coords2vertex(this.boardSize - 1, this.boardSize - 1));
        cells.push(this.coords2vertex((this.boardSize - 1) / 2, (this.boardSize - 1) / 2));
        const rowCount = (this.boardSize - 1) / 2 - 2;
        const colStartCount = this.boardSize - 4;
        for (let j = 0; j <= rowCount; j++) {
            const rowN = j + 1;
            const rowS = this.boardSize - 2 - j;
            const colW = j + 1;
            const colE = this.boardSize - 2 - j;
            for (let i = 0; i < colStartCount - 2 * j; i++) {
                const colN = 2 + j + i;
                const colS = 2 + j + i;
                const rowW = 2 + j + i;
                const rowE = 2 + j + i;
                cells.push(this.coords2vertex(colN, rowN));
                cells.push(this.coords2vertex(colS, rowS));
                cells.push(this.coords2vertex(colW, rowW));
                cells.push(this.coords2vertex(colE, rowE));
            }
        }
        return cells;
    }

    private getSpaceVertexMap(): Map<string, string[]> {
        // Get mapping spaces and the vertexs associated with each space.
        const spaceVertexMap = new Map<string, string[]>();
        const rowCount = (this.boardSize - 1) / 2;

        // Corners
        // NW
        spaceVertexMap.set(this.coords2space(0, 0), [
            this.coords2vertex(0, 0),
            this.coords2vertex(1, 2),
            this.coords2vertex(2, 1),
        ]);
        // NE
        spaceVertexMap.set(this.coords2space(rowCount - 1, 0), [
            this.coords2vertex(this.boardSize - 1, 0),
            this.coords2vertex(this.boardSize - 2, 2),
            this.coords2vertex(this.boardSize - 3, 1),
        ]);
        // SE
        spaceVertexMap.set(this.coords2space(2 * (rowCount - 1), 0), [
            this.coords2vertex(this.boardSize - 1, this.boardSize - 1),
            this.coords2vertex(this.boardSize - 3, this.boardSize - 2),
            this.coords2vertex(this.boardSize - 2, this.boardSize - 3),
        ]);
        // SW
        spaceVertexMap.set(this.coords2space(3 * (rowCount - 1), 0), [
            this.coords2vertex(0, this.boardSize - 1),
            this.coords2vertex(2, this.boardSize - 2),
            this.coords2vertex(1, this.boardSize - 3),
        ]);

        // Edges
        for (let i = 0; i < rowCount - 2 ; i++) {
            // N
            spaceVertexMap.set(this.coords2space(i + 1, 0), [
                this.coords2vertex(2 + 2 * i, 1),
                this.coords2vertex(3 + 2 * i, 1),
                this.coords2vertex(4 + 2 * i, 1),
            ]);
            // E
            spaceVertexMap.set(this.coords2space(i + rowCount, 0), [
                this.coords2vertex(this.boardSize - 2, 2 + 2 * i),
                this.coords2vertex(this.boardSize - 2, 3 + 2 * i),
                this.coords2vertex(this.boardSize - 2, 4 + 2 * i),
            ]);
            // S
            spaceVertexMap.set(this.coords2space(i + 2 * (rowCount - 1) + 1, 0), [
                this.coords2vertex(this.boardSize - 3 - 2 * i, this.boardSize - 2),
                this.coords2vertex(this.boardSize - 4 - 2 * i, this.boardSize - 2),
                this.coords2vertex(this.boardSize - 5 - 2 * i, this.boardSize - 2),
            ]);
            // W
            spaceVertexMap.set(this.coords2space(i + 3 * (rowCount - 1) + 1, 0), [
                this.coords2vertex(1, this.boardSize - 3 - 2 * i),
                this.coords2vertex(1, this.boardSize - 4 - 2 * i),
                this.coords2vertex(1, this.boardSize - 5 - 2 * i),
            ]);
        }

        // Inner corners
        for (let j = 0; j < rowCount - 2; j++) {
            // NW
            spaceVertexMap.set(this.coords2space(0, 1 + j), [
                this.coords2vertex(2 + j, 1 + j),
                this.coords2vertex(3 + j, 1 + j),
                this.coords2vertex(1 + j, 2 + j),
                this.coords2vertex(3 + j, 2 + j),
                this.coords2vertex(1 + j, 3 + j),
                this.coords2vertex(2 + j, 3 + j),
            ]);
            // NE
            spaceVertexMap.set(this.coords2space(rowCount - 2 - j, 1 + j), [
                this.coords2vertex(this.boardSize - 4 - j, 1 + j),
                this.coords2vertex(this.boardSize - 3 - j, 1 + j),
                this.coords2vertex(this.boardSize - 2 - j, 2 + j),
                this.coords2vertex(this.boardSize - 4 - j, 2 + j),
                this.coords2vertex(this.boardSize - 2 - j, 3 + j),
                this.coords2vertex(this.boardSize - 3 - j, 3 + j),
            ]);
            // SE
            spaceVertexMap.set(this.coords2space(2 * (rowCount - 2 - j), 1 + j), [
                this.coords2vertex(this.boardSize - 3 - j, this.boardSize - 4 - j),
                this.coords2vertex(this.boardSize - 2 - j, this.boardSize - 4 - j),
                this.coords2vertex(this.boardSize - 4 - j, this.boardSize - 3 - j),
                this.coords2vertex(this.boardSize - 2 - j, this.boardSize - 3 - j),
                this.coords2vertex(this.boardSize - 4 - j, this.boardSize - 2 - j),
                this.coords2vertex(this.boardSize - 3 - j, this.boardSize - 2 - j),
            ]);
            // SW
            spaceVertexMap.set(this.coords2space(3 * (rowCount - 2 - j), 1 + j), [
                this.coords2vertex(1 + j, this.boardSize - 4 - j),
                this.coords2vertex(2 + j, this.boardSize - 4 - j),
                this.coords2vertex(1 + j, this.boardSize - 3 - j),
                this.coords2vertex(3 + j, this.boardSize - 3 - j),
                this.coords2vertex(2 + j, this.boardSize - 2 - j),
                this.coords2vertex(3 + j, this.boardSize - 2 - j),
            ]);
        }

        // Inner edges
        for (let j = 0; j < rowCount - 2; j++) {
            for (let i = 0; i < rowCount - 3 - j; i++) {
                // N
                spaceVertexMap.set(this.coords2space(i + 1, 1 + j), [
                    this.coords2vertex(3 + j + 2 * i, 1 + j),
                    this.coords2vertex(4 + j + 2 * i, 1 + j),
                    this.coords2vertex(5 + j + 2 * i, 1 + j),
                    this.coords2vertex(3 + j + 2 * i, 2 + j),
                    this.coords2vertex(4 + j + 2 * i, 2 + j),
                    this.coords2vertex(5 + j + 2 * i, 2 + j),
                ]);
                // E
                spaceVertexMap.set(this.coords2space(rowCount - 1 - j + i, 1 + j), [
                    this.coords2vertex(this.boardSize - 3 - j, 3 + j + 2 * i),
                    this.coords2vertex(this.boardSize - 3 - j, 4 + j + 2 * i),
                    this.coords2vertex(this.boardSize - 3 - j, 5 + j + 2 * i),
                    this.coords2vertex(this.boardSize - 2 - j, 3 + j + 2 * i),
                    this.coords2vertex(this.boardSize - 2 - j, 4 + j + 2 * i),
                    this.coords2vertex(this.boardSize - 2 - j, 5 + j + 2 * i),
                ]);
                // S
                spaceVertexMap.set(this.coords2space(2 * (rowCount - 2 - j) + 1 + i, 1 + j), [
                    this.coords2vertex(this.boardSize - 4 - j - 2 * i, this.boardSize - 3 - j),
                    this.coords2vertex(this.boardSize - 5 - j - 2 * i, this.boardSize - 3 - j),
                    this.coords2vertex(this.boardSize - 6 - j - 2 * i, this.boardSize - 3 - j),
                    this.coords2vertex(this.boardSize - 4 - j - 2 * i, this.boardSize - 2 - j),
                    this.coords2vertex(this.boardSize - 5 - j - 2 * i, this.boardSize - 2 - j),
                    this.coords2vertex(this.boardSize - 6 - j - 2 * i, this.boardSize - 2 - j),
                ]);
                // W
                spaceVertexMap.set(this.coords2space(3 * (rowCount - 2 - j) + 1 + i, 1 + j), [
                    this.coords2vertex(1 + j, this.boardSize - 4 - j - 2 * i),
                    this.coords2vertex(1 + j, this.boardSize - 5 - j - 2 * i),
                    this.coords2vertex(1 + j, this.boardSize - 6 - j - 2 * i),
                    this.coords2vertex(2 + j, this.boardSize - 4 - j - 2 * i),
                    this.coords2vertex(2 + j, this.boardSize - 5 - j - 2 * i),
                    this.coords2vertex(2 + j, this.boardSize - 6 - j - 2 * i),
                ]);
            }
        }

        // Centre
        spaceVertexMap.set(this.coords2space(0, rowCount - 1), [
            this.coords2vertex((this.boardSize - 1) / 2, (this.boardSize - 1) / 2 - 1),
            this.coords2vertex((this.boardSize - 1) / 2, (this.boardSize - 1) / 2 + 1),
            this.coords2vertex((this.boardSize - 1) / 2 - 1, (this.boardSize - 1) / 2),
            this.coords2vertex((this.boardSize - 1) / 2 + 1, (this.boardSize - 1) / 2),
            this.coords2vertex((this.boardSize - 1) / 2, (this.boardSize - 1) / 2),
        ]);
        return spaceVertexMap;
    }

    private getVertexSpaceMap(spaceVertexMap: Map<string, string[]>): Map<string, string[]> {
        // Inverts the spaceVertexMap to get a map of vertexs to spaces.
        const vertexSpaceMap = new Map<string, string[]>();
        for (const [space, vertexs] of spaceVertexMap) {
            for (const vertex of vertexs) {
                if (vertexSpaceMap.has(vertex)) {
                    vertexSpaceMap.get(vertex)!.push(space);
                } else {
                    vertexSpaceMap.set(vertex, [space]);
                }
            }
        }
        return vertexSpaceMap;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        for (const cell of this.allVertices) {
            if (this.boardVertex.has(cell)) { continue; }
            moves.push(cell);
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (piece === "dot") {
                const cell = this.coords2vertex(col, row);
                newmove = cell;
            } else {
                newmove = move;
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.conhex.INITIAL_INSTRUCTIONS")
            return result;
        }
        if (!this.allVertices.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.conhex.INVALID_VERTEX", {vertex: m});
            return result;
        }
        m = m.toLowerCase();
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getPlacedSpaces(vertex: string): string[] {
        // Check to see if a recently placed piece results in space placement.
        const placedSpaces: string[] = [];
        const player = this.boardVertex.get(vertex)!;
        for (const space of this.vertexSpaceMap.get(vertex)!) {
            if (this.boardSpace.has(space)) { continue; }
            const surroundingVertices = this.spaceVertexMap.get(space)!;
            const requiredVertices = Math.ceil(surroundingVertices.length / 2);
            let ownedVertices = 0;
            for (const n of surroundingVertices) {
                if (this.boardVertex.has(n) && this.boardVertex.get(n) === player) {
                    ownedVertices++;
                }
            }
            if (ownedVertices >= requiredVertices) {
                placedSpaces.push(space);
            }
        }
        return placedSpaces;
    }

    public move(m: string, {trusted = false} = {}): ConhexGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        let result;
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.boardVertex.set(m, this.currplayer);
        this.results.push({type: "place", where: m});
        const placedSpaces = this.getPlacedSpaces(m);
        if (placedSpaces.length > 0) {
            for (const space of placedSpaces) {
                this.boardSpace.set(space, this.currplayer);
                this.results.push({type: "claim", where: space});
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private getSpaceType(x: number, y: number): "corner" | "edge" | "centre" {
        const rowCount = (this.boardSize - 1) / 2;
        if (y === rowCount - 1) { return "centre"; }
        if (x % (rowCount - 1 - y) === 0) { return "corner"; }
        return "edge";
    }

    private getNeighbours(space: string): string[] {
        // Get all neighbours to `space`.
        const [x, y] = this.space2coords(space);
        const rowCount = (this.boardSize - 1) / 2;
        const spaceType = this.getSpaceType(x, y);
        if (spaceType === "centre") {
            return [
                this.coords2space(0, rowCount - 2),
                this.coords2space(1, rowCount - 2),
                this.coords2space(2, rowCount - 2),
                this.coords2space(3, rowCount - 2),
            ];
        }
        const neighbours: string[] = [];
        neighbours.push(this.coords2space(x === 0 ? 4 * (rowCount - 1 - y) - 1 : x - 1, y));
        neighbours.push(this.coords2space(x + 1 === 4 * (rowCount - 1 - y) ? 0 : x + 1, y));
        const quadrant = Math.floor(x / (rowCount - 1 - y));
        if (spaceType === "corner") {
            neighbours.push(this.coords2space(x - quadrant, y + 1));
            if (y > 0) {
                neighbours.push(this.coords2space(x + quadrant, y - 1));
                neighbours.push(this.coords2space(x + quadrant + 1, y - 1));
                neighbours.push(this.coords2space(x === 0 ? 4 * (rowCount - y) - 1 : x + quadrant - 1, y - 1));
            }
        } else {
            neighbours.push(this.coords2space(x - quadrant === 4 * (rowCount - 2 - y) ? 0 : x - quadrant, y + 1));
            neighbours.push(this.coords2space(x - quadrant - 1, y + 1));
            if (y > 0) {
                neighbours.push(this.coords2space(x + quadrant, y - 1));
                neighbours.push(this.coords2space(x + quadrant + 1, y - 1));
            }
        }
        return neighbours;
    }

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.boardSpace.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const neighbours = this.getNeighbours(node);
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ConhexGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        const graph = this.buildGraph(prevPlayer);
        const [sources, targets] = this.lines[prevPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevPlayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) {
                break;
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

    public state(): IConhexState {
        return {
            game: ConhexGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ConhexGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            boardVertex: new Map(this.boardVertex),
            boardSpace: new Map(this.boardSpace),
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2vertex(col, row);
                if (this.boardVertex.has(cell)) {
                    const contents = this.boardVertex.get(cell)!;
                    if (contents === 1) {
                        pieces.push("1");
                    } else {
                        pieces.push("2");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const spaces1 = [];
        const spaces2 = [];
        for (const [space, player] of this.boardSpace.entries()) {
            const [x, y] = this.space2coords(space);
            if (player === 1) {
                spaces1.push({row: y, col: x});
            } else {
                spaces2.push({row: y, col: x});
            }
        }
        const markers: Array<any> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];
        if (spaces1.length > 0) {
            markers.push({ type: "flood", points: spaces1, colour: 1 });
        }
        if (spaces2.length > 0) {
            markers.push({ type: "flood", points: spaces2, colour: 2 });
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "conhex",
            board: {
                style: "conhex-dots",
                width: this.boardSize,
                // @ts-ignore
                markers,
            },
            pieces: pstr,
        };

        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.vertex2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public chat(vertex: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                vertex.push(i18next.t("apresults:PLACE.conhex", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "claim":
                vertex.push(i18next.t("apresults:CLAIM.conhex", {player, where: r.where}));
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

    public clone(): ConhexGame {
        return new ConhexGame(this.serialize());
    }
}
