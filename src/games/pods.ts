import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

type Player = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: Player;
    board: Map<string, Player>;
    influenceBoard: Map<string, Player>;
    lastmove?: string;
    scores: [number, number];
};

export interface IPodsState extends IAPGameState {
    winner: Player[];
    stack: Array<IMoveState>;
};

export class PodsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Natal Seas - Pods",
        uid: "pods",
        playercounts: [2],
        version: "20240802",
        dateAdded: "2024-08-02",
        // i18next.t("apgames:descriptions.pods")
        description: "apgames:descriptions.pods",
        urls: ["https://cjffield.com/rules/pods.pdf"],
        people: [
            {
                type: "designer",
                name: "Dale Walton",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1988/dale-walton"]
            }
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>move", "mechanic>enclose", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["scores", "automove", "experimental"],
        displays: [{uid: "hide-influence"}]
    };

    public version = parseInt(PodsGame.gameinfo.version, 10);
    public numplayers = 2;
    public currplayer: Player = 1;
    public board!: Map<string, Player>;
    public influenceBoard!: Map<string, Player>;
    public boardsize = 7;
    public graph?: HexTriGraph;
    public gameover = false;
    public winner: Player[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    public _points: [number, number][] = [];

    constructor(state?: IPodsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: PodsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, Player>(),
                influenceBoard: new Map<string, Player>(),
                scores: [0, 0]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPodsState;
            }
            if (state.game !== PodsGame.gameinfo.uid) {
                throw new Error(`The Pods engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.buildGraph();
    }

    public load(idx = -1): PodsGame {
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
        this.board = deepclone(state.board) as Map<string, Player>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this.influenceBoard = deepclone(state.influenceBoard) as Map<string, Player>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
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

    // Influence of _one_ player including implied influence
    private getImpliedInfluence(player: Player, cell: string, board: Map<string, Player>, influenceBoard: Map<string, Player>): number {
        let influence = 0;
        const neighbours = this.getGraph().neighbours(cell);
        for (const neighbour of neighbours) {
            if ((board.has(neighbour) && board.get(neighbour) === player) ||
                    (influenceBoard.has(neighbour) && influenceBoard.get(neighbour) === player)) {
                influence++;
            }
        }
        return influence;
    }

    // Influence of _both_ players but assumes all empty spaces with no influence are owned by the opponent and only real allies contribute
    private getNegativeInfluence(player: Player, cell: string, board: Map<string, Player>, influenceBoard: Map<string, Player>): number {
        let influence = 0;
        const neighbours = this.getGraph().neighbours(cell);
        for (const neighbour of neighbours) {
            if (!board.has(neighbour) && !influenceBoard.has(neighbour)) {
                influence--;
            } else if (board.has(neighbour)) {
                if (board.get(neighbour) === player) {
                    influence++;
                } else {
                    influence--;
                }
            } else if (influenceBoard.has(neighbour) && influenceBoard.get(neighbour) !== player) {
                influence--;
            }
        }
        return influence;
    }

    // Returns whether an enemy can swivel into this position assuming that the influence allows it
    private hasHinge(player: Player, cell: string, board: Map<string, Player>, influenceBoard: Map<string, Player>): boolean {
        const cellNeighbours = this.getGraph().neighbours(cell);
        for (const cellNeighbour of cellNeighbours) {
            const coNeighbours = this.getGraph().neighbours(cellNeighbour).filter(c => cellNeighbours.includes(c));
            for (const coNeighbour of coNeighbours) {
                const isFirstEmptyOrEnemy = (!board.has(cellNeighbour) && !influenceBoard.has(cellNeighbour)) ||
                        (board.has(cellNeighbour) && board.get(cellNeighbour) !== player) ||
                        (influenceBoard.has(cellNeighbour) && influenceBoard.get(cellNeighbour) !== player);
                const isSecondEmptyOrEnemy = (!board.has(coNeighbour) && !influenceBoard.has(coNeighbour)) ||
                        (board.has(coNeighbour) && board.get(coNeighbour) !== player) ||
                        (influenceBoard.has(coNeighbour) && influenceBoard.get(coNeighbour) !== player);
                const isFirstRealAlly = board.has(cellNeighbour) && board.get(cellNeighbour) === player;
                const isSecondRealAlly = board.has(coNeighbour) && board.get(coNeighbour) === player;
                if ((isFirstEmptyOrEnemy && isSecondEmptyOrEnemy) ||
                        (isFirstEmptyOrEnemy && isSecondRealAlly) ||
                        (isFirstRealAlly && isSecondEmptyOrEnemy)) {
                    return true;
                }
            }
        }
        return false;
    }

    // Influence of _both_ players to compare them using only pieces
    private getRealInfluence(player: Player, cell: string, board: Map<string, Player>): number {
        let influence = 0;
        const neighbours = this.getGraph().neighbours(cell);
        for (const neighbour of neighbours) {
            if (board.has(neighbour)) {
                if (board.get(neighbour) === player) {
                    influence++;
                } else {
                    influence--;
                }
            }
        }
        return influence;
    }

    private getNextSteps(player: Player, cell: string, board: Map<string, Player>): string[] {
        const ret: string[] = [];
        const emptyNeighbours = this.getGraph().neighbours(cell).filter(c => !board.has(c));
        const neighbours = this.getGraph().neighbours(cell).filter(c => board.has(c));
        for (const neighbour of neighbours) {
            const emptyCoNeighbours = this.getGraph().neighbours(neighbour).filter(c => emptyNeighbours.includes(c));
            for (const emptyCoNeighbour of emptyCoNeighbours) {
                if (this.getRealInfluence(player, emptyCoNeighbour, board) > -2) {
                    ret.push(emptyCoNeighbour);
                }
            }
        }
        return ret;
    }

    private getSteps(player: Player, cell: string, board: Map<string, Player>): string[] {
        if (!board.has(cell)) return [];

        const walkedSteps: string[] = [];
        const cellPlayer = board.get(cell)!;
        board.delete(cell);

        let futureSteps = this.getNextSteps(player, cell, board);
        let nextFutureSteps: string[] = [];
        while (futureSteps.length > 0) {
            for (const step of futureSteps) {
                walkedSteps.push(step);
                const newSteps = this.getNextSteps(player, step, board);
                for (const newStep of newSteps) {
                    if (!walkedSteps.includes(newStep) && !futureSteps.includes(newStep) && !nextFutureSteps.includes(newStep)) {
                        nextFutureSteps.push(newStep);
                    }
                }
            }
            futureSteps = nextFutureSteps;
            nextFutureSteps = [];
        }

        board.set(cell, cellPlayer);
        return walkedSteps;
    }

    public moves(player?: Player): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const emptyCells = (this.listCells() as string[]).filter(c => !this.board.has(c));
        const playerCells = (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c) === player);

        if (playerCells.length > 0) {
            for (const cell of emptyCells) {
                if (this.getRealInfluence(player, cell, this.board) > 0) {
                    moves.push(cell);
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const boardClone = deepclone(this.board) as Map<string, Player>;
            for (const cell of playerCells) {
                const steps = this.getSteps(player, cell, boardClone);
                for (const step of steps) {
                    if (cell !== step) moves.push(`${cell}-${step}`);
                }
            }
        } else {
            moves.push(...emptyCells);
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        if (moves.length === 0) return "";
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // We only need to handle re-setting moves from positions that are not complete moves, like movement.
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        if (this.gameover) return { move, valid: false, message: i18next.t("apgames:MOVES_GAMEOVER") };
        try {
            const cell = this.getGraph().coords2algebraic(col, row);
            if (move === cell) return { move: "", valid: true, message: i18next.t("apgames:validation.pods.INITIAL_INSTRUCTIONS") };
            const newMove = (move === "" || (this.board.has(cell) && this.board.get(cell) === this.currplayer)) ? cell : move+"-"+cell;
            const result = this.validateMove(newMove) as IClickResult;
            result.move = (result.valid) ? newMove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, complete: -1, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.gameover) {
            if (m.length === 0) {
                result.message = "";
            } else {
                result.message = i18next.t("apgames:MOVES_GAMEOVER");
            }
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            if (this.stack.length > 2) {
                result.message = i18next.t("apgames:validation.pods.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.pods.FIRST_MOVE_INSTRUCTIONS");
            }
            return result;
        }

        const moves = this.moves();
        const cells: string[] = m.split("-");
        if (cells.length > 2) {
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        for (const cell of cells) {
            try {
                this.getGraph().algebraic2coords(cell);
            } catch (e) {
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
        }

        if (moves.includes(m)) {
            result.valid = true;
            result.canrender = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        } else if (cells.length === 2) {
            result.message = i18next.t("apgames:validation.pods.INVALID_MOVEMENT");
        } else if (moves.filter(move => move.startsWith(m)).length > 0) {
            result.valid = true;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.pods.INITIAL_INSTRUCTIONS");
        } else if (!this.board.has(cells[0])) {
            result.message = i18next.t("apgames:validation.pods.INVALID_PLACEMENT");
        } else {
            result.message = i18next.t("apgames:validation.pods.INVALID_MOVER");
        }

        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): PodsGame {
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

        this._points = [];
        if (partial && !m.includes("-") && this.board.has(m)) {
            this._points = this.findPoints(m);
            return this;
        }

        const cells: string[] = m.split("-");
        if (cells.length === 1) {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
        } else if (cells.length === 2) {
            this.board.delete(cells[0]);
            this.board.set(cells[1], this.currplayer);
            this.results.push({type: "move", from: cells[0], to: cells[1]});
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;

        this.updateInfluenceBoard();
        this.updateScore();
        this.checkEOG();
        this.saveState();

        return this;
    }

    private findPoints(cell: string): [number, number][] {
        const points: [number, number][] = [];
        const moves = this.moves().filter(m => m.startsWith(cell));
        for (const move of moves) {
            const cells = move.split("-");
            points.push(this.getGraph().algebraic2coords(cells[1]));
        }
        return points;
    }

    private updateInfluenceBoard(): PodsGame {
        const otherPlayer = this.currplayer === 1 ? 2 : 1;
        this.influenceBoard = new Map<string, Player>();
        let influenceSize = 0;

        let shouldContinue = true;
        while (shouldContinue) {
            const cells = (this.listCells() as string[]).filter(c => !this.board.has(c) && !this.influenceBoard.has(c));
            for (const cell of cells) {
                const playerInfluence = this.getImpliedInfluence(this.currplayer, cell, this.board, this.influenceBoard);
                const otherInfluence = this.getImpliedInfluence(otherPlayer, cell, this.board, this.influenceBoard);
                const neighbourThreshold = this.getGraph().neighbours(cell).length/2;
                if (playerInfluence > otherInfluence && playerInfluence >= neighbourThreshold) {
                    this.influenceBoard.set(cell, this.currplayer);
                }
                if (otherInfluence > playerInfluence && otherInfluence >= neighbourThreshold) {
                    this.influenceBoard.set(cell, otherPlayer);
                }
            }
            if (influenceSize === this.influenceBoard.size) shouldContinue = false;
            influenceSize = this.influenceBoard.size;
        }

        shouldContinue = true;
        while (shouldContinue) {
            const cells = (this.listCells() as string[]).filter(c => this.influenceBoard.has(c));
            for (const cell of cells) {
                const player = this.influenceBoard.get(cell)!;
                const negativeInfluence = this.getNegativeInfluence(player, cell, this.board, this.influenceBoard);
                if (negativeInfluence < 0) this.influenceBoard.delete(cell);
                if (negativeInfluence === 0 && this.hasHinge(player, cell, this.board, this.influenceBoard)) this.influenceBoard.delete(cell);
            }
            if (influenceSize === this.influenceBoard.size) shouldContinue = false;
            influenceSize = this.influenceBoard.size;
        }

        return this;
    }

    private updateScore(): PodsGame {
        this.scores[0] = 0;
        this.scores[1] = 0;

        for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c))) {
            if (this.board.get(cell) === 1) {
                this.scores[0]++;
            } else {
                this.scores[1]++;
            }
        }
        for (const cell of (this.listCells() as string[]).filter(c => this.influenceBoard.has(c))) {
            if (this.influenceBoard.get(cell) === 1) {
                this.scores[0]++;
            } else {
                this.scores[1]++;
            }
        }
        return this;
    }

    private checkEOG(): PodsGame {
        const scoreThreshold = this.listCells().length/2;
        if (this.scores[0] > scoreThreshold || this.scores[1] > scoreThreshold) {
            this.gameover = true;
            this.winner = this.scores[0] > this.scores[1] ? [1] : this.scores[0] < this.scores[1] ? [2] : [1, 2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IPodsState {
        return {
            game: PodsGame.gameinfo.uid,
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            board: deepclone(this.board) as Map<string, Player>,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            influenceBoard: deepclone(this.influenceBoard) as Map<string, Player>,
            scores: [...this.scores]
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const displayHighlights = (opts === undefined || opts.altDisplay === undefined || opts.altDisplay !== "hide-influence");
        const pstr: string[][] = [];
        const cells = this.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    if (this.board.get(cell) === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else if (displayHighlights && this.influenceBoard.has(cell)) {
                    if (this.influenceBoard.get(cell) === 1) {
                        pieces.push("C");
                    } else {
                        pieces.push("D");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        let markers: Array<any> = [];
        if (this.gameover) {
            let colour1 = 1;
            let colour2 = 2;
            if (this.winner.length === 1 && this.winner[0] === 2) {
                colour1 = 2;
            } else if (this.winner.length === 1 && this.winner[0] === 1) {
                colour2 = 1;
            }
            markers = [
                { type: "edge", edge: "N", colour: colour1 },
                { type: "edge", edge: "NW", colour: colour1 },
                { type: "edge", edge: "NE", colour: colour1 },
                { type: "edge", edge: "S", colour: colour2 },
                { type: "edge", edge: "SW", colour: colour2 },
                { type: "edge", edge: "SE", colour: colour2 }
           ];
        }

        const rep: APRenderRep = {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
                markers: markers.length === 0 ? undefined : markers
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "ring-01", colour: 1}],
                D: [{ name: "ring-01", colour: 2}]
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.getGraph().algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [x1, y1] = this.getGraph().algebraic2coords(move.from);
                    const [x2, y2] = this.getGraph().algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{col: x1, row: y1}, {col: x2, row: y2}]});
                }
            }
        }
        if (this._points.length > 0) {
            const points = [];
            for (const cell of this._points) {
                points.push({row: cell[1], col: cell[0]});
            }
            rep.annotations = [{type: "enter", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]}];
        }
        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    public getPlayerScore(player: Player): number {
        return this.scores[player-1];
    }

    public getPlayersScores(): IScores[] {
        return [{
            name: i18next.t("apgames:status.SCORES"),
            scores: [this.scores[0], this.scores[1]]
        }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `**Scores**: ${this.getPlayerScore(1)}-${this.getPlayerScore(2)} \n\n`;

        return status;
    }

    public clone(): PodsGame {
        return new PodsGame(this.serialize());
    }
}
