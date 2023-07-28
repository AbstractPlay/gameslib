import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Directions, allDirections, oppositeDirections } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    stones: string[];
};

export interface IEpamState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EpamGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Epaminondas",
        uid: "epam",
        playercounts: [2],
        version: "20211117",
        // i18next.t("apgames:descriptions.epam")
        description: "apgames:descriptions.epam",
        urls: ["http://www.logicmazes.com/games/epam.html"],
        people: [
            {
                type: "designer",
                name: "Robert Abbott",
                urls: ["https://www.logicmazes.com/"]
            }
        ],
        variants: [
            {
                uid: "stones",
                group: "setup"
            }
        ],
        flags: ["perspective"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 12);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 12);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public stones: string[] = [];

    constructor(state?: IEpamState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            for (let row = 0; row < 2; row++) {
                for (let col = 0; col < 14; col++) {
                    board.set(EpamGame.coords2algebraic(col, row), 2);
                }
            }
            for (let row = 10; row < 12; row++) {
                for (let col = 0; col < 14; col++) {
                    board.set(EpamGame.coords2algebraic(col, row), 1);
                }
            }
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "stones") ) {
                this.variants = ["stones"];
            }
            const fresh: IMoveState = {
                _version: EpamGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stones: []
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEpamState;
            }
            if (state.game !== EpamGame.gameinfo.uid) {
                throw new Error(`The Epaminondas engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): EpamGame {
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
        this.stones = [...state.stones];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        if ( (this.variants.includes("stones")) && (this.stones.length < 3) ) {
            for (let row = 3; row <= 8; row++) {
                for (let col = 0; col < 14; col++) {
                    const cell = EpamGame.coords2algebraic(col, row);
                    if (! this.stones.includes(cell)) {
                        moves.push(cell);
                    }
                }
            }
            return moves;
        }

        // For each piece, look for valid phalanxes in each direction
        const grid = new RectGrid(14, 12);
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const cell of pieces) {
            for (const dir of allDirections) {
                const phalanx = this.phalanx(cell, dir);
                if (phalanx !== undefined) {
                    const head = phalanx[phalanx.length - 1];
                    const [xHead, yHead] = EpamGame.algebraic2coords(head);
                    const ray = grid.ray(xHead, yHead, dir);
                    for (let i = 0; i < phalanx.length; i++) {
                        // If index is in range, get the possible destination
                        if (ray.length <= i) {
                            break;
                        }
                        const next = EpamGame.coords2algebraic(...ray[i]);
                        // if it's occupied by a stone, then abort
                        if (this.stones.includes(next)) {
                            break;
                        // If it's empty, this is a valid move
                        // Add it to the list and continue
                        } else if (! this.board.has(next)) {
                            moves.push(`${cell}-${next}`);
                            continue;
                        } else {
                            // If it's occupied by a friendly, abort
                            if (this.board.get(next)! === player) {
                                break;
                            // If it's occupied by an enemy, see if a capture is possible
                            } else {
                                const enemyPhalanx = this.phalanx(next, dir, false)!;
                                if (enemyPhalanx.length < phalanx.length) {
                                    moves.push(`${cell}x${next}`);
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    /**
     * A valid phalanx is the starting piece, followed optionally by an unroken line of friendly pieces.
     * For movement purposes, the phalanx must be terminated, meaning followed by an empty space.
     * For capturing purposes, though, you want to identify phalanxes even if they are against a board edge.
     * If `wantmoves` is true, then it only returns phalanxes terminated with an empty space.
     *
     * @private
     * @param {string} start
     * @param {Directions} dir
     * @param {boolean} [wantmoves=false]
     * @returns {(string[] | undefined)}
     * @memberof EpamGame
     */
    public phalanx(start: string, dir: Directions, wantmoves = true): string[] | undefined {
        const phalanx: string[] = [start];
        const player = this.board.get(start)!;
        const grid = new RectGrid(14, 12);
        const ray = grid.ray(...EpamGame.algebraic2coords(start), dir).map(p => EpamGame.coords2algebraic(...p));
        for (const cell of ray) {
            // If the cell is empty, phalanx is complete
            if (! this.board.has(cell)) {
                return [...phalanx];
            } else {
                // If the cell is a stone, respect `wantmoves`
                if (this.stones.includes(cell)) {
                    if (wantmoves) {
                        return;
                    } else {
                        return [...phalanx];
                    }
                // If the cell is occupied by an enemy piece, phalanx is complete
                } else if (this.board.get(cell)! !== player) {
                    return [...phalanx];
                // Otherwise it's friendly; add it to the phalanx and keep going
                } else {
                    phalanx.push(cell);
                }
            }
        }
        // If we got here, then we've hit the edge of the board. Respect `wantmoves`.
        if (wantmoves) {
            return;
        } else {
            return [...phalanx];
        }
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = EpamGame.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                if (this.board.has(cell)) {
                    newmove = cell;
                } else if ( (this.variants.includes("stones")) && (this.stones.length < 3) ) {
                    newmove = cell;
                } else {
                    return {move: "", message: ""} as IClickResult;
                }
            } else {
                const [prev,rest] = move.split(/[-x]/);
                if ( (cell === prev) || (cell === rest) ) {
                    newmove = cell;
                } else if ( (this.board.has(cell)) && (this.board.get(cell)! !== this.currplayer) ) {
                    newmove = `${prev}x${cell}`;
                } else if (! this.board.has(cell)) {
                    newmove = `${prev}-${cell}`;
                } else {
                    return {move: "", message: ""} as IClickResult;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if ( (this.variants.includes("stones")) && (this.stones.length < 3) ) {
                result.message = i18next.t("apgames:validation.epam.INITIAL_INSTRUCTIONS", {context: "stones"});
            } else {
                result.message = i18next.t("apgames:validation.epam.INITIAL_INSTRUCTIONS", {context: "move"});
            }
            return result;
        }

        // moves and captures
        if ( (m.includes("-")) || (m.includes("x")) ) {
            const [from, to] = m.split(/[-x]/);
            // cells are valid
            for (const cell of [from, to]) {
                try {
                    EpamGame.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }
            const [xFrom, yFrom] = EpamGame.algebraic2coords(from);
            const [xTo, yTo] = EpamGame.algebraic2coords(to);

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
            // from is yours
            if (this.board.get(from)! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // correct operator was used
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
            // cells are directly orthogonal or diagonal
            if ( (! RectGrid.isOrth(xFrom, yFrom, xTo, yTo)) && (! RectGrid.isDiag(xFrom, yFrom, xTo, yTo)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.epam.STRAIGHTLINE");
                return result;
            }
            // Now gather data on the phalanx
            const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo);
            const phalanx = this.phalanx(from, bearing!, true);
            if (phalanx === undefined) {
                throw new Error("Could not find a phalanx. This really should not be happening at this point.");
            }
            const head = phalanx[phalanx.length - 1];
            const [xHead, yHead] = EpamGame.algebraic2coords(head);
            // distance is appropriate
            const distance = RectGrid.distance(xHead, yHead, xTo, yTo);
            if (distance > phalanx.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.epam.TOOFAR", {tail: from, head, to, distance});
                return result;
            }
            // no obstructions
            if (this.stones.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: head, to, obstruction: to});
                return result;
            }
            const between = RectGrid.between(xHead, yHead, xTo, yTo).map(pt => EpamGame.coords2algebraic(...pt));
            for (const cell of between) {
                if ( (this.board.has(cell)) || (this.stones.includes(cell)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: head, to, obstruction: cell});
                    return result;
                }
            }

            // for captures
            if (m.includes("x")) {
                // must be an enemy piece
                if (this.board.get(to)! === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }
                // opposing phalanx must be smaller than yours
                const otherPhalanx = this.phalanx(to, bearing!, false);
                if (otherPhalanx!.length >= phalanx.length) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.epam.INSUFFICIENT_FORCES");
                    return result;
                }
            }

            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        // otherwise, partials or stone placement
        } else {
            // valid cell
            try {
                EpamGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            if (! this.board.has(m)) {
                if ( (this.variants.includes("stones")) && (this.stones.length < 3) ) {
                    const [,y] = EpamGame.algebraic2coords(m);
                    if ( (y >= 3) && (y <= 8) ) {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.epam.STONES");
                        return result;
                    }
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.epam.NOPLACEMENT");
                    return result;
                }
            } else {
                // stone is yours
                if (this.board.get(m)! !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                } else {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.epam.PARTIAL");
                    return result;
                }
            }
        }
    }

    public move(m: string): EpamGame {
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

        if ( (m.includes("-")) || (m.includes("x")) ) {
            const grid = new RectGrid(14, 12);
            const [from, to] = m.split(/[-x]/);
            const [xFrom, yFrom] = EpamGame.algebraic2coords(from);
            const [xTo, yTo] = EpamGame.algebraic2coords(to);
            const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const oppDir = oppositeDirections.get(dir)!;
            const reverseRay = [to, ...grid.ray(xTo, yTo, oppDir).map(r => EpamGame.coords2algebraic(...r))];
            const phalanx = this.phalanx(from, dir)!;
            let enemyPhalanx: string[] | undefined;
            if (this.board.has(to)) {
                enemyPhalanx = this.phalanx(to, dir, false);
            }

            // If there's an enemy phalanx, capture it
            if (enemyPhalanx !== undefined) {
                for (const cell of enemyPhalanx) {
                    this.board.delete(cell);
                    this.results.push({type: "capture", where: cell})
                }
            }

            // Now delete the moving phalanx
            for (const cell of phalanx) {
                this.board.delete(cell);
            }

            // Place the new phalanx starting from the target, moving in the opposite direction
            for (let i = 0; i < phalanx.length; i++) {
                this.board.set(reverseRay[i], this.currplayer);
            }
            this.results.push({type: "move", from, to});
        } else {
            this.stones.push(m);
            this.results.push({type: "place", where: m});
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

    protected checkEOG(): EpamGame {
        const targets = [/12$/, /\D1$/];
        let prevPlayer = 1 as playerid;
        if (this.currplayer === 1) {
            prevPlayer = 2 as playerid;
        }
        const mytarget = targets[this.currplayer - 1];
        const theirtarget = targets[prevPlayer - 1];
        const mypieces = [...this.board.entries()].filter(e => (mytarget.test(e[0])) && (e[1] === this.currplayer));
        const theirpieces = [...this.board.entries()].filter(e => (theirtarget.test(e[0])) && (e[1] === prevPlayer));
        // Current player has no moves (they have no pieces left, which almost never happens)
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        // Current player has more pieces on opponent's home row than they have on his
        } else if (mypieces.length > theirpieces.length) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IEpamState {
        return {
            game: EpamGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EpamGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            stones: [...this.stones],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 12; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 14; col++) {
                const cell = EpamGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else if (this.stones.includes(cell)) {
                    pieces.push("X");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{14}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 14,
                height: 12,
                markers: [
                    {
                        type: "shading",
                        colour: 2,
                        points: [
                            {row: 0, col: 0},
                            {row: 0, col: 14},
                            {row: 1, col: 14},
                            {row: 1, col: 0}
                        ]
                    },
                    {
                        type: "shading",
                        colour: 1,
                        points: [
                            {row: 11, col: 0},
                            {row: 11, col: 14},
                            {row: 12, col: 14},
                            {row: 12, col: 0}
                        ]
                    }
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
                X: {
                    name: "piece-square",
                    colour: "#000"
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = EpamGame.algebraic2coords(move.from);
                    const [toX, toY] = EpamGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = EpamGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "place") {
                    const [x, y] = EpamGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, promote, deltaScore
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                let captureCount = 0;
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "capture":
                            captureCount++;
                            break;
                        case "place":
                            node.push(i18next.t("apresults:PLACE.epam", {player: name, where: r.where}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
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
                if (captureCount > 0) {
                    node.push(i18next.t("apresults:CAPTURE.multiple", {count: captureCount}));
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): EpamGame {
        return new EpamGame(this.serialize());
    }
}
