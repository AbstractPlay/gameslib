import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import { DirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { allSimplePaths } from "graphology-simple-path";
import i18next from "i18next";

export type playerid = 1|2;
export type Size = 1|2|3;
export type CellContents = [playerid, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    stashes: [number,number];
};

export interface IOrbState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

// used to tell the click handler how to expand a bracketed seed move
// kludgy, but simple and efficient
let expanded: string|undefined;

export class OrbGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Generatorb",
        uid: "orb",
        playercounts: [2],
        version: "20230622",
        dateAdded: "2023-07-01",
        // i18next.t("apgames:descriptions.orb")
        description: "apgames:descriptions.orb",
        urls: ["https://boardgamegeek.com/boardgame/18728/generatorb"],
        people: [
            {
                type: "designer",
                name: "Tim Schutz",
                urls: ["http://www.tjgames.com/"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "noglobes" }
        ],
        categories: ["goal>breakthrough", "goal>majority", "mechanic>capture",  "mechanic>move", "mechanic>differentiate", "mechanic>merge", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["limited-pieces", "perspective", "check"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public static generators = new Map<playerid,string[]>([
        [1, ["a1","a2","b1","b2"]],
        [2, ["g7","g8","h7","h8"]],
    ]);
    public static cores = new Map<playerid,string>([[1,"a1"],[2,"h8"]]);
    public static frontLine: string[] = ["a8","b7","c6","d5","e4","f3","g2","h1"];
    public static reOps = /[\-x\+\/\#\*]/;

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public stashes: [number,number] = [20,20];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IOrbState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>([
                ["a1",[1,1]],
                ["a2",[1,1]],
                ["b1",[1,1]],
                ["b2",[1,1]],
                ["g7",[2,1]],
                ["g8",[2,1]],
                ["h7",[2,1]],
                ["h8",[2,1]],
            ]);
            if ( (variants === undefined) || (variants.length === 0) || (! variants.includes("noglobes")) ) {
                board.set("d4", [1,3]);
                board.set("e5", [2,3]);
            }
            const fresh: IMoveState = {
                _version: OrbGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stashes: [20,20]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOrbState;
            }
            if (state.game !== OrbGame.gameinfo.uid) {
                throw new Error(`The Generatorb engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OrbGame {
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
        this.stashes = [...state.stashes];
        return this;
    }

    // Notation:
    //   Movement        (a1-a3)
    //   Capture         (a1xa3)
    //   Promotion       (a1+a3=2|3)
    //   Split           (a1/a3)
    //   Split + Promote (a1#a3=2|3)
    //   Split + Capture (a1*a3)
    public moves(permissive = false, player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const orbs = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 1).map(([cell,]) => cell);
        const spheres = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 2).map(([cell,]) => cell);
        const globes = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 3).map(([cell,]) => cell);

        // first assemble all the jump moves for orbs and spheres
        // orbs first so you don't have to worry about splits
        for (const orb of orbs) {
            const graph = this.buildGraphFrom(orb);
            const paths: string[][] = [];
            for (const node of graph.nodes()) {
                if (node === orb) { continue; }
                if (permissive) {
                    paths.push(...allSimplePaths(graph, orb, node));
                } else {
                    paths.push(bidirectional(graph, orb, node)!);
                }
            }
            for (const path of paths) {
                moves.push(this.path2move(path));
            }
        }

        // now spheres but you have to adjust each move for possible splits
        for (const sphere of spheres) {
            const graph = this.buildGraphFrom(sphere);
            const paths: string[][] = [];
            for (const node of graph.nodes()) {
                if (node === sphere) { continue; }
                if (permissive) {
                    paths.push(...allSimplePaths(graph, sphere, node));
                } else {
                    paths.push(bidirectional(graph, sphere, node)!);
                }
            }
            for (const path of paths) {
                let move = this.path2move(path);
                moves.push(move);
                // if it's a single step, then have to used combined notation
                if (move.split(OrbGame.reOps).length === 2) {
                    if (move[2] === "x") {
                        move = move.replace("x", "*");
                    } else if (move[2] === "+") {
                        move = move.replace("+", "#");
                    } else {    // a plain move
                        move = move.replace("-", "/");
                    }
                }
                // otherwise we can just adjust the first signal
                else {
                    move = move.replace("-", "/");
                }
                // reduce promotion result notation
                move = move.replace("=3", "=2");
                moves.push(move);
            }
        }

        // then look for simple moves for spheres and globes
        const grid = new RectGrid(8,8);
        for (const sphere of spheres) {
            const neighbours = grid.adjacencies(...OrbGame.algebraic2coords(sphere)).map(node => OrbGame.coords2algebraic(...node));
            for (const n of neighbours) {
                if (! this.board.has(n)) {
                    moves.push(`${sphere}-${n}`);
                    moves.push(`${sphere}/${n}`);
                } else {
                    const [otherPlayer, otherSize] = this.board.get(n)!;
                    if (otherPlayer !== player) {
                        if (otherSize < 3) {
                            moves.push(`${sphere}x${n}`);
                            moves.push(`${sphere}*${n}`);
                        }
                    } else {
                        if (otherSize === 1) {
                            moves.push(`${sphere}+${n}=3`);
                            moves.push(`${sphere}#${n}=2`);
                        } else if (otherSize === 2) {
                            moves.push(`${sphere}#${n}=3`);
                        }
                    }
                }
            }
        }
        for (const globe of globes) {
            for (const dir of allDirections) {
                const ray = grid.ray(...OrbGame.algebraic2coords(globe), dir).map(n => OrbGame.coords2algebraic(...n));
                for (const cell of ray) {
                    if (this.board.has(cell)) {
                        break;
                    } else {
                        // check for adjacent globes
                        const neighbours = grid.adjacencies(...OrbGame.algebraic2coords(cell), false).map(node => OrbGame.coords2algebraic(...node));
                        let adjGlobe = false;
                        for (const n of neighbours) {
                            // the globe that's actually moving doesn't count as a neighbour
                            if (n === globe) { continue; }
                            if ( (this.board.has(n)) && (this.board.get(n)![1] === 3) ) {
                                adjGlobe = true;
                                break;
                            }
                        }
                        if ( (! adjGlobe) && (! [...OrbGame.cores.values()].includes(cell)) ) {
                            moves.push(`${globe}-${cell}`);
                        }
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public path2move(path: string[]): string {
        if (! this.board.has(path[0])) {
            throw new Error(`There's no piece at ${path[0]}, so a move cannot be built.`);
        }
        const [player, size] = this.board.get(path[0])!;
        const last = path[path.length - 1];
        const rest = path.slice(0, path.length - 1);
        let move = rest.join("-");
        if (! this.board.has(last)) {
            move += `-${last}`;
        } else {
            const [lastPlayer, lastSize] = this.board.get(last)!;
            if (lastPlayer !== player) {
                move += `x${last}`;
            } else {
                if ((size + lastSize) > 3) {
                    throw new Error(`Being asked to combine more than three pieces: ${JSON.stringify(path)}`);
                }
                move += `+${last}=${size + lastSize}`;
            }
        }
        return move;
    }

    public buildGraphFrom(start: string): DirectedGraph {
        if (! this.board.has(start)) {
            throw new Error(`There's no piece at ${start}, so targets cannot be found.`);
        }
        const [player, size] = this.board.get(start)!;

        const grid = new RectGrid(8,8);
        const graph = new DirectedGraph();
        graph.addNode(start);
        const toVisit = [start];
        const visited = new Set<string>();
        while (toVisit.length > 0) {
            const cell = toVisit.pop()!;
            if (visited.has(cell)) { continue; }
            visited.add(cell);
            const [x,y] = OrbGame.algebraic2coords(cell);
            for (const dir of allDirections) {
                const ray = grid.ray(x, y, dir).map(node => OrbGame.coords2algebraic(...node));
                // must be at least two cells in the ray
                if (ray.length >= 2) {
                    const adj = ray[0];
                    // the adjacent cell must be occupied
                    if (this.board.has(adj)) {
                        const [adjOwner, adjSize] = this.board.get(adj)!;
                        // adjacent cell must be a 1 or 2, or (if a 3) must be your colour
                        if ( (adjSize !== 3) || (adjOwner === player) ) {
                            const far = ray[1];
                            // if (visited.has(far)) { continue; }
                            // if empty and not already explored, you can move there
                            // and we should explore possible moves from there
                            if (! this.board.has(far)) {
                                if (! graph.hasNode(far)) {
                                    graph.addNode(far);
                                }
                                graph.addDirectedEdge(cell, far);
                                toVisit.push(far);
                            } else {
                                // these are dead-end nodes; add them directly to visited
                                const [farOwner, farSize] = this.board.get(far)!;
                                // if opponent, must be your size or smaller
                                if ( (farOwner !== player) && (farSize !== 3) && (size >= farSize) ) {
                                    if (! graph.hasNode(far)) {
                                        graph.addNode(far);
                                    }
                                    graph.addDirectedEdge(cell, far);
                                    visited.add(far);
                                }
                                // if yours, can promote if not already 3
                                else if ( (farOwner === player) && (size + farSize <= 3) ) {
                                    if (size + farSize === 3) {
                                        // but you can't promote to a globe if
                                        // there's an orthogonally adjacent globe
                                        const neighbours = grid.adjacencies(...OrbGame.algebraic2coords(far), false).map(n => OrbGame.coords2algebraic(...n));
                                        let adjGlobe = false;
                                        for (const n of neighbours) {
                                            if ( (this.board.has(n)) && (this.board.get(n)![1] === 3) ) {
                                                adjGlobe = true;
                                                break;
                                            }
                                        }
                                        if (adjGlobe) { continue; }
                                        // nor can you promote if on a generator core
                                        if ([...OrbGame.cores.values()].includes(far)) {
                                            continue;
                                        }
                                    }
                                    if (! graph.hasNode(far)) {
                                        graph.addNode(far);
                                    }
                                    graph.addDirectedEdge(cell, far);
                                    visited.add(far);
                                }
                            }
                        }
                    }
                } // if ray.length >= 2
            } // foreach dir
        }
        return graph;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = OrbGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                if (! this.board.has(cell)) {
                    return {move: "", message: i18next.t("apgames:validation._general.SELECT_OWN")} as IClickResult;
                } else {
                    const [owner,] = this.board.get(cell)!;
                    if (owner !== this.currplayer) {
                        return {move: "", message: i18next.t("apgames:validation._general.SELECT_OWN")} as IClickResult;
                    }
                    newmove = `[${cell}]`
                }
            } else {
                if (move.startsWith("[")) {
                    const cells = move.substring(1, move.length - 1).split(",");
                    if (cell === cells[0]) {
                        const [,size] = this.board.get(cell)!;
                        if (size !== 2) {
                            return {move, message: i18next.t("apgames:validation.orb.SPHERES_SPLIT")} as IClickResult;
                        }
                    }
                    cells.push(cell);
                    newmove = `[${cells.join(",")}]`;
                } else {
                    let isSplit = false;
                    if ( (move.includes("/")) || (move.includes("*")) || (move.includes("#")) ) {
                        isSplit = true;
                    }
                    const cells = move.split(OrbGame.reOps);
                    // strip the promotion result string if present
                    if (cells[cells.length - 1].includes("=")) {
                        cells[cells.length - 1] = cells[cells.length - 1].substring(0, 2);
                    }
                    cells.push(cell);
                    newmove = this.path2move(cells);
                    if (isSplit) {
                        if (cells.length > 2) {
                            newmove = newmove.replace("-", "/");
                        } else {
                            newmove = newmove.replace("x", "*");
                            newmove = newmove.replace("+", "#");
                        }
                        newmove = newmove.replace("=3", "=2");
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if ( (newmove.startsWith("[")) && (expanded !== undefined) ) {
                    newmove = expanded;
                }
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
            result.message = i18next.t("apgames:validation.orb.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.startsWith("[")) {
            expanded = undefined;
            const cells = m.substring(1, m.length - 1).split(",");
            // all cells are valid
            for (const cell of cells) {
                try {
                    OrbGame.algebraic2coords(cell)
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }
            if ( (cells.length === 1) || ( (cells.length === 2) && (cells[0] === cells[1]) ) ) {
                const cell = cells[0];
                // is occupied
                if (! this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }
                const [owner, size] = this.board.get(cell)!;
                // is yours
                if (owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }

                // valid partial
                result.valid = true;
                result.complete = -1;
                if ( (size === 2) && (cells.length === 1) ) {
                    result.message = i18next.t("apgames:validation.orb.SEED_PARTIAL_SPHERE");
                } else {
                    result.message = i18next.t("apgames:validation.orb.SEED_PARTIAL");
                }
                return result;
            } else if ( (cells.length === 2) || ( (cells.length === 3) && (cells[0] === cells[1]) ) ) {
                const cell = cells[0];
                // is occupied
                if (! this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }
                const [owner,] = this.board.get(cell)!;
                // is yours
                if (owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }

                const path = cells.slice(cells.length - 2);
                let move = this.path2move(path);
                if (cells.length === 3) {
                    move = move.replace("-", "/");
                    move = move.replace("x", "*");
                    move = move.replace("+", "#");
                    move = move.replace("=3", "=2");
                }
                expanded = move;
                return this.validateMove(move);
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        } else {
            const cells = m.split(OrbGame.reOps);
            if (cells[cells.length - 1].includes("=")) {
                cells[cells.length - 1] = cells[cells.length - 1].substring(0, 2);
            }
            // all cells are valid
            for (const cell of cells) {
                try {
                    OrbGame.algebraic2coords(cell)
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }

            if (! this.board.has(cells[0])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cells[0]});
                return result;
            }

            // we're going to cheat and just check move against list of moves
            const moves = this.moves(true).filter(mv => mv.startsWith(m));
            if (moves.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
            const longerMoves = moves.filter(mv => mv.length > m.length);

            // Looks good
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            if (longerMoves.length === 0) {
                result.complete = 1;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): OrbGame {
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
            if (! this.moves(true).includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const cells = m.split(OrbGame.reOps);
        if (cells[cells.length - 1].includes("=")) {
            cells[cells.length - 1] = cells[cells.length - 1].substring(0, 2);
        }
        let isSplit = false;
        if ( (m.includes("/")) || (m.includes("#")) || (m.includes("*")) ) {
            isSplit = true;
        }

        // only need to pay attention to first and last cell
        // except to show moves
        const first = cells[0];
        let [,firstSize] = this.board.get(first)!;
        let pcstr = firstSize.toString();
        if (isSplit) { pcstr += "S"; }
        for (let i = 1; i < cells.length; i++) {
            this.results.push({type: "move", from: cells[i-1], to: cells[i], what: pcstr});
        }
        if (isSplit) {
            this.board.set(first, [this.currplayer, 1]);
            firstSize = 1;
        } else {
            this.board.delete(first);
        }
        const last = cells[cells.length - 1];
        if (this.board.has(last)) {
            const [lastOwner, lastSize] = this.board.get(last)!;
            if (lastOwner === this.currplayer) {
                this.board.set(last, [this.currplayer, (firstSize + lastSize) as Size]);
                this.results.push({type: "promote", from: lastSize.toString(), to: (firstSize + lastSize).toString(), where: last});
            } else {
                this.board.set(last, [this.currplayer, firstSize]);
                this.results.push({type: "capture", where: last, what: lastSize.toString()});
            }
        } else {
            this.board.set(last, [this.currplayer, firstSize]);
        }

        // check player's generator for empty spaces and fill as necessary/possible
        for (const gen of OrbGame.generators.get(this.currplayer)!) {
            if (! this.board.has(gen)) {
                if (this.stashes[this.currplayer - 1] > 0) {
                    this.board.set(gen, [this.currplayer, 1]);
                    this.stashes[this.currplayer - 1]--;
                    this.results.push({type: "place", where: gen});
                }
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

    private onLine(player: playerid): number {
        let num = 0;
        for (const cell of OrbGame.frontLine) {
            if ( (this.board.has(cell)) && (this.board.get(cell)![0] === player) ) {
                num++;
            }
        }
        return num;
    }

    protected checkEOG(): OrbGame {
        for (const p of [1,2] as playerid[]) {
            let otherPlayer: playerid = 1;
            if (p === 1) {
                otherPlayer = 2;
            }
            // core breach
            const core = OrbGame.cores.get(p)!;
            if ( (this.board.has(core)) && (this.board.get(core)![0] !== p) ) {
                this.gameover = true;
                this.winner = [otherPlayer];
                break;
            }
            // frontline
            if (this.onLine(p) >= 5) {
                this.gameover = true;
                this.winner = [p];
                break;
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

    public state(): IOrbState {
        return {
            game: OrbGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OrbGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            stashes: [...this.stashes],
        };
    }

    public render(): APRenderRep {
        const labels = [["A","B","C"],["X","Y","Z"]];
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = OrbGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    pieces.push(labels[player - 1][size - 1]);
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
                markers: [
                    {
                        type: "line",
                        points: [
                            {row:0,col:0},
                            {row:8,col:8}
                        ],
                        width: 2,
                        opacity: 0.25
                    },
                    {
                        type: "shading",
                        points: [
                            {row:6,col:0},
                            {row:6,col:2},
                            {row:8,col:2},
                            {row:8,col:0}
                        ],
                        colour: 1,
                        opacity: 0.25
                    },
                    {
                        type: "shading",
                        points: [
                            {row:7,col:0},
                            {row:7,col:1},
                            {row:8,col:1},
                            {row:8,col:0}
                        ],
                        colour: 1,
                        opacity: 1
                    },
                    {
                        type: "shading",
                        points: [
                            {col:6,row:0},
                            {col:6,row:2},
                            {col:8,row:2},
                            {col:8,row:0}
                        ],
                        colour: 2,
                        opacity: 0.25
                    },
                    {
                        type: "shading",
                        points: [
                            {col:7,row:0},
                            {col:7,row:1},
                            {col:8,row:1},
                            {col:8,row:0}
                        ],
                        colour: 2,
                        opacity: 1
                    }
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece-chariot",
                    colour: 1
                },
                C: {
                    name: "orb",
                    colour: 1
                },
                X: {
                    name: "piece",
                    colour: 2
                },
                Y: {
                    name: "piece-chariot",
                    colour: 2
                },
                Z: {
                    name: "orb",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = OrbGame.algebraic2coords(move.from);
                    const [toX, toY] = OrbGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if ( (move.type === "place") || (move.type === "capture") || (move.type === "promote") ) {
                    const [x, y] = OrbGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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
        status += "**Stashes**: " + this.stashes.join(",") + "\n\n";

        return status;
    }

    public getPlayerPieces(player: number): number {
        return this.stashes[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.orb", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.orb", {player, from: r.from, to: r.to, context: r.what!}));
                resolved = true;
                break;
            case "promote":
                node.push(i18next.t("apresults:PROMOTE.orb", {player, where: r.where!, context: `${r.from!}${r.to}`}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.orb", {player, where: r.where!, context: r.what!}));
                resolved = true;
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
            const moves = this.moves(false, otherPlayer);
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

    public clone(): OrbGame {
        return new OrbGame(this.serialize());
    }
}
