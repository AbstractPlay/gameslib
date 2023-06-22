/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type CellContents = "b"|"w";

interface IStageBoard {
    board: Map<string, CellContents>;
    highlights: string[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    stages: IStageBoard[];
    lastmove?: string;
    scores: [number,number];
    ravenclaw: playerid|undefined;
    pool: number;
};

export interface IGardenState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const lines: string[][] = [
    ["a4", "b4", "c4", "d4"],
    ["a3", "b3", "c3", "d3"],
    ["a2", "b2", "c2", "d2"],
    ["a1", "b1", "c1", "d1"],
    ["a1", "a2", "a3", "a4"],
    ["b1", "b2", "b3", "b4"],
    ["c1", "c2", "c3", "c4"],
    ["d1", "d2", "d3", "d4"],
    ["a1", "b2", "c3", "d4"],
    ["a4", "b3", "c2", "d1"]
];

interface IKeyEntry {
    piece: string;
    name: string;
    value?: string;
}

interface IKey {
    [k: string]: unknown;
    type: "key";
    list: IKeyEntry[];
    height?: number;
    buffer?: number;
    position?: "left"|"right";
    clickable?: boolean;
}

export class GardenGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Wizard's Garden",
        uid: "garden",
        playercounts: [2],
        version: "20230619",
        // i18next.t("apgames:descriptions.garden")
        description: "apgames:descriptions.garden",
        urls: ["http://www.tjgames.com/wizard.html", "https://boardgamegeek.com/boardgame/13077/wizards-garden"],
        people: [
            {
                type: "designer",
                name: "Tim Schutz",
                urls: ["http://www.tjgames.com/"]
            },
        ],
        flags: ["experimental", "shared-pieces", "scores"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 4);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 4);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public stages: IStageBoard[] = [];
    public scores: [number,number] = [0,0];
    public ravenclaw: playerid|undefined = undefined;
    public pool = 16;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IGardenState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const fresh: IMoveState = {
                _version: GardenGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stages: [],
                scores: [0,0],
                ravenclaw: undefined,
                pool: 16
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGardenState;
            }
            if (state.game !== GardenGame.gameinfo.uid) {
                throw new Error(`The Wizard's Garden engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GardenGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.stages = deepclone(state.stages) as IStageBoard[];
        this.scores = [...state.scores];
        this.pool = state.pool;
        this.ravenclaw = state.ravenclaw;
        this.lastmove = state.lastmove;
        return this;
    }

    public moves(): string[] {
        if ( (this.gameover) || (this.pool === 0) ) { return []; }
        const moves: string[] = [];
        const grid = new RectGrid(4,4);

        // If first four turns, find empty spaces with no adjacent pieces
        if (this.stack.length < 5) {   // initial pos + four turns
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const cell = GardenGame.coords2algebraic(x, y);
                    if (! this.board.has(cell)) {
                        const neighbours = grid.adjacencies(x, y, false).map(node => GardenGame.coords2algebraic(...node));
                        let hasNeighbour = false;
                        for (const n of neighbours) {
                            if (this.board.has(n)) {
                                hasNeighbour = true;
                                break;
                            }
                        }
                        if (! hasNeighbour) {
                            moves.push(`${cell}b`);
                            moves.push(`${cell}w`);
                        }
                    }
                }
            }
        // After that, find empty spaces around existing pieces
        } else {
            for (const cell of this.board.keys()) {
                const [fx, fy] = GardenGame.algebraic2coords(cell);
                const neighbours = grid.adjacencies(fx, fy, false).map(node => GardenGame.coords2algebraic(...node));
                for (const n of neighbours) {
                    if (! this.board.has(n)) {
                        moves.push(`${n}b`);
                        moves.push(`${n}w`);
                    }
                }
            }
        }

        return moves.sort((a, b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (row === -1 && col === -1) {
                if (move.length === 2) {
                    newmove = `${move}${piece}`;
                } else if (move.length === 3) {
                    newmove = `${move.slice(0, move.length - 1)}${piece}`;
                } else {
                    newmove = piece!;
                }
            } else {
                // Don't accept clicks outside the bottom-right board
                if ( (col < 4) || (row < 4) ) {
                    return {move: "", message: i18next.t("apgames:validation.garden.WRONG_BOARD")} as IClickResult;
                }
                const cell = GardenGame.coords2algebraic(col - 4, row - 4);
                // If you click on an occupied cell, clear the entry
                if (this.board.has(cell)) {
                    return {move: "", message: ""} as IClickResult;
                }
                if (move.length > 0) {
                    if (move.length === 1) {
                        newmove = cell + move;
                    } else {
                        const prev = move.slice(0, move.length - 1);
                        const colour = move[move.length - 1];
                        if (prev === cell) {
                            if (colour === "w") {
                                newmove = `${cell}b`;
                            } else {
                                newmove = `${cell}w`;
                            }
                        } else {
                            newmove = `${cell}w`;
                        }
                    }
                } else {
                    newmove = `${cell}w`;
                }
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
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        let mode: "normal"|"start" = "normal";
        if (this.stack.length < 5) {
            mode = "start";
        }
        const grid = new RectGrid(4,4);
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.garden.INITIAL_INSTRUCTIONS", {context: mode});
            return result;
        }

        let colour: string|undefined;
        let cell: string|undefined;
        if (m.length === 1) {
            colour = m;
        } else if (m.length === 2) {
            cell = m;
        } else if (m.length === 3) {
            cell = m[0] + m[1];
            colour = m[2];
        } else {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if (colour !== undefined) {
            if ( (colour !== "b") && (colour !== "w") ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.garden.INVALID_COLOUR", {colour});
                return result;
            }
        }

        if (cell !== undefined) {
            // it's a valid cell
            try {
                GardenGame.algebraic2coords(m);
            } catch {
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

            // check adjacencies
            const [x, y] = GardenGame.algebraic2coords(m);
            const neighbours = grid.adjacencies(x, y, false).map(node => GardenGame.coords2algebraic(...node));
            let hasNeighbour = false;
            for (const n of neighbours) {
                if (this.board.has(n)) {
                    hasNeighbour = true;
                    break;
                }
            }

            if ( ( (mode === "start") && (hasNeighbour) ) || ( (mode === "normal") && (! hasNeighbour) ) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.garden.BAD_PLACE", {context: mode});
                return result;
            }
        }

        if ( (colour !== undefined) && (cell !== undefined) ) {
            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else if (colour === undefined) {
            // good partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.garden.SELECT_COLOUR");
            return result;
        } else {
            // good partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.garden.SELECT_CELL", {context: mode});
            return result;
        }
    }

    public move(m: string): GardenGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];
        this.stages = [];
        const cell = m[0] + m[1];
        const colour = m[2] as CellContents;

        // place the piece
        this.board.set(cell, colour);
        this.pool--;
        this.results.push({type: "place", what: colour, where: cell});
        this.stages.push({
            board: new Map(this.board),
            highlights: [cell]
        });

        // flip neighbours
        const grid = new RectGrid(4,4);
        const [x, y] = GardenGame.algebraic2coords(cell);
        const neighbours = grid.adjacencies(x, y, false).map(node => GardenGame.coords2algebraic(...node));
        const flipped: string[] = [];
        for (const n of neighbours) {
            if (this.board.has(n)) {
                flipped.push(n);
                const contents = this.board.get(n)!;
                if (contents === "b") {
                    this.board.set(n, "w");
                } else {
                    this.board.set(n, "b");
                }
            }
        }
        this.stages.push({
            board: new Map(this.board),
            highlights: [...flipped]
        });

        // harvest
        let harvests = 0;
        let ravenclaw = false;
        const removed = new Set<string>();
        for (const line of lines) {
            let same = true;
            for (let i = 1; i < line.length; i++) {
                const prev = line[i - 1];
                const curr = line[i];
                if ( (! this.board.has(prev)) || (! this.board.has(curr)) ) {
                    same = false;
                    break;
                }
                if (this.board.get(prev)! !== this.board.get(curr)!) {
                    same = false;
                    break;
                }
            }
            if (same) {
                harvests++;
                line.forEach(item => removed.add(item));
                if (this.board.get(line[0])! === "b") {
                    ravenclaw = true;
                }
            }
        }
        if (harvests > 0) {
            // remove pieces
            for (const harvested of removed) {
                this.results.push({type: "take", from: harvested, what: this.board.get(harvested)!});
                this.board.delete(harvested);
            }
            // set ravenclaw
            if (ravenclaw) {
                this.ravenclaw = this.currplayer;
            }
            // increase score
            this.scores[this.currplayer - 1] += harvests;
            this.results.push({type: "deltaScore", delta: harvests});
            // add pieces back to pool
            this.pool += removed.size - harvests;
        }
        this.stages.push({
            board: new Map(this.board),
            highlights: [...removed]
        });

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

    protected checkEOG(): GardenGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score2 > score1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public getPlayerScore(player: number): number {
        let score = this.scores[player - 1];
        if ( (this.ravenclaw !== undefined) && (this.ravenclaw === player) ) {
            score += 0.1;
        }
        return score;
    }

    public state(): IGardenState {
        return {
            game: GardenGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: GardenGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            stages: deepclone(this.stages) as IStageBoard[],
            scores: [...this.scores],
            ravenclaw: this.ravenclaw,
            pool: this.pool,
        };
    }

    public render(): APRenderRep {
        // initialize stages if they're empty
        if (this.stages.length === 0) {
            while (this.stages.length < 3) {
                this.stages.push({
                    board: new Map<string, CellContents>(),
                    highlights: []
                });
            }
        }
        // convert each stage into its own piece string
        const stages: string[] = [];
        for (const stage of [...this.stages, {board: this.board, highlights: []}]) {
            // eslint-disable-next-line @typescript-eslint/no-shadow
            let pstr = "";
            for (let row = 0; row < 4; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                for (let col = 0; col < 4; col++) {
                    const cell = GardenGame.coords2algebraic(col, row);
                    if (stage.board.has(cell)) {
                        pstr += stage.board.get(cell)!.toUpperCase();
                    } else {
                        pstr += "-";
                    }
                }
            }
            stages.push(pstr);
        }
        if (stages.length !== 4) {
            throw new Error("Wrong number of stage boards provided.");
        }

        // Build combined piece string
        let pstr = "";
        for (const [left, right] of [[stages[0], stages[1]], [stages[2], stages[3]]]) {
            const leftArr = left.split("\n");
            const rightArr = right.split("\n");
            for (let i = 0; i < leftArr.length; i++) {
                pstr += leftArr[i] + rightArr[i] + "\n";
            }
        }
        pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-labels"],
            board: {
                style: "squares",
                width: 8,
                height: 8,
                tileWidth: 4,
                tileHeight: 4,
                tileSpacing: 1.25
            },
            legend: {
                B: {
                    name: "piece",
                    colour: "#000",
                    opacity: 0.5
                },
                W: {
                    name: "piece",
                    colour: "#fff"
                }
            },
            pieces: pstr
        };

        // Add key so the user can click to select the color to place
        const key: IKey = {
            type: "key",
            position: "left",
            height: 0.7,
            list: [{ piece: "W", name: "", value: "w"}, { piece: "B", name: "", value: "b"}],
            clickable: true
        };
        rep.areas = [key];

        // Add annotations
        const coords: {col: number; row: number}[] = [];
        for (let i = 0; i < this.stages.length; i++) {
            const stage = this.stages[i];
            for (const cell of stage.highlights) {
                let [x, y] = GardenGame.algebraic2coords(cell);
                if (i === 1) {
                    x += 4;
                } else if (i === 2) {
                    y += 4;
                }
                coords.push({col: x, row: y});
            }
        }
        if (coords.length > 0) {
            rep.annotations = [
                {
                    type: "enter",
                    targets: [...coords] as [{col: number; row: number}, ...{col: number; row: number}[]]
                },
            ];
        }

        return rep;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**: " + this.getPlayerScore(1).toString() + ", " + this.getPlayerScore(2).toString() + "\n\n";
        status += "**Pieces remaining**: " + this.pool.toString() + "\n\n";

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["place", "take", "deltaScore"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                let what = "dovetail";
                if (r.what! === "b") {
                    what = "ravenclaw";
                }
                node.push(i18next.t("apresults:PLACE.complete", {player, where: r.where, what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): GardenGame {
        return new GardenGame(this.serialize());
    }
}
