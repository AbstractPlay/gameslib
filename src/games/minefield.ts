import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerEdge } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { type Delta, allRotationsAndReflections } from "../common/plotting";
import i18next from "i18next";

export type playerid = 1|2;
export type DeltaEntry = {
    name: string;
    deltas: Delta[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath?: string[];
    lastmove?: string;
};

export interface IMinefieldState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

export class MinefieldGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Minefield",
        uid: "minefield",
        playercounts: [2],
        version: "20260311",
        dateAdded: "2026-03-19",
        // i18next.t("apgames:descriptions.minefield")
        description: "apgames:descriptions.minefield",
        urls: [
            "https://www.marksteeregames.com/Minefield_rules.pdf",
            "https://boardgamegeek.com/thread/3295906/new-mark-steere-game-minefield",
            "https://boardgamegeek.com/thread/3299199/cartwheel-possibly-free-of-mutual-zugzwang",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "size-8", group: "board" },
            { uid: "size-9", group: "board" },
            { uid: "#board", },
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "cartwheel" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie", "automove"]
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
    public connPath?: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;

    constructor(state?: IMinefieldState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: MinefieldGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMinefieldState;
            }
            if (state.game !== MinefieldGame.gameinfo.uid) {
                throw new Error(`The Minefield engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MinefieldGame {
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
        this.connPath = state.connPath !== undefined ? [...state.connPath] : undefined;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private get lines(): [PlayerLines,PlayerLines] {
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
        return 11;
    }

    public get forbidden(): DeltaEntry[] {
        const lst: DeltaEntry[] = [];
        // hard corners
        lst.push({
            name: "corner",
            deltas: [
                {dx: 1, dy: 0, payload: null},
                {dx: 1, dy: 1, payload: "f"},
                {dx: 0, dy: 1, payload: "e"},
            ]
        });
        lst.push({
            name: "corner",
            deltas: [
                {dx: 0, dy: -1, payload: "e"},
                {dx: 1, dy: -1, payload: null},
                {dx: 1, dy: 0, payload: "e"},
            ]
        });
        // switches
        // dist 2
        lst.push({
            name: "switch2",
            deltas: [
                {dx: 1, dy: 0, payload: "e"},
                {dx: 1, dy: 1, payload: null},
                {dx: 1, dy: 2, payload: "f"},
                {dx: 0, dy: 2, payload: "e"},
                {dx: 0, dy: 1, payload: null},
            ]
        });
        // dist 3
        if (!this.variants.includes("cartwheel")) {
            lst.push({
                name: "switch3",
                deltas: [
                    {dx: 1, dy: 0, payload: "e"},
                    {dx: 1, dy: 1, payload: null},
                    {dx: 1, dy: 2, payload: null},
                    {dx: 1, dy: 3, payload: "f"},
                    {dx: 0, dy: 3, payload: "e"},
                    {dx: 0, dy: 2, payload: null},
                    {dx: 0, dy: 1, payload: null},
                ]
            });
        }
        if (this.variants.includes("cartwheel")) {
            // pinwheel
            lst.push({
                name: "pinwheel",
                deltas:[
                    {dx: 1, dy: 0, payload: "e"},
                    {dx: 2, dy: 1, payload: "f"},
                    {dx: 2, dy: 2, payload: "e"},
                    {dx: 1, dy: 3, payload: "f"},
                    {dx: 0, dy: 3, payload: "e"},
                    {dx: -1, dy: 2, payload: "f"},
                    {dx: -1, dy: 1, payload: "e"},
                    {dx: 0, dy: 1, payload: null},
                    {dx: 1, dy: 1, payload: null},
                    {dx: 1, dy: 2, payload: null},
                    {dx: 0, dy: 2, payload: null},
                ]
            });
            // cartwheel
            lst.push({
                name: "cartwheel",
                deltas:[
                    {dx: 1, dy: 0, payload: "f"},
                    {dx: 2, dy: 1, payload: "e"},
                    {dx: 2, dy: 2, payload: "e"},
                    {dx: 1, dy: 3, payload: "f"},
                    {dx: 0, dy: 3, payload: "f"},
                    {dx: -1, dy: 2, payload: "e"},
                    {dx: -1, dy: 1, payload: "e"},
                    {dx: 0, dy: 1, payload: null},
                    {dx: 1, dy: 1, payload: null},
                    {dx: 1, dy: 2, payload: null},
                    {dx: 0, dy: 2, payload: null},
                ]
            });
        }

        return lst;
    }

    public canPlace(cell: string, player: playerid): boolean {
        const [x, y] = this.algebraic2coords(cell);
        for (const {name, deltas} of this.forbidden) {
            for (const transform of allRotationsAndReflections(deltas)) {
                let match = true;
                for (const delta of transform) {
                    const nx = x + delta.dx;
                    const ny = y + delta.dy;
                    if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) {
                        match = false;
                        break;
                    }
                    const check = this.coords2algebraic(nx, ny);
                    const contents = this.board.get(check);

                    let isFriendly = (contents === player);
                    let isEnemy = (contents !== undefined && contents !== player);
                    let isEmpty = (contents === undefined);

                    if (name === "cartwheel" && isEmpty) {
                        if (ny === 0 || ny === this.boardSize - 1) {
                            if (player === 1) { isFriendly = true; } else { isEnemy = true; }
                            isEmpty = false;
                        }
                        if (nx === 0 || nx === this.boardSize - 1) {
                            if (player === 2) { isFriendly = true; } else { isEnemy = true; }
                            isEmpty = false;
                        }
                    }

                    if (delta.payload === "f" && !isFriendly) {
                        match = false;
                        break;
                    }
                    if (delta.payload === "e" && !isEnemy) {
                        match = false;
                        break;
                    }
                    if (delta.payload === null && !isEmpty) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    return false;
                }
            }
        }
        return true;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];

        // can place on any empty space as long as you don't cross paths
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = this.coords2algebraic(x, y);
                if (! this.board.has(cell)) {
                    if (this.canPlace(cell, this.currplayer)) {
                        moves.push(cell);
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const newmove = cell;
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.minefield.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            if (! this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
                return result;
            }
        }

        // valid cell
        try {
            this.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
            return result;
        }

        // is empty
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m})
            return result;
        }

        // doesn't break the rule
        if (! this.canPlace(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.minefield.FORBIDDEN")
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): MinefieldGame {
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
            this.results.push({type: "place", where: m});
        }

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

    private buildGraph(player: playerid): UndirectedGraph {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = this.algebraic2coords(node);
            const neighbours = grid.adjacencies(x,y,true).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): MinefieldGame {
        const prevPlayer = this.currplayer === 1 ? 2 : 1;

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

    public state(): IMinefieldState {
        return {
            game: MinefieldGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MinefieldGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: this.connPath !== undefined ? [...this.connPath] : undefined,
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
        const markers: Array<MarkerEdge> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath !== undefined && this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x});
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }

        return rep;
    }

    public clone(): MinefieldGame {
        return new MinefieldGame(this.serialize());
    }
}
