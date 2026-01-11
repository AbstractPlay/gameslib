import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, MarkerFlood } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1 | 2;
export type HexDir = "NE" | "E" | "SE" | "SW" | "W" | "NW";

// A plane has owner, direction, and height
export type PlaneInfo = [playerid, HexDir, number];

const allDirections: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];

// Map direction to rotation angle for rendering
const dirToRotation: Map<HexDir, number> = new Map([
    ["NE", -60],
    ["E", 0],
    ["SE", 60],
    ["SW", 120],
    ["W", 180],
    ["NW", -120],
]);

// Get the adjacent directions (60 degrees to either side)
const adjacentDirs = (dir: HexDir): [HexDir, HexDir] => {
    const idx = allDirections.indexOf(dir);
    const left = allDirections[(idx + 5) % 6];
    const right = allDirections[(idx + 1) % 6];
    return [left, right];
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, PlaneInfo>;
    clouds: Set<string>;
    planesRemaining: [number, number]; // planes not yet on board
    turnNumber: number;
    lastmove?: string;
}

export interface ICrosshairsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class CrosshairsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Crosshairs",
        uid: "crosshairs",
        playercounts: [2],
        version: "20250110",
        dateAdded: "2025-01-10",
        // i18next.t("apgames:descriptions.crosshairs")
        description: "apgames:descriptions.crosshairs",
        urls: [
            "https://nestorgames.com/#crosshairs_detail",
            "https://boardgamegeek.com/boardgame/102395/crosshairs",
        ],
        people: [
            {
                type: "designer",
                name: "Stephen Tavener",
                urls: [],
            },
            {
                type: "coder",
                name: "Claude (AI Assistant)",
                urls: [],
            },
        ],
        categories: ["goal>annihilate", "mechanic>move", "mechanic>capture", "mechanic>block", "board>shape>hex", "board>connect>hex", "components>special"],
        flags: ["perspective", "custom-colours"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, PlaneInfo>;
    public clouds!: Set<string>;
    public planesRemaining!: [number, number];
    public turnNumber!: number;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private boardSize = 6; // 6 hexes per side
    public graph: HexTriGraph;

    constructor(state?: ICrosshairsState | string, variants?: string[]) {
        super();
        this.graph = new HexTriGraph(6, 11);
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: CrosshairsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                clouds: new Set(),
                planesRemaining: [5, 5],
                turnNumber: 0,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICrosshairsState;
            }
            if (state.game !== CrosshairsGame.gameinfo.uid) {
                throw new Error(`The Crosshairs engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CrosshairsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, PlaneInfo>;
        this.clouds = new Set(state.clouds);
        this.planesRemaining = [...state.planesRemaining];
        this.turnNumber = state.turnNumber;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    // Get cells on the edge for a player's starting area
    private getStartingHexes(player: playerid): string[] {
        const edges = this.graph.getEdges();
        // Player 1 starts on South edge, Player 2 on North edge
        if (player === 1) {
            return edges.get("S")!;
        } else {
            return edges.get("N")!;
        }
    }

    // Check if we're in cloud placement phase
    private inCloudPhase(): boolean {
        return this.clouds.size < 16;
    }

    // Check if we're in entry phase (first few turns after clouds)
    private inEntryPhase(): boolean {
        if (this.inCloudPhase()) return false;
        // Entry phase: turns 1-4 after cloud placement
        return this.turnNumber < 5;
    }

    // Get number of planes to move/enter this turn
    private getPlanesToMove(): number {
        if (this.inCloudPhase()) return 0;
        if (this.inEntryPhase()) {
            return Math.min(this.turnNumber, 5);
        }
        return 5;
    }

    // Count planes on board for a player
    private countPlanesOnBoard(player: playerid): number {
        let count = 0;
        for (const [, info] of this.board) {
            if (info[0] === player) count++;
        }
        return count;
    }

    // Get ray of cells in a direction from a position, stopping at board edge
    private getRay(x: number, y: number, dir: HexDir): string[] {
        const ray = this.graph.ray(x, y, dir);
        return ray.map(([rx, ry]) => this.graph.coords2algebraic(rx, ry));
    }

    // Get line of fire from a plane (cells it can shoot)
    private getLineOfFire(cell: string, dir: HexDir): string[] {
        const [x, y] = this.graph.algebraic2coords(cell);
        const ray = this.getRay(x, y, dir);
        const result: string[] = [];
        for (const target of ray) {
            // Can't shoot through clouds
            if (this.clouds.has(target)) break;
            // Can't shoot through other planes
            if (this.board.has(target)) {
                result.push(target);
                break;
            }
            result.push(target);
        }
        return result;
    }

    // Check if a cell is in crosshairs (can be shot down)
    private isInCrosshairs(cell: string, shooter: playerid): boolean {
        // Count how many enemy planes have this cell in their line of fire
        let count = 0;
        for (const [planeCell, info] of this.board) {
            if (info[0] === shooter) {
                const lof = this.getLineOfFire(planeCell, info[1]);
                if (lof.includes(cell)) {
                    count++;
                    if (count >= 2) return true;
                }
            }
        }
        return false;
    }

    // Perform shooting (returns cells of shot down planes)
    private performShooting(shooter: playerid): string[] {
        const shotDown: string[] = [];
        let found = true;
        while (found) {
            found = false;
            for (const [cell, info] of this.board) {
                if (info[0] !== shooter && this.isInCrosshairs(cell, shooter)) {
                    shotDown.push(cell);
                    this.board.delete(cell);
                    found = true;
                    break; // Re-check after each removal
                }
            }
        }
        return shotDown;
    }

    // Check if a cell is blocked (by plane or off-board)
    private isBlocked(cell: string): boolean {
        return this.board.has(cell);
    }

    // Check if a plane can move forward
    private canMoveForward(cell: string, dir: HexDir): boolean {
        const [x, y] = this.graph.algebraic2coords(cell);
        const next = this.graph.move(x, y, dir);
        if (next === undefined) return false;
        const nextCell = this.graph.coords2algebraic(...next);
        return !this.isBlocked(nextCell);
    }

    // Get cell after moving forward
    private moveForward(cell: string, dir: HexDir): string | undefined {
        const [x, y] = this.graph.algebraic2coords(cell);
        const next = this.graph.move(x, y, dir);
        if (next === undefined) return undefined;
        const nextCell = this.graph.coords2algebraic(...next);
        if (this.isBlocked(nextCell)) return undefined;
        return nextCell;
    }

    // Parse a partial move string to get the cells of planes that have already moved
    private getMovedPlanesFromPartial(partialMove: string): Set<string> {
        const moved = new Set<string>();
        if (!partialMove || partialMove.length === 0) return moved;

        const parts = partialMove.split(",");
        for (const part of parts) {
            const trimmed = part.trim().toLowerCase();
            if (trimmed.startsWith("enter:")) {
                // Entry moves don't count as "moved planes" - they're new planes
                continue;
            }
            // Extract the starting cell from move formats:
            // climb: "a1+b2" or "a1+b2/NE"
            // level: "a1-b2" or "a1-b2/NE"
            // dive: "a1va2,P/NW"
            // crash: "a1X"
            let fromCell: string | undefined;
            if (trimmed.includes("+")) {
                fromCell = trimmed.split("+")[0];
            } else if (trimmed.includes("v")) {
                fromCell = trimmed.split("v")[0];
            } else if (trimmed.endsWith("x")) {
                fromCell = trimmed.slice(0, -1);
            } else if (trimmed.includes("-")) {
                fromCell = trimmed.split("-")[0];
            }
            if (fromCell) {
                moved.add(fromCell);
            }
        }
        return moved;
    }

    // Get the number of planes/actions required this turn
    private getRequiredActions(): number {
        if (this.inCloudPhase()) return 1; // One cloud at a time
        if (this.inEntryPhase()) {
            return Math.min(this.turnNumber, 5);
        }
        // Main game: move all planes on board
        return this.countPlanesOnBoard(this.currplayer);
    }

    // Generate all possible moves for a single plane
    private getPlaneMovements(cell: string, info: PlaneInfo): string[] {
        const [, dir, height] = info;
        const moves: string[] = [];

        // (a) Climb: +1 height, move 1 forward, optional 60° turn
        if (height < 6) {
            const forward = this.moveForward(cell, dir);
            if (forward !== undefined) {
                // Can keep direction or turn 60° either way
                moves.push(`${cell}+${forward}`); // climb, keep direction
                const [left, right] = adjacentDirs(dir);
                moves.push(`${cell}+${forward}/${left}`);
                moves.push(`${cell}+${forward}/${right}`);
            }
        }

        // (b) Level flight: move 1 or 2 forward, optional 60° turn
        const forward1 = this.moveForward(cell, dir);
        if (forward1 !== undefined) {
            moves.push(`${cell}-${forward1}`);
            const [left1, right1] = adjacentDirs(dir);
            moves.push(`${cell}-${forward1}/${left1}`);
            moves.push(`${cell}-${forward1}/${right1}`);

            // Can move 2 spaces
            const forward2 = this.moveForward(forward1, dir);
            if (forward2 !== undefined) {
                moves.push(`${cell}-${forward2}`);
                const [left2, right2] = adjacentDirs(dir);
                moves.push(`${cell}-${forward2}/${left2}`);
                moves.push(`${cell}-${forward2}/${right2}`);
            }
        }

        // (c) Dive: series of swoops and power dives
        // This is complex - we generate all possible dive sequences
        const diveSequences = this.generateDiveSequences(cell, height, dir);
        for (const seq of diveSequences) {
            moves.push(`${cell}v${seq}`);
        }

        // (d) Crash: if cannot move forward and at height 0 or 1 (can't power dive)
        if (!this.canMoveForward(cell, dir) && height <= 1) {
            moves.push(`${cell}X`); // crash
        }

        return moves;
    }

    // Generate all possible dive sequences from a position
    private generateDiveSequences(cell: string, height: number, dir: HexDir): string[] {
        if (height === 0) return [];

        const sequences: string[] = [];

        // Helper to generate sequences recursively
        const generate = (currentCell: string, currentHeight: number, currentDir: HexDir, path: string) => {
            // A dive must lose height, so we must do at least one maneuver
            if (path !== "") {
                // Add current state as a valid sequence (can stop diving at any point)
                sequences.push(path);
            }

            // Try swoop: -1 height, move forward, optional turn
            if (currentHeight >= 1) {
                const forward = this.moveForward(currentCell, currentDir);
                if (forward !== undefined) {
                    const newHeight = currentHeight - 1;
                    // Keep direction
                    const newPath = path === "" ? `${forward}` : `${path},${forward}`;
                    generate(forward, newHeight, currentDir, newPath);
                    // Turn left or right
                    const [left, right] = adjacentDirs(currentDir);
                    generate(forward, newHeight, left, path === "" ? `${forward}/${left}` : `${path},${forward}/${left}`);
                    generate(forward, newHeight, right, path === "" ? `${forward}/${right}` : `${path},${forward}/${right}`);
                }
            }

            // Try power dive: -2 height, no movement, optional turn
            if (currentHeight >= 2) {
                const newHeight = currentHeight - 2;
                // Keep direction
                generate(currentCell, newHeight, currentDir, path === "" ? `P` : `${path},P`);
                // Turn
                const [left, right] = adjacentDirs(currentDir);
                generate(currentCell, newHeight, left, path === "" ? `P/${left}` : `${path},P/${left}`);
                generate(currentCell, newHeight, right, path === "" ? `P/${right}` : `${path},P/${right}`);
            }
        };

        generate(cell, height, dir, "");
        return sequences;
    }

    // Parse a move string and return the action details
    private parseMove(move: string): {
        type: "cloud" | "enter" | "move" | "shoot";
        cell?: string;
        target?: string;
        dir?: HexDir;
        moveType?: "climb" | "level" | "dive" | "crash";
        diveSequence?: string;
    } {
        move = move.trim().toLowerCase();

        // Cloud placement: "cloud:a1"
        if (move.startsWith("cloud:")) {
            return { type: "cloud", cell: move.slice(6) };
        }

        // Enter: "enter:a1/NE" (place new plane on edge)
        if (move.startsWith("enter:")) {
            const parts = move.slice(6).split("/");
            return { type: "enter", cell: parts[0], dir: parts[1].toUpperCase() as HexDir };
        }

        // Shoot command: "shoot"
        if (move === "shoot") {
            return { type: "shoot" };
        }

        // Movement:
        // Climb: "a1+b2" or "a1+b2/NE"
        // Level: "a1-b2" or "a1-b2/NE"
        // Dive: "a1va2,a3,P/NW" (sequence of swoops and power dives)
        // Crash: "a1X"

        if (move.includes("+")) {
            const parts = move.split("+");
            const targetParts = parts[1].split("/");
            return {
                type: "move",
                cell: parts[0],
                target: targetParts[0],
                dir: targetParts[1]?.toUpperCase() as HexDir | undefined,
                moveType: "climb",
            };
        }

        if (move.includes("v")) {
            const parts = move.split("v");
            return {
                type: "move",
                cell: parts[0],
                diveSequence: parts[1],
                moveType: "dive",
            };
        }

        if (move.endsWith("x")) {
            return {
                type: "move",
                cell: move.slice(0, -1),
                moveType: "crash",
            };
        }

        // Level flight
        const parts = move.split("-");
        if (parts.length === 2) {
            const targetParts = parts[1].split("/");
            return {
                type: "move",
                cell: parts[0],
                target: targetParts[0],
                dir: targetParts[1]?.toUpperCase() as HexDir | undefined,
                moveType: "level",
            };
        }

        throw new Error(`Cannot parse move: ${move}`);
    }

    // Get moves for the next action in a turn, given what's already been done
    public moves(player?: playerid, partialMove?: string): string[] {
        if (this.gameover) return [];
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // Cloud placement phase - players alternate placing clouds until all 16 are placed
        if (this.inCloudPhase()) {
            // Can place clouds on any empty cell, but not adjacent to existing clouds
            // (can't make clouds bigger than 2 hexes)
            for (const cell of this.graph.listCells() as string[]) {
                if (this.clouds.has(cell)) continue;

                // Check cloud adjacency constraint
                let adjacentCloudCount = 0;
                const [x, y] = this.graph.algebraic2coords(cell);
                for (const dir of allDirections) {
                    const next = this.graph.move(x, y, dir);
                    if (next !== undefined) {
                        const nextCell = this.graph.coords2algebraic(...next);
                        if (this.clouds.has(nextCell)) {
                            adjacentCloudCount++;
                        }
                    }
                }
                // Can only place if no adjacent clouds or exactly one (making a 2-hex cloud)
                if (adjacentCloudCount <= 1) {
                    moves.push(`cloud:${cell}`);
                }
            }
            return moves;
        }

        // Apply partial move to a cloned state to see current board position
        let workingBoard = this.board;
        let workingPlanesRemaining = this.planesRemaining;
        const movedPlanes = this.getMovedPlanesFromPartial(partialMove || "");
        let enteredCount = 0;

        if (partialMove && partialMove.length > 0) {
            // Clone and apply partial moves to get current state
            const clone = this.clone();
            const parts = partialMove.split(",");
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.length > 0) {
                    try {
                        clone.applyPartialAction(trimmed);
                        if (trimmed.toLowerCase().startsWith("enter:")) {
                            enteredCount++;
                        }
                    } catch {
                        // Invalid partial, ignore
                    }
                }
            }
            workingBoard = clone.board;
            workingPlanesRemaining = clone.planesRemaining;
        }

        // Entry phase: entering new planes
        const planesOnBoard = this.countPlanesOnBoardFrom(workingBoard, player);
        const requiredPlanes = this.getPlanesToMove();

        if (workingPlanesRemaining[player - 1] > 0 && planesOnBoard < requiredPlanes) {
            const startingHexes = this.getStartingHexes(player);
            for (const cell of startingHexes) {
                if (!workingBoard.has(cell) && !this.clouds.has(cell)) {
                    for (const dir of allDirections) {
                        moves.push(`enter:${cell}/${dir}`);
                    }
                }
            }
        }

        // Moving existing planes (only those not yet moved this turn)
        const planes = this.getPlayerPlanesFrom(workingBoard, player);
        for (const [cell, info] of planes) {
            // Skip planes that have already moved this turn
            if (movedPlanes.has(cell)) continue;

            const planeMoves = this.getPlaneMovements(cell, info);
            moves.push(...planeMoves);
        }

        return moves;
    }

    // Helper to count planes from a specific board state
    private countPlanesOnBoardFrom(board: Map<string, PlaneInfo>, player: playerid): number {
        let count = 0;
        for (const [, info] of board) {
            if (info[0] === player) count++;
        }
        return count;
    }

    // Helper to get planes from a specific board state
    private getPlayerPlanesFrom(board: Map<string, PlaneInfo>, player: playerid): Map<string, PlaneInfo> {
        const planes = new Map<string, PlaneInfo>();
        for (const [cell, info] of board) {
            if (info[0] === player) {
                planes.set(cell, info);
            }
        }
        return planes;
    }

    // Apply a single action without completing the turn (for partial move processing)
    private applyPartialAction(action: string): void {
        const parsed = this.parseMove(action);

        if (parsed.type === "enter") {
            const cell = parsed.cell!;
            const dir = parsed.dir!;
            this.board.set(cell, [this.currplayer, dir, 0]);
            this.planesRemaining[this.currplayer - 1]--;
        } else if (parsed.type === "move") {
            const fromCell = parsed.cell!;
            const info = this.board.get(fromCell);
            if (!info) return;

            const [owner, currentDir, currentHeight] = info;

            if (parsed.moveType === "crash") {
                this.board.delete(fromCell);
            } else if (parsed.moveType === "climb") {
                const toCell = parsed.target!;
                const newDir = parsed.dir || currentDir;
                const newHeight = Math.min(currentHeight + 1, 6);
                this.board.delete(fromCell);
                this.board.set(toCell, [owner, newDir, newHeight]);
            } else if (parsed.moveType === "level") {
                const toCell = parsed.target!;
                const newDir = parsed.dir || currentDir;
                this.board.delete(fromCell);
                this.board.set(toCell, [owner, newDir, currentHeight]);
            } else if (parsed.moveType === "dive") {
                const sequence = parsed.diveSequence!;
                const steps = sequence.split(",");
                let currentCell = fromCell;
                let height = currentHeight;
                let dir = currentDir;

                for (const step of steps) {
                    if (step.toLowerCase().startsWith("p")) {
                        height -= 2;
                        if (step.includes("/")) {
                            dir = step.split("/")[1].toUpperCase() as HexDir;
                        }
                    } else {
                        const parts = step.split("/");
                        const nextCell = parts[0];
                        if (parts[1]) {
                            dir = parts[1].toUpperCase() as HexDir;
                        }
                        height--;
                        currentCell = nextCell;
                    }
                }

                this.board.delete(fromCell);
                this.board.set(currentCell, [owner, dir, height]);
            }
        }
    }

    public randomMove(): string {
        if (this.inCloudPhase()) {
            const moves = this.moves();
            return moves[Math.floor(Math.random() * moves.length)];
        }

        // Build a complete turn with all required actions
        const actions: string[] = [];
        let partialSoFar = "";
        const requiredActions = this.getRequiredActions();

        for (let i = 0; i < requiredActions; i++) {
            const availableMoves = this.moves(this.currplayer, partialSoFar);
            if (availableMoves.length === 0) break;
            const chosen = availableMoves[Math.floor(Math.random() * availableMoves.length)];
            actions.push(chosen);
            partialSoFar = actions.join(",");
        }

        return actions.join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";

            if (this.inCloudPhase()) {
                newmove = `cloud:${cell}`;
            } else if (move === "") {
                // Starting a new move
                if (this.board.has(cell)) {
                    const info = this.board.get(cell)!;
                    if (info[0] === this.currplayer) {
                        newmove = cell;
                    }
                } else if (!this.clouds.has(cell)) {
                    // Could be entering a plane
                    const startingHexes = this.getStartingHexes(this.currplayer);
                    if (startingHexes.includes(cell) && this.planesRemaining[this.currplayer - 1] > 0) {
                        newmove = `enter:${cell}/`;
                    }
                }
            } else {
                // Continuing a move
                if (move.startsWith("enter:")) {
                    // Need to select direction
                    const startCell = move.split(":")[1].split("/")[0];
                    const dir = this.graph.bearing(startCell, cell);
                    if (dir !== undefined) {
                        newmove = `enter:${startCell}/${dir}`;
                    } else {
                        newmove = move;
                    }
                } else if (!move.includes("-") && !move.includes("+") && !move.includes("v")) {
                    // Selected a plane, now selecting destination
                    const fromCell = move;
                    if (cell !== fromCell) {
                        // Try to determine move type based on destination
                        const info = this.board.get(fromCell);
                        if (info !== undefined) {
                            const [, dir] = info;
                            const [fx, fy] = this.graph.algebraic2coords(fromCell);

                            // Check if it's a valid forward movement
                            const bearing = this.graph.bearing(fromCell, cell);
                            if (bearing === dir) {
                                // Moving forward - could be climb, level, or dive
                                const dist = this.graph.ray(fx, fy, dir).findIndex(([rx, ry]) =>
                                    this.graph.coords2algebraic(rx, ry) === cell) + 1;

                                if (dist === 1) {
                                    newmove = `${fromCell}-${cell}`;
                                } else if (dist === 2) {
                                    newmove = `${fromCell}-${cell}`;
                                }
                            }
                        }
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        if (m.length === 0) {
            if (this.inCloudPhase()) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.crosshairs.PLACE_CLOUD");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.crosshairs.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase().replace(/\s+/g, "");

        // Cloud phase: single action per turn
        if (this.inCloudPhase()) {
            const validMoves = this.moves();
            if (validMoves.map(v => v.toLowerCase()).includes(m)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }

        // Split into individual actions
        const actions = m.split(",").filter(a => a.length > 0);

        // Validate each action in sequence
        let partialSoFar = "";
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const validNextMoves = this.moves(this.currplayer, partialSoFar);

            // Check if this action matches any valid move
            const matchingMoves = validNextMoves.filter(vm =>
                vm.toLowerCase() === action || vm.toLowerCase().startsWith(action)
            );

            if (matchingMoves.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: action });
                return result;
            }

            // Check if it's a complete single action
            const exactMatch = validNextMoves.map(v => v.toLowerCase()).includes(action);
            if (!exactMatch) {
                // Partial action (e.g., just selected a plane)
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.crosshairs.PARTIAL_PLANE_MOVE");
                return result;
            }

            partialSoFar = partialSoFar ? `${partialSoFar},${action}` : action;
        }

        // All actions validated - check if turn is complete
        const completedActions = actions.length;
        const requiredActions = this.getRequiredActionsForValidation(partialSoFar);

        if (completedActions < requiredActions) {
            // Need more actions
            const remaining = requiredActions - completedActions;
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.crosshairs.NEED_MORE_PLANES", { count: remaining });
            return result;
        }

        // Turn is complete
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // Get required actions accounting for crashed planes and entries
    private getRequiredActionsForValidation(partialMove: string): number {
        if (this.inCloudPhase()) return 1;

        // Clone and apply partial moves to count what's needed
        const clone = this.clone();
        const parts = partialMove.split(",").filter(p => p.length > 0);
        let entries = 0;
        let crashes = 0;

        for (const part of parts) {
            try {
                clone.applyPartialAction(part);
                if (part.toLowerCase().startsWith("enter:")) {
                    entries++;
                }
                if (part.toLowerCase().endsWith("x")) {
                    crashes++;
                }
            } catch {
                // Ignore invalid
            }
        }

        if (this.inEntryPhase()) {
            // Need to enter specific number of planes
            return Math.min(this.turnNumber, 5);
        }

        // Main game: move all planes that were on board at start of turn
        // (crashed planes still count as "moved")
        return this.countPlanesOnBoard(this.currplayer);
    }

    // Process a single action (enter or plane move) and record results
    private processSingleAction(action: string): void {
        const parsed = this.parseMove(action);

        if (parsed.type === "enter") {
            const cell = parsed.cell!;
            const dir = parsed.dir!;
            this.board.set(cell, [this.currplayer, dir, 0]);
            this.planesRemaining[this.currplayer - 1]--;
            this.results.push({ type: "place", what: "plane", where: cell });
            this.results.push({ type: "orient", where: cell, facing: dir });
        } else if (parsed.type === "move") {
            const fromCell = parsed.cell!;
            const info = this.board.get(fromCell);
            if (!info) return;

            const [owner, currentDir, currentHeight] = info;

            if (parsed.moveType === "crash") {
                this.board.delete(fromCell);
                this.results.push({ type: "destroy", what: "plane", where: fromCell });
            } else if (parsed.moveType === "climb") {
                const toCell = parsed.target!;
                const newDir = parsed.dir || currentDir;
                const newHeight = Math.min(currentHeight + 1, 6);
                this.board.delete(fromCell);
                this.board.set(toCell, [owner, newDir, newHeight]);
                this.results.push({ type: "move", from: fromCell, to: toCell, what: "plane" });
                if (newDir !== currentDir) {
                    this.results.push({ type: "orient", where: toCell, facing: newDir });
                }
            } else if (parsed.moveType === "level") {
                const toCell = parsed.target!;
                const newDir = parsed.dir || currentDir;
                this.board.delete(fromCell);
                this.board.set(toCell, [owner, newDir, currentHeight]);
                this.results.push({ type: "move", from: fromCell, to: toCell, what: "plane" });
                if (newDir !== currentDir) {
                    this.results.push({ type: "orient", where: toCell, facing: newDir });
                }
            } else if (parsed.moveType === "dive") {
                const sequence = parsed.diveSequence!;
                const steps = sequence.split(",");
                let currentCell = fromCell;
                let height = currentHeight;
                let dir = currentDir;

                for (const step of steps) {
                    if (step.toLowerCase().startsWith("p")) {
                        height -= 2;
                        if (step.includes("/")) {
                            dir = step.split("/")[1].toUpperCase() as HexDir;
                        }
                        this.results.push({ type: "move", from: currentCell, to: currentCell, what: "plane", how: "power-dive" });
                    } else {
                        const parts = step.split("/");
                        const nextCell = parts[0];
                        if (parts[1]) {
                            dir = parts[1].toUpperCase() as HexDir;
                        }
                        height--;
                        this.results.push({ type: "move", from: currentCell, to: nextCell, what: "plane", how: "swoop" });
                        currentCell = nextCell;
                    }
                }

                this.board.delete(fromCell);
                this.board.set(currentCell, [owner, dir, height]);
            }
        }
    }

    public move(m: string, { partial = false, trusted = false } = {}): CrosshairsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // For partial moves, just apply and return
            if (result.complete !== 1) {
                partial = true;
            }
        }

        this.results = [];

        // Cloud phase: single action
        if (this.inCloudPhase()) {
            const parsed = this.parseMove(m);
            if (parsed.type === "cloud") {
                this.clouds.add(parsed.cell!);
                this.results.push({ type: "place", what: "cloud", where: parsed.cell });
            }
        } else {
            // Non-cloud phase: process comma-separated actions
            const actions = m.split(",").filter(a => a.length > 0);

            for (const action of actions) {
                this.processSingleAction(action);
            }

            // After all moves, perform automatic shooting
            if (!partial) {
                const shotDown = this.performShooting(this.currplayer);
                for (const cell of shotDown) {
                    this.results.push({ type: "capture", where: cell, what: "plane" });
                }
            }
        }

        if (partial) return this;

        // Update turn number and switch players
        this.lastmove = m;

        // After cloud phase ends (16 clouds placed), set turn number to 1
        const justEndedCloudPhase = this.clouds.size === 16 && this.turnNumber === 0;
        if (justEndedCloudPhase) {
            this.turnNumber = 1;
        }

        // In non-cloud phases, increment turn number after each player's turn
        // (Turn 1: P1 moves 1, Turn 2: P2 moves 2, Turn 3: P1 moves 3, etc.)
        // Don't increment on the move that just ended cloud phase
        if (!this.inCloudPhase() && this.turnNumber > 0 && !justEndedCloudPhase) {
            this.turnNumber++;
        }

        // Switch players
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CrosshairsGame {
        // A player is eliminated if reduced to 1 plane (can no longer shoot anyone)
        for (const player of [1, 2] as playerid[]) {
            const planeCount = this.countPlanesOnBoard(player);
            const remaining = this.planesRemaining[player - 1];
            if (planeCount + remaining <= 1 && !this.inCloudPhase() && !this.inEntryPhase()) {
                this.gameover = true;
                this.winner = [player === 1 ? 2 : 1];
                this.results.push({ type: "eog" });
                this.results.push({ type: "winners", players: [...this.winner] });
                break;
            }
        }
        return this;
    }

    public state(): ICrosshairsState {
        return {
            game: CrosshairsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CrosshairsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, PlaneInfo>,
            clouds: new Set(this.clouds),
            planesRemaining: [...this.planesRemaining],
            turnNumber: this.turnNumber,
        };
    }

    public render(): APRenderRep {
        // Build legend for planes with altitude indicators
        const myLegend: { [key: string]: Glyph | [Glyph, ...Glyph[]] } = {};

        // Altitude wedge positions (starting at noon, going clockwise)
        // These are offsets from hex center for small triangles
        const wedgePositions = [
            { dx: 0, dy: -35, rotate: 180 },      // 0: noon (top)
            { dx: 30, dy: -17, rotate: -120 },    // 1: upper-right
            { dx: 30, dy: 17, rotate: -60 },      // 2: lower-right
            { dx: 0, dy: 35, rotate: 0 },         // 3: bottom
            { dx: -30, dy: 17, rotate: 60 },      // 4: lower-left
            { dx: -30, dy: -17, rotate: 120 },    // 5: upper-left
        ];

        const altitudeColor = "#87CEEB"; // Light blue

        // Create plane glyphs for each direction, player, and height combination
        for (const player of [1, 2]) {
            for (const dir of allDirections) {
                const rotation = dirToRotation.get(dir)!;

                // Height 0 - just the plane
                myLegend[`P${player}${dir}_0`] = {
                    name: "plane",
                    colour: player,
                    rotate: rotation,
                };

                // Heights 1-6 - plane with altitude wedges
                for (let height = 1; height <= 6; height++) {
                    const glyphs: Glyph[] = [];

                    // Add altitude wedges first (so they're behind the plane)
                    for (let w = 0; w < height; w++) {
                        const pos = wedgePositions[w];
                        glyphs.push({
                            name: "piece-triangle",
                            colour: altitudeColor,
                            scale: 0.25,
                            rotate: pos.rotate,
                            nudge: { dx: pos.dx, dy: pos.dy },
                        });
                    }

                    // Add the plane on top
                    glyphs.push({
                        name: "plane",
                        colour: player,
                        rotate: rotation,
                    });

                    myLegend[`P${player}${dir}_${height}`] = glyphs as [Glyph, ...Glyph[]];
                }
            }
        }

        // Cloud glyph
        myLegend["cloud"] = {
            name: "piece",
            colour: "#ffffff",
            opacity: 0.7,
        };

        // Build piece string
        const cells = this.graph.listCells(true) as string[][];
        let pstr = "";
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [owner, dir, height] = this.board.get(cell)!;
                    pieces.push(`P${owner}${dir}_${height}`);
                } else if (this.clouds.has(cell)) {
                    pieces.push("cloud");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build flood markers for clouds
        const markers: MarkerFlood[] = [];
        for (const cell of this.clouds) {
            const [x, y] = this.graph.algebraic2coords(cell);
            markers.push({
                type: "flood",
                colour: "#cccccc",
                opacity: 0.5,
                points: [{ row: y, col: x }],
            });
        }

        const rep: APRenderRep = {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                markers: markers.length > 0 ? markers : undefined,
            },
            legend: myLegend,
            pieces: pstr,
        };

        // Add annotations for last move
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const result of this.results) {
                if (result.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(result.from);
                    const [toX, toY] = this.graph.algebraic2coords(result.to);
                    if (result.from !== result.to) {
                        rep.annotations.push({
                            type: "move",
                            targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }],
                        });
                    }
                } else if (result.type === "capture") {
                    const [x, y] = this.graph.algebraic2coords(result.where!);
                    rep.annotations.push({
                        type: "exit",
                        targets: [{ row: y, col: x }],
                    });
                } else if (result.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(result.where!);
                    rep.annotations.push({
                        type: "enter",
                        targets: [{ row: y, col: x }],
                    });
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += `**Turn**: ${this.turnNumber}\n\n`;
        status += `**Planes on board**: P1: ${this.countPlanesOnBoard(1)}, P2: ${this.countPlanesOnBoard(2)}\n\n`;
        status += `**Planes remaining**: P1: ${this.planesRemaining[0]}, P2: ${this.planesRemaining[1]}\n\n`;

        if (this.inCloudPhase()) {
            status += "**Phase**: Cloud placement\n\n";
        } else if (this.inEntryPhase()) {
            status += "**Phase**: Entry phase\n\n";
        } else {
            status += "**Phase**: Main game\n\n";
        }

        return status;
    }

    public clone(): CrosshairsGame {
        return new CrosshairsGame(this.serialize());
    }
}
