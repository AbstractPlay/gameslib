import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IStatus } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { SquareFanoronaGraph } from "../common/graphs";
import { RectGrid, Direction, allDirections, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2;
export type Animal = "Tiger" | "Goat";
export type Piece = {
    owner: playerid;
    animal: Animal;
    facingDirection: Direction;
}

export type Phase = "TigerMovement" | "GoatPlacement" | "GoatMovement";

export class BaghChalCellPair {
    public from: string;
    public to: string;

    constructor(from: string, to: string) {
        this.from = from;
        this.to = to;
    }

    public fromVector(): [number, number] {
        return GameBase.algebraic2coords(this.from, 5);
    }

    public toVector(): [number, number] {
        return GameBase.algebraic2coords(this.to, 5);
    }

    public fromX(): number {
        return this.fromVector()[0];
    }

    public fromY(): number {
        return this.fromVector()[1];
    }

    public toX(): number {
        return this.toVector()[0];
    }

    public toY(): number {
        return this.toVector()[1];
    }

    public deltaX(): number {
        return this.toX() - this.fromX();
    }

    public deltaY(): number {
        return this.toY() - this.fromY();
    }

    public deltaVector(): [number, number] {
        return [this.deltaX(), this.deltaY()];
    }

    public deltaString(): string {
        return `${this.deltaX()}|${this.deltaY()}`;
    }

    public direction(): Direction | undefined {
        switch (this.deltaString()) {
            case "0|-1":
                return "N";
            case "1|-1":
                return "NE";
            case "1|0":
                return "E";
            case "1|1":
                return "SE";
            case "0|1":
                return "S";
            case "-1|1":
                return "SW";
            case "-1|0":
                return "W";
            case "-1|-1":
                return "NW";
            default:
                return undefined;
        }
    }
}

function cyclicWindow<T>(array: T[], value: T, radius: number) {
    const i = array.indexOf(value);
    if (i === -1) return [];

    return Array.from({ length: 2 * radius + 1 }, (_, k) => {
        const offset = k - radius;
        return array[(i + offset + array.length) % array.length];
    });
}

export function allowedDirections(facingDirection: Direction): Direction[] {
    return cyclicWindow(allDirections, facingDirection, 2);
}



export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    goatsInHand: number;
    goatsCaptured: number;
    lastmove?: string;
};


export interface IBaghChalState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};


export class BaghChalGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Bagh Chal",
        uid: "baghchal",
        playercounts: [2],
        version: "20260816",
        dateAdded: "2026-08-16",
        // i18next.t("apgames:descriptions.baghchal")
        description: "apgames:descriptions.baghchal",
        urls: [
            "https://boardgamegeek.com/boardgame/315/bagh-chal",
            "https://en.wikipedia.org/wiki/Bagh-chal",
        ],
        people: [
            {
                type: "coder",
                name: "Fabian Stiewe (Girolamo Cardano)",
                urls: [],
                apid: "079d1f5f-e260-423d-b151-be95b152bf6d",
            },
        ],
        categories: [
            "goal>score>race",
            "goal>immobilize",
            "mechanic>place",
            "mechanic>move",
            "mechanic>capture",
            "mechanic>asymmetry",
            "board>shape>rect",
            "board>connect>rect",
            "components>simple>1per",
        ],
        flags: [
            "experimental"
        ]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public grid: RectGrid = new RectGrid(5, 5);
    public graph: SquareFanoronaGraph = new SquareFanoronaGraph(5, 5)
    public goatsInHand: number = 20;
    public goatsCaptured: number = 0;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _dots: string[] =[];

    constructor(state?: IBaghChalState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Piece>([
                ["a1", {owner: 2, animal: "Tiger", facingDirection: "NE"}],
                ["e1", {owner: 2, animal: "Tiger", facingDirection: "NW"}],
                ["a5", {owner: 2, animal: "Tiger", facingDirection: "SE"}],
                ["e5", {owner: 2, animal: "Tiger", facingDirection: "SW"}],
            ]);
            const fresh: IMoveState = {
                _version: BaghChalGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: this.currplayer,
                board: board,
                goatsInHand: this.goatsInHand,
                goatsCaptured: this.goatsCaptured,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBaghChalState;
            }
            if (state.game !== BaghChalGame.gameinfo.uid) {
                throw new Error(`The Bagh Chal engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BaghChalGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ((idx < 0) || (idx >= this.stack.length)) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.goatsInHand = state.goatsInHand;
        this.goatsCaptured = state.goatsCaptured;
        this.lastmove = state.lastmove;
        this.results = [...state._results]
        return this;
    }

    public emptyCells(): string[] {
        return this.graph.graph.nodes().filter((cell) => !this.board.has(cell));
    }

    public goatsOnBoard(): string[] {
        const result: string[] = [];
        this.board.forEach((piece, cell) => {
            if (piece.animal === "Goat") {
                result.push(cell);
            }
        })
        return result;
    }

    public tigersOnBoard(): Map<string, Direction> {
        const result: Map<string, Direction> = new Map();
        this.board.forEach((piece, cell) => {
            if (piece.animal === "Tiger") {
                result.set(cell, piece.facingDirection);
            }
        })
        return result;
    }

    public placeGoat(cell: string) {
        if (!this.emptyCells().includes(cell)) {
            throw new Error("Cannot place goat on non-empty cell.");
        }
        this.board.set(cell, {owner: 1, animal: "Goat", facingDirection: "N"}); // Goats by default face north, but their direction is irrelevant.
        this.results.push({type: "place", where: cell, count: 1 });
        this.goatsInHand -= 1;
    }

    public newDirection(from: string, to: string): Direction {
        const pair = new BaghChalCellPair(from, to);

        const direction = RectGrid.bearing(pair.fromX(), pair.fromY(), pair.toX(), pair.toY());
        if (direction === undefined) {
            throw Error("No valid facing direction after move!");
        } else {
            return direction;
        }
    }

    public executeMove(from: string, to: string) {
        const oldPiece = this.board.get(from);
        if (oldPiece === undefined) {
            throw Error("No piece here to move!");
        }

        this.results.push({ type: "move", from: from, to: to, what: oldPiece.animal });
        const pair = new BaghChalCellPair(from, to);
        const [dX, dY] = pair.deltaVector();
        if ((Math.abs(dX) === 2) || (Math.abs(dY) === 2)) {
            // Jump & capture
            const [preyX, preyY] = [pair.fromX() + Math.sign(dX), pair.fromY() + Math.sign(dY)];
            const prey = BaghChalGame.coords2algebraic(preyX, preyY);
            this.board.delete(prey);
            this.goatsCaptured += 1;
            this.results.push({ type: "capture", where: prey, what: "Goat"});
        }

        const newPiece = { owner: oldPiece.owner, animal: oldPiece.animal, facingDirection: this.newDirection(from, to) };
        this.board.delete(from);
        this.board.set(to, newPiece);

    }

    public jumpsAvailable(from: string) {
        const piece = this.board.get(from);
        if (piece === undefined) {
            throw Error("No piece here to move!");
        }
        if (piece.animal !== "Tiger") {
            throw Error("No tiger here to move!");
        }
        const prey = this.graph.neighbours(from)
            .filter((nb) => {return this.board.has(nb);})
            .filter((nb) => {return this.board.get(nb)!.animal === "Goat";});
        const pairs = prey.map((nb) => {return new BaghChalCellPair(from, nb);})
            .filter((pair) => {
                const actual = pair.direction();
                const allowed = allowedDirections(piece.facingDirection);
                return (actual !== undefined && allowed.includes(actual));
            });
        const targets = pairs.map((pair) => {
            const [dX, dY] = pair.deltaVector();
            const [tarX, tarY] = [pair.toX() + dX, pair.toY() + dY];
            try {
                const target = BaghChalGame.coords2algebraic(tarX, tarY);
                return target;
            } catch (err) {
                if (
                    (err instanceof Error)
                    &&
                    (err.message.startsWith("Could not find a character at index"))
                ){
                    // Hypothetical target is out of bounds of grid
                    return "OutOfBounds";
                }
                else {
                    throw Error("Unexpected error in calculating jump target.")
                }
            }
        }).filter((target) => {
            return (target !== "OutOfBounds");
        }).filter((target) => {
            return (this.graph.graph.nodes().includes(target)) && (!this.board.has(target));
        });
        return targets.map((target) => from + "-" + target);
    }

    private phase(): Phase {
        if (this.currplayer === 2) {
            return "TigerMovement";
        } else if (this.goatsInHand > 0) {
            return "GoatPlacement";
        } else {
            return "GoatMovement";
        }
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        if (this.phase() === "GoatPlacement") {
            return this.emptyCells();
        }

        else if (this.phase() === "GoatMovement") {
            const moves: string[] = [];
            this.goatsOnBoard().forEach((cell) => {
                this.graph.neighbours(cell).forEach((nb) => {
                    if (!this.board.has(nb)) {
                        moves.push(cell + "-" + nb);
                    }
                });
            });

            return moves;
        }

        else if (this.phase() === "TigerMovement") {
            const simpleMoves: string[] = [];
            this.tigersOnBoard().forEach((direction, cell) => {
                this.graph.neighbours(cell).forEach((nb) => {
                    if (!this.board.has(nb)) {
                        simpleMoves.push(cell + "-" + nb);
                    }
                });
            });
            const jumpMoves: string[] = [];
            this.tigersOnBoard().forEach((direction, cell) => {
                const jumps = this.jumpsAvailable(cell);
                jumpMoves.push(...jumps);
            });
            return simpleMoves.concat(jumpMoves);
        }

        else {
            return [];
        }
    }



    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = BaghChalGame.coords2algebraic(col, row);
            let newmove = "";


            if (move === "") {
                newmove = cell;
            } else {
                if (cell === move) {
                    newmove = "";
                } else if (this.board.has(cell) && this.board.get(cell)!.owner === this.currplayer) {
                    newmove = cell;
                } else {
                    newmove = `${move}-${cell}`;
                }
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }



    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        const validMoves = this.moves();
        const validStarts = validMoves.map((vm) => {return vm.split("-")[0]});

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.phase() === "TigerMovement") {
                result.message = i18next.t("apgames:validation.baghchal.INITIAL_INSTRUCTIONS_TIGER_MOVEMENT");
            } else if (this.phase() === "GoatMovement") {
                result.message = i18next.t("apgames:validation.baghchal.INITIAL_INSTRUCTIONS_GOAT_MOVEMENT");
            } else if (this.phase() === "GoatPlacement") {
                result.message = i18next.t("apgames:validation.baghchal.INITIAL_INSTRUCTIONS_GOAT_PLACEMENT");
            }
            return result;
        }

        if (validMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        if (validStarts.includes(m)) {
            result.valid = true;
            result.complete = -1
            result.canrender = true;
            result.message = i18next.t("apgames:validation.baghchal.VALID_PARTIAL");
            return result;
        }

        result.valid = false;
        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
        return result;
    }


    public move(m: string, { partial = false, trusted = false } = {}): BaghChalGame {
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
            if ((!partial) && (!this.moves().includes(m))) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }))
            }
        }

        if (partial) {
            const start = m;
            const validMoves = this.moves()
                .filter((vm) => { return vm.split("-")[0] === start});
            const validEnds = validMoves
                 .map((vm) => { return vm.split("-")[1] });
            this._dots = validEnds;
            return this;
        } else {
            this._dots = [];
        }

        if (m.length === 2) {
            // Placement
            this.placeGoat(m);
        }
        else {
            // Move
            const [from, to] = m.split("-");
            this.executeMove(from, to);
        }
        this.results = [];


        this.lastmove = m;
        const newplayer = ((this.currplayer as number)  % 2) + 1;
        this.currplayer = newplayer as playerid;


        this.checkEOG();
        this.saveState();
        return this;
    }



    protected checkEOG(): BaghChalGame {
        if (this.goatsCaptured === 5) {
            this.winner = [2];
            this.gameover = true;
        }

        if (this.moves().length === 0) {
            const winner = ((this.currplayer as number) % 2) + 1;
            this.winner = [winner as playerid];
            this.gameover = true;
        }

        if (this.gameover) {
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }
        return this;
    }



    public state(): IBaghChalState {
        return {
            game: BaghChalGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }


    public moveState(): IMoveState {
        return {
            _version: BaghChalGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            goatsInHand: this.goatsInHand,
            goatsCaptured: this.goatsCaptured,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 5; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 5; col++) {
                const cell = BaghChalGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents.animal === "Tiger") {
                        pieces.push("T" + contents.facingDirection + ",");
                    }
                    else {
                        pieces.push("G,");
                    }
                }
                else {
                    pieces.push("-,");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/(-,){5}/g, "_");

        // Build rep
        const rep: APRenderRep = {
            board: {
                style: "vertex-fanorona",
                width: 5,
                height: 5,
            },
            legend: {
                G: {
                    name: "piece",
                    colour: 1
                },
                TN: {
                    name: "piece-triangle",
                    rotate: 0,
                    colour: 2
                },
                TNE: {
                    name: "piece-triangle",
                    rotate: 45,
                    colour: 2
                },
                TE: {
                    name: "piece-triangle",
                    rotate: 90,
                    colour: 2
                },
                TSE: {
                    name: "piece-triangle",
                    rotate: 135,
                    colour: 2
                },
                TS: {
                    name: "piece-triangle",
                    rotate: 180,
                    colour: 2
                },
                TSW: {
                    name: "piece-triangle",
                    rotate: 225,
                    colour: 2
                },
                TW: {
                    name: "piece-triangle",
                    rotate: 270,
                    colour: 2
                },
                TNW: {
                    name: "piece-triangle",
                    rotate: 315,
                    colour: 2
                }
            },
            pieces: pstr
        };

        rep.annotations = [];

        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = BaghChalGame.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = BaghChalGame.algebraic2coords(move.from);
                    const [toX, toY] = BaghChalGame.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = BaghChalGame.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
        }

        if (this._dots.length > 0) {
            const points = [];
            for (const dot of this._dots) {
                const [x, y] = BaghChalGame.algebraic2coords(dot);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({
                type: "dots",
                targets: points as [{ row: number; col: number; }, ...{ row: number; col: number; }[]]
            });
        }

        return rep;
    }

    public sidebarStatuses(): IStatus[] {
        return [
            { key: i18next.t("apgames:status.baghchal.GOATS_IN_HAND"), value: [this.goatsInHand.toString()] },
            { key: i18next.t("apgames:status.baghchal.GOATS_CAPTURED"), value: [this.goatsCaptured.toString()] },
        ];
    }

    public clone(): BaghChalGame {
        return new BaghChalGame(this.serialize());
    }


}
