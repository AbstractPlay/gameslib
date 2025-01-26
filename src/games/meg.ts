import { GameBase, IAPGameState, IClickResult, IIndividualState, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, IPoint, RectGrid, reviver, SquareDirectedGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { allSimplePaths } from "graphology-simple-path";
import { linesIntersect } from "../common/plotting";

export type playerid = 1|2;
export type Piece = "CUP"|"CAP"|"BALL";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
    offense?: playerid;
    countdown?: number;
    megged?: [string,string];
};

export interface IMegState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MegGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Meg",
        uid: "meg",
        playercounts: [2],
        version: "20250126",
        dateAdded: "2024-01-20",
        // i18next.t("apgames:descriptions.meg")
        description: "apgames:descriptions.meg",
        urls: ["https://drive.google.com/file/d/1F3Xk9tj_3FIhAHhoR00_2JHtTjkeHkHO/view"],
        people: [
            {
                type: "designer",
                name: "Andrew Bressette"
            }
        ],
        categories: ["goal>align", "mechanic>move",  "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1c"],
        flags: ["experimental"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 10);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 10);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public offense?: playerid|undefined;
    public countdown?: number|undefined;
    public megged?: [string,string]|undefined;
    private highlights: string[] = [];

    constructor(state?: IMegState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Piece>();
            const fresh: IMoveState = {
                _version: MegGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMegState;
            }
            if (state.game !== MegGame.gameinfo.uid) {
                throw new Error(`The Meg engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MegGame {
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
        this.countdown = state.countdown;
        this.offense = state.offense;
        this.megged = state.megged;
        return this;
    }

    // generates a graph of valid receivers and paths between them
    private get ballGraph(): UndirectedGraph {
        const gFull = new SquareDirectedGraph(10, 10);
        const g = new UndirectedGraph();
        // find the ball
        const ball = [...this.board.entries()].find(([,pc]) => pc === "BALL")?.[0];
        if (ball !== undefined) {
            const toVisit: string[] = [ball];
            const visited: Set<string> = new Set();
            // branch out from the ball and find all cups it can reach
            while (toVisit.length > 0) {
                const next = toVisit.pop()!;
                if (visited.has(next)) { continue; }
                visited.add(next);
                if (!g.hasNode(next)) {
                    g.addNode(next);
                }
                for (const dir of allDirections) {
                    // cast the ray
                    const ray = gFull.ray(next, dir);
                    // find first occupied cell
                    const occ = ray.find(c => this.board.has(c));
                    // if it's a cup, add it to the graph
                    if (occ !== undefined && this.board.get(occ)! === "CUP") {
                        if (!g.hasNode(occ)) {
                            g.addNode(occ);
                        }
                        if (!g.hasEdge(next, occ)) {
                            g.addEdge(next, occ);
                        }
                        if (!visited.has(occ)) {
                            toVisit.push(occ);
                        }
                    }
                }
            }
        }
        return g;
    }

    // generates graph of connected pieces, for EOG checking
    private get eogGraph(): UndirectedGraph {
        const gFull = new SquareDirectedGraph(10, 10);
        const g = new UndirectedGraph();
        // in this case, look at each piece on the board
        for (const cell of this.board.keys()) {
            if (!g.hasNode(cell)) {
                g.addNode(cell);
            }
            // look in all directions
            for (const dir of allDirections) {
                const ray = gFull.ray(cell, dir);
                // get index of first occupied cell
                const idx = ray.findIndex(c => this.board.has(c));
                // if there isn't one, or if it's immediately adjacent, skip
                if (idx < 1) { continue; }
                const next = ray[idx];
                if (!g.hasNode(next)) {
                    g.addNode(next);
                }
                if (!g.hasEdge(cell, next)) {
                    g.addEdge(cell, next);
                }
            }
        }
        return g;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];
        const g = new SquareDirectedGraph(10, 10);

        // if nobody has taken the ball yet
        if (this.offense === undefined) {
            // place cup on empty space
            const empties = g.graph.nodes().filter(n => !this.board.has(n));
            moves.push(...empties);
            // or take the ball
            for (const cell of this.board.keys()) {
                moves.push(`*${cell}`);
            }
        }
        // otherwise
        else {
            // defender can only place pieces
            if (this.currplayer !== this.offense) {
                const empties = g.graph.nodes().filter(n => !this.board.has(n));
                moves.push(...empties);
            }
            // offender
            else {
                // can place new piece
                const empties = g.graph.nodes().filter(n => !this.board.has(n));
                moves.push(...empties);
                // or can shoot the ball
                const bg = this.ballGraph;
                const ball = [...this.board.entries()].find(([,pc]) => pc === "BALL")![0];
                const receivers = bg.nodes().filter(n => n !== ball);
                for (const r of receivers) {
                    const paths = allSimplePaths(bg, ball, r).map(p => p.join("-"));
                    moves.push(...paths);
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
            const cell = MegGame.coords2algebraic(col, row);
            let newmove: string;

            // empty move means placing or starting a shot
            if (move === "") {
                // if the ball hasn't been taken yet
                if (this.offense === undefined) {
                    if (!this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        newmove = "*" + cell;
                    }
                }
                // after the ball is in play
                else {
                    if (!this.board.has(cell) || this.board.get(cell) === "BALL") {
                        newmove = cell;
                    } else {
                        newmove = "";
                    }
                }
            }
            // otherwise clearly continuing (or resetting) a shot
            else {
                // clicking on the ball again resets the shot
                if (this.board.has(cell) && this.board.get(cell) === "BALL") {
                    newmove = cell;
                }
                // otherwise continue
                else {
                    newmove = move + "-" + cell;
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        const matches = allMoves.filter(mv => mv.startsWith(m));

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.meg.INITIAL_INSTRUCTIONS", {context: this.offense === undefined ? "setup" : this.offense === this.currplayer ? "offense" : "defense"});
            return result;
        }

        if (allMoves.includes(m)) {
            // valid but possibly incomplete
            let complete: 0 | 1 | -1 | undefined = 1;
            if (m.includes("-")) {
                if (matches.length > 1) {
                    complete = 0;
                }
            }
            result.valid = true;
            result.complete = complete;
            result.canrender = complete === 0 ? true : undefined;
            result.message = complete === 1 ? i18next.t("apgames:validation._general.VALID_MOVE") : i18next.t("apgames:validation.meg.PARTIAL");
            return result;
        } else {
            // the only option here is the beginning of a shot or an invalid move
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.meg.SHOT_START");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): MegGame {
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
        this.highlights = [];

        if (partial) {
            if (m.includes("-") || (this.board.has(m) && this.board.get(m) === "BALL")) {
                // apply the move so far
                const cells = m.split("-");
                for (let i = 0; i < cells.length - 1; i++) {
                    const [from, to] = [cells[i], cells[i+1]];
                    this.board.set(from, "CUP");
                    this.board.set(to, "BALL");
                    this.results.push({type: "move", from, to});
                }
                this.highlights = [...new Set<string>(allMoves.filter(mv => mv.startsWith(m)).map(mv => mv.substring(m.length + 1).split("-")[0])).values()].filter(c => c !== "");
            }
            return this;
        }

        // placement
        if (!m.includes("-") && !m.startsWith("*")) {
            if (this.offense !== undefined) {
                if (this.currplayer === this.offense) {
                    this.board.set(m, "CUP");
                    this.results.push({type: "place", where: m, what: "cup"});
                } else {
                    this.board.set(m, "CAP");
                    this.results.push({type: "place", where: m, what: "cap"});
                }
            } else {
                this.board.set(m, "CUP");
                this.results.push({type: "place", where: m, what: "cup"});
            }
        }
        // taking the ball
        else if (m.startsWith("*")) {
            const cell = m.substring(1);
            this.board.set(cell, "BALL");
            this.offense = this.currplayer;
            this.countdown = 11;
            this.results.push({type: "claim", where: cell});
        }
        // otherwise taking a shot
        else {
            const cells = m.split("-");
            for (let i = 0; i < cells.length - 1; i++) {
                const [from, to] = [cells[i], cells[i+1]];
                this.board.set(from, "CUP");
                this.board.set(to, "BALL");
                this.results.push({type: "move", from, to});
            }
        }

        // progress the countdown
        if (this.countdown !== undefined) {
            this.countdown--;
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

    protected checkEOG(): MegGame {
        let reason: string|undefined;
        // if a shot was just taken, test it
        // for some reason I need to explicitly put the type here
        // intellisense sees it fine, but lint does not
        const shots = this.results.filter(r => r.type === "move") as {
            type: "move";
            from: string;
            to: string;
        }[];
        if (shots.length > 0) {
            const g = this.eogGraph;
            for (const {from, to} of shots) {
                const [fx, fy] = MegGame.algebraic2coords(from);
                const [tx, ty] = MegGame.algebraic2coords(to);
                const p1 = {x: fx, y: 0 - fy} as IPoint;
                const q1 = {x: tx, y: 0 - ty} as IPoint;
                // only passes of a distance of at least 3 can win
                const dist = RectGrid.distance(fx, fy, tx, ty);
                if (dist >= 3) {
                    for (const edge of g.edges()) {
                        const [n1, n2] = g.extremities(edge);
                        // there's an edge case we have to eliminate:
                        // don't test if any of the extremities are also
                        // one of the nodes throwing/receiving the ball
                        if ([n1, n2].includes(from) || [n1,n2].includes(to)) {
                            continue;
                        }
                        const [x1, y1] = MegGame.algebraic2coords(n1);
                        const [x2, y2] = MegGame.algebraic2coords(n2);
                        const p2 = {x: x1, y: 0 - y1} as IPoint;
                        const q2 = {x: x2, y: 0 - y2} as IPoint;
                        if (linesIntersect(p1, q1, p2, q2)) {
                            this.gameover = true;
                            this.winner = [this.offense!]
                            this.megged = [n1, n2];
                            reason = "GOAL"
                            break;
                        }
                    }
                }
                if (this.gameover) { break; }
            }
        }
        // otherwise test clock
        else if (this.countdown !== undefined && this.countdown === 0) {
            this.gameover = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
            reason = "countdown";
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IMegState {
        return {
            game: MegGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MegGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            countdown: this.countdown,
            offense: this.offense,
            megged: this.megged,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 10; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 10; col++) {
                const cell = MegGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 10,
                height: 10,
            },
            legend: {
                BALL: [
                    {
                        name:"circle",
                        colour: 1,
                    },
                    {
                        name: "piece-borderless",
                        colour: "_context_fill",
                        scale: 0.33
                    }
                ],
                CUP: {
                    name: "circle",
                    colour: 1
                },
                CAP: {
                    name: "piece",
                    colour:1
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = MegGame.algebraic2coords(move.from);
                    const [toX, toY] = MegGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place" || move.type === "claim") {
                    const [x, y] = MegGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // add highlights
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.highlights) {
                const [x, y] = MegGame.algebraic2coords(cell);
                rep.annotations!.push({type: "enter", targets: [{row: y, col: x}], colour: 1});
            }
        }

        // add megline if present
        if (this.megged !== undefined) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const [from, to] = this.megged;
            const [fx, fy] = MegGame.algebraic2coords(from);
            const [tx, ty] = MegGame.algebraic2coords(to);
            rep.annotations!.push({type: "line", targets: [{row: fy, col: fx}, {row: ty, col: tx}], colour: 2, arrow: false, style: "dashed"});
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        if (this.offense !== undefined) {
            status += "**Offensive player**: " + this.offense.toString() + "\n\n";
            status += "**Countdown**: " + this.countdown!.toString() + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.meg", {context: r.what!, player, where: r.where}));
                resolved = true;
                break;
            case "claim":
                node.push(i18next.t("apresults:CLAIM.meg", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.meg", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public statuses(): IStatus[] {
        const returned: IStatus[] = [];
        if (this.offense !== undefined) {
            returned.push({key: i18next.t("apgames:status.meg.OFFENSE"), value: [`Player ${this.offense}`]});
            returned.push({key: i18next.t("apgames:status.meg.COUNTDOWN"), value: [this.countdown!.toString()]});

        }
        return returned;
    }

    public clone(): MegGame {
        return new MegGame(this.serialize());
    }
}
