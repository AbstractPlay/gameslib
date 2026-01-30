import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph } from "../common/graphs";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IBambooState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BambooGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bamboo",
        uid: "bamboo",
        playercounts: [2],
        version: "20260129",
        dateAdded: "2026-01-29",
        // i18next.t("apgames:descriptions.bamboo")
        description: "apgames:descriptions.bamboo",
        urls: ["https://www.marksteeregames.com/Bamboo_rules.pdf"],
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
            {uid: "hex6", group: "board"},
            {uid: "#board"},
        ],
        categories: ["goal>immobilize", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["automove", "limited-pieces", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IBambooState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: BambooGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBambooState;
            }
            if (state.game !== BambooGame.gameinfo.uid) {
                throw new Error(`The Bamboo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BambooGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid>;
        this.lastmove = state.lastmove;
        return this;
    }

    public get graph(): IGraph {
        if (this.variants.includes("hex6")) {
            return new HexTriGraph(6, 11);
        } else {
            return new HexTriGraph(7, 13);
        }
    }

    public get boardsize(): number {
        if (this.variants.includes("hex6")) {
            return 6;
        }
        return 7;
    }

    private getGroups(player?: playerid, board?: Map<string, playerid>): string[][] {
        if (board === undefined) {
            board = this.board;
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        const g = this.graph.graph;
        for (const node of [...g.nodes()]) {
            if (!board.has(node) || board.get(node)! !== player) {
                g.dropNode(node);
            }
        }
        const conn = connectedComponents(g);
        return conn;
    }

    private canPlaceAt(cell: string, player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const board = deepclone(this.board) as Map<string, playerid>;
        board.set(cell, player);
        const conn = this.getGroups(player, board);
        const found = conn.find(grp => grp.includes(cell))!;
        return found.length <= conn.length;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        const g = this.graph;
        const empties = g.graph.nodes().filter(c => !this.board.has(c));
        for (const cell of empties) {
            if (this.canPlaceAt(cell)) {
                moves.push(cell);
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
            result.message = i18next.t("apgames:validation.bamboo.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves();
        if (!allMoves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bamboo.BAD_PLACE");
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): BambooGame {
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

    protected checkEOG(): BambooGame {
        const prev = this.currplayer === 1 ? 2 : 1;
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prev];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IBambooState {
        return {
            game: BambooGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BambooGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid>
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
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

        status += "**Group Counts**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.GROUPCOUNT"), scores: [this.getGroups(1).length, this.getGroups(2).length] }
        ]
    }

    public clone(): BambooGame {
        return Object.assign(new BambooGame(), deepclone(this) as BambooGame);
    }
}
