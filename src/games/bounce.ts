/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs";
import {connectedComponents} from 'graphology-components';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IBounceState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BounceGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bounce",
        uid: "bounce",
        playercounts: [2],
        version: "20231029",
        dateAdded: "2023-10-29",
        // i18next.t("apgames:descriptions.bounce")
        description: "apgames:descriptions.bounce",
        urls: [
            "https://marksteeregames.com/Bounce_rules.pdf",
            "https://boardgamegeek.com/boardgame/435089/bounce",
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
        categories: ["goal>unify", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["automove", "pie"],
        variants: [
            {
                uid: "10",
                group: "board"
            },
        ]
    };

    private coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    private algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 8;
    public graph: SquareOrthGraph = new SquareOrthGraph(this.boardsize, this.boardsize);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IBounceState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
                if (this.variants.includes("10")) {
                    this.boardsize = 10;
                }
            }
            const board = new Map<string, playerid>();
            for (let row = 0; row < this.boardsize; row++) {
                for (let col = 0; col < this.boardsize; col++) {
                    // ignore corners
                    if ( ( (row === 0) || (row === this.boardsize - 1) ) && ( (col === 0) || (col === this.boardsize - 1) ) ) {
                        continue;
                    }
                    const cell = this.coords2algebraic(col, row);
                    let player: playerid = 2;
                    if ( ( (row % 2 === 0) && (col % 2 === 0) ) || ( (row % 2 !== 0) && (col % 2 !== 0) ) ) {
                        player = 1;
                    }
                    board.set(cell, player);
                }
            }
            const fresh: IMoveState = {
                _version: BounceGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBounceState;
            }
            if (state.game !== BounceGame.gameinfo.uid) {
                throw new Error(`The Bounce engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BounceGame {
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
        this.boardsize = 8;
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants.includes("10")) ) {
            this.boardsize = 10;
        }
        this.buildGraph();
        return this;
    }

    private getGraph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardsize, this.boardsize);
    }

    private buildGraph(): BounceGame {
        this.graph = this.getGraph();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // get list of existing groups of player's pieces
        const myGraph = this.getGraph();
        for (const node of [...myGraph.graph.nodes()]) {
            if ( (! this.board.has(node)) || (this.board.get(node) !== player) ) {
                myGraph.graph.dropNode(node);
            }
        }
        const connected = connectedComponents(myGraph.graph);
        // empty cells
        const empties = (this.graph.listCells() as string[]).filter(c => ! this.board.has(c));
        // player-occupied cells
        const mine = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);

        // for each player-occupied cell
        for (const from of mine) {
            let fromSize = Infinity;
            for (const group of connected) {
                if (group.includes(from)) {
                    fromSize = group.length;
                    break;
                }
            }
            // pair with empty cell
            for (const to of empties) {
                // move the piece
                const board = deepclone(this.board) as Map<string, playerid>;
                board.delete(from);
                board.set(to, player);
                // clone the graph
                const graph = this.getGraph();
                // get connected components
                for (const node of [...graph.graph.nodes()]) {
                    if ( (! board.has(node)) || (board.get(node) !== player) ) {
                        graph.graph.dropNode(node);
                    }
                }
                const newConns = connectedComponents(graph.graph);
                // check that new group is larger than previous group
                let toSize = -Infinity;
                for (const group of newConns) {
                    if (group.includes(to)) {
                        toSize = group.length;
                        break;
                    }
                }
                if (toSize > fromSize) {
                    moves.push(`${from}-${to}`);
                }
            }
        }

        // if no moves after all that, then list each player-occupied cell for removal
        if (moves.length === 0) {
            for (const cell of mine) {
                moves.push(`x${cell}`);
            }
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
            // fresh
            if (move === "") {
                newmove = cell;
            }
            // secondary
            else {
                // clicking again, x it
                if (move === cell) {
                    newmove = `x${cell}`;
                }
                // if empty, move it
                else if (! this.board.has(cell)) {
                    newmove += `${move}-${cell}`;
                }
                // otherwise, reset
                else {
                    newmove = cell;
                }
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
            result.message = i18next.t("apgames:validation.bounce.INITIAL_INSTRUCTIONS");
            return result;
        }

        let from: string; let to: string|undefined;
        if (m.startsWith("x")) {
            from = m.substring(1);
        } else if (m.includes("-")) {
            [from, to] = m.split("-");
        } else {
            from = m;
        }

        // valid cell
        try {
            this.graph.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // occupied
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // owned by player
        if (this.board.get(from) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // to is defined
        if (to !== undefined) {
            // valid cell
            try {
                this.graph.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // empty
            if (this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: from});
                return result;
            }
            // TODO: INEFFICIENT!
            // Valid move
            if (! this.moves().includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.bounce.LARGER_GROUP");
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
        // otherwise
        else {
            // if move is a removal
            if (m.startsWith("x")) {
                // TODO: INEFFICIENT!
                // Valid move
                if (! this.moves().includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.bounce.MUST_MOVE");
                    return result;
                }

                // we're good
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
            // otherwise, valid partial
            else {
                // we're good
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.bounce.PARTIAL");
            }
        }

        return result;
    }

    public move(m: string, {trusted = false} = {}): BounceGame {
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
        if (m.startsWith("x")) {
            const cell = m.substring(1);
            this.board.delete(cell);
            this.results.push({type: "remove", where: cell, num: 1});
        } else {
            const [from, to] = m.split("-");
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
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

    protected checkEOG(): BounceGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // Get a graph that only includes the cells occupied by the player we're interested in
        const graph = this.getGraph();
        for (const node of graph.graph.nodes()) {
            if ( (! this.board.has(node)) || (this.board.get(node) !== prevPlayer) ) {
                graph.graph.dropNode(node);
            }
        }
        const conn = connectedComponents(graph.graph);
        if (conn.length === 1) {
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

    public state(): IBounceState {
        return {
            game: BounceGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BounceGame.gameinfo.version,
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
                style: "squares",
                width: this.boardsize,
                height: this.boardsize,
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

            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", colour: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "remove") {
                    const [x, y] = this.algebraic2coords(move.where);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

    public clone(): BounceGame {
        return Object.assign(new BounceGame(), deepclone(this) as BounceGame);
        // return new BounceGame(this.serialize());
    }
}
