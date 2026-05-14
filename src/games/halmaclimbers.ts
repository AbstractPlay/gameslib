import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol, Colourfuncs, MarkerFlood } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, HexTriGraph } from "../common";
import { HexDir } from "../common/graphs/hextri";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IHalmaClimbersState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class HalmaClimbersGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Halma Climbers",
        uid: "halmaclimbers",
        playercounts: [2],
        version: "20260514",
        dateAdded: "2026-05-14",
        // i18next.t("apgames:descriptions.halmaclimbers")
        description: "apgames:descriptions.halmaclimbers",
        // i18next.t("apgames:notes.halmaclimbers")
        notes: "apgames:notes.halmaclimbers",
        urls: [
            "https://boardgamegeek.com/thread/2750218",
            "https://blackandwhite.develz.org/games/HalmaClimbers.pdf",
        ],
        people: [
            {
                type: "designer",
                name: "Alexander Brady",
                urls: ["https://boardgamegeek.com/boardgamedesigner/159374/alexander-brady"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>score", "mechanic>move", "board>shape>hex", "components>simple>1per"],
        flags: ["no-moves", "custom-buttons", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private dots: string[] = [];

    constructor(state: IHalmaClimbersState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }

            const board = new Map<string, playerid>([
                ["a6", 1],                                                  ["a1", 2],
                ["b7", 1],                                                  ["b1", 2],
                ["c8", 1], ["c7", 1],                            ["c2", 2], ["c1", 2],
                ["d9", 1], ["d8", 1],                            ["d2", 2], ["d1", 2],
                ["e10",1], ["e9", 1], ["e8", 1],      ["e3", 2], ["e2", 2], ["e1", 2],
                ["f11",1], ["f10",1], ["f9", 1],      ["f3", 2], ["f2", 2], ["f1", 2],
                ["g10",1], ["g9", 1], ["g8", 1],      ["g3", 2], ["g2", 2], ["g1", 2],
                ["h9", 1], ["h8", 1],                            ["h2", 2], ["h1", 2],
                ["i8", 1], ["i7", 1],                            ["i2", 2], ["i1", 2],
                ["j7", 1],                                                  ["j1", 2],
                ["k6", 1],                                                  ["k1", 2],
            ]);

            const fresh: IMoveState = {
                _version: HalmaClimbersGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHalmaClimbersState;
            }
            if (state.game !== HalmaClimbersGame.gameinfo.uid) {
                throw new Error(`The HalmaClimbers engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): HalmaClimbersGame {
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
        this.results = [...state._results];
        return this;
    }

    public get boardsize(): number {
        return 6;
    }

    public get graph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, this.boardsize * 2 - 1);
    }

    public getButtons(): ICustomButton[] {
        return [{ label: "pass", move: "pass" }];
    }

    private homeBase(player?: playerid): string[] {
        if (player === undefined) { player = this.currplayer; }
        return player === 1 ?
               ["a6", "b7", "c7", "c8", "d8", "d9", "e8", "e9", "e10", "f9", "f10", "f11",
                "g8", "g9", "g10", "h8", "h9", "i7", "i8", "j7", "k6"] :
               ["a1", "b1", "c1", "c2", "d1", "d2", "e1", "e2", "e3", "f1", "f2", "f3",
                "g1", "g2", "g3", "h1", "h2", "i1", "i2", "j1", "k1"];
    }

    private jumpNeighbors(cell: string, board: Map<string, playerid>): string[] {
        const res: string[] = [];
        const g = this.graph;
        const [x, y] = g.algebraic2coords(cell);

        for (const dir of ["NE","E","SE","SW","W","NW"] as HexDir[]) {
            const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
            if (ray.length >= 2) {
                if (board.has(ray[0]) && !board.has(ray[1])) {
                    res.push(ray[1]);
                }
            }
        }
        return res;
    }

    private trimIfRepeated(moves: string[]): string[] {
        if (moves.length === 0) { return []; }
        const last = moves[moves.length - 1];
        const firstIndex = moves.indexOf(last);

        if (firstIndex !== moves.length - 1) { // if the last element appears earlier
            return moves.slice(0, firstIndex+1);
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove:string;

            if ( move === "" ) {
                newmove = cell;
            } else if ( move === cell ) { // reclick resets 1st action
                newmove = "";
            } else if ( this.board.has(cell) ) {
                // there are the following possible *valid* events for a player to click an occupied cell:
                //  1) the piece from 2nd action is moving where the 1st piece was
                //  2) the jumping piece is going back from where it started
                //  3) the player is reclicking the piece to reset the action
                //  4) the player is just starting the 2nd action
                const actions = move.split(',');
                const lastAction = actions[actions.length-1];
                const cells = lastAction.split('-');
                // 1
                if ( actions.length === 2 && actions[0].split('-')[0] === cell ) {
                    newmove = `${move}-${cell}`;
                }
                // 2
                else if ( cells.length > 1 && cells[0] === cell ) {
                    actions[actions.length-1] = this.trimIfRepeated(`${actions[actions.length-1]}-${cell}`.split("-")).join("-");
                    newmove = actions.join(","); // remove all jumps after its first occurrence
                }
                // 3
                else if ( cells.length === 1 && cells[0] === cell ) {
                    newmove = actions.slice(0, -1).join(","); // reset last action
                }
                // 4
                else {
                    newmove = `${move},${cell}`;
                }
            } else if ( move.includes(',') && move.split(',')[1] === cell ) { // reclick resets 2nd action
                newmove = move.split(',')[0];
            } else {
                const actions = move.split(',');
                // for the current action:
                //   if an empty cell appears again, remove all jumps after its first occurrence
                actions[actions.length-1] = this.trimIfRepeated(`${actions[actions.length-1]}-${cell}`.split("-")).join("-");
                newmove = actions.join(",");
            }

            const result = this.validateMove(newmove) as IClickResult;
            //console.debug('handleclick() move', move, 'cell', cell, 'newmove', newmove, "isValid?", result.valid);
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public hasPrefix(moves: string[], partial: string): boolean { // TODO: delete?
        return moves.some(str => str.startsWith(partial));
    }

    // returns all legal fallback moves from a given player, and a given (possibly cloned) board
    private fallbackmoves(player: playerid, board: Map<string, playerid>): string[] {
        const backDirs: HexDir[] = player === 1 ? ["NE", "SE", "E"] : ["NW", "SW", "W"];
        const g = this.graph;
        const res = [];
        const friendlyPieces = [...board.entries()].filter(e => e[1] === player)
                                                   .map(e => e[0]);
        for (const cell of friendlyPieces) {
            const [x, y] = g.algebraic2coords(cell);
            for (const dir of backDirs) {
                const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
                if (ray.length >= 1 && !board.has(ray[0]) ) {
                       res.push(`${cell}-${ray[0]}`);
                }
            }
        }
        return res;
    }

    // check if an action is a fallback
    private isFallback(action: string): boolean {
        const cells = action.split('-');
        if ( cells.length === 2 ) {
            const backDirs: HexDir[] = this.currplayer === 1 ? ["NE", "SE", "E"] : ["NW", "SW", "W"];
            const g = this.graph;
            const [x, y] = g.algebraic2coords(cells[0]);
            
            for (const dir of backDirs) {
                const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
                if (cells[1] === ray[0] ) {
                    return true;
                }
            }
        }
        return false;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.halmaclimbers.INITIAL_INSTRUCTIONS")
            } else {
                result.message = i18next.t("apgames:validation.halmaclimbers.INSTRUCTIONS")
            }
            return result;
        }

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const actions = m.split(',');

        // At ply 1 the first player can only have one action
        if ( this.stack.length === 1 && actions.length > 1 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.halmaclimbers.TOO_MANY_ACTIONS", {where: actions});
            return result;
        }

        // players must make two actions
        if ( actions.length > 2 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.halmaclimbers.TOO_MANY_ACTIONS", {where: actions});
            return result;
        }

        // need to move through all the moves, and check if they follow the rules
        // for that we need a copy of the board, to keep the effects of the previous actions
        const clone = new Map(this.board);
        let isJump = true;

        // if one action, it is ok for now, it makes a partial move
        for (const action of actions) {
            // drop or start of move
            if (!action.includes("-")) {

                if (!this.board.has(action)) { // must be occupied
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.halmaclimbers.NONEXISTENT", {where: action});
                    return result;
                }

                if (this.board.get(action)! !== this.currplayer) { // must be a friendly stone
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }

                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;

            } else {

                const cells = action.split("-");
                isJump = true;
                if ( cells.length === 2 ) {
                    const fallbackMoves = this.fallbackmoves(this.currplayer, clone);
                    if ( fallbackMoves.includes(action) ) { // it is a fall-back move
                        clone.delete(cells[0]);
                        clone.set(cells[1], this.currplayer); // simulate move
                        isJump = false;
                    }
                }
                if ( isJump ) {
                    if (! this.homeBase().includes(cells[0]) ) {
                        // The sequence of jumps must start inside the player's home-base
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.halmaclimbers.ILLEGAL_JUMP");
                        return result;
                    }
                    for (let i = 0; i < cells.length - 1; i++) {
                        const from = cells[i];
                        const to = cells[i+1];
                        //console.debug('bad move', 'from', from, 'to', to, 'neighbors', ...this.jumpNeighbors(from, clone));
                        if (! this.jumpNeighbors(from, clone).includes(to) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.halmaclimbers.BAD_MOVE", {from, to});
                            return result;
                        }
                    }
                    const last = cells.at(-1)!;
                    clone.delete(cells[0]);
                    clone.set(last, this.currplayer); // simulate move
                    const penultimate = cells.at(-2)!;
                    const neighborsLast = this.jumpNeighbors(last, clone);
                    if ( (neighborsLast.length === 0) ||
                         (neighborsLast.length === 1 && neighborsLast.includes(penultimate)) ) {
                        isJump = false; // ie, this last jump is final; let's pretend it is a move to finish the sequence
                    }
                }
            }
        }

        result.valid = true;
        if ( this.stack.length === 1 && !isJump ) {
            result.complete = 1; // a fall-back on ply 1 is final
        } else if ( this.stack.length > 1 && actions.length === 1 ) {
            result.complete = 0; // still one action to make
        } else if ( this.stack.length > 1 && actions.length === 2 && !isJump ) {
            result.complete = 1;
        } else {
            result.complete = isJump ? 0 : 1; // moves are final, jumps can be multiple
        }
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;

    }

    public move(m: string, {trusted = false, partial = false} = {}): HalmaClimbersGame {
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
        }

        this.results = [];
        this.dots = [];

        if (m === "") { return this; }

        if (m === "pass") {
            this.results.push({type: "pass"});
            this.lastmove = m;
            this.currplayer = this.currplayer % 2 + 1 as playerid;
            this.checkEOG();
            this.saveState();
            return this;
        }

        const actions = m.split(',');

        for (const action of actions) {
            if (action.includes("-")) {
                const steps = action.split("-");
                const from = steps[0];
                const to = steps[steps.length - 1];
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                for (let i = 0; i < steps.length-1; i++) {
                    this.results.push({type: "move", from: steps[i], to: steps[i+1]});
                }
            } else {
                //this.board.set(action, this.currplayer);
                this.results.push({type: "place", where: action});
            }
        }

        if (partial) { // if partial, populate dots and get out

            const cells = actions.at(-1)!.split("-");
            //console.debug('fallbacks', fallbacks, 'actions', actions);
            // if just starting, add fall-back moves
            if (cells.length === 1) {
                const start = cells[0];
                const fallbacks = this.fallbackmoves(this.currplayer, this.board);
                const possibleFallbacks = fallbacks.filter(mv => mv.split('-')[0] === start).map(mv => mv.split('-')[1]);
                this.dots.push(...possibleFallbacks);
                //console.debug('dots moves', 'm', m, 'cells', cells, 'fallback', ...possibleFallbacks);
            }
            // if the first move is a fallback and was concluded, don't show jump dots
            if (! (actions.length === 1 && this.isFallback(actions[0])) ) {
                // now add jumps
                this.dots.push(...this.jumpNeighbors(cells[cells.length - 1], this.board));
                //console.debug('dots jumps', ...this.jumpNeighbors(cells[cells.length - 1], this.board));
            }
            return this;
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): HalmaClimbersGame {
        // game ends if two consecutive passes occurred
        this.gameover = this.lastmove === "pass" &&
                        this.stack[this.stack.length - 1].lastmove === "pass";

        if ( this.gameover ) {
            const scoreP1 = this.getPlayerScore(1);
            const scoreP2 = this.getPlayerScore(2);
            if (scoreP1 === scoreP2) {
                this.winner = [1, 2];
            } else {
                this.winner = scoreP1 > scoreP2 ? [1] : [2];
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

    public state(): IHalmaClimbersState {
        return {
            game: HalmaClimbersGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HalmaClimbersGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // paint home-bases
        const markers: MarkerFlood[] = [];
        for (const player of [1, 2] as playerid[]) {
            for (const cell of this.homeBase(player)) {
                const [x, y] = this.graph.algebraic2coords(cell);
                markers.push({
                    type: "flood",
                    colour: this.getPlayerColour(player),
                    opacity: 0.5,
                    points: [{ row: y, col: x }],
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: 2 * this.boardsize - 1,
                rotate: 90,
                markers,
            },
            legend: {
                A: { name: "piece", colour: this.getPlayerColour(1) },
                B: { name: "piece", colour: this.getPlayerColour(2) },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];

        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            rep.annotations.push({
                type: "dots",
                targets: this.dots.map(cell => {
                    const [x, y] = g.algebraic2coords(cell);
                    return {row: y, col: x};
                }) as [RowCol, ...RowCol[]],
            });
        }

        return rep;
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return { func: "custom", default: 1, palette: 1 };
        } else {
            return { func: "custom", default: 2, palette: 2 };
        }
    }

    public getPlayerScore(player: playerid): number {
        const starts = player === 1 ?
            ["a6", "b7", "c7", "d8", "e8", "f9", "g8", "h8", "i7", "j7", "k6" ] :
            ["a1", "b1", "c2", "d2", "e3", "f3", "g3", "h2", "i2", "j1", "k1" ];
        const dir: HexDir = player === 1 ? "W" : "E";
        const g = this.graph;
        let score = 0;

        for (const start of starts) {
            const [x, y] = g.algebraic2coords(start);
            const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
            let maxCount = 0;
            for (let i=0; i<ray.length; i++) {
                if ( this.board.has(ray[i]) && this.board.get(ray[i]) === player ) {
                    maxCount = i+1;
                }
            }
            score += maxCount;
        }
        return score;
    }

    public sidebarScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }];
    }

    public clone(): HalmaClimbersGame {
        return new HalmaClimbersGame(this.serialize());
    }
}
