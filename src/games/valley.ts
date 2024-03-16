import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Piece = "pawn"|"king";
export type CellContents = [playerid, Piece];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface IValleyState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ValleyGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "King's Valley",
        uid: "valley",
        playercounts: [2],
        version: "20240218",
        dateAdded: "2024-02-18",
        // i18next.t("apgames:descriptions.valley")
        description: "apgames:descriptions.valley",
        urls: [
            "http://www.logygames.com/english/kingsvalley.html",
            "https://boardgamegeek.com/boardgame/86169/kings-valley",
            "https://boardgamegeek.com/boardgame/173325/kings-valley-labyrinth"
        ],
        people: [
            {
                type: "designer",
                name: "Mitsuo Yamamoto",
            },
        ],
        variants: [
            {
                uid: "labyrinth"
            },
            {
                uid: "king-swap"
            }
        ],
        categories: ["goal>royal-escape", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["perspective"]
    };

    public get boardsize(): number {
        if (this.variants.includes("labyrinth")) {
            return 7;
        }
        return 5;
    }
    public get blocked(): string[] {
        if (this.variants.includes("labyrinth")) {
            return ["b3","b5","f3","f5"];
        }
        return [];
    }
    public get centre(): string {
        if (this.variants.includes("labyrinth")) {
            return "d4";
        }
        return "c3";
    }
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IValleyState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            let board = new Map<string, CellContents>([
                ["a1", [1,"pawn"]], ["b1", [1,"pawn"]], ["c1", [1,"king"]], ["d1", [1,"pawn"]], ["e1", [1,"pawn"]],
                ["a5", [2,"pawn"]], ["b5", [2,"pawn"]], ["c5", [2,"king"]], ["d5", [2,"pawn"]], ["e5", [2,"pawn"]],
            ]);
            if (variants !== undefined) {
                this.variants = [...variants];
                if (this.variants.includes("labyrinth")) {
                    board = new Map<string, CellContents>([
                        ["a1", [1,"pawn"]], ["b1", [1,"pawn"]], ["c1", [1,"pawn"]], ["d1", [1,"king"]], ["e1", [1,"pawn"]], ["f1", [1,"pawn"]], ["g1", [1,"pawn"]],
                        ["a7", [2,"pawn"]], ["b7", [2,"pawn"]], ["c7", [2,"pawn"]], ["d7", [2,"king"]], ["e7", [2,"pawn"]], ["f7", [2,"pawn"]], ["g7", [2,"pawn"]],
                    ]);
                }
                if (this.variants.includes("king-swap")) {
                    if (this.variants.includes("labyrinth")) {
                        board.set("d1", [2,"king"]);
                        board.set("d7", [1,"king"]);
                    } else {
                        board.set("c1", [2,"king"]);
                        board.set("c5", [1,"king"]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: ValleyGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IValleyState;
            }
            if (state.game !== ValleyGame.gameinfo.uid) {
                throw new Error(`The King's Valley engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ValleyGame {
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
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(this.boardsize, this.boardsize);
        const mine = [...this.board.entries()].filter(([,[owner,]]) => owner === player).map(([cell,]) => cell);

        for (const from of mine) {
            const piece = this.board.get(from)![1];
            if (this.stack.length === 1 && piece === "king") {
                continue;
            }
            const [fx, fy] = this.algebraic2coords(from);
            for (const dir of allDirections) {
                let ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
                // find first obstacle
                const idx = ray.findIndex(cell => this.board.has(cell) || this.blocked.includes(cell));
                if (idx !== -1) {
                    ray = ray.slice(0, idx);
                }
                if (ray.length > 0) {
                    const to = ray[ray.length - 1];
                    if (to !== this.centre || piece === "king") {
                        moves.push(`${from}-${to}`);
                    }
                }
            }
        }

        return moves.sort();
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move.length > 0) {
                // if you clicked on your own piece, assume reset
                if (this.board.has(cell) && (this.board.get(cell)![0] === this.currplayer)) {
                    newmove = cell;
                }
                // otherwise, move
                else {
                    newmove = `${move}-${cell}`;
                }
            } else {
                newmove = cell;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.valley.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [from, to] = m.split("-");

        // FROM
        // valid cell
        let fx: number; let fy: number;
        try {
            [fx, fy] = this.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // occupied
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // is yours
        const [owner, piece] = this.board.get(from)!;
        if (owner !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        // can't move king on first turn
        if (this.stack.length === 1 && piece === "king") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.valley.PAWN_FIRST");
            return result;
        }

        if (to !== undefined) {
            // valid cell
            let tx: number; let ty: number;
            try {
                [tx, ty] = this.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // is empty
            if (this.board.has(to) || this.blocked.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                return result;
            }
            // goes as far as it can
            const grid = new RectGrid(this.boardsize, this.boardsize);
            const dir = RectGrid.bearing(fx, fy, tx, ty);
            if (dir === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO", {where: to});
                return result;
            }
            let ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
            const idx = ray.findIndex(cell => this.board.has(cell) || this.blocked.includes(cell));
            if (idx !== -1) {
                ray = ray.slice(0, idx);
            }
            if (ray.length === 0 || ray[ray.length - 1] !== to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.valley.NO_STOPPING");
                return result;
            }
            // only king on centre space
            if (to === this.centre && piece !== "king") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.valley.KING_ONLY");
                return result;
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        }
        // valid partial
        else {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.valley.PARTIAL");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): ValleyGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const [from, to] = m.split("-");
        const piece = [...this.board.get(from)!] as CellContents;
        this.board.delete(from);
        this.board.set(to, piece);
        this.results.push({type: "move", from, to});

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

    protected kingLocked(player: playerid): boolean {
        const king = [...this.board.entries()].find(([, [owner, size]]) => owner === player && size === "king");
        if (king === undefined) {
            throw new Error(`A king could not be found for player ${player}.`);
        }
        const [x,y] = this.algebraic2coords(king[0]);
        const grid = new RectGrid(this.boardsize, this.boardsize);
        let blocked = true;
        for (const n of grid.adjacencies(x, y, true).map(pt => this.coords2algebraic(...pt))) {
            if (! this.blocked.includes(n) && ! this.board.has(n)) {
                blocked = false;
                break;
            }
        }
        return blocked;
    }

    protected checkEOG(): ValleyGame {
        // win if your king occupies the valley
        if (this.board.has(this.centre)) {
            const [owner,] = this.board.get(this.centre)!;
            this.gameover = true;
            this.winner = [owner];
        }

        // lose if your king can't move
        if (this.kingLocked(this.currplayer)) {
            this.gameover = true;
            if (this.currplayer === 1) {
                this.winner = [2];
            } else {
                this.winner = [1];
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

    public state(): IValleyState {
        return {
            game: ValleyGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ValleyGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [owner, piece] = this.board.get(cell)!;
                    if (owner === 1) {
                        if (piece === "pawn") {
                            pieces.push("A");
                        } else {
                            pieces.push("B");
                        }
                    } else {
                        if (piece === "pawn") {
                            pieces.push("Y");
                        } else {
                            pieces.push("Z");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        // pstr = pstr.replace(/-{8}/g, "_");

        const [cx, cy] = this.algebraic2coords(this.centre);
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
                startLight: true,
                markers: [
                    {
                        type: "glyph",
                        glyph: "VALLEY",
                        points: [
                            {row: cy, col: cx},
                        ],
                    }
                ],
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece-chariot",
                    player: 1
                },
                Y: {
                    name: "piece",
                    player: 2
                },
                Z: {
                    name: "piece-chariot",
                    player: 2
                },
                VALLEY: {
                    name: "piecepack-suit-suns",
                    colour: "#ffd700",
                    opacity: 0.5,
                },
            },
            pieces: pstr
        };
        if (this.variants.includes("labyrinth")) {
            rep.legend!.TOWER = {
                name: "chess-rook-outline-montreal",
                opacity: 0.5,
            };
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            rep.board!.markers.push({
                type: "glyph",
                glyph: "TOWER",
                points: this.blocked.map(cell => {
                    const [x,y] = this.algebraic2coords(cell);
                    return {row: y, col: x};
                }),
            });
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
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

    public clone(): ValleyGame {
        return new ValleyGame(this.serialize());
    }
}
