import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { PentaHexGraph } from "../common/graphs";

// To match external schemas, this needs to be 1 based
type PlayerId = 1|2;

// owner, group id
type CellContent = [PlayerId, number];

// owner (0 = none, 1 = p1, 2 = p2, 3 = both), cells
type ClaimedRegion = [number, string[]];

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, CellContent>;
    nextgroup: number;
    lastmove?: string;
    scores: [number, number];
    groupScores: [number[], number[]];
};

export interface IBluestoneState extends IAPGameState {
    stack: Array<IMoveState>;
};

export class BluestoneGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bluestone",
        uid: "bluestone",
        playercounts: [2],
        version: "20250830",
        dateAdded: "2025-08-30",
        // i18next.t("apgames:descriptions.bluestone")
        description: "apgames:descriptions.bluestone",
        // i18next.t("apgames:notes.bluestone")
        notes: "apgames:notes.bluestone",
        urls: ["https://boardgamegeek.com/boardgame/444241/bluestone"],
        people: [
            {
                type: "designer",
                name: "Craig Duncan",
                urls: ["https://boardgamegeek.com/boardgamedesigner/66694/craig-duncan"],
                apid: "d1f9fa1b-889c-4234-a95c-9a5d389bf98e",
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>capture", "board>shape>hex"],
        flags: ["scores", "automove", "custom-colours"],
        variants: [{
            uid: "size-8",
            name: "Size 8",
            group: "board",
            description: "Larger board (35 blue stones)"
        }]
    };

    public numplayers = 2;
    public version = BluestoneGame.gameinfo.version;
    public currplayer: PlayerId = 1;
    public board!: Map<string, CellContent>;
    public graph?: PentaHexGraph;
    public gameover = false;
    public winner: number[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public nextgroup = 0;
    public scores: [number, number] = [0, 0];
    public groupScores: [number[], number[]] = [[], []];
    public boardSize = 0;

    constructor(state?: IBluestoneState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const board: Map<string, CellContent> = new Map();
            const fresh: IMoveState = {
                _version: BluestoneGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                nextgroup: 0,
                scores: [0,0],
                groupScores: [[], []]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBluestoneState;
            }
            if (state.game !== BluestoneGame.gameinfo.uid) {
                throw new Error(`The Bluestone engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.boardSize = this.getBoardSize();
        this.load();
        this.buildGraph();
    }

    public load(idx = -1): BluestoneGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.nextgroup = state.nextgroup;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.scores = [...state.scores];
        this.groupScores = [...state.groupScores];
        return this;
    }

    private buildGraph(): PentaHexGraph {
        this.graph = new PentaHexGraph(this.boardSize);
        return this.graph;
    }

    private getGraph(boardSize?: number): PentaHexGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new PentaHexGraph(boardSize);
        }
    }

    // Fixes known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            return this.getGraph().listCells(ordered);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
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
        return 6;
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        moves.push("pass");

        const prohibitedCells: string[] = [];
        const claimedRegions = this.computeClaimedRegions();
        for (const claimedRegion of claimedRegions) {
            if (claimedRegion[0] === this.getOtherPlayer(this.currplayer)) prohibitedCells.push(...claimedRegion[1]);
        }

        const emptyCells = (this.getGraph().listCells() as string[])
            .filter(cell => !this.board.has(cell) && !prohibitedCells.includes(cell));
        emptyCells.forEach(cell => {
            moves.push(cell);

            if (this.stack.length > 1) {
                const neighbourGroups: number[] = [];
                const neighbours = this.getGraph().neighbours(cell).filter(neighbour => this.board.has(neighbour) && this.board.get(neighbour)![0] === this.currplayer);
                const emptyNeighbours = this.getGraph().neighbours(cell).filter(neighbour => !this.board.has(neighbour));
                neighbours.forEach(neighbour => {
                    const groupId = this.board.get(neighbour)![1];
                    if (!neighbourGroups.includes(groupId)) neighbourGroups.push(groupId);
                });

                emptyCells.filter(cell2 => cell !== cell2 && !emptyNeighbours.includes(cell2)).forEach(cell2 => {
                    const neighbours2 = this.getGraph().neighbours(cell2).filter(neighbour => this.board.has(neighbour) && this.board.get(neighbour)![0] === this.currplayer);
                    let legalPlacement = true;
                    neighbours2.forEach(neighbour => {
                        const groupId = this.board.get(neighbour)![1];
                        if (neighbourGroups.includes(groupId)) {
                            legalPlacement = false;
                        }
                    });
                    if (legalPlacement) {
                        moves.push(`${cell},${cell2}`);
                    }
                });
            }
        });

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newMove = move;
            const cell = this.getGraph().coords2algebraic(col, row);
            if (!this.board.has(cell)) {
                const oldCells = move.split(",");
                if (oldCells.length == 1) {
                    if (oldCells[0] == "" || this.stack.length == 1) {
                        newMove = cell;
                    } else if (oldCells[0] !== cell) {
                        newMove = move+","+cell;
                    }
                } else if (!oldCells.includes(cell)) {
                    newMove = oldCells[oldCells.length-1]+","+cell;
                }
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
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m == "") {
            result.valid = true;
            result.complete = -1;
            if (this.stack.length == 1) {
                result.message = i18next.t("apgames:validation.bluestone.INITIAL_INSTRUCTIONS_FIRST_TURN");
            } else {
                result.message = i18next.t("apgames:validation.bluestone.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        if (this.moves().includes(m)) {
            result.valid = true;
            result.complete = m.split(",").length == 2 ? 1 : 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        } else {
            result.message = i18next.t("apgames:validation.bluestone.FULL_INSTRUCTIONS");
        }

        return result;
    }

    public move(m: string, { trusted = false } = {}): BluestoneGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) return this;

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        this.results = [];
        if (m !== "pass") {
            const cells = m.split(",");
            for (const cell of cells) {
                let groupId = this.nextgroup;
                const neighbouringGroups: number[] = [];
                const neighbours = this.getGraph().neighbours(cell);
                neighbours.forEach(neighbour => {
                    if (!this.board.has(neighbour)) return;
                    if (this.board.get(neighbour)![0] != this.currplayer) return;
                    const neighbourGroupId = this.board.get(neighbour)![1];
                    if (neighbouringGroups.includes(neighbourGroupId)) return;
                    neighbouringGroups.push(neighbourGroupId);
                });
                if (neighbouringGroups.length == 0) {
                    this.nextgroup++;
                } else {
                    groupId = neighbouringGroups.shift()!;
                    neighbouringGroups.forEach(oldGroup => this.mergeGroup(oldGroup, groupId));
                }
                this.board.set(cell, [this.currplayer, groupId]);
                this.results.push({type: "place", where: cell});
            }
        }

        this.removeDeadGroups();

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.getOtherPlayer(this.currplayer);

        this.updateScores();
        this.checkEOG();
        this.saveState();
        return this;
    }

    private mergeGroup(oldGroup: number, newGroup: number): BluestoneGame {
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

    private getOtherPlayer(player: PlayerId): PlayerId {
        return (player === 1) ? 2 : 1;
    }

    private getGroups(player: PlayerId): number[] {
        const groups: number[] = [];
        const cells = (this.getGraph().listCells() as string[])
            .filter(cell => this.board.has(cell) && this.board.get(cell)![0] == player);
        cells.forEach(cell => {
            if (groups.includes(this.board.get(cell)![1])) return;
            groups.push(this.board.get(cell)![1]);
        });
        return groups;
    }

    private removeDeadGroups(): BluestoneGame {
        const groups: number[] = [];
        const cells = (this.getGraph().listCells() as string[]).filter(cell => this.board.has(cell));
        cells.forEach(cell => {
            if (groups.includes(this.board.get(cell)![1])) return;
            groups.push(this.board.get(cell)![1]);
        });
        groups.forEach(group => {
            this.removeGroupIfDead(group);
        });
        return this;
    }

    private removeGroupIfDead(groupId: number): boolean {
        const groupCells = (this.getGraph().listCells() as string[])
            .filter(cell => this.board.has(cell) && this.board.get(cell)![1] == groupId);
        if (groupCells.length == 0) return false;
        const ownerId: PlayerId = this.board.get(groupCells[0])![0];

        const totalCells: string[] = [...groupCells];
        let currentWave: string[] = [...totalCells];
        let nextWave: string[] = [];
        while (currentWave.length > 0) {
            currentWave.forEach(cell => {
                const neighbours = this.getGraph().neighbours(cell)
                    .filter(neighbour => !this.board.has(neighbour) || this.board.get(neighbour)![0] == ownerId)
                    .filter(neighbour => !totalCells.includes(neighbour));
                neighbours.forEach(neighbour => {
                    nextWave.push(neighbour);
                    totalCells.push(neighbour);
                });
            });
            currentWave = [...nextWave];
            nextWave = [];
        }

        if (this.getBlueStoneCount(totalCells) < 4) {
            groupCells.forEach(cell => {
                this.board.delete(cell);
            });
            this.results.push({type: "capture", where: Array.from(groupCells).join(","), what: "group", count: groupCells.length});
            return true;
        }

        return false;
    }

    // ClaimedRegions are regions that are surrounded by just one color and do not contain 2 non-adjacent edge nodes
    private computeClaimedRegions(): ClaimedRegion[] {
        const claimedRegions: ClaimedRegion[] = [];

        if (this.stack.length < 3) {
            return claimedRegions;
        }

        const exploredCells: string[] = [];
        const emptyCells = (this.listCells() as string[]).filter(c => !this.board.has(c));

        while (exploredCells.length !== emptyCells.length) {
            const claimedRegion: ClaimedRegion = [0, []];
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
                    claimedRegion[1].push(cell);
                    const neighbours = this.getGraph().neighbours(cell);
                    for (const neighbour of neighbours) {
                        if (!this.board.has(neighbour)) {
                            if (!exploredCells.includes(neighbour)) {
                                nextWave.push(neighbour);
                                exploredCells.push(neighbour);
                            }
                        } else {
                            if (this.board.get(neighbour)![0] === 1) {
                                if (claimedRegion[0] === 0) claimedRegion[0] = 1;
                                if (claimedRegion[0] === 2) claimedRegion[0] = 3;
                            } else if (this.board.get(neighbour)![0] === 2) {
                                if (claimedRegion[0] === 0) claimedRegion[0] = 2
                                if (claimedRegion[0] === 1) claimedRegion[0] = 3;
                            }
                        }
                    }
                }
                currentWave = [...nextWave];
                nextWave = [];
            }

            // last check, change the owner to both if the space is big enough
            if (claimedRegion[0] != 3 && this.getBlueStoneCount(claimedRegion[1]) > 3) {
                claimedRegion[0] = 3;
            }

            claimedRegions.push(claimedRegion);
        }

        return claimedRegions;
    }

    private getBlueStoneCount(cells: string[]): number {
        const edgeCells = cells.filter(c => c.startsWith((this.getBoardSize()-1)+"-"));
        let numAdjacent = 0;
        edgeCells.forEach(c => {
            const neighbours = this.getGraph().neighbours(c);
            neighbours.forEach(neighbour => {
                if (edgeCells.includes(neighbour)) numAdjacent++;
            });
        });
        return (edgeCells.length*2) - (numAdjacent/2);
    }

    private scoreGroup(groupId: number): number {
        const cells = (this.getGraph().listCells() as string[])
            .filter(cell => this.board.has(cell) && this.board.get(cell)![1] === groupId);
        return this.getBlueStoneCount(cells);
    }

    private updateScores(): void {
        this.scores = [0,0];
        for (let player = 1; player <= this.numplayers; player++) {
            // Find and sort the groups
            const playerGroups = this.getGroups(player as PlayerId);
            const playerScores: number[] = [];
            playerGroups.forEach(groupId => {
                const score = this.scoreGroup(groupId);
                if (score != 0) playerScores.push(score);
            });
            playerScores.sort((a,b) => b-a);
            this.groupScores[player] = [...playerScores];

            // We use string concat to avoid js nonsense.
            // Show up to the first 5 group scores and call that good enough.
            let scoreString = "";
            for (let i = 0; i < Math.min(5, playerScores.length); i++) {
                if (i == 0) scoreString = playerScores[i].toString();
                else if (i == 1) scoreString += "." + (playerScores[i] < 10 ? "0" : "") + playerScores[i].toString();
                else scoreString += (playerScores[i] < 10 ? "0" : "") + playerScores[i].toString();
            }
            this.scores[player-1] = Number(scoreString);
        }
    }

    protected checkEOG(): BluestoneGame {
        if ((this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass")
                || (this.getGraph().listCells() as string[]).filter(cell => !this.board.has(cell)).length === 0) {
            this.gameover = true;
            for (let i = 0; i < this.groupScores[0].length && i < this.groupScores[1].length; i++) {
                if (this.groupScores[0][i] > this.groupScores[1][i]) {
                    this.winner = [1];
                    break;
                } else if (this.groupScores[1][i] > this.groupScores[0][i]) {
                    this.winner = [2];
                    break;
                }
            }
            if (this.winner.length == 0) {
                if (this.groupScores[0].length > this.groupScores[1].length) {
                    this.winner = [1];
                } else if (this.groupScores[1].length > this.groupScores[0].length) {
                    this.winner = [2];
                } else {
                    this.winner = [1,2];
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

    public getPlayerScore(player: PlayerId): number {
        return this.scores[player-1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public state(): IBluestoneState {
        return {
            game: BluestoneGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BluestoneGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            nextgroup: this.nextgroup,
            scores: [...this.scores],
            groupScores: [...this.groupScores]
        };
    }

    public getPlayerColour(player: PlayerId): number | string {
        return (player === 1) ? "#000" : "#fff";
    }

    public render(): APRenderRep {
        let pstr = "";
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)![0];
                    let key;
                    if (player === 1) {
                        key = "A";
                    } else {
                        key = "B";
                    }
                    pieces.push(key);
                } else {
                    pieces.push("-");
                }

            }
            // If all elements are "-", replace with "_"
            if (pieces.every(p => p === "-")) {
                pieces = ["_"];
            }
            pstr += pieces.join("");
        }
        if (this.boardSize == 6) pstr += "\n-CCCCC-CCCCC-CCCCC-CCCCC-CCCCC";
        else pstr += "\n-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC-CCCCCCC";

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "pentagonal-bluestone",
                width: this.boardSize
            },
            legend: {
                A: [{ name: "piece", colour: this.getPlayerColour(1) }],
                B: [{ name: "piece", colour: this.getPlayerColour(2) }],
                C: [{ name: "piece", colour: 2 }]
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.stack[this.stack.length - 1]._results) {
            if (move.type === "place") {
                const [x, y] = this.getGraph().algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as PlayerId);
            status += `Player ${n}:  ${score}\n\n`;
        }

        return status;
    }

    public clone(): BluestoneGame {
        return new BluestoneGame(this.serialize());
    }

}
