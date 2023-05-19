// import { IGame } from "./IGame";
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { RectGrid } from "../common";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
type pieceid = "s" | "t";
type CellContents = [playerid, pieceid];
const alldirs: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const homes: Map<playerid, string[]> = new Map([
    [1, ["b1", "c1", "d1", "e1", "f1", "g1", "h1", "i1"]],
    [2, ["b10", "c10", "d10", "e10", "f10", "g10", "h10", "i10"]],
]);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    placed: boolean;
};

export interface ICannonState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const dirsForward: Map<playerid, Directions[]> = new Map([
    [1, ["N", "NW", "NE"]],
    [2, ["S", "SE", "SW"]]
]);
const dirsBackward: Map<playerid, Directions[]> = new Map([
    [1, ["S", "SE", "SW"]],
    [2, ["N", "NW", "NE"]]
]);

export class CannonGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Cannon",
        uid: "cannon",
        playercounts: [2],
        version: "20211010",
        // i18next.t("apgames:descriptions.cannon")
        description: "apgames:descriptions.cannon",
        urls: [
            "https://nestorgames.com/rulebooks/CANNON_EN.pdf",
            "http://superdupergames.org/rules/cannon.pdf",
            "https://boardgamegeek.com/boardgame/8553/cannon"
        ],
        people: [
            {
                type: "designer",
                name: "David E. Whitcher"
            }
        ],
        flags: ["perspective", "limited-pieces"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 10);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 10);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public placed = false;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: ICannonState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICannonState;
            }
            if (state.game !== CannonGame.gameinfo.uid) {
                throw new Error(`The Cannon game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: CannonGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                placed: false,
                board: new Map([
                    ["a2", [1, "s"]],
                    ["a3", [1, "s"]],
                    ["a4", [1, "s"]],
                    ["c2", [1, "s"]],
                    ["c3", [1, "s"]],
                    ["c4", [1, "s"]],
                    ["e2", [1, "s"]],
                    ["e3", [1, "s"]],
                    ["e4", [1, "s"]],
                    ["g2", [1, "s"]],
                    ["g3", [1, "s"]],
                    ["g4", [1, "s"]],
                    ["i2", [1, "s"]],
                    ["i3", [1, "s"]],
                    ["i4", [1, "s"]],
                    ["b7", [2, "s"]],
                    ["b8", [2, "s"]],
                    ["b9", [2, "s"]],
                    ["d7", [2, "s"]],
                    ["d8", [2, "s"]],
                    ["d9", [2, "s"]],
                    ["f7", [2, "s"]],
                    ["f8", [2, "s"]],
                    ["f9", [2, "s"]],
                    ["h7", [2, "s"]],
                    ["h8", [2, "s"]],
                    ["h9", [2, "s"]],
                    ["j7", [2, "s"]],
                    ["j8", [2, "s"]],
                    ["j9", [2, "s"]],
                ])
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): CannonGame {
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
        this.placed = state.placed;
        return this;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p[0] === player && p[1] === "s").length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public moves(player?: 1|2): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        // if (this.gameover) { return []; }
        const moves: string[] = []
        if (! this.placed) {
            const myhomes = homes.get(player);
            if (myhomes === undefined) {
                throw new Error("Malformed homes.");
            }
            moves.push(...myhomes);
        } else {
            const grid = new RectGrid(10, 10);
            // individual pieces first
            this.board.forEach((v, k) => {
                if ( (v[0] === player) && (v[1] === "s") ) {
                    const currCell = CannonGame.algebraic2coords(k);
                    // forward motion
                    const dirs = dirsForward.get(player);
                    if (dirs === undefined) {
                        throw new Error("Malformed directions.");
                    }
                    dirs.forEach((d) => {
                        const [x, y] = RectGrid.move(...currCell, d);
                        if (grid.inBounds(x, y)) {
                            const cellNext = CannonGame.coords2algebraic(x, y);
                            if (! this.board.has(cellNext)) {
                                moves.push(`${k}-${cellNext}`);
                            }
                        }
                    });

                    // captures
                    const capdirs = [...dirs, "E" as Directions, "W" as Directions];
                    capdirs.forEach((d) => {
                        const [x, y] = RectGrid.move(...currCell, d);
                        if (grid.inBounds(x, y)) {
                            const cellNext = CannonGame.coords2algebraic(x, y);
                            if (grid.inBounds(x, y)) {
                                const contents = this.board.get(cellNext);
                                if ( (contents !== undefined) && (contents[0] !== player) ) {
                                    moves.push(`${k}x${cellNext}`);
                                }
                            }
                        }
                    });

                    // retreats
                    const adjs = grid.adjacencies(...currCell);
                    for (const pair of adjs) {
                        const cellNext = CannonGame.coords2algebraic(...pair);
                        if (this.board.has(cellNext)) {
                            const contents = this.board.get(cellNext);
                            if ( (contents !== undefined) && (contents[0] !== player) ) {
                                const back = dirsBackward.get(player);
                                if (back === undefined) {
                                    throw new Error("Malformed directions.");
                                }
                                for (const d of back) {
                                    const ray = grid.ray(...currCell, d);
                                    if (ray.length >= 2) {
                                        const cellBetween = CannonGame.coords2algebraic(...ray[0]);
                                        const cellRetreat = CannonGame.coords2algebraic(...ray[1]);
                                        if ( (! this.board.has(cellBetween)) && (! this.board.has(cellRetreat)) ) {
                                            moves.push(`${k}-${cellRetreat}`);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Check if this piece is the tail of a cannon
                    for (const dir of alldirs) {
                        const ray = grid.ray(...currCell, dir);
                        if (ray.length >= 3) {
                            const raycells = ray.slice(0, 3).map((pair) => {
                                return CannonGame.coords2algebraic(...pair);
                            });
                            if ( (this.board.has(raycells[0])) && (this.board.has(raycells[1])) && (! this.board.has(raycells[2])) ) {
                                const c1 = this.board.get(raycells[0]);
                                const c2 = this.board.get(raycells[1]);
                                if ( (c1 === undefined) || (c2 === undefined) ) {
                                    throw new Error("Invalid cell contents.");
                                }
                                if ( (c1[0] === player) && (c1[1] === "s") && (c2[0] === player) && (c2[1] === "s") ) {
                                    // Move this piece into the empty space
                                    moves.push(`${k}-${raycells[2]}`);

                                    // Capture an enemy piece 2 or 3 spaces away
                                    if (ray.length >= 4) {
                                        const cap = CannonGame.coords2algebraic(...ray[3]);
                                        if (this.board.has(cap)) {
                                            const contents = this.board.get(cap);
                                            if ( (contents !== undefined) && (contents[0] !== player) ) {
                                                moves.push(`x${cap}`);
                                            }
                                        }
                                    }
                                    if (ray.length >= 5) {
                                        const cap = CannonGame.coords2algebraic(...ray[4]);
                                        if (this.board.has(cap)) {
                                            const contents = this.board.get(cap);
                                            if ( (contents !== undefined) && (contents[0] !== player) ) {
                                                moves.push(`x${cap}`);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = CannonGame.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                if (this.board.has(cell)) {
                    newmove = cell;
                } else if (! this.placed) {
                    newmove = cell;
                } else {
                    return {move: "", message: ""} as IClickResult;
                }
            } else {
                if (! this.placed) {
                    newmove = cell;
                } else if ( (move === cell) && (this.board.has(cell)) && (this.board.get(cell)![0] !== this.currplayer) ) {
                    newmove = `x${cell}`;
                } else {
                    const [from, to] = move.split(/[x-]/);
                    if ( (from === cell) || (to === cell) ) {
                        newmove = cell;
                    } else if (this.board.has(cell)) {
                        newmove = `${from}x${cell}`;
                    } else {
                        newmove = `${from}-${cell}`;
                    }
                }
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
        const grid = new RectGrid(10, 10);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.placed) {
                result.message = i18next.t("apgames:validation.cannon.INITIAL_INSTRUCTIONS", {context: "placed"});
            } else {
                result.message = i18next.t("apgames:validation.cannon.INITIAL_INSTRUCTIONS", {context: "towns"});
            }
            return result;
        }

        // First deal with town placement
        if (! this.placed) {
            const myhomes = homes.get(this.currplayer)!;
            if (! myhomes.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.cannon.HOMECELL");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // cannon capture
        if (m.startsWith("x")) {
            const cell = m.slice(1);
            // cell is occupied
            if (! this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                return result;
            }
            // it belongs to the enemy
            if (this.board.get(cell)![0] === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                return result;
            }
            // it is in range of one of your cannons
            const [x, y] = CannonGame.algebraic2coords(cell);
            const mysoldiers = [...this.board.entries()].filter(e => (e[1][0] === this.currplayer) && (e[1][1] === "s") ).map(e => e[0]);
            let inrange = false;
            for (const dir of alldirs) {
                const ray = grid.ray(x, y, dir).map(pt => CannonGame.coords2algebraic(...pt));
                if (ray.length >= 4) {
                    let startidx = 1;
                    if (this.board.has(ray[0])) {
                        // Scenario: Cannon + empty + occupied -> target
                        if (ray.length < 5) {
                            continue;
                        }
                        // second space must be empty
                        if (this.board.has(ray[1])) {
                            continue;
                        }
                        // now the cannon
                        startidx = 2;
                    } else {
                        // Scenario: Cannon + empty (+ empty) -> target
                        // second cell might be empty too
                        if (! this.board.has(ray[1])) {
                            // but now we have to make sure the ray is at least 5 cells long
                            if (ray.length < 5) {
                                continue;
                            }
                            startidx = 2;
                        }
                    }
                    // remaning three must be your soldiers
                    let iscannon = true;
                    for (let i = startidx; i < startidx + 3; i++) {
                        if (! mysoldiers.includes(ray[i])) {
                            iscannon = false;
                            break;
                        }
                    }
                    if (iscannon) {
                        inrange = true;
                        break;
                    }
                }
            }
            if (! inrange) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.cannon.NOCANNON_CAPTURE", {where: cell});
                return result;
            }

            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        // move or capture
        } else if ( (m.includes("-")) || (m.includes("x")) ) {
            const [from, to] = m.split(/[-x]/);
            // both cells are valid
            for (const cell of [from, to]) {
                try {
                    CannonGame.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }
            // both cells are different
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                return result;
            }
            // from is occupied
            if (! this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // It belongs to you
            if (this.board.get(from)![0] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // It's a soldier
            if (this.board.get(from)![1] !== "s") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.cannon.FIXED_TOWNS");
                return result;
            }
            // Correct operator was used
            if ( (m.includes("-")) && (this.board.has(to)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                return result;
            }
            if ( (m.includes("x")) && (! this.board.has(to)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                return result;
            }
            const [xFrom, yFrom] = CannonGame.algebraic2coords(from);
            const [xTo, yTo] = CannonGame.algebraic2coords(to);
            const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const neighbours = grid.adjacencies(xFrom, yFrom).map(pt => CannonGame.coords2algebraic(...pt));
            const adjEnemies = [...this.board.entries()].filter(e => neighbours.includes(e[0]) && e[1][0] !== this.currplayer).map(e => e[0]);
            const forward = dirsForward.get(this.currplayer)!;
            const backward = dirsBackward.get(this.currplayer)!;

            // cannon moves first
            if (Math.max(Math.abs(xFrom - xTo), Math.abs(yFrom - yTo)) === 3) {
                const ray = grid.ray(xFrom, yFrom, bearing).map(pt => CannonGame.coords2algebraic(...pt));
                if (ray.length < 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.NOCANNON_MOVE");
                    return result;
                }
                // first two cells must be your own soldiers
                for (const cell of [ray[0], ray[1]]) {
                    if ( (! this.board.has(cell)) || (this.board.get(cell)![0] !== this.currplayer) || (this.board.get(cell)![1] !== "s") ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.cannon.NOCANNON_MOVE");
                        return result;
                    }
                }
                // third cell must be empty
                if (this.board.has(ray[2])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.NOCANNON_MOVE");
                    return result;
                }

                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            // retreats
            } else if (backward.includes(bearing)) {
                // reason to retreat
                if (adjEnemies.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.BAD_RETREAT");
                    return result;
                }
                // Correct distance
                if (Math.abs(yFrom - yTo) !== 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.RETREAT_DISTANCE");
                    return result;
                }
                // no obstruction
                const next = CannonGame.coords2algebraic(...RectGrid.move(xFrom, yFrom, bearing));
                if (this.board.has(next)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: next});
                    return result;
                }

                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            // validate sideways motion
            } else if ( (bearing === "E") || (bearing === "W") ) {
                // the space is adjacent
                if (Math.abs(xFrom - xTo) !== 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.TOOFAR");
                    return result;
                }
                // There's a piece present
                if (! this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.LATERAL_MOVEMENT");
                    return result;
                }
                // the captured piece is an enemy
                if (this.board.get(to)![0] === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }

                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            // forward motion
            } else {
                // correct direction
                if (! forward.includes(bearing)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.FORWARD_ONLY");
                    return result;
                }
                // space is adjacent
                if (Math.abs(yFrom - yTo) !== 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cannon.TOOFAR");
                    return result;
                }

                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

        // single cell
        } else {
            // cell is valid
            try {
                CannonGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // the cell is occupied
            if (! this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // The cell is yours
            if (this.board.get(m)![0] !== this.currplayer) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.cannon.UNCONTROLLED");
                return result;
            }
            // The cell is a soldier
            if (this.board.get(m)![1] === "t") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.cannon.FIXED_TOWNS");
                return result;
            }

            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.cannon.PARTIAL");
            return result;
        }

        return result;
    }

    public move(m: string): CannonGame {
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

        this.lastmove = m;
        if (m[0] === "x") {
            const cell = m.slice(1);
            this.board.delete(cell);
            this.results = [{type: "capture", where: cell}]
        } else if ( (m.includes("-")) || (m.includes("x")) ) {
            const cells: string[] = m.split(new RegExp('[\-x]'));
            this.board.set(cells[1], this.board.get(cells[0])!);
            this.board.delete(cells[0]);
            this.results = [{type: "move", from: cells[0], to: cells[1]}];
            if (m.includes("x")) {
                this.results = [{type: "capture", where: cells[1]}]
            }
        } else {
            this.board.set(m, [this.currplayer, "t"]);
            if (this.currplayer === 2) {
                this.placed = true;
            }
            this.results = [{type: "place", where: m, what: "town"}];
        }

        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CannonGame {
        // First check for eliminated town
        if (this.placed) {
            const towns: playerid[] = [];
            for (const contents of this.board.values()) {
                if (contents[1] === "t") {
                    towns.push(contents[0]);
                }
            }
            if (towns.length < 2) {
                this.gameover = true;
                this.winner = [...towns];
                this.results.push(
                    {type: "eog"},
                    {type: "winners", players: [...this.winner]}
                );
            }
        }

        // If still not game over, see if there are no moves available
        if (! this.gameover) {
            if (this.moves().length === 0) {
                this.gameover = true;
                if (this.currplayer === 1) {
                    this.winner = [2];
                } else {
                    this.winner = [1];
                }
                this.results.push(
                    {type: "eog"},
                    {type: "winners", players: [...this.winner]}
                );
            }
        }

        return this;
    }

    public state(): ICannonState {
        return {
            game: CannonGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CannonGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            placed: this.placed
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 10; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < 10; col++) {
                const cell = CannonGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed board contents.");
                    }
                    if (contents[0] === 1) {
                        if (contents[1] === "s") {
                            pstr += "A";
                        } else {
                            pstr += "B";
                        }
                    } else if (contents[0] === 2) {
                        if (contents[1] === "s") {
                            pstr += "Y";
                        } else {
                            pstr += "Z";
                        }
                    } else {
                        throw new Error("Unrecognized cell contents.");
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(/\-{10}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 10,
                height: 10
            },
            legend: {
                A: [
                    {
                        name: "piece",
                        player: 1
                    },
                    {
                        name: "cannon-piece",
                        scale: 0.5
                    }
                ],
                B: [
                    {
                        name: "piece-square",
                        player: 1
                    },
                    {
                        name: "cannon-town",
                        scale: 0.75
                    }
                ],
                Y: [
                    {
                        name: "piece",
                        player: 2
                    },
                    {
                        name: "cannon-piece",
                        scale: 0.5,
                        rotate: 180
                    }
                ],
                Z: [
                    {
                        name: "piece-square",
                        player: 2
                    },
                    {
                        name: "cannon-town",
                        scale: 0.75,
                        rotate: 180
                    }
                ],
            },
            pieces: pstr
        };

        // Add annotations
        if (this.lastmove !== undefined && this.lastmove !== 'resign') {
            // town placement
            if ( (this.lastmove.indexOf("-") < 0) && (this.lastmove.indexOf("x") < 0) ) {
                const [x, y] = CannonGame.algebraic2coords(this.lastmove);
                rep.annotations = [
                    {
                        type: "enter",
                        targets: [
                            {col: x, row: y}
                        ]
                    }
                ];
            // cannon fire
            } else if (this.lastmove[0] === "x") {
                const cell = this.lastmove.slice(1);
                const [x, y] = CannonGame.algebraic2coords(cell);
                rep.annotations = [
                    {
                        type: "exit",
                        targets: [
                            {col: x, row: y}
                        ]
                    }
                ];
            // movement
            } else  {
                const cells: string[] = this.lastmove.split(new RegExp('[\-x]'));
                const [xFrom, yFrom] = CannonGame.algebraic2coords(cells[0]);
                const [xTo, yTo] = CannonGame.algebraic2coords(cells[1]);
                rep.annotations = [
                    {
                        type: "move",
                        targets: [
                            {col: xFrom, row: yFrom},
                            {col: xTo, row: yTo}
                        ]
                    }
                ];
                // If a capture happened to, add the `exit` annotation
                if (this.lastmove.includes("x")) {
                    rep.annotations.push({
                        type: "exit",
                        targets: [
                            {col: xTo, row: yTo}
                        ]
                    });
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.cannon", {player, where: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): CannonGame {
        return new CannonGame(this.serialize());
    }
}
