/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBaseSimultaneous, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const clone = require("rfdc/default");

type playerid = 1|2|3|4|5|6|7|8;
type Facing = "N"|"E"|"S"|"W"|"U";
type CellContents = [playerid, Facing];

// these are in resolution order: noops, damage, rotations, moves
const cmds = ["f", "h", "<", ">", "^", "v", "\\", "/"];
const hitDirs = new Map<Facing, Directions[]>([
    ["N", ["NW", "N", "NE"]],
    ["E", ["NE", "E", "SE"]],
    ["S", ["SW", "S", "SE"]],
    ["W", ["NW", "W", "SW"]],
]);
const cw = new Map<Facing,Facing>([["N", "E"], ["E", "S"], ["S", "W"], ["W", "N"]]);
const ccw = new Map<Facing,Facing>([["N", "W"], ["W", "S"], ["S", "E"], ["E", "N"]]);
const opp = new Map<Facing,Facing>([["N", "S"], ["E", "W"], ["S", "N"], ["W", "E"]]);
const moveLeft = new Map<Facing,Directions>([["N", "NW"], ["E", "NE"], ["S", "SE"], ["W", "SW"]]);
const moveRight = new Map<Facing,Directions>([["N", "NE"], ["E", "SE"], ["S", "SW"], ["W", "NW"]]);

export interface IMoveState extends IIndividualState {
    board: Map<string, CellContents>;
    lastmove: string[];
    damage: number[];
    orders: string[][];
};

export interface IPigs2State extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    withdrawn: playerid[];
};

interface IPigPos {
    player: playerid;
    cell: string;
    facing: Facing;
}

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export class Pigs2Game extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "Robo Battle Pigs (Continuous)",
        uid: "pigs2",
        playercounts: [2,3,4,5,6,7,8],
        version: "20241216",
        dateAdded: "2023-06-27",
        // i18next.t("apgames:descriptions.pigs2")
        description: "apgames:descriptions.pigs2",
        // i18next.t("apgames:notes.pigs2")
        notes: "apgames:notes.pigs2",
        urls: [
            "http://cox-tv.com/games/mygames/robobattlepigs.html",
            "https://boardgamegeek.com/boardgame/3704/robo-battle-pigs",
        ],
        people: [
            {
                type: "designer",
                name: "Randy Cox",
                urls: ["http://cox-tv.com/games/index.php"]
            }
        ],
        categories: ["goal>annihilate", "mechanic>program",  "mechanic>simultaneous", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "simultaneous", "scores", "custom-buttons"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public board!: Map<string, CellContents>;
    public damage!: number[];
    public orders: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];
    public withdrawn: playerid[] = [];

    constructor(state?: IPigs2State | string | number) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            // init damage and orders
            const damage: number[] = [];
            const orders: string[][] = [];
            for (let i = 0; i < this.numplayers; i++) {
                damage.push(0);
                orders.push([]);
            }
            const board = new Map<string, CellContents>();
            let starts: [string, CellContents][];
            // 2-4 players, start on the outside facing in
            if (this.numplayers <= 4) {
                starts = [
                    ["e1", [1, "N"]],
                    ["d8", [2, "S"]],
                    ["h5", [3, "W"]],
                    ["a4", [4, "E"]],
                ];
            }
            // otherwise, distribute on the inside facing out
            else {
                starts = [
                    ["e3", [1, "S"]],
                    ["d6", [2, "N"]],
                    ["f5", [3, "E"]],
                    ["c4", [4, "W"]],
                    ["d3", [5, "S"]],
                    ["e6", [6, "N"]],
                    ["f4", [7, "E"]],
                    ["c5", [8, "W"]],
                ];
            }
            for (let i = 0; i < this.numplayers; i++) {
                board.set(starts[i][0], starts[i][1]);
            }
            const fresh: IMoveState = {
                _version: Pigs2Game.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                lastmove: [],
                orders,
                damage,
                board,
            };
            this.stack = [fresh];
        } else if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPigs2State;
            }
            if (state.game !== Pigs2Game.gameinfo.uid) {
                throw new Error(`The Robo Battle Pigs2 game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.withdrawn = [...state.withdrawn];
        } else {
            throw new Error("Unknown state passed.");
        }
        this.load();
    }

    public load(idx = -1): Pigs2Game {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board = clone(state.board) as Map<string, CellContents>;
        this.orders = state.orders.map(o => [...o]);
        this.damage = [...state.damage];
        this.lastmove = state.lastmove.join(',');
        return this;
    }

    public handleClickSimultaneous(): IClickResult {
        return {move: "", message: i18next.t("apgames:validation.pigs2.INITIAL_INSTRUCTIONS", {context: this.stack.length === 1 ? "first": "rest"})} as IClickResult;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        // on first turn, return nothing (512 permutations)
        if (this.stack.length > 1) {
            return cmds;
        }
        return [];
    }

    public getButtons(): ICustomButton[] {
        // const cmds = ["f", "h", "<", ">", "^", "v", "\\", "/"];
        if (this.stack.length > 1) {
            return [
                {
                    label: "Move backward",
                    move: "v"
                },
                {
                    label: "Move forward",
                    move: "^"
                },
                {
                    label: "Move forward left",
                    move: "\\"
                },
                {
                    label: "Move forward right",
                    move: "/"
                },
                {
                    label: "Rotate clockwise",
                    move: ">"
                },
                {
                    label: "Rotate counterclockwise",
                    move: "<"
                },
                {
                    label: "Fire laser",
                    move: "f"
                },
                {
                    label: "Swing snout",
                    move: "h"
                },
            ];
        }
        return [];
    }

    public validateMove(m: string, player: playerid): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // always pass \u0091 characters
        if (m === "\u0091") {
            if (! this.isEliminated(player)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs2.INVALID_CMD", {cmd: m});
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else if (this.isEliminated(player)) {
            throw new Error("Eliminated players should never have moves being validated.");
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pigs2.INITIAL_INSTRUCTIONS", {context: this.stack.length === 1 ? "first": "rest"});
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        // as soon as they type an invalid character, tell them
        for (const char of m) {
            if (! cmds.includes(char)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs2.INVALID_CMD", {cmd: char});
                return result;
            }
        }
        // correct number of commands
        if (m.length > (this.stack.length === 1 ? 3 : 1)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.pigs2.TOOLONG", {context: this.stack.length === 1 ? "first" : "rest"});
            return result;
        }
        // if less than needed, keep repeating the initial instructions
        if (m.length < (this.stack.length === 1 ? 3 : 1)) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pigs2.INITIAL_INSTRUCTIONS");
            return result;
        }

        // valid final move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public isEliminated(id: number): boolean {
        if (
            (id > 0) &&
            (
                this.withdrawn.includes(id as playerid) ||
                (
                    (id <= this.damage.length) &&
                    (this.damage[id - 1] >= 5)
                )
            )
        ) {
            return true;
        }
        return false;
    }

    public move(m: string, {trusted = false} = {}): Pigs2Game {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const moves: string[] = m.split(/\s*,\s*/);
        if (moves.length !== this.numplayers) {
            throw new UserFacingError("MOVES_SIMULTANEOUS_PARTIAL", i18next.t("apgames:MOVES_SIMULTANEOUS_PARTIAL"));
        }
        for (let i = 0; i < moves.length; i++) {
            if ( (moves[i] === undefined) || (moves[i] === "") ) {
                continue;
            }
            moves[i] = moves[i].toLowerCase();
            moves[i] = moves[i].replace(/\s+/g, "");
            if (! trusted) {
                const result = this.validateMove(moves[i], (i + 1) as playerid);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
            }
        }

        // get ready
        const grid = new RectGrid(8, 8);
        const pigs = [...this.board.entries()].map(e => { return {player: e[1][0], cell: e[0], facing: e[1][1]} as IPigPos}).sort((a, b) => a.player - b.player);
        const dmgApplied: number[] = []
        const resultGroups: APMoveResult[][] = [];
        for (let i = 0; i < this.numplayers; i++) {
            resultGroups.push([]);
            dmgApplied.push(0);
        }

        // first store the received orders
        for (let p = 0; p < this.numplayers; p++) {
            // ignore eliminated players
            if (this.isEliminated(p+1)) { continue; }
            if (this.stack.length === 1) {
                this.orders[p] = moves[p].split("").reverse();
            } else {
                this.orders[p].unshift(moves[p]);
            }
        }

        // now fetch the next orders to execute
        const parsed: string[] = [];
        for (let p = 0; p < this.numplayers; p++) {
            // empty moves for eliminated players
            if (this.isEliminated(p+1)) {
                parsed.push("");
            }
            // otherwise pop the next order from the stack
            else {
                parsed.push(this.orders[p].pop()!);
            }
        }

        // for each move
        const next: [string,string,boolean|undefined][] = [];
        // resolve all movement first
        for (let player = 1; player <= this.numplayers; player++) {
            // ignore eliminated players
            if (this.isEliminated(player)) {
                next.push(["","",undefined]);
                continue;
            }
            const cmd = parsed[player - 1];
            const pig = pigs.find(p => p.player === player);
            if (pig === undefined) { throw new Error(`Could not find a pig for player ${player}!`); }
            if (pig.facing === "U") { throw new Error(`Disabled pigs cannot act!`); }
            next.push([pig.cell, pig.cell, false]);

            // rotations
            if ( (cmd === "<") || (cmd === ">") ) {
                let newdir: Facing;
                if (cmd === "<") {
                    newdir = ccw.get(pig.facing)!;
                } else {
                    newdir = cw.get(pig.facing)!;
                }
                resultGroups[player - 1].push({type: "orient", where: pig.cell, facing: newdir, what: cmd === "<" ? "ccw" : "cw"});
                pig.facing = newdir;
            }
            // moves
            else if (["^","v","/","\\"].includes(cmd)) {
                next[player - 1][2] = true;
                const [fx, fy] = Pigs2Game.algebraic2coords(pig.cell);
                let dir: Directions = pig.facing;
                if (cmd === "v") {
                    // @ts-ignore (can ignore because facing is never "U" at this point)
                    dir = opp.get(pig.facing)!;
                } else if (cmd === "\\") {
                    dir = moveLeft.get(pig.facing)!;
                } else if (cmd === "/") {
                    dir = moveRight.get(pig.facing)!;
                }
                const ray = grid.ray(fx, fy, dir).map(node => Pigs2Game.coords2algebraic(...node));
                if (ray.length > 0) {
                    next[player - 1][1] = ray[0];
                }
            }
        }
        // TODO: I think we need to do something about running over eliminated pigs
        // resolve collisions
        for (let i = 0; i < this.numplayers; i++) {
            if (this.isEliminated(i + 1)) { continue; }
            const pig = pigs.find(p => p.player === i + 1);
            if (pig === undefined) { throw new Error(`Could not find a pig for player ${i + 1}!`); }
            if (pig.facing === "U") { throw new Error(`Disabled pigs cannot act!`); }
            const [from, to, tried] = next[i];
            // if they didn't move, skip
            if (from === to) {
                if (tried) {
                    resultGroups[i].push({type: "move", from, to: from});
                }
                continue;
            }
            const others = clone(next) as [string,string][];
            others.splice(i, 1);
            // see if `to` is already occupied
            if (others.map(o => o[1]).includes(to)) {
                resultGroups[i].push({type: "move", from, to: from});
                continue;
            }
            // see if cell swapping happened
            const reversed = others.map(o => [o[1], o[0]].join(","));
            if (reversed.includes(`${from},${to}`)) {
                resultGroups[i].push({type: "move", from, to: from});
                continue;
            }
            // otherwise we're good
            resultGroups[i].push({type: "move", from, to});
            pig.cell = to;
        }

        // then resolve damage
        for (let player = 1; player <= this.numplayers; player++) {
            // ignore eliminated players
            if (this.isEliminated(player)) { continue; }
            const cmd = parsed[player - 1];
            const pig = pigs.find(p => p.player === player);
            if (pig === undefined) { throw new Error(`Could not find a pig for player ${player}!`); }
            if (pig.facing === "U") { throw new Error(`Disabled pigs cannot act!`); }
            next.push([pig.cell, pig.cell, false]);

            // damage
            if (cmd === "f") {
                const ray = grid.ray(...Pigs2Game.algebraic2coords(pig.cell), pig.facing).map(node => Pigs2Game.coords2algebraic(...node));
                let hit = ray[ray.length - 1];
                let victim: IPigPos|undefined;
                for (const target of ray) {
                    victim = pigs.find(p => p.cell === target);
                    if (victim !== undefined) {
                        hit = target;
                        break;
                    }
                }
                resultGroups[player - 1].push({type: "fire", from: pig.cell, which: "F", to: hit});
                if (victim !== undefined) {
                    let dmg = 1;
                    if (victim.facing === "U") {
                        dmg = 0;
                    }
                    resultGroups[player - 1].push({type: "damage", who: victim.player.toString(), where: victim.cell, amount: dmg});
                    dmgApplied[victim.player - 1] += dmg;
                }
            } else if (cmd === "h") {
                resultGroups[player - 1].push({type: "fire", which: "H"});
                const targets: string[] = [];
                for (const dir of hitDirs.get(pig.facing)!) {
                    const [x, y] = Pigs2Game.algebraic2coords(pig.cell);
                    const poss = RectGrid.move(x, y, dir);
                    if (grid.inBounds(...poss)) {
                        targets.push(Pigs2Game.coords2algebraic(...poss));
                    }
                }
                for (const t of targets) {
                    const victim = pigs.find(p => p.cell === t);
                    if (victim !== undefined) {
                        let dmg = 1;
                        if (victim.facing === "U") { dmg = 0; }
                        resultGroups[player - 1].push({type: "damage", who: victim.player.toString(), where: victim.cell, amount: dmg});
                        dmgApplied[victim.player - 1] += dmg;
                    }
                }
            }
        } // foreach player

        // apply damage and finalize repairs
        for (let i = 0; i < this.numplayers; i++) {
            this.damage[i] += dmgApplied[i];
            if (this.damage[i] >= 5) {
                resultGroups[i].push({type: "eliminated", who: (i + 1).toString()});
                const pig = pigs.find(p => p.player === i + 1);
                if (pig !== undefined) {
                    pig.facing = "U";
                }
            }
        }

        // apply `pigs` to `board`
        this.board.clear();
        for (const pig of pigs) {
            this.board.set(pig.cell, [pig.player, pig.facing]);
        }
        // save the grouped results
        this.results = [];
        for (let i = 0; i < this.numplayers; i++) {
            this.results.push({type: "_group", who: i + 1, results: resultGroups[i] as [APMoveResult,...APMoveResult[]]});
        }

        this.lastmove = [...parsed].join(',').toUpperCase().replace(/V/g, "v");
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): Pigs2Game {
        let numAlive = 0;
        for (let i = 1; i <= this.numplayers; i++) {
            if (! this.isEliminated(i)) {
                numAlive++;
            }
        }

        // if nobody left alive, draw
        if (numAlive === 0) {
            this.gameover = true;
            this.results.push({type: "eog"});
            this.winner = [];
            for (let i = 1; i <= this.numplayers; i++) {
                this.winner.push(i as playerid);
            }
            this.results.push({type: "winners", players: this.winner});
        }
        // if only one person alive, they win
        else if (numAlive === 1) {
            this.gameover = true;
            this.results.push({type: "eog"});
            this.winner = [];
            for (let i = 1; i <= this.numplayers; i++) {
                if (! this.isEliminated(i)) {
                    this.winner = [i as playerid];
                }
            }
            this.results.push({type: "winners", players: this.winner});
        }

        return this;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.DAMAGE"), scores: [...this.damage] },
        ]
    }

    public state(opts?: {strip?: boolean, player?: number}): IPigs2State {
        const state = {
            game: Pigs2Game.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            withdrawn: [...this.withdrawn],
            winner: [...this.winner],
            stack: [...this.stack]
        };
        if (opts !== undefined && opts.strip) {
            state.stack = state.stack.map(mstate => {
                for (let p = 1; p <= this.numplayers; p++) {
                    if (p === opts.player) { continue; }
                    mstate.orders[p-1] = [];
                }
                return mstate;
            });
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: Pigs2Game.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: (this.lastmove === undefined ? [] : this.lastmove.split(',')),
            board: new Map(this.board),
            damage: [...this.damage],
            orders: this.orders.map(o => [...o]),
        };
    }

    public render(): APRenderRep {
        const player2label = new Map<playerid,string>([[1,"A"],[2,"B"],[3,"C"],[4,"D"],[5, "E"],[6, "F"],[7, "G"],[8, "H"]]);
        const facing2rot = new Map<Facing,number>([["N", 0],["E", 90],["S", 180],["W", 270]]);
        const cmd2glyph = new Map<string, string>([
            ["f", "F"],
            ["h", "H"],
            ["<", "CCW"],
            [">", "CW"],
            ["^", "MF"],
            ["v", "MB"],
            ["\\", "FL"],
            ["/", "FR"],
        ]);
        const glyph2unicode = new Map<string, string>([
            ["F", "\u26ef"],
            ["H", "\u2927"],
            ["CCW", "\u21b6"],
            ["CW", "\u21b7"],
            ["MF", "\u2191"],
            ["MB", "\u2193"],
            ["FL", "\u2196"],
            ["FR", "\u2197"],
        ]);
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const cells: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = Pigs2Game.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    cells.push(`${player2label.get(contents[0])}${contents[1]}`);
                } else {
                    cells.push("");
                }
            }
            pstr += cells.join(",");
        }
        pstr = pstr.replace(/\n,{7}(?=\n)/g, "\n_");

        const legend: ILegendObj = {};
        // real pieces
        for (const [player, facing] of this.board.values()) {
            const label = `${player2label.get(player)}${facing}`;
            if (facing === "U") {
                legend[label] = {
                    name: "pyramid-up-large-upscaled",
                    colour: player
                };
            } else {
                legend[label] = {
                    name: "pyramid-flat-large",
                    colour: player,
                    rotate: facing2rot.get(facing)
                };
            }
        }
        // order glyphs
        for (const [g, u] of glyph2unicode.entries()) {
            legend[g] = {
                text: u,
                colour: "_context_labels"
            };
        }
        // rotation annotation glyphs
        legend.nCW = {
            text: "\u21b7",
            colour: "_context_annotations",
            scale: 0.5,
        };
        legend.nCCW = {
            text: "\u21b6",
            colour: "_context_annotations",
            scale: 0.5,
        };

        // build pieces areas
        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const order = this.orders[p-1];
            if (order.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: order.map(c => cmd2glyph.get(c)!) as [string, ...string[]],
                    label: i18next.t("apgames:validation.pigs2.LABEL_ORDERS", {playerNum: p}) || "local",
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 8,
                height: 8,
            },
            legend,
            pieces: pstr,
            areas,
        };

        if (this.stack[this.stack.length - 1]._results.length > 0) {
        // if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
            // for (const move of this.results) {
                if (move.type === "_group") {
                    for (const result of move.results) {
                        if (result.type === "move") {
                            if (result.from !== result.to) {
                                const [fx, fy] = Pigs2Game.algebraic2coords(result.from);
                                const [tx, ty] = Pigs2Game.algebraic2coords(result.to);
                                rep.annotations.push({
                                    type: "move",
                                    arrow: true,
                                    targets: [
                                        {col: fx, row: fy},
                                        {col: tx, row: ty}
                                    ]
                                });
                            }
                        } else if ( (result.type === "fire") && (result.which === "F") ) {
                            const [fx, fy] = Pigs2Game.algebraic2coords(result.from!);
                            const [tx, ty] = Pigs2Game.algebraic2coords(result.to!);
                            rep.annotations.push({
                                type: "move",
                                arrow: true,
                                style: "dashed",
                                targets: [
                                    {col: fx, row: fy},
                                    {col: tx, row: ty}
                                ]
                            });
                        } else if (result.type === "damage") {
                            const [x, y] = Pigs2Game.algebraic2coords(result.where as string);
                            rep.annotations.push({
                                type: "exit",
                                targets: [{col: x, row: y}]
                            });
                        } else if (result.type === "orient") {
                            const dir = result.what!;
                            const [x, y] = Pigs2Game.algebraic2coords(result.where as string);
                            rep.annotations.push({
                                type: "glyph",
                                glyph: dir === "cw" ? "nCW" : "nCCW",
                                targets: [{col: x, row: y}]
                            });
                        }
                    }
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Damage Taken**\n\n";
        for (let i = 0; i < this.numplayers; i++) {
            status += `Player ${i + 1}: ${this.damage[i]}\n\n`;
        }

        status += "**Orders**\n\n";
        for (let i = 0; i < this.numplayers; i++) {
            status += `Player ${i + 1}: ${this.orders[i].join(" ")}\n\n`;
        }

        return status;
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                for (const r1 of state._results) {
                    if (r1.type === "_group") {
                        const player = players[r1.who - 1];
                        for (const r2 of r1.results) {
                            switch (r2.type) {
                                case "move":
                                    if (r2.from !== r2.to) {
                                        node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r2.from, to: r2.to}));
                                    } else {
                                        node.push(i18next.t("apresults:MOVE.collision", {player, from: r2.from, to: r2.to}));
                                    }
                                    break;
                                case "orient":
                                    node.push(i18next.t("apresults:ORIENT.nowhat", {player, where: r2.where, facing: r2.facing}));
                                    break;
                                case "pass":
                                    node.push(i18next.t("apresults:PASS.pigs", {player}));
                                    break;
                                case "fire":
                                    node.push(i18next.t("apresults:FIRE.pigs", {player, context: r2.which as string, direction: r2.to}));
                                    break;
                                case "damage":
                                    if ( (r2.amount !== undefined) && (r2.amount > 0) ) {
                                        const opponent = players[parseInt(r2.who as string, 10) - 1];
                                        node.push(i18next.t("apresults:DAMAGE.pigs", {player, where: r2.where as string, opponent}));
                                        break;
                                    }
                                case "eliminated":
                                    const oppPlayer = players[parseInt(r2.who!, 10) - 1];
                                    node.push(i18next.t("apresults:ELIMINATED", {player: oppPlayer}));
                                    break;
                            }
                        }
                    } else {
                        switch (r1.type) {
                            case "eog":
                                node.push(i18next.t("apresults:EOG.default"));
                                break;
                            case "resigned":
                                let rname = `Player ${r1.player}`;
                                if (r1.player <= players.length) {
                                    rname = players[r1.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r1.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r1.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r1.players.length, winners: names.join(", ")}));
                                break;
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    // In this version, timeouts and resignations result in being eliminated
    // without necessarily ending the game.
    public resign(player: number): GameBaseSimultaneous {
        // add to withdrawn
        this.withdrawn.push(player as playerid);
        // make robot upright
        const pigEntry = [...this.board.entries()].find(([,v]) => v[0] === player);
        if (pigEntry !== undefined) {
            this.board.set(pigEntry[0], [player as playerid, "U"]);
        }
        // add result message to last state in stack
        this.stack[this.stack.length - 1]._results.push({type: "resigned", player});
        return this;
    }

    public timeout(player: number): GameBaseSimultaneous {
        // add to withdrawn
        this.withdrawn.push(player as playerid);
        // make robot upright
        const pigEntry = [...this.board.entries()].find(([,v]) => v[0] === player);
        if (pigEntry !== undefined) {
            this.board.set(pigEntry[0], [player as playerid, "U"]);
        }
        // add result message to last state in stack
        this.stack[this.stack.length - 1]._results.push({type: "timeout", player});
        return this;
    }

    public clone(): Pigs2Game {
        return new Pigs2Game(this.serialize());
    }
}
