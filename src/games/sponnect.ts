import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2 | 3;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface ISponnectState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SponnectGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Sponnect",
        uid: "sponnect",
        playercounts: [2],
        version: "20240421",
        dateAdded: "2024-04-30",
        // i18next.t("apgames:descriptions.sponnect")
        description: "apgames:descriptions.sponnect",
        urls: ["https://boardgamegeek.com/boardgame/113670/sponnect"],
        people: [
            {
                type: "designer",
                name: "Martin Windischer",
            },
        ],
        variants: [
            { uid: "size-5", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple", "board>3d"],
        flags: ["pie", "rotate90"],
    };

    public coords2algebraic(x: number, y: number, boardSize = this.boardSize): string {
        return GameBase.coords2algebraic(x, y, 2 * boardSize - 1);
    }

    public algebraic2coords(cell: string, boardSize = this.boardSize): [number, number] {
        // Remove all numbers from the beginning of the string.
        return GameBase.algebraic2coords(cell.replace(/^\d+/, ""), 2 * boardSize - 1);
    }

    private layerCoords2algebraic(col: number, row: number, layer: number, boardSize = this.boardSize): string {
        // Convert layer coordinates to algebraic.
        // This is the "intuitive" coordinates where sequence of col or row indices are adjacent.
        // Bottom layer is 0, top layer is boardSize - 1.
        // Origin is at the top left corner of the board as usual.
        if (layer >= boardSize) { throw new Error(`Layer index ${layer} is out of bounds for board size ${boardSize}`); }
        if (col < 0 || row < 0 || col > boardSize - layer || row > boardSize - layer) { throw new Error(`Coordinates (${col},${row}) are out of bounds for layer ${layer}`); }
        const l = layer + 1;
        const x = 2 * col + layer;
        const y = 2 * row + layer;
        return `${l}${this.coords2algebraic(x, y, boardSize)}`;
    }

    private algebraicToPosition(cell: string): [number, number] {
        // Convert algebraic coordinates to position on the board for annotations.
        const [x, y, l] = this.algebraic2coords2(cell);
        let row = (y - l) / 2;
        for (let i = 0; i < l; i++) {
            row += this.boardSize - i;
        }
        return [(x - l) / 2, row];
    }

    private coords2algebraic2(x: number, y: number, layer: number): string {
        // The same as coords2algebraic, but with concatenated layer index.
        return `${layer + 1}${this.coords2algebraic(x, y)}`;
    }

    private algebraic2coords2(cell: string): [number, number, number] {
        // The same as algebraic2coords, but also return the layer.
        const [l, coords] = cell.split(/(?<=^\d)/);
        const layer = parseInt(l, 10) - 1;
        const [x, y] = this.algebraic2coords(coords);
        return [x, y, layer];
    }

    private placeableCell(i: number, j: number): string | undefined {
        // Get the highest supported layer for a cell.
        // If that cell is not placeable, return undefined.
        if (i % 2 !== j % 2) { return undefined; }
        let layer = i % 2 ? 1 : 0;
        while (layer < this.boardSize) {
            const cell = `${layer + 1}${this.coords2algebraic(i, j)}`
            if (this.board.has(cell)) {
                layer += 2;
                continue;
            }
            if (layer > 0) {
                if (i < layer || j < layer || i >= 2 * this.boardSize - layer || j >= 2 * this.boardSize - layer) { return undefined; }
                // Check the four cells below the currentone.
                if (!this.board.has(this.coords2algebraic2(i - 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i - 1, j + 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j + 1, layer - 1))) { return undefined; }
            }
            return cell;
        }
        return undefined;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    // private dots: string[] = [];
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: ISponnectState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map(this.getMiddleFill(this.getBoardSize()).map(cell => [cell, 3 as playerid]));
            const fresh: IMoveState = {
                _version: SponnectGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISponnectState;
            }
            if (state.game !== SponnectGame.gameinfo.uid) {
                throw new Error(`The Sponnect game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): SponnectGame {
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
        this.connPath = [...state.connPath];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.layerCoords2algebraic(x, 0, 0);
            const S = this.layerCoords2algebraic(x, this.boardSize - 1, 0);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.layerCoords2algebraic(this.boardSize - 1, y, 0);
            const W = this.layerCoords2algebraic(0, y, 0);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN, lineS], [lineE, lineW]];
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
        return 4;
    }

    private getMiddleFill(boardSize = this.boardSize): string[] {
        // Get the middle layer of the board.
        const fill: string[] = [];
        for (let layer = 0; layer < boardSize - 1; layer++) {
            for (let row = 0; row < boardSize - layer - 2; row++) {
                for (let col = 0; col < boardSize - layer - 2; col++) {
                    fill.push(this.layerCoords2algebraic(col + 1, row + 1, layer, boardSize));
                }
            }
        }
        return fill;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    moves.push(cell);
                }
            }
        }
        if (this.stack.length > 1 && this.stack[this.stack.length - 1].lastmove !== "pass") {
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
            const cell = this.placeableCell(col, row);
            if (cell === undefined) {
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.sponnect.CANNOT_PLACE", {move: this.coords2algebraic(col, row)})
                };
            }
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
            result.message = this.stack.length > 1 && this.stack[this.stack.length - 1].lastmove !== "pass"
                                ? i18next.t("apgames:validation.sponnect.INITIAL_INSTRUCTIONS_PASS")
                                : i18next.t("apgames:validation.sponnect.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m === "pass") {
            if (this.stack.length === 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sponnect.FIRST_PASS");
                return result;
            }
            if (this.stack[this.stack.length - 1].lastmove === "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sponnect.CONSECUTIVE_PASS");
                return result;
            }
        } else {
            // valid cell
            try {
                const [x, y] = this.algebraic2coords(m);
                if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                    return result;
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result;
            }
            if (!this.moves().includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sponnect.CANNOT_PLACE", {move: m});
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SponnectGame {
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
        this.results = [];
        if (m === "pass") {
            this.results.push({ type: "pass" });
        } else {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getTopMostCell(x: number, y: number): string | undefined {
        // Get the top-most ball at a coordinate.
        // If there is no ball at that coordinate, return undefined.
        let layer = x % 2 ? 1 : 0;
        let cell = this.coords2algebraic2(x, y, layer);
        while (layer < this.boardSize) {
            if (x < layer || y < layer || x >= 2 * this.boardSize - layer || y >= 2 * this.boardSize - layer) { return undefined; }
            layer += 2;
            const nextCell = this.coords2algebraic2(x, y, layer);
            if (this.board.has(nextCell)) {
                cell = nextCell;
                continue;
            }
            return cell;
        }
        return undefined;
    }

    private isTopMostCell(cell: string): boolean {
        // Check if a cell has a ball at the top-most layer.
        const [col, row,] = this.algebraic2coords2(cell);
        return this.getTopMostCell(col, row) === cell;
    }

    private getPresentNeighbours(cell: string, player: playerid): string[] {
        // Get neighbours for a `cell` that are already present for `player`.
        const neighbours: string[] = [];
        const [col, row, layer] = this.algebraic2coords2(cell);
        if (col > 0) {
            if (row > 0) {
                const topMost = this.getTopMostCell(col - 1, row - 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
            if (row < 2 * this.boardSize - layer - 1) {
                const topMost = this.getTopMostCell(col - 1, row + 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
        }
        if (col < 2 * this.boardSize - layer - 1) {
            if (row > 0) {
                const topMost = this.getTopMostCell(col + 1, row - 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
            if (row < 2 * this.boardSize - layer - 1) {
                const topMost = this.getTopMostCell(col + 1, row + 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
        }
        const otherPlayer = player % 2 + 1 as playerid;
        if (col > layer + 1) {
            const topLeft = this.coords2algebraic2(col - 1, row + 1, layer + 1);
            const bottomLeft = this.coords2algebraic2(col - 1, row - 1, layer + 1);
            if (this.board.get(topLeft) !== otherPlayer || this.board.get(bottomLeft) !== otherPlayer) {
                const left = this.coords2algebraic2(col - 2, row, layer);
                if (this.board.has(left) && this.board.get(left) === player) { neighbours.push(left); }
            }
        }
        if (col < 2 * this.boardSize - layer - 2) {
            const topRight = this.coords2algebraic2(col + 1, row + 1, layer + 1);
            const bottomRight = this.coords2algebraic2(col + 1, row - 1, layer + 1);
            if (this.board.get(topRight) !== otherPlayer || this.board.get(bottomRight) !== otherPlayer) {
                const right = this.coords2algebraic2(col + 2, row, layer);
                if (this.board.has(right) && this.board.get(right) === player) { neighbours.push(right); }
            }
        }
        if (row > layer + 1) {
            const leftTop = this.coords2algebraic2(col - 1, row - 1, layer + 1);
            const rightTop = this.coords2algebraic2(col + 1, row - 1, layer + 1);
            if (this.board.get(leftTop) !== otherPlayer || this.board.get(rightTop) !== otherPlayer) {
                const top = this.coords2algebraic2(col, row - 2, layer);
                if (this.board.has(top) && this.board.get(top) === player) { neighbours.push(top); }
            }
        }
        if (row < 2 * this.boardSize - layer - 2) {
            const leftBottom = this.coords2algebraic2(col - 1, row + 1, layer + 1);
            const rightBottom = this.coords2algebraic2(col + 1, row + 1, layer + 1);
            if (this.board.get(leftBottom) !== otherPlayer || this.board.get(rightBottom) !== otherPlayer) {
                const bottom = this.coords2algebraic2(col, row + 2, layer);
                if (this.board.has(bottom) && this.board.get(bottom) === player) { neighbours.push(bottom); }
            }
        }
        return neighbours;
    }

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([c, p]) => p === player && this.isTopMostCell(c)).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            for (const n of this.getPresentNeighbours(node, player)) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): SponnectGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(otherPlayer);
        const [sources, targets] = this.lines[otherPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [otherPlayer];
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
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISponnectState {
        return {
            game: SponnectGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SponnectGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let layer = 0; layer < this.boardSize; layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        if (contents === 1) {
                            pstr += "A";
                        } else if (contents === 2) {
                            pstr += "B";
                        } else {
                            pstr += "C";
                        }
                    } else {
                        pstr += "-";
                    }
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-stacked",
                width: this.boardSize,
                height: this.boardSize,
                markers: [
                    {type:"edge", edge: "N", colour: 1},
                    {type:"edge", edge: "S", colour: 1},
                    {type:"edge", edge: "E", colour: 2},
                    {type:"edge", edge: "W", colour: 2},
                ]
            },
            legend: {
                A: { name: "orb", player: 1, scale: 1.15 },
                B: { name: "orb", player: 2, scale: 1.15 },
                C: { name: "orb", player: 3, scale: 1.15 },
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraicToPosition(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraicToPosition(move.from);
                    const [toX, toY] = this.algebraicToPosition(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x, y] = this.algebraicToPosition(cell);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.ball", { player, where: r.where }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.simple", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SponnectGame {
        return new SponnectGame(this.serialize());
    }
}
