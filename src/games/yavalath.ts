import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import type { HexDir } from "../common/graphs/hextri";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IYavalathState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class YavalathGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Yavalath",
        uid: "yavalath",
        playercounts: [2],
        version: "20250112",
        dateAdded: "2023-06-18",
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
        categories: ["goal>align", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "pie", "automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IYavalathState | string) {
        super();
        if (state === undefined) {
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
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const g = new HexTriGraph(5, 9);
        const moves = g.graph.nodes().filter(n => !this.board.has(n));
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
            const newmove = cell[0];
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

    public checkLines(len: number, player: playerid): boolean {
        const collate = (cells: string[], dir: HexDir): string[] => {
            const localLines: string[] = [];
            for (const cell of cells) {
                const [cx, cy] = g.algebraic2coords(cell);
                const ray = g.ray(cx, cy, dir)
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
        const prevPlayer = this.currplayer === 1 ? 2 : 1;
        const hasFour = this.checkLines(4, prevPlayer);
        const hasThree = this.checkLines(3, prevPlayer);
        const g = new HexTriGraph(5, 9);

        // if previous player has four, they win
        if (hasFour) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        // if previous player has three, they lose
        else if (hasThree) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        // if board full, draw
        else if (g.graph.nodes().filter(n => !this.board.has(n)).length === 0) {
            this.gameover = true;
            this.winner = [1, 2];
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
                    pieces.push(this.board.get(cell)! === 1 ? "A" : "B");
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
        }
        return resolved;
    }

    public clone(): YavalathGame {
        return new YavalathGame(this.serialize());
    }
}
