/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type PlayerId = 1|2;
type ContentType = "empty"|"red-dirt"|"blue-dirt"|"red"|"blue";

// piece color, group id, frozen?
type CellContent = [ContentType, number];

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, CellContent>;
    lastgroupid: number;
    lastmove?: string;
};

export interface ITakeState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class TakeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Take",
        uid: "take",
        playercounts: [2],
        version: "20240220",
        // i18next.t("apgames:descriptions.take")
        description: "apgames:descriptions.take",
        urls: ["https://www.marksteeregames.com/Take_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com"]
            }
        ],
        flags: [],
        variants: [
            {
                uid: "high-churn",
                name: "High Churn",
                group: "rules",
            },
            {
                uid: "quick-churn",
                name: "Quick Churn",
                group: "rules",
            }
        ],
    };

    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, CellContent>;
    public boardsize = 5;
    public graph: HexTriGraph = new HexTriGraph(5, 9);
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public lastgroupid = 0;

    constructor(state?: ITakeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, CellContent>();
            const fresh: IMoveState = {
                _version: TakeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                lastgroupid: 0,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITakeState;
            }
            if (state.game !== TakeGame.gameinfo.uid) {
                throw new Error(`The Take engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TakeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContent>;
        this.boardsize = this.getBoardSize();
        this.lastmove = state.lastmove;
        this.lastgroupid = state.lastgroupid;
        this.results = [...state._results];
        this.buildGraph();
        return this;
    }

    private isQuickChurn() {
        return this.variants !== undefined && this.variants.length > 0 && this.variants.includes("quick-churn");
    }

    private isHighChurn() {
        if (this.isQuickChurn()) return true;
        return this.variants !== undefined && this.variants.length > 0 && this.variants.includes("high-churn");
    }

    private getBoardSize(): number {
        if (this.isQuickChurn()) return 3;
        if (this.isHighChurn()) return 4;
        return 5;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    private buildGraph(): TakeGame {
        this.graph = this.getGraph();
        return this;
    }

    private getAllyNeighborCount(player: PlayerId, cell: string): number {
        let numAllyNeighbors = 0;
        const neighbours = this.graph.neighbours(cell);
        const allyColor = (player === 1) ? "red" : "blue";
        neighbours.forEach(neighbour => {
            if (this.board.has(neighbour) && ((this.board.get(neighbour)!)[0] === allyColor || (this.board.get(neighbour)![0]) === allyColor+"-dirt"))
                numAllyNeighbors++;
        });
        return numAllyNeighbors;
    }

    // Is this an empty cell with dirt that has 0 or 1 ally neighbor?
    // Is this an empty cell without dirt that has 1 ally neighbor?
    private isValidPlacement(player: PlayerId, cell: string): boolean {
        const isEmptyDirt = !this.board.has(cell);
        const isEmpty = (this.board.has(cell) && (this.board.get(cell)!)[0] === "empty");
        if (!isEmpty && !isEmptyDirt) return false;
        const numAllyNeighbors = this.getAllyNeighborCount(player, cell);
        return (isEmptyDirt && numAllyNeighbors < 2) || (isEmpty && numAllyNeighbors === 1);
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        return (this.graph.listCells() as string[]).filter(c => this.isValidPlacement(player!, c));
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
            if (this.board.has(cell) && (this.board.get(cell)!)[0] !== "empty") {
                return {move: "", message: ""} as IClickResult;
            } else {
                newmove = cell;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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
            result.message = i18next.t("apgames:validation.take.INITIAL_INSTRUCTIONS");
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
        if (this.board.has(cell) && (this.board.get(cell)!)[0] !== "empty") {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        // cell is valid
        if (!this.isValidPlacement(this.currplayer, cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.take.INITIAL_INSTRUCTIONS");
            return result;
        }

        // valid move
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private removeGroup(groupId: number): TakeGame {
        const removals: string[] = [];
        this.board.forEach((value, key) => {
            if (value[1] === groupId) {
                removals.push(key);
            }
        });
        removals.forEach(key => {
            if (this.board.get(key)![0] === "red" || this.board.get(key)![0] === "blue") {
                this.board.set(key, ["empty", -1]);
            } else {
                this.board.delete(key);
            }
        });
        this.results.push({type: "capture", where: Array.from(removals).join(","), what: "group", count: removals.length});
        return this;
    }

    private getBoundGroups(): number[] {
        const boundGroups: number[] = [];
        const groupIds: number[] = [];
        const cells = (this.graph.listCells() as string[]).filter(c => this.board.has(c) && (this.board.get(c)!)[0] !== "empty");
        for (const cell of cells) {
            const content = this.board.get(cell)!;
            if (!groupIds.includes(content[1])) groupIds.push(content[1]);
        }
        for (const groupId of groupIds) {
            const groupMembers = (this.graph.listCells() as string[]).filter(c => this.board.has(c) && (this.board.get(c)!)[1] === groupId);
            const player = ((this.board.get(groupMembers[0])!)[0].startsWith("red")) ? 1 : 2;
            const moves = this.moves(player);
            let foundMove = false;
            for (const groupMember of groupMembers) {
                const neighbours = this.graph.neighbours(groupMember);
                for (const neighbour of neighbours) {
                    if (moves.includes(neighbour)) {
                        foundMove = true;
                        break;
                    }
                }
                if (foundMove) break;
            }
            if (!foundMove) boundGroups.push(groupId);
        }
        return boundGroups;
    }

    public move(m: string, {trusted = false} = {}): TakeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }

        // Get groups from neighbours
        let groupId = this.lastgroupid;
        const groupIds: number[] = [];
        const neighbours = this.graph.neighbours(m);
        const allyColor = (this.currplayer === 1) ? "red" : "blue";
        neighbours.forEach(neighbour => {
            if (!this.board.has(neighbour) || (this.board.get(neighbour)!)[0] === "empty") return;
            if ((this.board.get(neighbour)!)[0] !== allyColor && (this.board.get(neighbour)!)[0] !== allyColor+"-dirt") return;
            groupIds.push((this.board.get(neighbour)!)[1]);
        });

        // If no neighbours, use a new group id
        if (groupIds.length === 0) {
            // Increment lastgroupid for next use.
            this.lastgroupid++;
        } else if (groupIds.length === 1) {
            groupId = groupIds[0];
        } else {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
        }

        const numNeighbors = this.getAllyNeighborCount(this.currplayer, m);
        if (numNeighbors === 0
                || (this.board.has(m) && (this.board.get(m)!)[0]) === "empty"
                || !this.isHighChurn()) {
            this.board.set(m, [allyColor, groupId]);
        } else {
            this.board.set(m, [(allyColor+"-dirt" as ContentType), groupId]);
        }

        this.results = [];
        this.results.push({type: "place", where: m});

        const boundGroups = this.getBoundGroups();
        for (const group of boundGroups) {
            this.removeGroup(group);
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = ((this.currplayer as number) % this.numplayers) + 1 as PlayerId;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): TakeGame {
        if (this.stack.length === 1) return this;

        const reds = (this.graph.listCells() as string[]).filter(c => this.board.has(c) && ((this.board.get(c)!)[0] === "red" || (this.board.get(c)!)[0] === "red-dirt"));
        const blues = (this.graph.listCells() as string[]).filter(c => this.board.has(c) && ((this.board.get(c)!)[0] === "blue" || (this.board.get(c)!)[0] === "blue-dirt"));

        if (this.currplayer === 1 && blues.length === 0) {
            this.gameover = true;
            this.winner = [1];
        } else if (this.currplayer === 1 && reds.length === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (this.currplayer === 2 && reds.length === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (this.currplayer === 2 && blues.length === 0) {
            this.gameover = true;
            this.winner = [1];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ITakeState {
        return {
            game: TakeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TakeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            lastgroupid: this.lastgroupid,
            board: deepclone(this.board) as Map<string, CellContent>
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
                    const content = (this.board.get(cell)!)[0];
                    if (content === "red") {
                        pieces.push("A");
                    } else if (content === "red-dirt") {
                        pieces.push("B");
                    } else  if (content === "blue") {
                        pieces.push("C");
                    } else if (content === "blue-dirt") {
                        pieces.push("D");
                    } else if (content === "empty") {
                        pieces.push("-");
                    }
                } else {
                    pieces.push("E");
                }
            }
            pstr.push(pieces);
        }

        let dirtSpace = { name: "hex-flat", colour: "#7F461B", scale: .575 };
        if (this.isHighChurn()) {
            dirtSpace = { name: "hex-pointy", colour: "#D28C46", scale: 1.25 };
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [dirtSpace, { name: "piece", player: 1 }],
                C: [{ name: "piece", player: 2 }],
                D: [dirtSpace, { name: "piece", player: 2 }],
                E: [dirtSpace]
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];

            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                } else if (move.type === "capture") {
                    const targets: {row: number, col: number}[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    // @ts-ignore
                    rep.annotations.push({type: "exit", targets});
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

    public clone(): TakeGame {
        return new TakeGame(this.serialize());
    }
}
