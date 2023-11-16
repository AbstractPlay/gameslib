/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBaseSimultaneous, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const clone = require("rfdc/default");

type playerid = 1|2|3|4;
type Facing = "N"|"E"|"S"|"W"|"U";
type CellContents = [playerid, Facing];

// these are in resolution order: noops, damage, rotations, moves
const cmds = ["x", "r", "f", "h", "<", ">", "^", "v", "\\", "/"];
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
    ghosts: [string,CellContents][];
};

export interface IPigsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface IPigPos {
    player: playerid;
    cell: string;
    facing: Facing;
}

interface IGlyphMarker {
    /**
     * A way of incorporating a glyph from the legend into the board itself. Currently only works in the `default` and `stacking-offset` renderer.
     */
    type: "glyph";
    /**
     * The name of the glyph in the `legend`.
     */
    glyph: string;
    /**
     * Like with `annotations`, the renderer knows nothing about a game's notation. You must provide instead the column and row numbers, which are zero-based: 0,0 is the top row, top column.
     *
     * @minItems 1
     */
    points: [
      {
        row: number;
        col: number;
      },
      ...{
        row: number;
        col: number;
      }[]
    ];
  }

export class PigsGame extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "Robo Battle Pigs",
        uid: "pigs",
        playercounts: [2,3,4],
        version: "20230618",
        // i18next.t("apgames:descriptions.pigs")
        description: "apgames:descriptions.pigs",
        // i18next.t("apgames:notes.pigs")
        notes: "apgames:notes.pigs",
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
        flags: ["simultaneous", "scores", "no-moves"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public board!: Map<string, CellContents>;
    public ghosts: [string,CellContents][] = [];
    public damage!: number[];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: IPigsState | string | number) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const damage: number[] = [0,0];
            const board = new Map<string, CellContents>([
                ["e1", [1, "N"]],
                ["d8", [2, "S"]],
            ]);
            if (this.numplayers > 2) {
                board.set("h5", [3, "W"]);
                damage.push(0)
            }
            if (this.numplayers > 3) {
                board.set("a4", [4, "E"]);
                damage.push(0);
            }
            const fresh: IMoveState = {
                _version: PigsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                lastmove: [],
                ghosts: [],
                damage,
                board,
            };
            this.stack = [fresh];
        } else if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPigsState;
            }
            if (state.game !== PigsGame.gameinfo.uid) {
                throw new Error(`The Robo Battle Pigs game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            throw new Error("Unknown state passed.");
        }
        this.load();
    }

    public load(idx = -1): PigsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board = new Map(state.board);
        this.ghosts = clone(state.ghosts) as [string,CellContents][];
        this.damage = [...state.damage];
        this.lastmove = state.lastmove.join(',');
        return this;
    }

    public handleClickSimultaneous(): IClickResult {
        return {move: "", message: i18next.t("apgames:validation.pigs.INITIAL_INSTRUCTIONS")} as IClickResult;
    }

    public validateMove(m: string, player: playerid): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // always pass \u0091 characters
        if (m === "\u0091") {
            if (! this.isEliminated(player)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs.INVALID_CMD", {cmd: m});
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
            result.message = i18next.t("apgames:validation.pigs.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m !== "r") {
            // as soon as they type an invalid character, tell them
            for (const char of m) {
                if (! cmds.includes(char)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pigs.INVALID_CMD", {cmd: char});
                    return result;
                }
            }
            // repair is a single character
            if ( (m.length > 1) && (m.includes("r")) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs.REPAIR_SINGLE");
                return result;
            }
            // no longer than 5 characters
            if (m.length > 5) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs.TOOLONG");
                return result;
            }
            // if less than 5, keep repeating the initial instructions
            if (m.length < 5) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.pigs.INITIAL_INSTRUCTIONS");
                return result;
            }
            // Once it's the correct length, make sure it contains enough Xs
            const dmg = Math.min(this.damage[player - 1], 5);
            if (m.split("").filter(c => c === "x").length < dmg) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs.X_TOOFEW");
                return result;
            }
            if (m.split("").filter(c => c === "x").length > dmg) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs.X_TOOMANY");
                return result;
            }
        } else {
            if (this.damage[player - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pigs.UNDAMAGED");
                return result;
            }
        }

        // valid final move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public isEliminated(id: number): boolean {
        if ( (id > 0) && (id <= this.damage.length) && (this.damage[id - 1] >= 5) ) {
            return true;
        }
        return false;
    }

    public move(m: string, {partial = false, trusted = false} = {}): PigsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const moves: string[] = m.split(/\s*,\s*/);
        if (moves.length !== this.numplayers) {
            throw new UserFacingError("MOVES_SIMULTANEOUS_PARTIAL", i18next.t("apgames:MOVES_SIMULTANEOUS_PARTIAL"));
        }
        for (let i = 0; i < moves.length; i++) {
            if ( (partial) && ( (moves[i] === undefined) || (moves[i] === "") ) ) {
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
        this.ghosts = [];
        const parsed = moves.map(s => s.split(""));
        const grid = new RectGrid(8, 8);
        const pigs = [...this.board.entries()].map(e => { return {player: e[1][0], cell: e[0], facing: e[1][1]} as IPigPos}).sort((a, b) => a.player - b.player);
        const resultGroups: APMoveResult[][] = [];
        const dmgApplied: number[] = []
        for (let i = 0; i < this.numplayers; i++) {
            resultGroups.push([]);
            dmgApplied.push(0);
        }

        // for each of the five moves
        for (let mnum = 0; mnum < 5; mnum++) {
            const next: [string,string,boolean|undefined][] = [];
            // resolve all movement first
            for (let player = 1; player <= this.numplayers; player++) {
                // ignore eliminated players
                if (this.isEliminated(player)) {
                    next.push(["","",undefined]);
                    continue;
                }
                let cmd = "r";
                if (mnum < parsed[player - 1].length) {
                    cmd = parsed[player - 1][mnum];
                }
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
                    resultGroups[player - 1].push({type: "orient", where: pig.cell, facing: newdir});
                    this.ghosts.push([pig.cell, [pig.player, pig.facing]]);
                    pig.facing = newdir;
                }
                // moves
                else if (["^","v","/","\\"].includes(cmd)) {
                    next[player - 1][2] = true;
                    const [fx, fy] = PigsGame.algebraic2coords(pig.cell);
                    let dir: Directions = pig.facing;
                    if (cmd === "v") {
                        // @ts-ignore (can ignore because facing is never "U" at this point)
                        dir = opp.get(pig.facing)!;
                    } else if (cmd === "\\") {
                        dir = moveLeft.get(pig.facing)!;
                    } else if (cmd === "/") {
                        dir = moveRight.get(pig.facing)!;
                    }
                    const ray = grid.ray(fx, fy, dir).map(node => PigsGame.coords2algebraic(...node));
                    if (ray.length > 0) {
                        next[player - 1][1] = ray[0];
                    }
                }
            }
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
                this.ghosts.push([from, [i + 1 as playerid, pig.facing]]);
                resultGroups[i].push({type: "move", from, to});
                pig.cell = to;
            }

            // then resolve damage
            for (let player = 1; player <= this.numplayers; player++) {
                // ignore eliminated players
                if (this.isEliminated(player)) { continue; }
                let cmd = "r";
                if (mnum < parsed[player - 1].length) {
                    cmd = parsed[player - 1][mnum];
                }
                const pig = pigs.find(p => p.player === player);
                if (pig === undefined) { throw new Error(`Could not find a pig for player ${player}!`); }
                if (pig.facing === "U") { throw new Error(`Disabled pigs cannot act!`); }
                next.push([pig.cell, pig.cell, false]);

                // noops first
                if ( (cmd === "x") || (cmd === "r") ) {
                    resultGroups[player - 1].push({type: "pass"});
                }
                // damage
                else if (cmd === "f") {
                    const ray = grid.ray(...PigsGame.algebraic2coords(pig.cell), pig.facing).map(node => PigsGame.coords2algebraic(...node));
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
                        const [x, y] = PigsGame.algebraic2coords(pig.cell);
                        const poss = RectGrid.move(x, y, dir);
                        if (grid.inBounds(...poss)) {
                            targets.push(PigsGame.coords2algebraic(...poss));
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
        } // foreach move step
        // apply damage and finalize repairs
        for (let i = 0; i < this.numplayers; i++) {
            this.damage[i] += dmgApplied[i];
            if (parsed[i][0] === "r") {
                this.damage[i]--;
                resultGroups[i].push({type: "repair"});
            }
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

        if (partial) { return this; }

        this.lastmove = [...moves].join(',').toUpperCase().replace(/V/g, "v");
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): PigsGame {
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

    public state(): IPigsState {
        return {
            game: PigsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PigsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: (this.lastmove === undefined ? [] : this.lastmove.split(',')),
            board: new Map(this.board),
            damage: [...this.damage],
            ghosts: clone(this.ghosts) as [string,CellContents][]
        };
    }

    public render(): APRenderRep {
        const player2label = new Map<playerid,string>([[1,"A"],[2,"B"],[3,"C"],[4,"D"]]);
        const facing2rot = new Map<Facing,number>([["N", 0],["E", 90],["S", 180],["W", 270]]);
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const cells: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = PigsGame.coords2algebraic(col, row);
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

        const legend = {};
        // real pieces
        for (const [player, facing] of this.board.values()) {
            const label = `${player2label.get(player)}${facing}`;
            if (facing === "U") {
                // @ts-ignore
                legend[label] = {
                    name: "pyramid-up-large-upscaled",
                    player
                };
            } else {
                // @ts-ignore
                legend[label] = {
                    name: "pyramid-flat-large",
                    player,
                    rotate: facing2rot.get(facing)
                };
            }
        }
        // ghosts
        for (const [player, facing] of this.ghosts.map(g => g[1])) {
            const label = `g${player2label.get(player)}${facing}`;
            if (facing === "U") {
                // @ts-ignore
                legend[label] = {
                    name: "pyramid-up-large-upscaled",
                    player,
                    opacity: 0.25,
                    scale: 0.75,
                };
            } else {
                // @ts-ignore
                legend[label] = {
                    name: "pyramid-flat-large",
                    rotate: facing2rot.get(facing),
                    player,
                    opacity: 0.25,
                    scale: 0.75,
                };
            }
        }

        // It's anti-semantic, but markers are the best way of displaying ghosts
        const markers: IGlyphMarker[] = [];
        for (const [cell, [player, facing]] of this.ghosts) {
            const label = `g${player2label.get(player)}${facing}`;
            const [x, y] = PigsGame.algebraic2coords(cell);
            markers.push({
                type: "glyph",
                glyph: label,
                points: [{col: x, row: y}],
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            options: ["rotate-pieces"],
            board: {
                style: "squares",
                width: 8,
                height: 8,
                markers,
            },
            legend,
            pieces: pstr
        };

        if (this.stack[this.stack.length - 1]._results.length > 0) {
        // if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
            // for (const move of this.results) {
                if (move.type === "_group") {
                    const player = move.who;
                    for (const result of move.results) {
                        if (result.type === "move") {
                            if (result.from !== result.to) {
                                const [fx, fy] = PigsGame.algebraic2coords(result.from);
                                const [tx, ty] = PigsGame.algebraic2coords(result.to);
                                rep.annotations.push({
                                    type: "move",
                                    player,
                                    arrow: true,
                                    targets: [
                                        {col: fx, row: fy},
                                        {col: tx, row: ty}
                                    ]
                                });
                            }
                        } else if ( (result.type === "fire") && (result.which === "F") ) {
                            const [fx, fy] = PigsGame.algebraic2coords(result.from!);
                            const [tx, ty] = PigsGame.algebraic2coords(result.to!);
                            rep.annotations.push({
                                type: "move",
                                player,
                                arrow: true,
                                style: "dashed",
                                targets: [
                                    {col: fx, row: fy},
                                    {col: tx, row: ty}
                                ]
                            });
                        } else if (result.type === "damage") {
                            const [x, y] = PigsGame.algebraic2coords(result.where as string);
                            rep.annotations.push({
                                type: "exit",
                                player,
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
                                case "repair":
                                    node.push(i18next.t("apresults:REPAIR.simple", {player}));
                                    break;
                                case "eliminated":
                                    const oppPlayer = players[parseInt(r2.who, 10) - 1];
                                    node.push(i18next.t("apresults:ELIMINATED", {player: oppPlayer}));
                                    break;
                            }
                        }
                    } else {
                        switch (r1.type) {
                            case "eog":
                                node.push(i18next.t("apresults:EOG"));
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

    public clone(): PigsGame {
        return new PigsGame(this.serialize());
    }
}
