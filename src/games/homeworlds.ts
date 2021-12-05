import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Ship, System, Stash } from "./homeworlds/";
import { reviver } from "../common";
import { CartesianProduct, Permutation, PowerSet } from "js-combinatorics";
import { UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2|3|4;
export type Colour = "R"|"B"|"G"|"Y";
export type Seat = "N"|"E"|"S"|"W";
export type Size = 1|2|3;
export type Star = [Colour, Size];

// This should only include public-facing errors.
// Errors that should never happen can be omitted.
// eslint-disable-next-line no-shadow
export const enum HomeworldsErrors {
    STASH_EMPTY = "STASH_EMPTY",                // Attempting to take a piece when one is not available
    SYSTEM_BADNAME = "SYSTEM_BADNAME",          // The system name does not meet the requirements
    SYSTEM_FULL = "SYSTEM_FULL",                // There's no more room in the system to render more ships
    SYSTEM_NOSHIP = "SYSTEM_NOSHIP",            // The specified ship could not be found in this system
    MOVE_GAMEOVER = "MOVE_GAMEOVER",            // Tried to make a move in a game that's over
    MOVE_UNRECOGNIZED = "MOVE_UNRECOGNIZED",    // Unrecognized command
    MOVE_MOREACTIONS = "MOVE_MOREACTIONS",      // You still have actions to spend
    MOVE_SELFELIMINATE = "MOVE_SELFELIMINATE",  // You cannot eliminate yourself
    CMD_PARAMETERS = "CMD_PARAMETERS",          // Wrong number of parameters for the command given
    CMD_STARSHIP_NAME = "CMD_STARSHIP_NAME",    // Invalid ship or star designation
    CMD_NOSYSTEM = "CMD_NOSYSTEM",              // Could not find a system with the requested name
    CMD_NOACTIONS = "CMD_NOACTIONS",            // Insufficient actions remaining
    CMD_NOTECH = "CMD_NOTECH",                  // No access to the necessary technology
    CMD_HOME_DOUBLE = "CMD_HOME_DOUBLE",        // The current player tried to build a second homeworld
    CMD_HOME_SINGLE = "CMD_HOME_SINGLE",        // Requesting a single-starred homeworld
    CMD_HOME_SMALLSHIP = "CMD_HOME_SMALLSHIP",  // Requesting a homeworld with no large ship
    CMD_HOME_SAMESIZE = "CMD_HOME_SAMESIZE",    // Requesting a homeworld with two stars of the same size
    CMD_HOME_COLOURS = "CMD_HOME_COLOURS",      // Requesting a homeworld with fewer than three colours
    CMD_HOME_TECHS = "CMD_HOME_TECHS",          // Requesting a homeworld missing either G or B
    CMD_HOME_RHO = "CMD_HOME_RHO",              // Requesting a homeworld with the same star configuration as your RHO (nemesis)
    CMD_DISC_DOUBLE = "CMD_DISC_DOUBLE",        // A system by the requested name already exists
    CMD_MOVE_CONNECTION = "CMD_MOVE_CONNECTION",// The system you're trying to move to is not connected
    CMD_BUILD_TEMPLATE = "CMD_BUILD_TEMPLATE",  // Can't build ships of a colour you don't already have ships of in that system
    CMD_TRADE_DOUBLE = "CMD_TRADE_DOUBLE",      // You can't convert a ship from one colour into the same colour
    CMD_ATK_OWNER = "CMD_ATK_OWNER",            // In games with more than two players, you must specify the owner of the ship you're attacking
    CMD_ATK_SELF = "CMD_ATK_SELF",              // You can't attack your own ships
    CMD_ATK_SIZE = "CMD_ATK_SIZE",              // You can only attack ships the same size or smaller than your largest ship in the area
    CMD_CATA_INVALID = "CMD_CATA_INVALID",      // There is no overpopulation of the requested colour in the system
    CMD_CATA_ACTIONS = "CMD_CATA_ACTIONS",      // You cannot trigger a catastrophe while having actions to spend
    CMD_PASS_FREE = "CMD_PASS_FREE",            // You cannot pass your free action
    CMD_PASS_TOOMANY = "CMD_PASS_TOOMANY",      // You are asking to pass more actions than you have available
};

interface IActionTracker {
    R: number;
    B: number;
    G: number;
    Y: number;
    free: number;
}

interface ILooseObj {
    [key: string]: any;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    systems: System[];
    stash: Stash;
    lastmove?: string;
}

export interface IHomeworldsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class HomeworldsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Homeworlds",
        uid: "homeworlds",
        playercounts: [2,3,4],
        version: "20211024",
        // i18next.t("apgames:descriptions.homeworlds")
        description: "apgames:descriptions.homeworlds",
        urls: [
            "https://www.looneylabs.com/rules/homeworlds",
            "http://www.ginohn.com/wunder201005/games/Homeworlds/HomeworldsRules.html",
            "http://wunderland.com/WTS/Andy/Games/ILoveHomeworlds.html"
        ],
        people: [
            {
                type: "designer",
                name: "John Cooper"
            }
        ],
        flags: ["multistep", "shared-pieces"]
    };

    public numplayers!: number;
    public currplayer!: playerid;
    public systems: System[] = [];
    public stash!: Stash;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private actions!: IActionTracker;
    private eliminated: Seat[] = [];
    public variants: string[] = [];

    constructor(state: number | IHomeworldsState | string) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const fresh: IMoveState = {
                _version: HomeworldsGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                systems: [],
                stash: new Stash(this.numplayers + 1)
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHomeworldsState;
            }
            if (state.game !== HomeworldsGame.gameinfo.uid) {
                throw new Error(`The Homeworlds game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];

            // Now recursively "Objectify" the subclasses
            this.stack.map((s) => {
                s.stash = Object.assign(new Stash(this.numplayers + 1), s.stash);
                s.systems = s.systems.map(sys => System.deserialize(sys));
            });
            }
        this.load();
    }

    public player2seat(player: playerid = this.currplayer): Seat {
        switch(this.numplayers) {
            case 2:
                return ["N" as Seat, "S" as Seat][player - 1];
            case 3:
                return ["N" as Seat, "E" as Seat, "S" as Seat][player - 1];
            case 4:
                return ["N" as Seat, "E" as Seat, "S" as Seat, "W" as Seat][player - 1];
            default:
                throw new Error("Could not translate player number to seat. This should never happen.");
        }
    }

    private seat2name(seat?: Seat): string {
        if (seat === undefined) {
            seat = this.player2seat();
        }
        switch (seat) {
            case "N":
                return "North";
            case "E":
                return "East";
            case "S":
                return "South";
            case "W":
                return "W";
            default:
                throw new Error("Could not translate the seat into a system name. This should never happen.");
        }
    }

    // Has to be done *before* the player's turn starts
    public getLHO(player: playerid = this.currplayer): Seat | undefined {
        let nextPlayer: number = (player + 1);
        if (nextPlayer > this.numplayers) {
            nextPlayer = 1;
        }
        while (nextPlayer !== player) {
            const sys = this.systems.find(s => s.owner === this.player2seat(nextPlayer as playerid));
            if (sys !== undefined) {
                return sys.owner!;
            }
            nextPlayer++;
            if (nextPlayer > this.numplayers) {
                nextPlayer = 1;
            }
        }
        return undefined;
    }

    public getRHO(player: playerid = this.currplayer): Seat | undefined {
        let nextPlayer: number = (player - 1);
        if (nextPlayer < 0) {
            nextPlayer = this.numplayers;
        }
        while (nextPlayer !== player) {
            const sys = this.systems.find(s => s.owner === this.player2seat(nextPlayer as playerid));
            if (sys !== undefined) {
                return sys.owner!;
            }
            nextPlayer--;
            if (nextPlayer < 0) {
                nextPlayer = this.numplayers;
            }
        }
        return undefined;
    }

    public load(idx = -1): HomeworldsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.systems = state.systems.map(s => s.clone());
        this.stash = state.stash.clone();
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    private spendAction(colour?: Colour) {
        if ( (colour !== undefined) && (this.actions[colour] > 0) ) {
            this.actions[colour]--;
        } else if (this.actions.free > 0) {
            this.actions.free--;
        } else {
            throw new Error("Attempted to spend a nonexistent action. This should never happen.");
        }
    }

    private countActions(): number {
        if (this.actions !== undefined) {
            return this.actions.free + this.actions.R + this.actions.G + this.actions.B + this.actions.Y;
        }
        return 0;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        const movelst: string[] = [];

        const myseat = this.player2seat(player);
        const mysys = this.systems.find(s => s.owner === myseat);
        if (mysys === undefined) {
            // HOMEWORLDS command only
            const sizes = [...new Permutation("123", 2)].map(x => [...x, "3"]);
            const colours = [...new Permutation("GBR"), ...new Permutation("GBY")];
            for (const size of sizes) {
                for (const colour of colours) {
                    const cmd = `homeworld ${colour[0]}${size[0]} ${colour[1]}${size[1]} ${colour[2]}${size[2]}`;
                    const cloned = this.clone();
                    try {
                        cloned.move(cmd);
                    } catch {
                        continue;
                    }
                    movelst.push(cmd);
                }
            }
        } else {
            const allmoves: string[] = [];
            // All other possible moves
            // First let's do the non-sacrifice moves (move & discover, build, trade, attack)
            const tmpMoves: string[] = this.movesMove(player);
            const tmpTrade: string[] = this.movesTrade(player);
            const tmpBuild: string[] = this.movesBuild(player);
            const tmpAttack: string[] = this.movesAttack(player);
            const tmpSacrifice: string[] = this.movesSacrifice(player);

            allmoves.push(...tmpMoves, ...tmpTrade, ...tmpBuild, ...tmpAttack, ...tmpSacrifice);
            for (const cmd of allmoves) {
                const cloned = this.clone();
                try {
                    cloned.move(cmd);
                } catch {
                    continue;
                }
                movelst.push(cmd);
            }
            // Append optional catastrophes
            // For each valid move
            for (const m of movelst) {
                // Do the partial move
                const newg = new HomeworldsGame(this.serialize());
                newg.move(m, true);
                // Get a list of valid catastrophes
                const catas: string[] = [];
                for (const sys of newg.systems) {
                    for (const c of ["R" as Colour, "G" as Colour, "B" as Colour, "Y" as Colour]) {
                        if (sys.canCatastrophe(c)) {
                            catas.push(`catastrophe ${sys.name} ${c}`);
                        }
                    }
                }
                if (catas.length > 0) {
                    // Make a PowerSet of catstrophe combinations
                    const it = new PowerSet(catas);
                    for (const c of [...it]) {
                        // Append those to this move
                        if (c.length > 0) {
                            const newmove = [m, ...c].join(", ");
                            const myg = new HomeworldsGame(this.serialize());
                            try {
                                myg.move(newmove);
                            } catch {
                                continue;
                            }
                            movelst.push(newmove);
                        }
                    }
                }
            }
        }
        return movelst;
    }

    // These subfunctions don't actually validate the final move set. That's done in `moves()`.
    // These just generate the reasonable largest set of possible moves, to be collated and validated later.
    private genName(length = 5): string {
        let name: string = Math.random().toString(16).substr(2, length);
        let found = this.systems.find(s => s.name === name);
        while (found !== undefined) {
            name = Math.random().toString(16).substr(2, length);
            found = this.systems.find(s => s.name === name);
        }
        return name;
    }

    private movesMove(player: playerid, validateTech = true): string[] {
        const final: Set<string> = new Set<string>();
        const myseat = this.player2seat(player);

        // Generate a single discovered system name
        const newname = this.genName();

        for (const sys of this.systems) {
            if ( (validateTech) && (! sys.hasTech("Y", myseat)) ) {
                continue;
            }
            for (const ship of sys.ships.filter(s => s.owner === myseat)) {
                // First movement between existing systems
                const others = this.systems.filter(s => s.name !== sys.name);
                for (const other of others) {
                    if (sys.isConnected(other)) {
                        final.add(`move ${ship.colour}${ship.size} ${sys.name} ${other.name}`);
                    }
                }
                // Now discover the new system
                const stars: [Colour, Size][] = [...new CartesianProduct("RGBY", "123")].map(x => [x[0] as Colour, parseInt(x[1], 10) as Size]);
                for (const star of stars) {
                    const newsys = new System(newname, [star]);
                    if (sys.isConnected(newsys)) {
                        final.add(`discover ${ship.colour}${ship.size} ${sys.name} ${star.join("")} ${newname}`);
                        final.add(`move ${ship.colour}${ship.size} ${sys.name} ${newname}`);
                    }
                }
            }
        }
        return [...final.values()];
    }

    private movesTrade(player: playerid, validateTech = true): string[] {
        const final: Set<string> = new Set<string>();
        const myseat = this.player2seat(player);

        for (const sys of this.systems) {
            if ( (validateTech) && (! sys.hasTech("B", myseat)) ) {
                continue;
            }
            for (const ship of sys.ships.filter(s => s.owner === myseat)) {
                for (const c of ["R", "G", "B", "Y"]) {
                    if (c === ship.colour) {
                        continue;
                    }
                    final.add(`trade ${ship.colour}${ship.size} ${sys.name} ${c}`);
                }
            }
        }
        return [...final.values()];
    }

    private movesBuild(player: playerid, validateTech = true): string[] {
        const final: string[] = [];
        const myseat = this.player2seat(player);

        for (const sys of this.systems) {
            if ( (validateTech) && (! sys.hasTech("G", myseat)) ) {
                continue;
            }
            const existing: Set<Colour> = new Set<Colour>(sys.ships.filter(s => s.owner === myseat).map(s => s.colour));
            for (const c of existing) {
                final.push(`build ${c} ${sys.name}`);
            }
        }
        return final;
    }

    private movesAttack(player: playerid, validateTech = true): string[] {
        const final: Set<string> = new Set<string>();
        const myseat = this.player2seat(player);

        for (const sys of this.systems) {
            if ( (validateTech) && (! sys.hasTech("R", myseat)) ) {
                continue;
            }
            const enemies: Ship[] = sys.ships.filter(s => s.owner !== myseat);
            for (const enemy of enemies) {
                final.add(`attack ${enemy.id()} ${sys.name}`);
            }
        }
        return [...final.values()];
    }

    private movesSacrifice(player: playerid): string[] {
        const final: Set<string> = new Set<string>();
        const myseat = this.player2seat(player);

        for (const sys of this.systems) {
            const myships: Ship[] = sys.ships.filter(s => s.owner === myseat);
            for (const ship of myships) {
                const step = `sacrifice ${ship.id().slice(0,2)} ${sys.name}`;
                for (const m of this.recurseSacrifice([step], player, ship.colour, ship.size)) {
                    final.add(m);
                }
            }
        }
        return [...final.values()];
    }

    private recurseSacrifice(moves: string[], player: playerid, tech: Colour, depth: number): string[] {
        const movelst: string[] = [];
        // Clone the game object
        const myg = new HomeworldsGame(this.serialize());
        // Make the partial move (it might not be valid, so return empty string if so)
        try {
            myg.move(moves.join(", "), true);
        } catch {
            return [];
        }
        // Explore the current state for possibilities
        let possibilities: string[];
        switch (tech) {
            case "R":
                possibilities = myg.movesAttack(player, false);
                break;
            case "G":
                possibilities = myg.movesBuild(player, false);
                break;
            case "B":
                possibilities = myg.movesTrade(player, false);
                break;
            case "Y":
                possibilities = myg.movesMove(player, false);
                break;
        }
        possibilities.push("pass");
        // For each of those possibilities
        for (const p of possibilities) {
            // recurse further
            if (depth > 1) {
                movelst.push(...this.recurseSacrifice([...moves, p], player, tech, depth - 1));
            // or just return
            } else {
                const lst = [...moves, p];
                // move all passes to the end
                const passes = lst.filter(x => x === "pass");
                const others = lst.filter(x => x !== "pass");
                movelst.push([...others, ...passes].join(", "));
            }
        }
        return movelst;
    }

    /**
     * Determines if an isolated command is complete based solely on number of arguments.
     * Used by the click handler to contextualize a received click.
     *
     * @private
     * @param {string} cmd
     * @returns {boolean}
     * @memberof HomeworldsGame
     */
    private isCmdComplete(cmd: string): boolean {
        if ( (cmd === undefined) || (cmd === "") ) {
            return true;
        }

        /*
         * Valid commands
         *   - homeworld star1 star2 ship [*]
         *   - discover ship fromSystem star newName
         *   - move ship fromSystem toSystem
         *   - build ship inSystem
         *   - trade oldShip inSystem newColour
         *   - attack ship inSystem
         *   - sacrifice ship inSystem
         *   - catastrophe inSystem colour
         *   - pass number?
         */
        const [keyword, ...args] = cmd.split(/\s+/);
        if ( (keyword === "homeworld") && (args.length >= 3) ) {
            return true;
        }
        if ( (keyword === "discover") && (args.length >= 4) ) {
            return true;
        }
        if ( (keyword === "move") && (args.length >= 3) ) {
            return true;
        }
        if ( (keyword === "build") && (args.length >= 2) ) {
            return true;
        }
        if ( (keyword === "trade") && (args.length >= 3) ) {
            return true;
        }
        if ( (keyword === "attack") && (args.length >= 2) ) {
            return true;
        }
        if ( (keyword === "sacrifice") && (args.length >= 2) ) {
            return true;
        }
        if ( (keyword === "catastrophe") && (args.length >= 2) ) {
            return true;
        }
        if ( (keyword === "pass") && (args.length >= 0) ) {
            return true;
        }
        return false;
    }

    public handleClick(move: string, row: number, col: number, piece: string): IClickResult {
        try {
            // get move context
            let moves: string[] = [];
            if ( (move !== undefined) && (move !== "") ) {
                moves = move.split(/\s*[\n,;\/\\]\s*/);
            }
            const myseat = this.player2seat(this.currplayer);
            const mysys = this.systems.find(s => s.owner === myseat);
            let lastmove = "";
            if (moves.length > 0) {
                lastmove = moves[moves.length - 1];
            }
            const [lastcmd, ...lastargs] = lastmove.split(/\s+/);
            const complete = this.isCmdComplete(lastmove);
            // if the move is incomplete, remove it from the stack because the handler will rebuild it
            if (! complete) { moves.pop(); }

            // get click context
            let system: string | undefined;
            let ship: string | undefined;
            if (row < 0) {
                if (piece.startsWith("_")) {
                    system = piece;
                } else {
                    ship = piece;
                }
            } else {
                [system, ship] = piece.split("|");
                const match = system.match(/\(([NESW])\)$/);
                if (match !== null) {
                    system = this.seat2name(match[1] as Seat);
                }
            }

            // process
            let newmove = "";

            // Starting fresh
            if (complete) {
                // if you don't have a homeworld, create one
                if (mysys === undefined) {
                    // if you clicked on a global stash piece, place it as the first star
                    if (ship !== undefined) {
                        newmove = `homeworld ${ship.slice(0, 2)}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                } else {
                    // if you clicked on a ship or star, assume you are selecting a move type
                    if (ship !== undefined) {
                        if (ship[0] === "R") {
                            newmove = `attack`;
                        } else if (ship[0] === "G") {
                            newmove = `build`;
                        } else if (ship[0] === "B") {
                            newmove = `trade`;
                        } else if (ship[0] === "Y") {
                            newmove = `move`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    } else {
                        if (system !== undefined) {
                            if (system === "_sacrifice") {
                                newmove = `sacrifice`;
                            } else if (system === "_pass") {
                                newmove = `pass`;
                            } else if (! system.startsWith("_")) {
                                newmove = `catastrophe ${system}`
                            } else {
                                return {move, message: ""} as IClickResult;
                            }
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    }
                }
            // Otherwise, adding to an incomplete command
            } else {
                if (lastcmd === "homeworld") {
                    if (ship !== undefined) {
                        newmove = `homeworld ${lastargs.join(" ")} ${ship.slice(0, 2)}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                } else if (lastcmd === "discover") {
                    if ( (row < 0) && (ship !== undefined) ) {
                        newmove = `discover ${lastargs.join(" ")} ${ship.slice(0, 2)} ${this.genName()}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                } else if (lastcmd === "move") {
                    // need to select a ship
                    if (lastargs.length === 0) {
                        if ( (row >= 0) && (system !== undefined) && (ship !== undefined) ) {
                            newmove = `move ${ship.slice(0,2)} ${system}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    // otherwise need to select target system
                    } else {
                        // "Here be dragons"?
                        if ( (row < 0) && (system === "_uncharted") ) {
                            newmove = `discover ${lastargs.join(" ")}`;
                        // otherwise, simple move
                        } else if ( (row >= 0) && (system !== undefined) ) {
                            newmove = `move ${lastargs.join(" ")} ${system}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    }
                } else if (lastcmd === "build") {
                    // expect a ship from the global stash only
                    if (lastargs.length === 0) {
                        if ( (row < 0) && (ship !== undefined) ) {
                            newmove = `build ${ship[0]}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    // otherwise expect a system
                    } else {
                        if ( (row >= 0) && (system !== undefined) ) {
                            newmove = `build ${lastargs.join(" ")} ${system}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    }
                } else if (lastcmd === "trade") {
                    // expect a ship in a specific system
                    if (lastargs.length === 0) {
                        if ( (row >= 0) && (ship !== undefined) && (system !== undefined) ) {
                            newmove = `trade ${ship.slice(0,2)} ${system}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    // expect a colour
                    } else {
                        if (ship !== undefined) {
                            newmove = `trade ${lastargs.join(" ")} ${ship[0]}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    }
                } else if (lastcmd === "attack") {
                    if ( (row >= 0) && (system !== undefined) && (ship !== undefined) && (ship.length === 3) ) {
                        newmove = `attack ${ship} ${system}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                } else if (lastcmd === "sacrifice") {
                    if ( (row >= 0) && (system !== undefined) && (ship !== undefined) ) {
                        newmove = `sacrifice ${ship.slice(0,2)} ${system}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                } else if (lastcmd === "catastrophe") {
                    if (ship !== undefined) {
                        newmove = `catastrophe ${lastargs.join(" ")} ${ship[0]}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                } else {
                    return {move, message: ""} as IClickResult;
                }
            }

            let compiled = newmove;
            if (moves.length > 0) {
                compiled = [...moves, newmove].join(", ");
            }
           const result = this.validateMove(compiled) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                result.move = compiled;
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

        const keywords: string[] = ["homeworld", "discover", "move", "build", "trade", "attack", "sacrifice", "catastrophe", "pass"];
        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const cloned = this.clone();

        cloned.actions = {free: 1, R: 0, B: 0, G: 0, Y: 0};
        const LHO = cloned.getLHO();
        if ( (LHO === undefined) && (cloned.stack.length > cloned.numplayers) ) {
            throw new Error("Could not find a LHO even after all homeworlds have been established. This should never happen.");
        }

        let subResult: IValidationResult | undefined;
        for (let i = 0; i < moves.length; i++) {
        // for (const move of moves) {
            const move = moves[i];
            // skip empty orders
            if (move.match(/^\s*$/)) {
                continue;
            }

            const todate = moves.slice(0, i).join(",");
            cloned.load();
            cloned.move(todate, true);

            const tokens: string[] = move.split(/\s+/);
            const cmd = keywords.find(x => x.startsWith(tokens[0].toLowerCase()));
            switch (cmd) {
                case "homeworld":
                    subResult = cloned.validateHomeworld(...tokens.slice(1));
                    break;
                case "discover":
                    subResult = cloned.validateDiscover(...tokens.slice(1));
                    break;
                case "move":
                    subResult = cloned.validateMovement(...tokens.slice(1));
                    break;
                case "build":
                    subResult = cloned.validateBuild(...tokens.slice(1));
                    break;
                case "trade":
                    subResult = cloned.validateTrade(...tokens.slice(1));
                    break;
                case "attack":
                    subResult = cloned.validateAttack(...tokens.slice(1));
                    break;
                case "sacrifice":
                    subResult = cloned.validateSacrifice(...tokens.slice(1));
                    break;
                case "catastrophe":
                    subResult = cloned.validateCatastrophe(...tokens.slice(1));
                    break;
                case "pass":
                    subResult = cloned.validatePass(...tokens.slice(1));
                    break;
                default:
                    subResult = {
                        valid: false,
                        message: i18next.t("apgames:homeworlds.MOVE_UNRECOGNIZED", {cmd})
                    };
            }
        }
        if ( (subResult !== undefined) && ( (! subResult.valid) || ( (subResult.complete !== undefined) && (subResult.complete < 0) ) ) ) {
            return subResult;
        }
        // If we've gotten this far, each individual command was valid and complete

        // You have to account for all your actions
        if ( (cloned.actions.R > 0) || (cloned.actions.B > 0) || (cloned.actions.G > 0) || (cloned.actions.Y > 0) || (cloned.actions.free > 0) ) {
            result.valid = false;
            result.message = i18next.t("apgames:homeworlds.MOVE_MOREACTIONS");
            return result;
        }

        // You can't cause yourself to lose
        if (! m.startsWith("homeworld")) {
            const home = cloned.systems.find(s => s.owner === cloned.player2seat());
            if (home === undefined) {
                throw new Error("Could not find your home system. This should never happen at this point.");
            }
            if ( (home.stars.length === 0) || (home.countShips(cloned.player2seat()) === 0) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.MOVE_SELFELIMINATE");
                return result;
            }
        }

        // fully validated move set
        result.valid = true;
        result.complete = 0;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * The `partial` flag leaves the object in an invalid state. It should only be used on a disposable object,
     * or you should call `load()` before finalizing the move.
     *
     * @param m The move string itself
     * @param partial A signal that you're just exploring the move; don't do end-of-move processing
     * @returns [HomeworldsGame]
     */
    public move(m: string, partial = false): HomeworldsGame {
        if (this.gameover) {
            throw new UserFacingError(HomeworldsErrors.MOVE_GAMEOVER, i18next.t("apgames:MOVES_GAMEOVER"));
        }
        /*
         * Valid commands
         *   - homeworld star1 star2 ship [*]
         *   - discover ship fromSystem star newName
         *   - move ship fromSystem toSystem
         *   - build ship inSystem
         *   - trade oldShip inSystem newColour
         *   - attack ship inSystem
         *   - sacrifice ship inSystem
         *   - catastrophe inSystem colour
         *   - pass number?
         */
        const keywords: string[] = ["homeworld", "discover", "move", "build", "trade", "attack", "sacrifice", "catastrophe", "pass"];
        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        this.actions = {free: 1, R: 0, B: 0, G: 0, Y: 0};
        const LHO = this.getLHO();
        if ( (LHO === undefined) && (this.stack.length > this.numplayers) ) {
            throw new Error("Could not find a LHO even after all homeworlds have been established. This should never happen.");
        }
        this.eliminated = [];
        this.results = [];

        const mFormatted: string[] = [];
        for (const move of moves) {
            // skip empty orders
            if (move.match(/^\s*$/)) {
                continue;
            }
            const tokens: string[] = move.split(/\s+/);
            const cmd = keywords.find(x => x.startsWith(tokens[0].toLowerCase()));
            mFormatted.push([cmd, ...tokens.slice(1).map(x => x.toLowerCase())].join(" "));
            switch (cmd) {
                case "homeworld":
                    this.cmdHomeworld(...tokens.slice(1));
                    break;
                case "discover":
                    this.cmdDiscover(...tokens.slice(1));
                    break;
                case "move":
                    this.cmdMove(...tokens.slice(1));
                    break;
                case "build":
                    this.cmdBuild(...tokens.slice(1));
                    break;
                case "trade":
                    this.cmdTrade(...tokens.slice(1));
                    break;
                case "attack":
                    this.cmdAttack(...tokens.slice(1));
                    break;
                case "sacrifice":
                    this.cmdSacrifice(...tokens.slice(1));
                    break;
                case "catastrophe":
                    this.cmdCatastrophe(...tokens.slice(1));
                    break;
                case "pass":
                    this.cmdPass(...tokens.slice(1));
                    break;
                default:
                    throw new UserFacingError(HomeworldsErrors.MOVE_UNRECOGNIZED, i18next.t("apgames:homeworlds.MOVE_UNRECOGNIZED", {cmd}));
            }
        }
        this.lastmove = mFormatted.join(", ");
        if (partial) {
            return this;
        }

        // You have to account for all your actions
        if ( (this.actions.R > 0) || (this.actions.B > 0) || (this.actions.G > 0) || (this.actions.Y > 0) || (this.actions.free > 0) ) {
            throw new UserFacingError(HomeworldsErrors.MOVE_MOREACTIONS, i18next.t("apgames:homeworlds.MOVE_MOREACTIONS"));
        }

        // You can't cause yourself to lose
        const home = this.systems.find(s => s.owner === this.player2seat());
        if (home === undefined) {
            throw new Error("Could not find your home system. This should never happen at this point.");
        }
        if ( (home.stars.length === 0) || (home.countShips(this.player2seat()) === 0) ) {
            throw new UserFacingError(HomeworldsErrors.MOVE_SELFELIMINATE, i18next.t("apgames:homeworlds.MOVE_SELFELIMINATE"));
        }

        // Check for any home systems where the player no longer owns any ships
        // That player is eliminated, and their system becomes a periphery system
        const homes = this.systems.filter(s => (s.isHome()) && (s.owner !== this.player2seat()));
        for (const h of homes) {
            if (h.countShips(h.owner!) === 0) {
                this.results.push({"type": "eliminated", "who": this.seat2name(h.owner)});
                this.eliminated.push(h.owner!);
                h.owner = undefined;
            }
        }

        // Check for winning conditions
        if ( (this.eliminated.length > 0) && (this.eliminated.includes(LHO!)) ) {
            this.gameover = true;
            this.results.push({type: "eog"});
            this.winner = [this.currplayer];
            this.results.push({type: "winners", players: [...this.winner]});
        } else {
            // update currplayer
            let newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            if (this.stack.length > this.numplayers) {
                while (this.systems.find(s => s.owner === this.player2seat(newplayer as playerid)) === undefined) {
                    newplayer = (newplayer ) + 1;
                    if (newplayer > this.numplayers) {
                        newplayer = 1;
                    }
                }
            }
            this.currplayer = newplayer as playerid;
        }

        this.saveState();
        return this;
    }

    private cmdHomeworld(...args: string[]): HomeworldsGame {
        // homeworld star1 star2 ship [*]
        const home = this.systems.find(s => s.owner === this.player2seat());
        args = args.map(a => a.toUpperCase());
        if (home !== undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_HOME_DOUBLE, i18next.t("apgames:homeworlds.CMD_HOME_DOUBLE"));
        }
        if (args.length < 3) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        for (const arg of args) {
            if ( (arg !== "*") && (arg !== "-") && (! arg.match(/^[RBGY][123]$/)) ) {
                throw new UserFacingError(HomeworldsErrors.CMD_STARSHIP_NAME, i18next.t("apgames:homeworlds.CMD_STARSHIP_NAME", {arg}));
            }
        }
        let overridden = false;
        if (args[args.length - 1] === "*") {
            args.pop();
            overridden = true;
        }
        if ( (! overridden) && (args.includes("-")) ) {
            throw new UserFacingError(HomeworldsErrors.CMD_HOME_SINGLE, i18next.t("apgames:homeworlds.CMD_HOME_SINGLE"));
        }
        if ( (! overridden) && (! args[2].endsWith("3")) ) {
            throw new UserFacingError(HomeworldsErrors.CMD_HOME_SMALLSHIP, i18next.t("apgames:homeworlds.CMD_HOME_SMALLSHIP"));
        }
        if ( (! overridden) && (args[0][1] === args[1][1]) ) {
            throw new UserFacingError(HomeworldsErrors.CMD_HOME_SAMESIZE, i18next.t("apgames:homeworlds.CMD_HOME_SAMESIZE"));
        }
        const colours = args.filter(a => a.length === 2).map(a => a[0]);
        const unique = colours.filter((value, index) => colours.indexOf(value) === index)
        if ( (! overridden) && (unique.length < 3) ) {
            throw new UserFacingError(HomeworldsErrors.CMD_HOME_COLOURS, i18next.t("apgames:homeworlds.CMD_HOME_COLOURS"));
        }
        if ( (! overridden) && ( (! unique.includes("B")) || (! unique.includes("G")) ) ) {
            throw new UserFacingError(HomeworldsErrors.CMD_HOME_TECHS, i18next.t("apgames:homeworlds.CMD_HOME_TECHS"));
        }

        const separated: ([Colour, Size]|"-")[] = args.map((a) => {
            if (a === "-") {
                return a;
            } else {
                const [c, s] = a.split("");
                return [c as Colour, parseInt(s, 10) as Size];
            }
        });
        const stars: [Colour, Size][] = [];
        for (const arg of [separated[0], separated[1]]) {
            if (arg === "-") {
                continue;
            }
            this.stash.remove(...arg);
            stars.push(arg);
        }
        const system = new System(this.seat2name(), stars, this.player2seat());
        this.stash.remove(...separated[2] as [Colour, Size]);
        system.dock(new Ship(...separated[2] as [Colour, Size], this.player2seat()));

        // One last check; easier to do after all the systems are created
        if (this.currplayer > 1) {
            const rho = this.getRHO();
            const rhoSystem = this.systems.find(s => s.owner === rho);
            if (rhoSystem === undefined) {
                throw new Error("Could not find a right-hand opponent. This should never happen.");
            }
            const theirs = rhoSystem.stars.map(s => s[1]).sort();
            const mine = system.stars.map(s => s[1]).sort();
            if ( (! overridden) && (mine.length === theirs.length) && (mine.filter(s => !theirs.includes(s)).length === 0) ) {
                throw new UserFacingError(HomeworldsErrors.CMD_HOME_RHO, i18next.t("apgames:homeworlds.CMD_HOME_RHO"));
            }
        }

        this.addSystem(system);
        this.spendAction();

        this.results.push({type: "homeworld", stars: system.stars.map(s => s.join("")), ship: system.ships[0].id().slice(0, 2), name: system.name});
        return this;
    }

    private validateHomeworld(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // homeworld star1 star2 ship [*]
        const home = this.systems.find(s => s.owner === this.player2seat());
        args = args.map(a => a.toUpperCase());
        if (home !== undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:homeworlds.CMD_HOME_DOUBLE");
            return result;
        }
        if (args.length < 3) {
            // valid star/ship designations
            for (const arg of args) {
                if ( (arg !== "*") && (arg !== "-") && (! arg.match(/^[RBGY][123]$/)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_STARSHIP_NAME", {arg});
                    return result;
                }
            }

            // valid partial
            // return message based on number of arguments
            result.valid = true;
            result.complete = -1;
            switch (args.length) {
                case 0:
                    result.message = i18next.t("apgames:validation.homeworlds.homeworld.PARTIAL_NOARGS");
                    break;
                case 1:
                    result.message = i18next.t("apgames:validation.homeworlds.homeworld.PARTIAL_ONEARG");
                    break;
                case 2:
                    result.message = i18next.t("apgames:validation.homeworlds.homeworld.PARTIAL_TWOARGS");
                    break;
            }
            return result;
        } else {
            for (const arg of args) {
                if ( (arg !== "*") && (arg !== "-") && (! arg.match(/^[RBGY][123]$/)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_STARSHIP_NAME", {arg});
                    return result;
                }
            }
            let overridden = false;
            if (args[args.length - 1] === "*") {
                args.pop();
                overridden = true;
            }
            if ( (! overridden) && (args.includes("-")) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_HOME_SINGLE");
                return result;
            }
            if ( (! overridden) && (! args[2].endsWith("3")) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_HOME_SMALLSHIP");
                return result;
            }
            if ( (! overridden) && (args[0][1] === args[1][1]) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_HOME_SAMESIZE");
                return result;
            }
            const colours = args.filter(a => a.length === 2).map(a => a[0]);
            const unique = colours.filter((value, index) => colours.indexOf(value) === index)
            if ( (! overridden) && (unique.length < 3) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_HOME_COLOURS");
                return result;
            }
            if ( (! overridden) && ( (! unique.includes("B")) || (! unique.includes("G")) ) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_HOME_TECHS");
                return result;
            }

            const cloned = this.clone();
            const separated: ([Colour, Size]|"-")[] = args.map((a) => {
                if (a === "-") {
                    return a;
                } else {
                    const [c, s] = a.split("");
                    return [c as Colour, parseInt(s, 10) as Size];
                }
            });
            const stars: [Colour, Size][] = [];
            for (const arg of [separated[0], separated[1]]) {
                if (arg === "-") {
                    continue;
                }
                cloned.stash.remove(...arg);
                stars.push(arg);
            }
            const system = new System(cloned.seat2name(), stars, cloned.player2seat());
            cloned.stash.remove(...separated[2] as [Colour, Size]);
            system.dock(new Ship(...separated[2] as [Colour, Size], cloned.player2seat()));

            // One last check; easier to do after all the systems are created
            if (cloned.currplayer > 1) {
                const rho = cloned.getRHO();
                const rhoSystem = cloned.systems.find(s => s.owner === rho);
                if (rhoSystem === undefined) {
                    throw new Error("Could not find a right-hand opponent. This should never happen.");
                }
                const theirs = rhoSystem.stars.map(s => s[1]).sort();
                const mine = system.stars.map(s => s[1]).sort();
                if ( (! overridden) && (mine.length === theirs.length) && (mine.filter(s => !theirs.includes(s)).length === 0) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_HOME_RHO");
                    return result;
                }
            }
            this.spendAction();

            // valid complete move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdDiscover(...args: string[]): HomeworldsGame {
        // discover ship fromSystem star newName
        if (args.length < 4) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [ship, fromSystem, newStar, newName] = args;
        ship = ship.toUpperCase();
        if (ship.length === 2) {
            ship += this.player2seat();
        }
        newStar = newStar.toUpperCase();
        const [c, s] = newStar.split("");
        const starObj: Star = [c as Colour, parseInt(s, 10) as Size];

        const oldSystem = this.systems.find(sys => sys.name.toLowerCase() === fromSystem.toLowerCase());
        if (oldSystem === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: fromSystem}));
        }

        if (this.actions.Y === 0) {
            if (this.actions.free === 0) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOACTIONS, i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "Y"}));
            } else if (! oldSystem.hasTech("Y", this.player2seat())) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOTECH, i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "Y"}));
            }
        }
        this.spendAction("Y");

        if (! System.nameValid(newName)) {
            throw new UserFacingError(HomeworldsErrors.SYSTEM_BADNAME, i18next.t("apgames:homeworlds.SYSTEM_BADNAME", {name: newName}));
        }
        const names = this.systems.map(sys => sys.name.toLowerCase());
        if (names.includes(newName.toLowerCase())) {
            throw new UserFacingError(HomeworldsErrors.CMD_DISC_DOUBLE, i18next.t("apgames:homeworlds.CMD_DISC_DOUBLE", {name: newName}));
        }
        if (! oldSystem.hasShip(ship)) {
            throw new UserFacingError(HomeworldsErrors.SYSTEM_NOSHIP, i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship, system: oldSystem.name}));
        }

        // Allocate star
        this.stash.remove(...starObj);
        // Undock the ship
        const shipObj = oldSystem.undock(ship);
        // Destroy system if necessary
        // But remember that you may temporarily abandon your homeworld as long as it's occupied at the end of your turn.
        // So if it's the current player's homeworld, don't destroy it yet. That will happen later.
        if ( (oldSystem.ships.length === 0) && ( (! oldSystem.isHome()) || (oldSystem.owner !== this.player2seat()) ) ) {
            if (oldSystem.isHome()) {
                this.eliminated.push(oldSystem.owner!);
                this.results.push({"type": "eliminated", "who": this.seat2name(oldSystem.owner)});
            }
            for (const star of oldSystem.stars) {
                this.stash.add(...star);
            }
            this.delSystem(oldSystem);
        }
        // Instantiate system
        const newSystem = new System(newName, [starObj]);
        if (! oldSystem.isConnected(newSystem)) {
            throw new UserFacingError(HomeworldsErrors.CMD_MOVE_CONNECTION, i18next.t("apgames:homeworlds.CMD_MOVE_CONNECTION", {from: oldSystem.name, to: newSystem.name}));
        }
        newSystem.dock(shipObj);
        this.addSystem(newSystem);

        this.results.push({type: "discover", called: newSystem.name, what: newSystem.stars[0].join("")});
        this.results.push({type: "move", from: oldSystem.name, to: newSystem.name, what: shipObj.id().slice(0, 2)});
        return this;
    }

    private validateDiscover(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // discover ship fromSystem star newName
        if (args.length < 4) {

            // eslint-disable-next-line prefer-const
            let [ship, fromSystem] = args;
            if ( (ship !== undefined) && (fromSystem !== undefined) ) {
                ship = ship.toUpperCase();
                if (ship.length === 2) {
                    ship += this.player2seat();
                }
                const oldSystem = this.systems.find(sys => sys.name.toLowerCase() === fromSystem.toLowerCase());
                if (oldSystem === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: fromSystem});
                    return result;
                }
                if (this.actions.Y === 0) {
                    if (this.actions.free === 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "Y"});
                        return result;
                    } else if (! oldSystem.hasTech("Y", this.player2seat())) {
                        result.valid = false;
                        result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "Y"});
                        return result;
                    }
                }
            }

            // valid partial
            result.valid = true;
            result.complete = -1;
            switch (args.length) {
                case 0:
                    result.message = i18next.t("apgames:validation.homeworlds.discover.PARTIAL_NOARGS");
                    break;
                case 1:
                    result.message = i18next.t("apgames:validation.homeworlds.discover.PARTIAL_ONEARG");
                    break;
                case 2:
                    result.message = i18next.t("apgames:validation.homeworlds.discover.PARTIAL_TWOARGS");
                    break;
                case 3:
                    result.message = i18next.t("apgames:validation.homeworlds.discover.PARTIAL_THREEARGS");
                    break;
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [ship, fromSystem, newStar, newName] = args;
            ship = ship.toUpperCase();
            if (ship.length === 2) {
                ship += this.player2seat();
            }
            newStar = newStar.toUpperCase();
            const [c, s] = newStar.split("");
            const starObj: Star = [c as Colour, parseInt(s, 10) as Size];

            const oldSystem = this.systems.find(sys => sys.name.toLowerCase() === fromSystem.toLowerCase());
            if (oldSystem === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: fromSystem});
                return result;
            }

            if (this.actions.Y === 0) {
                if (this.actions.free === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "Y"});
                    return result;
                } else if (! oldSystem.hasTech("Y", this.player2seat())) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "Y"});
                    return result;
                }
            }
            this.spendAction("Y");

            if (! System.nameValid(newName)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.SYSTEM_BADNAME", {name: newName});
                return result;
            }
            const names = this.systems.map(sys => sys.name.toLowerCase());
            if (names.includes(newName.toLowerCase())) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_DISC_DOUBLE", {name: newName});
                return result;
            }
            if (! oldSystem.hasShip(ship)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship, system: oldSystem.name});
                return result;
            }
            const newSystem = new System(newName, [starObj]);
            if (! oldSystem.isConnected(newSystem)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_MOVE_CONNECTION", {from: oldSystem.name, to: newSystem.name});
                return result;
            }

            // valid complete move
            result.valid = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.canrender = true;
            } else {
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdMove(...args: string[]): HomeworldsGame {
        // move ship fromSystem toSystem
        if (args.length < 3) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [ship, fromSystem, toSystem] = args;
        ship = ship.toUpperCase() + this.player2seat();

        const oldSystem = this.systems.find(sys => sys.name.toLowerCase() === fromSystem.toLowerCase());
        if (oldSystem === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: fromSystem}));
        }
        const newSystem = this.systems.find(sys => sys.name.toLowerCase() === toSystem.toLowerCase());
        if (newSystem === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: toSystem}));
        }
        if (! oldSystem.isConnected(newSystem)) {
            throw new UserFacingError(HomeworldsErrors.CMD_MOVE_CONNECTION, i18next.t("apgames:homeworlds.CMD_MOVE_CONNECTION", {from: fromSystem, to: toSystem}));
        }

        if (this.actions.Y === 0) {
            if (this.actions.free === 0) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOACTIONS, i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "Y"}));
            } else if (! oldSystem.hasTech("Y", this.player2seat())) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOTECH, i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "Y"}));
            }
        }
        this.spendAction("Y");

        if (! oldSystem.hasShip(ship)) {
            throw new UserFacingError(HomeworldsErrors.SYSTEM_NOSHIP, i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship}));
        }

        // Undock the ship
        const shipObj = oldSystem.undock(ship);
        // Destroy system if necessary
        // But remember that you may temporarily abandon your homeworld as long as it's occupied at the end of your turn.
        // So if it's the current player's homeworld, don't destroy it yet. That will happen later.
        if ( (oldSystem.ships.length === 0) && ( (! oldSystem.isHome()) || (oldSystem.owner !== this.player2seat()) ) ) {
            if (oldSystem.isHome()) {
                this.eliminated.push(oldSystem.owner!);
                this.results.push({"type": "eliminated", "who": this.seat2name(oldSystem.owner)});
            }
            for (const star of oldSystem.stars) {
                this.stash.add(...star);
            }
            this.delSystem(oldSystem);
        }
        // Dock the ship in the new system
        newSystem.dock(shipObj);

        this.results.push({type: "move", from: oldSystem.name, to: newSystem.name, what: shipObj.id().slice(0, 2)});
        return this;
    }

    private validateMovement(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // move ship fromSystem toSystem
        if (args.length < 3) {
            // eslint-disable-next-line prefer-const
            let [ship, fromSystem] = args;
            if ( (ship !== undefined) && (fromSystem !== undefined) ) {
                ship = ship.toUpperCase() + this.player2seat();
                const oldSystem = this.systems.find(sys => sys.name.toLowerCase() === fromSystem.toLowerCase());
                if (oldSystem === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: fromSystem});
                    return result;
                }
                if (this.actions.Y === 0) {
                    if (this.actions.free === 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "Y"});
                        return result;
                    } else if (! oldSystem.hasTech("Y", this.player2seat())) {
                        result.valid = false;
                        result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "Y"});
                        return result;
                    }
                }
                if (! oldSystem.hasShip(ship)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship});
                    return result;
                }
            }

            // valid partial
            result.valid = true;
            result.complete = -1;
            switch (args.length) {
                case 0:
                    result.message = i18next.t("apgames:validation.homeworlds.move.PARTIAL_NOARGS");
                    break;
                case 1:
                    result.message = i18next.t("apgames:validation.homeworlds.move.PARTIAL_ONEARG");
                    break;
                case 2:
                    result.message = i18next.t("apgames:validation.homeworlds.move.PARTIAL_TWOARGS");
                    break;
            }
            return result;

        } else {
            // eslint-disable-next-line prefer-const
            let [ship, fromSystem, toSystem] = args;
            ship = ship.toUpperCase() + this.player2seat();

            const oldSystem = this.systems.find(sys => sys.name.toLowerCase() === fromSystem.toLowerCase());
            if (oldSystem === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: fromSystem});
                return result;
            }
            const newSystem = this.systems.find(sys => sys.name.toLowerCase() === toSystem.toLowerCase());
            if (newSystem === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: toSystem});
                return result;
            }
            if (! oldSystem.isConnected(newSystem)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_MOVE_CONNECTION", {from: fromSystem, to: toSystem});
                return result;
            }

            if (this.actions.Y === 0) {
                if (this.actions.free === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "Y"});
                    return result;
                } else if (! oldSystem.hasTech("Y", this.player2seat())) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "Y"});
                    return result;
                }
            }
            this.spendAction("Y");

            if (! oldSystem.hasShip(ship)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship});
                return result;
            }

            // valid complete move
            result.valid = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.canrender = true;
            } else {
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdBuild(...args: string[]): HomeworldsGame {
        // build shipColour inSystem
        if (args.length < 2) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [shipColour, systemName] = args;
        shipColour = shipColour.toUpperCase();
        if (shipColour.length > 1) {
            shipColour = shipColour[0];
        }

        const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
        if (system === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName}));
        }

        if (this.actions.G === 0) {
            if (this.actions.free === 0) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOACTIONS, i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "G"}));
            } else if (! system.hasTech("G", this.player2seat())) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOTECH, i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "G"}));
            }
        }
        this.spendAction("G");

        if (! system.ownsShipColour(shipColour as Colour, this.player2seat())) {
            throw new UserFacingError(HomeworldsErrors.CMD_BUILD_TEMPLATE, i18next.t("apgames:homeworlds.CMD_BUILD_TEMPLATE", {colour: shipColour}));
        }

        // allocate the ship from the stash
        const newsize = this.stash.takeSmallest(shipColour as Colour);
        if (newsize === undefined) {
            throw new UserFacingError(HomeworldsErrors.STASH_EMPTY, i18next.t("apgames:homeworlds.STASH_EMPTY", {colour: shipColour}));
        }
        // dock it
        const ship = new Ship(shipColour as Colour, newsize, this.player2seat());
        system.dock(ship);

        this.results.push({type: "place", where: system.name, what: ship.id().slice(0, 2)});
        return this;
    }

    private validateBuild(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // build shipColour inSystem
        if (args.length < 2) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            if (args.length === 0) {
                result.message = i18next.t("apgames:validation.homeworlds.build.PARTIAL_NOARGS");
            } else if (args.length === 1) {
                result.message = i18next.t("apgames:validation.homeworlds.build.PARTIAL_ONEARG");
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [shipColour, systemName] = args;
            shipColour = shipColour.toUpperCase();
            if (shipColour.length > 1) {
                shipColour = shipColour[0];
            }

            const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            if (this.actions.G === 0) {
                if (this.actions.free === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "G"});
                    return result;
                } else if (! system.hasTech("G", this.player2seat())) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "G"});
                    return result;
                }
            }
            this.spendAction("G");

            if (! system.ownsShipColour(shipColour as Colour, this.player2seat())) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_BUILD_TEMPLATE", {colour: shipColour});
                return result;
            }

            // valid complete move
            result.valid = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.canrender = true;
            } else {
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdTrade(...args: string[]): HomeworldsGame {
        // trade oldShip inSystem newColour
        if (args.length < 3) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [oldShip, systemName, newColour] = args;
        oldShip = oldShip.toUpperCase() + this.player2seat();
        newColour = newColour.toUpperCase();
        if (newColour.length > 1) {
            newColour = newColour[0];
        }

        const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
        if (system === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName}));
        }

        if (newColour[0] === oldShip[0]) {
            throw new UserFacingError(HomeworldsErrors.CMD_TRADE_DOUBLE, i18next.t("apgames:homeworlds.CMD_TRADE_DOUBLE"));
        }

        if (this.actions.B === 0) {
            if (this.actions.free === 0) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOACTIONS, i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "B"}));
            } else if (! system.hasTech("B", this.player2seat())) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOTECH, i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "B"}));
            }
        }
        this.spendAction("B");

        // Get the ship instance
        const shipObj = system.getShip(oldShip);
        // Remove the new colour from the stash
        this.stash.remove(newColour as Colour, shipObj.size);
        // Add the original colour back to the stash
        this.stash.add(shipObj.colour, shipObj.size);
        // Change the ship's colour
        shipObj.colour = newColour as Colour;

        this.results.push({type: "convert", what: oldShip.slice(0, 2), into: shipObj.id().slice(0, 2), where: system.name});
        return this;
    }

    private validateTrade(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // trade oldShip inSystem newColour
        if (args.length < 3) {
            // eslint-disable-next-line prefer-const
            let [oldShip, systemName] = args;
            if ( (oldShip !== undefined) && (systemName !== undefined) ) {
                oldShip = oldShip.toUpperCase() + this.player2seat();
                const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
                if (system === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                    return result;
                }
                if (this.actions.B === 0) {
                    if (this.actions.free === 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "B"});
                        return result;
                    } else if (! system.hasTech("B", this.player2seat())) {
                        result.valid = false;
                        result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "B"});
                        return result;
                    }
                }
            }

            // valid partial
            result.valid = true;
            result.complete = -1;
            if (args.length === 0) {
                result.message = i18next.t("apgames:validation.homeworlds.trade.PARTIAL_NOARGS");
            } else if (args.length === 1) {
                result.message = i18next.t("apgames:validation.homeworlds.trade.PARTIAL_ONEARG");
            } else if (args.length === 2) {
                result.message = i18next.t("apgames:validation.homeworlds.trade.PARTIAL_TWOARGS");
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [oldShip, systemName, newColour] = args;
            oldShip = oldShip.toUpperCase() + this.player2seat();
            newColour = newColour.toUpperCase();
            if (newColour.length > 1) {
                newColour = newColour[0];
            }

            const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            if (newColour[0] === oldShip[0]) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_TRADE_DOUBLE");
                return result;
            }

            if (this.actions.B === 0) {
                if (this.actions.free === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "B"});
                    return result;
                } else if (! system.hasTech("B", this.player2seat())) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "B"});
                    return result;
                }
            }
            this.spendAction("B");

            // valid complete move
            result.valid = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.canrender = true;
            } else {
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdAttack(...args: string[]): HomeworldsGame {
        // attack ship inSystem
        if (args.length < 2) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [enemyShip, systemName] = args;
        enemyShip = enemyShip.toUpperCase();
        // If only two characters long, but only one opponent, imply the size of the ship
        if ( (enemyShip.length === 2) && (this.numplayers === 2) ) {
            enemyShip += this.getRHO();
        }
        if (enemyShip.length !== 3) {
            throw new UserFacingError(HomeworldsErrors.CMD_ATK_OWNER, i18next.t("apgames:homeworlds.CMD_ATK_OWNER"));
        }
        if (enemyShip[enemyShip.length - 1] === this.player2seat()) {
            throw new UserFacingError(HomeworldsErrors.CMD_ATK_SELF, i18next.t("apgames:homeworlds.CMD_ATK_SELF"));
        }
        const enemySize = parseInt(enemyShip[1], 10);

        const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
        if (system === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName}));
        }

        if (system.getLargestShip(this.player2seat()) < enemySize) {
            throw new UserFacingError(HomeworldsErrors.CMD_ATK_SIZE, i18next.t("apgames:homeworlds.CMD_ATK_SIZE", {target: enemyShip}));
        }

        if (this.actions.R === 0) {
            if (this.actions.free === 0) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOACTIONS, i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "R"}));
            } else if (! system.hasTech("R", this.player2seat())) {
                throw new UserFacingError(HomeworldsErrors.CMD_NOTECH, i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "R"}));
            }
        }
        this.spendAction("R");

        // Convert the ship
        const ship = system.getShip(enemyShip);
        ship.owner = this.player2seat();

        this.results.push({type: "capture", where: system.name, what: enemyShip});
        return this;
    }

    private validateAttack(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // attack ship inSystem
        if (args.length < 2) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            if (args.length === 0) {
                result.message = i18next.t("apgames:validation.homeworlds.attack.PARTIAL_NOARGS");
            } else if (args.length === 1) {
                result.message = i18next.t("apgames:validation.homeworlds.attack.PARTIAL_ONEARG");
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [enemyShip, systemName] = args;
            enemyShip = enemyShip.toUpperCase();
            // If only two characters long, but only one opponent, imply the size of the ship
            if ( (enemyShip.length === 2) && (this.numplayers === 2) ) {
                enemyShip += this.getRHO();
            }
            if (enemyShip.length !== 3) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_ATK_OWNER");
                return result;
            }
            if (enemyShip[enemyShip.length - 1] === this.player2seat()) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_ATK_SELF");
                return result;
            }
            const enemySize = parseInt(enemyShip[1], 10);

            const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            if (system.getLargestShip(this.player2seat()) < enemySize) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_ATK_SIZE", {target: enemyShip});
                return result;
            }

            if (this.actions.R === 0) {
                if (this.actions.free === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS", {context: "R"});
                    return result;
                } else if (! system.hasTech("R", this.player2seat())) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_NOTECH", {context: "R"});
                    return result;
                }
            }
            this.spendAction("R");

            // valid complete move
            result.valid = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.canrender = true;
            } else {
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdSacrifice(...args: string[]): HomeworldsGame {
        // sacrifice ship inSystem
        if (args.length < 2) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [myShip, systemName] = args;
        myShip = myShip.toUpperCase() + this.player2seat();

        const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
        if (system === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName}));
        }

        if (this.actions.free === 0) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOACTIONS, i18next.t("apgames:homeworlds.CMD_NOACTIONS"));
        }
        this.spendAction();

        // Undock and break down the ship
        const ship = system.undock(myShip);
        this.stash.add(ship.colour, ship.size);
        this.actions[ship.colour] = ship.size as number;

        // Destroy system if necessary
        // But remember that you may temporarily abandon your homeworld as long as it's occupied at the end of your turn.
        // So if it's the current player's homeworld, don't destroy it yet. That will happen later.
        if ( (system.ships.length === 0) && ( (! system.isHome()) || (system.owner !== this.player2seat()) ) ) {
            if (system.isHome()) {
                this.eliminated.push(system.owner!);
                this.results.push({"type": "eliminated", "who": this.seat2name(system.owner)});
            }
            for (const star of system.stars) {
                this.stash.add(...star);
            }
            this.delSystem(system);
        }

        this.results.push({type: "sacrifice", what: ship.id().slice(0, 2), where: system.name});
        return this;
    }

    private validateSacrifice(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // sacrifice ship inSystem
        if (args.length < 2) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            if (args.length === 0) {
                result.message = i18next.t("apgames:validation.homeworlds.sacrifice.PARTIAL_NOARGS");
            } else if (args.length === 1) {
                result.message = i18next.t("apgames:validation.homeworlds.sacrifice.PARTIAL_ONEARG");
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [myShip, systemName] = args;
            myShip = myShip.toUpperCase() + this.player2seat();

            const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            if (this.actions.free === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOACTIONS");
                return result;
            }
            this.spendAction();
            this.actions[myShip[0] as Colour] = parseInt(myShip[1], 10);

            // valid complete move
            result.valid = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.canrender = true;
            } else {
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdCatastrophe(...args: string[]): HomeworldsGame {
        // catastrophe inSystem colour
        if (args.length < 2) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }
        // eslint-disable-next-line prefer-const
        let [systemName, colour] = args;
        colour = colour[0].toUpperCase();

        const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
        if (system === undefined) {
            throw new UserFacingError(HomeworldsErrors.CMD_NOSYSTEM, i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName}));
        }

        if ( (this.actions.R > 0) || (this.actions.B > 0) || (this.actions.G > 0) || (this.actions.Y > 0) || (this.actions.free > 0) ) {
            throw new UserFacingError(HomeworldsErrors.CMD_CATA_ACTIONS, i18next.t("apgames:homeworlds.CMD_CATA_ACTIONS"));
        }

        if (! system.canCatastrophe(colour as Colour)) {
            throw new UserFacingError(HomeworldsErrors.CMD_CATA_INVALID, i18next.t("apgames:homeworlds.CMD_CATA_INVALID", {colour, system: system.name}));
        }

        // Get list of casualties
        const casualties = system.casualties(colour as Colour);
        // Update the stash
        for (const pair of casualties) {
            this.stash.add(...pair);
        }
        // Execute the catastrophe
        system.catastrophe(colour as Colour);
        // Destroy system if necessary
        // But remember that you may temporarily abandon your homeworld as long as it's occupied at the end of your turn.
        // So if it's the current player's homeworld, don't destroy it yet. That will happen later.
        if ( ( (system.stars.length === 0) || (system.ships.length === 0) ) && ( (! system.isHome()) || (system.owner !== this.player2seat()) ) ) {
            if (system.isHome()) {
                this.eliminated.push(system.owner!);
                this.results.push({"type": "eliminated", "who": this.seat2name(system.owner)});
            }
            this.delSystem(system);
        }

        this.results.push({type: "catastrophe", where: system.name, trigger: colour});
        return this;
    }

    private validateCatastrophe(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // catastrophe inSystem colour
        if (args.length < 2) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            if (args.length === 0) {
                result.message = i18next.t("apgames:validation.homeworlds.catastrophe.PARTIAL_NOARGS");
            } else if (args.length === 1) {
                result.message = i18next.t("apgames:validation.homeworlds.catastrophe.PARTIAL_ONEARG");
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [systemName, colour] = args;
            colour = colour[0].toUpperCase();

            const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            if ( (this.actions.R > 0) || (this.actions.B > 0) || (this.actions.G > 0) || (this.actions.Y > 0) || (this.actions.free > 0) ) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_CATA_ACTIONS");
                return result;
            }

            if (! system.canCatastrophe(colour as Colour)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_CATA_INVALID", {colour, system: system.name});
                return result;
            }

            // valid complete move
            result.valid = true;
            result.complete = 0;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private cmdPass(...args: string[]): HomeworldsGame {
        // pass number?
        if (args.length > 1) {
            throw new UserFacingError(HomeworldsErrors.CMD_PARAMETERS, i18next.t("apgames:homeworlds.CMD_PARAMETERS"));
        }

        if (this.actions.free > 0) {
            throw new UserFacingError(HomeworldsErrors.CMD_PASS_FREE, i18next.t("apgames:homeworlds.CMD_PASS_FREE"));
        }

        if (args[0] === "*") {
            this.actions.R = 0;
            this.actions.B = 0;
            this.actions.G = 0;
            this.actions.Y = 0;
        } else {
            let num = 1;
            if (args.length > 0) {
                num = parseInt(args[0], 10);
            }

            for (let i = 0; i < num; i++) {
                if (this.actions.R > 0) {
                    this.actions.R--;
                } else if (this.actions.B > 0) {
                    this.actions.B--;
                } else if (this.actions.G > 0) {
                    this.actions.G--;
                } else if (this.actions.Y > 0) {
                    this.actions.Y--;
                } else {
                    throw new UserFacingError(HomeworldsErrors.CMD_PASS_TOOMANY, i18next.t("apgames:homeworlds.CMD_PASS_TOOMANY"));
                }
            }
        }

        this.results.push({type: "pass"});
        return this;
    }

    private validatePass(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // pass number?
        if (args.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:homeworlds.CMD_PARAMETERS");
            return result;
        }

        if (this.actions.free > 0) {
            result.valid = false;
            result.message = i18next.t("apgames:homeworlds.CMD_PASS_FREE");
            return result;
        }

        if (args[0] === "*") {
            this.actions.R = 0;
            this.actions.B = 0;
            this.actions.G = 0;
            this.actions.Y = 0;
        } else {
            let num = 1;
            if (args.length > 0) {
                num = parseInt(args[0], 10);
            }

            for (let i = 0; i < num; i++) {
                if (this.actions.R > 0) {
                    this.actions.R--;
                } else if (this.actions.B > 0) {
                    this.actions.B--;
                } else if (this.actions.G > 0) {
                    this.actions.G--;
                } else if (this.actions.Y > 0) {
                    this.actions.Y--;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_PASS_TOOMANY");
                    return result;
                }
            }
        }

        // valid complete move
        result.valid = true;
        if (this.countActions() > 0) {
            result.complete = -1;
            result.canrender = true;
        } else {
            result.complete = 0;
        }
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private addSystem(sys: System): HomeworldsGame {
        const names = this.systems.map(s => s.name.toLowerCase());
        if (names.includes(sys.name.toLowerCase())) {
            throw new UserFacingError(HomeworldsErrors.CMD_DISC_DOUBLE, i18next.t("apgames:homeworlds.CMD_DISC_DOUBLE", {system: sys.name}));
        }
        this.systems.push(sys);
        return this;
    }

    private delSystem(sys: System): HomeworldsGame {
        const idx = this.systems.findIndex(s => s.name.toLowerCase() === sys.name.toLowerCase());
        if (idx < 0) {
            throw new Error(`Could not destroy the system '${sys.name}' because it does not appear to exist.`);
        }
        this.systems.splice(idx, 1);
        return this;
    }

    protected checkEOG(): HomeworldsGame {
        return this;
    }

    public resign(player: playerid): HomeworldsGame {
        this.results = [{type: "resigned", player}]
        // If one person resigns, the others win together
        this.gameover = true;
        this.results.push({type: "eog"});
        const winners: playerid[] = [];
        for (let n = 1; n <= this.numplayers; n++) {
            if (n as playerid !== player) {
                winners.push(n as playerid);
            }
        }
        this.winner = [...winners];
        this.results.push({type: "winners", players: [...this.winner]});
        this.saveState();
        return this;
    }

    public state(): IHomeworldsState {
        return {
            game: HomeworldsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HomeworldsGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            systems: this.systems.map(s => s.clone()),
            stash: this.stash.clone()
        };
    }

    public render(): APRenderRep {
        // build legend based on number of players
        const myLegend: ILooseObj = {};
        // Stars first
        const cs = ["R", "B", "G", "Y"];
        const nums = [1, 2, 3, 4];
        for (let i = 0; i < cs.length; i++) {
            myLegend[cs[i] + "1"] = {
                name: "pyramid-up-small-upscaled",
                player: nums[i]
            };
            myLegend[cs[i] + "2"] = {
                name: "pyramid-up-medium-upscaled",
                player: nums[i]
            };
            myLegend[cs[i] + "3"] = {
                name: "pyramid-up-large-upscaled",
                player: nums[i]
            };
        }

        // Now ships
        // You always have North and South
        const seats = ["N", "S"];
        // Three players gives you East
        if (this.numplayers > 2) {
            seats.push("E");
        }
        // Four gives you West
        if (this.numplayers > 3) {
            seats.push("W");
        }
        const rotations: Map<string, number> = new Map([
            ["N", 180],
            ["E", 270],
            ["W", 90]
        ]);

        const sizeNames = ["small", "medium", "large"];
        for (const d of seats) {
            const r = rotations.get(d);
            for (let i = 0; i < cs.length; i++) {
                for (let j = 0; j < sizeNames.length; j++) {
                    const node: ILooseObj = {
                        name: "pyramid-flat-" + sizeNames[j],
                        player: nums[i]
                    };
                    if (r !== undefined) {
                        node.rotate = r;
                    }
                    myLegend[cs[i] + (j + 1).toString() + d] = node;
                }
            }
        }

        let annotations: any[] = [];
        const seen: Set<string> = new Set<string>();
        for (const r of this.results) {
            if (r.type === "move") {
                if (! seen.has(r.from)) {
                    seen.add(r.from);
                    annotations.push({system: r.from, action: 4});
                }
                if (! seen.has(r.to)) {
                    seen.add(r.to);
                    annotations.push({system: r.to, action: 4});
                }
            } else if (r.type === "capture") {
                if (! seen.has(r.where!)) {
                    seen.add(r.where!);
                    annotations.push({system: r.where!, action: 1});
                }
            } else if (r.type === "convert") {
                if (! seen.has(r.where!)) {
                    seen.add(r.where!);
                    annotations.push({system: r.where!, action: 2});
                }
            } else if (r.type === "place") {
                if (! seen.has(r.where!)) {
                    seen.add(r.where!);
                    annotations.push({system: r.where!, action: 3});
                }
            } else if (r.type === "sacrifice") {
                if (! seen.has(r.where!)) {
                    seen.add(r.where!);
                    let action: number;
                    switch (r.what[0]) {
                        case "R":
                            action = 1;
                            break;
                        case "B":
                            action = 2;
                            break;
                        case "G":
                            action = 3;
                            break;
                        case "Y":
                            action = 4;
                            break;
                        default:
                            throw new Error(`Unrecognized result: ${r.what[0]}`);
                    }
                    annotations.push({system: r.where!, action});
                }
            } else if (r.type === "catastrophe") {
                if (! seen.has(r.where)) {
                    seen.add(r.where);
                    let action: number;
                    switch (r.trigger) {
                        case "R":
                            action = 1;
                            break;
                        case "B":
                            action = 2;
                            break;
                        case "G":
                            action = 3;
                            break;
                        case "Y":
                            action = 4;
                            break;
                        default:
                            throw new Error(`Unrecognized result: ${r.trigger || "UNDEFINED"}`);
                    }
                    annotations.push({system: r.where, action});
                }
            }
        }
        // Remove any nonexistent systems from the list
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        annotations = annotations.filter(n => this.systems.find(s => s.name === n.system) !== undefined);

        // Build rep
        const rep: APRenderRep =  {
            renderer: "homeworlds",
            // @ts-ignore
            board: this.systems.map(s => s.renderSys()),
            // @ts-ignore
            pieces: this.systems.map(s => s.renderShips()),
            // @ts-ignore
            areas: [this.stash.render()],
            legend: myLegend
        };
        if (annotations.length > 0) {
            // @ts-ignore
            rep.annotations = annotations;
        }

        return rep;
    }

    protected getMoveList(): any[] {
        if (this.numplayers > 2) {
            return this.getMovesAndResultsWithSequence();
        } else {
            return this.getMovesAndResults();
        }
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, homeworld, discover, move, place, convert, capture, sacrifice, catastrophe, pass
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer} (${this.player2seat(otherPlayer as playerid)})`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1] + ` (${this.player2seat(otherPlayer as playerid)})`;
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "homeworld":
                            node.push(i18next.t("apresults:homeworlds.ESTABLISH", {player: name, name: r.name, ship: r.ship, stars: r.stars.join("+")}));
                            break;
                        case "discover":
                            node.push(i18next.t("apresults:homeworlds.DISCOVER", {player: name, name: r.called, what: r.what}));
                            break;
                        case "move":
                            node.push(i18next.t("apresults:homeworlds.MOVE", {player: name, from: r.from, to: r.to, what: r.what}));
                            break;
                        case "place":
                            node.push(i18next.t("apresults:homeworlds.BUILD", {player: name, where: r.where, what: r.what}));
                            break;
                        case "convert":
                            node.push(i18next.t("apresults:homeworlds.CONVERT", {player: name, what: r.what, into: r.into, where: r.where}));
                            break;
                        case "capture":
                            node.push(i18next.t("apresults:homeworlds.CAPTURE", {player: name, where: r.where, what: r.what}));
                            break;
                        case "sacrifice":
                            node.push(i18next.t("apresults:homeworlds.SACRIFICE", {player: name, where: r.where, what: r.what}));
                            break;
                        case "catastrophe":
                            node.push(i18next.t("apresults:homeworlds.CATASTROPHE", {player: name, where: r.where, colour: r.trigger}));
                            break;
                        case "pass":
                            node.push(i18next.t("apresults:homeworlds.PASS", {player: name}));
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

    public clone(): HomeworldsGame {
        return new HomeworldsGame(this.serialize());
    }
}
