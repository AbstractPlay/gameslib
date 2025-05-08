import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import {connectedComponents} from 'graphology-components';

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IHexYState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class HexYGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Hexagonal Y",
        uid: "hexy",
        playercounts: [2],
        version: "20230923",
        dateAdded: "2023-09-23",
        // i18next.t("apgames:descriptions.hexy")
        description: "apgames:descriptions.hexy",
        urls: [
            "https://www.marksteeregames.com/Hexagonal_Y_rules.pdf",
            "https://boardgamegeek.com/boardgame/432211/hexagonal-y",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://marksteeregames.com/"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["automove", "pie"],
        variants: [
            {
                uid: "08",
                group: "board"
            },
            {
                uid: "09",
                group: "board"
            },
            {
                uid: "11",
                group: "board"
            }
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 7;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IHexYState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: HexYGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHexYState;
            }
            if (state.game !== HexYGame.gameinfo.uid) {
                throw new Error(`The HexY engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): HexYGame {
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
        this.boardsize = 7;
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            this.boardsize = parseInt(this.variants[0], 10);
            if (isNaN(this.boardsize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        this.buildGraph();
        return this;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    private buildGraph(): HexYGame {
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
            result.message = i18next.t("apgames:validation.hexy.INITIAL_INSTRUCTIONS");
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

    public move(m: string, {trusted = false} = {}): HexYGame {
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
        // handle perimeter placement
        const dist = this.graph.distFromEdge(m);
        if (dist === 0) {
            const opp = this.graph.rot180(m);
            this.board.set(opp, this.currplayer);
            this.results.push({type: "place", where: opp});
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

    private findEndState(player: playerid): null | {connPath: string[][]; group: string[];} {
        // Get a graph that only includes the cells occupied by the player we're interested in
        const graph = this.getGraph();
        for (const node of graph.graph.nodes()) {
            if ( (! this.board.has(node)) || (this.board.get(node) !== player) ) {
                graph.graph.dropNode(node);
            }
        }
        for (const g of connectedComponents(graph.graph)) {
            const edges = g.filter(cell => this.graph.distFromEdge(cell) === 0);
            if (edges.length >= 2) {
                // Find the pair with the longest shortest distance between them.
                // These are the terminuses. Start the algo from any one of them.
                let maxShort = -Infinity;
                let pair: [string,string]|undefined;
                for (const e1 of edges) {
                    for (const e2 of edges) {
                        if (e1 === e2) { continue; }
                        const path = this.graph.edgePath(e1, e2);
                        if (path === null) {
                            throw new Error(`Could not determine edge distance between ${e1} and ${e2}`);
                        }
                        if (path.length > maxShort) {
                            maxShort = path.length;
                            pair = [e1, e2];
                        }
                    }
                }
                if (pair === undefined) {
                    throw new Error("Could not find a pair with longest shortest distance");
                }
                let start = pair[0];
                let unconnected = [...edges].filter(c => c !== start);
                const paths: string[][] = [];
                while (unconnected.length >= 1) {
                    // find the closest other perimeter cell
                    let tmpPath: string[]|undefined;
                    for (const next of unconnected) {
                        const path = this.graph.edgePath(start, next);
                        if (path === null) {
                            throw new Error(`Could not find an edge path between ${start} and ${next}`);
                        }
                        if ( (tmpPath === undefined) || (path.length < tmpPath.length) ) {
                            tmpPath = path;
                        }
                    }
                    if (tmpPath === undefined) {
                        throw new Error(`Could not find a next closest perimeter cell.`);
                    }
                    paths.push([...tmpPath]);
                    start = tmpPath[tmpPath.length - 1];
                    unconnected = unconnected.filter(c => c !== start);
                }
                // get count of unique perimeter cells in paths
                const pathSet = new Set<string>();
                for (const path of paths) {
                    for (const cell of path) {
                        pathSet.add(cell);
                    }
                }
                if (pathSet.size > this.graph.perimeter / 2) {
                    return {
                        connPath: paths,
                        group: [...g]
                    };
                }
            }
        }
        return null;
    }

    protected checkEOG(): HexYGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        const result = this.findEndState(prevPlayer);
        if (result !== null) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IHexYState {
        return {
            game: HexYGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HexYGame.gameinfo.version,
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
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
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
        if (this.results.length > 0) {
            rep.annotations = [];
            if (this.gameover) {
                if (this.winner.length === 1) {
                    const player = this.winner[0];
                    const results = this.findEndState(player);
                    if (results !== null) {
                        // highlight cells in the group
                        for (const cell of results.group) {
                            const [x, y] = this.graph.algebraic2coords(cell);
                            rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: 3});
                        }
                        // draw a line connecting the perimeter
                        type RowCol = {row: number; col: number;};
                        const targets: RowCol[] = [];
                        for (const path of results.connPath) {
                            for (const cell of path) {
                                const [x,y] = this.graph.algebraic2coords(cell);
                                const lastTarget = targets[targets.length - 1];
                                if ( (lastTarget === undefined) || (lastTarget.row !== y) || (lastTarget.col !== x) ) {
                                    targets.push({row: y, col: x});
                                }
                            }
                        }
                        rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                    }
                }
            }

            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                }
            }

            if (rep.annotations.length === 0) {
                delete rep.annotations;
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

    public clone(): HexYGame {
        return new HexYGame(this.serialize());
    }
}
