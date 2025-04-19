import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

type PlayerId = 1|2|3;

// piece color, group id
type CellContent = [PlayerId, number];

// owner, score, groupIds, cellList
type ClaimedRegion = [PlayerId|null, number, number[], string[]];

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, CellContent>;
    lastgroupid: number; // This is misnamed, it should be nextgroupid but oh well.
    lastmove?: string;
    fistpasser?: PlayerId;
    deadcells?: string[][];
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
        version: "20240729",
        dateAdded: "2024-02-25",
        // i18next.t("apgames:descriptions.rootbound")
        description: "apgames:descriptions.rootbound",
        urls: [
            "https://cjffield.com/rules/rootbound.pdf",
            "https://boardgamegeek.com/boardgame/416201/root-bound",
        ],
        people: [
            {
                type: "designer",
                name: "Christopher Field",
                urls: ["https://cjffield.com"],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>capture", "mechanic>enclose", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["scores", "automove"],
        displays: [{uid: "hide-highlights"}]
    };

    public version = parseInt(RootBoundGame.gameinfo.version, 10);
    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, CellContent>;
    public boardsize = 7;
    public graph?: HexTriGraph;
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public lastgroupid = 0;
    public firstpasser?: PlayerId;
    public deadcells: string[][] = [[],[]];
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
                deadcells: [[],[]],
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
        this.buildGraph();
    }

    public load(idx = -1): RootBoundGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.version = parseInt(state._version, 10);
        this.currplayer = state.currplayer;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this.board = deepclone(state.board) as Map<string, CellContent>;
        this.lastmove = state.lastmove;
        this.lastgroupid = state.lastgroupid;
        this.results = [...state._results];
        this.firstpasser = state.firstpasser as PlayerId;
        this.deadcells = state.deadcells === undefined ? [[],[]] : [...state.deadcells];
        this.scores = [...state.scores];
        return this;
    }

    private buildGraph(): HexTriGraph {
        this.graph = new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
        return this.graph;
    }

    private getGraph(): HexTriGraph {
        return (this.graph === undefined) ? this.buildGraph() : this.graph;
    }

    // Known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) {
                return this.getGraph().listCells();
            } else {
                return this.getGraph().listCells(ordered);
            }
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
    }

    private getOwner(cell: string, board?: Map<string, CellContent>): PlayerId|null {
        if (board === undefined) {
            board = this.board;
        }
        if (!board.has(cell)) return null;
        return board.get(cell)![0];
    }

    private getGroupId(cell: string, board?: Map<string, CellContent>): number {
        if (board === undefined) {
            board = this.board;
        }
        if (!board.has(cell)) return -1;
        return board.get(cell)![1];
    }

    private getCellsInGroup(groupId: number): string[] {
        return (this.listCells() as string[]).filter(c => this.getGroupId(c) === groupId);
    }

    private computeClaimedRegions(board?: Map<string, CellContent>): ClaimedRegion[] {
        if (board === undefined) {
            board = this.board;
        }

        const claimedRegions: ClaimedRegion[] = [];

        if (this.stack.length < 3) {
            return claimedRegions;
        }

        const exploredCells: string[] = [];
        const emptyCells = (this.listCells() as string[]).filter(c => !board!.has(c));

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
                    const neighbors = this.getGraph().neighbours(cell);
                    for (const neighbor of neighbors) {
                        if (!board.has(neighbor)) {
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

    private getEmptyNeighborsOfGroup(groupId: number, board?: Map<string, CellContent>): string[] {
        if (board === undefined) {
            board = this.board;
        }
        const emptyNeighbors: string[] = [];
        const groupCells = this.getCellsInGroup(groupId);
        for (const cell of groupCells) {
            const neighbors = this.getGraph().neighbours(cell);
            for (const neighbor of neighbors) {
                if (!board.has(neighbor) && !emptyNeighbors.includes(neighbor))
                    emptyNeighbors.push(neighbor);
            }
        }
        return emptyNeighbors;
    }

    private getGroupOwner(groupId: number, board?: Map<string, CellContent>): PlayerId|null {
        if (board === undefined) {
            board = this.board;
        }
        for (const cell of (this.listCells() as string[])) {
            if (board.has(cell) && this.getGroupId(cell) === groupId) {
                return this.getOwner(cell, board);
            }
        }
        return null;
    }

    private canSeeAllyGroup(groupId: number, liveGroups: number[]|null = null, board?: Map<string, CellContent>): boolean {
        if (board === undefined) {
            board = this.board;
        }
        const player = this.getGroupOwner(groupId, board);
        let cellsToExplore = this.getEmptyNeighborsOfGroup(groupId, board);
        let nextWaveToExplore: string[] = [];
        const exploredCells = [...cellsToExplore];

        while (cellsToExplore.length > 0) {
            for (const cellToExplore of cellsToExplore) {
                const neighbors = this.getGraph().neighbours(cellToExplore);
                for (const neighbor of neighbors) {
                    if (!board.has(neighbor) && !exploredCells.includes(neighbor) && !nextWaveToExplore.includes(neighbor)) {
                        nextWaveToExplore.push(neighbor);
                        exploredCells.push(neighbor);
                    } else if (board.has(neighbor)) {
                        const tempGroupId = this.getGroupId(neighbor, board);
                        if (this.getOwner(neighbor, board) === player && tempGroupId !== groupId
                                && (liveGroups === null || liveGroups.includes(tempGroupId))) {
                            return true;
                        }
                    }
                }
            }
            cellsToExplore = [...nextWaveToExplore];
            nextWaveToExplore = [];
        }

        return false;
    }

    private isValidPlacement(player: PlayerId, cell: string): boolean {
        if (this.board.has(cell)) return false;

        const neighbors = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.getOwner(c) === player);
        for (const neighbor of neighbors) {
            const neighborNeighbors = this.getGraph().neighbours(neighbor).filter(c => this.board.has(c) && this.getOwner(c) === player && neighbors.includes(c));
            if (neighborNeighbors.length > 0) return false;
        }

        return true;
    }

    // Assumes that the first placement has not been put into the board Map
    private isValidSecondPlacement(player: PlayerId, secondCell: string, boardClone: Map<string, CellContent>): boolean {
        if (boardClone.has(secondCell)) return false;

        const neighbors = this.getGraph().neighbours(secondCell).filter(c => boardClone.has(c) && boardClone.get(c)![0] === player);
        for (const neighbor of neighbors) {
            const neighborNeighbors = this.getGraph().neighbours(neighbor).filter(c => boardClone.has(c) && boardClone.get(c)![0] === player && neighbors.includes(c));
            if (neighborNeighbors.length > 0) return false;
        }

        return true;
    }

    private isRapidGrowthMove(firstCell: string, secondCell: string, player?: PlayerId, reverse?: boolean): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }

        if (!this.getGraph().neighbours(firstCell).includes(secondCell)) return false;

        const [firstCol, firstRow] = this.getGraph().algebraic2coords(firstCell);
        let dir: "NE"|"E"|"SE"|"SW"|"W"|"NW";
        for (const tempDir of HexTriGraph.directions) {
            // [col, row]
            const tempCoords = this.getGraph().move(firstCol, firstRow, tempDir);
            if (tempCoords && this.getGraph().coords2algebraic(tempCoords[0], tempCoords[1]) === secondCell) {
                dir = tempDir;
            }
        }

        const [secondCol, secondRow] = this.getGraph().algebraic2coords(secondCell);
        const coords = this.getGraph().move(secondCol, secondRow, dir!);
        if (coords) {
            const testCell = this.getGraph().coords2algebraic(coords[0], coords[1]);
            if (this.board.has(testCell) && this.getOwner(testCell) === player) return true;
        }

        if (!reverse) return this.isRapidGrowthMove(secondCell, firstCell, player, true);
        return false;
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const prohibitedCells: string[] = [];
        const claimedRegions = this.computeClaimedRegions();
        for (const claimedRegion of claimedRegions) {
            if (claimedRegion[0] !== 3) prohibitedCells.push(...claimedRegion[3]);
        }

        if (this.stack.length === 3) {
            prohibitedCells.push(...this.getEmptyNeighborsOfGroup(0));
        }

        const validFirstMoves = (this.listCells() as string[]).filter(c => !prohibitedCells.includes(c) && this.isValidPlacement(player!, c)).sort();
        moves.push(...validFirstMoves);

        if (this.stack.length > 1) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const boardClone = deepclone(this.board) as Map<string, CellContent>;

            for (const firstMove of validFirstMoves) {
                const neighbors: string[] = [];
                if (this.stack.length === 2) neighbors.push(...this.getGraph().neighbours(firstMove).filter(c => !this.board.has(c)));
                if (this.stack.length === 3) neighbors.push(...this.getGraph().neighbours(firstMove).filter(c => this.getEmptyNeighborsOfGroup(0).includes(c)));

                boardClone.set(firstMove, [player, 10000]);

                const validSecondMoves = (this.listCells() as string[]).filter(c => !prohibitedCells.includes(c) && !neighbors.includes(c)
                        && this.isValidSecondPlacement(player!, c, boardClone)).sort();
                for (const secondMove of validSecondMoves) {
                    if (!this.isRapidGrowthMove(firstMove, secondMove)) {
                        if (!moves.includes(`${secondMove},${firstMove}`)) {
                            moves.push(`${firstMove},${secondMove}`);
                        }
                    }
                }

                boardClone.delete(firstMove);
            }
        }

        if (this.stack.length > 3) {
            moves.push("pass");
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        if (moves.length === 0) return "";
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        if ((this.stack.length === 1 && move !== "") || move.split(",").length === 2) return {move, message: ""} as IClickResult;
        try {
            let newMove = "";
            let retryMove = "";
            const cell = this.getGraph().coords2algebraic(col, row);
            // If you click on an occupied cell, do nothing
            if (this.board.has(cell)) {
                return {move, message: ""} as IClickResult;
            } else {
                newMove = (move === "") ? cell : move+","+cell;
                retryMove = (move === "") ? cell : cell+","+move;
            }

            let result = this.validateMove(newMove) as IClickResult;
            if (!result.valid) {
                newMove = retryMove;
                result = this.validateMove(newMove) as IClickResult;
            }
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
            if (this.stack.length > 3) {
                result.message = i18next.t("apgames:validation.rootbound.INITIAL_INSTRUCTIONS");
            } else if (this.stack.length > 1) {
                result.message = i18next.t("apgames:validation.rootbound.SECOND_MOVE_INSTRUCTIONS");
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

            const claimedCells: string[] = [];
            const claimedRegions = this.computeClaimedRegions();
            for (const claimedRegion of claimedRegions) {
                if (claimedRegion[0] !== 3) claimedCells.push(...claimedRegion[3]);
            }

            for (const cell of cells) {
                try {
                    if (cell !== "pass") this.getGraph().algebraic2coords(cell);
                } catch (e) {
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }

                if (claimedCells.includes(cell)) {
                    result.message = i18next.t("apgames:validation.rootbound.CLAIMED_CELL");
                    return result;
                }

                const neighbors = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.getOwner(c) === this.currplayer);
                for (const neighbor of neighbors) {
                    const neighborNeighbors = this.getGraph().neighbours(neighbor).filter(c => this.board.has(c) && this.getOwner(c) === this.currplayer && neighbors.includes(c));
                    if (neighborNeighbors.length > 0) {
                        result.message = i18next.t("apgames:validation.rootbound.TOO_MANY_NEIGHBORS");
                        return result;
                    }
                }
            }

            if (this.stack.length === 3 && this.getEmptyNeighborsOfGroup(0).includes(cells[0])) {
                result.message = i18next.t("apgames:validation.rootbound.BAD_SECOND_MOVE");
                return result;
            }

            if (cells.length === 2 && this.getGraph().neighbours(cells[0]).includes(cells[1])) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                const boardClone = deepclone(this.board) as Map<string, CellContent>;
                boardClone.set(cells[0], [this.currplayer, 10000]);
                const neighbors = this.getGraph().neighbours(cells[1]).filter(c => boardClone.has(c) && boardClone.get(c)![0] === this.currplayer);
                for (const neighbor of neighbors) {
                    const neighborNeighbors = this.getGraph().neighbours(neighbor).filter(c => boardClone.has(c) && boardClone.get(c)![0] === this.currplayer && neighbors.includes(c));
                    if (neighborNeighbors.length > 0) {
                        result.message = i18next.t("apgames:validation.rootbound.TOO_MANY_NEIGHBORS");
                        return result;
                    }
                }

                if (this.stack.length === 2 && this.getGraph().neighbours(cells[0]).includes(cells[1]) ||
                        this.stack.length === 3 && this.getGraph().neighbours(cells[0]).includes(cells[1]) && this.getEmptyNeighborsOfGroup(0).includes(cells[1])) {
                    result.message = i18next.t("apgames:validation.rootbound.BAD_SECOND_MOVE");
                    return result;
                }

                if (this.isRapidGrowthMove(cells[0], cells[1])) {
                    result.message = i18next.t("apgames:validation.rootbound.RAPID_GROWTH");
                    return result;
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

    private removeGroup(groupId: number, includeInResult = true, board?: Map<string, CellContent>): RootBoundGame {
        if (board === undefined) {
            board = this.board;
        }

        const removals: string[] = [];
        board.forEach((value, key) => {
            if (value[1] === groupId) {
                removals.push(key);
                if (!includeInResult) {
                    this.deadcells[value[0]-1].push(key);
                }
            }
        });
        removals.forEach(key => {
            board!.delete(key);
        });
        if (includeInResult) {
            this.results.push({type: "capture", where: Array.from(removals).join(","), what: "group", count: removals.length});
        }
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
            if (this.firstpasser === undefined) {
                this.firstpasser = this.currplayer;
            }
        } else {
            const cells: string[] = m.split(",");
            for (const cell of cells) {
                // Get groups from neighbours
                let groupId = this.lastgroupid;
                const groupIds: number[] = [];
                const neighbours = this.getGraph().neighbours(cell);
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

        let claimedRegions = this.computeClaimedRegions();
        if (this.removeDeadGroups(claimedRegions)) {
            claimedRegions = this.computeClaimedRegions();
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = ((this.currplayer as number) % this.numplayers) + 1 as PlayerId;

        if (this.isNewRules()) {
            const board = this.resolveBoardAndUpdateScore();
            if (this.checkEOGTrigger()) {
                this.board = board;
                this.resolveEOG();
            }
        } else {
            this.updateScore(claimedRegions);
            if (this.checkEOGTrigger()) {
                this.resolveEOG();
            }
        }

        this.saveState();
        return this;
    }

    private resolveBoardAndUpdateScore(): Map<string, CellContent> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const board = deepclone(this.board) as Map<string, CellContent>;

        const originalRegions = this.computeClaimedRegions(board);
        let claimedRegions = [...originalRegions];

        this.deadcells = [[], []];
        for (const keyValueArray of this.getGroupsBySize(board)) {
            const liveGroups = this.getLiveGroups(1, claimedRegions);
            liveGroups.push(...this.getLiveGroups(2, claimedRegions));
            let groupsRemoved = false;
            for (const group of keyValueArray[1]) {
                if (!liveGroups.includes(group) && !this.canSeeAllyGroup(group, liveGroups, board)) {
                    this.removeGroup(group, false, board);
                    groupsRemoved = true;
                }
            }
            if (groupsRemoved) {
                claimedRegions = this.computeClaimedRegions(board);
            }
        }

        if (claimedRegions.filter(c => c[0] !== null).length < 2) {
            this.updateScore(originalRegions, this.board);
        } else {
            this.updateScore(claimedRegions, board);
        }
        return board;
    }

    private removeDeadGroups(claimedRegions: ClaimedRegion[]): boolean {
        if (this.stack.length > 2) {
            const otherPlayer = (this.currplayer === 1) ? 2 : 1;
            const deadGroups = this.getDeadGroups(otherPlayer, claimedRegions);
            for (const group of deadGroups) {
                this.removeGroup(group);
            }
            return deadGroups.length > 0;
        }
        return false;
    }

    private updateScore(claimedRegions: ClaimedRegion[], board?: Map<string, CellContent>): RootBoundGame {
        if (board === undefined) {
            board = this.board;
        }

        this.scores[0] = 0;
        this.scores[1] = 0;

        for (const claimedRegion of claimedRegions) {
            if (claimedRegion[0] === 1) this.scores[0] += claimedRegion[1];
            if (claimedRegion[0] === 2) this.scores[1] += claimedRegion[1];
        }

        if (this.isNewRules()) {
            for (const cell of (this.listCells() as string[]).filter(c => board!.has(c))) {
                if (board.get(cell)![0] === 1) {
                    this.scores[0]++;
                } else {
                    this.scores[1]++;
                }
            }

            if (this.firstpasser !== undefined) {
                if (this.firstpasser === 1) this.scores[0] += 0.5;
                else this.scores[1] += 0.5;
            }
        }
        return this;
    }

    private getGroupsBySize(board?: Map<string, CellContent>): Map<number, number[]> {
        if (board === undefined) {
            board = this.board;
        }

        const groupsBySize = new Map<number, number[]>();
        const sizeByGroupArray: [number, number][] = [];
        const cells = (this.listCells() as string[]).filter(c => board!.has(c));
        for (const cell of cells) {
            const groupId = this.getGroupId(cell);
            if (sizeByGroupArray[groupId] === undefined) {
                sizeByGroupArray[groupId] = [groupId, 1];
            } else {
                sizeByGroupArray[groupId][1]++;
            }
        }
        for (const group of sizeByGroupArray.filter(c => c !== undefined)) {
            if (!groupsBySize.has(group[1])) groupsBySize.set(group[1], []);
            groupsBySize.get(group[1])!.push(group[0]);
        }

        return new Map([...groupsBySize.entries()].sort((a,b) => a[0]-b[0]));
    }

    private getLiveGroups(player: PlayerId, claimedRegions: ClaimedRegion[]): number[] {
        const liveGroups: number[] = [];
        for (const claimedRegion of claimedRegions) {
            if (claimedRegion[0] === player) {
                for (const group of claimedRegion[2]) {
                    if (!liveGroups.includes(group)) {
                        liveGroups.push(group);
                    }
                }
            }
        }
        return liveGroups;
    }

    private getDeadGroups(player: PlayerId, claimedRegions: ClaimedRegion[]): number[] {
        const deadGroups: number[] = [];

        const groupIds: number[] = [];
        const cells = (this.listCells() as string[]).filter(c => this.board.has(c));
        for (const cell of cells) {
            if (this.getOwner(cell) === player) {
                const groupId = this.getGroupId(cell);
                if (!groupIds.includes(groupId)) groupIds.push(groupId);
            }
        }

        const liveGroups = this.getLiveGroups(player, claimedRegions);
        for (const groupId of groupIds) {
            if (!liveGroups.includes(groupId) && !this.canSeeAllyGroup(groupId)) {
                deadGroups.push(groupId);
            }
        }

        return deadGroups;
    }

    private isNewRules(): boolean {
        if (this.version < 20240729) return false;
        return true;
    }

    private checkEOGTrigger(): boolean {
        return this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass";
    }

    private resolveEOG(): RootBoundGame {
        this.gameover = true;
        const p1Score = this.scores[0];
        const p2Score = this.scores[1];
        this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
        this.results.push(
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        );
        return this;
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
            _version: `${this.version}`,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            lastgroupid: this.lastgroupid,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            board: deepclone(this.board) as Map<string, CellContent>,
            firstpasser: this.firstpasser,
            deadcells: this.deadcells,
            scores: [...this.scores]
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const displayHighlights = (opts === undefined || opts.altDisplay === undefined || opts.altDisplay !== "hide-highlights");

        // Build piece string
        const pstr: string[][] = [];
        const scoringCells: Map<string, PlayerId> = new Map<string, PlayerId>();

        if (displayHighlights) {
            const claimedRegions = this.computeClaimedRegions();
            for (const claimedRegion of claimedRegions) {
                if (claimedRegion[0] === 1 || claimedRegion[0] === 2) {
                    for (const scoredCell of claimedRegion[3]) {
                        scoringCells.set(scoredCell, claimedRegion[0]);
                    }
                }
            }
        }

        const cells = this.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    if (this.getOwner(cell) === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else if (displayHighlights && scoringCells.has(cell)) {
                    if (scoringCells.get(cell) === 1) {
                        pieces.push("C");
                    } else {
                        pieces.push("D");
                    }
                // Fake the old stones at the end of the game.
                } else if (this.deadcells[0].includes(cell) && !scoringCells.has(cell)) {
                    pieces.push("A");
                } else if (this.deadcells[1].includes(cell) && !scoringCells.has(cell)) {
                    pieces.push("B");
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep = {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "hex-pointy", colour: 1, scale: 1.25, opacity: 0.3 }],
                D: [{ name: "hex-pointy", colour: 2, scale: 1.25, opacity: 0.3 }]
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];

            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.getGraph().algebraic2coords(move.where!);
                    rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                } else if (move.type === "capture") {
                    const targets: {row: number, col: number}[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = this.getGraph().algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [{row: number; col: number}, ...{row: number; col: number}[]]});
                }
            }

            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public getPlayerScore(player: PlayerId): number {
        return this.scores[player-1];
    }

    public getPlayersScores(): IScores[] {
        if (this.gameover) {
            return [{
                name: i18next.t("apgames:status.SCORES"),
                scores: [this.scores[0], this.scores[1]]
            }];
        } else {
            return [{
                name: i18next.t("apgames:status.ESTIMATEDSCORES"),
                scores: [this.scores[0], this.scores[1]]
            }];
        }
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `**Scores**: ${this.getPlayerScore(1)}-${this.getPlayerScore(2)} \n\n`;

        return status;
    }

    public clone(): RootBoundGame {
        return new RootBoundGame(this.serialize());
    }
}
