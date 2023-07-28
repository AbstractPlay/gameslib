/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
type CellContents = [playerid, number];

const targetRows = new Map<playerid, number>([[1, 0], [2, 7]]);

interface ILooseObj {
    [key: string]: any;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    scores: [number,number];
    lastmove?: string;
};

export interface IBoomState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BoomGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Boom & Zoom",
        uid: "boom",
        playercounts: [2],
        version: "20230718",
        // i18next.t("apgames:descriptions.boom")
        description: "apgames:descriptions.boom",
        urls: ["https://boardgamegeek.com/boardgame/243927/boom-zoom-second-edition"],
        people: [
            {
                type: "designer",
                name: "Ty Bomba",
            },
        ],
        flags: ["scores","perspective"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public scores: [number,number] = [0,0];
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IBoomState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>([
                ["c1", [1, 3]], ["d1", [1, 3]], ["e1", [1, 3]], ["f1", [1, 3]],
                ["c8", [2, 3]], ["d8", [2, 3]], ["e8", [2, 3]], ["f8", [2, 3]],
            ]);
            const fresh: IMoveState = {
                _version: BoomGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                scores: [0,0],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBoomState;
            }
            if (state.game !== BoomGame.gameinfo.uid) {
                throw new Error(`The Boom engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BoomGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.scores = [...state.scores];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = new Set<string>();

        const grid = new RectGrid(8,8);
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player);

        for (const [cell, [,stack]] of pieces) {
            const [xcell, ycell] = BoomGame.algebraic2coords(cell);
            for (let dist = 1; dist <= stack; dist++) {
                for (const dir of allDirections) {
                    // get ray of cells
                    const ray = grid.ray(xcell, ycell, dir).map(pt => BoomGame.coords2algebraic(...pt)).slice(0, dist);
                    // for movement, every cell must be empty
                    if ( (ray.length > 0) && (ray.filter(c => this.board.has(c)).length === 0) ) {
                        let to: string | undefined;
                        // if we didn't hit a board edge, we know we're good
                        if (ray.length === dist) {
                            to = ray[dist - 1];
                        }
                        // if we didn't hit the target row, we're also good
                        else if (! ray[ray.length - 1].endsWith((8 - targetRows.get(player)!).toString())) {
                            to = ray[ray.length - 1];
                        }
                        if (to === undefined) {
                            moves.add(`${cell}-off`);
                        } else {
                            moves.add(`${cell}-${to}`);
                        }
                    } else if (ray.length > 0) {
                        const first = ray.filter(c => this.board.has(c))[0];
                        const [owner,] = this.board.get(first)!;
                        if (owner !== player) {
                            moves.add(`${cell}x${first}`);
                        }
                    } else if ( (ray.length === 0) && (ycell === targetRows.get(this.currplayer)!) ) {
                        moves.add(`${cell}-off`)
                    }
                }
            }
        }

        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let cell: string | undefined;
            if (col >= 0) {
                cell = BoomGame.coords2algebraic(col, row);
            }
            let newmove = "";
            if (move.length > 0) {
                const [from,] = move.split(/[\-x]/);
                if (cell === undefined) {
                    newmove = `${from}-off`;
                } else if (! this.board.has(cell)) {
                    newmove = `${from}-${cell}`;
                } else if (this.board.get(cell)![0] !== this.currplayer) {
                    newmove = `${from}x${cell}`;
                }
            } else if ( (cell !== undefined) && (this.board.has(cell)) && (this.board.get(cell)![0] === this.currplayer) ) {
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
        const grid = new RectGrid(8,8);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.boom.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [from, to] = m.split(/[\-x]/);
        let xFrom: number; let yFrom: number;
        try {
            [xFrom, yFrom] = BoomGame.algebraic2coords(from);
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
            result.message = i18next.t("apgames:validation.boom.PARTIAL");
            return result;
        // if you're bearing off
        } else if (to === "off") {
            // you can reach the target row
            const dist = Math.abs(yFrom - targetRows.get(this.currplayer)!) + 1;
            const myStack = this.board.get(from)![1];
            if (myStack < dist) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.boom.TOOFAR");
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
                [xTo, yTo] = BoomGame.algebraic2coords(to);
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
            const ray = grid.ray(xFrom, yFrom, bearing).map(pt => BoomGame.coords2algebraic(...pt));
            if (! ray.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOLOS", {from, to});
                return result;
            }
            // correct operator
            if (m.includes("-")) {
                // is the space empty
                if (this.board.has(to)) {
                    if (this.board.get(to)![0] !== this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                        return result;
                    }
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
            }
            // unobstructed
            const between = RectGrid.between(xFrom, yFrom, xTo, yTo).map(n => BoomGame.coords2algebraic(...n));
            for (const cell of between) {
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
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

    public move(m: string): BoomGame {
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

        const [from, to] = m.split(/[\-x]/);
        if (m.includes("-")) {
            const contents = this.board.get(from)!;
            if (to === "off") {
                // get closest edge
                let closestCell: string | undefined;
                const [xFrom, yFrom] = BoomGame.algebraic2coords(from);
                for (let x = 0; x < 8; x++) {
                    const [xTo, yTo] = [x, targetRows.get(this.currplayer)!];
                    if (yTo === yFrom) {
                        closestCell = from;
                    } else if ( (RectGrid.isOrth(xFrom, yFrom, xTo, yTo)) || (RectGrid.isDiag(xFrom, yFrom, xTo, yTo)) ) {
                        const between = [[xTo, yTo] as [number,number], ...RectGrid.between(xFrom, yFrom, xTo, yTo)].map(n => BoomGame.coords2algebraic(...n));
                        if (between.filter(c => this.board.has(c)).length === 0) {
                            closestCell = BoomGame.coords2algebraic(xTo, yTo);
                        }
                    }
                    if (closestCell !== undefined) { break; }
                }
                if (closestCell === undefined) {
                    throw new Error("Could not find a closest cell when bearing off a piece.");
                }
                this.results.push({type: "bearoff", from, what: contents[1].toString(), edge: closestCell})
                this.results.push({type: "deltaScore", delta: contents[1]});
                this.scores[this.currplayer - 1] += contents[1];
            } else {
                this.board.set(to, [...contents]);
                this.results.push({type: "move", from, to, what: contents[1].toString()});
            }
            this.board.delete(from);
        } else {
            this.results.push({type: "damage", where: to});
            const target = this.board.get(to)!;
            if (target[1] === 1) {
                this.board.delete(to);
                this.results.push({type: "destroy", where: to});
            } else {
                this.board.set(to, [target[0], target[1] - 1]);
            }
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

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    protected checkEOG(): BoomGame {
        const numPieces1 = [...this.board.values()].filter(c => c[0] === 1).length;
        const numPieces2 = [...this.board.values()].filter(c => c[0] === 2).length;
        if ( (numPieces1 === 0) || (numPieces2 === 0) ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score2 > score1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
            }
        }
        if (this.gameover === true) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IBoomState {
        return {
            game: BoomGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BoomGame.gameinfo.version,
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
        const aStacks: Set<number> = new Set();
        const bStacks: Set<number> = new Set();
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = BoomGame.coords2algebraic(col, row);
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
        pstr = pstr.replace(/\n,{7}(?=\n)/g, "\n_");
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
                width: 8,
                height: 8,
                buffer: {
                    width: 0.2,
                    pattern: "slant",
                    show: ["N","S"],
                },
                markers: [
                    {
                        type: "edge",
                        colour: 1,
                        edge: "S",
                    },
                    {
                        type: "edge",
                        colour: 2,
                        edge: "N",
                    }
                ]
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = BoomGame.algebraic2coords(move.from);
                    const [toX, toY] = BoomGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "damage") {
                    const [x, y] = BoomGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "bearoff") {
                    const [fromX, fromY] = BoomGame.algebraic2coords(move.from);
                    const [x, y] = BoomGame.algebraic2coords(move.edge!);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: y, col: x}]});
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "damage", "destroy", "bearoff", "eog", "winners"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", {count: parseInt(r.what!, 10), player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "damage":
                node.push(i18next.t("apresults:CAPTURE.boom", {player, where: r.where}));
                resolved = true;
                break;
            case "bearoff":
                node.push(i18next.t("apresults:BEAROFF.complete", {player, from: r.from, count: parseInt(r.what!, 10)}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        status += `**Scores**\n\nPlayer 1: ${this.getPlayerScore(1)}\n\nPlayer 2: ${this.getPlayerScore(2)}`;

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public clone(): BoomGame {
        return new BoomGame(this.serialize());
    }
}
