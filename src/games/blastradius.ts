/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerFlood } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
};

export interface IBlastRadiusState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BlastRadiusGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Blast Radius",
        uid: "blastradius",
        playercounts: [2],
        version: "20241126",
        dateAdded: "2024-11-27",
        // i18next.t("apgames:descriptions.blastradius")
        description: "apgames:descriptions.blastradius",
        urls: [
            "https://www.marksteeregames.com/Blast_Radius_rules.pdf",
            "https://boardgamegeek.com/boardgame/434293/blast-radius",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com"],
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
            {
                uid: "board-5",
                group: "board",
            },
            {
                uid: "board-7",
                group: "board",
            },
        ],
        categories: ["goal>annihilate", "mechanic>place", "mechanic>stack", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["pie", "automove"]
    };
    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public pieces!: [number, number];
    public graph!: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IBlastRadiusState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: BlastRadiusGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            if (variants !== undefined) {
                this.variants = variants;
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBlastRadiusState;
            }
            if (state.game !== BlastRadiusGame.gameinfo.uid) {
                throw new Error(`The BlastRadius engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BlastRadiusGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid[]>;
        this.lastmove = state.lastmove;
        this.buildGraph();
        return this;
    }

    private buildGraph(): BlastRadiusGame {
        this.graph = this.getGraph();
        return this;
    }

    private getGraph(): HexTriGraph {
        if (this.variants.includes("board-5")) {
            return new HexTriGraph(5, 9);
        } else if (this.variants.includes("board-7")) {
            return new HexTriGraph(7, 13);
        } else {
            return new HexTriGraph(6, 11);
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // must place on empty cells first if possible
        const placeable = this.getPlaceable();
        if (placeable.length > 0) {
            moves.push(...placeable);
        }
        // otherwise, place on your smallest stacks
        else {
            const mine = [...this.board.entries()].filter(([,v]) => v[0] === player).map(([k,v]) => [k, v.length] as [string,number]);
            const minHeight = Math.min(...mine.map(([,len]) => len));
            for (const [cell, height] of mine) {
                if (height === minHeight) {
                    moves.push(cell);
                }
            }
        }

        return moves;
    }

    private getPlaceable(): string[] {
        const g = this.getGraph().graph;
        // drop all occupied nodes
        for (const cell of this.board.keys()) {
            g.dropNode(cell);
        }
        // drop all REZs
        const rezs = new Set<string>(this.getRezs().map(([cell,]) => cell));
        for (const cell of rezs) {
            g.dropNode(cell);
        }
        return g.nodes();
    }

    private getRezs(): [string,playerid][] {
        const g = this.getGraph();
        const rezs: [string,playerid][] = [];

        // for each stack on the board
        for (const [cell, stack] of this.board.entries()) {
            const dist = stack.length;
            // for each node still in the graph
            for (const node of g.listCells() as string[]) {
                // skip the node itself
                if (node === cell) { continue; }
                // calculate distance
                const path = g.path(cell, node);
                if (path === null) {
                    throw new Error(`Could not find a path from ${node} to ${cell}. This should never happen.`);
                }
                if ((path.length - 1) <= dist) {
                    rezs.push([node, stack[0]])
                }
            }
        }

        return rezs;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
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
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.blastradius.INITIAL_INSTRUCTIONS")
            return result;
        }

        const moves = this.moves();
        if (! moves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blastradius.INVALID");
            return result;
        } else {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): BlastRadiusGame {
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
        // new placement
        if (!this.board.has(m)) {
            this.board.set(m, [this.currplayer]);
            this.results.push({type: "place", where: m});
        }
        // building up a stack
        else {
            const stack = this.board.get(m)!;
            this.board.set(m, [...stack, this.currplayer]);
            this.results.push({type: "add", where: m, num: stack.length+1});
        }
        // look for captures
        // (any pieces within a rez get removed)
        const rezs = new Set<string>(this.getRezs().map(([cell,]) => cell));
        for (const rez of rezs) {
            if (this.board.has(rez)) {
                const stack = this.board.get(rez)!;
                if (stack[0] === this.currplayer) {
                    this.results.push({type: "take", from: rez, count: stack.length});
                } else {
                    this.results.push({type: "capture", where: rez, count: stack.length});
                }
                this.board.delete(rez);
            }
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

    protected checkEOG(): BlastRadiusGame {
        let prevPlayer = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        // game ends if current player has no pieces on the board
        const owned = [...this.board.values()].filter(stack => stack[0] === this.currplayer);
        if (this.stack.length > 3 && owned.length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer as playerid];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IBlastRadiusState {
        return {
            game: BlastRadiusGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BlastRadiusGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid[]>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    let str = this.board.get(cell)!.join("");
                    str = str.replace(/1/g, "A");
                    str = str.replace(/2/g, "B");
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        type RowCol = {row: number; col: number};
        let min = 6;
        let max = 11;
        if (this.variants.includes("board-5")) {
            min = 5; max = 9;
        } else if (this.variants.includes("board-7")) {
            min = 7; max = 13;
        }
        const markers: MarkerFlood[] = [];
        const rezs = this.getRezs();
        for (let colour = 1; colour <= 2; colour++) {
            const points: RowCol[] = [];
            for (const cell of rezs.filter(([,player]) => player === colour).map(([c,]) => c)) {
                const [col, row] = this.graph.algebraic2coords(cell);
                points.push({row, col});
            }
            if (points.length > 0) {
                markers.push({
                    type: "flood",
                    colour,
                    points: points as [RowCol, ...RowCol[]],
                });
            }
        }
        const board: BoardBasic = {
            style: "hex-of-hex",
            minWidth: min,
            maxWidth: max,
            markers,
        }
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
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
                if (move.type === "take" || move.type === "capture") {
                    let x: number; let y: number;
                    if (move.type === "take") {
                        [x,y] = this.graph.algebraic2coords(move.from);
                    } else {
                        [x,y] = this.graph.algebraic2coords(move.where!);
                    }
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "place" || move.type === "add") {
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
            case "add":
                // @ts-ignore
                node.push(i18next.t("apresults:PLACE.blastradius", { player, where: r.where, height: r.type === "place" ? 1 : r.num }));
                resolved = true;
                break;
            case "take":
                node.push(i18next.t("apresults:TAKE.blastradius", { player, where: r.from, count: r.count }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.blastradius", { player, where: r.where, count: r.count }));
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

    public clone(): BlastRadiusGame {
        return new BlastRadiusGame(this.serialize());
    }
}
