import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation, Variant } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ITaijiState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TaijiGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Taiji",
        uid: "taiji",
        playercounts: [2],
        version: "20211118",
        // i18next.t("apgames:descriptions.taiji")
        description: "apgames:descriptions.taiji",
        urls: ["https://boardgamegeek.com/boardgame/31926/taiji", "https://nestorgames.com/rulebooks/TAIJIDELUXE_EN.pdf"],
        people: [
            {
                type: "designer",
                name: "Néstor Romeral Andrés",
            }
        ],
        variants: [
            {
                uid: "7x7",
                name: "Smaller board: 7x7",
                group: "board"
            },
            {
                uid: "11x11",
                name: "Larger board: 11x11",
                group: "board"
            },
            {
                uid: "onegroup",
                name: "Scoring: Single largest group",
                group: "scoring"
            },
            {
                uid: "threegroups",
                name: "Scoring: Largest three groups",
                group: "scoring"
            },
            {
                uid: "tonga",
                name: "Tonga (Diagonal Placement)"
            },
        ],
        flags: ["scores", "multistep"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 9;

    constructor(state?: ITaijiState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] !== "") ) {
                const varInfo: (Variant|undefined)[] = variants.map(v => TaijiGame.gameinfo.variants!.find(n => n.uid === v));
                if (varInfo.includes(undefined)) {
                    throw new Error("Invalid variant passed.");
                }
                if (varInfo.filter(v => v?.group === "board").length > 1) {
                    throw new Error("You can't select two board variants.")
                }
                if (varInfo.filter(v => v?.group === "scoring").length > 1) {
                    throw new Error("You can't select two scoring variants.")
                }
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: TaijiGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITaijiState;
            }
            if (state.game !== TaijiGame.gameinfo.uid) {
                throw new Error(`The Lines of Action engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TaijiGame {
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
        this.boardSize = 9;
        if (this.variants.includes("7x7")) {
            this.boardSize = 7;
        } else if (this.variants.includes("11x11")) {
            this.boardSize = 11;
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(this.boardSize, this.boardSize);
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
                if (! this.board.has(cell)) {
                    let neighbours: [number, number][] = [];
                    if (this.variants.includes("tonga")) {
                        neighbours = grid.adjacencies(col, row);
                    } else {
                        neighbours = grid.adjacencies(col, row, false);
                    }
                    for (const [x, y] of neighbours) {
                        const next = TaijiGame.coords2algebraic(x, y, this.boardSize);
                        if (! this.board.has(next)) {
                            moves.push(`${cell},${next}`);
                        }
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
            const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
            let newmove = "";
            // clicking on an occupied space resets
            if (this.board.has(cell)) {
                return {move: "", message: ""} as IClickResult;
            }
            if (move.length === 0) {
                // place a light piece
                newmove = cell;
            } else {
                const [light,] = move.split(",");
                // if you clicked on the same space as before, just move your light piece
                if (cell === light) {
                    newmove = cell;
                } else {
                    const [x, y] = TaijiGame.algebraic2coords(light, this.boardSize);
                    const grid = new RectGrid(this.boardSize, this.boardSize);
                    const neighbours = grid.adjacencies(x, y, true).map(pt => TaijiGame.coords2algebraic(...pt, this.boardSize));
                    if (neighbours.includes(cell)) {
                        // place a dark piece if adjacent to light
                        newmove = `${light},${cell}`;
                    // otherwise, assume they want to replace the light piece at the new location
                    } else {
                        newmove = cell;
                    }
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
            result.message = i18next.t("apgames:validation.taiji.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [light, dark] = m.split(",");

        // valid cell
        let xLight: number; let yLight: number;
        try {
            [xLight, yLight] = TaijiGame.algebraic2coords(light, this.boardSize);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: light});
            return result;
        }
        // is empty
        if (this.board.has(light)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: light});
            return result;
        }

        if (dark === undefined) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.taiji.PARTIAL");
            return result;
        } else {
            // valid cell
            try {
                TaijiGame.algebraic2coords(dark, this.boardSize);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: dark});
                return result;
            }
            // is empty
            if (this.board.has(dark)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: dark});
                return result;
            }
            // is adjacent
            let neighbours: string[];
            const grid = new RectGrid(this.boardSize, this.boardSize);
            if (this.variants.includes("tonga")) {
                neighbours = grid.adjacencies(xLight, yLight, true).map(pt => TaijiGame.coords2algebraic(...pt, this.boardSize));
            } else {
                neighbours = grid.adjacencies(xLight, yLight, false).map(pt => TaijiGame.coords2algebraic(...pt, this.boardSize));
            }
            if (! neighbours.includes(dark)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.taiji.ADJACENT");
                return result;
            }

            // valid full move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, partial = false): TaijiGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if ( (! partial) && (! this.moves().includes(m)) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];
        const [left, right] = m.split(",");
        this.board.set(left, 1);
        this.results.push({type: "place", where: left});
        if (right !== undefined) {
            this.board.set(right, 2);
            this.results.push({type: "place", where: right});
        }

        if (partial) { return this; }

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

    protected checkEOG(): TaijiGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public resign(player: playerid): TaijiGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): ITaijiState {
        return {
            game: TaijiGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TaijiGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
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
        // pstr = pstr.replace(/-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: {
                    name: "piece-square",
                    player: 1
                },
                B: {
                    name: "piece-square",
                    player: 2
                },
            },
            pieces: pstr
        };

        // Add annotations
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = TaijiGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: playerid): number {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const seen: Set<string> = new Set();
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const [x, y] = TaijiGame.algebraic2coords(cell, this.boardSize);
                const neighbours = grid.adjacencies(x, y, false).map(n => TaijiGame.coords2algebraic(...n, this.boardSize));
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }

        groups.sort((a, b) => b.size - a.size);
        let counts = 2;
        if (this.variants.includes("onegroup")) {
            counts = 1;
        } else if (this.variants.includes("threegroups")) {
            counts = 3;
        }
        return groups.slice(0, counts).reduce((sum, value) => {return sum + value.size;}, 0);
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of TaijiGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, promote, deltaScore
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
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
                        case "place":
                            node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where}));
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

    public clone(): TaijiGame {
        return new TaijiGame(this.serialize());
    }
}
