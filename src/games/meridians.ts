/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2;
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IMeridiansState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MeridiansGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Meridians",
        uid: "meridians",
        playercounts: [2],
        version: "20240105",
        dateAdded: "2024-01-05",
        // i18next.t("apgames:descriptions.meridians")
        description: "apgames:descriptions.meridians",
        urls: [
            "https://kanare-abstract.com/en/pages/meridians",
            "https://boardgamegeek.com/boardgame/333775/meridians",
        ],
        people: [
            {
                type: "designer",
                name: "Kanare Kato",
                urls: ["https://kanare-abstract.com"],
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        categories: ["goal>majority", "mechanic>capture", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["pie-even"],
        variants: [
            {
                uid: "size-6",
                group: "board",
            },
            { uid: "#board", },
            {
                uid: "size-8",
                group: "board",
            }
        ],
        displays: [{uid: "hide-threatened"}],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;

    constructor(state?: IMeridiansState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: MeridiansGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMeridiansState;
            }
            if (state.game !== MeridiansGame.gameinfo.uid) {
                throw new Error(`The Meridians engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = this.getGraph();
    }

    public load(idx = -1): MeridiansGame {
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
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 7;
    }

    private getGraph(boardSize?: number): HexTriGraph {
        if (boardSize === undefined) {
            boardSize = this.boardSize;
        }
        return new HexTriGraph(boardSize - 1, (boardSize - 1) * 2);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        if (this.stack.length === 1) {
            // On first move, first player places two stones.
            for (const cell of this.graph.listCells() as string[]) {
                for (const cell2 of this.graph.listCells() as string[]) {
                    if (cell === cell2) {
                        continue;
                    }
                    moves.push(`${cell},${cell2}`);
                }
            }
            return moves;
        }
        if (this.stack.length === 2) {
            return ["pass"];
        }
        for (const cell of this.graph.listCells() as string[]) {
            if (this.board.has(cell)) {
                continue;
            }
            if (this.stack.length < 5 && this.secondStoneNeighbour(cell, player)) {
                continue;
            }
            if (this.canPlace(cell, player)) {
                moves.push(cell);
            }
        }
        if (moves.length === 0) {
            moves.push("pass");
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
            const split = move.split(",");
            const cell = this.graph.coords2algebraic(col, row);
            if (this.stack.length === 1) {
                if (split.length === 1 && split[0] !== "") {
                    newmove = `${move},${cell}`;
                } else if (split.length === 2) {
                    newmove = move;
                } else {
                    newmove = cell;
                }
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

    private canPlace(cell: string, player: playerid): boolean {
        // Check if `player` can place a piece at `cell`.
        for (const dir of allDirections) {
            const ray = this.graph.ray(...this.graph.algebraic2coords(cell), dir).map(c => this.graph.coords2algebraic(...c));
            for (const c of ray) {
                if (this.board.has(c)) {
                    if (this.board.get(c)! === player) {
                        return true
                    }
                    break;
                }
            }
        }
        return false;
    }

    private getGroups(player: playerid): Set<string>[] {
        // Get groups of cells that are connected to `cell` and owned by `player`.
        const groups: Set<string>[] = [];
        const pieces = this.pieces(player);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    private threatenedGroups(player: playerid): Set<string>[] {
        // Get all threatened groups for `player`.
        const groups = this.getGroups(player);
        const threatenedGroups: Set<string>[] = [];
        loop:
        for (const group of groups) {
            for (const member of group) {
                for (const dir of allDirections) {
                    const ray = this.graph.ray(...this.graph.algebraic2coords(member), dir).map(c => this.graph.coords2algebraic(...c));
                    for (const c of ray) {
                        if (group.has(c)) { continue; }
                        if (this.board.has(c)) {
                            if (this.board.get(c) !== player) {
                                break;
                            }
                            continue loop;
                        }
                    }
                }
            }
            threatenedGroups.push(group);
        }
        return threatenedGroups;
    }

    private secondStoneNeighbour(cell: string, player: playerid): boolean {
        const piece = this.pieces(player)[0];
        if (this.graph.neighbours(piece).includes(cell)) {
            return true;
        }
        return false;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            if (this.stack.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.meridians.INITIAL_INSTRUCTIONS_SETUP");
                return result;
            } else if (this.stack.length === 2) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.meridians.INITIAL_INSTRUCTIONS_PASS");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.meridians.INITIAL_INSTRUCTIONS");
            return result;
        }
        if (this.stack.length === 2) {
            if (m !== "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.meridians.SECOND_PLAYER_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const moves = m.split(",");
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.meridians.TOOMANYMOVES", {cell: moves[2]});
            return result;
        }
        // valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                this.graph.algebraic2coords(move);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        // Special case where first player places two stones.
        if (this.stack.length === 1) {
            if (moves.length === 2) {
                if (moves[0] === moves[1]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.meridians.SAME_CELL", {cell: moves[0]});
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.meridians.ONE_MORE");
            return result;
        }
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }
        if (this.stack.length < 5) {
            // Each player's second stone cannot be adjacent to their first stone.
            if (this.secondStoneNeighbour(m, this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.meridians.SECOND_STONE_NEIGHBOUR", {where: m});
                return result;
            }
        }
        if (!this.canPlace(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.meridians.NOLOS", {where: m});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): MeridiansGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        if (this.stack.length === 1) {
            const moves = m.split(",");
            if (moves.length !== 2) {
                // Partial.
                this.board.set(moves[0], this.currplayer);
                this.results.push({type: "place", who: 1, where: moves[0], count: 1});
                return this;
            }
            this.board.set(moves[0], this.currplayer);
            this.board.set(moves[1], this.currplayer % 2 + 1 as playerid);
            this.results.push({type: "place", who: 1, where: moves[0]}, {type: "place", who: 2, where: moves[1]});
        } else {
            this.results = [];
            if (m === "pass") {
                this.results.push({type: "pass"});
            } else {
                this.results.push({type: "place", where: m});
                this.board.set(m, this.currplayer);
                if (this.stack.length > 3) {
                    const threatenedGroups = this.threatenedGroups(this.currplayer);
                    for (const group of threatenedGroups) {
                        for (const cell of group) {
                            this.board.delete(cell);
                        }
                        this.results.push({type: "capture", where: Array.from(group).join(","), count: group.size});
                    }
                }
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

    private pieces(player: playerid): string[] {
        // Get all pieces owned by `player`.
        return [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
    }

    protected checkEOG(): MeridiansGame {
        if (this.pieces(this.currplayer).length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
        } else if (this.pieces(this.currplayer % 2 + 1 as playerid).length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IMeridiansState {
        return {
            game: MeridiansGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MeridiansGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showThreatened = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-threatened") {
                showThreatened = false;
            }
        }
        const pstr: string[][] = [];
        const threatenedGroups1 = this.stack.length > 4 && showThreatened ? this.threatenedGroups(1) : [];
        const threatenedGroups2 = this.stack.length > 4 && showThreatened ? this.threatenedGroups(2) : [];
        for (const row of this.graph.listCells(true)) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        let threatened = false;
                        for (const group of threatenedGroups1) {
                            if (group.has(cell)) {
                                threatened = true;
                                continue;
                            }
                        }
                        if (threatened) {
                            pieces.push("C");
                        } else {
                            pieces.push("A")
                        }
                    } else {
                        let threatened = false;
                        for (const group of threatenedGroups2) {
                            if (group.has(cell)) {
                                threatened = true;
                                continue;
                            }
                        }
                        if (threatened) {
                            pieces.push("D");
                        } else {
                            pieces.push("B")
                        }
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
                style: "hex-of-tri",
                minWidth: this.boardSize - 1,
                maxWidth: (this.boardSize - 1) * 2,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "piece", colour: 1 }, { name: "x" }],
                D: [{ name: "piece", colour: 2 }, { name: "x" }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const targets: {row: number, col: number}[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
                }
            }
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.meridians", {count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(",") + "\n\n";
        }
        return status;
    }

    public clone(): MeridiansGame {
        return new MeridiansGame(this.serialize());
    }
}
