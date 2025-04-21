import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, reviver, SquareDirectedGraph, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";

export type playerid = 1|2;
export type Pawn = "R"|"B"|"G";
export type Block = {
    cell: string;
    colour: Pawn;
    count: 1|2;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    blocks: Map<string, Block>;
    board: Map<string, playerid[]|Pawn>;
    lastmove?: string;
};

export interface IBloqueoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BloqueoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bloqueo",
        uid: "bloqueo",
        playercounts: [2],
        version: "20250420",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.bloqueo")
        description: "apgames:descriptions.bloqueo",
        urls: [
            "https://misutmeeple.com/2023/06/resena-bloqueo/",
            "https://boardgamegeek.com/boardgame/292218/bloqueo",
        ],
        people: [
            {
                type: "designer",
                name: "Timo Diegel",
                urls: ["https://boardgamegeek.com/boardgamedesigner/58958/timo-diegel"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>eog", "mechanic>share", "mechanic>move", "mechanic>place", "mechanic>displace", "board>shape>rect", "board>connect>rect", "components>simple>5c"],
        flags: ["experimental", "scores", "custom-colours", "limited-pieces", "automove"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Pawn|playerid[]>;
    public blocks = new Map<string, Block>();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private dots: string[] = [];
    private highlights: string[] = [];

    constructor(state?: IBloqueoState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Pawn|playerid[]>([
                ["d4", "G"],
            ]);
            const fresh: IMoveState = {
                _version: BloqueoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                blocks: new Map<string, Block>(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBloqueoState;
            }
            if (state.game !== BloqueoGame.gameinfo.uid) {
                throw new Error(`The Bloqueo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BloqueoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.blocks = new Map([...state.blocks.entries()]);
        this.board = new Map([...state.board.entries()]);
        this.lastmove = state.lastmove;
        return this;
    }

    public inhand(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        const stacks = [...this.board.values()].filter(v => Array.isArray(v));
        const counts: [number, number] = [0, 0];
        for (const stack of stacks) {
            for (const pc of stack) {
                counts[(pc as number) - 1]++;
            }
        }
        return 22 - counts[p - 1];
    }

    public get graph(): SquareDirectedGraph {
        const g = new SquareDirectedGraph(7, 7);
        g.graph.dropNode("a1");
        g.graph.dropNode("a7");
        g.graph.dropNode("g1");
        g.graph.dropNode("g7");
        return g;
    }

    public getPlayerColour(p: playerid): number|string {
        if (p === 1) {
            return "#fff";
        } else {
            return 9;
        }
    }


    public moves(): string[] {
        if (this.gameover) { return []; }
        if (this.inhand() === 0) {
            return [];
        }

        const moves: string[] = [];

        const g = this.graph;
        const empties = [...g.graph.nodes()].filter(c => !this.board.has(c));
        const pawns = [...this.board.entries()].filter(([,v]) => !Array.isArray(v));
        const placedPawns = pawns.map(([,v]) => v) as Pawn[];
        // if no red pawn, place it
        if (!placedPawns.includes("R")) {
            return empties.sort((a,b) => a.localeCompare(b));
        }
        // if no blue pawn, place it
        else if (!placedPawns.includes("B")) {
            return empties.sort((a,b) => a.localeCompare(b));
        }
        // normal moves
        else {
            for (const [start,] of pawns) {
                for (const dir of allDirections) {
                    let ray = g.ray(start, dir);
                    // cut ray off at first occupied space
                    const idx = ray.findIndex(c => this.board.has(c));
                    if (idx >= 0) {
                        ray = ray.slice(1, idx);
                    } else {
                        ray.shift();
                    }
                    if (ray.length > 0) {
                        for (const dest of ray) {
                            const mv = `${start}-${dest}`;
                            for (const n of g.neighbours(dest)) {
                                // if blocked, skip
                                if (this.blocks.has(n)) {
                                    continue;
                                }
                                const contents = this.board.get(n);
                                // if empty or tower, then we're good
                                if (contents === undefined || (Array.isArray(contents) && contents.length < 4)) {
                                    moves.push(`${mv}-${n}`);
                                }
                            }
                        }
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = BloqueoGame.coords2algebraic(col, row);
            let newmove: string;

            if (move === "") {
                // setup
                if ([...this.board.keys()].length < 3) {
                    newmove = cell;
                }
                // regular play
                else if (this.board.has(cell) && !Array.isArray(this.board.get(cell)!)) {
                    newmove = cell;
                } else {
                    newmove = "";
                }
            } else {
                // if cell is a pawn, reset move
                if (this.board.has(cell) && !Array.isArray(this.board.get(cell)!)) {
                    newmove = cell;
                }
                else {
                    const [from, to,] = move.split("-");
                    if (to === undefined) {
                        newmove = [from, cell].join("-");
                    } else {
                        newmove = [from, to, cell].join("-");
                    }
                }
            }

            // autocomplete
            const matches = this.moves().filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.bloqueo.INITIAL_INSTRUCTIONS", {context: this.stack.length < 3 ? "setup" : "play"})
            return result;
        }

        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                const parts = m.split("-");
                // select destination
                if (parts.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.bloqueo.PARTIAL", {context: "dest"});
                    return result;
                }
                // place a piece
                else {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.bloqueo.PARTIAL", {context: "place"});
                    return result;
                }
            }
            else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): BloqueoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];
        this.highlights = [];

        if (partial && this.stack.length >= 3) {
            const parts = m.split("-");
            const matches = allMoves.filter(mv => mv.startsWith(m));
            // need destination
            if (parts.length === 1) {
                this.dots = matches.map(mv => {
                    const [,t,] = mv.split("-");
                    return t;
                });
            }
            // place a piece
            else if (parts.length === 2) {
                const contents = this.board.get(parts[0])!;
                this.board.delete(parts[0]);
                this.board.set(parts[1], contents);
                this.results.push({type: "move", from: parts[0], to: parts[1]});
                this.highlights = matches.map(mv => {
                    const [,,pl] = mv.split("-");
                    return pl;
                });
            }
            return this;
        }

        const [from, to, place] = m.split("-");
        // setup phase
        if (to === undefined) {
            this.board.set(from, this.currplayer === 1 ? "R" : "B");
        }
        // normal play
        else {
            const contents = this.board.get(from)! as Pawn;
            this.board.delete(from);
            this.board.set(to, contents);
            this.results.push({type: "move", from, to});
            let stack: playerid[] = [this.currplayer];
            if (this.board.has(place)) {
                stack = [...(this.board.get(place)! as playerid[]), this.currplayer];
            }
            this.board.set(place, stack);
            this.results.push({type: "place", where: place});

            // distribute blocks
            const currBlocks = [...this.blocks.values()].filter(b => b.colour === contents);
            // first time
            if (currBlocks.length === 0) {
                this.blocks.set(place, {
                    cell: place,
                    colour: contents,
                    count: 2,
                });
            }
            // second time
            else if (currBlocks.length === 1) {
                const two = currBlocks[0];
                // two becomes one
                this.blocks.set(two.cell, {...two, count: 1});
                // new becomes 2
                this.blocks.set(place, {
                    cell: place,
                    colour: contents,
                    count: 2,
                });
            }
            // all the rest of the time
            else {
                const two = currBlocks.find(b => b.count === 2)!;
                const one = currBlocks.find(b => b.count === 1)!;
                // two becomes one
                this.blocks.set(two.cell, {...two, count: 1});
                // one goes away
                this.blocks.delete(one.cell);
                // new becomes 2
                this.blocks.set(place, {
                    cell: place,
                    colour: contents,
                    count: 2,
                });
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

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: [this.inhand(1), this.inhand(2)] }
        ]
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        let numPenalties = 0;

        const g = new SquareOrthGraph(7, 7);
        for (const node of [...g.graph.nodes()]) {
            if (!this.board.has(node)) {
                g.graph.dropNode(node);
            } else {
                const contents = this.board.get(node)!;
                if (!Array.isArray(contents) || contents[contents.length - 1] !== player) {
                    g.graph.dropNode(node);
                }
            }
        }
        const conn = connectedComponents(g.graph);
        for (const grp of conn) {
            const maxHeight = Math.max(...grp.map(cell => (this.board.get(cell)! as playerid[]).length));
            if (grp.length === 1 && maxHeight === 1) {
                numPenalties++;
            } else {
                score += grp.length * maxHeight;
            }
        }

        // penalties are scored as triangular numbers
        score -= Math.floor(numPenalties * (numPenalties + 1) / 2);

        return score;
    }

    protected checkEOG(): BloqueoGame {
        // if no moves, game over
        if (this.moves().length === 0) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
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

    public state(): IBloqueoState {
        return {
            game: BloqueoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BloqueoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()]),
            blocks: new Map([...this.blocks.entries()]),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        const cells = g.listCells(true) as string[][];
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    const stack: string[] = [];
                    if (!Array.isArray(contents)) {
                        stack.push(contents);
                    } else {
                        for (const p of contents) {
                            stack.push(p === 1 ? "Y" : "Z");
                        }
                    }
                    // add blocks
                    if (this.blocks.has(cell)) {
                        const { colour, count } = this.blocks.get(cell)!;
                        for (let i = 0; i < count; i++) {
                            stack.push(colour === "R" ? "S" : colour === "B" ? "C" : "H");
                        }
                    }
                    pieces.push(stack.join(""))
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: 7,
                height: 7,
                blocked: [
                    {row: 0, col: 0},
                    {row: 0, col: 6},
                    {row: 6, col: 0},
                    {row: 6, col: 6},
                ],
            },
            legend: {
                R: {
                    name: "piece-chariot",
                    colour: 1,
                },
                S: {
                    name: "piece",
                    colour: 1,
                    scale: 0.5,
                },
                B: {
                    name: "piece-chariot",
                    colour: 2,
                },
                C: {
                    name: "piece",
                    colour: 2,
                    scale: 0.5,
                },
                G: {
                    name: "piece-chariot",
                    colour: 3,
                },
                H: {
                    name: "piece",
                    colour: 3,
                    scale: 0.5,
                },
                Y: {
                    name: "hex-pointy",
                    colour: this.getPlayerColour(1),
                },
                Z: {
                    name: "hex-pointy",
                    colour: this.getPlayerColour(2),
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = BloqueoGame.algebraic2coords(move.from);
                    const [toX, toY] = BloqueoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = BloqueoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const dot of this.dots) {
                const [x, y] = BloqueoGame.algebraic2coords(dot);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
            }
        }

        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const hl of this.highlights) {
                const [x, y] = BloqueoGame.algebraic2coords(hl);
                rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.inhand(n as playerid)}\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BloqueoGame {
        return new BloqueoGame(this.serialize());
    }
}
