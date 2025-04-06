import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    inhand: [number,number];
    target: number;
    scores: [number,number];
};

export interface IMixtourState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MixtourGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mixtour",
        uid: "mixtour",
        playercounts: [2],
        version: "20230624",
        dateAdded: "2023-07-01",
        // i18next.t("apgames:descriptions.mixtour")
        description: "apgames:descriptions.mixtour",
        urls: ["https://spielstein.com/games/mixtour/rules"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {uid: "three", group: "scores"},
            {uid: "five", group: "scores"}
        ],
        categories: ["goal>score>race", "mechanic>coopt",  "mechanic>move", "mechanic>place", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["limited-pieces", "scores", "automove", "check"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public inhand: [number,number] = [20,20];
    public scores: [number,number] = [0,0];
    public target = 1;

    constructor(state?: IMixtourState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: MixtourGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                inhand: [20,20],
                board: new Map<string,playerid[]>(),
                target: 1,
                scores: [0,0],
            };
            if ( (variants !== undefined) && (variants.length === 1) ) {
                if (variants[0] === "three") {
                    fresh.target = 2;
                } else if (variants[0] === "five") {
                    fresh.target = 3;
                }
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMixtourState;
            }
            if (state.game !== MixtourGame.gameinfo.uid) {
                throw new Error(`The Mixtour engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MixtourGame {
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
        this.target = state.target;
        this.scores = [...state.scores];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        // if you have pieces, you can always place onto empty spaces
        if (this.inhand[player - 1] > 0) {
            for (let y = 0; y < 5; y++) {
                for (let x = 0; x < 5; x++) {
                    const cell = MixtourGame.coords2algebraic(x, y);
                    if (! this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
        }

        // for each piece already on the board, cast rays looking for possible moves
        const grid = new RectGrid(5,5);
        for (const [to, stack] of this.board.entries()) {
            const [tx, ty] = MixtourGame.algebraic2coords(to);
            const dist = stack.length;
            for (const dir of allDirections) {
                let ray = grid.ray(tx, ty, dir).map(n => MixtourGame.coords2algebraic(...n));
                if (ray.length >= dist) {
                    ray = ray.slice(0, dist);
                    // exactly one cell in the ray must be occupied
                    if (ray.filter(n => this.board.has(n)).length === 1) {
                        // and it must be the last cell
                        const from = ray[ray.length - 1];
                        if (this.board.has(from)) {
                            const contents = this.board.get(from)!;
                            for (let i = 0; i < contents.length - 1; i++) {
                                moves.push(`${from}:${i + 1}-${to}`);
                            }
                            moves.push(`${from}-${to}`);
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = MixtourGame.coords2algebraic(col, row);
            let newmove = "";

            // fresh move
            if (move.length === 0) {
                // if empty cell, assume you're entering a piece
                if (! this.board.has(cell)) {
                    newmove = cell;
                } else {
                    const contents = this.board.get(cell)!;
                    // if no piece, or if it's the bottom piece,
                    // assume you're moving the entire stack
                    if ( (piece === undefined) || (piece.length === 0) || (parseInt(piece, 10) === contents.length) ) {
                        newmove = cell;
                    } else {
                        newmove = `${cell}:${piece}`;
                    }
                    // check for easy autocompletions
                    const moves = this.moves().filter(mv => mv.startsWith(newmove));
                    if (moves.length === 1) {
                        newmove = moves[0];
                    }
                }
            } else {
                // if empty, ignore the click
                if (! this.board.has(cell)) {
                    return {move: "", message: ""} as IClickResult;
                } else {
                    newmove = move + "-" + cell;
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.mixtour.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");


        // check for pass first
        if (m === "pass") {
            const moves = this.moves();
            if (! moves.includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mixtour.INVALID_PASS");
                return result;
            }
        }

        const [from, to] = m.split("-");
        const [fcell, fnum] = from.split(":");

        try {
            MixtourGame.algebraic2coords(fcell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: fcell});
            return result;
        }

        // if fcell is empty, this is a placement
        if (! this.board.has(fcell)) {
            // must have a piece in hand
            if (this.inhand[this.currplayer - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOPIECES");
                return result;
            }

            // otherwise we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // otherwise we're starting a move

        // validate from
        // if provided, make sure the tile num is valid
        if (fnum !== undefined) {
            const contents = this.board.get(fcell)!;
            if (parseInt(fnum, 10) > contents.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mixtour.INVALID_TILE_NUM");
                return result;
            }
        }

        // if to isn't defined, return valid partial
        if (to === undefined) {
            result.valid = true;
            result.complete = -1;
            if (fnum === undefined) {
                result.message = i18next.t("apgames:validation.mixtour.PARTIAL_FULLSTACK");
            } else {
                result.message = i18next.t("apgames:validation.mixtour.PARTIAL_SUBSTACK", {count: parseInt(fnum, 10)});
            }
            return result;
        }

        // valid cell
        try {
            MixtourGame.algebraic2coords(to);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
            return result;
        }

        // is occupied
        if (! this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mixtour.MOVE_MUST_STACK");
            return result;
        }

        // check distance
        const toStack = this.board.get(to)!;
        const dist = RectGrid.distance(...MixtourGame.algebraic2coords(fcell), ...MixtourGame.algebraic2coords(to));
        if (dist !== toStack.length) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mixtour.INVALID_DISTANCE");
            return result;
        }

        // look for obstructions
        const [fx,fy] = MixtourGame.algebraic2coords(fcell);
        const [tx,ty] = MixtourGame.algebraic2coords(to);
        const between = RectGrid.between(fx,fy,tx,ty).map(n => MixtourGame.coords2algebraic(...n));
        for (const b of between) {
            if (this.board.has(b)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: b});
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): MixtourGame {
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
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const [from, to] = m.split("-");
            const [fcell, fnum] = from.split(":");

            // if fcell is empty, we're placing a new piece
            if (! this.board.has(fcell)) {
                this.inhand[this.currplayer - 1]--;
                this.board.set(fcell, [this.currplayer]);
                this.results.push({type: "place", where: fcell});
            }
            // otherwise we're moving
            else {
                const fcontents = this.board.get(fcell)!;
                let tileNum = fcontents?.length;
                if (fnum !== undefined) {
                    tileNum = parseInt(fnum, 10);
                }
                const moving = fcontents.slice(fcontents.length - tileNum);
                const remaining = fcontents.slice(0, fcontents.length - tileNum);
                const tcontents = this.board.get(to)!;
                this.board.set(fcell, [...remaining]);
                if (this.board.get(fcell)!.length === 0) {
                    this.board.delete(fcell);
                }
                this.board.set(to, [...tcontents, ...moving]);
                if (this.board.get(to)!.length === 0) {
                    this.board.delete(to);
                }
                this.results.push({type: "move", from: fcell, to});
            }

            // look for stacks that are five high
            const high = [...this.board.entries()].filter(([,arr]) => arr.length >= 5).map(([cell,]) => cell);
            for (const cell of high) {
                const stack = this.board.get(cell)!;
                this.results.push({type: "remove", where: cell, num: stack.length})
                const winner = stack[stack.length - 1];
                this.scores[winner - 1]++;
                this.results.push({type: "deltaScore", delta: 1, who: winner});
                for (const p of stack) {
                    this.inhand[p - 1]++;
                }
                this.board.delete(cell);
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

    protected checkEOG(): MixtourGame {
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            this.gameover = true;
            this.winner = [1,2];
        } else if (this.scores[0] >= this.target) {
            this.gameover = true;
            this.winner = [1];
        } else if (this.scores[1] >= this.target) {
            this.gameover = true;
            this.winner = [2];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IMixtourState {
        return {
            game: MixtourGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MixtourGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            inhand: [...this.inhand],
            target: this.target,
            scores: [...this.scores],
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
                const cell = MixtourGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents.join(""));
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-tiles",
            board: {
                style: "squares-checkered",
                width: 5,
                height: 5,
                stackMax: 5
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = MixtourGame.algebraic2coords(move.from);
                    const [toX, toY] = MixtourGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "remove") {
                    const [x, y] = MixtourGame.algebraic2coords(move.where);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "place") {
                    const [x, y] = MixtourGame.algebraic2coords(move.where as string);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: this.scores },
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

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["pass", "move", "place", "eog", "winners"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "remove":
                node.push(i18next.t("apresults:REMOVE", {player, count: r.num, where: r.where}));
                resolved =true;
                break;
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {player: `Player ${(r.who as number).toString()}`, delta: r.delta, count: r.delta}));
                resolved =true;
                break;
        }
        return resolved;
    }

    public inCheck(): number[] {
        const checked: number[] = [];
        for (const p of [1,2] as playerid[]) {
            let otherPlayer: playerid = 1;
            if (p === 1) {
                otherPlayer = 2;
            }
            const moves = this.moves(otherPlayer);
            for (const m of moves) {
                const cloned = this.clone();
                cloned.currplayer = otherPlayer;
                cloned.move(m);
                if ( (cloned.gameover) && (cloned.winner.includes(otherPlayer)) ) {
                    checked.push(p);
                    break;
                }
            }
        }
        return checked;
    }

    public clone(): MixtourGame {
        return new MixtourGame(this.serialize());
    }
}
