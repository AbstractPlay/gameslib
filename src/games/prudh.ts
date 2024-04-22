/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";

export type playerid = 1|2;


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, number>;
    lastmove?: string;
    scores: [number,number];
};

export interface IPrudhState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PrudhGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Prudh",
        uid: "prudh",
        playercounts: [2],
        version: "20240421",
        dateAdded: "2024-04-21",
        // i18next.t("apgames:descriptions.prudh")
        description: "apgames:descriptions.prudh",
        urls: ["https://crabfragmentlabs.com/prudh"],
        people: [
            {
                type: "designer",
                name: "James Ernest",
                urls: ["https://crabfragmentlabs.com/"],
            },
        ],
        categories: ["goal>score>eog", "mechanic>move", "mechanic>move>sow", "mechanic>share", "board>shape>rect", "board>connect>rect", "components>simple>1c"],
        flags: ["experimental", "shared-pieces", "scores", "perspective", "pie", "custom-colours", "multistep"],
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 6);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 6);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, number>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number,number] = [0,0];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IPrudhState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, number>();
            for (let x = 0; x < 6; x++) {
                for (let y = 0; y < 6; y++) {
                    const cell = PrudhGame.coords2algebraic(x, y);
                    board.set(cell, 1);
                }
            }
            const fresh: IMoveState = {
                _version: PrudhGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                scores: [0,0],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPrudhState;
            }
            if (state.game !== PrudhGame.gameinfo.uid) {
                throw new Error(`The Prudh engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PrudhGame {
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
        this.scores = [...state.scores] as [number,number];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        let evenOffset: 0|1 = 1;
        if (player === 2) {
            evenOffset = 0;
        }
        const cells: string[] = [];
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                if (
                    ( (y % 2 === 0) && (x % 2 === evenOffset)) ||
                    ( (y % 2 === 1) && (x % 2 !== evenOffset))
                   ) {
                    cells.push(PrudhGame.coords2algebraic(x, y));
                }
            }
        }

        const moves: string[] = [];
        const grid = new RectGrid(6, 6);
        // slides
        for (const from of cells) {
            if ( (! this.board.has(from)) || (this.board.get(from) === 0) ) {
                continue;
            }
            const [x, y] = PrudhGame.algebraic2coords(from);
            for (const dir of allDirections) {
                if (dir.length !== 2) {
                    continue;
                }
                // cast ray
                const ray = grid.ray(x, y, dir).map((pt) => PrudhGame.coords2algebraic(...pt));
                // find first occupied cell in ray
                const to = ray.find(cell => this.board.has(cell) && this.board.get(cell)! > 0);
                if (to !== undefined) {
                    moves.push(`${from}+${to}`);
                }
            }
        }

        // runs
        for (const from of cells) {
            if ( (! this.board.has(from)) || (this.board.get(from)! < 2) ) {
                continue;
            }
            const [x, y] = PrudhGame.algebraic2coords(from);
            for (const dir of allDirections) {
                if (dir.length !== 1) {
                    continue;
                }
                const sizeFrom = this.board.get(from)!;
                // cast ray
                let ray = grid.ray(x, y, dir).map((pt) => PrudhGame.coords2algebraic(...pt));
                // truncate ray to stack height
                if (ray.length > sizeFrom) {
                    ray = ray.slice(0, sizeFrom);
                }
                if (ray.length > 0) {
                    moves.push(`${from}-${ray[ray.length - 1]}`);
                }
            }
        }

        return moves.sort((a, b) => a.localeCompare(b));
    }

    // This function relies on the move list
    private findPoints(start: string): string[] | undefined {
        console.log(`Finding points from ${start}`);
        if (! this.board.has(start)) {
            return undefined;
        }
        const allMoves = this.moves();
        const matching = allMoves.filter(m => m.startsWith(start));
        const targets = matching.map(m => m.substring(3));
        console.log(`Returning ${JSON.stringify(targets)}`);
        return targets;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = PrudhGame.coords2algebraic(col, row);
            let newmove: string;
            if ( (move.length === 0) || (move.length > 3) ) {
                newmove = cell;
            } else {
                const [fx, fy] = PrudhGame.algebraic2coords(move);
                const bearing = RectGrid.bearing(fx, fy, col, row);
                if (bearing !== undefined && bearing.length === 2) {
                    newmove = `${move}+${cell}`;
                } else {
                    newmove = `${move}-${cell}`;
                }
            }
            if (newmove.length < 5) {
                const matching = this.moves().filter(m => m.startsWith(cell));
                if (matching.length === 1) {
                    newmove = matching[0];
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
            result.message = i18next.t("apgames:validation.prudh.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [from, to] = m.split(/[\-\+]/);
        let evenOffset: 0|1 = 1;
        if (this.currplayer === 2) {
            evenOffset = 0;
        }

        // FROM
        // valid cell
        let fx: number; let fy: number;
        try {
            [fx, fy] = PrudhGame.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // is controlled by you
        if ( ( (fy % 2 === 0) && (fx % 2 !== evenOffset) ) || ( (fy % 2 !== 0) && (fx % 2 === evenOffset) ) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        // has a checker
        if ( (! this.board.has(from)) || (this.board.get(from) === 0) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }

        if (to !== undefined) {
            // valid cell
            let tx: number; let ty: number;
            try {
                [tx, ty] = PrudhGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }

            const fromSize = this.board.get(from)!;
            const bearing = RectGrid.bearing(fx, fy, tx, ty);

            if (m.includes("+")) {
                // has at least one checker if slide
                if (fromSize < 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.TOOSMALL", {context: "slide"});
                    return result;
                }
                // in correct direction
                if ( (bearing === undefined) || (bearing.length === 1) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.WRONGDIR", {context: "slide"});
                    return result;
                }
                // correct distance
                const between = RectGrid.between(fx, fy, tx, ty).map(pt => PrudhGame.coords2algebraic(...pt));
                if (between.filter(c => this.board.has(c) || this.board.get(c)! > 0).length > 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.TOOFAR", {context: "slide"});
                    return result;
                }
            }
            else {
                // has at least two checkers if run
                if (fromSize < 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.TOOSMALL", {context: "run"});
                    return result;
                }
                // in correct direction
                if ( (bearing === undefined) || (bearing.length === 2) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.WRONGDIR", {context: "run"});
                    return result;
                }
                // correct distance
                if (RectGrid.distance(fx, fy, tx, ty) > fromSize) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.TOOFAR", {context: "run"});
                    return result;
                }
                if ( (RectGrid.distance(fx, fy, tx, ty) < fromSize) && (tx !== 5) && (ty !== 5) && (tx !== 0) && (ty !== 0) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.prudh.TOOCLOSE");
                    return result;
                }
            }

            // failsafe
            const allMoves = this.moves();
            if (! allMoves.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.FAILSAFE", {move: m});
                return result;
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.prudh.PARTIAL");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): PrudhGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        // if partial, just set the points and get out
        if ( (partial) && (! m.includes("-")) && (! m.includes("+")) ) {
            const [cell,] = m.split(/[\-\+]/);
            const pts = this.findPoints(cell);
            if (pts !== undefined) {
                this._points = pts.map(c => PrudhGame.algebraic2coords(c));
            } else {
                this._points = [];
            }
            return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        this.results = [];

        const [from, to] = m.split(/[\-\+]/);
        const sizeFrom = this.board.get(from)!;
        const sizeTo = this.board.get(to) || 0;
        const [fx, fy] = PrudhGame.algebraic2coords(from);
        const [tx, ty] = PrudhGame.algebraic2coords(to);
        const bearing = RectGrid.bearing(fx, fy, tx, ty);
        if (bearing === undefined) {
            throw new Error(`Invalid bearing made it through: ${m}`);
        }
        let evenOffset: 0|1 = 1;
        if (this.currplayer === 2) {
            evenOffset = 0;
        }
        const toMine = ( ( (ty % 2 === 0) && (tx % 2 === evenOffset) ) || ( (ty % 2 !== 0) && (tx % 2 !== evenOffset) ) );

        // slide
        if (bearing.length === 2) {
            this.board.delete(from);
            this.board.set(to, sizeFrom + sizeTo);
            this.results.push({type: "move", from, to});
        }
        // run
        else {
            // sow pieces
            this.results.push({type: "sow", pits: [from, to]});
            const between = RectGrid.between(fx, fy, tx, ty).map(pt => PrudhGame.coords2algebraic(...pt));
            for (const cell of [...between, to]) {
                const oldSize = this.board.get(cell) || 0;
                this.board.set(cell, oldSize + 1);
                this.results.push({type: "eject", from, to: cell});
            }
            const remaining = sizeFrom - (between.length + 1);
            if (remaining > 0) {
                this.board.set(from, remaining);
            } else {
                this.board.delete(from);
            }
            // capture if relevant
            if (! toMine && sizeTo > 0 && sizeFrom > sizeTo) {
                this.board.delete(to);
                this.results.push({type: "capture", where: to, what: (sizeTo + 1).toString()});
                this.scores[this.currplayer - 1] += sizeTo + 1;
                this.results.push({type: "deltaScore", delta: sizeTo + 1});
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

    protected tallest(player: playerid): number {
        let evenOffset: 0|1 = 1;
        if (player === 2) {
            evenOffset = 0;
        }

        let tallest = -Infinity;
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                if ( ( (y % 2 === 0) && (x % 2 === evenOffset) ) || ( (y % 2 !== 0) && (x % 2 !== evenOffset) ) ) {
                    const cell = PrudhGame.coords2algebraic(x, y);
                    tallest = Math.max(this.board.get(cell) || 0, tallest);
                }
            }
        }

        return tallest;
    }

    protected checkEOG(): PrudhGame {
        // if current player has no moves, game is over
        if (this.moves().length === 0) {
            let otherPlayer: playerid = 1;
            if (this.currplayer === 1) {
                otherPlayer = 2;
            }
            this.gameover = true;
            const tallest = this.tallest(otherPlayer);
            this.results.push({type: "deltaScore", delta: tallest});
            this.scores[otherPlayer - 1] += tallest;

            const [score1, score2] = this.scores;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score2 > score1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public state(): IPrudhState {
        return {
            game: PrudhGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PrudhGame.gameinfo.version,
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
        for (let row = 0; row < 6; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 6; col++) {
                const cell = PrudhGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    let str = "";
                    for (let i = 0; i < contents; i++) {
                        str += "A";
                    }
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/-{6}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                startLight: false,
                width: 6,
                height: 6,
                markers: [
                    {
                        type: "edge",
                        edge: "N",
                        colour: "#000",
                        opacity: 0.75,
                    },
                    {
                        type: "edge",
                        edge: "S",
                        colour: "#fff",
                        opacity: 0.75,
                    },
                ],
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0 || this._points.length > 0) {
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }

            // @ts-ignore
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = PrudhGame.algebraic2coords(move.from);
                    const [toX, toY] = PrudhGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = PrudhGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "eject") {
                    const [fromX, fromY] = PrudhGame.algebraic2coords(move.from);
                    const [toX, toY] = PrudhGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
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

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public getPlayerColour(p: playerid): number|string {
        if (p === 1) {
            return "#fff";
        } else {
            return "#000";
        }
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "sow":
                node.push(i18next.t("apresults:SOW.prudh", {player, from: r.pits[0], to: r.pits[1]}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.multiple", {player, where: r.where, count: parseInt(r.what!, 10)}));
                resolved = true;
                break;
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {player, delta: r.delta, count: r.delta}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PrudhGame {
        return new PrudhGame(this.serialize());
    }
}
