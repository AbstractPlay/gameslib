import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import type { HexDir } from "../common/graphs/hextri";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2|3;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    eliminated?: playerid;
};

export interface IYavalathState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class YavalathGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Yavalath",
        uid: "yavalath",
        playercounts: [2,3],
        version: "20250112",
        dateAdded: "2025-01-12",
        // i18next.t("apgames:descriptions.yavalath")
        description: "apgames:descriptions.yavalath",
        urls: ["https://boardgamegeek.com/boardgame/33767/yavalath"],
        people: [
            {
                type: "designer",
                name: "Cameron Browne",
                urls: ["http://cambolbro.com/"]
            },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per", "other>2+players"],
        flags: ["pie", "no-moves", "custom-randomization"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public eliminated?: playerid;

    constructor(state: IYavalathState | string | number) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: YavalathGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IYavalathState;
            }
            if (state.game !== YavalathGame.gameinfo.uid) {
                throw new Error(`The Yavalath engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): YavalathGame {
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
        this.eliminated = state.eliminated;
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        if (this.eliminated !== undefined && this.eliminated === this.currplayer) {
            return ["pass"];
        }

        // const blocksWin = (move: string, nextp: playerid): boolean => {
        //     const clone1 = this.clone();
        //     clone1.move(move, {trusted: true});
        //     const empties = g.graph.nodes().filter(n => !clone1.board.has(n));
        //     for (const m of empties) {
        //         const clone2 = clone1.clone();
        //         clone2.move(m, {trusted: true});
        //         if (clone2.gameover && clone2.winner.length === 1 && clone2.winner[0] === nextp) {
        //             return false;
        //         }
        //     }
        //     return true;
        // }

        const g = new HexTriGraph(5, 9);
        const moves = g.graph.nodes().filter(n => !this.board.has(n));

        // // in 3-player moves, you must stop a next-player win if possible
        // if (this.numplayers === 3 && this.eliminated === undefined && filterMoves) {
        //     let nextp = this.currplayer + 1 as playerid;
        //     if (nextp > 3) { nextp = 1; }
        //     moves = moves.filter(m => blocksWin(m, nextp));
        // }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = new HexTriGraph(5, 9);
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
        const g = new HexTriGraph(5, 9);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.yavalath.INITIAL_INSTRUCTIONS")
            return result;
        }

        // pass only valid if you're eliminated
        if (m === "pass") {
            if (this.eliminated !== undefined && this.eliminated === this.currplayer) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.yavalath.BAD_PASS", {where: m});
                return result;
            }
        }

        // cell must exist
        if (!g.graph.nodes().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }
        // must be empty
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }

        // in 3-player game, must block next-player wins
        if (this.numplayers === 3 && this.eliminated === undefined) {
            let nextp = this.currplayer + 1 as playerid;
            if (nextp > this.numplayers) { nextp = 1; }

            // first check to see if the proposed move actually blocks a win
            const cloned = this.clone();
            cloned.board.set(m, nextp);
            const doesBlock = cloned.checkLines(4, nextp);

            // if it doesnt, check to see if there are any wins that need blocking
            if (!doesBlock) {
                const clone1 = this.clone();
                clone1.move(m, {trusted: true});
                const empties = g.graph.nodes().filter(c => !clone1.board.has(c));
                for (const next of empties) {
                    const clone2 = clone1.clone();
                    clone2.move(next, {trusted: true});
                    if (clone2.gameover && clone2.winner.length === 1 && clone2.winner[0] === nextp) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.yavalath.MUST_BLOCK");
                        return result;
                    }
                }
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): YavalathGame {
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
            // if (! this.moves(false).includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
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
        if (this.eliminated === newplayer) {
            newplayer = (newplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    public checkLines(len: number, player: playerid): boolean {
        const collate = (cells: string[], dir: HexDir): string[] => {
            const localLines: string[] = [];
            for (const cell of cells) {
                const [cx, cy] = g.algebraic2coords(cell);
                const ray = g.ray(cx, cy, dir, true)
                             .map(c => g.coords2algebraic(...c))
                             .map(n => this.board.has(n) ? this.board.get(n)! : "-")
                             .join("");
                localLines.push(ray);
            }
            return localLines;
        }

        const g = new HexTriGraph(5, 9);
        const lines: string[] = [];
        const edges = g.getEdges();
        // NE
        lines.push(...collate([...new Set<string>([...edges.get("SW")!, ...edges.get("S")!]).values()], "NE"));
        // E
        lines.push(...collate([...new Set<string>([...edges.get("SW")!, ...edges.get("NW")!]).values()], "E"));
        // SE
        lines.push(...collate([...new Set<string>([...edges.get("NW")!, ...edges.get("N")!]).values()], "SE"));

        const target = Array.from({length: len}, () => player).join("");
        for (const line of lines) {
            if (line.includes(target)) {
                return true;
            }
        }
        return false;
    }

    protected checkEOG(): YavalathGame {
        let prevPlayer: playerid;
        if (this.numplayers === 2) {
            prevPlayer = this.currplayer === 1 ? 2 : 1;
        } else if (this.eliminated === undefined) {
            prevPlayer = this.currplayer === 1 ? 3 : this.currplayer === 3 ? 2 : 1;
        } else {
            const remaining = ([1,2,3] as playerid[]).filter(p => p !== this.eliminated);
            prevPlayer = this.currplayer === remaining[0] ? remaining[1] : remaining[0];
        }

        // regardless of number of players, four in a row is a win
        const hasFour = this.checkLines(4, prevPlayer);
        if (hasFour) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if (!this.gameover) {
            // if they have a three, then results vary
            const hasThree = this.checkLines(3, prevPlayer);
            if (hasThree) {
                if (this.numplayers === 2) {
                    this.gameover = true;
                    this.winner = [this.currplayer];
                } else if (this.eliminated === undefined) {
                    this.eliminated = prevPlayer;
                    this.results.push({type: "eliminated", who: prevPlayer.toString()});
                } else {
                    this.gameover = true;
                    this.winner = ([1,2,3] as playerid[]).filter(p => p !== this.eliminated && p !== prevPlayer);
                }
            }
        }

        // regardless of number of players, a full board is a draw
        if (!this.gameover) {
            const g = new HexTriGraph(5, 9);
            if (g.graph.nodes().filter(n => !this.board.has(n)).length === 0) {
                this.gameover = true;
                if (this.numplayers === 2) {
                    this.winner = [1, 2];
                } else if (this.eliminated === undefined) {
                    this.winner = [1, 2, 3];
                } else {
                    this.winner = ([1,2,3] as playerid[]).filter(p => p !== this.eliminated);
                }
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

    public state(): IYavalathState {
        return {
            game: YavalathGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: YavalathGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            eliminated: this.eliminated,
        };
    }

    public render(): APRenderRep {
        const g = new HexTriGraph(5, 9);
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (!this.board.has(cell)) {
                    pieces.push("-");
                } else {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents === 1 ? "A" : contents === 2 ? "B" : "C");
                }
            }
            pstr += pieces.join("");
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
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
                C: {
                    name: "piece",
                    colour: 3
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
                    rep.annotations.push({type: "enter", shape: "circle", targets: [{row: y, col: x}]});
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
            case "eliminated":
                node.push(i18next.t("apresults:ELIMINATED", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public shouldOfferPie(): boolean {
        return this.numplayers === 2;
    }

    public clone(): YavalathGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        return Object.assign(new YavalathGame(this.numplayers), deepclone(this) as YavalathGame);
    }
}
