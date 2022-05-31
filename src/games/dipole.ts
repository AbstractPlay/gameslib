/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections, Directions } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
type CellContents = [playerid, number];

const dirsForward: Directions[][] = [["NW", "N", "NE"], ["SE", "S", "SW"]];

interface ILooseObj {
    [key: string]: any;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface IDipoleState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class DipoleGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Dipole",
        uid: "dipole",
        playercounts: [2],
        version: "20211213",
        // i18next.t("apgames:descriptions.dipole")
        description: "apgames:descriptions.dipole",
        urls: ["http://www.marksteeregames.com/Dipole_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"]
            },
        ],
        variants: [
            {
                uid: "international",
                name: "Larger board: 10x10",
            },
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public boardsize = 8;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IDipoleState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] === "international") ) {
                this.variants = ["international"];
            }
            let board = new Map<string, CellContents>([
                ["e1", [1, 12]], ["d8", [2, 12]]
            ]);
            if (this.variants.includes("international")) {
                board = new Map<string, CellContents>([
                    ["e1", [1, 20]], ["f10", [2, 20]]
                ]);
            }
            const fresh: IMoveState = {
                _version: DipoleGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDipoleState;
            }
            if (state.game !== DipoleGame.gameinfo.uid) {
                throw new Error(`The Dipole engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DipoleGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        if (this.variants.includes("international")) {
            this.boardsize = 10;
        } else {
            this.boardsize = 8;
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(this.boardsize, this.boardsize);
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player);

        for (const piece of pieces) {
            const from = piece[0];
            const [xFrom, yFrom] = DipoleGame.algebraic2coords(from, this.boardsize);
            const stack = piece[1][1];
            const dirs: Directions[] = dirsForward[player - 1];
            for (let sub = 1; sub <= stack; sub++) {
                // noncapturing moves first
                for (const dir of dirs) {
                    // If moving forward, you can only do so in even increments
                    if ( (dir.length === 1) && (sub % 2 !== 0) ) {
                        continue;
                    }
                    const ray = grid.ray(xFrom, yFrom, dir).map(pt => DipoleGame.coords2algebraic(...pt, this.boardsize));
                    let to: string | undefined;
                    if (ray.length >= sub) {
                        to = ray[sub - 1];
                    }
                    if (to === undefined) {
                        moves.push(`${from}-off`);
                    } else if (! this.board.has(to)) {
                        moves.push(`${from}-${to}`);
                    } else if (this.board.get(to)![0] === player) {
                        moves.push(`${from}+${to}`);
                    }
                }

                // capturing moves
                for (const dir of allDirections) {
                    // If moving in straight lines, you can only do so in even increments
                    if ( (dir.length === 1) && (sub % 2 !== 0) ) {
                        continue;
                    }
                    const ray = grid.ray(xFrom, yFrom, dir).map(pt => DipoleGame.coords2algebraic(...pt, this.boardsize));
                    let to: string | undefined;
                    if (ray.length >= sub) {
                        to = ray[sub - 1];
                    }
                    if ( (to !== undefined) && (this.board.has(to)) && (this.board.get(to)![0] !== player) ) {
                        const enemyStack = this.board.get(to)![1];
                        if (sub >= enemyStack) {
                            moves.push(`${from}x${to}`);
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let cell: string | undefined;
            if (col >= 0) {
                cell = DipoleGame.coords2algebraic(col, row, this.boardsize);
            }
            let newmove = "";
            if (move.length > 0) {
                const [from,] = move.split(/[\+\-x]/);
                // if you clicked on the original cell again, reset
                if (from === cell) {
                    return {move: "", message: ""} as IClickResult;
                } else if (cell === undefined) {
                    newmove = `${from}-off`;
                } else if (! this.board.has(cell)) {
                    newmove = `${from}-${cell}`;
                } else {
                    if (this.board.get(cell)![0] !== this.currplayer) {
                        const myStack = this.board.get(from)![1];
                        const theirStack = this.board.get(cell)![1];
                        if (myStack >= theirStack) {
                            newmove = `${from}x${cell}`;
                        }
                    } else {
                        newmove = `${from}+${cell}`;
                    }
                }
            } else if ( (cell !== undefined) && (this.board.has(cell)) && (this.board.get(cell)![0] === this.currplayer) ) {
                newmove = cell;
            } else {
                return {move: "", message: ""} as IClickResult;
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
        const grid = new RectGrid(this.boardsize, this.boardsize);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.dipole.INITIAL_INSTRUCTIONS")
            return result;
        }

        // pass is allowed if you have no other moves
        if (m === "pass") {
            if (! this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.dipole.INVALID_PASS");
                return result;
            }

            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE")
            return result;
        }

        const [from, to] = m.split(/[\+\-x]/);
        let xFrom: number; let yFrom: number;
        try {
            [xFrom, yFrom] = DipoleGame.algebraic2coords(from, this.boardsize);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // `from` has a piece
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        if (this.board.get(from)![0] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // valid partial, if no `to`
        if ( (to === undefined) || (to.length === 0) ) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.dipole.PARTIAL");
            return result;
        // if you're bearing off
        } else if (to === "off") {
            // you can reach the closest edge
            let closest: [number, number][] | undefined;
            for (const dir of dirsForward[this.currplayer - 1]) {
                const ray = grid.ray(xFrom, yFrom, dir);
                if ( (closest === undefined) || (ray.length < closest.length) ) {
                    closest = [...ray];
                }
            }
            const myStack = this.board.get(from)![1];
            if (myStack <= closest!.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.dipole.TOOFAR", {context: "edge", from});
                return result;
            }

            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE")
            return result;

        // all other situations
        } else {
            let xTo: number; let yTo: number;
            try {
                [xTo, yTo] = DipoleGame.algebraic2coords(to, this.boardsize);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // cells are different
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // line of sight
            const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const ray = grid.ray(xFrom, yFrom, bearing).map(pt => DipoleGame.coords2algebraic(...pt, this.boardsize));
            if (! ray.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOLOS", {from, to});
                return result;
            }
            // correct operator
            if (m.includes("-")) {
                // is the space empty
                if (this.board.has(to)) {
                    if (this.board.get(to)![0] === this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.dipole.MOVE4MERGE", {where: to});
                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                        return result;
                    }
                }
                // is in forward direction
                const dirs = dirsForward[this.currplayer - 1];
                if (! dirs.includes(bearing)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.dipole.FORWARD");
                    return result;
                }
            } else if (m.includes("+")) {
                // space is occupied
                if (! this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.dipole.MERGE4MOVE", {where: to});
                    return result;
                }
                // stack belongs to you
                if (this.board.get(to)![0] !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.dipole.MERGE4CAPTURE", {where: to});
                    return result;
                }
                // is in forward direction
                const dirs = dirsForward[this.currplayer - 1];
                if (! dirs.includes(bearing)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.dipole.FORWARD");
                    return result;
                }
            } else {
                // is there a piece to capture
                if (! this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                    return result;
                }
                // is it an enemy piece
                if (this.board.get(to)![0] === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }
                // is your stack the same size or larger
                const myStack = RectGrid.distance(...DipoleGame.algebraic2coords(from, this.boardsize), ...DipoleGame.algebraic2coords(to, this.boardsize));
                const theirStack = this.board.get(to)![1];
                if (myStack < theirStack) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.dipole.STACK_SIZE");
                    return result;
                }
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string): DipoleGame {
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
        const grid = new RectGrid(this.boardsize, this.boardsize);

        if (m !== "pass") {
            const [from, to] = m.split(/[\+\-x]/);
            const stackFrom = this.board.get(from)![1];
            const [xFrom, yFrom] = DipoleGame.algebraic2coords(from, this.boardsize);
            if (to === "off") {
                // get closest edge
                let closest: number | undefined;
                let closestCell: string | undefined;
                for(const dir of dirsForward[this.currplayer - 1]) {
                    const ray = grid.ray(xFrom, yFrom, dir);
                    let dist = ray.length + 1;
                    if ( (dir.length === 1) && (dist % 2 !== 0) ) {
                        dist++;
                    }
                    if ( (closest === undefined) || (dist < closest) ) {
                        closest = dist;
                        if (ray.length > 0) {
                            closestCell = DipoleGame.coords2algebraic(...ray[ray.length - 1], this.boardsize);
                        }
                    }
                }
                if (stackFrom > closest!) {
                    this.board.set(from, [this.currplayer, stackFrom - closest!]);
                } else {
                    this.board.delete(from);
                }
                this.results.push({type: "bearoff", from, what: closest!.toString(), edge: closestCell});
            } else {
                const [xTo, yTo] = DipoleGame.algebraic2coords(to, this.boardsize);
                const distance = RectGrid.distance(xFrom, yFrom, xTo, yTo);
                this.results.push({type: "move", from, to, what: distance.toString()});
                const newFrom = stackFrom - distance;
                if (this.board.has(to)) {
                    const stackTo = this.board.get(to)![1];
                    if (this.board.get(to)![0] === this.currplayer) {
                        this.board.set(to, [this.currplayer, stackTo + distance]);
                        if (newFrom > 0) {
                            this.board.set(from, [this.currplayer, newFrom]);
                        } else {
                            this.board.delete(from);
                        }
                    } else {
                        this.board.set(to, [this.currplayer, distance]);
                        if (newFrom > 0) {
                            this.board.set(from, [this.currplayer, newFrom]);
                        } else {
                            this.board.delete(from);
                        }
                        this.results.push({type: "capture", what: stackTo.toString(), where: to});
                    }
                } else {
                    this.board.set(to, [this.currplayer, distance]);
                    if (newFrom > 0) {
                        this.board.set(from, [this.currplayer, newFrom]);
                    } else {
                        this.board.delete(from);
                    }
                }
            }
        } else {
            this.results.push({type: "pass"});
        }

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

    protected checkEOG(): DipoleGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // if the previous player has no more pieces, you win
        const pieces = [...this.board.entries()].filter(e => e[1][0] === prevPlayer);
        if (pieces.length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IDipoleState {
        return {
            game: DipoleGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DipoleGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const aStacks: Set<number> = new Set();
        const bStacks: Set<number> = new Set();
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = DipoleGame.coords2algebraic(col, row, this.boardsize);
                if (this.board.has(cell)) {
                    const [player, stack] = this.board.get(cell)!;
                    let key = "";
                    if (player === 1) {
                        key = `X${stack.toString()}`;
                        aStacks.add(stack);
                    } else {
                        key = `Y${stack.toString()}`;
                        bStacks.add(stack);
                    }
                    pieces.push(key);
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        if (this.variants.includes("international")) {
            pstr = pstr.replace(/\n,{9}(?=\n)/g, "\n_");
        } else {
            pstr = pstr.replace(/\n,{7}(?=\n)/g, "\n_");
        }
        const stacks: Set<number>[] = [aStacks, bStacks];

        // build legend based on stack sizes
        const myLegend: ILooseObj = {
            X1: {
                name: "piece",
                player: 1,
            },
            Y1: {
                name: "piece",
                player: 2,
            }
        };
        for (let p = 0; p < stacks.length; p++) {
            const player = p + 1
            let letter = "";
            if (player === 1) {
                letter = "X";
            } else {
                letter = "Y";
            }
            const mystacks = stacks[p];
            for (const val of mystacks) {
                if (val > 1) {
                    const key = `${letter}${val.toString()}`;
                    myLegend[key] = [
                        {
                            name: "piece",
                            player
                        },
                        {
                            text: val.toString(),
                            colour: "#000",
                            scale: 0.75
                        }
                    ];
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
                buffer: {
                    width: 0.2,
                    pattern: "slant",
                }
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = DipoleGame.algebraic2coords(move.from, this.boardsize);
                    const [toX, toY] = DipoleGame.algebraic2coords(move.to, this.boardsize);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = DipoleGame.algebraic2coords(move.where!, this.boardsize);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "bearoff") {
                    let x: number; let y: number;
                    if (move.edge !== undefined) {
                        [x, y] = DipoleGame.algebraic2coords(move.edge, this.boardsize);
                    } else {
                        [x, y] = DipoleGame.algebraic2coords(move.from, this.boardsize);
                    }
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of DipoleGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", {count: parseInt(r.what!, 10), player: player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.nowhere", {count: parseInt(r.what!, 10)}));
            resolved = true;
            break;
        }
        return resolved;
    }

    public totalDist(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        let far = 0;
        if (player === 2) {
            far = this.boardsize - 1;
        }
        let distance = 0;

        const pieces = [...this.board.entries()].filter(e => e[1][0] === player).map(e => {
            const pt = DipoleGame.algebraic2coords(e[0], this.boardsize);
            return {y: pt[1], size: e[1][1]};
        });
        for (const piece of pieces) {
            distance += piece.size * (Math.abs(far - piece.y) + 1);
        }

        return distance;
    }

    public status(): string {
        let status = super.status();

        const d1 = this.totalDist(1);
        const d2 = this.totalDist(2);
        status += `**Distances**\n\nPlayer 1: ${d1}\n\nPlayer 2: ${d2}`;

        return status;
    }

    public clone(): DipoleGame {
        return new DipoleGame(this.serialize());
    }
}
