import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface IGonnectState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GonnectGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Gonnect",
        uid: "gonnect",
        playercounts: [2],
        version: "20240719",
        dateAdded: "2024-08-02",
        // i18next.t("apgames:descriptions.gonnect")
        description: "apgames:descriptions.gonnect",
        urls: ["https://boardgamegeek.com/boardgame/12146/gonnect"],
        people: [
            {
                type: "designer",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
            },
        ],
        variants: [
            { uid: "size-9", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["pie"],
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
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private grid: RectGrid;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: IGonnectState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: GonnectGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGonnectState;
            }
            if (state.game !== GonnectGame.gameinfo.uid) {
                throw new Error(`The Gonnect game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
        this.lines = this.getLines();
    }

    public load(idx = -1): GonnectGame {
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
            const N = this.coords2algebraic(x, 0);
            const S = this.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.coords2algebraic(this.boardSize-1, y);
            const W = this.coords2algebraic(0, y);
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
        return 13;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.isSelfCapture(cell, player)) { continue; }
                if (this.checkKo(cell, player)) { continue; }
                moves.push(cell);
            }
        }
        return moves;
    }

    private hasMoves(player?: playerid): boolean {
        // Check if the player has any valid moves.
        if (player === undefined) {
            player = this.currplayer;
        }
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.isSelfCapture(cell, player)) { continue; }
                if (this.checkKo(cell, player)) { continue; }
                return true;
            }
        }
        return false;
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
            result.message = i18next.t("apgames:validation.gonnect.INITIAL_INSTRUCTIONS");
            return result;
        }
        // Valid cell
        try {
            this.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }
        if (this.isSelfCapture(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gonnect.SELF_CAPTURE", { where: m });
            return result;
        }
        if (this.checkKo(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gonnect.KO");
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private orthNeighbours(cell: string): string[] {
        const [x, y] = this.algebraic2coords(cell);
        const neighbours = this.grid.adjacencies(x, y, false);
        return neighbours.map(n => this.coords2algebraic(...n));
    }

    private getGroupLiberties(cell: string, opponentPlaced: string[], player: playerid): [Set<string>, number] {
        // Get all groups associated with `cell` and the liberties of the group.
        // The `cell` does not need to be placed on the `board`. We assume that it's already there.
        const seen: Set<string> = new Set();
        const liberties = new Set<string>();
        const todo: string[] = [cell]
        while (todo.length > 0) {
            const cell1 = todo.pop()!;
            if (seen.has(cell1)) { continue; }
            seen.add(cell1);
            for (const n of this.orthNeighbours(cell1)) {
                if (!this.board.has(n) && !opponentPlaced.includes(n) && n !== cell) {
                    liberties.add(n);
                    continue;
                }
                if (this.board.get(n) === player) { todo.push(n);
                }
            }
        }
        return [seen, liberties.size];
    }

    private getCaptures(cell: string, player: playerid): Set<string>[] {
        // Get all captured cells if `cell` is placed on the board.
        const allCaptures: Set<string>[] = []
        for (const n of this.orthNeighbours(cell)) {
            if (allCaptures.some(x => x.has(n)) || !this.board.has(n) || this.board.get(n) === player) { continue; }
            const [group, liberties] = this.getGroupLiberties(n, [cell], player % 2 + 1 as playerid);
            if (liberties === 0) {
                const captures = new Set<string>();
                for (const c of group) {
                    captures.add(c);
                }
                if (captures.size > 0) { allCaptures.push(captures); }
            }
        }
        return allCaptures;
    }

    private isSelfCapture(cell: string, player: playerid): boolean {
        // Check if placing `cell` would result in a self-capture.
        if (this.getCaptures(cell, player).length > 0) { return false; }
        return this.getGroupLiberties(cell, [], player)[1] === 0;
    }

    private checkKo(cell: string, player: playerid): boolean {
        // Check if the move is a ko.
        if (this.stack.length < 2) { return false; }
        const captures = this.getCaptures(cell, player);
        if (captures.length !== 1) { return false; }
        if (captures[0].size !== 1) { return false; }
        const previous = this.stack[this.stack.length - 1];
        const previousMove = previous.lastmove!;
        if (!captures.some(x => x.has(previousMove))) { return false; }
        const previousCaptures = previous._results.filter(r => r.type === "capture")
        if (previousCaptures.length !== 1) { return false; }
        return (previousCaptures[0] as Extract<APMoveResult, { type: 'capture' }>).count! === 1;
    }

    public move(m: string, {partial = false, trusted = false} = {}): GonnectGame {
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
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);
        const allCaptures = this.getCaptures(m, this.currplayer);
        if (allCaptures.length > 0) {
            for (const captures of allCaptures) {
                for (const capture of captures) { this.board.delete(capture); }
                this.results.push({ type: "capture", where: [...captures].join(), count: captures.size });
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = this.algebraic2coords(node);
            const neighbours = this.grid.adjacencies(x, y, false).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): GonnectGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(otherPlayer);
        for (const [sources, targets] of this.lines) {
            for (const source of sources) {
                for (const target of targets) {
                    if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            this.gameover = true;
                            this.winner = [otherPlayer];
                            this.connPath = [...path];
                            this.results.push({ type: "eog" });
                            break;
                        }
                    }
                }
                if (this.gameover) {
                    break;
                }
            }
        }
        if (!this.gameover && !this.hasMoves(this.currplayer)) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (!this.gameover) {
            const count = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));
            if (count >= 1) {
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push({ type: "eog", reason: "repetition" });
            }
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IGonnectState {
        return {
            game: GonnectGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: GonnectGame.gameinfo.version,
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
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            // @ts-ignore
            rep.annotations.push({ type: "dots", targets: points });
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
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.group_nowhere", { player, count: r.count }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "repetition") {
                    node.push(i18next.t("apresults:EOG.repetition", { count: 1 }));
                } else if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): GonnectGame {
        return new GonnectGame(this.serialize());
    }
}
