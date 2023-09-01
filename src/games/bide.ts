/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import { connectedComponents } from 'graphology-components';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2|3|4|5|6;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    inhand: number[];
    released?: playerid;
};

export interface IBideState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BideGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bide",
        uid: "bide",
        playercounts: [2,3,4,5,6],
        version: "20230729",
        // i18next.t("apgames:descriptions.bide")
        description: "apgames:descriptions.bide",
        urls: ["https://boardgamegeek.com/boardgame/309892/bide"],
        people: [
            {
                type: "designer",
                name: "Alek Erickson",
            }
        ],
        flags: ["experimental", "scores", "no-moves", "multistep"]
    };
    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public pieces!: [number, number];
    public graph!: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public inhand: number[] = [];
    public released?: playerid;

    constructor(state: number | IBideState | string) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const inhand: number[] = [];
            for (let i = 0; i < this.numplayers; i++) {
                inhand.push(0);
            }
            inhand[0] = 1;
            const fresh: IMoveState = {
                _version: BideGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string,playerid>(),
                inhand,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBideState;
            }
            if (state.game !== BideGame.gameinfo.uid) {
                throw new Error(`The Bide game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.variants = state.variants;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BideGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid>;
        this.lastmove = state.lastmove;
        this.inhand = [...state.inhand];
        this.released = state.released;
        this.buildGraph();
        return this;
    }

    private buildGraph(): BideGame {
        this.graph = new HexTriGraph(5, 9);
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (piece === "_btn_pass") {
                newmove = "pass";
            } else if (piece === "_btn__") {
                return {move: "", message: i18next.t("apgames:validation.bide.MUST_RELEASE")} as IClickResult;
            } else {
                const cell = this.graph.coords2algebraic(col, row);

                if (move.length === 0) {
                    if (! this.board.has(cell)) {
                        newmove = cell;
                    }
                } else {
                    const cloned = this.clone();
                    cloned.buildGraph();
                    cloned.move(move, true);
                    if (! cloned.board.has(cell)) {
                        newmove = `${move},${cell}`;
                    }
                }
            }

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
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const allcells = this.graph.listCells() as string[];

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.bide.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (m === "pass") {
            if (this.released !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.bide.MUST_RELEASE");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation:_general.VALID_MOVE");
                return result;
            }
        }

        const cells = m.split(",");
        let cloned = this.clone();
        cloned.buildGraph();
        // validate each move first
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            // validate coordinates
            if (! allcells.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result
            }
            // cell must be empty
            if (cloned.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result
            }
            // you must have a piece in hand
            if (cloned.inhand[cloned.currplayer - 1] <= 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.bide.EMPTY_HAND");
                return result
            }
            cloned = this.clone();
            cloned.buildGraph();
            const todate = [cells.slice(0, i+1)].join(",");
            cloned.move(todate, true);
        }
        // cloned is up to date

        // only one piece placed
        if (cells.length === 1) {
            // if you have pieces in hand
            if (cloned.inhand[cloned.currplayer - 1] > 0) {
                // if in release mode, you must place everything
                if (cloned.released !== undefined) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.bide.MUST_RELEASE");
                    return result;
                }
                // if not release mode, you *may* place everything
                else {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.bide.MAY_RELEASE");
                    return result;
                }
            }
            else {
                // you're done
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation:_general.VALID_MOVE");
                return result;
            }
        }
        // multiple pieces placed
        else {
            // you must place everything
            if (cloned.inhand[cloned.currplayer - 1] > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.bide.MUST_RELEASE");
                return result;
            } else {
                // you're done
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation:_general.VALID_MOVE");
                return result;
            }
        }
    }

    public bumpCells(cell: string, dir?: "NE"|"E"|"SE"|"SW"|"W"|"NW"): BideGame {
        let dirs = ["NE","E","SE","SW","W","NW"];
        if (dir !== undefined) {
            dirs = [dir];
        }
        for (const d of dirs) {
            const [x,y] = this.graph.algebraic2coords(cell);
            const ray = this.graph.ray(x, y, d as "NE"|"E"|"SE"|"SW"|"W"|"NW").map(n => this.graph.coords2algebraic(...n));
            if (ray.length > 0) {
                // only proceed if the first cell is occupied
                if (this.board.has(ray[0])) {
                    const empties = ray.filter(c => ! this.board.has(c));
                    // and if there's at least one empty space in the ray
                    if (empties.length > 0) {
                        this.results.push({type: "move", from: ray[0], to: empties[0]});
                        // get index of empty space
                        const idxSpace = ray.findIndex(c => c === empties[0]);
                        // from the space, count backwards, moving each piece
                        for (let i = idxSpace; i > 0; i--) {
                            const prev = this.board.get(ray[i - 1])!;
                            this.board.set(ray[i], prev);
                        }
                        // delete the initial piece
                        this.board.delete(ray[0]);
                        // then recursively trigger a follow-up bump
                        this.bumpCells(empties[0], d as "NE"|"E"|"SE"|"SW"|"W"|"NW");
                    }
                }
            }
        }
        return this;
    }

    public move(m: string, partial = false): BideGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! partial) {
            const result = this.validateMove(m);
            if ( (! result.valid) || (result.complete === -1) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];

        if (m === "pass") {
            this.results.push({type: "pass"});
        }
        else {
            // place all pieces
            const cells = m.split(",");
            for (const cell of cells) {
                this.board.set(cell, this.currplayer);
                this.inhand[this.currplayer - 1]--;
                this.results.push({type: "place", where: cell});
                this.bumpCells(cell);
            }
            // set `released` if not already set
            if ( (cells.length > 1) && (this.released === undefined) ) {
                this.released = this.currplayer;
            }
        }

        if (partial) { return this; }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        // clear `released` if it's time
        if ( (this.released !== undefined) && (this.released === this.currplayer) ) {
            this.released = undefined;
        }

        // always start a turn by picking up a piece
        this.inhand[this.currplayer - 1]++;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BideGame {
        // Over if board is full
        if ([...this.board.keys()].length === this.graph.listCells().length) {
            this.gameover = true;
            this.winner = [this.getWinner()];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IBideState {
        return {
            game: BideGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BideGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid>,
            inhand: [...this.inhand],
            released: this.released,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pcLabels = ["A","B","C","D","E","F"]
        let pstr = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const val = this.board.get(cell)!;
                    pieces.push(pcLabels[val - 1]);
                } else {
                    pieces.push("-");
                }
            }
            let joined = pieces.join("");
            if (/^-+$/.test(joined)) {
                joined = "_";
            }
            pstr += joined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: 5,
                maxWidth: 9,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
                C: {
                    name: "piece",
                    player: 3
                },
                D: {
                    name: "piece",
                    player: 4
                },
                E: {
                    name: "piece",
                    player: 5
                },
                F: {
                    name: "piece",
                    player: 6
                },
            },
            pieces: pstr,
            areas: [
                {
                    type: "buttonBar",
                    position: "left",
                    buttons: [
                        {
                            label: this.released !== undefined ? "Released!" : "Pass",
                            value: this.released !== undefined ? "_" : "pass",
                            fill: this.released !== undefined ? "#999" : undefined,
                        }
                    ],
                }
            ],
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}], strokeWidth: 0.04});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

        status += "**In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.inhand[n - 1]}\n\n`;
        }

        status += "**SCORES**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n)}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        let ignore = 0;
        const scores: number[] = [];
        for (let i = 1; i <= this.numplayers; i++) {
            scores.push(this.getPlayerScore(i, ignore));
        }
        let realScores = [...scores];
        let maxScore = Math.max(...scores);
        let maxScorers = scores.filter(s => s === maxScore);
        while (maxScorers.length > 1) {
            ignore += 1;
            realScores = [];
            for (let i = 1; i <= this.numplayers; i++) {
                realScores.push(this.getPlayerScore(i, ignore));
            }
            maxScore = Math.max(...scores);
            maxScorers = scores.filter(s => s === maxScore);
        }
        const finalScores: (number|string)[] = [];
        for (let i = 0; i < this.numplayers; i++) {
            if (scores[i] !== realScores[i]) {
                finalScores.push(`${scores[i]} (${realScores[i]})`);
            } else {
                finalScores.push(scores[i]);
            }
        }

        return [
            { name: i18next.t("apgames:status.SCORES"), scores: finalScores },
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.inhand },
        ]
    }

    public getPlayerScore(player: number, ignore = 0): number {
        // get a fresh grid & graph
        const grid = new HexTriGraph(5, 9);
        const graph = grid.graph;

        // drop all nodes not occupied by the player's pieces
        const allNodes = [...graph.nodes()];
        for (const node of allNodes) {
            if ( (! this.board.has(node)) || (this.board.get(node)! !== player) ) {
                graph.dropNode(node);
            }
        }

        // score each group
        let maxScore = 0;
        for (const g of connectedComponents(graph)) {
            let score = 0;
            for (const cell of g) {
                const dist = grid.distFromEdge(cell);
                // if the distance is less than the `ignore` value, ignore it
                if (dist >= ignore) {
                    score += dist;
                }
            }
            maxScore = Math.max(maxScore, score);
        }

        return maxScore;
    }

    public getWinner(ignore = 0): playerid {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p, ignore));
        }
        const maxScore = Math.max(...scores);
        const maxScorers = scores.filter(s => s === maxScore);
        if (maxScorers.length > 1) {
            return this.getWinner(ignore + 1);
        } else {
            return (scores.findIndex(s => s === maxScore)! + 1) as playerid;
        }
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BideGame {
        return Object.assign(new BideGame(this.numplayers), deepclone(this) as BideGame);
        // return new BideGame(this.serialize());
    }
}
