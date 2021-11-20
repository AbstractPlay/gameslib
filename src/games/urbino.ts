import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, AllDirections } from "../common";
import i18next from "i18next";
import { CartesianProduct } from "js-combinatorics";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

const gameDesc:string = `# Urbino

In Urbino, one manipulates architects (like in his game Fabrik) to build districts of different building types according to a handful of placement rules. When no more moves are possible, districts are scored, and the highest score wins. Also includes the "Monuments" variant.
`;

export type playerid = 0|1|2;
export type Size = 0|1|2|3;
export type CellContents = [playerid, Size];

const AllMonuments: Map<string, number> = new Map([["111", 3], ["212", 5], ["323", 8]]);

interface IPointEntry {
    row: number;
    col: number;
}

interface IPlayerStash {
    small: number;
    medium: number;
    large: number;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    pieces: [[number,number,number],[number,number,number]]; // house, palace, tower
};

export interface IUrbinoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class UrbinoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Urbino",
        uid: "urbino",
        playercounts: [2],
        version: "20211119",
        description: gameDesc,
        urls: ["https://spielstein.com/games/urbino"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "monuments",
                name: "Monuments",
                description: "Monuments are combinations of specific pieces in a row. Each district will score the most valuble monument present for each colour. Most valuable monument becomes the first tie breaker in districts, but not when breaking end-of-game ties."
            }
        ],
        flags: ["multistep", "player-stashes", "automove"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 9);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 9);
    }

    public numplayers: number = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public lastmove?: string;
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public pieces!: [[number,number,number],[number,number,number]];

    constructor(state?: IUrbinoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const fresh: IMoveState = {
                _version: UrbinoGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
                pieces: [[18,6,3], [18,6,3]]
            };
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] === "monuments") ) {
                this.variants = ["monuments"];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IUrbinoState;
            }
            if (state.game !== UrbinoGame.gameinfo.uid) {
                throw new Error(`The Urbino engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): UrbinoGame {
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
        this.pieces = deepclone(state.pieces);
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const grid = new RectGrid(9, 9);

        // If there aren't two workers yet, place those first
        if (this.board.size < 2) {
            for (let row = 0; row < 9; row++) {
                for (let col = 0; col < 9; col++) {
                    const cell = UrbinoGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
        // If there are only two workers, then only placement or passing is allowed
        } else if (this.board.size === 2) {
            // If nobody has passed yet, then passing is an option
            if ( (this.lastmove !== undefined) && (this.lastmove !== "pass") ) {
                moves.push("pass");
            }
            // In any case, the only other option is to place a piece
            const combos = new CartesianProduct(["1", "2", "3"], this.findPoints());
            moves.push(...[...combos].map(p => p.join("")));
        // Otherwise, all move types are possible
        } else {
            // First, you're allowed to place without moving
            const combos = new CartesianProduct(["1", "2", "3"], this.findPoints());
            moves.push(...[...combos].map(p => p.join("")));

            // Otherwise, calculate all possible moves and placements
            const empties: string[] = [];
            for (let row = 0; row < 9; row++) {
                for (let col = 0; col < 9; col++) {
                    const cell = UrbinoGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        empties.push(cell);
                    }
                }
            }
            const workers: string[] = [...this.board.entries()].filter(e => e[1][0] === 0).map(e => e[0]);
            const pairs = new CartesianProduct(workers, empties);
            for (const pair of pairs) {
                const g: UrbinoGame = Object.assign(new UrbinoGame(), deepclone(this));
                const contents = g.board.get(pair[0])!;
                g.board.delete(pair[0]);
                g.board.set(pair[1], contents);
                const combinations = new CartesianProduct(["1", "2", "3"], g.findPoints())
                for (const cell of [...combinations].map(p => p.join(""))) {
                    moves.push(`${pair[0]}-${pair[1]},${cell}`);
                }
            }
        }

        const valid = moves.filter(m => {
            // We're only validating piece placements
            if ( (m.includes(",")) || (/^\d/.test(m)) ) {
                let placement = m;
                let from: string | undefined;
                let to: string | undefined;
                if (m.includes(",")) {
                    [from, to, placement] = m.split(/[-,]/);
                }
                const piece = parseInt(placement[0], 10);
                const cell = placement.slice(1);

                // Do you have a piece that size
                if (this.pieces[player! - 1][piece - 1] < 1) {
                    return false;
                }

                // Are there adjacency restrictions
                if (piece > 1) {
                    const [x, y] = UrbinoGame.algebraic2coords(cell);
                    const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
                    for (const adj of adjs) {
                        if ( (this.board.has(adj)) && (this.board.get(adj)![1] === piece) ) {
                            return false;
                        }
                    }
                }

                // Now check for district restrictions
                const g: UrbinoGame = Object.assign(new UrbinoGame(), deepclone(this));
                if ( (from !== undefined) && (to !== undefined) ) {
                    g.board.delete(from);
                    g.board.set(to, [0,0]);
                }
                g.board.set(cell, [player!, piece as Size])
                const district = g.getDistrict(cell);
                if (district.length > 2) {
                    return false;
                }
            }
            return true;
        });

        if (valid.length === 0) {
            return ["pass"];
        } else {
            return [...valid];
        }
    }

    private getAllDistricts(): [playerid, Set<string>][][] {
        const districts: [playerid, Set<string>][][] = [];
        let allPieces = [...this.board.entries()].filter(e => e[1][0] !== 0).map(e => e[0]);
        while (allPieces.length > 0) {
            const start = allPieces.pop()!;
            const district = this.getDistrict(start)
            districts.push(district);
            const seen: Set<string> = new Set();
            for (const d of district) {
                for (const cell of d[1]) {
                    seen.add(cell);
                }
            }
            allPieces = allPieces.filter(p => ! seen.has(p));
        }
        return districts;
    }

    private getDistrict(cell: string): [playerid, Set<string>][] {
        const grid = new RectGrid(9, 9);
        let district: Set<string> = new Set();
        const todo = [cell];
        while (todo.length > 0) {
            const next = todo.pop()!;
            if (district.has(next)) {
                continue;
            }
            district.add(next);
            const [x, y] = UrbinoGame.algebraic2coords(next);
            const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
            for (const adj of adjs) {
                if ( (this.board.has(adj)) && (this.board.get(adj)![0] !== 0) ) {
                    todo.push(adj);
                }
            }
        }
        const blocks: [playerid, Set<string>][] = [];
        let block: [playerid, Set<string>];
        while (district.size > 0) {
            [block, district] = this.getBlock(district);
            blocks.push(block);
        }
        return blocks;
    }

    private getBlock(district: Set<string>): [[playerid, Set<string>], Set<string>] {
        if (district.size < 1) {
            throw new Error("Can't extract blocks from an empty district.");
        }
        const grid = new RectGrid(9, 9);
        const cells = [...district];
        const start = cells.pop()!;
        const owner = this.board.get(start)![0];
        const block: Set<string> = new Set();
        const todo = [start];
        while (todo.length > 0) {
            const next = todo.pop()!;
            if (block.has(next)) {
                continue;
            }
            block.add(next);
            district.delete(next);
            const [x, y] = UrbinoGame.algebraic2coords(next);
            const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
            for (const adj of adjs) {
                if ( (district.has(adj)) && (this.board.get(adj)![0] === owner) ) {
                    todo.push(adj);
                }
            }
        }

        return [[owner, block], district];
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public click(row: number, col: number, piece: string): string {
        if (piece === '')
            return String.fromCharCode(97 + col) + (8 - row).toString();
        else
            return 'x' + String.fromCharCode(97 + col) + (8 - row).toString();
    }

    public clicked(move: string, coord: string): string {
        if (move.length > 0 && move.length < 3) {
            if (coord.length === 2)
                return move + '-' + coord;
            else
                return move + coord;
        }
        else {
            if (coord.length === 2)
                return coord;
            else
                return coord.substring(1, 3);
        }
    }

    // The partial flag enabled dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, partial: boolean = false): UrbinoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if ( (! partial) && (! this.moves().includes(m)) ) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];

        // Look for movement first
        if (m.includes("-")) {
            const [from, to, place] = m.split(/[,-]/);
            const piece = parseInt(place[0], 10) as Size;
            const cell = place.slice(1);
            const contents = this.board.get(from)!;
            this.board.delete(from);
            this.board.set(to, contents);
            this.results.push({type: "move", from, to});
            if ( (! partial) && (place === undefined) ) {
                throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
            }
            if (place !== undefined) {
                this.board.set(cell, [this.currplayer, piece]);
                this.pieces[this.currplayer - 1][piece - 1]--;
                this.results.push({type: "place", what: piece.toString(), where: cell});
            }
        // Check for pass
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        // Otherwise it should be just plain placement
        } else {
            if (this.board.size < 2) {
                this.board.set(m, [0, 0]);
                this.results.push({type: "place", what: "0", where: m});
            } else {
                const size = parseInt(m[0], 10) as Size;
                const cell = m.slice(1);
                this.board.set(cell, [this.currplayer, size]);
                this.pieces[this.currplayer - 1][size - 1]--;
                this.results.push({type: "place", what: size.toString(), where: cell});
            }
        }

        // Stop here if only requesting partial processing
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

    protected checkEOG(): UrbinoGame {
        // Two passes in a row ends the game
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass")) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1]
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                const towers1 = [...this.board.entries()].filter(e => e[1][0] === 1 && e[1][1] === 3);
                const towers2 = [...this.board.entries()].filter(e => e[1][0] === 2 && e[1][1] === 3);
                if (towers1.length > towers2.length) {
                    this.winner = [1];
                } else if (towers1.length < towers2.length) {
                    this.winner = [2];
                } else {
                    const palaces1 = [...this.board.entries()].filter(e => e[1][0] === 1 && e[1][1] === 2);
                    const palaces2 = [...this.board.entries()].filter(e => e[1][0] === 2 && e[1][1] === 2);
                    if (palaces1.length > palaces2.length) {
                        this.winner = [1];
                    } else if (palaces1.length < palaces2.length) {
                        this.winner = [2];
                    } else {
                        const houses1 = [...this.board.entries()].filter(e => e[1][0] === 1 && e[1][1] === 1);
                        const houses2 = [...this.board.entries()].filter(e => e[1][0] === 2 && e[1][1] === 1);
                        if (houses1.length > houses2.length) {
                            this.winner = [1];
                        } else if (houses1.length < houses2.length) {
                            this.winner = [2];
                        } else {
                            this.winner = [1,2];
                        }
                    }
                }
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

    public getPlayerScore(player: playerid): number {
        let otherPlayer: playerid = 1;
        if (player === 1) {
            otherPlayer = 2;
        }
        let score = 0;
        const districts = this.getAllDistricts();
        for (const district of districts) {
            if (district.length > 2) {
                throw new Error("Invalid district found.");
            }
            // If the district doesn't contain two blocks, it doesn't count
            if (district.length < 2) {
                continue;
            }
            const myblock = district.find(d => d[0] === player)!;
            if (myblock === undefined) {
                throw new Error(`Error finding "myblock" (player ${player}) from the district ${district}.`);
            }
            const theirblock = district.find(d => d[0] === otherPlayer)!;
            if (theirblock === undefined) {
                throw new Error(`Error finding "theirblock" (player ${otherPlayer}) from the district ${district}.`);
            }
            const myscore = this.scoreBlock(myblock[1]);
            const theirscore = this.scoreBlock(theirblock[1]);
            if (myscore > theirscore) {
                score += myscore
            } else if (myscore === theirscore) {
                const breaker = this.tiebreaker([myblock, theirblock]);
                if (breaker === player) {
                    score += score;
                }
            }
        }
        return score;
    }

    // Assumes you already checked for an actual tie
    // Simply tells you who placed the most valuable buildings, if anyone
    private tiebreaker(blocks: [[playerid, Set<string>], [playerid, Set<string>]]): playerid {
        const towers: [number, number] = [0, 0];
        const palaces: [number, number] = [0, 0];
        const houses: [number, number] = [0, 0];
        const monuments: [number, number] = [0, 0];
        for (const [owner, cells] of blocks) {
            towers[owner - 1] = [...this.board.entries()].filter(e => cells.has(e[0]) && e[1][1] === 3).length;
            palaces[owner - 1] = [...this.board.entries()].filter(e => cells.has(e[0]) && e[1][1] === 2).length;
            houses[owner - 1] = [...this.board.entries()].filter(e => cells.has(e[0]) && e[1][1] === 1).length;
            if (this.variants.includes("monuments")) {
                monuments[owner - 1] = this.largestMonument(cells);
            }
        }
        if (monuments[0] > monuments[1]) {
            return 1;
        } else if (monuments[0] < monuments[1]) {
            return 2;
        } else {
            if (towers[0] > towers[1]) {
                return 1;
            } else if (towers[0] < towers[1]) {
                return 2;
            } else {
                if (palaces[0] > palaces[1]) {
                    return 1;
                } else if (palaces[0] < palaces[1]) {
                    return 2;
                } else {
                    if (houses[0] > houses[1]) {
                        return 1;
                    } else if (houses[0] < houses[1]) {
                        return 2;
                    } else {
                        return 0;
                    }
                }
            }
        }
    }

    private scoreBlock(block: Set<string>): number {
        let score = 0;
        for (const cell of block) {
            score += this.board.get(cell)![1] as number;
        }
        if (this.variants.includes("monuments")) {
            score += this.largestMonument(block);
        }
        return score;
    }

    private largestMonument(block: Set<string>): number {
        let bonus = 0;
        // You only need to search East and North
        const grid = new RectGrid(9, 9);
        for (const cell of block) {
            const [x, y] = UrbinoGame.algebraic2coords(cell);
            for (const dir of ["N", "E"] as const) {
                const ray = grid.ray(x, y, dir).map(pt => UrbinoGame.coords2algebraic(...pt));
                if ( (ray.length >= 2) && (block.has(ray[0])) && (block.has(ray[1])) ) {
                    const str = `${this.board.get(cell)![1]}${this.board.get(ray[0])![1]}${this.board.get(ray[1])![1]}`;
                    if (AllMonuments.has(str)) {
                        bonus = Math.max(bonus, AllMonuments.get(str)!);
                    }
                }
            }
        }
        return bonus;
    }

    public findPoints(): string[] {
        const points: string[] = [];
        const grid = new RectGrid(9, 9);
        if (this.board.size >= 2) {
            const workers = [...this.board.entries()].filter(e => e[1][0] === 0).map(e => e[0]);
            const rays: [string[], string[]] = [[], []];
            if (workers.length === 2) {
                for (let i = 0; i < 2; i++) {
                    const worker = workers[i];
                    const [x, y] = UrbinoGame.algebraic2coords(worker);
                    for (const dir of AllDirections) {
                        const ray = grid.ray(x, y, dir).map(pt => UrbinoGame.coords2algebraic(...pt));
                        for (const next of ray) {
                            if (! this.board.has(next)) {
                                rays[i].push(next);
                            } else {
                                break;
                            }
                        }
                    }
                }
                return rays[0].filter(cell => rays[1].includes(cell));
            }
        }
        return points;
    }

    public resign(player: playerid): UrbinoGame {
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

    public state(): IUrbinoState {
        return {
            game: UrbinoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: UrbinoGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: deepclone(this.pieces),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 9; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 9; col++) {
                const cell = UrbinoGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    let colour = "X";
                    if (contents[0] === 1) {
                        colour = "R";
                    } else if (contents[0] === 2) {
                        colour = "B";
                    }
                    switch (contents[1]) {
                        case 0:
                            pieces.push(`${colour}`);
                            break;
                        case 1:
                            pieces.push(`${colour}1`);
                            break;
                        case 2:
                            pieces.push(`${colour}2`);
                            break;
                        case 3:
                            pieces.push(`${colour}3`);
                            break;
                    }
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\n,{8}(?=\n)/g, "\n_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 9,
                height: 9,
            },
            legend: {
                R1: {
                    name: "house",
                    player: 1
                },
                R2: {
                    name: "palace",
                    player: 1
                },
                R3: {
                    name: "tower",
                    player: 1
                },
                B1: {
                    name: "house",
                    player: 2
                },
                B2: {
                    name: "palace",
                    player: 2
                },
                B3: {
                    name: "tower",
                    player: 2
                },
                X: {
                    name: "chess-queen-outline-montreal",
                    player: 3
                },
            },
            pieces: pstr
        };
        const cells = this.findPoints().map(p => UrbinoGame.algebraic2coords(p));
        if (cells.length > 0) {
            const points: IPointEntry[] = [];
            for (const cell of cells) {
                points.push({row: cell[1], col: cell[0]});
            }
            // @ts-ignore
            rep.board.markers = [{type: "dots", points}];
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = UrbinoGame.algebraic2coords(move.from);
                    const [toX, toY] = UrbinoGame.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", player: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = UrbinoGame.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations!.length === 0) {
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

        status += "**Stashes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.getPlayerStash(n);
            if (stash === undefined) {
                throw new Error("Malformed stash.");
            }
            status += `Player ${n}: ${stash.small} houses, ${stash.medium} palaces, ${stash.large} towers\n\n`;
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
            for (const rec of UrbinoGame.gameinfo.variants!) {
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
                let name: string = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "place":
                            switch (r.what) {
                                case "0":
                                    node.push(i18next.t("apresults:PLACE.urbino.worker", {player: name, where: r.where}));
                                    break;
                                case "1":
                                    node.push(i18next.t("apresults:PLACE.urbino.house", {player: name, where: r.where}));
                                    break;
                                case "2":
                                    node.push(i18next.t("apresults:PLACE.urbino.palace", {player: name, where: r.where}));
                                    break;
                                case "3":
                                    node.push(i18next.t("apresults:PLACE.urbino.tower", {player: name, where: r.where}));
                                    break;
                            }
                            break;
                        case "pass":
                            node.push(i18next.t("apresults:PASS.simple", {player: name}));
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

    public getPlayerStash(player: number): IPlayerStash | undefined {
        const stash = this.pieces[player - 1];
        if (stash !== undefined) {
            return {small: stash[0], medium: stash[1], large: stash[2]} as IPlayerStash;
        }
        return;
    }

    public clone(): UrbinoGame {
        return new UrbinoGame(this.serialize());
    }
}
