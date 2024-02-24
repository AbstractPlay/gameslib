/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type PlayerId = 1|2|3;

// piece color, group id
type CellContent = [PlayerId, number];

// owner, score, groupIds, cellList
type ClaimedRegion = [PlayerId|null, number, number[], string[]];

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, CellContent>;
    lastgroupid: number;
    lastmove?: string;
    scores: [number, number];
};

export interface IRootBoundState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class RootBoundGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Root Bound",
        uid: "rootbound",
        playercounts: [2],
        version: "20240222",
        // i18next.t("apgames:descriptions.rootbound")
        description: "apgames:descriptions.rootbound",
        urls: ["https://cjffield.com/rules/rootbound.pdf"],
        people: [
            {
                type: "designer",
                name: "Christopher Field",
                urls: ["https://cjffield.com"]
            }
        ],
        flags: ["scores", "automove", "experimental"]
    };

    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, CellContent>;
    public boardsize = 7;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public lastgroupid = 0;
    public scores: [number, number] = [0, 0];

    constructor(state?: IRootBoundState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: RootBoundGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                lastgroupid: 0,
                board: new Map<string, CellContent>(),
                scores: [0, 0]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IRootBoundState;
            }
            if (state.game !== RootBoundGame.gameinfo.uid) {
                throw new Error(`The Root Bound engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): RootBoundGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContent>;
        this.boardsize = 7;
        this.lastmove = state.lastmove;
        this.lastgroupid = state.lastgroupid;
        this.results = [...state._results];
        this.scores = [...state.scores];
        this.buildGraph();
        return this;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    private buildGraph(): RootBoundGame {
        this.graph = this.getGraph();
        return this;
    }

    private getOwner(cell: string): PlayerId|null {
        if (!this.board.has(cell)) return null;
        return this.board.get(cell)![0];
    }

    private getGroupId(cell: string): number {
        if (!this.board.has(cell)) return -1;
        return this.board.get(cell)![1];
    }

    private getCellsInGroup(groupId: number): string[] {
        return (this.graph.listCells() as string[]).filter(c => this.getGroupId(c) === groupId);
    }

    private computeClaimedRegions(): ClaimedRegion[] {
        const claimedRegions: ClaimedRegion[] = [];

        if (this.stack.length < 3) {
            return claimedRegions;
        }

        const exploredCells: string[] = [];
        const emptyCells = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));

        while (exploredCells.length !== emptyCells.length) {
            const claimedRegion = [null, 0, [], []] as ClaimedRegion;
            let currentWave: string[] = [];
            let nextWave: string[] = [];
            for (const emptyCell of emptyCells) {
                if (!exploredCells.includes(emptyCell)) {
                    currentWave.push(emptyCell);
                    exploredCells.push(emptyCell);
                    break;
                }
            }

            while (currentWave.length > 0) {
                for (const cell of currentWave) {
                    claimedRegion[1]++;
                    claimedRegion[3].push(cell);
                    const neighbors = this.graph.neighbours(cell);
                    for (const neighbor of neighbors) {
                        if (!this.board.has(neighbor)) {
                            if (!exploredCells.includes(neighbor)) {
                                nextWave.push(neighbor);
                                exploredCells.push(neighbor);
                            }
                        } else {
                            const groupId = this.getGroupId(neighbor);
                            if (!claimedRegion[2].includes(groupId)) {
                                claimedRegion[2].push(groupId);
                            }
                            if (this.getOwner(neighbor) === 1) {
                                if (claimedRegion[0] === null) claimedRegion[0] = 1;
                                if (claimedRegion[0] === 2) claimedRegion[0] = 3;
                            } else if (this.getOwner(neighbor) === 2) {
                                if (claimedRegion[0] === null) claimedRegion[0] = 2;
                                if (claimedRegion[0] === 1) claimedRegion[0] = 3;
                            }
                        }
                    }
                }
                currentWave = [...nextWave];
                nextWave = [];
            }
            claimedRegions.push(claimedRegion);
        }

        return claimedRegions;
    }

    private getEmptyNeighborsOfGroup(groupId: number): string[] {
        const emptyNeighbors: string[] = [];
        const groupCells = this.getCellsInGroup(groupId);
        for (const cell of groupCells) {
            const neighbors = this.graph.neighbours(cell);
            for (const neighbor of neighbors) {
                if (!this.board.has(neighbor) && !emptyNeighbors.includes(neighbor))
                    emptyNeighbors.push(neighbor);
            }
        }
        return emptyNeighbors;
    }

    private canSeeAllyGroup(player: PlayerId, groupId: number): boolean {
        let cellsToExplore = this.getEmptyNeighborsOfGroup(groupId);
        let nextWaveToExplore: string[] = [];
        const exploredCells = [...cellsToExplore];

        while (cellsToExplore.length > 0) {
            for (const cellToExplore of cellsToExplore) {
                const neighbors = this.graph.neighbours(cellToExplore);
                for (const neighbor of neighbors) {
                    if (!this.board.has(neighbor) && !exploredCells.includes(neighbor) && !nextWaveToExplore.includes(neighbor)) {
                        nextWaveToExplore.push(neighbor);
                        exploredCells.push(neighbor);
                    } else if (this.board.has(neighbor) && this.getOwner(neighbor) === player && this.getGroupId(neighbor) !== groupId) {
                        return true;
                    }
                }
            }
            cellsToExplore = [...nextWaveToExplore];
            nextWaveToExplore = [];
        }

        return false;
    }

    private isValidFirstPlacement(player: PlayerId, cell: string): boolean {
        if (this.board.has(cell)) return false;

        const neighbors = this.graph.neighbours(cell).filter(c => this.board.has(c) && this.getOwner(c) === player);
        for (const neighbor of neighbors) {
            const neighborNeighbors = this.graph.neighbours(neighbor).filter(c => this.board.has(c) && this.getOwner(c) === player && neighbors.includes(c));
            if (neighborNeighbors.length > 0) return false;
        }

        return true;
    }

    // Assumes that the first placement has not been put into the board Map
    private isValidSecondPlacement(player: PlayerId, firstCell: string, secondCell: string): boolean {
        if (firstCell === secondCell) return false;
        if (this.board.has(secondCell)) return false;

        const boardClone = deepclone(this.board) as Map<string, CellContent>;
        boardClone.set(firstCell, [player, 10000]);

        const neighbors = this.graph.neighbours(secondCell).filter(c => boardClone.has(c) && boardClone.get(c)![0] === player);
        for (const neighbor of neighbors) {
            const neighborNeighbors = this.graph.neighbours(neighbor).filter(c => boardClone.has(c) && boardClone.get(c)![0] === player && neighbors.includes(c));
            if (neighborNeighbors.length > 0) return false;
        }

        const [firstCol, firstRow] = this.graph.algebraic2coords(firstCell);
        const [secondCol, secondRow] = this.graph.algebraic2coords(secondCell);

        if (2*firstCol-secondCol > 0 && 2*firstRow-secondRow > 0) {
            const existingCell = this.graph.coords2algebraic(2*firstCol-secondCol, 2*firstRow-secondRow);
            if (this.getOwner(existingCell) === player) return false;
        }

        if (2*secondCol-firstCol > 0 && 2*secondRow-firstRow > 0) {
            const existingCell = this.graph.coords2algebraic(2*secondCol-firstCol, 2*secondRow-firstRow);
            if (this.getOwner(existingCell) === player) return false;
        }

        return true;
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const claimedCells: string[] = [];
        const claimedRegions = this.computeClaimedRegions();
        for (const claimedRegion of claimedRegions) {
            if (claimedRegion[0] !== 3) claimedCells.push(...claimedRegion[3]);
        }

        const validFirstMoves = (this.graph.listCells() as string[]).filter(c => !claimedCells.includes(c) && this.isValidFirstPlacement(player!, c));
        moves.push(...validFirstMoves);

        if (this.stack.length > 1) {
            for (const firstMove of validFirstMoves) {
                const validSecondMoves = (this.graph.listCells() as string[]).filter(c => !claimedCells.includes(c) && this.isValidSecondPlacement(player!, firstMove, c));
                for (const secondMove of validSecondMoves) {
                    moves.push(firstMove+","+secondMove);
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    private rapidGrowthMoves(player?: PlayerId): string[] {
        if (this.stack.length === 1) {
            return [];
        }

        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const rapidGrowthMoves: string[] = [];

        const validFirstMoves = (this.graph.listCells() as string[]).filter(c => this.isValidFirstPlacement(player!, c));
        moves.push(...validFirstMoves);

        for (const firstMove of validFirstMoves) {
            const neighbors = this.graph.neighbours(firstMove);
            for (const neighbor of neighbors) {
                if (this.board.has(neighbor)) continue;
                const [firstCol, firstRow] = this.graph.algebraic2coords(firstMove);
                const [secondCol, secondRow] = this.graph.algebraic2coords(neighbor);
                if (2*firstCol-secondCol < 0) continue;
                if (2*firstRow-secondRow < 0) continue;
                const existingCell = this.graph.coords2algebraic(2*firstCol-secondCol, 2*firstRow-secondRow);
                if (this.getOwner(existingCell) === player) {
                    if (!rapidGrowthMoves.includes(firstMove+","+neighbor)) rapidGrowthMoves.push(firstMove+","+neighbor);
                    if (!rapidGrowthMoves.includes(neighbor+","+firstMove)) rapidGrowthMoves.push(neighbor+","+firstMove);
                }
            }
        }

        return rapidGrowthMoves;
    }

    public randomMove(): string {
        const moves = this.moves();
        if (moves.length === 0) return "";
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        if (move.split(",").length === 2) return {move, message: ""} as IClickResult;
        try {
            let newMove = "";
            const cell = this.graph.coords2algebraic(col, row);
            // If you click on an occupied cell, do nothing
            if (this.board.has(cell)) {
                return {move, message: ""} as IClickResult;
            } else {
                newMove = (move === "") ? cell : move+","+cell;
            }

            const result = this.validateMove(newMove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newMove;
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
            if (this.stack.length > 1) {
                result.message = i18next.t("apgames:validation.rootbound.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.rootbound.FIRST_MOVE_INSTRUCTIONS");
            }
            return result;
        }

        const moves = this.moves();
        if (m !== "pass") {
            const cells: string[] = m.split(",");
            if (cells.length > 2) {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }

            const rapidGrowthMoves = this.rapidGrowthMoves();
            if (rapidGrowthMoves.includes(m)) {
                result.message = i18next.t("apgames:validation.rootbound.RAPID_GROWTH");
                return result;
            }

            for (const cell of cells) {
                try {
                    if (cell !== "pass") this.graph.algebraic2coords(cell);
                } catch (e) {
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }

                const neighbors = this.graph.neighbours(cell).filter(c => this.board.has(c) && this.getOwner(c) === this.currplayer);
                for (const neighbor of neighbors) {
                    const neighborNeighbors = this.graph.neighbours(neighbor).filter(c => this.board.has(c) && this.getOwner(c) === this.currplayer && neighbors.includes(c));
                    if (neighborNeighbors.length > 0) {
                        result.message = i18next.t("apgames:validation.rootbound.TOO_MANY_NEIGHBORS");
                        return result;
                    }
                }
            }

            if (cells.length === 2 && this.graph.neighbours(cells[0]).includes(cells[1])) {
                const boardClone = deepclone(this.board) as Map<string, CellContent>;
                boardClone.set(cells[0], [this.currplayer, 10000]);

                const neighbors = this.graph.neighbours(cells[1]).filter(c => boardClone.has(c) && boardClone.get(c)![0] === this.currplayer);
                for (const neighbor of neighbors) {
                    const neighborNeighbors = this.graph.neighbours(neighbor).filter(c => boardClone.has(c) && boardClone.get(c)![0] === this.currplayer && neighbors.includes(c));
                    if (neighborNeighbors.length > 0) {
                        result.message = i18next.t("apgames:validation.rootbound.TOO_MANY_NEIGHBORS");
                        return result;
                    }
                }
            }
        }

        if (moves.includes(m)) {
            result.valid = true;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");

            const cells: string[] = m.split(",");
            if (this.stack.length > 1 && cells.length === 1 && m !== "pass") {
                result.complete = 0;
            } else {
                result.complete = 1;
            }
        }

        return result;
    }

    private mergeGroup(oldGroup: number, newGroup: number): RootBoundGame {
        const updates: Map<string, CellContent> = new Map();
        this.board.forEach((value, key) => {
            if (value[1] === oldGroup) {
                updates.set(key, [value[0], newGroup]);
            }
        });
        updates.forEach((value, key) => {
            this.board.set(key, [...value]);
        });
        return this;
    }

    private removeGroup(groupId: number): RootBoundGame {
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

    public move(m: string, {trusted = false} = {}): RootBoundGame {
        if (m === "") return this;

        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        this.results = [];

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const cells: string[] = m.split(",");
            for (const cell of cells) {
                // Get groups from neighbours
                let groupId = this.lastgroupid;
                const groupIds: number[] = [];
                const neighbours = this.graph.neighbours(cell);
                neighbours.forEach(neighbour => {
                    if (!this.board.has(neighbour)) return;
                    if (this.getOwner(neighbour) !== this.currplayer) return;
                    const neighborGroupId = this.getGroupId(neighbour);
                    if (groupIds.includes(neighborGroupId)) return;
                    groupIds.push(neighborGroupId);
                });

                // If no neighbours, use a new group id
                if (groupIds.length === 0) {
                    // Increment lastgroupid for next use.
                    this.lastgroupid++;
                } else {
                    groupId = groupIds.shift()!;
                    groupIds.forEach(oldGroup => this.mergeGroup(oldGroup, groupId));
                }

                this.board.set(cell, [this.currplayer, groupId]);
                this.results.push({type: "place", where: cell});
            }
        }

        if (this.stack.length > 2) {
            let claimedRegions = this.computeClaimedRegions();

            const deadGroups = this.getDeadGroups(claimedRegions);
            for (const group of deadGroups) {
                this.removeGroup(group);
            }

            if (deadGroups.length > 0) {
                claimedRegions = this.computeClaimedRegions();
            }

            this.scores[0] = 0;
            this.scores[1] = 0;
            for (const claimedRegion of claimedRegions) {
                if (claimedRegion[0] === 1) this.scores[0] += claimedRegion[1];
                if (claimedRegion[0] === 2) this.scores[1] += claimedRegion[1];
            }
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = ((this.currplayer as number) % this.numplayers) + 1 as PlayerId;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getDeadGroups(claimedRegions: ClaimedRegion[]): number[] {
        const liveGroups: number[] = [];
        const otherPlayer = (this.currplayer === 1) ? 2 : 1;
        for (const claimedRegion of claimedRegions) {
            if (claimedRegion[0] === otherPlayer) {
                liveGroups.push(...claimedRegion[2]);
            }
        }

        const deadGroups: number[] = [];

        const groupIds: number[] = [];
        const cells = (this.graph.listCells() as string[]).filter(c => this.board.has(c));
        for (const cell of cells) {
            if (this.getOwner(cell) === otherPlayer) {
                const groupId = this.getGroupId(cell);
                if (!groupIds.includes(groupId)) groupIds.push(groupId);
            }
        }

        const player = (this.currplayer === 1) ? 2 : 1;
        for (const groupId of groupIds) {
            if (!liveGroups.includes(groupId) && !this.canSeeAllyGroup(player, groupId)) {
                deadGroups.push(groupId);
            }
        }

        return deadGroups;
    }

    protected checkEOG(): RootBoundGame {
        if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass") {
            this.gameover = true;
            const p1Score = this.scores[0];
            const p2Score = this.scores[1];
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.scores[0], this.scores[1]] }
        ]
    }

    public state(): IRootBoundState {
        return {
            game: RootBoundGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: RootBoundGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            lastgroupid: this.lastgroupid,
            board: deepclone(this.board) as Map<string, CellContent>,
            scores: [...this.scores]
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
                    if (this.getOwner(cell) === 1) {
                        pieces.push("A");
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
                style: "hex-of-tri",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }]
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

    public clone(): RootBoundGame {
        return new RootBoundGame(this.serialize());
    }
}