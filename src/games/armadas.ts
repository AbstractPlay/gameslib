/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Ship } from "./armadas/ship";
import { IPoint, calcBearing, reviver, smallestDegreeDiff } from "../common";
import { UserFacingError } from "../common";
import { wng } from "../common";
import i18next from "i18next";
import { Obstacle } from "./armadas/obstacle";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
// const deepclone = require("rfdc/default");

export type playerid = 1|2|3|4;
export type Size = 1|2|3;

interface ILooseObj {
    [key: string]: any;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    ships: Ship[];
    ghosts: Ship[];
    showArcs: string|undefined;
    phase: "place"|"play";
    lastmove?: string;
}

export interface IArmadasState extends IAPGameState {
    winner: playerid[];
    maxShips: 0|1|2;
    obstacles: Obstacle[];
    stack: Array<IMoveState>;
};

interface IKeyEntry {
    piece: string;
    name: string;
    value?: string;
}

interface IKey {
    [k: string]: unknown;
    type: "key";
    list: IKeyEntry[];
    height?: number;
    buffer?: number;
    position?: "left"|"right";
    clickable?: boolean;
}

export class ArmadasGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Armadas",
        uid: "armadas",
        playercounts: [2,3,4],
        version: "20230714",
        // i18next.t("apgames:descriptions.armadas")
        description: "apgames:descriptions.armadas",
        // i18next.t("apgames:notes.armadas")
        notes: "apgames:notes.armadas",
        urls: [
            "https://boardgamegeek.com/boardgame/32630/armada",
        ],
        people: [
            {
                type: "designer",
                name: "Dan Isaac"
            }
        ],
        flags: ["experimental", "multistep", "no-moves"],
        variants: [
            {
                uid: "freeform",
                group: "fleet",
            },
            {
                uid: "noislands",
                group: "obstacles"
            },
            {
                uid: "twoislands",
                group: "obstacles"
            }
        ]
    };

    public static readonly BOARD_UNIT_DIMENSIONS = 48.61114501953125;

    /**
     * Looks for adjacent movements of the same ship and consolidates them
     * into a single command. Only does one instance and then recurses.
     */
    public static mergeMoves(moveStr: string): string {
        const moves = moveStr.split(/\s*[\n,;\/\\]\s*/).map(m => m.split(/\s+/));
        let dupe: number|undefined;
        for (let i = 1; i < moves.length; i++) {
            const move = moves[i];
            const prev = moves[i - 1];
            if (
                // full movement commands
                (move.length > 2) && (prev.length > 2) &&
                // both are `move` commands
                (move[1] === "move") && (prev[1] === "move") &&
                // same ship for both
                (move[0] === prev[0])
            ) {
                dupe = i;
                prev.push(move[2]);
                break;
            }
        }
        if (dupe !== undefined) {
            moves.splice(dupe, 1);
            return this.mergeMoves(moves.map(m => m.join(" ")).join(", "));
        }
        return moves.map(m => m.join(" ")).join(", ");
    }

    /**
     * Returns the top-left and bottom-right coordinates of the given player's starting rectangle.
     * It's calculated on the unit size, which must be a positive, odd integer no smaller than 11.
     * First player is bottom of board facing north.
     * Second player is top of board facing south.
     * Third player is right of board facing west.
     * Fourth player is left of board facing east.
     */
    public static getStartingArea(size: number, player: playerid): [IPoint, IPoint] {
        const dmz = Math.floor(size / 2);
        const allowance = Math.trunc((size - dmz) / 2);
        const maxCoord = size * this.BOARD_UNIT_DIMENSIONS;
        const pxAllowance = allowance * this.BOARD_UNIT_DIMENSIONS;
        let tl: IPoint; let br: IPoint;
        switch (player) {
            case 1:
                tl = {x: pxAllowance, y: maxCoord - pxAllowance};
                br = {x: maxCoord - pxAllowance, y: maxCoord};
                break;
            case 2:
                tl = {x: pxAllowance, y: 0};
                br = {x: maxCoord - pxAllowance, y: pxAllowance};
                break;
            case 3:
                tl = {x: maxCoord - pxAllowance, y: pxAllowance};
                br = {x: maxCoord, y: maxCoord - pxAllowance};
                break;
            case 4:
                tl = {x: 0, y: pxAllowance};
                br = {x: pxAllowance, y: maxCoord - pxAllowance};
                break;
        }
        return [tl, br];
    }

    public numplayers!: number;
    public currplayer!: playerid;
    public ships: Ship[] = [];
    public boardsize = 15;  // must be odd
    public maxShips: 0|1|2 = 2;
    public phase: "place"|"play" = "place";
    public showArcs: string|undefined;
    public attackTracker = new Map<string,number>();
    public ghosts: Ship[] = [];
    public obstacles: Obstacle[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];

    constructor(state: number | IArmadasState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            if ( (variants !== undefined) && (variants.length > 0) ) {
                if (variants.includes("freeform")) {
                    this.maxShips = 0;
                }
            }

            if ( (variants === undefined) || (! variants.includes("noislands"))) {
                const [tl1,] = ArmadasGame.getStartingArea(this.boardsize, 1);
                const [,br2] = ArmadasGame.getStartingArea(this.boardsize, 2);
                const cx = tl1.x + ((br2.x - tl1.x) / 2);
                const cy = br2.y + ((tl1.y - br2.y) / 2);
                if ( (variants === undefined) || (! variants.includes("twoislands")) ) {
                    this.obstacles.push(new Obstacle({cx, cy}));
                } else {
                    this.obstacles.push(new Obstacle({cx: tl1.x, cy}));
                    this.obstacles.push(new Obstacle({cx: br2.x, cy}));
                }
            }

            const fresh: IMoveState = {
                _version: ArmadasGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                ships: [],
                phase: "place",
                ghosts: [],
                showArcs: undefined,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IArmadasState;
            }
            if (state.game !== ArmadasGame.gameinfo.uid) {
                throw new Error(`The Armadas game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.maxShips = state.maxShips;
            if ("obstacles" in state) {
                this.obstacles = [...state.obstacles];
            } else {
                this.obstacles = [];
            }
            this.winner = [...state.winner];
            this.stack = [...state.stack];

            // Now recursively "Objectify" the ships
            this.obstacles = this.obstacles.map((s) => Obstacle.deserialize(s));
            this.stack.map((s) => {
                s.ships = s.ships.map(ship => Ship.deserialize(ship));
                s.ghosts = s.ghosts.map(ship => Ship.deserialize(ship));
            });
        }
        this.load();
    }

    public load(idx = -1): ArmadasGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.ships = state.ships.map(s => Ship.deserialize(s));
        this.phase = state.phase;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.ghosts = state.ghosts.map(s => Ship.deserialize(s));
        return this;
    }

    /**
     * Determines if an isolated command is complete based solely on number of arguments.
     * Used by the click handler to contextualize a received click.
     *
     * @private
     * @param {string} cmd
     * @returns {boolean}
     * @memberof ArmadasGame
     */
    private isCmdComplete(cmd: string): boolean {
        if ( (cmd === undefined) || (cmd === "") ) {
            return true;
        }

        /*
         * Valid commands
         *   - place size x y facing name
         *   - name move newFacing [newFacing...]
         *   - name attack targetName
         *   - pass
         */
        const args = cmd.split(/\s+/);
        if ( (args[0] === "place") && (args.length >= 6) ) {
            return true;
        }
        if ( (args[1] === "move") && (args.length >= 3) ) {
            return true;
        }
        if ( (args[1] === "attack") && (args.length >= 3) ) {
            return true;
        }
        if ( (args[0] === "pass") && (args.length >= 1) ) {
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
            let lastmove = "";
            if (moves.length > 0) {
                lastmove = moves[moves.length - 1];
            }
            const complete = this.isCmdComplete(lastmove);
            const lastargs = lastmove.split(/\s+/);
            // if the move is incomplete, remove it from the stack because the handler will rebuild it
            if (! complete) {
                moves.pop();
            } else {
                // if it is complete, clear any preexisting showArcs
                this.showArcs = undefined;
            }

            // apply interim moves to get updated ship facings
            const cloned = this.clone();
            cloned.move(moves.join(", "), true);

            // get click context
            // If `ship` is undefined, then row/col are planar coordinates
            // If row/col are negative, then trying to place a piece
            let ship: Ship|undefined;
            let size: Size|undefined;
            if ( (row < 0) && (col < 0) ) {
                size = parseInt(piece, 10) as Size;
            } else if (piece !== "_field") {
                ship = cloned.ships.find(s => s.id === piece);
                if (ship === undefined) {
                    throw new Error(`Could not find a ship named ${piece}`);
                }
            }

            // process
            let newmove: string|undefined;

            // Starting fresh
            if (complete) {
                // If size is defined, placement command
                if (size !== undefined) {
                    newmove = `place ${size}`;
                }
                // if ship is defined, it's move or fire
                else if (ship !== undefined) {
                    newmove = ship.id;
                    this.showArcs = ship.id;
                }
                // otherwise reject click
                else {
                    return {move, message: ""} as IClickResult;
                }
            }
            // Otherwise, adding to an incomplete command
            else {
                if (lastargs[0] === "place") {
                    // only acceptable click is on the background
                    if ( (size !== undefined) || (ship !== undefined) ) {
                        return {move, message: ""} as IClickResult;
                    }
                    const newx = Math.trunc((col * 100)) / 100; const newy = Math.trunc((row * 100)) / 100;
                    // if command doesn't already have coordinates, add them
                    if (lastargs.length === 2) {
                        let facing = 0;
                        if (this.currplayer === 2) {
                            facing = 180;
                        } else if (this.currplayer === 3) {
                            facing = 270;
                        } else if (this.currplayer === 4) {
                            facing = 90;
                        }
                        newmove = [...lastargs, newx, newy, facing, wng()].join(" ");
                    }
                    // Don't ask for facing on initial placement
                    // Just assume it and let player manually adjust the text move if they want
                    // // otherwise, assume facing
                    // else if (lastargs.length === 4) {
                    //     const [lastx, lasty] = [lastargs[2], lastargs[3]].map(n => parseFloat(n));
                    //     const facing = calcBearing(lastx, lasty, newx, newy);
                    //     newmove = [...lastargs, facing, wng()].join(" ");
                    // }
                    // catchall
                    else {
                        throw new Error(`Invalid placement string encountered: ${lastargs.join(" ")}`);
                    }
                } else if ( (lastargs.length === 1) && (lastargs[0] !== "pass") ) {
                    // if ship is defined, we're attacking or picking a new ship
                    if (ship !== undefined) {
                        if (ship.owner !== this.currplayer) {
                            newmove = [...lastargs, "attack", ship.id].join(" ");
                        } else {
                            newmove = ship.id;
                            this.showArcs = ship.id;
                        }
                    }
                    // otherwise we're moving
                    else {
                        const movingShip = cloned.ships.find(s => s.id === lastargs[0]);
                        if (movingShip === undefined) {
                            throw new Error(`Could not find a ship named ${lastargs[0]}`);
                        }
                        let facing = Math.trunc((calcBearing(movingShip.tx, movingShip.ty, col, row) * 100)) / 100;
                        const delta = smallestDegreeDiff(facing, movingShip.facing);
                        if (delta < -75) {
                            facing = movingShip.facing - 75;
                        } else if (delta > 75) {
                            facing = movingShip.facing + 75;
                        }
                        newmove = [...lastargs, "move", facing].join(" ");
                    }
                } else {
                    return {move, message: ""} as IClickResult;
                }
            }

            let compiled = newmove;
            if (moves.length > 0) {
                compiled = ArmadasGame.mergeMoves([...moves, newmove].join(", "));
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
        m = m.replace(/^\s+/g, "");
        m = m.replace(/\s+$/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            let context = this.phase as string;
            if ( (this.maxShips === 0) && (this.phase === "place") ) {
                context = "placefree"
            }
            result.message = i18next.t("apgames:validation.armadas.INITIAL_INSTRUCTIONS", {context});
            return result;
        }

        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const cloned = this.clone();
        cloned.attackTracker.clear();

        // if the move includes a pass, it must be the only thing provided
        if ( (moves.filter(mv => mv.startsWith("pass")).length > 0) && (moves.length > 1) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.BAD_PASS");
            return result;
        }

        // check for double moves
        const moved = new Set<string>();
        for (const move of moves) {
            const tokens = move.split(/\s+/);
            if ( (tokens.length >= 2) && (tokens[1] === "move") ) {
                if (moved.has(tokens[0])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.armadas.DOUBLE_MOVE");
                    return result;
                }
                moved.add(tokens[0]);
            }
        }

        // validate and apply each individual move
        let subResult: IValidationResult | undefined;
        let numMoves = 0;
        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            // skip empty orders
            if (move.match(/^\s*$/)) {
                continue;
            }
            numMoves++;

            const todate = moves.slice(0, i).join(",");
            cloned.load();
            cloned.move(todate, true);

            const tokens = move.split(/\s+/);

            // if the move is just a ship name, need further clarification
            if ( (tokens.length === 1) && (tokens[0] !== "place") && (tokens[0] !== "pass") ) {
                this.showArcs = tokens[0];
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.armadas.JUST_SHIP_NAME");
                return result;
            }

            if (tokens[0] === "place") {
                subResult = cloned.validatePlacement(...tokens);
            } else if (tokens[1] === "move") {
                subResult = cloned.validateMovement(...tokens);
            } else if (tokens[1] === "attack") {
                subResult = cloned.validateAttack(...tokens);
            } else if (tokens[0] === "pass") {
                subResult = cloned.validatePass(...tokens);
            } else {
                subResult = {
                    valid: false,
                    message: i18next.t("apgames:validation.armadas.MOVE_UNRECOGNIZED", {cmd: move})
                };
            }
        }
        if ( (subResult !== undefined) && ( (! subResult.valid) || ( (subResult.complete !== undefined) && (subResult.complete < 0) ) ) ) {
            return subResult;
        }
        // If we've gotten this far, each individual command was valid and complete

        // you can't take more than three actions
        if (numMoves > 3) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.TOO_MANY_ACTIONS");
            return result;
        }

        // fully validated move set
        result.valid = true;
        result.canrender = true;
        const complete: 0 | 1 | -1 | undefined = 0;
        // disabling complete check
        // for this game, always return 0;
        // // complete can only be 1 if all three actions were taken
        // if (numMoves === 3) {
        //     const lastargs = moves[2].split(/\s+/);
        //     // and if the last action was not a move
        //     if ( (lastargs.length < 3) || (lastargs[1] !== "move") ) {
        //         // except placement
        //         if (lastargs[0] !== "place") {
        //             complete = 1;
        //         }
        //     }
        //     // or the last action is a *complete* move
        //     else {
        //         const shipName = lastargs[0];
        //         const ship = this.ships.find(s => s.id === shipName);
        //         if (ship !== undefined) {
        //             if (lastargs.slice(2).length === 5 - ship.size) {
        //                 complete = 1;
        //             }
        //         }
        //     }
        // }
        result.complete = complete;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * The `partial` flag leaves the object in an invalid state. It should only be used on a disposable object,
     * or you should call `load()` before finalizing the move.
     *
     * @param m The move string itself
     * @param partial A signal that you're just exploring the move; don't do end-of-move processing
     * @returns [ArmadasGame]
     */
    public move(m: string, partial = false): ArmadasGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        // validate if not partial
        if (! partial) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        /*
         * Valid commands
         *   - place size x y facing name
         *   - name move newFacing [newFacing...]
         *   - name attack targetName
         *   - pass
         */
        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        this.results = [];
        this.ghosts = [];

        const mFormatted: string[] = [];
        for (const move of moves) {
            // skip empty orders
            if (move.match(/^\s*$/)) {
                continue;
            }
            // if partial, skip incomplete moves except for ship-only designations
            if (partial) {
                if (! this.isCmdComplete(move)) {
                    if (! move.startsWith("place")) {
                        this.showArcs = move;
                    }
                    continue;
                }
            }

            const tokens: string[] = move.split(/\s+/);
            if (tokens[0] === "place") {
                this.cmdPlace(...tokens);
            } else if (tokens[1] === "move") {
                this.cmdMove(...tokens);
            } else if (tokens[1] === "attack") {
                this.cmdAttack(...tokens);
            } else if (tokens[0] === "pass") {
                this.cmdPass(...tokens);
            } else {
                throw new UserFacingError("MOVE_UNRECOGNIZED", i18next.t("apgames:validation.armadas.MOVE_UNRECOGNIZED", {cmd: move}));
            }
            // do any normalization here if you wanted to
            mFormatted.push(tokens.join(" "));
        }
        this.lastmove = mFormatted.join(", ");
        if (partial) {
            return this;
        }

        // check for phase transition
        if (this.phase === "place") {
            // if not freeform, check for max ships
            if (this.maxShips > 0) {
                let missing = false;
                for (let p = 1; p <= this.numplayers; p++) {
                    for (const size of [1,2,3] as const) {
                        const ships = this.ships.filter(s => s.owner === p && s.size === size);
                        if (ships.length < this.maxShips) {
                            missing = true;
                            break;
                        }
                    }
                    if (missing) { break; }
                }
                if (! missing) {
                    this.phase = "play";
                    this.currplayer = this.numplayers as playerid;
                }
            }
            // otherwise, check for consecutive passes
            else {
                // all players have passed consecutively
                if ( (this.lastmove === "pass") && (this.stack.length >= this.numplayers) ) {
                    const lastmoves = new Set<string>();
                    lastmoves.add("pass");
                    for (let p = 2; p <= this.numplayers; p++) {
                        lastmoves.add(this.stack[this.stack.length - (p - 1)].lastmove!);
                    }
                    if (lastmoves.size === 1) {
                        this.phase = "play";
                        this.currplayer = this.numplayers as playerid;
                    }
                }
            }
        }

        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        if (this.stack.length > this.numplayers) {
            while (this.ships.find(s => s.owner === newplayer) === undefined) {
                newplayer += 1;
                if (newplayer > this.numplayers) {
                    newplayer = 1;
                }
            }
        }
        this.currplayer = newplayer as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    // The cmdX functions don't do any validation
    private cmdMove(...args: string[]): ArmadasGame {
        // name move facing [...facing]
        if (args.length < 3) {
            throw new UserFacingError("CMD_PARAMETERS_TOOFEW", i18next.t("apgames:validation.armadas.CMD_PARAMETERS_TOOFEW", {type: "move"}));
        }
        const [shipName, , ...facings] = args;
        const ship = this.ships.find(s => s.id === shipName);
        if (ship === undefined) {
            throw new Error(`Could not find a ship named ${shipName}.`);
        }

        for (const facing of facings.map(f => parseFloat(f))) {
            const ghost = ship.clone();
            this.ghosts.push(ghost);
            ship.move(facing);
            this.results.push({type: "move", from: ghost.facing.toString(), to: ship.facing.toString(), what: ship.id});
        }

        return this;
    }

    private validateMovement(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.phase === "place") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.PLAY_IN_PLACE");
            return result;
        }

        // name move facing [...facing]
        const [shipName, , ...facings] = args;
        const ship = this.ships.find(s => s.id === shipName);
        if (ship === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.NO_SHIP", {name: shipName});
            return result;
        }

        // must be yours
        if (ship.owner !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        if ( (facings !== undefined) && (Array.isArray(facings)) && (facings.length > 0) ) {
            if (facings.length > 5 - ship.size) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.TOO_FAR");
                return result;
            }

            for (const facing of facings) {
                try {
                    parseFloat(facing);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_NUMBER", {num: facing});
                    return result;
                }
            }

            const cloned = ship.clone();
            for (const facing of facings.map(f => parseFloat(f))) {
                if (smallestDegreeDiff(cloned.facing, facing) > 75) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.armadas.TOO_SHARP");
                    return result;
                }
                cloned.move(facing);
                if ( (cloned.collidingWith(this.ships.filter(s => s.id !== cloned.id).map(s => s.circularForm))) || (cloned.collidingWith(this.obstacles.map(o => o.circularForm))) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.armadas.COLLISION");
                    return result;
                }
                const maxCoord = this.boardsize * ArmadasGame.BOARD_UNIT_DIMENSIONS;
                for (const corner of cloned.polygon) {
                    if ( (corner.x < 0) || (corner.x > maxCoord) || (corner.y < 0) || (corner.y > maxCoord) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.armadas.OUT_OF_BOUNDS");
                        return result;
                    }
                }
            }

            // valid complete move
            result.valid = true;
            if (facings.length === 5 - ship.size) {
                result.complete = 1;
            } else {
                result.canrender = true;
                result.complete = 0;
            }
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.armadas.VALID_PARTIAL_MOVE");
            return result;
        }
    }

    private cmdPlace(...args: string[]): ArmadasGame {
        // place size x y facing name
        if (args.length < 6) {
            throw new UserFacingError("CMD_PARAMETERS_TOOFEW", i18next.t("apgames:validation.armadas.CMD_PARAMETERS_TOOFEW", {type: "place"}));
        }
        const [, size, x, y, facing, name] = args;
        this.ships.push(new Ship({id: name, owner: this.currplayer, size: parseInt(size, 10) as Size, cx: parseFloat(x), cy: parseFloat(y), facing: parseFloat(facing)}));
        this.results.push({type: "place", where: name, what: size});
        return this;
    }

    private validatePlacement(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.phase === "play") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.PLACE_IN_PLAY");
            return result;
        }

        // place size x y facing name
        const [, sizeStr, xStr, yStr, facingStr, name] = args;
        if (sizeStr !== undefined) {
            const size = parseFloat(sizeStr) as Size;
            if ( (size !== 1) && (size !== 2) && (size !== 3) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.INVALID_SIZE");
                return result;
            }
            const ships = this.ships.filter(s => s.owner === this.currplayer && s.size === size);
            if ( (this.maxShips > 0) && (ships.length >= this.maxShips) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.place.TOO_MANY", {num: this.maxShips});
                return result;
            }
            if ( (xStr !== undefined) && (yStr !== undefined) ) {
                let x: number; let y: number;
                try {
                    x = parseFloat(xStr);
                    y = parseFloat(yStr);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_NUMBER", {num: facingStr});
                    return result;
                }
                const [tl, br] = ArmadasGame.getStartingArea(this.boardsize, this.currplayer);
                if ( (x < tl.x) || (x > br.x) || (y < tl.y) || (y > br.y) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.armadas.place.OUT_OF_BOUNDS");
                    return result;
                }

                if (facingStr !== undefined) {
                    try {
                        parseFloat(facingStr);
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALID_NUMBER", {num: facingStr});
                        return result;
                    }
                    // no restrictions on initial facing

                    if (name !== undefined) {
                        // must meet the minimum rules
                        if (! Ship.nameValid(name)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.armadas.INVALID_NAME");
                            return result;
                        }
                        // must be unique
                        if (this.ships.filter(s => s.id === name).length > 0) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.armadas.DUPLICATE_NAME");
                            return result;
                        }

                        const test = new Ship({cx: x, cy: y, id: name, facing: parseFloat(facingStr), size, owner: this.currplayer})
                        if ( (test.collidingWith(this.ships.map(s => s.circularForm))) || (test.collidingWith(this.obstacles.map(o => o.circularForm))) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.armadas.COLLISION");
                            return result;
                        }

                        // valid complete move
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    } else {
                        // valid partial
                        result.valid = true;
                        result.complete = -1;
                        result.message = i18next.t("apgames:validation.armadas.place.PARTIAL_FOUR_ARGS");
                        return result;
                    }
                } else {
                    // valid partial
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.armadas.place.PARTIAL_THREE_ARGS");
                    return result;
                }
            } else {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.armadas.place.PARTIAL_ONETWO_ARGS");
                return result;
            }
        } else {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.armadas.place.PARTIAL_NOARGS");
            return result;
        }
    }

    private cmdAttack(...args: string[]): ArmadasGame {
        // name attack targetName
        if (args.length < 3) {
            throw new UserFacingError("CMD_PARAMETERS_TOOFEW", i18next.t("apgames:validation.armadas.CMD_PARAMETERS_TOOFEW", {type: "attack"}));
        }
        const [myName, , targetName] = args;
        const myShip = this.ships.find(s => s.id === myName);
        const theirShip = this.ships.find(s => s.id === targetName);
        if ( (myShip === undefined) || (theirShip === undefined) ) {
            throw new Error("Could not find one of the ships in the attack order.");
        }
        // track attack
        let val = 0;
        if (this.attackTracker.has(myShip.id)) {
            val = this.attackTracker.get(myShip.id)!;
        }
        this.attackTracker.set(myShip.id, val + 1);
        // apply damage
        theirShip.takeDamage();
        this.results.push({type: "damage", who: theirShip.id, where: myShip.id});
        // destroy ship if necessary
        if (theirShip.sunk) {
            this.ghosts.push(theirShip.clone());
            this.results.push({type: "destroy", what: theirShip.id});
            const idx = this.ships.findIndex(s => s.id === theirShip.id);
            this.ships.splice(idx, 1);
        }

        return this;
    }

    private validateAttack(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.phase === "place") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.PLAY_IN_PLACE");
            return result;
        }

        // myName attack targetName
        const [myName, , theirName] = args;
        const myShip = this.ships.find(s => s.id === myName);
        if (myShip === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.NO_SHIP", {name: myName});
            return result;
        }

        // must be yours
        if (myShip.owner !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // can only attack so many times
        let numAttacks = 1;
        if (this.attackTracker.has(myShip.id)) {
            numAttacks += this.attackTracker.get(myShip.id)!;
        }
        if (numAttacks > myShip.size) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.armadas.TOO_MANY_ATKS");
            return result;
        }

        if (theirName !== undefined) {
            const theirShip = this.ships.find(s => s.id === theirName);
            if (theirShip === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.NO_SHIP", {name: theirName});
                return result;
            }

            if (theirShip.owner === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.SELF_ATK");
                return result;
            }

            if (! myShip.canHit(theirShip)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.OUT_OF_RANGE", {mine: myShip.id, theirs: theirShip.id});
                return result;
            }

            if (! myShip.canSee(theirShip, [...this.obstacles.map(o => o.circularForm), ...this.ships.filter(s => s.id !== myShip.id && s.id !== theirShip.id).map(s => s.circularForm)])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.NO_LOS", {mine: myShip.id, theirs: theirShip.id});
                return result;
            }

            // valid complete move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.armadas.CHOOSE_TARGET");
            return result;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private cmdPass(...args: string[]): ArmadasGame {
        // pass
        this.results.push({type: "pass"});
        return this;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private validatePass(...args: string[]): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        // pass
        // passing is not allowed during the place phase of the standard game while you still have ships to place
        if ( (this.phase === "place") && (! this.variants.includes("freeform")) ) {
            const numShips = this.ships.filter(s => s.owner === this.currplayer).length;
            if (numShips < this.maxShips * 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.armadas.PASS_IN_PLACE");
                return result;
            }
        }

        // valid complete move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    protected checkEOG(): ArmadasGame {
        if (this.phase === "play") {
            // all players have passed consecutively
            // lose the "+1" because the current state hasn't been saved to the stack yet
            if ( (this.lastmove === "pass") && (this.stack.length >= this.numplayers /* + 1 */) ) {
                const lastmoves = new Set<string>();
                lastmoves.add("pass");
                for (let p = 2; p <= this.numplayers; p++) {
                    const state = this.stack[this.stack.length - (p - 1)];
                    // only counts if this happened during the "play" phase
                    if (state.phase === "play") {
                        lastmoves.add(state.lastmove!);
                    } else {
                        lastmoves.add("NO!");
                    }
                }
                if (lastmoves.size === 1) {
                    this.gameover = true;
                    const winners: playerid[] = [];
                    for (let p = 1; p <= this.numplayers; p++) {
                        winners.push(p as playerid);
                    }
                    this.winner = [...winners];
                }
            }
            // only one man standing
            else {
                for (let p = 1; p <= this.numplayers; p++) {
                    const ships = this.ships.filter(s => s.owner === p);
                    if (ships.length === this.ships.length) {
                        this.gameover = true;
                        this.winner = [p as playerid];
                        break;
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

    public state(): IArmadasState {
        return {
            game: ArmadasGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            maxShips: this.maxShips,
            obstacles: [...this.obstacles],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ArmadasGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            phase: this.phase,
            ships: [...this.ships],
            ghosts: [...this.ghosts],
            showArcs: this.showArcs,
        };
    }

    public render(): APRenderRep {
        // build legend based on number of players
        const myLegend: ILooseObj = {};
        const cs = ["R", "B", "G", "Y"];
        const nums = [1, 2, 3, 4];
        const sizeNames = ["small", "medium", "large"];
        for (let i = 0; i < cs.length; i++) {
            for (let j = 0; j < sizeNames.length; j++) {
                const node: ILooseObj = {
                    name: "pyramid-flat-" + sizeNames[j],
                    player: nums[i]
                };
                myLegend[cs[i] + (j + 1).toString()] = node;
                const ghostNode = {...node, opacity: 0.25};
                myLegend["ghost" + cs[i] + (j + 1).toString()] = ghostNode;
            }
        }
        myLegend.D1 = {
            text: "1",
            colour: "#000",
            scale: 0.25,
        };
        myLegend.D2 = {
            text: "2",
            colour: "#000",
            scale: 0.25,
        };

        const pieces: ILooseObj[] = [];
        for (const ship of this.ships) {
            pieces.push({
                glyph: `${cs[ship.owner - 1]}${ship.size}`,
                id: ship.id,
                x: ship.cx,
                y: ship.cy,
                orientation: ship.facing,
            });
        }

        const markers: ILooseObj[] = [];
        const annotations: any[] = [];
        if (this.showArcs !== undefined) {
            const ship = this.ships.find(s => s.id === this.showArcs);
            if (ship !== undefined) {
                const {leftx, lefty, rightx, righty, radius} = ship.movementArc;
                markers.push({type: "path", path: `M${leftx},${lefty} A${radius} ${radius} 0 0 1 ${rightx},${righty}`, fillOpacity: 0, strokeOpacity: 0.25});
                for (const arc of ship.firingArcs) {
                    let path = "";
                    for (const pt of arc) {
                        if (path.length === 0) {
                            path += `M${pt.x},${pt.y}`;
                        } else {
                            path += `L${pt.x},${pt.y}`;
                        }
                    }
                    markers.push({type: "path", path, fillOpacity: 0, strokeOpacity: 0.25});
                }
            }
        }
        const d1: any[] = [];
        const d2: any[] = [];
        for (const ship of this.ships) {
            if ( (ship.dmg > 0) && (! ship.sunk) ) {
                if (ship.dmg === 1) {
                    d1.push(ship.centroid);
                } else if (ship.dmg === 2) {
                    d2.push(ship.centroid);
                }
            }
        }
        if (d1.length > 0) {
            annotations.push({type: "glyph", glyph: "D1", points: d1});
        }
        if (d2.length > 0) {
            annotations.push({type: "glyph", glyph: "D2", points: d2});
        }
        for (const r of this.results) {
            if (r.type === "damage") {
                const myName = r.where!;
                const theirName = r.who!;
                const myShip = this.ships.find(s => s.id === myName);
                if (myShip === undefined) {
                    throw new Error(`Trying to render attack annotation but cannot find a ship named ${myName}`);
                }
                let theirShip = this.ships.find(s => s.id === theirName);
                if (theirShip === undefined) {
                    // if the ship was sunk, we should find it in ghosts
                    theirShip = this.ghosts.find(s => s.id === theirName);
                    if (theirShip === undefined) {
                        throw new Error(`Trying to render attack annotation but cannot find a ship named ${theirName}`);
                    }
                }
                // const bearing = calcBearing(myShip.cx, myShip.cy, theirShip.cx, theirShip.cy);
                // const distance = ptDistance(myShip.cx, myShip.cy, theirShip.cx, theirShip.cy)
                const width = 3;
                // const base = width * 2;
                // const height = distance / 10;
                // const sidelen = Math.sqrt(height**2 + (base / 2)**2);
                // const ptLeft = projectPoint(theirShip.cx, theirShip.cy, sidelen, bearing - 165);
                // const ptRight = projectPoint(theirShip.cx, theirShip.cy, sidelen, bearing + 165);
                annotations.push({type: "path", stroke: myShip.owner, strokeWidth: width, dashed: [4], path: `M${myShip.cx},${myShip.cy} L${theirShip.cx},${theirShip.cy}`});
            }
        }

        if (this.phase === "place") {
            // place markers delineating starting areas
            for (let p = 1; p <= this.numplayers; p++) {
                const [tl, br] = ArmadasGame.getStartingArea(this.boardsize, p as playerid);
                markers.push({
                    type: "path",
                    stroke: p,
                    fillOpacity: 0,
                    dashed: [4],
                    path: `M${tl.x},${tl.y} L${br.x},${tl.y} L${br.x},${br.y} L${tl.x},${br.y} Z`,
                });
            }
        }
        for (const ghost of this.ghosts) {
            markers.push({
                type: "glyph",
                glyph: `ghost${cs[ghost.owner - 1]}${ghost.size}`,
                orientation: ghost.facing,
                points: [{x: ghost.cx, y: ghost.cy}]
            });
        }
        for (const ob of this.obstacles) {
            markers.push({
                type: "path",
                path: ob.svgPath,
                stroke: "#000",
                fill: "#000",
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            // @ts-ignore
            renderer: "freespace",
            // @ts-ignore
            board: {
                width: this.boardsize * ArmadasGame.BOARD_UNIT_DIMENSIONS,
                height: this.boardsize * ArmadasGame.BOARD_UNIT_DIMENSIONS,
                backFill: "#eee",
            },
            legend: myLegend,
            // @ts-ignore
            pieces,
        };
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }
        if (markers.length > 0) {
            // @ts-ignore
            rep.board.markers = markers;
        }
        if (this.phase === "place") {
            // add white pyramids for size selection
            myLegend.click1 = {
                name: "pyramid-flat-small",
                colour: "#aaa"
            };
            myLegend.click2 = {
                name: "pyramid-flat-medium",
                colour: "#aaa"
            };
            myLegend.click3 = {
                name: "pyramid-flat-large",
                colour: "#aaa"
            };

            // Add key so the user can click to select a size
            const key: IKey = {
                type: "key",
                position: "left",
                height: 0.7,
                list: [{ piece: "click1", name: "", value: "1"}, { piece: "click2", name: "", value: "2"}, { piece: "click3", name: "", value: "3"}],
                clickable: true
            };
            rep.areas = [key];
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.armadas", {player, name: r.what}));
                resolved = true;
                break;
            case "damage":
                node.push(i18next.t("apresults:DAMAGE.armadas", {player, myName: r.where, theirName: r.who}));
                resolved = true;
                break;
            case "destroy":
                node.push(i18next.t("apresults:DESTROY.armadas", {player, name: r.what}));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.armadas", {player, name: r.where, context: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ArmadasGame {
        // Have to use Object.assign to track internal variables (like showArcs) that are not part of the persistent state
        // return Object.assign(new ArmadasGame(this.numplayers), deepclone(this) as ArmadasGame);
        return new ArmadasGame(this.serialize());
    }
}
