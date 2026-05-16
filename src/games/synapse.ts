import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IStashEntry } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export type playerid = 1|2;
export type Size = 1|2|3;
export type Facing = "N"|"E"|"S"|"W"|"U";
export type CellContents = [playerid, Size, Facing];

const NROWS = 5;
const NCOLS = 6;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    hands: [number[], number[]];
};

export interface ISynapseState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SynapseGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Synapse",
        uid: "synapse",
        playercounts: [2],
        version: "20260515",
        dateAdded: "2026-05-15",
        // i18next.t("apgames:descriptions.synapse")
        description: "apgames:descriptions.synapse",
        notes: "apgames:notes.synapse",
        urls: [
            "https://looneypyramids.wiki/wiki/Synapse-Ice",
            "https://boardgamegeek.com/boardgame/58907/synapse-ice",
        ],
        people: [
            {
                type: "designer",
                name: "Pierre Berloquin",
                urls: ["https://boardgamegeek.com/boardgamedesigner/10870/pierre-berloquin"]
            },
            {
                type: "designer",
                name: "Joseph Kisenwether",
                urls: ["https://boardgamegeek.com/boardgamedesigner/4921/joseph-kisenwether"]
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>place", "board>shape>rect", "components>pyramids"],
        flags: ["player-stashes", "experimental"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, NROWS);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, NROWS);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public hands!: [number[], number[]];
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ISynapseState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const hands: [number[], number[]] = [
                [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3], // initially, each player has five pieces of each size
                [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3]
            ];
            const fresh: IMoveState = {
                _version: SynapseGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, CellContents>(),
                hands,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISynapseState;
            }
            if (state.game !== SynapseGame.gameinfo.uid) {
                throw new Error(`The Synapse engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SynapseGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.hands = deepclone(state.hands);
        this.results = [...state._results];
        return this;
    }

    // is a valid coordinate iff the coords exist, and the position is empty
    private isValidCoord(x: number, y: number): boolean {
        if (x < 0 || x >= NCOLS || y < 0 || y >= NROWS) {
            return false;
        }
        const cell = SynapseGame.coords2algebraic(x, y);
        return !this.board.has(cell);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const allmoves: string[] = [];

        if ( this.stack.length === 1 ) { // game is starting, all positions are available
            for (let x=0; x<NCOLS; x++) {
                for (let y=0; y<NROWS; y++) {
                    const cell = SynapseGame.coords2algebraic(x, y);
                    for (const size of [1,2,3]) {
                        if (x >= size)      allmoves.push(`${cell},${size},W`);
                        if (y >= size)      allmoves.push(`${cell},${size},N`);
                        if (x+size < NCOLS) allmoves.push(`${cell},${size},E`);
                        if (y+size < NROWS) allmoves.push(`${cell},${size},S`);
                    }
                }
            }
        } else {
            const [cell, size, dir] = this.lastmove!.split(',');
            const [x, y] = SynapseGame.algebraic2coords(cell);
            let dx : number = 0;
            let dy : number = 0;
            if (dir === 'N') {dx =  0; dy = -1}
            if (dir === 'S') {dx =  0; dy =  1}
            if (dir === 'W') {dx = -1; dy =  0}
            if (dir === 'E') {dx =  1; dy =  0}
            const nx = x + dx*Number(size); // coordinates of current cell
            const ny = y + dy*Number(size);
            const currentCell = SynapseGame.coords2algebraic(nx, ny);

            for (const size of [1,2,3] as number[]) {
                if (! this.hands[this.currplayer-1].includes(size) ) { continue; }
                for (const [dir,dx,dy] of
                           [["N",0,-1], ["S",0,1], ["E",1,0], ["W",-1,0]] as [string,number,number][]) {
                    if ( this.isValidCoord(nx + dx*size, ny + dy*size) ) {
                        allmoves.push(`${currentCell},${size},${dir}`);
                    }
                }
            }
        }

        return allmoves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = SynapseGame.coords2algebraic(col, row);
            let newmove = "";
            const tokens = move.split(',');
            const available: number[] = [...new Set(this.hands[this.currplayer - 1])]; // remove duplicates

            if (move.length === 0) {
                newmove = `${cell},${available[0]}`;
            } else if ( tokens.length === 2 && tokens[0] === cell ) { // still selecting pyramid
                const size = Number(tokens[1]);
                const pyrId = available.indexOf(size);
                newmove = `${tokens[0]},${available[(pyrId+1) % available.length]}`;
            } else if ( tokens.length === 2 && tokens[0] !== cell ) { // select direction
                const [x0, y0] = SynapseGame.algebraic2coords(tokens[0]);
                const [x1, y1] = SynapseGame.algebraic2coords(cell);
                const dx = x1-x0, dy = y1-y0;
                     if (dx == 0 && dy >  0) { newmove = `${move},S` }
                else if (dx == 0 && dy <  0) { newmove = `${move},N` }
                else if (dx >  0 && dy == 0) { newmove = `${move},E` }
                else if (dx <  0 && dy == 0) { newmove = `${move},W` }
                else { newmove = move }
            }

            const result = this.validateMove(newmove) as IClickResult;
            //console.debug('handle()', 'move', move, 'cell', cell, 'newmove', newmove, 'valid?', result.valid);
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

    private hasPrefix(moves: string[], partial: string): boolean {
        return moves.some(str => str.startsWith(partial));
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false,
                        message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.synapse.INITIAL_INSTRUCTIONS");
            return result;
        }

        const tokens = m.split(',');
        const allMoves = this.moves();
        //console.debug('allMoves()', ...allMoves);

        if ( tokens.length < 3 ) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.synapse.PLACE_INSTRUCTIONS");
            return result;
        }

        if (! this.hasPrefix(allMoves, m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.synapse.INVALID_MOVE", {move: m});
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SynapseGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.replace(/\s+/g, "");
        //console.debug('move()', 'm', m, 'partial?', partial, 'trusted?', trusted);
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        if ( m.split(',').length < 2 ) { return this; } // don't show until a piece size is chosen

        this.results = [];

        if ( m.split(',').length === 2 ) {
            const [cell, size] = m.split(',');
            this.board.set(cell, [this.currplayer, Number(size) as Size, 'U' as Facing]);
            this.results.push({ type: "place", where: cell });
        } else { // complete move
            const [cell, size, dir] = m.split(',');
            this.board.set(cell, [this.currplayer, Number(size) as Size, dir as Facing]);
            const index = this.hands[this.currplayer-1].indexOf(Number(size));
            this.hands[this.currplayer-1].splice(index, 1); // remove piece from player's hand
            this.results.push({ type: "place", where: cell });
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SynapseGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const allMoves = this.moves(this.currplayer);

        if ( allMoves.length === 0 ) {
            this.gameover = true;
            this.winner = [prevplayer];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ISynapseState {
        return {
            game: SynapseGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SynapseGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            hands: deepclone(this.hands),
        };
    }

    private getTarget(): [number, number] {
        if (this.stack.length < 2 ) return [-1, -1];
        const tokens = this.lastmove!.split(',');
        if (tokens.length < 3) return [-1, -1];

        const [cell, size, dir] = tokens;
        const [x,y] = SynapseGame.algebraic2coords(cell);
        let dx=0, dy=0;
        if (dir === 'N') {dx =  0; dy = -1}
        if (dir === 'S') {dx =  0; dy =  1}
        if (dir === 'W') {dx = -1; dy =  0}
        if (dir === 'E') {dx =  1; dy =  0}
        return [x + Number(size)*dx, y + Number(size)*dy];
    }

    public render(): APRenderRep {
        const [xt, yt] = this.getTarget(); // returns [-1,-1] if not available yet
        // Build piece string
        let pstr = "";
        for (let row = 0; row < NROWS; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            const pieces: string[] = [];
            for (let col = 0; col < NCOLS; col++) {
                const cell = SynapseGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    const owner = contents[0] === 1 ? "X" : "Y";
                    pieces.push(owner + contents[1].toString() + contents[2]);
                } else {
                    if (xt !== -1 && col === xt && row === yt) {
                        pieces.push("Z");
                    } else {
                        pieces.push("");
                    }
                }
            }
            pstr += pieces.join(",");
        }

        const starColour: Colourfuncs = {
            func: "custom",
            default: "#AD03DE", // vibrant purple  (alternative: "#FFDF00", // gold yellow)
            palette: 3
        };

        const myLegend: ILegendObj = {};
        const rotations: Map<string, number> = new Map([ ["N", 0], ["E", 90], ["S", 180], ["W", -90] ]);
        const playerNames = ["X", "Y"];
        const sizeNames = ["small", "medium", "large"]
        for (const player of [1, 2]) {
            for (const size of [1, 2, 3]) {

                for (const dir of rotations.entries()) {
                    const node: Glyph = {
                        name: "pyramid-flat-" + sizeNames[size - 1],
                        scale: 0.90,
                        colour: this.getPlayerColour(player as playerid),
                        rotate: dir[1],
                    };
                    myLegend[playerNames[player - 1] + size.toString() + dir[0]] = node;
                }

                const node: Glyph = {
                    name: "pyramid-up-" + sizeNames[size - 1],
                    scale: 0.90,
                    colour: this.getPlayerColour(player as playerid),
                };
                myLegend[playerNames[player - 1] + size.toString() + "U"] = node;

                const star: Glyph = {
                    name: "star-solid",
                    scale: 0.33,
                    colour: starColour,
                };
                myLegend["Z"] = star;
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: NCOLS,
                height: NROWS,
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [toX, toY] = SynapseGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                }
            }
        }

        return rep;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const col = this.getPlayerColour(player as playerid);
        return [
            { count: this.hands[player - 1].filter(x => x === 1).length,
              glyph: { name: "pyramid-flat-small", colour: col },
              movePart: "" },
            { count: this.hands[player - 1].filter(x => x === 2).length,
              glyph: { name: "pyramid-flat-medium", colour: col },
              movePart: "" },
            { count: this.hands[player - 1].filter(x => x === 3).length,
              glyph: { name: "pyramid-flat-large", colour: col },
              movePart: "" },
        ];
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return { func: "custom", default: 1, palette: 1 };
        } else {
            return { func: "custom", default: 2, palette: 2 };
        }
    }

    public clone(): SynapseGame {
        return new SynapseGame(this.serialize());
    }
}
