/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type Player = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: Player;
    board: Map<string, Player>;
    lastmove?: string;
    scores: [number, number];
};

export interface IControlState extends IAPGameState {
    winner: Player[];
    stack: Array<IMoveState>;
};

export class ControlGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Control",
        uid: "control",
        playercounts: [2],
        version: "20240909",
        dateAdded: "2024-09-14",
        // i18next.t("apgames:descriptions.control")
        description: "apgames:descriptions.control",
        urls: ["https://boardgamegeek.com/boardgame/418399/control"],
        people: [
            {
                type: "designer",
                name: "Takuro Kawasaki",
                urls: ["https://boardgamegeek.com/boardgamedesigner/150765/takuro-kawasaki"]
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>capture", "board>shape>hex"],
        flags: ["scores", "automove"],
        variants: [
            {
                uid: "size-5",
                group: "board",
                default: true,
            },
            { uid: "#board" },
            {
                uid: "size-9",
                group: "board"
            }
        ],
        displays: [{uid: "hide-control"}, {uid: "vertex-style"}],
    };

    public numplayers = 2;
    public currplayer: Player = 1;
    public board!: Map<string, Player>;
    public graph?: HexTriGraph;
    public gameover = false;
    public winner: Player[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    private boardSize = 0;

    constructor(state?: IControlState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const board: Map<string, Player> = new Map();
            const fresh: IMoveState = {
                _version: ControlGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: [0, 0]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IControlState;
            }
            if (state.game !== ControlGame.gameinfo.uid) {
                throw new Error(`The Control engine cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): ControlGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ((idx < 0) || (idx >= this.stack.length)) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.scores = [...state.scores];
        return this;
    }

    private buildGraph(): HexTriGraph {
        this.graph = new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
        return this.graph;
    }

    private getGraph(boardSize?: number): HexTriGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new HexTriGraph(boardSize, (boardSize * 2) - 1);
        }
    }

    // Fixes known issue with some edge cases not calling load
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

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
        }
        return 7;
    }

    private otherPlayer(player?: Player): Player {
        if (player === undefined) {
            player = this.currplayer;
        }
        const otherPlayer = (player as number) + 1;
        if (otherPlayer > this.numplayers) return 1;
        return otherPlayer as Player;
    }

    public moves(player?: Player): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        if (this.stack.length === 1) {
            for (const cell of (this.listCells() as string[]).filter(c => this.getGraph().neighbours(c).length < 6)) {
                moves.push(`${cell}`);
            }
        } else {
            for (const cell of this.listCells() as string[]) {
                const allyNeighbourCount = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === player).length;
                const enemyNeighbourCount = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === this.otherPlayer(player)).length;
                if (this.board.has(cell) && this.board.get(cell) === this.otherPlayer(player) && allyNeighbourCount > enemyNeighbourCount) {
                    moves.push(`${cell}x`);
                }
                if (!this.board.has(cell) && allyNeighbourCount >= enemyNeighbourCount) {
                    moves.push(`${cell}`);
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        if (moves.length === 0) return "";
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        if (this.gameover) {
            return {
                valid: false,
                complete: -1,
                move: "",
                message: i18next.t("apgames:MOVES_GAMEOVER")
            };
        }

        try {
            const newMove = this.getGraph().coords2algebraic(col, row);
            const result = this.validateMove(newMove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                if (this.board.has(newMove)) result.move = `${newMove}x`;
                else result.move = newMove;
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
        if (m.endsWith('x')) m = m.substring(0, m.length-1);

        const result: IValidationResult = {valid: false, complete: -1, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.gameover) {
            result.message = "";
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.control.FIRST_TURN_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.control.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        if (!(this.listCells() as string[]).includes(m)) {
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }

        if (this.stack.length === 1 && this.getGraph().neighbours(m).length === 6) {
            result.message = i18next.t("apgames:validation.control.FIRST_TURN_INSTRUCTIONS");
            return result;
        }

        if (this.board.has(m) && this.board.get(m) === this.currplayer) {
            result.message = i18next.t("apgames:validation.control.INITIAL_INSTRUCTIONS");
            return result;
        }

        const allyNeighbourCount = this.getGraph().neighbours(m).filter(c => this.board.has(c) && this.board.get(c) === this.currplayer).length;
        const enemyNeighbourCount = this.getGraph().neighbours(m).filter(c => this.board.has(c) && this.board.get(c) === this.otherPlayer()).length;

        if (this.board.has(m) && this.board.get(m) === this.otherPlayer() && allyNeighbourCount <= enemyNeighbourCount) {
            result.message = i18next.t("apgames:validation.control.INSUFFICIENT_CONTROL", {cell: m});
            return result;
        }

        if (!this.board.has(m) && enemyNeighbourCount > allyNeighbourCount) {
            result.message = i18next.t("apgames:validation.control.OPPONENT_CONTROL", {cell: m});
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): ControlGame {
        if (m.length === 0 || this.gameover) return this;

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        let originalMove = m;
        if (m.endsWith('x')) m = m.substring(0, m.length-1);

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            const moves = this.moves();
            if (!partial && !moves.includes(m) && !moves.includes(`${m}x`)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: originalMove}));
            }
        }

        this.results = [];
        if (this.board.has(m)) {
            if (!originalMove.endsWith('x')) originalMove = `${originalMove}x`;
            this.results.push({type: "capture", where: m});
            this.board.delete(m);
        } else {
            this.results.push({type: "place", where: m});
            this.board.set(m, this.currplayer);
        }

        this.lastmove = originalMove;
        this.currplayer = this.otherPlayer();
        this.updateScores();
        this.checkEOG();
        this.saveState();
        return this;
    }

    private updateScores(): void {
        this.scores = [0, 0];
        for (const cell of (this.listCells() as string[]).filter(c => !this.board.has(c))) {
            const firstPlayerNeighbourCount = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === 1).length;
            const secondPlayerNeighbourCount = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === 2).length;
            if (firstPlayerNeighbourCount > secondPlayerNeighbourCount) {
                this.scores[0]++;
            }
            if (secondPlayerNeighbourCount > firstPlayerNeighbourCount) {
                this.scores[1]++;
            }
        }
    }

    protected checkEOG(): ControlGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [this.otherPlayer()];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public getPlayerScore(player: Player): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{
            name: i18next.t("apgames:status.control.CONTROLLED_SPACES"),
            scores: [this.getPlayerScore(1), this.getPlayerScore(2)]
        }]
    }

    public state(): IControlState {
        return {
            game: ControlGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ControlGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores]
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showControl = true;
        let vertexStyle = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-control") {
                showControl = false;
            } else if (altDisplay === "vertex-style") {
                vertexStyle = true;
            }
        }

        let pstr = "";
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    if (this.board.get(cell) === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }

            }
            if (pieces.every(p => p === "-")) {
                pieces = ["_"];
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: vertexStyle ? "hex-of-tri" : "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }]
            },
            pieces: pstr,
        };

        rep.annotations = [];
        for (const move of this.stack[this.stack.length - 1]._results) {
            if (move.type === "place" || move.type === "capture") {
                const [x, y] = this.getGraph().algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
            }
        }

        if (showControl) {
            const points = this.controlAnnotations();
            const points1 = points.get(1)!;
            const points2 = points.get(2)!;

            if (points1.length > 0) {
                rep.annotations.push({type: "dots", colour: 1, targets: points1 as [{row: number; col: number}, ...{row: number; col: number}[]] });
            }

            if (points2.length > 0) {
                rep.annotations.push({type: "dots", colour: 2, targets: points2 as [{row: number; col: number}, ...{row: number; col: number}[]] });
            }
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    private controlAnnotations(): Map<Player, {row: number, col: number}[]> {
        const annotations = new Map<Player, {row: number, col: number}[]>([[1, []], [2, []]]);
        for (const cell of this.listCells() as string[]) {
            const playerOneNeighbourCount = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === 1).length;
            const playerTwoNeighbourCount = this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c) === 2).length;
            const [x, y] = this.getGraph().algebraic2coords(cell);
            const cellCoords = {row: y, col: x};
            if (playerOneNeighbourCount > playerTwoNeighbourCount) {
                if (!this.board.has(cell) || this.board.get(cell) === 2) {
                    annotations.get(1)!.push(cellCoords);
                }
            } else if (playerTwoNeighbourCount > playerOneNeighbourCount) {
                if (!this.board.has(cell) || this.board.get(cell) === 1) {
                    annotations.get(2)!.push(cellCoords);
                }
            }
        }
        return annotations;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as Player);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public clone(): ControlGame {
        return new ControlGame(this.serialize());
    }

}
