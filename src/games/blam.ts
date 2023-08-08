/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IStashEntry, IScores, IValidationResult, IAPGameStateV2 } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = require("rfdc/default");

export type playerid = 1|2|3|4;

interface ILooseObj {
    [key: string]: any;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, number]>;
    lastmove?: string;
    scores: number[];
    caps: number[];
    stashes: Map<playerid, number[]>;
}

export interface IBlamState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BlamGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Blam!",
        uid: "blam",
        playercounts: [2,3,4],
        version: "20211009",
        // i18next.t("apgames:descriptions.blam")
        description: "apgames:descriptions.blam",
        urls: ["http://invisible-city.com/content/blam"],
        people: [
            {
                type: "designer",
                name: "Jon Eargle"
            }
        ],
        flags: ["player-stashes", "scores", "automove"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers!: number;
    public currplayer!: playerid;
    public board!: Map<string, [playerid, number]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public caps!: number[];
    public stashes!: Map<playerid, number[]>;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []

    constructor(state: number | IBlamState | IAPGameStateV2 | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const fresh: IMoveState = {
                _version: BlamGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [],
                caps: [],
                stashes: new Map()
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "overloaded") ) {
                this.variants = ["overloaded"];
            }
            for (let pid = 1; pid <= state; pid++) {
                fresh.scores.push(0);
                fresh.caps.push(0);
                fresh.stashes.set(pid as playerid, [5,5,5]);
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBlamState;
            }
            if (state.game !== BlamGame.gameinfo.uid) {
                throw new Error(`The Blam! game code cannot process a game of '${state.game}'.`);
            }
            if ( ("V" in state) && (state.V === 2) ) {
                state = (this.hydrate(state) as BlamGame).state();
            }
            this.numplayers = (state as IBlamState).numplayers;
            this.variants = (state as IBlamState).variants;
            this.gameover = (state as IBlamState).gameover;
            this.winner = [...(state as IBlamState).winner];
            this.stack = [...(state as IBlamState).stack];
        }
        this.load();
    }

    public load(idx = -1): BlamGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.stashes = clone(state.stashes) as Map<playerid, number[]>;
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        this.caps = [...state.caps];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        // What pieces can the player place?
        const pieces: number[] = [];
        const stash = this.stashes.get(player);
        if ( (stash === undefined) || (stash.length !== 3) ) {
            throw new Error("Malformed stash.");
        }
        [0, 1, 2].forEach((n) => {
            if (stash[n] > 0) {
                pieces.push(n + 1);
            }
        });

        if (pieces.length === 0) {
            return ["pass"];
        }

        const cells: string[] = [];
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = BlamGame.coords2algebraic(col, row);
                if (! this.board.has(cell)) {
                    cells.push(cell);
                }
            }
        }

        const moves: string[] = [];
        pieces.forEach((piece) => {
            cells.forEach((cell) => {
                moves.push(piece.toString() + cell)
            });
        });
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = BlamGame.coords2algebraic(col, row);
            let newmove = "";
            // If you click on an occupied cell, clear the entry
            if (this.board.has(cell)) {
                return {move: "", message: ""} as IClickResult;
            }
            const stash = this.stashes.get(this.currplayer)!;
            let smallest: number|undefined;
            for (let i = 0; i < 3; i++) {
                if (stash[i] > 0) {
                    smallest = i + 1;
                    break;
                }
            }
            if (stash.reduce((a, b) => a + b) === 0) {
                return {
                    move: "pass",
                    valid: true,
                    complete: 1,
                    message: i18next.t("apgames:validation._general.NOPIECES"),
                } as IClickResult;
            }
            if (move === '') {
                if (smallest === undefined) {
                    return {
                        move: "",
                        valid: false,
                        message: i18next.t("apgames:validation.blam.SIZEFIRST"),
                    } as IClickResult;
                } else {
                    move = smallest.toString();
                }
            }

            newmove = `${move}${cell}`

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
        const stash = this.stashes.get(this.currplayer)!;

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.blam.INITIAL_INSTRUCTIONS")
            return result;
        }

        // check for "pass" first
        if (m === "pass") {
            if (stash.reduce((a, b) => a + b) === 0) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blam.MOVES_NOPASS")
                return result;
            }
        }

        const match = m.match(/^([123])([a-h][1-8])$/);
        if (match === null) {
            result.valid = false;
            if (m.length === 1 && m.match(/^[123]$/) !== null) {
                if (stash[parseInt(m, 10) - 1] === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.blam.NOPIECE", {m});
                    return result;
                }
                result.valid = true;
                result.complete = -1;
                result.canrender = false;
                result.message = i18next.t("apgames:validation.blam.PARTIAL");
                return result;
            }
            result.message = i18next.t("apgames:validation.blam.BADSYNTAX", {move: m});
            return result;
        }
        const size = parseInt(match[1], 10);
        const cell = match[2];
        // cell exists
        try {
            BlamGame.algebraic2coords(cell)
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell})
            return result;
        }
        // have piece to place
        if (stash[size - 1] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blam.NOPIECE", {size});
            return result;
        }
        // space is empty
        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): BlamGame {
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

        if (m.toLowerCase() === "pass") {
            this.results = [{type: "pass"}];
        } else {
            // validate move
            const chars = m.split("");
            const pip = parseInt(chars[0], 10);
            const stash = this.stashes.get(this.currplayer)!;
            const cell = chars[1] + chars[2];
            const coords = BlamGame.algebraic2coords(cell);
            const grid = new RectGrid(8, 8);

            // place the piece
            this.board.set(cell, [this.currplayer, pip]);
            stash[pip - 1]--;
            this.stashes.set(this.currplayer, stash);
            this.results = [{type: "place", where: cell, what: pip.toString()}]

            // Look in each direction for adjacent pieces and recursively push down the line
            const dirs: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
            dirs.forEach((d) => {
                const adj = RectGrid.move(...coords, d);
                if (grid.inBounds(...adj)) {
                    this.push(adj, d);
                }
            });
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

    private push(start: [number, number], dir: Directions): void {
        let scoreDelta = 0;
        // If there's a piece here, move it, pushing anything it its way
        if (this.board.has(BlamGame.coords2algebraic(...start))) {
            // Do the recursion, and then when it returns, move the piece
            const adj = RectGrid.move(...start, dir);
            this.push(adj, dir);

            const grid = new RectGrid(8, 8);
            const cellStart = BlamGame.coords2algebraic(...start);
            const piece = this.board.get(cellStart);
            if (piece === undefined) {
                throw new Error("Trying to move a nonexistent piece.");
            }
            // If the next cell is in bounds, move the piece
            if (grid.inBounds(...adj)) {
                this.board.set(BlamGame.coords2algebraic(...adj), piece);
                this.results.push({type: "move", from: cellStart, to: BlamGame.coords2algebraic(...adj), what: piece[1].toString()});
                this.board.delete(cellStart);
            // Otherwise it's off the board and is either captured or reclaimed
            } else {
                // If the piece belongs to the current player, reclaim it
                if (piece[0] === this.currplayer) {
                    const stash = this.stashes.get(this.currplayer);
                    if ( (stash === undefined) || (stash.length !== 3)) {
                        throw new Error("Malformed stash.");
                    }
                    stash[piece[1] - 1]++;
                    this.stashes.set(this.currplayer, stash);
                    this.results.push({type: "reclaim", what: piece[1].toString()});
                // Otherwise, capture it (add it to the current player's score)
                } else {
                    let score = this.scores[(this.currplayer as number) - 1];
                    if (score === undefined) {
                        throw new Error("Malformed score.");
                    }
                    let caps = this.caps[(this.currplayer as number) - 1];
                    if (caps === undefined) {
                        throw new Error("Malformed caps.");
                    }
                    caps++;
                    this.caps[(this.currplayer as number) - 1] = caps;
                    this.results.push({type: "capture", what: piece[1].toString()});
                    score += piece[1];
                    scoreDelta += piece[1];
                    this.scores[(this.currplayer as number) - 1] = score;
                }
                this.board.delete(cellStart);
            }
        }
        if (scoreDelta > 0) {
            this.results.push({type: "deltaScore", delta: scoreDelta});
        }
    }

    protected checkEOG(): BlamGame {
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.stashes.get(n as playerid);
            if ( (stash === undefined) || (stash.length !== 3) ) {
                throw new Error("Malformed stash.");
            }
            const sum = stash.reduce((a, b) => {return a + b;});
            if (sum > 0) {
                return this;
            }
        }
        // If we get here, then the game is truly over
        this.gameover = true;
        this.results.push({type: "eog"});
        // Find the maximum score
        const maxscore = Math.max(...this.scores);
        // If the maxscore is unique, then we've found our winner
        const map: Map<number, number> = this.scores.reduce((acc, e) => acc.set(e, (acc.get(e) || 0) + 1), new Map<number, number>());
        if (map.size === this.scores.length) {
            const n = this.scores.indexOf(maxscore);
            this.winner = [(n + 1) as playerid];
        } else {
            const nTied: playerid[] = [];
            for (let i = 0; i < this.scores.length; i++) {
                if (this.scores[i] === maxscore) {
                    nTied.push((i + 1) as playerid);
                }
            }
            const caps: number[] = [];
            for (const n of nTied) {
                caps.push(this.caps[n - 1])
            }
            const maxcaps = Math.max(...caps);
            const capmap: Map<number, number> = caps.reduce((acc, e) => acc.set(e, (acc.get(e) || 0) + 1), new Map<number, number>());
            if (capmap.size === nTied.length) {
                const n = this.caps.indexOf(maxcaps);
                this.winner = [(n + 1) as playerid];
            } else {
                this.winner = [...nTied];
            }
        }
        this.results.push({type: "winners", players: [...this.winner]});

        if (this.winner === undefined) {
            throw new Error("A winner could not be determined.");
        }

        return this;
    }

    public state(): IBlamState {
        return {
            game: BlamGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BlamGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            caps: [...this.caps],
            stashes: clone(this.stashes) as Map<playerid, number[]>
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
                const cell = BlamGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    pieces.push("P" + contents[0].toString() + contents[1].toString());
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\-{8}/g, "_");

        // build legend based on number of players
        const myLegend: ILooseObj = {};
        for (let n = 1; n <= this.numplayers; n++) {
            myLegend["P" + n.toString() + "1"] = {
                name: "pyramid-up-small-upscaled",
                player: n
            };
            myLegend["P" + n.toString() + "2"] = {
                name: "pyramid-up-medium-upscaled",
                player: n
            };
            myLegend["P" + n.toString() + "3"] = {
                name: "pyramid-up-large-upscaled",
                player: n
            };
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [toX, toY] = BlamGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = BlamGame.algebraic2coords(move.from);
                    const [toX, toY] = BlamGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Stashes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.stashes.get(n as playerid);
            if ( (stash === undefined) || (stash.length !== 3) ) {
                throw new Error("Malformed stash.");
            }
            status += `Player ${n}: ${stash[0]} small, ${stash[1]} medium, ${stash[2]} large\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.scores[n - 1];
            const caps = this.caps[n - 1];
            status += `Player ${n}: ${score} (${caps} pieces)\n\n`;
        }

        return status;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const stash = this.stashes.get(player as playerid);
        if (stash !== undefined) {
            return [
                {count: stash[0], glyph: { name: "pyramid-up-small-upscaled",  player }, movePart: "1"},
                {count: stash[1], glyph: { name: "pyramid-up-medium-upscaled", player }, movePart: "2"},
                {count: stash[2], glyph: { name: "pyramid-up-large-upscaled",  player }, movePart: "3"}
            ];
        }
        return;
    }

    public getPlayerScore(player: number): number | undefined {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: this.scores.map((s,i) => `${s} (${i18next.t("apgames:status.blam.NUMPIECES", {count: this.caps[i]})})`)}];
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place", "pass", "winners", "eog", "deltaScore"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.push", {what: r.what, from: r.from, to: r.to}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BlamGame {
        return new BlamGame(this.serialize());
    }
}
