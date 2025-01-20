import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph } from "../common/graphs";
import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";

export type playerid = 1|2;


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IChurnState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ChurnGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Churn",
        uid: "churn",
        playercounts: [2],
        version: "20250119",
        dateAdded: "2025-01-20",
        // i18next.t("apgames:descriptions.churn")
        description: "apgames:descriptions.churn",
        urls: ["https://www.marksteeregames.com/Churn_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            }
        ],
        variants: [
            {uid: "limping-34", group: "board"},
            {uid: "limping-335", group: "board"},
            {uid: "hex4", group: "board"},
            {uid: "limping-446", group: "board"},
            {uid: "hex5", group: "board"},
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["pie", "scores", "automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IChurnState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: ChurnGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IChurnState;
            }
            if (state.game !== ChurnGame.gameinfo.uid) {
                throw new Error(`The Churn engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ChurnGame {
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
        return this;
    }

    public get graph(): IGraph {
        if (this.variants.includes("limping-34")) {
            return new HexTriGraph(3, 6, true);
        } else if (this.variants.includes("limping-335")) {
            return new HexTriGraph(5, 7);
        } else if (this.variants.includes("hex4")) {
            return new HexTriGraph(4, 7)
        } else if (this.variants.includes("limping-446")) {
            return new HexTriGraph(6,9);
        } else if (this.variants.includes("hex5")) {
            return new HexTriGraph(5, 9);
        } else {
            return new HexTriGraph(3, 5);
        }
    }

    private getGroupSize(g: UndirectedGraph, cell: string): number {
        const cloned = new Map(this.board);
        cloned.set(cell, this.currplayer);
        for (const node of g.nodes()) {
            if (!cloned.has(node) || cloned.get(node)! !== this.currplayer) {
                g.dropNode(node);
            }
        }
        const conn = connectedComponents(g);
        const match = conn.find(grp => grp.includes(cell));
        return match!.length;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        const g = this.graph;
        const empties = g.graph.nodes().filter(c => !this.board.has(c));
        const isolated = empties.filter(c => {
            for (const n of g.graph.neighbors(c)) {
                if (this.board.has(n) && this.board.get(n)! === this.currplayer) {
                    return false;
                }
            }
            return true;
        });

        // if isolated placements are possible, you must make one of them
        if (isolated.length > 0) {
            moves.push(...isolated);
        }
        // otherwise, test each group for size
        else {
            const sizes: number[] = [];
            for (const cell of empties) {
                sizes.push(this.getGroupSize(g.graph.copy(), cell))
            }
            const minSize = Math.min(...sizes);
            for (const cell of empties) {
                if (this.getGroupSize(g.graph.copy(), cell) === minSize) {
                    moves.push(cell);
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.churn.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves();
        if (!allMoves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.churn.BAD_PLACE");
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): ChurnGame {
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

        const g = this.graph;
        this.results = [];
        this.board.set(m, this.currplayer);
        this.results.push({type: "place", where: m});
        const size = this.getGroupSize(g.graph.copy(), m);
        for (const node of g.graph.nodes()) {
            if (!this.board.has(node) || this.board.get(node)! !== this.currplayer) {
                g.graph.dropNode(node);
            }
        }
        const conn = connectedComponents(g.graph);
        const dead = conn.filter(grp => grp.length < size).flat();
        for (const cell of dead) {
            this.board.delete(cell);
            this.results.push({type: "take", from: cell});
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

    protected checkEOG(): ChurnGame {
        const maxSize = this.graph.graph.nodes().length;
        if (this.board.size === maxSize) {
            this.gameover = true;
            const s1 = [...this.board.values()].filter(p => p === 1).length;
            const s2 = [...this.board.values()].filter(p => p === 2).length;
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public getPlayerScore(player: playerid): number {
        return [...this.board.values()].filter(p => p === player).length
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public state(): IChurnState {
        return {
            game: ChurnGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ChurnGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;

        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            pstr += row.map(c => this.board.has(c) ? this.board.get(c)! === 1 ? "A" : "B" : "-").join("");
        }

        // Build rep
        let board: BoardBasic;
        if (this.variants.includes("limping-34")) {
            board = {
                style: "hex-of-hex",
                minWidth: 3,
                maxWidth: 6,
                alternatingSymmetry: true,
            }
        } else if (this.variants.includes("limping-335")) {
            board = {
                style: "hex-of-hex",
                minWidth: 5,
                maxWidth: 7,
                alternatingSymmetry: false,
            }
        } else if (this.variants.includes("hex4")) {
            board = {
                style: "hex-of-hex",
                minWidth: 4,
                maxWidth: 7,
                alternatingSymmetry: false,
            }
        } else if (this.variants.includes("limping-446")) {
            board = {
                style: "hex-of-hex",
                minWidth: 6,
                maxWidth: 9,
                alternatingSymmetry: false,
            }
        } else if (this.variants.includes("hex5")) {
            board = {
                style: "hex-of-hex",
                minWidth: 5,
                maxWidth: 9,
                alternatingSymmetry: false,
            }
        } else {
            board = {
                style: "hex-of-hex",
                minWidth: 3,
                maxWidth: 5,
                alternatingSymmetry: false,
            }
        }

        const rep: APRenderRep =  {
            board,
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
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "take") {
                    const [x, y] = g.algebraic2coords(move.from);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "take":
                node.push(i18next.t("apresults:TAKE.general", {player, from: r.from, count: 1}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ChurnGame {
        return new ChurnGame(this.serialize());
    }
}
