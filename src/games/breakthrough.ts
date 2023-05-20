import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Directions } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

const dirsForward: Directions[][] = [["NW", "N", "NE"], ["SE", "S", "SW"]];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IBreakthroughState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BreakthroughGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Breakthrough",
        uid: "breakthrough",
        playercounts: [2],
        version: "20211118",
        // i18next.t("apgames:descriptions.breakthrough")
        description: "apgames:descriptions.breakthrough",
        urls: ["https://en.wikipedia.org/wiki/Breakthrough_(board_game)", "http://www.di.fc.ul.pt/~jpn/gv/bombardment.htm"],
        people: [
            {
                type: "designer",
                name: "Dan Troyka",
            },
            {
                type: "designer",
                name: "Chris Huntoon"
            }
        ],
        variants: [
            {
                uid: "bombardment"
            }
        ],
        flags: ["perspective"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IBreakthroughState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>([
                ["a1", 1], ["b1", 1], ["c1", 1], ["d1", 1], ["e1", 1], ["f1", 1], ["g1", 1], ["h1", 1],
                ["a2", 1], ["b2", 1], ["c2", 1], ["d2", 1], ["e2", 1], ["f2", 1], ["g2", 1], ["h2", 1],
                ["a7", 2], ["b7", 2], ["c7", 2], ["d7", 2], ["e7", 2], ["f7", 2], ["g7", 2], ["h7", 2],
                ["a8", 2], ["b8", 2], ["c8", 2], ["d8", 2], ["e8", 2], ["f8", 2], ["g8", 2], ["h8", 2],
            ]);
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "bombardment") ) {
                this.variants = ["bombardment"];
            }
            const fresh: IMoveState = {
                _version: BreakthroughGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBreakthroughState;
            }
            if (state.game !== BreakthroughGame.gameinfo.uid) {
                throw new Error(`The Breakthrough engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BreakthroughGame {
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

        const grid = new RectGrid(8, 8);
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const dirs = dirsForward[player - 1];
        for (const piece of pieces) {
            const [x, y] = BreakthroughGame.algebraic2coords(piece);
            for (const dir of dirs) {
                const ray = grid.ray(x, y, dir);
                if (ray.length > 0) {
                    const [xNext, yNext] = ray[0];
                    const next = BreakthroughGame.coords2algebraic(xNext, yNext);
                    if (! this.board.has(next)) {
                        moves.push(`${piece}-${next}`);
                    } else {
                        const owner = this.board.get(next)!;
                        if ( (owner !== player) && (dir.length === 2) && (! this.variants.includes("bombardment")) ) {
                            moves.push(`${piece}x${next}`);
                        }
                    }
                }
            }
            // Bombardment moves are always possible when the variant is active
            if (this.variants.includes("bombardment")) {
                moves.push(`x${piece}`);
            }
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = BreakthroughGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length > 0) {
                if ( (this.variants.includes("bombardment")) && (move === cell) ) {
                    newmove = `x${cell}`;
                } else if (move.startsWith("x")) {
                    newmove = cell;
                } else {
                    let prev = move;
                    if (move.includes("-")) {
                        prev = move.split("-")[0];
                    }
                    const [xPrev, yPrev] = BreakthroughGame.algebraic2coords(prev);
                    if (Math.max(Math.abs(col - xPrev), Math.abs(row - yPrev)) === 1) {
                        if (this.board.has(cell)) {
                            if (this.board.get(cell)! !== this.currplayer) {
                                newmove = `${prev}x${cell}`;
                            } else {
                                newmove = cell;
                            }
                        } else {
                            newmove = `${prev}-${cell}`;
                        }
                    } else if (this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        return {move: "", message: ""} as IClickResult;
                    }
                }
            } else if (this.board.has(cell)) {
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.breakthrough.INITIAL_INSTRUCTIONS")
            return result;
        }

        // Bombardments first
        if (m.startsWith("x")) {
            // variant active
            if (! this.variants.includes("bombardment")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.breakthrough.BADVARIANT");
                return result;
            }
            const cell = m.slice(1);
            // valid cell
            try {
                BreakthroughGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // cell has a piece
            if (! this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                return result;
            }
            // that piece belongs to you
            if (this.board.get(cell)! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // partials first
        if ( (! m.includes("-")) && (! m.includes("x")) ) {
            // valid cell
            try {
                BreakthroughGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // cell has a piece
            if (! this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // that piece belongs to you
            if (this.board.get(m)! !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.breakthrough.PARTIAL");
            return result;
        }

        // full moves
        const [from, to] = m.split(/[-x]/);
        // cells valid
        for (const cell of [from, to]) {
            try {
                BreakthroughGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
        }
        // `from` has a piece
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        if (this.board.get(from)! !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        const [xFrom, yFrom] = BreakthroughGame.algebraic2coords(from);
        const [xTo, yTo] = BreakthroughGame.algebraic2coords(to);
        // Only move one space
        for (const pair of [[xFrom, xTo], [yFrom, yTo]]) {
            if (Math.abs(pair[0] - pair[1]) > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.breakthrough.TOOFAR");
                return result;
            }
        }
        // Moving in the right direction
        if ( ( (this.currplayer === 1) && (yTo >= yFrom) ) || ( (this.currplayer === 2) && (yTo <= yFrom) ) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.breakthrough.ONLY_FORWARD");
            return result;
        }

        if (m.includes("-")) {
            // is the space empty
            if (this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                return result;
            }
        } else {
            // captures not allowed in "Bombardment" variant
            if (this.variants.includes("bombardment")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.breakthrough.NOCAPTURES", {where: to});
                return result;
            }
            // capture moves must be in diagonal direction
            if (Math.abs(xFrom - xTo) !== 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.breakthrough.DIAGONAL_CAPTURES", {where: to});
                return result;

            }
            // is there a piece to capture
            if (! this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                return result;
            }
            // is it an enemy piece
            if (this.board.get(to)! === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string): BreakthroughGame {
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
        const grid = new RectGrid(8,8);
        if (m.startsWith("x")) {
            const cell = m.slice(1);
            this.board.delete(cell);
            this.results.push({type: "detonate", where: cell});
            const [x, y] = BreakthroughGame.algebraic2coords(cell);
            const surrounding = grid.adjacencies(x, y).map(pt => BreakthroughGame.coords2algebraic(...pt));
            for (const n of surrounding) {
                if (this.board.has(n)) {
                    const contents = this.board.get(n)!;
                    this.board.delete(n);
                    if (contents === this.currplayer) {
                        this.results.push({type: "destroy", what: "mine", where: n});
                    } else {
                        this.results.push({type: "destroy", what: "theirs", where: n});
                    }
                }
            }
        } else {
            const [from, to] = m.split(/[-x]/);
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
            if (m.includes("x")) {
                this.results.push({type: "capture", where: to})
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

    protected checkEOG(): BreakthroughGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // If you have no pieces, you have no moves, and you lose
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        } else if (this.moves(prevPlayer).length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer];
        } else {
            const targets = ["8", "1"];
            const target = targets[prevPlayer - 1];
            if ([...this.board.entries()].filter(e => (e[1] === prevPlayer) && (e[0].endsWith(target))).length > 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    public state(): IBreakthroughState {
        return {
            game: BreakthroughGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BreakthroughGame.gameinfo.version,
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
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = BreakthroughGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
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
                    const [fromX, fromY] = BreakthroughGame.algebraic2coords(move.from);
                    const [toX, toY] = BreakthroughGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = BreakthroughGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "detonate") {
                    const [x, y] = BreakthroughGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "destroy") {
                    const [x, y] = BreakthroughGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
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
                let myCount = 0;
                let theirCount = 0;
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.minimal"));
                            break;
                        case "detonate":
                            node.push(i18next.t("apresults:DETONATE.nowhat", {player: name, where: r.where}));
                            break;
                        case "destroy":
                            if (r.what === "mine") {
                                myCount++;
                            } else if (r.what === "theirs") {
                                theirCount++;
                            }
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
                if (myCount > 0) {
                    node.push(i18next.t("apresults:DESTROY.friendly.minimal", {count: myCount}));
                }
                if (theirCount > 0) {
                    node.push(i18next.t("apresults:DESTROY.enemy.minimal", {count: theirCount}));
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): BreakthroughGame {
        return new BreakthroughGame(this.serialize());
    }
}
