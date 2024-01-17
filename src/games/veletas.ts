import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import _ from "lodash";

type CellContents = 0|1|2|3|4;  // 0 is the shooter. 3 and 4 are shooters captured by player 1 and 2, respectively.
type playerid = 1|2;

const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    scores: [number, number];
}

export interface IVeletasState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class VeletasGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Veletas",
        uid: "veletas",
        playercounts: [2],
        version: "20240114",
        // i18next.t("apgames:descriptions.veletas")
        description: "apgames:descriptions.veletas",
        urls: ["https://boardgamegeek.com/boardgame/151224/veletas"],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures"
            }
        ],
        variants: [
            {
                uid: "size-7",
                group: "board",
            },
            {
                uid: "size-9",
                group: "board",
            },
        ],
        flags: ["experimental", "multistep", "scores", "pie"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0];
    private boardSize = 0;
    private startingPlacement = [0, 0];
    private grid!: RectGrid;

    constructor(state?: IVeletasState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: VeletasGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IVeletasState;
            }
            if (state.game !== VeletasGame.gameinfo.uid) {
                throw new Error(`The Veletas game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
    }

    public load(idx = -1): VeletasGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        this.boardSize = this.getBoardSize();
        this.startingPlacement = this.getStartingPlacement();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 10;
    }

    private getStartingPlacement(): [number, number] {
        // Get the number of pieces placed by player 1 and then player 2.
        if (this.boardSize === 7) { return [1, 2]; }
        if (this.boardSize === 9) { return [2, 3]; }
        if (this.boardSize === 10) { return [3, 4]; }
        throw new Error(`Could not determine the starting placement from board size ${this.boardSize}`);
    }

    public moves(player?: 1|2): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        if (this.stack.length < 3) { return ["No movelist in placement phase"]; }

        const from: string[] = [...this.board.keys()].filter(k => this.board.get(k) === 0);
        const fromTos: Array<[string, string]> = [];
        const blocks: Set<string> = new Set();
        from.forEach((fromCell) => {
            const coords = this.algebraic2coords(fromCell);
            allDirections.forEach((dir) => {
                const ray = this.grid.ray(...coords, dir);
                for (const cell of ray) {
                    const toCell = this.coords2algebraic(...cell);
                    if (this.board.has(toCell)) { break; }
                    fromTos.push([fromCell, toCell]);
                    blocks.add(toCell);
                }
            });
        });
        const moves: string[] = [...blocks];
        fromTos.forEach((m) => {
            const coords = this.algebraic2coords(m[1]);
            allDirections.forEach((dir) => {
                const ray = this.grid.ray(...coords, dir);
                for (const cell of ray) {
                    const block = this.coords2algebraic(cell[0], cell[1]);
                    if (this.board.has(block) && block !== m[0]) { break; }
                    moves.push(m[0] + "-" + m[1] + "/" + block);
                }
            });
        });
        return moves;
    }

    private stationaryBlocks(): string[] {
        // Get map of spaces that can be shot by a shooter without movement and a shooter.
        const shooters: string[] = [...this.board.keys()].filter(k => this.board.get(k) === 0);
        const blocks: string[] = [];
        shooters.forEach((s) => {
            const coords = this.algebraic2coords(s);
            allDirections.forEach((dir) => {
                const ray = this.grid.ray(...coords, dir);
                for (const cell of ray) {
                    const block = this.coords2algebraic(...cell);
                    if (this.board.has(block)) { break; }
                    blocks.push(block);
                }
            });
        });
        return blocks;
    }

    public randomMove(): string {
        if (this.stack.length < 3) {
            // Move list too large so we generate the random placement as needed.
            const availableNonCornerSpaces: string[] = [];
            for (let i = 1; i < this.boardSize - 1; i++) {
                for (let j = 1; j < this.boardSize - 1; j++) {
                    const cell = this.coords2algebraic(i, j);
                    if (this.board.has(cell)) { continue; }
                    availableNonCornerSpaces.push(cell);
                }
            }
            const shooters = _.sampleSize(availableNonCornerSpaces, this.startingPlacement[this.currplayer - 1])
            const remainingSpaces: string[] = [];
            for (let i = 0; i < this.boardSize; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    const cell = this.coords2algebraic(i, j);
                    if (this.board.has(cell)) { continue; }
                    if (shooters.includes(cell)) { continue; }
                    remainingSpaces.push(cell);
                }
            }
            return this.normalisePlacement(`${shooters.join(",")}/${_.sample(remainingSpaces)}`);
        }
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private normalisePlacement(m: string): string {
        // Normalise placement string.
        const [shooters, ownPiece] = m.split("/");
        const shootersList = shooters.split(",").sort((a, b) => this.sort(a, b)).join(",");
        if (ownPiece === undefined) {
            return shootersList;
        }
        return `${shootersList}/${ownPiece}`;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            if (this.stack.length < 3) {
                if (move === "") {
                    newmove = cell;
                } else {
                    const moves = move.split(",");
                    if (moves.length < this.startingPlacement[this.currplayer - 1]) {
                        newmove = [...moves, cell].sort((a, b) => this.sort(a, b)).join(",");
                    } else if (!move.includes("/")) {
                        newmove = `${move}/${cell}`;
                    } else {
                        newmove = move;
                    }
                }
            } else {
                if (move === "") {
                    newmove = cell;
                } else {
                    if (move.length > 0) {
                        const [from, to,] = move.split(/[-\/]/);
                        if ( (from !== undefined) && (to === undefined) ) {
                            newmove = `${from}-${cell}`;
                        } else if ( (from !== undefined) && (to !== undefined) ) {
                            newmove = `${from}-${to}/${cell}`;
                        } else {
                            newmove = move;
                        }
                    }
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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
        if (m === "No movelist in placement phase") {
            // Special for veletas because move list is too large during placement phase.
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.veletas.NO_MOVELIST");
            return result;
        }
        if (m.length === 0) {
            if (this.stack.length < 3) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.veletas.INITIAL_INSTRUCTIONS_PLACE", { count: this.startingPlacement[this.currplayer - 1] });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.veletas.INITIAL_INSTRUCTIONS");
            return result;
        }
        if (this.stack.length < 3) {
            // Placement phase
            const [shootersString, placement] = m.split("/");
            const shooters = shootersString.split(",");
            const placeCount = this.startingPlacement[this.currplayer - 1];
            if (shooters.length > placeCount) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.TOO_MANY_SHOOTERS", { count: placeCount });
                return result;
            }
            const allCells = placement === undefined ? [...shooters] : [...shooters, placement];
            // Valid cell
            let currentMove;
            try {
                for (const p of allCells) {
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    // `algebraic2coords` does not check if the cell is on the board.
                    if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                        throw new Error("Invalid cell");
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
                return result;
            }
            // Cell is empty
            let notEmpty;
            for (const p of allCells) {
                if (this.board.has(p)) { notEmpty = p; break; }
            }
            if (notEmpty) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: notEmpty});
                return result;
            }
            // No duplicate cells.
            const seen: Set<string> = new Set();
            const duplicates: Set<string> = new Set();
            for (const p of allCells) {
                if (seen.has(p)) { duplicates.add(p); }
                seen.add(p);
            }
            if (duplicates.size > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.DUPLICATE", {where: [...duplicates].join(", ")});
                return result;
            }
            // No perimeter placement of shooters.
            let perimeterPlacement;
            for (const p of shooters) {
                const [x, y] = this.algebraic2coords(p);
                if (x === 0 || y === 0 || x === this.boardSize - 1 || y === this.boardSize - 1) {
                    perimeterPlacement = p;
                    break;
                }
            }
            if (perimeterPlacement) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.SHOOTER_PERIMETER", {where: perimeterPlacement});
                return result;
            }
            // Check normalised placement.
            const normalised = this.normalisePlacement(m);
            if (m !== normalised) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.SORTED", {normalised});
                return result;
            }
            // Check for incomplete placement.
            if (shooters.length < placeCount) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.veletas.PLACE_SHOOTER", { count: placeCount - shooters.length });
                return result;
            }
            if (placement === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.veletas.PLACE_PIECE");
                return result;
            }
            // Since there is no move list for placement phase, we have to do some extra validation.
            const regex = new RegExp(`^[a-z]\\d+(,[a-z]\\d+){${placeCount - 1}}\\/[a-z]\\d+$`);
            if (!regex.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.INVALID_PLACEMENT", {move: m});
                return result;
            }
            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        }
        const [from, to, block] = m.split(/[-\/]/);
        // validate coordinates
        for (const cell of [from, to, block]) {
            if (cell !== undefined) {
                try {
                    this.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
                    return result
                }
            }
        }
        if (from !== undefined) {
            // trying to move a nonexistent piece
            if (!this.board.has(from)) {
                const shootable = this.stationaryBlocks();
                if (!shootable.includes(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.veletas.STATIONARY_LOS", { where: from });
                    return result;
                }
                if (to !== undefined || block !== undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.veletas.ALREADY_SHOT", { where: from });
                    return result;
                }
                // looks good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // trying to move a non-shooter piece.
            if (this.board.get(from)! !== 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.MOVE_NON_SHOOTER");
                return result;
            }
            if (to !== undefined && !this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // possible start of a move
            if (to === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = false;
                result.message = i18next.t("apgames:validation.veletas.POTENTIAL_MOVE");
                return result;
            }
        }

        if (to !== undefined) {
            const [xFrom, yFrom] = this.algebraic2coords(from);
            const [xTo, yTo] = this.algebraic2coords(to);
            // destination is empty
            if (this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                return result;
            }
            // destination is in a straight line
            // `dir` can't be undefined because we already checked the destination is empty
            const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const ray = this.grid.ray(xFrom, yFrom, dir).map(pt => this.coords2algebraic(...pt));
            if (! ray.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.STRAIGHTLINE");
                return result;
            }
            // nothing in the way
            for (const cell of ray) {
                if (cell === to) { break; }
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                    return result;
                }
            }
            // possible partial
            if (block === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.veletas.POTENTIAL_BLOCK");
                return result;
            }
        }

        if (block !== undefined) {
            const [xTo, yTo] = this.algebraic2coords(to);
            const [xBlock, yBlock] = this.algebraic2coords(block);
            // destination is empty, unless you're placing on your starting space
            if (this.board.has(block) && block !== from || to === block) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: block});
                return result;
            }
            // destination is in a straight line
            // `dir` can't be undefined because we already checked the destination is empty
            const dir = RectGrid.bearing(xTo, yTo, xBlock, yBlock)!;
            const ray = this.grid.ray(xTo, yTo, dir).map(pt => this.coords2algebraic(...pt));
            if (!ray.includes(block)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.veletas.STRAIGHTLINE");
                return result;
            }
            // nothing in the way, except potentially the moving piece
            for (const cell of ray) {
                if (cell === block) { break; }
                if (this.board.has(cell) && cell !== from) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: to, to: block, obstruction: cell});
                    return result;
                }
            }

            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): VeletasGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in placement phase") {
            result = {valid: false, message: i18next.t("apgames:validation.veletas.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // Because move generation is quite heavy, we don't do it for placement phase.
            if (!partial && this.stack.length > 2 && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        // Move valid, so change the state
        this.results = [];
        if (this.stack.length < 3) {
            m = this.normalisePlacement(m);
            const [shootersString, ownPiece] = m.split("/");
            const shooters = shootersString.split(",");
            for (const place of shooters) {
                this.board.set(place, 0);
                this.results.push({type: "place", where: place, what: "shooter"});
            }
            if (ownPiece !== undefined) {
                this.board.set(ownPiece, this.currplayer);
                this.results.push({type: "place", where: ownPiece, what: "piece"});
            }
        } else {
            const [from, to, block] = m.split(/[-\/]/);
            let checkTrapped = false;
            if (!this.board.has(from)) {
                this.board.set(from, this.currplayer);
                this.results.push({type: "block", where: from, by: this.getClosestShooter(from)});
                checkTrapped = true;
            } else {
                this.board.delete(from);
                this.board.set(to, 0);
                this.results.push({ type: "move", from, to} );
                if (block !== undefined) {
                    this.board.set(block, this.currplayer);
                    this.results.push({ type: "block", where: block, by: to });
                    checkTrapped = true;
                }
            }
            if (checkTrapped) {
                const trapped = this.getTrapped(block !== undefined ? block : from, this.currplayer);
                for (const [cell, player] of trapped) {
                    this.board.set(cell, player === 1 ? 3 : 4);
                    this.results.push({type: "claim", where: cell, "who": player});
                    this.scores[player - 1]++;
                }
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getTrapped(block: string, player: playerid): Map<string, playerid> {
        // Returns a map of pieces that are blocked and who scores.
        // We check in the vicinity of `block` move.
        // `player` is needed to determine scorer in the case of a tie.
        const neighbours = this.grid.adjacencies(...this.algebraic2coords(block)).map(c => this.coords2algebraic(...c));
        const blocked: Map<string, playerid> = new Map();
        for (const neighbour of neighbours) {
            if (this.board.has(neighbour) && this.board.get(neighbour) === 0) {
                const ns = this.grid.adjacencies(...this.algebraic2coords(neighbour)).map(c => this.coords2algebraic(...c));
                if (ns.every(c => this.board.has(c))) {
                    blocked.set(neighbour, this.getScorer(neighbour, player));
                }
            }
        }
        return blocked;
    }

    private getScorer(shooter: string, player: playerid): playerid {
        // Once `shooter` is trapped, determine who has the largest orthogonally adjacent group to score.
        // `player` is needed to determine scorer in the case of a tie.
        const coords = this.algebraic2coords(shooter);
        const neighbours = this.grid.adjacencies(coords[0], coords[1], false).map(c => this.coords2algebraic(...c));
        const largests = [0, 0];
        for (const neighbour of neighbours) {
            const contents = this.board.get(neighbour);
            if (contents !== 1 && contents !== 2) { continue; }
            const seen: Set<string> = new Set();
            const todo: string[] = [neighbour];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) { continue; }
                seen.add(cell);
                const coords2 = this.algebraic2coords(cell);
                for (const n of this.grid.adjacencies(coords2[0], coords2[1], false).map(c => this.coords2algebraic(...c))) {
                    if (this.board.has(n) && this.board.get(n) === contents) {
                        todo.push(n);
                    }
                }
            }
            largests[contents - 1] = Math.max(largests[contents - 1], seen.size);
        }
        if (largests[player - 1] > largests[player % 2]) {
            return player;
        }
        // If largest group is equal or less than the other player, return other player.
        return player % 2 + 1 as playerid;
    }

    protected checkEOG(): VeletasGame {
        const winThreshold = Math.ceil((this.startingPlacement[0] + this.startingPlacement[1]) / 2);
        if (this.scores[0] >= winThreshold || this.scores[1] >= winThreshold) {
            this.gameover = true;
            this.results.push({type: "eog"});
            this.winner = this.scores[0] > this.scores[1] ? [1] : [2];
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IVeletasState {
        return {
            game: VeletasGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: VeletasGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    switch (contents) {
                        case 0:
                            pstr += "C";
                            break;
                        case 1:
                            pstr += "A";
                            break;
                        case 2:
                            pstr += "B";
                            break;
                        case 3:
                            pstr += "D";
                            break;
                        case 4:
                            pstr += "E";
                            break;
                        default:
                            throw new Error("Unrecognized cell contents.");
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece-square", player: 1 }],
                B: [{ name: "piece-square", player: 2 }],
                C: [{ name: "chess-queen-solid-millenia", player: 3 }],
                // Trapped shooters.
                D: [{ name: "chess-queen-solid-millenia", player: 1 }],
                E: [{ name: "chess-queen-solid-millenia", player: 2 }],
            },
            pieces: pstr,
        };

        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "block") {
                    const [shootX, shootY] = this.algebraic2coords(move.where!);
                    const [fromX, fromY] = this.algebraic2coords(move.by!);
                    rep.annotations.push({type: "move", style: "dashed", targets: [{row: fromY, col: fromX}, {row: shootY, col: shootX}]});
                }
            }
        }
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    private getClosestShooter(cell: string): string | undefined {
        // Get closest shooter to a point for stationary shooting annotations.
        let closest: string | undefined;
        let closestDistance = Infinity;
        for (const dir of allDirections) {
            const ray = this.grid.ray(...this.algebraic2coords(cell), dir);
            for (const [i, c] of ray.map(pt => this.coords2algebraic(...pt)).entries()) {
                if (this.board.has(c) && this.board.get(c) === 0) {
                    if (i < closestDistance) {
                        closest = c;
                        closestDistance = i;
                    }
                    break;
                }
            }
        }
        return closest;
    }


    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Score**:\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: this.scores }];
    }

    public chatLog(players: string[]): string[][] {
        // chatLog to get players' names.
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "move":
                                node.push(i18next.t("apresults:MOVE.veletas", {player: name, from: r.from, to: r.to}));
                                break;
                            case "block":
                                node.push(i18next.t("apresults:BLOCK.veletas", {player: name, where: r.where}));
                                break;
                            case "place":
                                node.push(i18next.t("apresults:PLACE.veletas", {player: name, what: r.what, where: r.where}));
                                break;
                            case "claim":
                                node.push(i18next.t("apresults:CLAIM.veletas", {where: r.where, who: r.who !== state.currplayer ? name : players.filter(p => p !== name)[0]}));
                                break;
                            case "eog":
                                node.push(i18next.t("apresults:EOG"));
                                break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1];
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "timeout":
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1];
                                }
                                node.push(i18next.t("apresults:TIMEOUT", {player: tname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): VeletasGame {
        return new VeletasGame(this.serialize());
    }
}
