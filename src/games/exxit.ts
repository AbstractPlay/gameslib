/* eslint-disable no-console */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { defineHex, Orientation } from "honeycomb-grid";
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { CompassDirection, hexNeighbours, nextHex, bearing as calcBearing } from "../common/hexes";
import { UndirectedGraph } from "graphology";
import { connectedComponents } from 'graphology-components';
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;

export class ExxitHex extends defineHex({ offset: 1, orientation: Orientation.POINTY }) {
    tile?: playerid;
    stack?: playerid[];

    public get uid(): string {
        return `${this.q},${this.r}`;
    }

    public get col(): number {
        // eslint-disable-next-line no-bitwise
        return this.q + (this.r + (this.r & 1)) / 2;
    }

    public get row(): number {
        return this.r;
    }

    static create(args: {q: number; r: number; tile?: playerid; stack?: playerid[]}) {
        const hex = new ExxitHex({q: args.q, r: args.r});
        hex.tile = args.tile;
        hex.stack = args.stack;
        return hex;
    }
}

const pointyHexDirs: CompassDirection[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, ExxitHex>;
    lastmove?: string;
    tiles: number;
    inhand: [number,number];
}

export interface IExxitState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ExxitGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Exxit",
        uid: "exxit",
        playercounts: [2],
        version: "20240103",
        // i18next.t("apgames:descriptions.exxit")
        description: "apgames:descriptions.exxit",
        // i18next.t("apgames:notes.exxit")
        notes: "apgames:notes.exxit",
        urls: ["https://boardgamegeek.com/boardgame/22947/exxit"],
        people: [
            {
                type: "designer",
                name: "Vincent Everaert",
                urls: ["https://boardgamegeek.com/boardgamedesigner/6083/vincent-everaert"]
            }
        ],
        variants: [
            {uid: "exNihilo", group: "setup"},
            {uid: "29tiles", group: "length"},
            {uid: "19tiles", group: "length"},
        ],
        flags: ["experimental", "pie", "scores", "limited-pieces", "automove"],
    };

    public static clone(obj: ExxitGame): ExxitGame {
        const cloned: ExxitGame = Object.assign(new ExxitGame(), deepclone(obj) as ExxitGame);
        return cloned;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, ExxitHex>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;
    public tiles = 39;
    public inhand = [8,8];

    constructor(state?: IExxitState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IExxitState;
            }
            if (state.game !== ExxitGame.gameinfo.uid) {
                throw new Error(`The Exxit game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            let board = new Map<string, ExxitHex>();
            let tiles = 39;
            if ( (variants === undefined) || (variants.includes("29tiles")) ) {
                tiles = 29;
            } else if ( (variants === undefined) || (variants.includes("19tiles")) ) {
                tiles = 19;
            }
            if ( (variants === undefined) || (! variants.includes("exNihilo")) ) {
                board = new Map<string, ExxitHex>([
                    ["0,0", ExxitHex.create({q: 0, r: 0, tile: 2})],
                    ["1,-2", ExxitHex.create({q: 1, r: -2, tile: 2})],
                    ["0,-1", ExxitHex.create({q: 0, r: -1, tile: 1})],
                    ["1,-1", ExxitHex.create({q: 1, r: -1, tile: 1})],
                ]);
                tiles -= 4;
            }
            this.expandPerimeter(board);

            const fresh: IMoveState = {
                _version: ExxitGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                tiles,
                inhand: [8,8],
            };
            this.stack = [fresh];
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
        }
        this.load();
    }

    public load(idx = -1): ExxitGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map<string,ExxitHex>();
        for (const obj of state.board.values()) {
            const hex = ExxitHex.create(obj);
            this.board.set(hex.uid, hex);
        }
        this.lastmove = state.lastmove;
        this.tiles = state.tiles;
        this.inhand = [...state.inhand];
       return this;
    }

    public expandPerimeter(board?: Map<string, ExxitHex>) {
        if (board === undefined) {
            board = this.board;
        }
        if (board.size === 0) {
            board.set("0,0", new ExxitHex({q: 0, r: 0}));
        } else {
            const tiled = [...board.values()].filter(hex => hex.tile !== undefined);
            for (const tile of tiled) {
                for (const n of hexNeighbours(tile)) {
                    const id = `${n.q},${n.r}`;
                    if (! board.has(id)) {
                        board.set(id, new ExxitHex(n))
                    }
                }
            }
        }
    }

    // doesn't include the starting hex
    protected ray(hex: ExxitHex, dir: CompassDirection): ExxitHex[] {
        const hexes: ExxitHex[] = [];
        let curr: ExxitHex = hex;
        while (this.board.has(curr.uid)) {
            hexes.push(this.board.get(curr.uid)!);
            const coord = nextHex(curr, dir);
            if (coord === undefined) {
                throw new Error(`Invalid direction given for hex orientation (orientation: ${hex.orientation}, direction: ${dir})`);
            }
            curr = new ExxitHex(coord);
        }
        return hexes.slice(1);
    }

    protected recurseFindEnlargements(sofar: ExxitHex[] = []): ExxitHex[][] {
        // get list of current qualifying perimeter nodes
        const perimeter = [...this.board.values()].filter(hex => hex.tile === undefined && hex.stack !== undefined); // .sort((a, b) => a.q === b.q ? a.r - b.r : a.q - b.q);
        const newTiles: ExxitHex[] = [];
        for (const p of perimeter) {
            let num = 0;
            for (const n of hexNeighbours(p)) {
                const uid = `${n.q},${n.r}`;
                if ( (this.board.has(uid)) && (this.board.get(uid)!.tile !== undefined) ) {
                    num++;
                }
            }
            if (num >= 2) {
                newTiles.push(p);
            }
        }

        if (newTiles.length > 0) {
            const moves: ExxitHex[][] = [];
            // now iterate
            for (const newTile of newTiles) {
                if (this.tiles > 0) {
                    // clone the hex and add a tile (doesn't matter what colour)
                    const tile = ExxitHex.create(newTile);
                    tile.tile = 1;
                    // clone the game object
                    const cloned = ExxitGame.clone(this);
                    // place the tile
                    cloned.tiles--;
                    cloned.board.set(tile.uid, tile);
                    moves.push(...cloned.recurseFindEnlargements([...sofar, tile]));
                }
            }
            return moves;
        } else {
            return [sofar];
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        const tiled = [...this.board.values()].filter(hex => hex.tile !== undefined);
        // check for initial setup phase
        if ( (this.variants.includes("exNihilo")) && (tiled.length < 6) ) {
            const perimeter = [...this.board.values()].filter(hex => hex.tile === undefined);
            for (const p of perimeter) {
                moves.push(`+${p.q},${p.r}`);
            }
        }
        // all other scenarios
        else {
            // destruction first
            const dodPerimeter: string[] = [];
            const dodOther: string[] = [];
            // can't start DoD from perimeter spaces, so only look for stacks on tiles
            const stacks = [...this.board.values()].filter(hex => hex.stack !== undefined && hex.tile !== undefined && hex.stack[hex.stack.length - 1] === player);
            for (const hex of stacks) {
                const startHeight = hex.stack!.length;
                for (const dir of pointyHexDirs) {
                    const ray = this.ray(hex, dir).slice(0, startHeight);
                    const occupiedIdx = ray.findIndex(h => h.stack !== undefined && h.stack[h.stack.length - 1] !== player);
                    if (occupiedIdx !== -1) {
                        const next = ray[occupiedIdx];
                        if (next.stack!.length <= startHeight) {
                            // stack height test passed
                            // check perimeter is unoccupied
                            const last = ray[ray.length - 1];
                            if ( (last.tile !== undefined) || (last.stack === undefined) ) {
                                // fully valid DoD; put it in the right place
                                const move = `${hex.uid}-${last.uid}`;
                                if (last.tile === undefined) {
                                    dodPerimeter.push(move);
                                } else {
                                    dodOther.push(move);
                                }
                            }
                        }
                    }
                }
            }
            if (dodPerimeter.length > 0) {
                moves.push(...dodPerimeter);
            } else if (dodOther.length > 0) {
                moves.push(...dodOther);
            }
            // if still no moves, then build
            if (moves.length === 0) {
                // enlarge
                const enlargements = this.recurseFindEnlargements().filter(lst => lst.length > 0);
                moves.push(...enlargements.map(lst => lst.map(l => `+${l.uid}`).join(";")));

                // placement
                for (const tile of tiled) {
                    if ( (tile.stack === undefined) && (this.inhand[player - 1] > 0) ) {
                        moves.push(tile.uid);
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves.sort((a, b) => a.localeCompare(b));
    }

    protected offset2hex(coords: {row: number; col: number}): ExxitHex|undefined {
        const minCol = Math.min(...[...this.board.values()].map(hex => hex.col));
        // const maxCol = Math.max(...[...this.board.values()].map(hex => hex.col));
        const minRow = Math.min(...[...this.board.values()].map(hex => hex.row));
        // const maxRow = Math.max(...[...this.board.values()].map(hex => hex.row));
        const dx = 0 - minCol;
        const dy = 0 - minRow;
        return [...this.board.values()].find(h => h.col + dx === coords.col && h.row + dy === coords.row);
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /**
     * There are only three possible moves:
     * - Click on an owned stack on a tile for DoD.
     * - Click on an empty tile to place a piece.
     * - Click on an occupied perimeter to expand the world.
     */
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        const moves = this.moves();

        try {
            // convert row,col to an actual hex
            const hex = this.offset2hex({row, col});
            console.log(`Hex clicked: ${JSON.stringify(hex)}`)
            if (hex === undefined) {
                return {move, message: i18next.t("apgames:validation.exxit.INITIAL_INSTRUCTIONS", {context: ( (this.variants.includes("exNihilo")) && ([...this.board.values()].filter(h => h.tile !== undefined).length < 6) ) ? "setup" : /\d-/.test(moves[0]) ? "destroy" : "build"})} as IClickResult;
            }

            let newmove = "";
            // empty move
            if (move === "") {
                // start of capture move
                if ( hex.tile !== undefined && hex.stack !== undefined && hex.stack[hex.stack.length - 1] === this.currplayer) {
                    newmove = `${hex.uid}`;
                }
                // placing a piece
                else if ( hex.tile !== undefined && hex.stack === undefined) {
                    newmove = `${hex.uid}`;
                }
                // trigger an enlargement
                else if (hex.tile === undefined && (hex.stack !== undefined || this.variants.includes("exNihilo")) ) {
                    newmove = `+${hex.uid}`;
                }
                // Otherwise, something is wrong
                else {
                    return {move, message: i18next.t("apgames:validation.exxit.INITIAL_INSTRUCTIONS", {context: ( (this.variants.includes("exNihilo")) && ([...this.board.values()].filter(h => h.tile !== undefined).length < 6) ) ? "setup" : /\d-/.test(moves[0]) ? "destroy" : "build"})} as IClickResult;
                }
            }
            // the only continuation is when multiple captures are available
            else {
                // so just add the target cell to this one
                newmove = move + `-${hex.uid}`;
            }

            // autocomplete
            const matches = moves.filter(m => m.startsWith(newmove));
            // a move should always be found
            if (matches.length === 0) {
                return {move, message: i18next.t("apgames:validation.exxit.INITIAL_INSTRUCTIONS", {context: ( (this.variants.includes("exNihilo")) && ([...this.board.values()].filter(h => h.tile !== undefined).length < 6) ) ? "setup" : /\d-/.test(moves[0]) ? "destroy" : "build"})} as IClickResult;
            } else if (matches.length === 1) {
                newmove = matches[0];
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const moves = this.moves();

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            if ( (this.variants.includes("exNihilo")) && ([...this.board.values()].filter(hex => hex.tile !== undefined).length < 6) ) {
                result.message = i18next.t("apgames:validation.exxit.INITIAL_INSTRUCTIONS", {context: "setup"});
            } else {
                result.message = i18next.t("apgames:validation.exxit.INITIAL_INSTRUCTIONS", {context: /\d-/.test(moves[0]) ? "destroy" : "build"});
            }
            return result;
        }

        // Because of the autocomplete, we can assume that most moves we receive are complete.
        // The only partials we should receive are situations where multiple captures are possible.
        // This makes tracking enlargements so much easier!

        // if the move is in the list, we're good
        if (moves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // otherwise check if a capture move starts with the coordinates given
        const match = moves.find(mv => /\d-/.test(mv) && mv.startsWith(m));
        if (match !== undefined) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.exxit.VALID_PARTIAL");
            return result;
        }

        // otherwise something went wrong
        result.valid = false;
        result.message = i18next.t("apgames:validation.exxit.INVALID_MOVE");
        return result;
}

    public move(m: string, {trusted = false} = {}): ExxitGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
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

        // captures first
        if (/\d-/.test(m)) {
            const match = m.match(/(-?\d+,-?\d+)-(-?\d+,-?\d+)/);
            if (match === null) {
                throw new Error(`Malformed capture move received: ${m}`)
            }
            const [from, to] = [match[1], match[2]];
            const fhex = this.board.get(from);
            const thex = this.board.get(to);
            if (fhex === undefined || thex === undefined) {
                throw new Error(`Could not find either the from or to hexes: ${from}, ${to}`);
            }
            // get bearing
            const bearing = calcBearing(fhex, thex);
            if (bearing === undefined) {
                throw new Error(`Could not determine the bearing between ${from} and ${to}`);
            }
            if (fhex.stack === undefined) {
                throw new Error(`The origin tile does not appear to have a stack`);
            }
            // get ray in that direction
            const ray = this.ray(fhex, bearing);
            // pick up the stack
            let stack = [...fhex.stack];
            fhex.stack = undefined;
            this.board.set(fhex.uid, fhex);
            // distribute
            for (let i = 0; i < ray.length; i++) {
                const rayHex = ray[i];
                const realHex = this.board.get(rayHex.uid);
                if (realHex === undefined) {
                    throw new Error(`Could not find a hex ${rayHex.uid}`);
                }
                if (stack.length > 0) {
                    let toPlace: playerid[];
                    // if we've reached the last possible space
                    // place the rest of the stack
                    if (i === ray.length - 1) {
                        toPlace = [...stack];
                        stack = [];
                    }
                    // otherwise just place the bottom piece
                    else {
                        toPlace = [stack[0]];
                        stack = stack.slice(1);
                    }
                    let newstack = [...toPlace];
                    if (realHex.stack !== undefined) {
                        newstack = [...realHex.stack, ...toPlace];
                    }
                    realHex.stack = [...newstack];
                    this.board.set(realHex.uid, realHex);
                }
            }
            this.results.push({type: "move", from: fhex.uid, to: thex.uid});
        }
        // enlargement
        else if (m.includes("+")) {
            const stripped = m.replace(/\+/g, "");
            const cells = stripped.split(";");
            for (const cell of cells) {
                const hex = [...this.board.values()].find(h => h.uid === cell);
                if (hex === undefined) {
                    throw new Error(`Could not find a hex at ${cell}`);
                }
                hex.tile = this.currplayer;
                this.tiles--;
                // During "exNihilo" setup phase, stack will be undefined
                if (hex.stack !== undefined) {
                    const stack = [...hex.stack];
                    hex.stack = undefined;
                    for (const p of stack) {
                        this.inhand[p - 1]++;
                    }
                }
                this.board.set(hex.uid, hex);
                this.results.push({type: "claim", where: cell});
            }
            this.expandPerimeter();
        }
        // placement
        else if (m !== "pass") {
            const hex = [...this.board.values()].find(h => h.uid === m);
            if (hex === undefined) {
                throw new Error(`Could not find a hex at ${m}`);
            }
            hex.stack = [this.currplayer];
            this.board.set(hex.uid, hex);
            this.inhand[this.currplayer - 1]--;
            this.results.push({type: "place", where: m})
        }
        // has to be pass
        else {
            this.results.push({type: "pass"});
        }

        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public getPlayerScore(player: playerid): number {
        // build graph for player
        const g = new UndirectedGraph();
        const owned = [...this.board.values()].filter(h => h.tile === player);
        for (const hex of owned) {
            if (! g.hasNode(hex.uid)) {
                g.addNode(hex.uid);
            }
            for (const n of hexNeighbours(hex)) {
                const nuid = `${n.q},${n.r}`;
                const nhex = owned.find(h => h.uid === nuid);
                if (nhex !== undefined) {
                    if (! g.hasNode(nhex.uid)) {
                        g.addNode(nhex.uid);
                    }
                    if (! g.hasEdge(hex.uid, nhex.uid)) {
                        g.addEdge(hex.uid, nhex.uid);
                    }
                }
            }
        }

        // get connected components, sorted by size
        const groups = connectedComponents(g);
        groups.sort((a, b) => b.length - a.length);

        // tabulate
        let score = 0;
        if (groups.length > 0) {
            score += groups[0].length * 2;
            for (const group of groups.slice(1)) {
                score += group.length;
            }
        }
        return score;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.inhand },
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score}\n\n`;
        }

        status += `**Tiles**: ${this.tiles}\n\n`

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.inhand[n - 1];
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected checkEOG(): ExxitGame {
        let passedOut = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedOut = true;
        }

        if (passedOut || this.tiles === 0) {
            this.gameover = true;
            const p1score = this.getPlayerScore(1);
            const p2score = this.getPlayerScore(2);
            if (p1score > p2score) {
                this.winner = [1];
            } else if (p2score > p1score) {
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

    public state(): IExxitState {
        return {
            game: ExxitGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ExxitGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, ExxitHex>,
            tiles: this.tiles,
            inhand: [...this.inhand] as [number,number],
        };
    }

    public render(): APRenderRep {
        const minCol = Math.min(...[...this.board.values()].map(hex => hex.col));
        const maxCol = Math.max(...[...this.board.values()].map(hex => hex.col));
        const minRow = Math.min(...[...this.board.values()].map(hex => hex.row));
        const maxRow = Math.max(...[...this.board.values()].map(hex => hex.row));
        const width = maxCol - minCol + 1;
        const height = maxRow - minRow + 1;
        const dx = 0 - minCol;
        const dy = 0 - minRow;
        const originHex = this.board.get("0,0")!;

        const blocked: {row: number; col: number}[] = [];
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const found = [...this.board.values()].find(h => h.row + dy === row && h.col + dx === col);
                if (found === undefined) {
                    blocked.push({row, col})
                }
            }
        }

        const flooded: [{row: number; col: number}[],{row: number; col: number}[]] = [[],[]];
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const found = [...this.board.values()].find(h => h.row + dy === row && h.col + dx === col);
                if ( (found !== undefined) && (found.tile !== undefined) ) {
                    flooded[found.tile - 1].push({row: found.row + dy, col: found.col + dx});
                }
            }
        }

        // Build piece string
        const p2piece: string[] = ["A","B"];
        const pieces: string[][] = [];
        for (let row = 0; row < height; row++) {
            const node: string[] = [];
            for (let col = 0; col < width; col++) {
                const found = [...this.board.values()].find(h => h.row + dy === row && h.col + dx === col);
                if (found === undefined || found.stack === undefined) {
                    node.push("-")
                } else {
                    node.push(found.stack.map(p => p2piece[p-1]).join(""));
                }
            }
            pieces.push(node);
        }
        let pstr: string|null = pieces.map(r => r.join(",")).join("\n");
        if (pstr === "-") {
            pstr = null;
        }

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-labels"],
            renderer: "stacking-offset",
            board: {
                style: (originHex.row + dy) % 2 === 0 ? "hex-even-p" : "hex-odd-p",
                width,
                height,
                blocked: blocked as [{row: number; col: number},...{row: number; col: number}[]],
                markers: [],
            },
            legend: {
                A: {
                        name: "piece",
                        player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
            },
            pieces: pstr
        };
        // @ts-ignore
        if ((rep.board!.blocked as any[]).length === 0) {
            // @ts-ignore
            delete rep.board!.blocked;
        }
        // flood tiles
        for (let i = 0; i < flooded.length; i++) {
            if (flooded[i].length > 0) {
                // @ts-ignore
                (rep.board!.markers as any[]).push({
                    type: "flood",
                    points: flooded[i] as [{row: number; col: number},...{row: number; col: number}[]],
                    colour: i + 1,
                    opacity: 0.75
                });
            }
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const hex = this.board.get(move.where!);
                    if (hex !== undefined) {
                        const [x, y] = [hex.col + dx, hex.row + dy];
                        rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                    }
                } else if (move.type === "claim") {
                    const hex = this.board.get(move.where);
                    if (hex !== undefined) {
                        const [x, y] = [hex.col + dx, hex.row + dy];
                        rep.annotations.push({type: "dots", targets: [{row: y, col: x}]});
                    }
                } else if (move.type === "move") {
                    const from = this.board.get(move.from);
                    const to = this.board.get(move.to);
                    if (from !== undefined && to !== undefined) {
                        const [fromX, fromY] = [from.col + dx, from.row + dy];
                        const [toX, toY] = [to.col + dx, to.row + dy];
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    }
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "claim":
                node.push(i18next.t("apresults:CLAIM.exxit", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ExxitGame {
        return new ExxitGame(this.serialize());
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["claim", "place", "move", "eog", "winners"]);
    }
}
