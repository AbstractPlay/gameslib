import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult, ICustomButton } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import { connectedComponents } from "graphology-components";
// // eslint-disable-next-line @typescript-eslint/no-require-imports
// const deepclone = require("rfdc/default");

export type playerid = 1|2|3|4;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IWunchunkState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    swapped?: boolean;
};

function encodeScore(arr: number[], base?: number): number {
    if (base === undefined) {
        // Find the largest value in the array
        const maxVal = Math.max(...arr);
        // Choose a base larger than maxVal to avoid overlap
        base = maxVal + 1;
    }

    // Encode the array into a single number
    return arr.reduce((acc, val) => acc * base! + val, 0);
}

export class WunchunkGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Wunchunk",
        uid: "wunchunk",
        playercounts: [2,3,4],
        version: "20260123",
        dateAdded: "2026-01-23",
        // i18next.t("apgames:descriptions.wunchunk")
        description: "apgames:descriptions.wunchunk",
        urls: [
            "https://boardgamegeek.com/boardgame/285135/wunchunk",
        ],
        people: [
            {
                type: "designer",
                name: "Craig Duncan",
                urls: ["https://boardgamegeek.com/boardgamedesigner/66694/craig-duncan"],
                apid: "d1f9fa1b-889c-4234-a95c-9a5d389bf98e",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "hex5", group: "board" },
            { uid: "#board" },
            { uid: "hex7", group: "board" },
            { uid: "hex8", group: "board" },
            { uid: "open" },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>share", "board>shape>hex", "board>connect>hex", "components>simple>1per", "other>2+players"],
        flags: ["experimental", "no-moves", "custom-randomization", "custom-buttons", "scores", "pie", "custom-colours"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public swapped?: boolean;

    constructor(state: number | IWunchunkState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }

            let board: Map<string, playerid>;
            if (this.numplayers === 3) {
                this.variants = ["hex8"];
                board = new Map<string, playerid>([
                    ["i7", 1], ["h7", 1],
                    ["g7", 2], ["g8", 2],
                    ["h9", 3], ["i8", 3],
                ]);
            } else if (this.numplayers === 4) {
                this.variants = ["hex8"];
                board = new Map<string, playerid>([
                    ["j8", 1], ["i9", 1],
                    ["j6", 2], ["i6", 2],
                    ["g6", 3], ["f6", 3],
                    ["g9", 4], ["f8", 4],
                ]);
            } else {
                if (this.variants.includes("open")) {
                    this.swapped = false;
                    board = new Map<string, playerid>();
                } else {
                    if (this.variants.includes("hex5")) {
                        board = new Map<string, playerid>([
                            ["f4", 1], ["f5", 1],
                            ["d4", 2], ["d5", 2],
                        ]);
                    } else if (this.variants.includes("hex7")) {
                        board = new Map<string, playerid>([
                            ["h6", 1], ["h7", 1],
                            ["f6", 2], ["f7", 2],
                        ]);
                    } else if (this.variants.includes("hex8")) {
                        board = new Map<string, playerid>([
                            ["i7", 1], ["i8", 1],
                            ["g7", 2], ["g8", 2],
                        ]);
                    } else {
                        board= new Map<string, playerid>([
                            ["g5", 1], ["g6", 1],
                            ["e5", 2], ["e6", 2],
                        ]);
                    }
                }
            }

            const fresh: IMoveState = {
                _version: WunchunkGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IWunchunkState;
            }
            if (state.game !== WunchunkGame.gameinfo.uid) {
                throw new Error(`The Wunchunk engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.swapped = state.swapped;
        }
        this.load();
    }

    public load(idx = -1): WunchunkGame {
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
        if (this.variants.includes("hex5")) {
            return 5;
        } else if (this.variants.includes("hex7")) {
            return 7;
        } else if (this.variants.includes("hex8")) {
            return 8;
        } else {
            return 6;
        }
    }

    public get graph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    public getPlayerColour(p: playerid): number|string {
        if (this.swapped) {
            return p === 1 ? 2 : 1;
        }
        return p;
    }

    public randomMove(): string {
        const chunks = this.countChunks();
        const possMoves: number[] = [];
        for (let i = 1; i <= chunks; i++) {
            for (let j = 0; j < i + 1; j++) {
                possMoves.push(i);
            }
        }
        const players: playerid[] = ([1,2,3,4] as playerid[]).slice(0, this.numplayers);
        const numMoves = possMoves[Math.floor(Math.random() * possMoves.length)];
        const empties = shuffle((this.graph.listCells() as string[]).filter(c => !this.board.has(c))) as string[];
        const chosen = empties.slice(0, numMoves);
        const moves = chosen.map(cell => `${players[Math.floor(Math.random() * players.length)]}${cell}`);
        if (moves.length === 0) {
            return "pass";
        }
        return moves.join(",");
    }

    public getButtons(): ICustomButton[] {
        if (this.variants.includes("open") && this.stack.length === 2) {
            return [
                {label: "playfirst", move: "swap"},
                {label: "playsecond", move: "pass"},
            ];
        }
        return [{label: "pass", move: "pass"}];
    }

    public isPieTurn(): boolean {
        if (this.numplayers === 2 && !this.variants.includes("open") && this.stack.length === 2) {
            return true;
        }
        return false;
    }

    public shouldOfferPie(): boolean {
        if (this.numplayers === 2 && !this.variants.includes("open")) {
            return true;
        }
        return false;
    }


    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const g = this.graph;
        try {
            let newmove = "";
            const steps = move.split(",").filter(Boolean);
            let lastPc: string|undefined;
            let lastCell: string|undefined;
            if (steps.length > 0) {
                lastPc = steps[steps.length - 1][0];
                lastCell = steps[steps.length - 1].substring(1);
            }
            // the following are true if the last move was complete
            let lastmove = "";
            let stub = move;
            // if not complete, set stub and lastmove
            if (steps.length > 0) {
                if (lastCell === undefined || lastCell.length < 2) {
                    lastmove = lastPc!;
                    stub = move.substring(0, move.lastIndexOf(","));
                    steps.pop();
                }
            }
            // console.log(JSON.stringify({move, lastPc, lastCell, lastmove, stub}));
            // make the moves in the stub
            const cloned = this.clone();
            cloned.move(stub, {partial: true});

            // clicking off the board (setting the piece)
            // always resets the current step
            if (row === -1 && col === -1) {
                newmove = [...steps, piece!].join(",");
            } else {
                const cell = g.coords2algebraic(col, row);
                // if you click on a cell you've already placed, remove it or swap it
                if (cloned.board.has(cell) && steps.some(m => m.endsWith(cell))) {
                    if (lastPc === cloned.board.get(cell)!.toString()) {
                        const idx = steps.findIndex(m => m.endsWith(cell));
                        if (idx >= 0) {
                            steps.splice(idx, 1);
                        }
                        newmove = [...steps, lastmove].filter(Boolean).join(",");
                    } else {
                        const p = lastPc === undefined ? this.currplayer.toString() : lastPc;
                        const idx = steps.findIndex(m => m.endsWith(cell));
                        if (idx >= 0) {
                            steps[idx] = p + steps[idx].substring(1);
                        }
                        newmove = [...steps].filter(Boolean).join(",");
                    }
                }
                // otherwise, on empty spaces, place the piece
                else if (!cloned.board.has(cell)) {
                    if (lastmove.length > 0) {
                        lastmove += cell;
                    } else {
                        lastmove = `${this.swapped ? (this.currplayer === 1 ? 2 : 1) : this.currplayer}${cell}`;
                    }
                    newmove = [...steps, lastmove].join(",");
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

        let numChunks = this.countChunks();
        if (this.variants.includes("open") && this.stack.length === 1) {
            numChunks = 4;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.wunchunk.INITIAL_INSTRUCTIONS", {count: numChunks, context: (this.variants.includes("open") && this.stack.length === 1) ? "setup" : (this.variants.includes("open") && this.stack.length === 2) ? "choose" : "play"});
            return result;
        }

        // passing is always allowed
        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // swapping is only allowed in narrow circumstances
        if (m === "swap") {
            if (this.variants.includes("open") && this.stack.length === 2) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        const g = this.graph;
        const empties = [...g.listCells() as string[]].filter(c => !this.board.has(c));
        const steps = m.split(",").filter(Boolean);
        if (steps.length > numChunks) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wunchunk.TOO_MANY", {count: numChunks});
            return result;
        }
        if (steps.length > empties.length) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wunchunk.BOARD_FULL", {count: numChunks});
            return result;
        }
        let cloned = this.clone();
        for (let i = 0; i < steps.length; i++) {
            cloned = this.clone();
            const step = steps[i];
            const pc = step[0];
            // valid pc
            const player: playerid = parseInt(pc, 10) as playerid;
            if (isNaN(player) || (![1,2,3,4].slice(0, this.numplayers).includes(player))) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.wunchunk.INVALID_COLOUR", {colour: pc});
                return result;
            }
            const cell = step.substring(1);
            if (cell !== "") {
                // valid cell
                try {
                    g.algebraic2coords(cell);
                    if (!g.graph.hasNode(cell)) {
                        throw new Error(`Could not find cell ${cell} in the graph.`);
                    }
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_CELL", {cell});
                    return result;
                }
                // cell is unoccupied
                if (cloned.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                    return result;
                }
            }
            // otherwise we've selected a piece but not a cell yet
            else {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.wunchunk.PARTIAL");
                return result;
            }

            // make the move so far
            cloned.move(steps.slice(0, i + 1).join(","), {partial: true, trusted: true})
        }

        // if we get here, we're good
        // first handle initial setup
        if (this.variants.includes("open") && this.stack.length === 1) {
            // validate chunks
            for (let p = 1; p <= 2; p++) {
                const [p1, p2] = [...cloned.board.entries()].filter(e => e[1] === p).map(e => e[0]);
                if (p1 !== undefined && p2 !== undefined) {
                    if (!g.neighbours(p1).includes(p2)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.wunchunk.SETUP_CHUNKS");
                        return result;
                    }
                }
                const mine = [...cloned.board.entries()].filter(e => e[1] === p);
                if (mine.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.wunchunk.SETUP_TOOMANY");
                    return result;
                }
            }

            const remaining = numChunks - steps.length;
            if (remaining > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.wunchunk.INITIAL_INSTRUCTIONS", {count: remaining, context: "setup"});
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

        }
        // everything else
        else {
            const remaining = Math.min(numChunks - steps.length, empties.length - steps.length);
            result.valid = true;
            result.complete = remaining === 0 ? 1 : 0;
            result.canrender = true;
            result.message = remaining === 0 ?
                i18next.t("apgames:validation._general.VALID_MOVE") :
                i18next.t("apgames:validation.wunchunk.VALID_BUT", {count: remaining});
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): WunchunkGame {
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
            if ( (! partial) && (result.complete === -1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        // passing
        if (m === "pass") {
            this.results.push({type: "pass"});
        }
        // setup
        else if (m === "swap") {
            this.swapped = true;
            this.results.push({type: "swap", where: "global"});
        }
        // regular play
        else {
            const steps = m.split(",").filter(Boolean);
            for (const step of steps) {
                const pc = step[0];
                const player: playerid = parseInt(pc, 10) as playerid;
                const cell = step.substring(1);
                if (cell !== "") {
                    this.board.set(cell, player);
                    if (player === this.currplayer) {
                        this.results.push({type: "place", what: "mine", where: cell});
                    } else {
                        this.results.push({type: "place", what: "theirs", who: player, where: cell});
                    }
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        // if this is a swap, we need to insert a pass
        if (this.results.find(r => r.type === "swap") !== undefined) {
            // update currplayer
            let newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            this.currplayer = newplayer as playerid;
            this.saveState();
            this.lastmove = "pass";
            this.results = [{type: "pass"}];
            // let the main loop take care of the rest
        }

        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): WunchunkGame {
        const g = this.graph;

        // check for consecutive passes
        if (this.lastmove === "pass" && this.stack.length >= this.numplayers) {
            let allPassed = true;
            for (let i = 0; i < this.numplayers - 1; i++) {
                if (this.stack[this.stack.length - (1 + i)].lastmove !== "pass") {
                    allPassed = false;
                    break;
                }
            }
            if (allPassed) {
                this.gameover = true;
            }
        }
        // otherwise the board has to be full
        else if (this.board.size === (g.listCells() as string[]).length) {
            this.gameover = true;
        }

        // if game is over, score it
        if (this.gameover) {
            const scoreArrays = this.getScoreArrays();
            const maxVal = Math.max(...scoreArrays.flat());
            const base = maxVal + 1;
            const scores = scoreArrays.map(lst => encodeScore(lst, base));
            const minScore = Math.min(...scores);
            const winners: playerid[] = [];
            for (let i = 1; i <= this.numplayers; i++) {
                if (scores[i-1] === minScore) {
                    winners.push(i as playerid);
                }
            }
            this.winner = [...winners];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public countChunks(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.swapped) {
            player = player === 1 ? 2 : 1;
        }
        const g = this.graph.graph;
        for (const cell of [...g.nodes()]) {
            if (!this.board.has(cell) || this.board.get(cell) !== player) {
                g.dropNode(cell);
            }
        }
        const conn = connectedComponents(g).filter(grp => grp.length >= 2);
        return conn.length;
    }

    public getPlayerScore(player: playerid): number | undefined {
        return this.countChunks(player);
    }

    public getScoreArrays(): number[][] {
        const players: playerid[] = ([1,2,3,4] as playerid[]).slice(0, this.numplayers);
        const conns: string[][][] = [];
        for (const p of players) {
            const g = this.graph.graph;
            for (const cell of [...g.nodes()]) {
                if (!this.board.has(cell) || this.board.get(cell) !== p) {
                    g.dropNode(cell);
                }
            }
            const conn = connectedComponents(g);
            conns.push(conn);
        }
        const chunks = conns.map(pgrps => pgrps.filter(grp => grp.length >= 2).length);
        const maxSize = Math.max(...conns.map(conn => Math.max(...conn.map(c => c.length))));
        const scores: number[][] = chunks.map(c => [c]);
        for (let size = 1; size <= maxSize; size++) {
            const groups = conns.map(pgrps => pgrps.filter(grp => grp.length === size).length);
            groups.forEach((n, i) => scores[i].push(n));
        }

        // Determine the cutoff index
        let cutoff = 0;
        let candidates = Array.from({ length: this.numplayers }, (_, i) => i);
        const maxLen = scores[0].length;
        for (let i = 0; i < maxLen; i++) {
            cutoff = i;
            let minVal = Infinity;
            for (const p of candidates) {
                if (scores[p][i] < minVal) {
                    minVal = scores[p][i];
                }
            }
            const nextCandidates = candidates.filter(p => scores[p][i] === minVal);
            if (nextCandidates.length === 1) {
                break;
            }
            candidates = nextCandidates;
        }

        let results = scores.map(lst => lst.slice(0, cutoff + 1));
        if (this.swapped) {
            results = results.reverse();
        }
        return results;
    }

    public getPlayersScores(): IScores[] {
        const scores = this.getScoreArrays();
        const strings = scores.map(lst => `${lst[0]}${lst.length > 1 ? ` (size ${lst.length - 1}: ${lst[lst.length - 1]})` : ""}`);
        return [
            {
                name: i18next.t("apgames:status.SCORES"),
                scores: strings,
            }
        ];
    }

    public state(): IWunchunkState {
        return {
            game: WunchunkGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            swapped: this.swapped,
        };
    }

    public moveState(): IMoveState {
        return {
            _version: WunchunkGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const labels = ["A", "B", "C", "D"].slice(0, this.numplayers);
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    pieces.push(labels[owner - 1]);
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
            },
            legend: labels.reduce<Record<string, Glyph>>(
                (acc, player, index) => {
                    acc[player] = {
                        name: "piece",
                        colour: index + 1 // or any logic for colour
                    };
                    return acc;
                },
                {}
            ),
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add key so the user can click to select the color to place
        const key: AreaKey = {
            type: "key",
            position: "left",
            height: 0.7,
            list: labels.map((piece, index) => (
                { piece, name: "", value: String(index+1) }
            )),
            clickable: true
        };
        rep.areas = [key];

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.what === "mine") {
                    node.push(i18next.t("apresults:PLACE.mine", {player, where: r.where}));
                } else {
                    node.push(i18next.t("apresults:PLACE.theirs_specific", {player, where: r.where, enemy: `P${r.who}`}));
                }
                resolved = true;
                break;
            case "swap":
                node.push(i18next.t("apresults:SWAP.wunchunk", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }


    public clone(): WunchunkGame {
        const clonedState = this.serialize();
        const clonedVariants = this.variants ? [...this.variants] : undefined;
        return new WunchunkGame(clonedState, clonedVariants);
    }
}
