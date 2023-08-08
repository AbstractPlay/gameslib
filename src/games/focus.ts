import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, IAPGameStateV2 } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    inhand: [number,number];
};

export interface IFocusState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const blockedCells: string[] = ["a1", "b1", "g1", "h1", "a2", "h2", "a7", "h7", "a8", "b8", "g8", "h8"];

export class FocusGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Focus",
        uid: "focus",
        playercounts: [2],
        version: "20230607",
        // i18next.t("apgames:descriptions.focus")
        description: "apgames:descriptions.focus",
        urls: ["https://en.wikipedia.org/wiki/Focus_(board_game)"],
        people: [
            {
                type: "designer",
                name: "Sid Sackson",
            },
        ],
        flags: ["limited-pieces", "scores"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public inhand: [number,number] = [0,0];

    constructor(state?: IFocusState | IAPGameStateV2 | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid[]>();
            for (let row = 1; row < 7; row++) {
                let outer: playerid = 1;
                let inner: playerid = 2;
                if (row % 2 === 0) {
                    outer = 2;
                    inner = 1;
                }
                for (let col = 1; col < 7; col++) {
                    const cell = FocusGame.coords2algebraic(col, row);
                    if ( (col === 3) || (col === 4) ) {
                        board.set(cell, [inner]);
                    } else {
                        board.set(cell, [outer]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: FocusGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                inhand: [0,0],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFocusState;
            }
            if (state.game !== FocusGame.gameinfo.uid) {
                throw new Error(`The Focus engine cannot process a game of '${state.game}'.`);
            }
            if ( ("V" in state) && (state.V === 2) ) {
                state = (this.hydrate(state) as FocusGame).state();
            }
            this.gameover = (state as IFocusState).gameover;
            this.winner = [...(state as IFocusState).winner];
            this.variants = (state as IFocusState).variants;
            this.stack = [...(state as IFocusState).stack];
        }
        this.load();
    }

    public load(idx = -1): FocusGame {
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
        this.inhand = [...state.inhand];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(8, 8);
        const mine = [...this.board.entries()].filter(e => e[1][e[1].length - 1] === player).map(e => e[0]);
        for (const cell of mine) {
            const height = this.board.get(cell)!.length;
            const [x, y] = FocusGame.algebraic2coords(cell);
            for (const dir of ["N", "E", "S", "W"] as const) {
                let ray = grid.ray(x, y, dir).map(node => FocusGame.coords2algebraic(...node)).filter(c => ! blockedCells.includes(c));
                if (ray.length > height) {
                    ray = ray.slice(0, height);
                }
                if (ray.length > 0) {
                    for (const next of ray) {
                        moves.push(`${cell}-${next}`);
                    }
                }
            }
        }
        if (this.inhand[player - 1] > 0) {
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    const cell = FocusGame.coords2algebraic(x, y);
                    if (! blockedCells.includes(cell)) {
                        moves.push(`+${cell}`);
                    }
                }
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
            const cell = FocusGame.coords2algebraic(col, row);
            let newmove = "";
            // previous move text
            if (move.length > 0) {
                const prev = move.substring(0, 2);
                // If the same cell, might be trying to place an inhand piece
                if (prev === cell) {
                    if (this.inhand[this.currplayer - 1] > 0) {
                        newmove = `+${cell}`;
                    } else {
                        return {move: "", message: ""} as IClickResult;
                    }
                } else {
                    newmove = `${prev}-${cell}`;
                }
            // fresh move, occupied space
            } else if (this.board.has(cell)) {
                // if enemy occupied and you have pieces in hand, assume placement
                const contents = this.board.get(cell)!;
                if ( (contents[contents.length - 1] !== this.currplayer) && (this.inhand[this.currplayer - 1] > 0) ) {
                    newmove = `+${cell}`;
                // otherwise, let the validator handle it
                } else {
                    newmove = cell;
                }
            // fresh move, empty space
            } else {
                if (this.inhand[this.currplayer - 1] > 0) {
                    newmove = `+${cell}`;
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
            result.message = i18next.t("apgames:validation.focus.INITIAL_INSTRUCTIONS")
            return result;
        }

        // placements
        if (m.startsWith("+")) {
            const cell = m.substring(1);
            // must have pieces in hand
            if (this.inhand[this.currplayer - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.focus.NONE_INHAND");
                return result;
            }
            // must be a valid cell
            try {
                FocusGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            if (blockedCells.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // partials first
        if (! m.includes("-")) {
            // valid cell
            try {
                FocusGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            if (blockedCells.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // cell has a stack
            if (! this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // that stack belongs to you
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const contents = this.board.get(m)!;
            if (contents[contents.length - 1] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = -1;
            if (this.inhand[this.currplayer - 1] > 0) {
                result.message = i18next.t("apgames:validation.focus.CAN_PLACE");
            } else {
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            }
            return result;
        }

        // full moves
        const [from, to] = m.split("-");
        // cells valid
        for (const cell of [from, to]) {
            try {
                FocusGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            if (blockedCells.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
        }
        // from and to must be different
        if (from === to) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        // `from` has a piece
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        const contents = this.board.get(from)!;
        if (contents[contents.length - 1] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.focus.UNCONTROLLED");
            return result;
        }
        const [xFrom, yFrom] = FocusGame.algebraic2coords(from);
        const [xTo, yTo] = FocusGame.algebraic2coords(to);
        const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
        if (bearing.length !== 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.focus.ORTHOGONAL");
            return result;
        }
        // Max distance the height of the stack
        for (const pair of [[xFrom, xTo], [yFrom, yTo]]) {
            if (Math.abs(pair[0] - pair[1]) > contents.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.focus.TOOFAR");
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): FocusGame {
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
        let dest: string;
        if (m.startsWith("+")) {
            this.inhand[this.currplayer - 1]--;
            dest = m.substring(1);
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const contents = this.board.get(dest);
            if (contents === undefined) {
                this.board.set(dest, [this.currplayer]);
            } else {
                this.board.set(dest, [...contents, this.currplayer]);
            }
            this.results.push({type: "place", where: dest});
        } else {
            const [from, to] = m.split("-");
            dest = to;
            const [fx, fy] = FocusGame.algebraic2coords(from);
            const [tx, ty] = FocusGame.algebraic2coords(to);
            const distance = Math.max(Math.abs(fx - tx), Math.abs(fy - ty));
            const fContents = this.board.get(from)!;
            const tContents = this.board.get(to);
            const fStaying = fContents.slice(0, fContents.length - distance);
            const fLeaving = fContents.slice(fContents.length - distance);
            this.results.push({type: "move", from, to, count: distance});
            this.board.set(from, [...fStaying]);
            if (tContents === undefined) {
                this.board.set(to, [...fLeaving]);
            } else {
                this.board.set(to, [...tContents, ...fLeaving]);
            }
            // clean up the board
            if (fStaying.length === 0) {
                this.board.delete(from);
            }
        }
        // check destination for captures
        const contents = this.board.get(dest)!;
        if (contents.length > 5) {
            const remaining = contents.slice(contents.length - 5);
            this.board.set(dest, [...remaining]);
            const removed = contents.slice(0, contents.length - 5);
            const capped = removed.filter(p => p !== this.currplayer).length;
            const reclaimed = removed.filter(p => p === this.currplayer).length;
            if (capped > 0) {
                this.results.push({type: "capture", count: capped, where: dest});
            }
            if (reclaimed > 0) {
                this.results.push({type: "reclaim", count: reclaimed, where: dest});
                this.inhand[this.currplayer - 1] += reclaimed;
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

    protected checkEOG(): FocusGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // If you have no pieces, you have no moves, and you lose
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IFocusState {
        return {
            game: FocusGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FocusGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            inhand: [...this.inhand],
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
                const cell = FocusGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents.join(""));
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-tiles",
            board: {
                style: "squares",
                width: 8,
                height: 8,
                blocked: [
                    {row: 0, col: 0},
                    {row: 0, col: 1},
                    {row: 0, col: 6},
                    {row: 0, col: 7},
                    {row: 1, col: 0},
                    {row: 1, col: 7},
                    {row: 6, col: 0},
                    {row: 6, col: 7},
                    {row: 7, col: 0},
                    {row: 7, col: 1},
                    {row: 7, col: 6},
                    {row: 7, col: 7}
                ],
                stackMax: 5
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            let exitNoted = false;
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = FocusGame.algebraic2coords(move.from);
                    const [toX, toY] = FocusGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if ( (move.type === "capture") || (move.type === "reclaim") ) {
                    if (! exitNoted) {
                        exitNoted = true;
                        const [x, y] = FocusGame.algebraic2coords(move.where as string);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                } else if (move.type === "place") {
                    const [x, y] = FocusGame.algebraic2coords(move.where as string);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        return [...this.board.values()].filter(s => s[s.length - 1] === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.focus"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.inhand }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.inhand[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        status += "**Stacks controlled**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place", "eog", "winners"]);
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
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.complete", {player: name, from: r.from, to: r.to, count: r.count as number}));
                            break;
                        case "place":
                            node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where!}));
                            break;
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.multiple", {count: r.count!}));
                            break;
                        case "reclaim":
                            node.push(i18next.t("apresults:RECLAIM.nowhat", {count: r.count!}));
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
                result.push(node);
            }
        }
        return result;
    }

    public clone(): FocusGame {
        return new FocusGame(this.serialize());
    }
}
