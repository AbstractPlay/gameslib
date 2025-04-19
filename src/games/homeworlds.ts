import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaHWStash, BoardHomeworlds, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Ship, System, Stash } from "./homeworlds/";
import { reviver } from "../common";
import { CartesianProduct, Permutation, PowerSet } from "js-combinatorics";
import { UserFacingError } from "../common";
import { wng } from "../common";
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
    CMD_HOME_COLOURS = "CMD_HOME_COLOURS",      // Requesting a homeworld with fewer than three colours
    CMD_HOME_TECHS = "CMD_HOME_TECHS",          // Requesting a homeworld missing either G or B
    CMD_HOME_RHO_DIRECT = "CMD_HOME_RHO_DIRECT",// Direct connection to RHO
    CMD_HOME_RHO_SMALL = "CMD_HOME_RHO_SMALL",  // Creating a small universe when a large is possible
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

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
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
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.homeworlds")
        description: "apgames:descriptions.homeworlds",
        // i18next.t("apgames:notes.homeworlds")
        notes: "apgames:notes.homeworlds",
        urls: [
            "https://www.looneylabs.com/content/homeworlds",
            "http://wunderland.com/WTS/Andy/Games/ILoveHomeworlds.html",
            "https://boardgamegeek.com/boardgame/14634/homeworlds",
        ],
        people: [
            {
                type: "designer",
                name: "John Cooper"
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>cripple", "mechanic>capture", "mechanic>move", "mechanic>convert", "mechanic>economy", "mechanic>place", "mechanic>share", "board>none", "components>pyramids", "other>2+players"],
        flags: ["shared-pieces", "perspective", "rotate90", "no-moves", "custom-rotation"]
    };

    public numplayers!: number;
    public currplayer!: playerid;
    public systems: System[] = [];
    public stash!: Stash;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public actions!: IActionTracker;
    private eliminated: Seat[] = [];
    public variants: string[] = [];

    constructor(state: number | IHomeworldsState | string) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const fresh: IMoveState = {
                _version: HomeworldsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
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
                return "West";
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
            // Sort each alphabetically
            const tmpMoves: string[] = this.movesMove(player);
            tmpMoves.sort((a, b) => a.localeCompare(b));
            const tmpTrade: string[] = this.movesTrade(player);
            tmpTrade.sort((a, b) => a.localeCompare(b));
            const tmpBuild: string[] = this.movesBuild(player);
            tmpBuild.sort((a, b) => a.localeCompare(b));
            const tmpAttack: string[] = this.movesAttack(player);
            tmpAttack.sort((a, b) => a.localeCompare(b));
            const tmpSacrifice: string[] = this.movesSacrifice(player);
            // sort sacrifices by length
            tmpSacrifice.sort((a, b) => {
                if (a.length === b.length) {
                    return a.localeCompare(b);
                } else {
                    return a.length - b.length;
                }
            });

            allmoves.push(...tmpAttack, ...tmpBuild, ...tmpMoves, ...tmpTrade, ...tmpSacrifice);
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
                newg.move(m, {partial: true});
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
                    // Make a PowerSet of catastrophe combinations
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
    private movesMove(player: playerid, validateTech = true): string[] {
        const final: Set<string> = new Set<string>();
        const myseat = this.player2seat(player);

        // Generate a single discovered system name
        const newname = wng();

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
            myg.move(moves.join(", "), {partial: true});
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
                    // Don't worry about the extra "p" here, though (global stash, methinks).
                    ship = piece;
                }
            } else {
                [system, ship] = piece.split("|");
                // The renderer is adding a "p" to pyramids in this scenario but not in others.
                // Not sure why, but this seems to correct it.
                if ( (ship !== undefined) && (ship.startsWith("p")) ) {
                    ship = ship.substring(1);
                }
                const match = system.match(/\(([NESW])\)$/);
                if (match !== null) {
                    system = this.seat2name(match[1] as Seat);
                }
            }

            // process
            let newmove: string|undefined;

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
                    // if you clicked on a ship or star, simply add it to the array
                    if (ship !== undefined) {
                        newmove = `[${piece}]`;
                    // otherwise, check for button or otherwise abort
                    } else {
                        if (system !== undefined) {
                            if (system === "_sacrifice") {
                                newmove = `sacrifice`;
                            } else if (system === "_pass") {
                                newmove = `pass`;
                            } else if (system === "_catastrophe") {
                                newmove = `catastrophe`
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
                // pass and catastrophes should reset whatever the in-progress move is
                if ( (system !== undefined) && (system === "_pass") ) {
                    newmove = "pass";
                } else if ( (system !== undefined) && (system === "_catastrophe") ) {
                    newmove = "catastrophe";
                } else {
                    // Keep supporting the old approach for people that type their commands
                    // and just want some extra assistance. And the old approach is still
                    // used for the `homeworld` command and the buttons.
                    if (lastcmd === "homeworld") {
                        if (ship !== undefined) {
                            newmove = `homeworld ${lastargs.join(" ")} ${ship.slice(0, 2)}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    } else if (lastcmd === "discover") {
                        if ( (row < 0) && (ship !== undefined) ) {
                            newmove = `discover ${lastargs.join(" ")} ${ship.slice(0, 2)} ${wng()}`;
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
                            if ( (row < 0) && (system === undefined) && (ship !== undefined) ) {
                                newmove = `discover ${lastargs.join(" ")} ${ship.slice(0, 2)} ${wng()}`;
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
                            // if selecting a ship from the global stash
                            if ( (row < 0) && (ship !== undefined) ) {
                                newmove = `build ${ship[0]}`;
                            // else if clicking on an existing ship
                            } else if ( (system !== undefined) && (ship !== undefined) ) {
                                newmove = `build ${ship[0]} ${system}`;
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
                        if ( (ship !== undefined) && (system !== undefined) ) {
                            newmove = `catastrophe ${system} ${ship[0]}`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    } else {
                        // check if this is a new handler command
                        if (lastmove.startsWith("[")) {
                            let toAdd = piece;
                            if ( (row >= 0) && (ship === undefined) && (system !== undefined) ) {
                                toAdd += "|";
                            }
                            newmove = lastmove.replace("]", ` ${toAdd}]`);
                        // otherwise abort
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    }
                }
            }

            // expand new click handler array if possible
            // can also abort if array is wholly invalid
            if (newmove.startsWith("[")) {
                newmove = this.expandHandlerArray(newmove);
                if (newmove === undefined) {
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
                // check for remaining sacrifice actions
                if ( (result.complete !== undefined) && (result.complete === -1) && (result.canrender) ) {
                    const cloned = this.clone();
                    cloned.move(compiled, {partial: true});
                    let newNewMove = compiled;
                    if (! newNewMove.endsWith("catastrophe")) {
                        if (cloned.actions.B > 0) {
                            newNewMove = result.move + ", trade";
                        } else if (cloned.actions.G > 0) {
                            newNewMove = result.move + ", build";
                        } else if (cloned.actions.R > 0) {
                            newNewMove = result.move + ", attack";
                        } else if (cloned.actions.Y > 0) {
                            newNewMove = result.move + ", move";
                        }
                    }
                    const newResult = this.validateMove(newNewMove) as IClickResult;
                    newResult.move = newNewMove;
                    newResult.canrender = true;
                    return newResult;
                }
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

    public expandHandlerArray(m: string): string|undefined {
        const pieces = m.substring(1, m.length - 1).split(/\s+/);
        const myseat = this.player2seat(this.currplayer);

        // parse piece types
        type PieceTypes = "FRIENDLY"|"ENEMY"|"STAR"|"SYSTEM"|"STASH"|"VOID"|"BUTTON"|undefined;
        const types: PieceTypes[] = [];
        for (const pc of pieces) {
            if (pc.startsWith("_")) {
                if (pc === "_void") {
                    types.push("VOID");
                } else {
                    types.push("BUTTON");
                }
            } else if (pc.includes("|")) {
                const [system, ship] = pc.split("|");
                if ( (ship !== undefined) && (ship.length > 0) ) {
                    if (ship.startsWith("p")) {
                        const seat = ship[ship.length - 1] as Seat;
                        if (seat === myseat) {
                            types.push("FRIENDLY");
                        } else {
                            types.push("ENEMY");
                        }
                    } else {
                        types.push("STAR")
                    }
                } else if (system !== undefined) {
                    types.push("SYSTEM");
                }
            } else if (/^[RGBY][123]$/.test(pc)) {
                types.push("STASH")
            } else {
                types.push(undefined);
            }
        }

        // look for a match, expand if possible, return undefined if totally wrong
        if (types.includes(undefined)) {
            return undefined;
        }
        if (types[0] === "ENEMY") {
            const [system, ship] = pieces[0].split("|");
            return `attack ${ship.substring(1)} ${system}`;
        }
        if (types[0] === "FRIENDLY") {
            if (types.length > 1) {
                if (types[1] === "FRIENDLY") {
                    if (pieces[0] === pieces[1]) {
                        const [system, ship] = pieces[0].split("|");
                        return `build ${ship[1]} ${system}`;
                    } else {
                        const [system1, ship1] = pieces[0].split("|");
                        const [system2, ] = pieces[1].split("|");
                        if (system1 !== system2) {
                            return `move ${ship1.substring(1,3)} ${system1} ${system2}`
                        } else {
                            return undefined;
                        }
                    }
                }
                if ( (types[1] === "STAR") || (types[1] === "ENEMY") ) {
                    const [system1, ship1] = pieces[0].split("|");
                    const [system2, ] = pieces[1].split("|");
                    if (system1 !== system2) {
                        return `move ${ship1.substring(1,3)} ${system1} ${system2}`
                    } else {
                        return undefined;
                    }
                }
                if (types[1] === "SYSTEM") {
                    const [systemFrom, shipFrom] = pieces[0].split("|");
                    const [systemTo,] = pieces[1].split("|");
                    return `move ${shipFrom.substring(1,3)} ${systemFrom} ${systemTo}`;
                }
                if (types[1] === "STASH") {
                    const [system, ship] = pieces[0].split("|");
                    return `trade ${ship.substring(1,3)} ${system} ${pieces[1][0]}`;
                }
                if (types[1] === "VOID") {
                    if (types.length > 2) {
                        if (types[2] === "STASH") {
                            const [system, ship] = pieces[0].split("|");
                            return `discover ${ship.substring(1,3)} ${system} ${pieces[2]} ${wng()}`;
                        }
                        return undefined;
                    } else {
                        return m;
                    }
                }
                if (types[1] === "BUTTON") {
                    if (pieces[1] === "_sacrifice") {
                        const [system, ship] = pieces[0].split("|");
                        return `sacrifice ${ship.substring(1,3)} ${system}`;
                    } else if (pieces[1] === "_pass") {
                        return "pass";
                    } else {
                        return undefined;
                    }
                }
                return undefined;
            } else {
                return m;
            }
        }
        return undefined;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")||"DEFAULT_HANDLER"};

        const myseat = this.player2seat(this.currplayer);
        const mysys = this.systems.find(s => s.owner === myseat);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (mysys === undefined) {
                result.message = i18next.t("apgames:validation.homeworlds.INITIAL_INSTRUCTIONS", {context: "fresh"});
            } else {
                result.message = i18next.t("apgames:validation.homeworlds.INITIAL_INSTRUCTIONS", {context: "inprogress"});
            }
            return result;
        }

        const keywords: string[] = ["homeworld", "discover", "move", "build", "trade", "attack", "sacrifice", "catastrophe", "pass"];
        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const cloned = this.clone();

        cloned.actions = {free: 1, R: 0, B: 0, G: 0, Y: 0};
        const LHO = cloned.getLHO();
        if ( (LHO === undefined) && (cloned.stack.length > cloned.numplayers) ) {
            throw new Error("Could not find a LHO even after all homeworlds have been established. This should never happen.");
        }

        let subResult: IValidationResult | undefined;
        let nemesisCatastrophed = false;
        for (let i = 0; i < moves.length; i++) {
        // for (const move of moves) {
            const move = moves[i];
            // skip empty orders
            if (move.match(/^\s*$/)) {
                continue;
            }

            // check for in-progress click handler array
            if (move.startsWith("[")) {
                const pieces = m.substring(1, m.length - 1).split(/\s+/);
                if (pieces.length > 0) {
                    if (
                        (pieces[0].includes("|"))       // must be a ship
                        && (/[NESW]$/.test(pieces[0]))  // must end with a seat designation
                        && (pieces[0][pieces[0].length - 1] === myseat) ) // must be friendly
                    {
                        if (pieces.length === 1) {
                            return {
                                valid: true,
                                complete: -1,
                                message: i18next.t("apgames:validation.homeworlds.NEW_FRIENDLY_PARTIAL"),
                            };
                        } else if ( (pieces.length === 2) && (pieces[1] === "_void") ) {
                            return {
                                valid: true,
                                complete: -1,
                                message: i18next.t("apgames:validation.homeworlds.NEW_MOVE_PARTIAL"),
                            };
                        }
                    }
                }
                return {
                    valid: false,
                    message: i18next.t("apgames:validation._general.INVALID_MOVE", {move})
                };
            }

            const todate = moves.slice(0, i).join(",");
            cloned.load();
            cloned.move(todate, {partial: true});

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
                    subResult = cloned.validateCatastrophe(...tokens.slice(1), LHO!);
                    if (!nemesisCatastrophed) {
                        nemesisCatastrophed = (subResult !== undefined && subResult.complete === 1);
                    }
                    if (subResult.complete === 1) {
                        subResult.complete = 0;
                    }
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
        cloned.load();
        cloned.move(m, {partial: true});

        // now check to see if nemesis was eliminated
        let nemesisEliminated = false;
        if (nemesisCatastrophed) {
            // check for destruction of all stars
            const nemSys = cloned.systems.find(s => s.owner === LHO);
            if (nemSys === undefined) {
                nemesisEliminated = true;
            }
            // check for losing all owned ships
            else {
                if ( (nemSys.stars.length === 0) || (nemSys.countShips(LHO!) === 0) ) {
                    nemesisEliminated = true;
                }
            }
        }

        // You have to account for all your actions
        let hasActions = false;
        if ( (cloned.actions.R > 0) || (cloned.actions.B > 0) || (cloned.actions.G > 0) || (cloned.actions.Y > 0) || (cloned.actions.free > 0) ) {
            hasActions = true;
        }

        // You can't cause yourself to lose
        let eliminated = false;
        if (! m.startsWith("homeworld")) {
            const home = cloned.systems.find(s => s.owner === cloned.player2seat());
            if (home === undefined) {
                throw new Error("Could not find your home system. This should never happen at this point.");
            }
            if ( (home.stars.length === 0) || (home.countShips(cloned.player2seat()) === 0) ) {
                eliminated = true;
                // unless it would trigger a draw
                let wouldDraw = false;
                if (this.numplayers === 2) {
                    let otherPlayer: playerid = 1;
                    if (this.currplayer === 1) {
                        otherPlayer = 2;
                    }
                    const otherSeat = cloned.player2seat(otherPlayer);
                    if (otherSeat === undefined) {
                        throw new Error("Could not determine LHO.");
                    }
                    const otherHome = cloned.systems.find(s => s.owner === otherSeat);
                    if ( (otherHome === undefined) || (otherHome.stars.length === 0) || (otherHome.countShips(otherSeat) === 0) ) {
                        wouldDraw = true;
                    }
                }

                if (! wouldDraw) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:homeworlds.MOVE_SELFELIMINATE");
                    return result;
                }
            }
        }

        // fully validated move set
        result.valid = true;
        result.canrender = true;
        // If a catastrophe caused the elimination of your nemesis, then it doesn't matter
        // if you still have free actions remaining. The move is complete.
        if (nemesisEliminated) {
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
        // Otherwise, if you have a free action, you have to use it.
        else if ( (hasActions) && (! eliminated) ) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
        }
        // Finally, the move is just valid
        else {
            result.complete = 0;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public move(m: string, {partial = false, trusted = false} = {}): HomeworldsGame {
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
            // if partial, skip incomplete moves
            if ( (partial) && (! this.isCmdComplete(move)) ) {
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

        // Check for any home systems where the player no longer owns any ships
        // That player is eliminated, and their system becomes a periphery system
        const homes = this.systems.filter(s => s.isHome());
        for (const h of homes) {
            if ( (h.stars.length === 0) || (h.countShips(h.owner!) === 0) ) {
                this.results.push({"type": "eliminated", "who": this.seat2name(h.owner)});
                this.eliminated.push(h.owner!);
                h.owner = undefined;
            }
        }
        // cull any systems that are now fully empty
        // this normally happens during regular moves, but we have to also do it now that we're eliminating systems
        const empties = this.systems.filter(s => s.ships.length === 0);
        for (const sys of empties) {
            this.delSystem(sys)
        }

        // You have to account for all your actions, unless you or your nemesis have been eliminated
        if ( (this.actions.R > 0) || (this.actions.B > 0) || (this.actions.G > 0) || (this.actions.Y > 0) || (this.actions.free > 0) ) {
            if (! this.eliminated.includes(this.player2seat()) && ! this.eliminated.includes(LHO!)) {
                throw new UserFacingError(HomeworldsErrors.MOVE_MOREACTIONS, i18next.t("apgames:homeworlds.MOVE_MOREACTIONS"));
            }
        }

        // Check for winning conditions
        if ( (this.eliminated.length > 0) && (this.eliminated.includes(this.player2seat())) ) {
            // either a draw or an illegal move
            if ( (this.numplayers === 2) && (this.eliminated.includes(LHO!)) ) {
                this.gameover = true;
                this.results.push({type: "eog"});
                this.winner = [1, 2];
                this.results.push({type: "winners", players: [...this.winner]});
            } else {
                throw new UserFacingError(HomeworldsErrors.MOVE_SELFELIMINATE, i18next.t("apgames:homeworlds.MOVE_SELFELIMINATE"));
            }
        } else if ( (this.eliminated.length > 0) && (this.eliminated.includes(LHO!)) ) {
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
            const overlap = mine.filter(s => theirs.includes(s)).length;
            if ( (! overridden) && (overlap === 0) ) {
                throw new UserFacingError(HomeworldsErrors.CMD_HOME_RHO_DIRECT, i18next.t("apgames:homeworlds.CMD_HOME_RHO_DIRECT"));
            }
            const canLarge = ( (theirs.length === 2) && (theirs[0] !== theirs[1]) );
            if ( (! overridden) && (canLarge) && (overlap === 2) ) {
                throw new UserFacingError(HomeworldsErrors.CMD_HOME_RHO_SMALL, i18next.t("apgames:homeworlds.CMD_HOME_RHO_SMALL"));
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
                const overlap = mine.filter(s => theirs.includes(s)).length;
                if ( (! overridden) && (overlap === 0) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_HOME_RHO_DIRECT");
                    return result;
                }
                const canLarge = ( (theirs.length === 2) && (theirs[0] !== theirs[1]) );
                if ( (! overridden) && (canLarge) && (overlap === 2) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:homeworlds.CMD_HOME_RHO_SMALL");
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
            result.canrender = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
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
            result.canrender = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
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
            result.canrender = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
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
            // system exists
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            // different colour
            if (newColour[0] === oldShip[0]) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_TRADE_DOUBLE");
                return result;
            }

            // appropriate size available
            const oldSize = parseInt(oldShip[1], 10);
            if (! this.stash.has(newColour as Colour, oldSize as Size)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_TRADE_NOSIZE", {size: oldSize, colour: newColour});
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
            result.canrender = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
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
            result.canrender = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
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
            result.canrender = true;
            if (this.countActions() > 0) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
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

        // if ( (this.actions.R > 0) || (this.actions.B > 0) || (this.actions.G > 0) || (this.actions.Y > 0) || (this.actions.free > 0) ) {
        //     throw new UserFacingError(HomeworldsErrors.CMD_CATA_ACTIONS, i18next.t("apgames:homeworlds.CMD_CATA_ACTIONS"));
        // }

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
        // also receives the seat of LHO
        if (args.length < 3) {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (args.length === 1) {
                result.message = i18next.t("apgames:validation.homeworlds.catastrophe.PARTIAL_NOARGS");
            }
            return result;
        } else {
            // eslint-disable-next-line prefer-const
            let [systemName, colour, LHO] = args;
            colour = colour[0].toUpperCase();

            const system = this.systems.find(sys => sys.name.toLowerCase() === systemName.toLowerCase());
            if (system === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_NOSYSTEM", {system: systemName});
                return result;
            }

            // if ( (this.actions.R > 0) || (this.actions.B > 0) || (this.actions.G > 0) || (this.actions.Y > 0) || (this.actions.free > 0) ) {
            //     result.valid = false;
            //     result.message = i18next.t("apgames:homeworlds.CMD_CATA_ACTIONS");
            //     return result;
            // }

            if (! system.canCatastrophe(colour as Colour)) {
                result.valid = false;
                result.message = i18next.t("apgames:homeworlds.CMD_CATA_INVALID", {colour, system: system.name});
                return result;
            }

            // valid complete move
            result.valid = true;
            result.canrender = true;
            // if you're elminating your nemesis, move is fully complete
            if (system.owner === LHO) {
                result.complete = 1;
            } else {
                result.complete = 0;
            }
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
        result.canrender = true;
        if (this.countActions() > 0) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.homeworlds.VALID_W_ACTIONS");
        } else {
            result.complete = 0;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
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
        if (sys.stars.length > 0) {
            for (const star of sys.stars) {
                this.stash.add(...star);
            }
        }
        if (sys.ships.length > 0) {
            for (const ship of sys.ships) {
                this.stash.add(ship.colour, ship.size);
            }
        }
        this.systems.splice(idx, 1);
        return this;
    }

    protected checkEOG(): HomeworldsGame {
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
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            systems: this.systems.map(s => s.clone()),
            stash: this.stash.clone()
        };
    }

    public render(): APRenderRep {
        // build legend based on number of players
        const myLegend: ILegendObj = {};
        // Stars first
        const cs = ["R", "B", "G", "Y"];
        const nums = [1, 2, 3, 4];
        for (let i = 0; i < cs.length; i++) {
            myLegend[cs[i] + "1"] = {
                name: "pyramid-up-small-upscaled",
                colour: nums[i]
            };
            myLegend[cs[i] + "2"] = {
                name: "pyramid-up-medium-upscaled",
                colour: nums[i]
            };
            myLegend[cs[i] + "3"] = {
                name: "pyramid-up-large-upscaled",
                colour: nums[i]
            };
        }

        // Now ships
        // You always have North and South
        const seats = ["N", "S"];
        // Three players gives you East and West (for rotations)
        if (this.numplayers > 2) {
            seats.push("E");
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
                    const node: Glyph = {
                        name: "pyramid-flat-" + sizeNames[j],
                        colour: nums[i]
                    };
                    if (r !== undefined) {
                        node.rotate = r;
                    }
                    myLegend['p' + cs[i] + (j + 1).toString() + d] = node;
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
            board: this.systems.map(s => s.renderSys()) as BoardHomeworlds,
            pieces: this.systems.map(s => s.renderShips()),
            areas: [this.stash.render()] as AreaHWStash[],
            legend: myLegend
        };
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }

        return rep;
    }

    // protected getMoveList(): any[] {
    //     if (this.numplayers > 2) {
    //         return this.getMovesAndResultsWithSequence();
    //     } else {
    //         return this.getMovesAndResults();
    //     }
    // }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, homeworld, discover, move, place, convert, capture, sacrifice, catastrophe, pass
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
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
                            node.push(i18next.t("apresults:EOG.default"));
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
                            if (r.players.length === 0)
                                node.push(i18next.t("apresults:WINNERSNONE"));
                            else
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));

                            break;
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public getCustomRotation(): number | undefined {
        if (this.numplayers > 2) {
            return 90;
        } else {
            return 180;
        }
    }

    public clone(): HomeworldsGame {
        return new HomeworldsGame(this.serialize());
    }

    // Test helper that simply checks if there are any pieces missing
    public economyBalanced(): boolean {
        const addCount = (key: string) => {
            if (counts.has(key)) {
                const val = counts.get(key)!;
                counts.set(key, val+1);
            } else {
                counts.set(key, 1);
            }
        }
        const counts = new Map<string,number>();

        // stash
        const stash = this.stash.render();
        for (const key of ["R","G","B","Y"] as const) {
            for (const n of stash[key].split("")) {
                addCount(`${key}${n}`);
            }
        }

        // ships
        for (const sys of this.systems) {
            for (const star of sys.stars) {
                addCount(`${star[0]}${star[1]}`);
            }
            for (const ship of sys.ships) {
                addCount(`${ship.colour}${ship.size}`);
            }
        }

        // validate counts
        for (const colour of ["R","G","B","Y"]) {
            for (const size of ["1","2","3"]) {
                if (counts.get(`${colour}${size}`)! !== this.numplayers + 1) {
                    return false;
                }
            }
        }
        return true;
    }
}
