import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";

export type playerid = 1|2;
export type Region = {
    cells: string[],
    owner?: playerid,
    neighbours: Set<Region>,
    neighbourCounts: number[],  // Computed only for empty regions
    alive: boolean              // Valid only for player regions
};

const newRegion = (cells: string[], owner?: playerid) => {
    return {
        cells,
        owner,
        neighbours: new Set<Region>(),
        neighbourCounts: [0,0,0],
        alive: false
    };
}


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ILifelineState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LifelineGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Lifeline",
        uid: "lifeline",
        playercounts: [2],
        version: "1.0",
        dateAdded: "2024-08-29",
        description: "apgames:descriptions.lifeline",
        urls: ["https://boardgamegeek.com/boardgame/358196/lifeline"],
        people: [
            {
                type: "designer",
                name: "Michael Amundsen",
                urls: ["https://boardgamegeek.com/boardgamedesigner/133389/michael-amundsen"],
            },
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"],
            }
        ],
        flags: ["experimental"],
        categories: ["goal>annihilating", "mechanic>place","board>shape>hex"],
        variants: [
            {uid: "size-5", group: "board"},
            {uid: "size-10", group: "board"},
            {uid: "size-12", group: "board"},
        ]
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }
    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 7;
    public graph: HexTriGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public regions!: Region[];
    public cellToRegion!: Map<string, Region>;

    public applyVariants(variants?: string[]) {
        this.variants = (variants !== undefined) ? [...variants] : [];
        for(const v of this.variants) {
            if(v.startsWith("size")) {
                const [,size] = v.split("-");
                this.boardsize = parseInt(size, 10);
                this.graph = this.getGraph();
                break;
            }
        }
    }

    constructor(state?: ILifelineState | string, variants?: string[]) {
        super();
        if (state === undefined) {

            this.applyVariants(variants);

            const fresh: IMoveState = {
                _version: LifelineGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, playerid>(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILifelineState;
            }
            if (state.game !== LifelineGame.gameinfo.uid) {
                throw new Error(`The Lifeline engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.applyVariants(state.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): LifelineGame {
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

        this.updateRegions();

        return this;
    }

    public isFirstTurn(): boolean {
        return this.stack.length <= 2;
    }

    public getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, this.boardsize * 2 - 1);
    }

    public updateRegions() {

        // Find all regions on the board

        const emptyGraph = this.getGraph();
        const p1Graph = this.getGraph();
        const p2Graph = this.getGraph();

        for (const cell of this.graph.graph.nodes()) {
            const owner = this.board.get(cell);
            if (owner !== undefined) { emptyGraph.graph.dropNode(cell); }
            if (owner !== 1) { p1Graph.graph.dropNode(cell); }
            if (owner !== 2) { p2Graph.graph.dropNode(cell); }
        }

        const regions = [
            ...connectedComponents(emptyGraph.graph).map(r => newRegion(r, undefined)),
            ...connectedComponents(p1Graph.graph).map(r => newRegion(r, 1)),
            ...connectedComponents(p2Graph.graph).map(r => newRegion(r, 2))
        ];

        // Map cells to regions

        const cellToRegion = new Map<string, Region>();
        for (const region of regions) {
            for (const cell of region.cells) {
                cellToRegion.set(cell, region);
            }
        }

        // Find neighbouring regions
        // Precompute the counts of adjacent player regions for empty ones

        for (const region of regions) {
            for (const cell of region.cells) {
                for (const neighbour of this.graph.neighbours(cell)) {
                    const neighbourRegion = cellToRegion.get(neighbour)!;

                    if (neighbourRegion !== region) {
                        region.neighbours.add(neighbourRegion);
                        neighbourRegion.neighbours.add(region);
                    }
                }
            }

            if (region.owner === undefined) {
                for (const neighbour of region.neighbours) {
                    if (neighbour.owner !== undefined) {
                        region.neighbourCounts[neighbour.owner]++;
                    }
                }
            }
        }

        // Mark alive groups: a group of player stones is alive iff:
        // It has a neighbouring empty region which itself has at least 2
        // neighbour groups belonging to that player (the one we're checking,
        // and at least another).

        for (const region of regions) {
            if (region.owner === undefined) { continue; }

            region.alive = false;
            for(const neighbour of region.neighbours) {
                if (neighbour.owner === undefined && neighbour.neighbourCounts[region.owner] >= 2) {
                    region.alive = true;
                    break;
                }
            }
        }

        this.cellToRegion = cellToRegion;
        this.regions = regions;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const empties = (this.graph.listCells(false) as string[]).filter(c => !this.board.has(c));

        let moves = [...empties];

        if (this.isFirstTurn()) {
            moves = moves
                .flatMap(c => empties.map(e => [c,e]))
                .filter(m => m[0] !== m[1])
                .map(m => m.join(","));
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const newcell = this.coords2algebraic(col, row);
            let cells = (move === "") ? [] : move.split(",");

            if (this.isFirstTurn() && cells.length < 2) {
                cells.push(newcell);
            } else {
                cells = [newcell];
            }

            const newmove = cells.join(",");
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
            result.message = i18next.t("apgames:validation.lifeline.INITIAL_INSTRUCTIONS")
            return result;
        }

        const cells = m.split(",");

        for (const cell of cells) {

            if (!this.graph.graph.hasNode(cell)) {

                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result
            }

            if (this.board.has(cell)) {

                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NON_EMPTY", {cell});
                return result;
            }

            // TODO: incursions forbidden
        }

        if (this.isFirstTurn() && cells.length === 1) {

            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.lifeline.SECOND_PIECE")
            return result;

        } else if (cells.length > (this.isFirstTurn() ? 2 : 1)) {

            result.valid = false;
            result.message = i18next.t("apgames:validation.lifeline.TOO_MANY_PIECES");
            return result;
        }

        // Looks good

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): LifelineGame {
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
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        this.results = [];

        const cells = m.split(",");

        for(const cell of cells) {
            this.board.set(cell, this.currplayer);
            this.results.push({type: "place", where: cell});
        }

        if (partial) { return this; }

        this.updateRegions();

        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): LifelineGame {
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ILifelineState {
        return {
            game: LifelineGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LifelineGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {

        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                const piece: string[] = [];
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;
                    piece.push(player === 1 ? "A" : "B");
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: this.boardsize * 2 - 1
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
            pieces: pstr as [string[][], ...string[][][]]
        };

        return rep;
    }

    /**
     * This function is only for the local playground.
     */
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
            case "move":
                resolved = true;
                break;
        }
        return resolved;
    }

    /**
     * Just leave this. You very, very rarely need to do anything here.
     */
    public clone(): LifelineGame {
        return new LifelineGame(this.serialize());
    }
}
