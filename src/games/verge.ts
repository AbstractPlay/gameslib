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

type playerid = 1|2;

// piece color, group id, frozen?
type CellContent = [playerid, number, boolean];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContent>;
    lastgroupid: number;
    lastmove?: string;
};

export interface IVergeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class VergeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Verge",
        uid: "verge",
        playercounts: [2],
        version: "20240126",
        dateAdded: "2024-01-30",
        // i18next.t("apgames:descriptions.verge")
        description: "apgames:descriptions.verge",
        urls: ["https://boardgamegeek.com/boardgame/396931/verge"],
        people: [
            {
                type: "designer",
                name: "Michael Amundsen"
            }
        ],
        categories: ["goal>immobilize", "mechanic>place",  "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["pie"],
        variants: [
            {
                uid: "size-7",
                group: "board",
            }
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContent>;
    public boardsize = 5;
    public graph: HexTriGraph = new HexTriGraph(5, 9);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public lastgroupid = 0;

    constructor(state?: IVergeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: VergeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                lastgroupid: 0,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IVergeState;
            }
            if (state.game !== VergeGame.gameinfo.uid) {
                throw new Error(`The Verge engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): VergeGame {
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

    private getBoardSize(): number {
        if (this.variants !== undefined
                && this.variants.length > 0
                && this.variants.includes("size-7")) {
            return 7;
        }
        return 5;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    private buildGraph(): VergeGame {
        this.graph = this.getGraph();
        return this;
    }

    // Is this an empty cell and does it not have any frozen groups for this player next to it?
    private isEmptyWithNoFrozenNeighbours(player: playerid, cell: string): boolean {
        if (this.board.get(cell)) return false;
        const neighbours = this.graph.neighbours(cell);
        let hasFrozenNeighbor = false;
        neighbours.forEach(neighbour => {
            if (this.board.has(neighbour)
                    && (this.board.get(neighbour)!)[0] === player
                    && (this.board.get(neighbour)!)[2])
                hasFrozenNeighbor = true;
        });
        return !hasFrozenNeighbor;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        return (this.graph.listCells() as string[]).filter(c => this.isEmptyWithNoFrozenNeighbours(player!, c));
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
            result.message = i18next.t("apgames:validation.verge.INITIAL_INSTRUCTIONS");
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

        // cell is adjacent to a frozen group
        if (!this.isEmptyWithNoFrozenNeighbours(this.currplayer, cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.verge.FROZEN_NEIGHBOUR");
            return result;
        }

        // valid move
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private mergeGroup(oldGroup: number, newGroup: number): VergeGame {
        const updates: Map<string, CellContent> = new Map();
        this.board.forEach((value, key) => {
            if (value[1] === oldGroup) {
                updates.set(key, [value[0], newGroup, value[2]]);
            }
        });
        updates.forEach((value, key) => {
            this.board.set(key, [...value]);
        });
        return this;
    }

    private floodFill(boardClone: Map<string, CellContent>, cell: string): VergeGame {
        boardClone.set(cell, [this.currplayer, 0, false]);
        const neighbours = this.graph.neighbours(cell).filter(c => !boardClone.has(c));
        neighbours.forEach(neighbour => this.floodFill(boardClone, neighbour));
        return this;
    }

    private shouldFreezeGroup(groupId: number): boolean {
        const boardClone = deepclone(this.board) as Map<string, CellContent>;
        const removals: string[] = [];
        boardClone.forEach((value, key) => {
            if (value[1] !== groupId) {
                removals.push(key);
            }
        });
        removals.forEach(key => {
            boardClone.delete(key);
        });

        const empties: string[] = (this.graph.listCells() as string[]).filter(c => !boardClone.has(c));
        if (empties.length === 0) return false;
        this.floodFill(boardClone, empties[0]);
        const empties2: string[] = (this.graph.listCells() as string[]).filter(c => !boardClone.has(c));
        if (empties2.length === 0) return false;

        return true;
    }

    private freezeGroup(groupId: number): VergeGame {
        const updates: Map<string, CellContent> = new Map();
        this.board.forEach((value, key) => {
            if (value[1] === groupId) {
                updates.set(key, [value[0], value[1], true]);
            }
        });
        updates.forEach((value, key) => {
            this.board.set(key, [...value]);
        });
        return this;
    }

    private removeGroup(groupId: number): VergeGame {
        const removals: string[] = [];
        this.board.forEach((value, key) => {
            if (value[1] === groupId) {
                removals.push(key);
            }
        });
        removals.forEach(key => {
            this.board.delete(key);
        });
        this.results.push({type: "capture", where: Array.from(removals).join(","), what: "group", count: removals.length});
        return this;
    }

    private removeAdjacentEnemyUnfrozenGroups(groupId: number): VergeGame {
        const groupsToRemove: number[] = [];
        this.board.forEach((value, key) => {
            if (value[1] === groupId) {
                const neighbours = this.graph.neighbours(key);
                neighbours.forEach(neighbour => {
                    if (this.board.has(neighbour)
                            && (this.board.get(neighbour)!)[0] !== this.currplayer
                            && !(this.board.get(neighbour)!)[2]
                            && !groupsToRemove.includes((this.board.get(neighbour)!)[1]))
                        groupsToRemove.push((this.board.get(neighbour)!)[1]);
                });
            }
        });
        groupsToRemove.forEach(group => this.removeGroup(group));
        return this;
    }

    public move(m: string, {trusted = false} = {}): VergeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        // Get groups from neighbours
        let groupId = this.lastgroupid;
        const groupIds: number[] = [];
        const neighbours = this.graph.neighbours(m);
        neighbours.forEach(neighbour => {
            if (!this.board.has(neighbour)) return;
            if ((this.board.get(neighbour)!)[0] !== this.currplayer) return;
            groupIds.push((this.board.get(neighbour)!)[1]);
        });

        // If no neighbours, use a new group id
        if (groupIds.length === 0) {
            // Increment lastgroupid for next use.
            this.lastgroupid++;
        } else {
            groupId = groupIds[0];
            if (groupIds.length > 1) {
                groupIds.forEach(oldGroup => this.mergeGroup(oldGroup, groupId));
            }
        }

        this.results = [];
        this.board.set(m, [this.currplayer, groupId, false]);
        this.results.push({type: "place", where: m});

        // Check for frozen groups
        if (this.shouldFreezeGroup(groupId)) {
            this.freezeGroup(groupId);
            this.removeAdjacentEnemyUnfrozenGroups(groupId);
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = ((this.currplayer as number) % this.numplayers) + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): VergeGame {
        if (this.moves().length === 0) {
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

    public state(): IVergeState {
        return {
            game: VergeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: VergeGame.gameinfo.version,
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
                    const owner = (this.board.get(cell)!)[0];
                    const frozen = (this.board.get(cell)!)[2];
                    if (owner === 1) {
                        if (frozen) {
                            pieces.push("B");
                        } else {
                            pieces.push("A");
                        }
                    } else {
                        if (frozen) {
                            pieces.push("D");
                        } else {
                            pieces.push("C");
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
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", colour: "#FFF"}, { name: "piece", player: 1, opacity: 0.5 }],
                C: [{ name: "piece", player: 2 }],
                D: [{ name: "piece", colour: "#FFF"}, { name: "piece", player: 2, opacity: 0.5 }],
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

    public clone(): VergeGame {
        return new VergeGame(this.serialize());
    }
}
