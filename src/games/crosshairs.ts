import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1 | 2;

// User-facing directions for pointy-top hex display
export type HexDir = "N" | "NE" | "SE" | "S" | "SW" | "NW";

// Internal directions used by HexTriGraph (flat-top hex)
type InternalDir = "NE" | "E" | "SE" | "SW" | "W" | "NW";

// A plane has owner, direction, and height
export type PlaneInfo = [playerid, HexDir, number];

const allDirections: HexDir[] = ["N", "NE", "SE", "S", "SW", "NW"];

// Map user-facing direction to internal HexTriGraph direction
// The board is rendered with rotate: 90, so we need to translate:
// Visual N (up) → Internal W (was left, now up after 90° CW rotation)
const visualToInternal: Map<HexDir, InternalDir> = new Map([
    ["N", "W"],
    ["NE", "NW"],
    ["SE", "NE"],
    ["S", "E"],
    ["SW", "SE"],
    ["NW", "SW"],
]);

// Map internal direction back to user-facing direction
const internalToVisual: Map<InternalDir, HexDir> = new Map([
    ["W", "N"],
    ["NW", "NE"],
    ["NE", "SE"],
    ["E", "S"],
    ["SE", "SW"],
    ["SW", "NW"],
]);

// Map direction to rotation angle for rendering (pointy-top visual)
const dirToRotation: Map<HexDir, number> = new Map([
    ["N", -90],     // pointing up
    ["NE", -30],    // pointing up-right
    ["SE", 30],     // pointing down-right
    ["S", 90],      // pointing down
    ["SW", 150],    // pointing down-left
    ["NW", -150],   // pointing up-left
]);

// Click hint with optional shape information
type DotShape = "circle" | "ring" | "ring-large" | "chevron" | "explosion";
interface IClickHint {
    cell: string;
    shape?: DotShape;
    rotation?: number;
}

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

// State of a dive in progress, computed from a partial move string
interface IDiveState {
    fromCell: string;              // Where the dive started
    currentCell: string;           // Where the plane currently is
    currentDir: HexDir;            // Current facing direction
    currentHeight: number;         // Current altitude
    sequence: string;              // Dive sequence with shooting stripped
    origSequence: string;          // Original sequence (with shooting notation)
    waitingForDir: boolean;        // True if last step is partial (ends with "/")
}

// Discriminated union describing what state applyActions stopped in.
// Used by handleClick and getClickHints to avoid re-parsing lastAction strings.
type PartialState =
    | { type: "entry_direction"; entryCell: string }
    | { type: "move_direction"; fromCell: string; targetCell: string;
        moveType: "climb" | "level"; currentDir: HexDir }
    | { type: "plane_selected"; selectedCell: string; dir: HexDir; height: number }
    | { type: "dive_direction" }   // details in diveState
    | { type: "dive_step" }        // details in diveState
    | { type: "shooting" }         // last action was standalone shoot
    | { type: "next_action" }      // completed action, more needed
    | { type: "done" }             // all required actions complete

// Result of applying actions to a board (returned by applyActions)
interface IApplyResult {
    board: Map<string, PlaneInfo>;
    planesRemaining: [number, number];
    results: APMoveResult[];
    movedPlanes: Set<string>;
    completedActionCount: number;
    lastAction: string;
    diveState: IDiveState | null;
    isPartial: boolean;           // last action is incomplete
    error: string | null;         // validation error, or null
    shootablePlanes: string[];    // enemy planes in crosshairs on returned board
    partialState: PartialState;   // what state we stopped in
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
        version: "20260214",
        dateAdded: "2026-01-10",
        description: "apgames:descriptions.crosshairs",
        urls: [
            "http://mrraow.com/uploads/MyDesigns/Crosshairs2020.pdf",
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
                apid: "e5e9c762-f75f-4300-8aac-e623aed63409",
            },
        ],
        categories: ["goal>annihilate", "mechanic>move", "mechanic>capture", "mechanic>block", "board>shape>hex", "board>connect>hex", "components>special"],
        flags: ["no-moves", "custom-randomization", "experimental", "custom-rotation"],
        variants: [
            {
                uid: "random-start",
                group: "setup",
            },
        ],
        displays: [{uid: "abstract"}],
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
    private dots: IClickHint[] = []; // Cells to highlight for click hints
    public graph: HexTriGraph;

    constructor(state?: ICrosshairsState | string, variants?: string[]) {
        super();
        this.graph = new HexTriGraph(6, 11);
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const clouds = new Set<string>();
            let turnNumber = 0;

            // If random-start variant, place 8 pairs of symmetric clouds
            if (this.variants.includes("random-start")) {
                const placedClouds = this.placeRandomSymmetricClouds();
                for (const cell of placedClouds) {
                    clouds.add(cell);
                }
                turnNumber = 1; // Skip cloud phase
            }

            const fresh: IMoveState = {
                _version: CrosshairsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                clouds,
                planesRemaining: [6, 6],
                turnNumber,
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

    // Get the cell that is symmetric to the given cell across the board center
    private getSymmetricCell(cell: string): string {
        return this.graph.rot180(cell);
    }

    // Place 8 pairs of symmetric clouds for the random-start variant
    private placeRandomSymmetricClouds(): string[] {
        const cloudSet = new Set<string>();
        const untried = this.graph.listCells() as string[];

        // Keep picking random cells until we have 8 pairs
        while (cloudSet.size < 16) {
            // Pick a random cell we haven't tried yet
            if (untried.length === 0) throw new Error("Failed to place symmetric clouds - no valid cells left.");

            const cell = untried[Math.floor(Math.random() * untried.length)];
            // Remove from untried
            const index = untried.indexOf(cell);
            untried.splice(index, 1);

            const mirror = this.getSymmetricCell(cell);
            untried.splice(untried.indexOf(mirror), 1); // Remove mirror from untried too

            if (cell === mirror) continue; // Skip center cell

            // Check if this pair would create clouds > 2 hexes
            if (this.wouldCreateLargeCloud(cell, cloudSet)) continue;

            // Valid pair - add both
            cloudSet.add(cell);
            cloudSet.add(mirror);
        }

        return Array.from(cloudSet);
    }

    // Check if placing a cloud at cell would create a cloud group > 2 hexes
    private wouldCreateLargeCloud(cell: string, existingClouds: Set<string>): boolean {
        const [x, y] = this.graph.algebraic2coords(cell);
        let adjacentCloudCount = 0;

        for (const dir of allDirections) {
            const internalDir = visualToInternal.get(dir)!;
            const next = this.graph.move(x, y, internalDir);
            if (next !== undefined) {
                const nextCell = this.graph.coords2algebraic(...next);
                if (existingClouds.has(nextCell)) {
                    adjacentCloudCount++;
                    // Check if that adjacent cloud already has other cloud neighbors
                    const [ax, ay] = this.graph.algebraic2coords(nextCell);
                    for (const dir2 of allDirections) {
                        const internalDir2 = visualToInternal.get(dir2)!;
                        const next2 = this.graph.move(ax, ay, internalDir2);
                        if (next2 !== undefined) {
                            const nextCell2 = this.graph.coords2algebraic(...next2);
                            if (existingClouds.has(nextCell2) && nextCell2 !== cell) {
                                return true; // Would create 3+ hex cloud
                            }
                        }
                    }
                }
            }
        }

        // If adjacent to multiple clouds, would create 3+ hex cloud
        return adjacentCloudCount > 1;
    }

    // Split a move string by commas, but don't split inside parentheses.
    // Uses regex negative lookahead: ,(?![^(]*\)) means "comma not followed by
    // a closing paren without an opening paren in between" - i.e., commas inside
    // parentheses (like shoot targets "(d4,c4)") are preserved.
    private splitActions(move: string): string[] {
        return move.split(/,\s*(?![^(]*\))/).filter(a => a.length > 0);
    }

    // Extract shooting targets from an action string (e.g., "g6vf7(e5)>e6" -> ["e5"])
    private extractShootTargets(action: string): string[] {
        const targets: string[] = [];
        const matches = action.match(/\([^)]+\)/g);
        if (matches) {
            for (const match of matches) {
                targets.push(...match.slice(1, -1).split(",").map(s => s.trim().toLowerCase()));
            }
        }
        return targets;
    }

    // Remove shooting notation from an action string (e.g., "g6vf7(e5)>e6" -> "g6vf7>e6")
    private removeShootNotation(action: string): string {
        return action.replace(/\([^)]+\)/g, "");
    }

    // Check if a direction change is valid (same direction or ±60° turn)
    private isValidTurn(fromDir: HexDir, toDir: HexDir): boolean {
        if (fromDir === toDir) return true;
        const [leftDir, rightDir] = adjacentDirs(fromDir);
        return toDir === leftDir || toDir === rightDir;
    }

    // Get bearing from one cell to another as a visual direction
    private getBearingAsVisualDir(from: string, to: string): HexDir | undefined {
        const internalBearing = this.graph.bearing(from, to) as InternalDir | undefined;
        if (internalBearing === undefined) return undefined;
        return internalToVisual.get(internalBearing);
    }

    // Get adjacent cells in the given directions from a cell
    private getAdjacentCells(cell: string, dirs: HexDir[]): string[] {
        const [x, y] = this.graph.algebraic2coords(cell);
        const cells: string[] = [];
        for (const dir of dirs) {
            const internalDir = visualToInternal.get(dir)!;
            const next = this.graph.move(x, y, internalDir);
            if (next !== undefined) {
                cells.push(this.graph.coords2algebraic(...next));
            }
        }
        return cells;
    }

    // Create a deep copy of a board map
    private copyBoard(board: Map<string, PlaneInfo>): Map<string, PlaneInfo> {
        return new Map(Array.from(board, ([k, v]) => [k, [...v] as PlaneInfo]));
    }

    // Check if we're in cloud placement phase
    private inCloudPhase(): boolean {
        return this.clouds.size < 16;
    }

    // Check if we're in entry phase (first few turns after clouds)
    private inEntryPhase(): boolean {
        if (this.inCloudPhase()) return false;
        // Entry phase: turns 1-7 after cloud placement
        // P1 gets turns 1,3,5,7 (1+3+5+6=15 actions), P2 gets turns 2,4,6 (2+4+6=12 actions)
        // Both players get a 6-action turn to enter/move planes
        return this.turnNumber <= 7;
    }

    // Get number of planes to move/enter this turn (uses current board state)
    private getPlanesToMove(): number {
        if (this.inCloudPhase()) return 0;
        if (this.inEntryPhase()) {
            // Account for shot-down planes: can only move/enter planes you actually have
            const totalPlanes = this.countPlanesOnBoard(this.currplayer) + this.planesRemaining[this.currplayer - 1];
            return Math.min(this.turnNumber, 6, totalPlanes);
        }
        // After entry phase: move all planes currently on board (at start of turn)
        return this.countPlanesOnBoard(this.currplayer);
    }

    // Get number of required actions from start-of-turn state (canonical, for partial moves)
    private getRequiredActionsFromStack(): number {
        if (this.inCloudPhase()) return 0;
        const stackState = this.stack[this.stack.length - 1];
        const startOfTurnPlaneCount = [...(stackState.board as Map<string, PlaneInfo>).values()]
            .filter(info => info[0] === this.currplayer).length;
        const startOfTurnRemaining = (stackState.planesRemaining as [number, number])[this.currplayer - 1];
        if (this.inEntryPhase()) {
            return Math.min(this.turnNumber, 6, startOfTurnPlaneCount + startOfTurnRemaining);
        }
        return Math.min(startOfTurnPlaneCount, 6);
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
        const internalDir = visualToInternal.get(dir)!;
        const ray = this.graph.ray(x, y, internalDir);
        return ray.map(([rx, ry]) => this.graph.coords2algebraic(rx, ry));
    }

    // Get line of fire from a plane (cells it can shoot)
    private getLineOfFire(cell: string, dir: HexDir, board?: Map<string, PlaneInfo>): string[] {
        // Can't shoot out of clouds
        if (this.clouds.has(cell)) return [];

        const checkBoard = board ?? this.board;
        const [x, y] = this.graph.algebraic2coords(cell);
        const ray = this.getRay(x, y, dir);
        const result: string[] = [];
        for (const target of ray) {
            // Can't shoot through or into clouds
            if (this.clouds.has(target)) break;
            // Can't shoot through other planes
            if (checkBoard.has(target)) {
                result.push(target);
                break;
            }
            result.push(target);
        }
        return result;
    }

    // Check if a cell is in crosshairs using a specific board state
    private isInCrosshairsWithBoard(cell: string, shooter: playerid, board: Map<string, PlaneInfo>): boolean {
        // Can't shoot into clouds
        if (this.clouds.has(cell)) return false;

        // Count how many of shooter's planes have this cell in their line of fire
        let count = 0;
        for (const [planeCell, info] of board) {
            if (info[0] === shooter) {
                const lof = this.getLineOfFire(planeCell, info[1], board);
                if (lof.includes(cell)) {
                    count++;
                    if (count >= 2) return true;
                }
            }
        }
        return false;
    }

    // Get all enemy planes that are currently shootable (in crosshairs of at least 2 friendly planes)
    private getShootablePlanes(shooter: playerid, board: Map<string, PlaneInfo>): string[] {
        const shootable: string[] = [];
        const enemy = shooter === 1 ? 2 : 1;
        for (const [cell, info] of board) {
            if (info[0] === enemy && this.isInCrosshairsWithBoard(cell, shooter, board)) {
                shootable.push(cell);
            }
        }
        return shootable;
    }

    // Check if a cell is blocked (by plane or off-board)
    // Optional board parameter allows checking against a different board state (e.g., after partial moves)
    private isBlocked(cell: string, board?: Map<string, PlaneInfo>): boolean {
        const checkBoard = board ?? this.board;
        return checkBoard.has(cell);
    }

    // Check if a plane can move forward
    private canMoveForward(cell: string, dir: HexDir, board?: Map<string, PlaneInfo>): boolean {
        const [x, y] = this.graph.algebraic2coords(cell);
        const internalDir = visualToInternal.get(dir)!;
        const next = this.graph.move(x, y, internalDir);
        if (next === undefined) return false;
        const nextCell = this.graph.coords2algebraic(...next);
        return !this.isBlocked(nextCell, board);
    }

    // Get cell after moving forward
    private moveForward(cell: string, dir: HexDir, board?: Map<string, PlaneInfo>): string | undefined {
        const [x, y] = this.graph.algebraic2coords(cell);
        const internalDir = visualToInternal.get(dir)!;
        const next = this.graph.move(x, y, internalDir);
        if (next === undefined) return undefined;
        const nextCell = this.graph.coords2algebraic(...next);
        if (this.isBlocked(nextCell, board)) return undefined;
        return nextCell;
    }

    // Try to select a different plane at `cell` given a move prefix.
    // Returns the new move string (prefix + plane selection), or "" if no valid selection.
    private trySelectPlane(prefix: string, cell: string): string {
        // Apply prefix to get current state (use stack as base for canonical start-of-turn state)
        const stackState = this.stack[this.stack.length - 1];
        const applied = this.applyActions(prefix, {
            baseBoard: stackState.board,
            basePlanesRemaining: stackState.planesRemaining as [number, number],
        });

        // Check if cell has a plane owned by current player
        const planeInfo = applied.board.get(cell);
        if (!planeInfo || planeInfo[0] !== this.currplayer) {
            return "";
        }

        // Check if plane hasn't already moved
        if (applied.movedPlanes.has(cell)) {
            return "";
        }

        // Check if we have actions remaining (use stack state for consistency with getClickHints)
        const requiredActions = this.getRequiredActionsFromStack();
        if (applied.completedActionCount >= requiredActions) {
            return "";
        }

        // Check if it's a crash (can't move forward and height <= 1)
        const [, dir, height] = planeInfo;
        if (!this.canMoveForward(cell, dir, applied.board) && height <= 1) {
            return prefix ? `${prefix}, ${cell}X` : `${cell}X`;
        }

        // Regular plane selection
        return prefix ? `${prefix}, ${cell}` : cell;
    }

    // Check if we can enter a new plane at the given cell
    private canEnterAt(cell: string, applied: IApplyResult): boolean {
        // Must have planes remaining
        if (applied.planesRemaining[this.currplayer - 1] <= 0) {
            return false;
        }

        // Cell must be a valid starting hex
        const startingHexes = this.getStartingHexes(this.currplayer);
        if (!startingHexes.includes(cell)) {
            return false;
        }

        // Cell must be empty
        if (applied.board.has(cell)) {
            return false;
        }

        // Must have actions remaining (use stack state for consistency with getClickHints)
        const requiredActions = this.getRequiredActionsFromStack();
        if (applied.completedActionCount >= requiredActions) {
            return false;
        }

        return true;
    }

    // Handle click during dive mode
    // Two-step process matching climb/level: first click destination, then click direction
    private handleDiveClick(move: string, actions: string[], applied: IApplyResult, cell: string): string {
        const diveState = applied.diveState;
        if (!diveState) return move;

        const { fromCell, currentCell, currentDir, currentHeight, sequence, origSequence, waitingForDir } = diveState;

        // Check if we're waiting for direction (sequence ends with "/")
        if (waitingForDir) {
            // Get bearing from currentCell to clicked cell
            const newDir = this.getBearingAsVisualDir(currentCell, cell);
            if (newDir !== undefined) {
                // diveState.currentDir is the direction after all completed steps,
                // which is the direction before the current incomplete step
                const dirBeforePartial = currentDir;

                // Only allow same direction or ±60° turn
                if (!this.isValidTurn(dirBeforePartial, newDir)) {
                    return move; // Invalid turn angle
                }

                // Complete the step - use origSequence to preserve shooting notation
                if (newDir === dirBeforePartial) {
                    // Same direction - remove the trailing "/"
                    actions[actions.length - 1] = `${fromCell}v${origSequence.slice(0, -1)}`;
                } else {
                    // Different direction - add it
                    actions[actions.length - 1] = `${fromCell}v${origSequence}${newDir}`;
                }
                return actions.join(", ");
            }
            return move;
        }

        // Not waiting for direction - selecting destination for new step
        // Can't continue diving if height is too low
        if (currentHeight <= 0) return move;

        // Get the cell one-ahead in current direction (using applied board with shots removed)
        const oneAhead = this.moveForward(currentCell, currentDir, applied.board);

        // Check what type of dive step this is
        let newPartialStep = "";

        // Click on one-ahead cell → swoop (needs direction)
        if (oneAhead !== undefined && cell === oneAhead && currentHeight >= 1 && !applied.board.has(oneAhead)) {
            newPartialStep = `${oneAhead}/`;
        }
        // Click on current cell (plane again) → power dive (needs direction)
        else if (cell === currentCell && currentHeight >= 2) {
            newPartialStep = "P/";
        }

        if (newPartialStep !== "") {
            // Append the new partial step to the dive sequence
            // Use origSequence to preserve any shooting notation
            if (sequence === "") {
                actions[actions.length - 1] = `${fromCell}v${newPartialStep}`;
            } else {
                // Append new step - origSequence already has shooting notation
                actions[actions.length - 1] = `${fromCell}v${origSequence}>${newPartialStep}`;
            }
            return actions.join(", ");
        }

        return move;
    }

    // Generate all possible moves for a single plane
    // Optional board parameter for checking against a specific board state (e.g., after partial moves)
    private getPlaneMovements(cell: string, info: PlaneInfo, board?: Map<string, PlaneInfo>): string[] {
        const [, dir, height] = info;
        const moves: string[] = [];

        // (a) Climb: +1 height (capped at 6), move 1 forward, optional 60° turn
        // At height 6, climb is allowed but height doesn't increase (becomes 1-space level flight)
        const forward = this.moveForward(cell, dir, board);
        if (forward !== undefined) {
            // Can keep direction or turn 60° either way
            moves.push(`${cell}+${forward}`); // climb, keep direction
            const [left, right] = adjacentDirs(dir);
            moves.push(`${cell}+${forward}/${left}`);
            moves.push(`${cell}+${forward}/${right}`);
        }

        // (b) Level flight: move 1 or 2 forward, optional 60° turn
        const forward1 = this.moveForward(cell, dir, board);
        if (forward1 !== undefined) {
            moves.push(`${cell}-${forward1}`);
            const [left1, right1] = adjacentDirs(dir);
            moves.push(`${cell}-${forward1}/${left1}`);
            moves.push(`${cell}-${forward1}/${right1}`);

            // Can move 2 spaces
            const forward2 = this.moveForward(forward1, dir, board);
            if (forward2 !== undefined) {
                moves.push(`${cell}-${forward2}`);
                const [left2, right2] = adjacentDirs(dir);
                moves.push(`${cell}-${forward2}/${left2}`);
                moves.push(`${cell}-${forward2}/${right2}`);
            }
        }

        // (c) Dive: series of swoops and power dives
        // This is complex - we generate all possible dive sequences
        const diveSequences = this.generateDiveSequences(cell, height, dir, board);
        for (const seq of diveSequences) {
            moves.push(`${cell}v${seq}`);
        }

        // (d) Crash: if cannot move forward and at height 0 or 1 (can't power dive)
        if (!this.canMoveForward(cell, dir, board) && height <= 1) {
            moves.push(`${cell}X`); // crash
        }

        return moves;
    }

    // Generate all possible dive sequences from a position
    private generateDiveSequences(cell: string, height: number, dir: HexDir, board?: Map<string, PlaneInfo>): string[] {
        if (height === 0) return [];

        const sequences: string[] = [];

        // Helper to generate sequences recursively
        // Dive steps are separated by ">" (not comma, which separates actions in a turn)
        const generate = (currentCell: string, currentHeight: number, currentDir: HexDir, path: string) => {
            // A dive must lose height, so we must do at least one maneuver
            if (path !== "") {
                // Add current state as a valid sequence (can stop diving at any point)
                sequences.push(path);
            }

            // Try swoop: -1 height, move forward, optional turn
            if (currentHeight >= 1) {
                const forward = this.moveForward(currentCell, currentDir, board);
                if (forward !== undefined) {
                    const newHeight = currentHeight - 1;
                    // Keep direction
                    const newPath = path === "" ? `${forward}` : `${path}>${forward}`;
                    generate(forward, newHeight, currentDir, newPath);
                    // Turn left or right
                    const [left, right] = adjacentDirs(currentDir);
                    generate(forward, newHeight, left, path === "" ? `${forward}/${left}` : `${path}>${forward}/${left}`);
                    generate(forward, newHeight, right, path === "" ? `${forward}/${right}` : `${path}>${forward}/${right}`);
                }
            }

            // Try power dive: -2 height, no movement, optional turn
            if (currentHeight >= 2) {
                const newHeight = currentHeight - 2;
                // Keep direction
                generate(currentCell, newHeight, currentDir, path === "" ? `P` : `${path}>P`);
                // Turn
                const [left, right] = adjacentDirs(currentDir);
                generate(currentCell, newHeight, left, path === "" ? `P/${left}` : `${path}>P/${left}`);
                generate(currentCell, newHeight, right, path === "" ? `P/${right}` : `${path}>P/${right}`);
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
        shootTargets?: string[];  // Cells to shoot (for embedded shoot notation)
    } {
        move = move.trim().toLowerCase();

        // Extract ALL embedded shoot notations "(cell1,cell2,...)" from anywhere in the move
        // (for dives, shooting can occur after intermediate steps like "g7vf7(e6)>P/")
        const extractedTargets = this.extractShootTargets(move);
        const shootTargets = extractedTargets.length > 0 ? extractedTargets : undefined;
        // Remove all shooting notations from the move
        move = this.removeShootNotation(move);

        // Cloud placement: "cloud:a1"
        if (move.startsWith("cloud:")) {
            return { type: "cloud", cell: move.slice(6), shootTargets };
        }

        // Enter: "enter:a1/NE" (place new plane on edge) or partial "enter:a1/"
        if (move.startsWith("enter:")) {
            const parts = move.slice(6).split("/");
            const dir = parts[1] && parts[1].length > 0 ? parts[1].toUpperCase() as HexDir : undefined;
            return { type: "enter", cell: parts[0], dir, shootTargets };
        }

        // Standalone shoot: "(e5)" with no move - after extracting shootMatch, move is empty
        if (move === "" && shootTargets && shootTargets.length > 0) {
            return { type: "shoot", shootTargets };
        }

        // Movement:
        // Climb: "a1+b2" or "a1+b2/NE" or "a1+b2/NE(e5)"
        // Level: "a1-b2" or "a1-b2/NE" or "a1-b2/NE(e5)"
        // Dive: "a1va2>a3>P/NW" or "a1va2>a3>P/NW(e5)"
        // Crash: "a1X"

        if (move.includes("+")) {
            const parts = move.split("+");
            const targetParts = parts[1].split("/");
            const dir = targetParts[1] && targetParts[1].length > 0 ? targetParts[1].toUpperCase() as HexDir : undefined;
            return {
                type: "move",
                cell: parts[0],
                target: targetParts[0],
                dir,
                moveType: "climb",
                shootTargets,
            };
        }

        if (move.includes("v")) {
            const parts = move.split("v");
            return {
                type: "move",
                cell: parts[0],
                diveSequence: parts[1],
                moveType: "dive",
                shootTargets,
            };
        }

        if (move.endsWith("x")) {
            return {
                type: "move",
                cell: move.slice(0, -1),
                moveType: "crash",
                shootTargets,
            };
        }

        // Level flight
        const parts = move.split("-");
        if (parts.length === 2) {
            const targetParts = parts[1].split("/");
            const dir = targetParts[1] && targetParts[1].length > 0 ? targetParts[1].toUpperCase() as HexDir : undefined;
            return {
                type: "move",
                cell: parts[0],
                target: targetParts[0],
                dir,
                moveType: "level",
                shootTargets,
            };
        }

        throw new Error(`Cannot parse move: ${move}`);
    }

    // Compute crosshair coverage: for each enemy plane (not in clouds),
    // which friendly plane cells have it in their line of fire?
    // Used to quickly determine if any action could create new crosshairs.
    private computeCrosshairCoverage(
        player: playerid, board: Map<string, PlaneInfo>
    ): Map<string, Set<string>> {
        const coverage = new Map<string, Set<string>>();
        const enemy = player === 1 ? 2 : 1;

        // Initialize coverage for enemy cells not in clouds
        for (const [cell, info] of board) {
            if (info[0] === enemy && !this.clouds.has(cell)) {
                coverage.set(cell, new Set());
            }
        }

        // For each friendly plane, compute line of fire contributions
        for (const [planeCell, info] of board) {
            if (info[0] === player) {
                const lof = this.getLineOfFire(planeCell, info[1], board);
                for (const target of lof) {
                    if (coverage.has(target)) {
                        coverage.get(target)!.add(planeCell);
                    }
                }
            }
        }

        return coverage;
    }

    // Check if a moving plane (from fromCell) could possibly create new crosshairs.
    // An enemy becomes newly shootable only if exactly 1 OTHER friendly plane covers it.
    // For entries (fromCell undefined), check if any enemy has coverage == 1.
    private hasShotCandidates(
        coverage: Map<string, Set<string>>,
        fromCell: string | undefined,
        passedPlanes: Set<string>,
    ): boolean {
        for (const [enemy, covering] of coverage) {
            if (passedPlanes.has(enemy)) continue;
            const otherCount = covering.size - (fromCell && covering.has(fromCell) ? 1 : 0);
            if (otherCount === 1) return true;
        }
        return false;
    }

    // Given a bare action (no shot notation) and the board state BEFORE the action,
    // return all action variants with embedded shot notation, plus the updated passedPlanes.
    // "Shoot immediately or never" rule: any plane that newly becomes shootable at any step
    // must either be shot right then, or added to passedPlanes (never shot later).
    // crosshairCoverage: pre-computed coverage map (enemy -> set of friendly cells covering it).
    private expandActionWithShots(
        action: string,
        boardBefore: Map<string, PlaneInfo>,
        passedPlanes: Set<string>,
        shootableBefore: Set<string>,
        crosshairCoverage: Map<string, Set<string>>,
    ): { action: string; newPassed: Set<string> }[] {
        const parsed = this.parseMove(action);
        const fromCell = parsed.cell;

        // Fast check: can this plane's movement possibly create new crosshairs?
        // Only if some enemy is already covered by exactly 1 OTHER friendly plane.
        if (!this.hasShotCandidates(crosshairCoverage, fromCell, passedPlanes)) {
            return [{ action, newPassed: new Set(passedPlanes) }];
        }

        // There are candidates — do the full expansion.
        // For dives, process step by step since crosshairs may form at intermediate positions.
        if (parsed.moveType === "dive") {
            return this.expandDiveWithShots(action, boardBefore, passedPlanes, shootableBefore);
        }

        // For non-dive actions: apply the action, find newly shootable
        const tempBoard = this.copyBoard(boardBefore);
        this.applyActionToBoard(action, tempBoard);
        const shootableAfter = this.getShootablePlanes(this.currplayer, tempBoard);
        const newlyShootable = shootableAfter.filter(
            c => !shootableBefore.has(c) && !passedPlanes.has(c)
        );

        if (newlyShootable.length === 0) {
            return [{ action, newPassed: new Set(passedPlanes) }];
        }

        // Generate all shoot/pass combinations
        return this.generateShotCombinations(
            action, tempBoard, newlyShootable, passedPlanes
        );
    }

    // Generate all shoot/pass combinations for a set of newly shootable planes.
    // Returns action variants with shot notation and updated passedPlanes.
    private generateShotCombinations(
        actionStr: string,
        boardAfterAction: Map<string, PlaneInfo>,
        newlyShootable: string[],
        passedPlanes: Set<string>,
    ): { action: string; newPassed: Set<string> }[] {
        const results: { action: string; newPassed: Set<string> }[] = [];

        // Recursive: for each newly shootable plane, decide shoot or pass.
        // We process them one at a time because shooting one may make others
        // no longer shootable (or newly shootable via chain).
        const recurse = (
            idx: number,
            currentAction: string,
            currentBoard: Map<string, PlaneInfo>,
            currentPassed: Set<string>,
            shotsThisRound: string[],
        ) => {
            if (idx >= newlyShootable.length) {
                // Check for chain shots: after applying all shots so far,
                // are there any NEW planes shootable that weren't before?
                const nowShootable = this.getShootablePlanes(this.currplayer, currentBoard);
                const chainNew = nowShootable.filter(
                    c => !currentPassed.has(c) &&
                        !newlyShootable.includes(c) &&
                        shotsThisRound.length > 0 // only chain if we actually shot something
                );
                if (chainNew.length > 0) {
                    // Recurse into chain shots
                    const chainResults = this.generateShotCombinations(
                        currentAction, currentBoard, chainNew, currentPassed
                    );
                    results.push(...chainResults);
                } else {
                    results.push({ action: currentAction, newPassed: new Set(currentPassed) });
                }
                return;
            }

            const target = newlyShootable[idx];

            // Option 1: Pass on this target (never shoot it during this action)
            const passedCopy = new Set(currentPassed);
            passedCopy.add(target);
            recurse(idx + 1, currentAction, currentBoard, passedCopy, shotsThisRound);

            // Option 2: Shoot this target (if still shootable on current board)
            if (this.isInCrosshairsWithBoard(target, this.currplayer, currentBoard)) {
                const shotBoard = this.copyBoard(currentBoard);
                shotBoard.delete(target);
                const shotAction = this.appendShotToAction(currentAction, target);
                recurse(idx + 1, shotAction, shotBoard, new Set(currentPassed), [...shotsThisRound, target]);
            }
        };

        recurse(0, actionStr, boardAfterAction, passedPlanes, []);
        return results;
    }

    // Append a shot target to an action string.
    // "trailing": appends (target) or extends existing trailing (targets)
    // "embedded": same as trailing for the current step notation
    private appendShotToAction(action: string, target: string): string {
        // Check if action already ends with a shot group
        const endMatch = action.match(/\(([^)]+)\)$/);
        if (endMatch) {
            return action.slice(0, -1) + `,${target})`;
        }
        return `${action}(${target})`;
    }

    // Apply a single bare action (no shot notation) to a board in-place.
    // Lightweight version of applyActions for just board mutation.
    private applyActionToBoard(action: string, board: Map<string, PlaneInfo>): void {
        const parsed = this.parseMove(action);
        if (parsed.type === "enter") {
            board.set(parsed.cell!, [this.currplayer, parsed.dir!, 0]);
        } else if (parsed.type === "move") {
            const fromCell = parsed.cell!;
            const info = board.get(fromCell);
            if (!info) return;
            const [owner, currentDir, currentHeight] = info;

            if (parsed.moveType === "crash") {
                board.delete(fromCell);
            } else if (parsed.moveType === "climb") {
                const newDir = parsed.dir || currentDir;
                const newHeight = Math.min(currentHeight + 1, 6);
                board.delete(fromCell);
                board.set(parsed.target!, [owner, newDir, newHeight]);
            } else if (parsed.moveType === "level") {
                const newDir = parsed.dir || currentDir;
                board.delete(fromCell);
                board.set(parsed.target!, [owner, newDir, currentHeight]);
            } else if (parsed.moveType === "dive") {
                // Process full dive sequence
                let cell = fromCell;
                let height = currentHeight;
                let dir = currentDir;
                const sequence = parsed.diveSequence || "";
                const steps = sequence.split(">");
                for (const step of steps) {
                    if (step.startsWith("p") || step.startsWith("P")) {
                        height -= 2;
                        const parts = step.split("/");
                        if (parts[1]) {
                            const d = parts[1].toUpperCase() as HexDir;
                            if (allDirections.includes(d)) dir = d;
                        }
                    } else {
                        const parts = step.split("/");
                        const nextCell = parts[0].toLowerCase();
                        if (nextCell && nextCell.length > 0) {
                            if (cell !== fromCell) board.delete(cell);
                            cell = nextCell;
                            height--;
                            if (parts[1]) {
                                const d = parts[1].toUpperCase() as HexDir;
                                if (allDirections.includes(d)) dir = d;
                            }
                        }
                    }
                }
                if (fromCell !== cell) board.delete(fromCell);
                board.set(cell, [owner, dir, height]);
            }
        }
    }

    // Expand a dive action with embedded shots at each intermediate step.
    // At each dive step, check what planes newly become shootable and branch.
    private expandDiveWithShots(
        action: string,
        boardBefore: Map<string, PlaneInfo>,
        passedPlanes: Set<string>,
        shootableBefore: Set<string>,
    ): { action: string; newPassed: Set<string> }[] {
        const parsed = this.parseMove(action);
        const fromCell = parsed.cell!;
        const info = boardBefore.get(fromCell);
        if (!info) return [{ action, newPassed: new Set(passedPlanes) }];
        const [owner, currentDir, currentHeight] = info;
        const sequence = parsed.diveSequence || "";
        const steps = sequence.split(">");

        // Process each step, tracking board state and branching on shots.
        // We build the action string incrementally: "g6v" + step1 + ">" + step2 + ...
        type DiveVariant = {
            prefix: string;       // built action so far (e.g., "g6vf6(e5)>e5")
            board: Map<string, PlaneInfo>;
            passed: Set<string>;
            cell: string;
            height: number;
            dir: HexDir;
        };

        let variants: DiveVariant[] = [{
            prefix: `${fromCell}v`,
            board: this.copyBoard(boardBefore),
            passed: new Set(passedPlanes),
            cell: fromCell,
            height: currentHeight,
            dir: currentDir,
        }];

        for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
            const step = steps[stepIdx];
            const nextVariants: DiveVariant[] = [];

            for (const v of variants) {
                // Apply this step to the variant's board
                const newBoard = this.copyBoard(v.board);
                let newCell = v.cell;
                let newHeight = v.height;
                let newDir = v.dir;

                const stepLower = step.toLowerCase();
                if (stepLower.startsWith("p")) {
                    newHeight -= 2;
                    const parts = stepLower.split("/");
                    if (parts[1]) {
                        const d = parts[1].toUpperCase() as HexDir;
                        if (allDirections.includes(d)) newDir = d;
                    }
                    // Update board: plane stays in same cell with new height/dir
                    newBoard.set(newCell, [owner, newDir, newHeight]);
                } else {
                    const parts = stepLower.split("/");
                    const targetCell = parts[0];
                    if (targetCell && targetCell.length > 0) {
                        if (newCell !== fromCell || stepIdx > 0) {
                            // Only delete intermediate cells, not fromCell on first step
                        }
                        // Move plane to new cell
                        if (v.cell !== targetCell) {
                            newBoard.delete(v.cell);
                        }
                        newCell = targetCell;
                        newHeight--;
                        if (parts[1]) {
                            const d = parts[1].toUpperCase() as HexDir;
                            if (allDirections.includes(d)) newDir = d;
                        }
                        newBoard.set(newCell, [owner, newDir, newHeight]);
                    }
                }
                // Also clean up fromCell if plane has moved
                if (newCell !== fromCell) {
                    newBoard.delete(fromCell);
                }

                // Build the step string for the action
                const stepStr = stepIdx === 0 ? step : `>${step}`;
                const newPrefix = v.prefix + stepStr;

                // Check newly shootable planes after this step
                const shootableNow = this.getShootablePlanes(this.currplayer, newBoard);
                const newlyShootable = shootableNow.filter(
                    c => !shootableBefore.has(c) && !v.passed.has(c)
                );

                if (newlyShootable.length === 0) {
                    nextVariants.push({
                        prefix: newPrefix,
                        board: newBoard,
                        passed: new Set(v.passed),
                        cell: newCell,
                        height: newHeight,
                        dir: newDir,
                    });
                } else {
                    // Generate all shoot/pass combinations for newly shootable planes.
                    // For dives, shots are appended right after this step: "f6(e5)"
                    const combos = this.generateShotCombinationsForDiveStep(
                        newPrefix, newBoard, newlyShootable, v.passed
                    );
                    for (const combo of combos) {
                        nextVariants.push({
                            prefix: combo.action,
                            board: combo.board,
                            passed: combo.newPassed,
                            cell: newCell,
                            height: newHeight,
                            dir: newDir,
                        });
                    }
                }
            }

            variants = nextVariants;
        }

        // Return final variants
        return variants.map(v => ({
            action: v.prefix,
            newPassed: v.passed,
        }));
    }

    // Generate shot combinations for a dive step.
    // Similar to generateShotCombinations but returns board state too.
    private generateShotCombinationsForDiveStep(
        actionStr: string,
        boardAfterStep: Map<string, PlaneInfo>,
        newlyShootable: string[],
        passedPlanes: Set<string>,
    ): { action: string; board: Map<string, PlaneInfo>; newPassed: Set<string> }[] {
        const results: { action: string; board: Map<string, PlaneInfo>; newPassed: Set<string> }[] = [];

        const recurse = (
            idx: number,
            currentAction: string,
            currentBoard: Map<string, PlaneInfo>,
            currentPassed: Set<string>,
            shotsThisRound: string[],
        ) => {
            if (idx >= newlyShootable.length) {
                // Check for chain shots
                const nowShootable = this.getShootablePlanes(this.currplayer, currentBoard);
                const chainNew = nowShootable.filter(
                    c => !currentPassed.has(c) &&
                        !newlyShootable.includes(c) &&
                        shotsThisRound.length > 0
                );
                if (chainNew.length > 0) {
                    const chainResults = this.generateShotCombinationsForDiveStep(
                        currentAction, currentBoard, chainNew, currentPassed
                    );
                    results.push(...chainResults);
                } else {
                    results.push({
                        action: currentAction,
                        board: this.copyBoard(currentBoard),
                        newPassed: new Set(currentPassed),
                    });
                }
                return;
            }

            const target = newlyShootable[idx];

            // Option 1: Pass
            const passedCopy = new Set(currentPassed);
            passedCopy.add(target);
            recurse(idx + 1, currentAction, currentBoard, passedCopy, shotsThisRound);

            // Option 2: Shoot (if still shootable)
            if (this.isInCrosshairsWithBoard(target, this.currplayer, currentBoard)) {
                const shotBoard = this.copyBoard(currentBoard);
                shotBoard.delete(target);
                const shotAction = this.appendShotToAction(currentAction, target);
                recurse(idx + 1, shotAction, shotBoard, new Set(currentPassed), [...shotsThisRound, target]);
            }
        };

        recurse(0, actionStr, boardAfterStep, passedPlanes, []);
        return results;
    }

    // Generate all complete moves for the current player
    // A complete move includes all required actions for the turn
    // Compute a fingerprint of the board state for deduplication.
    // Two moves that produce the same board+planesRemaining are equivalent.
    private boardFingerprint(board: Map<string, PlaneInfo>, planesRemaining: [number, number]): string {
        const entries: string[] = [];
        for (const [cell, info] of board) {
            entries.push(`${cell}:${info[0]},${info[1]},${info[2]}`);
        }
        entries.sort();
        return `${entries.join(";")}|${planesRemaining[0]},${planesRemaining[1]}`;
    }

    // Simplify a move for fast equivalence rejection.
    // Strips shots, simplifies dives to "<source>v", sorts actions.
    // Returns [simplifiedSorted, shotTargetsSorted].
    private simplifyMove(move: string): [string, string] {
        const actions = this.splitActions(move);
        const simplified: string[] = [];
        const allShots: string[] = [];
        for (const action of actions) {
            allShots.push(...this.extractShootTargets(action));
            let clean = this.removeShootNotation(action);
            // Simplify dives: "g6vf7>e6/NE" -> "g6v"
            const vIdx = clean.indexOf("v");
            if (vIdx >= 0) {
                clean = clean.slice(0, vIdx + 1);
            }
            simplified.push(clean);
        }
        simplified.sort();
        allShots.sort();
        return [simplified.join(","), allShots.join(",")];
    }

    protected sameMove(move1: string, move2: string): boolean {
        move1 = move1.toLowerCase().replace(/\s+/g, "");
        move2 = move2.toLowerCase().replace(/\s+/g, "");
        if (move1 === move2) return true;
        // Fast rejection: compare simplified forms
        const [simple1, shots1] = this.simplifyMove(move1);
        const [simple2, shots2] = this.simplifyMove(move2);
        if (simple1 !== simple2) return false;
        if (shots1 !== shots2) return false;
        // Simplified forms match — apply both moves and compare board states
        const stackState = this.stack[this.stack.length - 1];
        const baseBoard = stackState.board as Map<string, PlaneInfo>;
        const basePlanes = stackState.planesRemaining as [number, number];
        const applied1 = this.applyActions(move1, { baseBoard, basePlanesRemaining: basePlanes });
        const applied2 = this.applyActions(move2, { baseBoard, basePlanesRemaining: basePlanes });
        return this.boardFingerprint(applied1.board, applied1.planesRemaining)
            === this.boardFingerprint(applied2.board, applied2.planesRemaining);
    }

    // All moves for the current player. Beware: this can be a very large list due to the combinatorial nature of moves + shots. Some positions have millions of moves!
    public moves(): string[] {
        if (this.gameover) return [];

        // Cloud phase: each cloud placement is a complete move
        if (this.inCloudPhase()) {
            return this.actions();
        }

        const stackState = this.stack[this.stack.length - 1];
        const baseBoard = stackState.board as Map<string, PlaneInfo>;
        const basePlanes = stackState.planesRemaining as [number, number];

        // Build complete moves by recursively combining actions.
        // Different orderings of plane actions often produce the same board state.
        // We prune by tracking seen intermediate states at each depth level,
        // keeping only one representative move string per unique state.
        //
        // passedPlanes: planes that newly became shootable during an action but
        // we chose not to shoot. "Shoot immediately or never" rule: these planes
        // cannot be shot later in the same turn (at complete=0 or in subsequent actions).
        const completeMoves: string[] = [];
        const seenStates: Map<number, Set<string>> = new Map(); // depth -> set of fingerprints
        const seenComplete = new Set<string>(); // fingerprints of complete/submittable moves

        const buildMoves = (partial: string, depth: number, passedPlanes: Set<string>) => {
            const applied = this.applyActions(partial, {
                baseBoard: baseBoard,
                basePlanesRemaining: basePlanes,
            });

            const validation = this.validateMove(partial);
            if (validation.complete === 1) {
                const fp = this.boardFingerprint(applied.board, applied.planesRemaining);
                if (!seenComplete.has(fp)) {
                    seenComplete.add(fp);
                    completeMoves.push(partial);
                }
                return;
            }

            if (validation.complete === 0) {
                // Submittable but extendable — add as a complete move
                const fp = this.boardFingerprint(applied.board, applied.planesRemaining);
                if (!seenComplete.has(fp)) {
                    seenComplete.add(fp);
                    completeMoves.push(partial);
                }
                // When complete=0, only shooting remains as optional extension.
                // Respect passedPlanes: don't offer shots for planes we chose to pass on.
                const shootable = this.getShootablePlanes(this.currplayer, applied.board)
                    .filter(t => !passedPlanes.has(t));
                for (const target of shootable) {
                    const actions = this.splitActions(partial);
                    const lastAction = actions[actions.length - 1];
                    const endShootMatch = lastAction.match(/\(([^)]+)\)$/);
                    if (endShootMatch) {
                        const base = lastAction.slice(0, -endShootMatch[0].length);
                        actions[actions.length - 1] = `${base}(${endShootMatch[1]},${target})`;
                    } else {
                        actions[actions.length - 1] = `${lastAction}(${target})`;
                    }
                    buildMoves(actions.join(","), depth, passedPlanes);
                }
                return;
            }

            // complete === -1: Need more actions.
            // Prune: skip if we've already explored this exact board state + moved planes
            // at this depth. Must include movedPlanes because different sets of moved planes
            // yield different available continuations (actions() skips already-moved planes).
            // Also include passedPlanes in the fingerprint since different passed sets
            // lead to different shooting options later.
            const movedKey = [...applied.movedPlanes].sort().join(",");
            const passedKey = [...passedPlanes].sort().join(",");
            const fp = this.boardFingerprint(applied.board, applied.planesRemaining) + "|" + movedKey + "|" + passedKey;
            if (!seenStates.has(depth)) {
                seenStates.set(depth, new Set());
            }
            const depthSeen = seenStates.get(depth)!;
            if (depthSeen.has(fp)) {
                return;
            }
            depthSeen.add(fp);

            const nextActions = this.actions(this.currplayer, partial);
            // Pre-compute crosshair coverage and shootable set once per depth level.
            // crosshairCoverage: for each enemy, which friendly planes cover it.
            // Used by expandActionWithShots for fast "can this action create new crosshairs?" check.
            const crosshairCoverage = this.computeCrosshairCoverage(this.currplayer, applied.board);
            const shootableBeforeActions = new Set(
                // Shootable = enemies covered by >= 2 friendly planes
                [...crosshairCoverage.entries()]
                    .filter(([, covering]) => covering.size >= 2)
                    .map(([cell]) => cell)
            );
            for (const bareAction of nextActions) {
                // Expand this action with all embedded-shot variants
                const variants = this.expandActionWithShots(
                    bareAction, applied.board, passedPlanes,
                    shootableBeforeActions, crosshairCoverage
                );
                for (const variant of variants) {
                    const extended = partial ? `${partial},${variant.action}` : variant.action;
                    buildMoves(extended, depth + 1, variant.newPassed);
                }
            }
        };

        buildMoves("", 0, new Set());
        return completeMoves;
    }

    // Get possible next actions given what's already been done
    // This returns individual actions, not complete moves
    public actions(player?: playerid, partialMove?: string): string[] {
        if (this.gameover) return [];
        if (player === undefined) {
            player = this.currplayer;
        }

        const actions: string[] = [];

        // Cloud placement phase - players alternate placing clouds until all 16 are placed
        if (this.inCloudPhase()) {
            for (const cell of this.graph.listCells() as string[]) {
                if (this.clouds.has(cell)) continue;
                if (!this.wouldCreateLargeCloud(cell, this.clouds)) {
                    actions.push(`cloud:${cell}`);
                }
            }
            return actions;
        }

        // Apply partial move to get current board position.
        // Always start from the canonical state (stack) so this works even if
        // this.board was modified externally (e.g., by validateMove's applyPartialAction loop).
        const stackState = this.stack[this.stack.length - 1];
        const applied = this.applyActions(partialMove || "", {
            baseBoard: stackState.board,
            basePlanesRemaining: stackState.planesRemaining as [number, number],
        });
        const workingBoard = applied.board;
        const workingPlanesRemaining = applied.planesRemaining;
        const movedPlanes = applied.movedPlanes;

        // Entry: allowed if we have planes remaining to enter AND actions remaining
        const requiredActions = this.getPlanesToMove();
        const actionsRemaining = requiredActions - applied.completedActionCount;

        if (workingPlanesRemaining[player - 1] > 0 && actionsRemaining > 0) {
            const startingHexes = this.getStartingHexes(player);
            for (const cell of startingHexes) {
                // Can enter on any unoccupied starting hex (clouds are OK)
                if (!workingBoard.has(cell)) {
                    for (const dir of allDirections) {
                        actions.push(`enter:${cell}/${dir}`);
                    }
                }
            }
        }

        // Moving existing planes (only those not yet moved this turn)
        const planes = this.getPlayerPlanesFrom(workingBoard, player);
        for (const [cell, info] of planes) {
            // Skip planes that have already moved this turn
            if (movedPlanes.has(cell)) continue;

            // Pass workingBoard to check for blocking against the current state
            const planeActions = this.getPlaneMovements(cell, info, workingBoard);
            actions.push(...planeActions);
        }

        return actions;
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

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            // Out-of-bounds click — coords2algebraic doesn't throw, just
            // produces garbage like "undefined100". Bail early.
            if (!this.graph.graph.hasNode(cell)) {
                return { move, valid: move.length > 0, message: "" };
            }
            let newmove = "";

            if (this.inCloudPhase()) {
                newmove = `cloud:${cell}`;
            } else if (move === "") {
                // Starting a new move
                if (this.board.has(cell)) {
                    const info = this.board.get(cell)!;
                    if (info[0] === this.currplayer) {
                        const [, dir, height] = info;
                        // Check if plane must crash (can't move forward and can't power dive)
                        if (!this.canMoveForward(cell, dir) && height <= 1) {
                            newmove = `${cell}X`;
                        } else {
                            newmove = cell;
                        }
                    } else {
                        // Clicked on enemy plane - check if it can be shot at start of turn
                        if (this.isInCrosshairsWithBoard(cell, this.currplayer, this.board)) {
                            newmove = `(${cell})`;
                        }
                    }
                } else {
                    // Could be entering a plane (clouds are OK to enter on)
                    const startingHexes = this.getStartingHexes(this.currplayer);
                    if (startingHexes.includes(cell) && this.planesRemaining[this.currplayer - 1] > 0) {
                        newmove = `enter:${cell}/`;
                    } else if (this.inEntryPhase() && this.planesRemaining[this.currplayer - 1] > 0 && !this.board.has(cell)) {
                        // Player clicked on invalid entry position during entry phase
                        return {
                            move: "",
                            valid: false,
                            message: i18next.t("apgames:validation.crosshairs.INVALID_ENTRY_POSITION", { cell }),
                        };
                    }
                }
            } else {
                // Continuing a move - use applyActions to determine state
                const applied = this.applyActions(move);
                const actions = this.splitActions(move);
                const lastAction = actions[actions.length - 1];

                switch (applied.partialState.type) {
                    case "entry_direction": {
                        // Need to select direction for partial entry
                        const { entryCell } = applied.partialState;
                        const visualDir = this.getBearingAsVisualDir(entryCell, cell);
                        if (visualDir !== undefined) {
                            actions[actions.length - 1] = `enter:${entryCell}/${visualDir}`;
                            newmove = actions.join(", ");
                        } else {
                            newmove = move;
                        }
                        break;
                    }
                    case "move_direction": {
                        // Partial climb/level move - need to select new facing direction
                        const { fromCell, targetCell, currentDir } = applied.partialState;
                        const moveBase = lastAction.slice(0, -1); // Remove trailing "/"

                        const visualDir = this.getBearingAsVisualDir(targetCell, cell);
                        let handled = false;
                        if (visualDir !== undefined) {
                            if (this.isValidTurn(currentDir, visualDir)) {
                                if (visualDir === currentDir) {
                                    actions[actions.length - 1] = moveBase;
                                } else {
                                    actions[actions.length - 1] = `${moveBase}/${visualDir}`;
                                }
                                newmove = actions.join(", ");
                                handled = true;
                            }
                        }

                        if (!handled) {
                            const clickedPlane = applied.board.get(cell);
                            if (clickedPlane !== undefined && clickedPlane[0] === this.currplayer && cell !== fromCell) {
                                const partialSoFar = actions.slice(0, -1).join(", ");
                                newmove = this.trySelectPlane(partialSoFar, cell) || move;
                            } else {
                                newmove = move;
                            }
                        }
                        break;
                    }
                    case "plane_selected": {
                        // Selected a plane, now selecting destination or entering dive mode
                        const { selectedCell, dir, height } = applied.partialState;
                        // Extract any shot prefix from the last action (e.g., "(k3)" from "(k3)k4")
                        const shotPrefixMatch = lastAction.match(/^(\([^)]+\))/);
                        const shotPrefix = shotPrefixMatch ? shotPrefixMatch[1] : "";
                        if (cell === selectedCell) {
                            // Clicked same cell again - enter dive mode
                            if (height > 0) {
                                actions[actions.length - 1] = `${shotPrefix}${selectedCell}v`;
                                newmove = actions.join(", ");
                            }
                        } else {
                            // Try to determine move type based on destination
                            const visualBearing = this.getBearingAsVisualDir(selectedCell, cell);
                            if (visualBearing === dir) {
                                // Use applied.board for occupancy checks (bug fix)
                                const oneAhead = this.moveForward(selectedCell, dir, applied.board);
                                if (oneAhead === cell) {
                                    // Climb: 1 space forward, needs direction selection
                                    actions[actions.length - 1] = `${shotPrefix}${selectedCell}+${cell}/`;
                                    newmove = actions.join(", ");
                                } else if (oneAhead !== undefined) {
                                    const twoAhead = this.moveForward(oneAhead, dir, applied.board);
                                    if (twoAhead === cell) {
                                        // Level flight: 2 spaces forward, needs direction selection
                                        actions[actions.length - 1] = `${shotPrefix}${selectedCell}-${cell}/`;
                                        newmove = actions.join(", ");
                                    }
                                }
                            }
                        }
                        break;
                    }
                    case "dive_direction":
                    case "dive_step": {
                        // In dive mode - delegate to handleDiveClick
                        const diveResult = this.handleDiveClick(move, actions, applied, cell);
                        if (diveResult !== move) {
                            newmove = diveResult;
                        }
                        // For completed (extendable) dives, also try starting a new action
                        if (newmove === "" && !applied.isPartial) {
                            newmove = this.trySelectPlane(move, cell);
                            if (newmove === "" && this.canEnterAt(cell, applied)) {
                                newmove = `${move}, enter:${cell}/`;
                            }
                        }
                        // Leave newmove="" if unhandled so fallback can try shooting/switching
                        break;
                    }
                    case "shooting": {
                        // Last action was standalone shoot
                        const clickedPlane = this.board.get(cell);
                        if (clickedPlane !== undefined && clickedPlane[0] !== this.currplayer) {
                            // Chain-shoot: check if this enemy plane can be shot
                            if (this.isInCrosshairsWithBoard(cell, this.currplayer, applied.board)) {
                                const existingTargets = lastAction.slice(1, -1); // Remove parens
                                actions[actions.length - 1] = `(${existingTargets},${cell})`;
                                newmove = actions.join(", ");
                            } else {
                                newmove = move;
                            }
                        } else if (clickedPlane !== undefined && clickedPlane[0] === this.currplayer) {
                            // Clicked own plane - start moving it
                            // No comma after standalone shot since it doesn't count as an action
                            // Use applied.board to account for planes shot earlier in this turn
                            const [, pdir, pheight] = clickedPlane;
                            if (!this.canMoveForward(cell, pdir, applied.board) && pheight <= 1) {
                                newmove = `${move}${cell}X`;
                            } else {
                                newmove = `${move}${cell}`;
                            }
                        } else {
                            // Clicked empty cell - check if starting entry
                            const startingHexes = this.getStartingHexes(this.currplayer);
                            if (startingHexes.includes(cell) && this.planesRemaining[this.currplayer - 1] > 0) {
                                newmove = `${move}enter:${cell}/`;
                            } else {
                                newmove = move;
                            }
                        }
                        break;
                    }
                    case "next_action":
                    case "done": {
                        // Completed action - try to extend dive, or start a new action
                        if (applied.diveState && !applied.diveState.waitingForDir && applied.diveState.currentHeight > 0) {
                            const extendedMove = this.handleDiveClick(move, [...actions], applied, cell);
                            if (extendedMove !== move) {
                                newmove = extendedMove;
                            }
                        }

                        if (newmove === "") {
                            newmove = this.trySelectPlane(move, cell);
                            if (newmove === "" && this.canEnterAt(cell, applied)) {
                                newmove = `${move}, enter:${cell}/`;
                            }
                        }
                        break;
                    }
                }
            }

            // Fallback: switch plane or add shooting to complete action
            if (newmove === "" && move !== "") {
                const applied = this.applyActions(move);
                const actions = this.splitActions(move);
                const clickedPlane = this.board.get(cell);

                if (clickedPlane !== undefined && clickedPlane[0] === this.currplayer) {
                    // Own plane clicked - try to switch if last action is partial
                    if (applied.isPartial) {
                        const partialSoFar = actions.slice(0, -1).join(", ");
                        newmove = this.trySelectPlane(partialSoFar, cell) || move;
                    } else {
                        newmove = move;
                    }
                } else if (clickedPlane !== undefined && clickedPlane[0] !== this.currplayer) {
                    // Enemy plane clicked
                    if (!applied.board.has(cell)) {
                        // Cell was shot this turn - try extending dive to that cell
                        if (applied.diveState && !applied.diveState.waitingForDir && applied.diveState.sequence !== "") {
                            const { currentCell, currentDir, currentHeight } = applied.diveState;
                            const oneAhead = this.moveForward(currentCell, currentDir, applied.board);
                            if (oneAhead === cell && currentHeight >= 1) {
                                const lastAction = actions[actions.length - 1];
                                actions[actions.length - 1] = `${lastAction}>${cell}/`;
                                newmove = actions.join(", ");
                            }
                        }
                    } else if (this.isInCrosshairsWithBoard(cell, this.currplayer, applied.board)) {
                        // Can shoot if action is complete
                        if (!applied.isPartial) {
                            const lastAction = actions[actions.length - 1];
                            const endShootMatch = lastAction.match(/\(([^)]+)\)$/);
                            if (endShootMatch) {
                                const base = lastAction.slice(0, -endShootMatch[0].length);
                                const existingTargets = endShootMatch[1];
                                actions[actions.length - 1] = `${base}(${existingTargets},${cell})`;
                            } else {
                                actions[actions.length - 1] = `${lastAction}(${cell})`;
                            }
                            newmove = actions.join(", ");
                        } else {
                            newmove = move;
                        }
                    } else {
                        newmove = move;
                    }
                } else {
                    newmove = move;
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
            const requiredPlanes = this.getPlanesToMove();
            result.valid = true;
            result.complete = -1;
            // Use different message based on board state
            const planesOnBoard = this.countPlanesOnBoard(this.currplayer);
            const hasShootableInit = this.getShootablePlanes(this.currplayer, this.board).length > 0;
            if (planesOnBoard === 0 && this.planesRemaining[this.currplayer - 1] > 0) {
                // First turn - no planes on board yet, can only enter
                result.message = i18next.t("apgames:validation.crosshairs.INITIAL_INSTRUCTIONS_ENTRY_ONLY", { count: requiredPlanes });
            } else if (this.planesRemaining[this.currplayer - 1] > 0) {
                // Has planes and can still enter more
                result.message = i18next.t("apgames:validation.crosshairs.INITIAL_INSTRUCTIONS", { count: requiredPlanes });
                if (hasShootableInit) {
                    result.message += " " + i18next.t("apgames:validation.crosshairs.CAN_SHOOT");
                }
            } else {
                // No more planes to enter
                if (hasShootableInit) {
                    result.message = i18next.t("apgames:validation.crosshairs.INITIAL_INSTRUCTIONS_NO_ENTRY", { count: requiredPlanes });
                } else {
                    result.message = i18next.t("apgames:validation.crosshairs.INITIAL_INSTRUCTIONS_MOVE_ONLY", { count: requiredPlanes });
                }
            }
            return result;
        }

        m = m.toLowerCase();

        // Cloud phase: single action per turn
        if (this.inCloudPhase()) {
            // Must be cloud placement
            if (!m.startsWith("cloud:")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                return result;
            }

            const cell = m.slice(6);
            // Check if cell exists on board
            try {
                this.graph.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                return result;
            }

            if (this.clouds.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.crosshairs.CLOUD_OCCUPIED", { cell });
                return result;
            }

            if (this.wouldCreateLargeCloud(cell, this.clouds)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.crosshairs.CLOUD_TOO_BIG", { cell });
                return result;
            }

            // All checks passed - valid cloud placement
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // Use applyActions with inline validation
        let applied;
        try {
            applied = this.applyActions(m, { validate: true });
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }

        if (applied.error) {
            result.valid = false;
            result.message = applied.error;
            return result;
        }

        if (applied.isPartial) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            const lastAction = applied.lastAction.toLowerCase();
            const action = this.removeShootNotation(lastAction);
            if (action.startsWith("enter:") && action.endsWith("/")) {
                result.message = i18next.t("apgames:validation.crosshairs.PARTIAL_ENTRY");
            } else if (action.includes("+") || action.includes("-")) {
                result.message = action.endsWith("/")
                    ? i18next.t("apgames:validation.crosshairs.PARTIAL_MOVEMENT")
                    : i18next.t("apgames:validation.crosshairs.PARTIAL_PLANE_MOVE");
            } else if (action.includes("v")) {
                if (action.endsWith("/")) {
                    result.message = i18next.t("apgames:validation.crosshairs.PARTIAL_DIVE_DIR");
                } else {
                    result.message = i18next.t("apgames:validation.crosshairs.PARTIAL_DIVE");
                    if (applied.shootablePlanes.length > 0) {
                        result.message += " " + i18next.t("apgames:validation.crosshairs.CAN_SHOOT");
                    }
                }
            } else {
                // Bare cell selection — only renderable if it's a valid cell
                if (!this.graph.graph.hasNode(action)) {
                    result.valid = false;
                    result.canrender = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                    return result;
                }
                const planeInfo = applied.board.get(action);
                if (planeInfo && planeInfo[2] >= 2) {
                    result.message = i18next.t("apgames:validation.crosshairs.PARTIAL_PLANE_MOVE");
                } else {
                    result.message = i18next.t("apgames:validation.crosshairs.PARTIAL_PLANE_MOVE_NO_DIVE");
                }
            }
            return result;
        }

        // All actions validated — check turn completeness
        const requiredActions = this.getPlanesToMove();
        if (applied.completedActionCount < requiredActions) {
            const remaining = requiredActions - applied.completedActionCount;
            result.valid = true;
            result.complete = -1;
            result.canrender = true;

            // Check if last action is a complete dive step that can be continued
            if (applied.diveState && !applied.diveState.waitingForDir && applied.diveState.sequence !== "") {
                result.message = i18next.t("apgames:validation.crosshairs.DIVE_CONTINUE_OR_END");
                if (applied.shootablePlanes.length > 0) {
                    result.message += " " + i18next.t("apgames:validation.crosshairs.CAN_SHOOT");
                }
                return result;
            }

            const hasShootable = applied.shootablePlanes.length > 0;
            if (this.planesRemaining[this.currplayer - 1] > 0) {
                result.message = i18next.t("apgames:validation.crosshairs.NEED_MORE_PLANES", { count: remaining });
                if (hasShootable) {
                    result.message += " " + i18next.t("apgames:validation.crosshairs.CAN_SHOOT");
                }
            } else {
                if (hasShootable) {
                    result.message = i18next.t("apgames:validation.crosshairs.NEED_MORE_PLANES_NO_ENTRY", { count: remaining });
                } else {
                    result.message = i18next.t("apgames:validation.crosshairs.NEED_MORE_PLANES", { count: remaining });
                }
            }
            return result;
        }

        // Check if dive can continue (even with all required actions complete)
        if (applied.diveState && !applied.diveState.waitingForDir &&
            applied.diveState.sequence !== "" && applied.diveState.currentHeight >= 1) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.crosshairs.DIVE_CONTINUE_OR_END");
            if (applied.shootablePlanes.length > 0) {
                result.message += " " + i18next.t("apgames:validation.crosshairs.CAN_SHOOT");
            }
            return result;
        }

        // Turn movements complete — check for optional shooting
        if (applied.shootablePlanes.length > 0) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.crosshairs.MOVE_COMPLETE_CAN_SHOOT");
            return result;
        }

        // Turn is fully complete
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * Unified action processor: clones the board, iterates over all actions in move string m,
     * applies each one (movement + shooting), and returns rich state.
     *
     * opts.validate: directly validate each action (no clone, no moves() call)
     * opts.generateResults: populate results array (for move())
     */
    private applyActions(m: string, opts?: {
        validate?: boolean;
        generateResults?: boolean;
        baseBoard?: Map<string, PlaneInfo>;
        basePlanesRemaining?: [number, number];
    }): IApplyResult {
        const validate = opts?.validate ?? false;
        const generateResults = opts?.generateResults ?? false;

        const board = this.copyBoard(opts?.baseBoard ?? this.board);
        const planesRemaining: [number, number] = opts?.basePlanesRemaining
            ? [...opts.basePlanesRemaining] : [...this.planesRemaining];
        const results: APMoveResult[] = [];
        const movedPlanes = new Set<string>();
        let completedActionCount = 0;
        let lastAction = "";
        let diveState: IDiveState | null = null;
        let isPartial = false;
        let error: string | null = null;
        let partialState: PartialState = { type: "next_action" };

        const inv = (move: string) => i18next.t("apgames:validation._general.INVALID_MOVE", { move }) || `Invalid move: ${move}`;

        if (!m || m.length === 0) {
            return {
                board, planesRemaining, results, movedPlanes,
                completedActionCount, lastAction, diveState, isPartial,
                error, shootablePlanes: this.getShootablePlanes(this.currplayer, board),
                partialState: { type: "next_action" },
            };
        }

        const actions = this.splitActions(m);

        // Helper: apply shooting targets to the working board.
        // Validates crosshairs when validate=true. Processes sequentially (chain shooting).
        const applyShots = (targets: string[], boardState: Map<string, PlaneInfo>, context: string): string | null => {
            for (const target of targets) {
                if (validate) {
                    if (!this.isInCrosshairsWithBoard(target, this.currplayer, boardState)) {
                        return inv(context);
                    }
                }
                boardState.delete(target);
                if (generateResults) {
                    results.push({ type: "capture", where: target, what: "plane" });
                }
            }
            return null;
        };

        // Helper: validate that fromCell has a movable plane for current player
        const validatePlane = (fromCell: string, action: string): PlaneInfo | null => {
            const info = board.get(fromCell);
            if (!info) { error = inv(action); return null; }
            if (info[0] !== this.currplayer) { error = inv(action); return null; }
            if (movedPlanes.has(fromCell)) { error = inv(action); return null; }
            return info;
        };

        // Helper: validate direction is a valid turn from currentDir
        const validateDir = (newDir: HexDir | undefined, currentDir: HexDir, action: string): boolean => {
            if (newDir === undefined) return true; // keep current, always valid
            if (!allDirections.includes(newDir)) { error = inv(action); return false; }
            if (!this.isValidTurn(currentDir, newDir)) { error = inv(action); return false; }
            return true;
        };

        // Helper: check that target cell is reachable forward 1 space
        const isOneAhead = (fromCell: string, dir: HexDir, toCell: string): boolean => {
            const next = this.moveForward(fromCell, dir, board);
            return next === toCell;
        };

        for (let i = 0; i < actions.length; i++) {
            const rawAction = actions[i];
            lastAction = rawAction;
            diveState = null;

            const shootTargets = this.extractShootTargets(rawAction);
            const action = this.removeShootNotation(rawAction).toLowerCase();

            // --- Standalone shoot "(e5)" or "(e5,e6)" ---
            if (action === "" && shootTargets.length > 0) {
                const shotErr = applyShots(shootTargets, board, rawAction);
                if (shotErr) { error = shotErr; break; }
                partialState = { type: "shooting" };
                continue;
            }

            // --- Parse action ---
            let parsed;
            try {
                parsed = this.parseMove(action);
            } catch {
                // Bare cell selection (e.g. "a2" or "(e5)a2") — partial
                // Apply any embedded shots first (e.g., the (e5) in "(e5)a2")
                if (shootTargets.length > 0) {
                    const shotErr = applyShots(shootTargets, board, rawAction);
                    if (shotErr) { error = shotErr; break; }
                }
                isPartial = true;
                const cellName = action;
                const planeInfo = board.get(cellName);
                if (planeInfo && planeInfo[0] === this.currplayer) {
                    partialState = { type: "plane_selected", selectedCell: cellName, dir: planeInfo[1], height: planeInfo[2] };
                } else {
                    partialState = { type: "plane_selected", selectedCell: cellName, dir: "N" as HexDir, height: 0 };
                }
                break;
            }

            // --- Enter ---
            if (parsed.type === "enter") {
                const cell = parsed.cell!;
                const dir = parsed.dir;
                if (!dir) {
                    isPartial = true;
                    partialState = { type: "entry_direction", entryCell: cell };
                    break;
                }
                if (validate) {
                    if (planesRemaining[this.currplayer - 1] <= 0) { error = inv(action); break; }
                    if (board.has(cell)) { error = inv(action); break; }
                    const startingHexes = this.getStartingHexes(this.currplayer);
                    if (!startingHexes.includes(cell)) { error = inv(action); break; }
                    if (!allDirections.includes(dir)) { error = inv(action); break; }
                }
                board.set(cell, [this.currplayer, dir, 0]);
                planesRemaining[this.currplayer - 1]--;
                movedPlanes.add(cell);
                if (generateResults) {
                    results.push({ type: "place", what: "plane", where: cell });
                    results.push({ type: "orient", where: cell, facing: dir });
                }
                if (shootTargets.length > 0) {
                    const shotErr = applyShots(shootTargets, board, rawAction);
                    if (shotErr) { error = shotErr; break; }
                }
                completedActionCount++;
                partialState = { type: "next_action" };

            // --- Move ---
            } else if (parsed.type === "move") {
                const fromCell = parsed.cell!;
                const info = validate ? validatePlane(fromCell, action) : board.get(fromCell);
                if (!info) {
                    if (error) break; // validatePlane set error
                    // No plane at fromCell in non-validate mode, skip
                    completedActionCount++;
                    partialState = { type: "next_action" };
                    continue;
                }
                const [owner, currentDir, currentHeight] = info;

                if (parsed.moveType === "crash") {
                    if (validate) {
                        // Crash is only valid when plane can't move forward AND height <= 1
                        if (this.canMoveForward(fromCell, currentDir, board) || currentHeight > 1) {
                            error = inv(action); break;
                        }
                    }
                    board.delete(fromCell);
                    movedPlanes.add(fromCell);
                    if (generateResults) {
                        results.push({ type: "destroy", what: "plane", where: fromCell });
                    }
                    if (shootTargets.length > 0) {
                        const shotErr = applyShots(shootTargets, board, rawAction);
                        if (shotErr) { error = shotErr; break; }
                    }
                    completedActionCount++;
                    partialState = { type: "next_action" };

                } else if (parsed.moveType === "climb") {
                    if (!parsed.target || action.endsWith("/")) {
                        isPartial = true;
                        partialState = { type: "move_direction", fromCell, targetCell: parsed.target || "", moveType: "climb", currentDir };
                        break;
                    }
                    const toCell = parsed.target;
                    const newDir = parsed.dir || currentDir;
                    // Split shots: embedded (at start) vs trailing (after move)
                    const embeddedMatch = rawAction.match(/^\([^)]+\)/);
                    const embeddedShots = embeddedMatch
                        ? embeddedMatch[0].slice(1, -1).split(",").map(s => s.trim().toLowerCase())
                        : [];
                    const trailingShots = embeddedMatch
                        ? this.extractShootTargets(rawAction.slice(embeddedMatch[0].length))
                        : shootTargets;
                    // Apply embedded shots BEFORE validation so target cell is clear
                    if (embeddedShots.length > 0) {
                        const shotErr = applyShots(embeddedShots, board, rawAction);
                        if (shotErr) { error = shotErr; break; }
                    }
                    if (validate) {
                        if (!isOneAhead(fromCell, currentDir, toCell)) { error = inv(action); break; }
                        if (!validateDir(parsed.dir, currentDir, action)) break;
                    }
                    const newHeight = Math.min(currentHeight + 1, 6);
                    board.delete(fromCell);
                    board.set(toCell, [owner, newDir, newHeight]);
                    movedPlanes.add(toCell);
                    if (generateResults) {
                        results.push({ type: "move", from: fromCell, to: toCell, what: "plane" });
                        if (newDir !== currentDir) {
                            results.push({ type: "orient", where: toCell, facing: newDir });
                        }
                    }
                    // Apply trailing shots AFTER the move
                    if (trailingShots.length > 0) {
                        const shotErr = applyShots(trailingShots, board, rawAction);
                        if (shotErr) { error = shotErr; break; }
                    }
                    completedActionCount++;
                    partialState = { type: "next_action" };

                } else if (parsed.moveType === "level") {
                    if (!parsed.target || action.endsWith("/")) {
                        isPartial = true;
                        partialState = { type: "move_direction", fromCell, targetCell: parsed.target || "", moveType: "level", currentDir };
                        break;
                    }
                    const toCell = parsed.target;
                    const newDir = parsed.dir || currentDir;
                    // Split shots: embedded (at start) vs trailing (after move)
                    const embeddedMatch = rawAction.match(/^\([^)]+\)/);
                    const embeddedShots = embeddedMatch
                        ? embeddedMatch[0].slice(1, -1).split(",").map(s => s.trim().toLowerCase())
                        : [];
                    const trailingShots = embeddedMatch
                        ? this.extractShootTargets(rawAction.slice(embeddedMatch[0].length))
                        : shootTargets;
                    // Apply embedded shots BEFORE validation so target cell is clear
                    if (embeddedShots.length > 0) {
                        const shotErr = applyShots(embeddedShots, board, rawAction);
                        if (shotErr) { error = shotErr; break; }
                    }
                    if (validate) {
                        // 1 or 2 spaces forward
                        const one = this.moveForward(fromCell, currentDir, board);
                        if (one === toCell) {
                            // 1-space level flight, OK
                        } else if (one !== undefined) {
                            const two = this.moveForward(one, currentDir, board);
                            if (two !== toCell) { error = inv(action); break; }
                        } else {
                            error = inv(action); break;
                        }
                        if (!validateDir(parsed.dir, currentDir, action)) break;
                    }
                    board.delete(fromCell);
                    board.set(toCell, [owner, newDir, currentHeight]);
                    movedPlanes.add(toCell);
                    if (generateResults) {
                        results.push({ type: "move", from: fromCell, to: toCell, what: "plane" });
                        if (newDir !== currentDir) {
                            results.push({ type: "orient", where: toCell, facing: newDir });
                        }
                    }
                    // Apply trailing shots AFTER the move
                    if (trailingShots.length > 0) {
                        const shotErr = applyShots(trailingShots, board, rawAction);
                        if (shotErr) { error = shotErr; break; }
                    }
                    completedActionCount++;
                    partialState = { type: "next_action" };

                } else if (parsed.moveType === "dive") {
                    const diveSequence = parsed.diveSequence || "";
                    if (diveSequence === "" || action.endsWith("v")) {
                        isPartial = true;
                        diveState = {
                            fromCell,
                            currentCell: fromCell,
                            currentDir: currentDir,
                            currentHeight: currentHeight,
                            sequence: "",
                            origSequence: "",
                            waitingForDir: false,
                        };
                        partialState = { type: "dive_step" };
                        break;
                    }

                    if (validate && currentHeight <= 0) { error = inv(action); break; }

                    // Parse original action to get steps with shooting notation
                    const origVIdx = rawAction.indexOf("v");
                    const origSequence = rawAction.substring(origVIdx + 1);
                    const stepsWithShoots = origSequence.split(">");

                    // Handle embedded shots BEFORE the dive (before "v"), e.g., "(e5)g6vf6"
                    const beforeV = rawAction.substring(0, origVIdx);
                    const embeddedDiveShots = this.extractShootTargets(beforeV);
                    if (embeddedDiveShots.length > 0) {
                        const shotErr = applyShots(embeddedDiveShots, board, rawAction);
                        if (shotErr) { error = shotErr; break; }
                    }

                    let cell = fromCell;
                    let height = currentHeight;
                    let dir = currentDir;
                    let prevCell = fromCell; // track previous cell for board cleanup
                    let diveIsPartial = false;

                    for (const stepWithShoot of stepsWithShoots) {
                        const stepTargets = this.extractShootTargets(stepWithShoot);
                        const step = this.removeShootNotation(stepWithShoot).toLowerCase();
                        const stepIsPartial = step.endsWith("/") || step === "";

                        if (step.startsWith("p")) {
                            // Power dive: stay in same cell, -2 height
                            if (validate && height < 2) { error = inv(rawAction); break; }
                            height -= 2;
                            if (generateResults && step !== "") {
                                results.push({ type: "move", from: cell, to: cell, what: "plane", how: "power-dive" });
                            }
                            if (step.includes("/")) {
                                const dirPart = step.split("/")[1].toUpperCase() as HexDir;
                                if (dirPart && dirPart.length > 0 && allDirections.includes(dirPart)) {
                                    if (validate && !this.isValidTurn(dir, dirPart)) { error = inv(rawAction); break; }
                                    dir = dirPart;
                                }
                            }
                        } else {
                            const parts = step.split("/");
                            const nextCell = parts[0];
                            if (nextCell && nextCell.length > 0) {
                                // Swoop: move to cell, -1 height
                                if (validate) {
                                    if (height < 1) { error = inv(rawAction); break; }
                                    // Must be exactly 1 ahead in current direction
                                    // Check against board with the plane still at 'cell'
                                    const expected = this.moveForward(cell, dir, board);
                                    if (expected !== nextCell) { error = inv(rawAction); break; }
                                }
                                if (generateResults) {
                                    results.push({ type: "move", from: cell, to: nextCell, what: "plane", how: "swoop" });
                                }
                                cell = nextCell;
                                height--;
                                if (parts[1] && parts[1].length > 0) {
                                    const dirPart = parts[1].toUpperCase() as HexDir;
                                    if (validate && !this.isValidTurn(dir, dirPart)) { error = inv(rawAction); break; }
                                    if (allDirections.includes(dirPart)) {
                                        dir = dirPart;
                                    }
                                }
                            }
                        }
                        if (error) break;

                        if (stepIsPartial) {
                            diveIsPartial = true;
                        }

                        // Update board: move plane from previous position to current
                        if (prevCell !== cell) {
                            board.delete(prevCell);
                        }
                        board.set(cell, [owner, dir, height]);
                        prevCell = cell;

                        // Apply shooting after this step
                        if (stepTargets.length > 0) {
                            const shotErr = applyShots(stepTargets, board, rawAction);
                            if (shotErr) { error = shotErr; break; }
                        }
                    }
                    if (error) break;

                    // Ensure fromCell is cleaned up (in case prevCell tracking missed it)
                    if (fromCell !== cell) {
                        board.delete(fromCell);
                    }
                    board.set(cell, [owner, dir, height]);

                    movedPlanes.add(cell);

                    // Build dive state — use rawAction for origSequence to preserve
                    // shooting notation and case (e.g. "f6(e5)>P/SW")
                    const rawVIdx = rawAction.toLowerCase().indexOf("v");
                    const rawOrigSequence = rawAction.substring(rawVIdx + 1);
                    const cleanSequence = this.removeShootNotation(rawOrigSequence).toLowerCase();
                    diveState = {
                        fromCell,
                        currentCell: cell,
                        currentDir: dir,
                        currentHeight: height,
                        sequence: cleanSequence,
                        origSequence: rawOrigSequence,
                        waitingForDir: cleanSequence.endsWith("/"),
                    };

                    if (diveIsPartial) {
                        isPartial = true;
                        partialState = diveState!.waitingForDir ? { type: "dive_direction" } : { type: "dive_step" };
                        break;
                    }
                    completedActionCount++;
                    partialState = { type: "next_action" };
                }
            }

            if (error) break;
        }

        // Refine partialState after the loop for completed (non-partial, non-error) results
        if (!error && !isPartial && partialState.type === "next_action") {
            if (diveState && !diveState.waitingForDir && diveState.currentHeight > 0) {
                partialState = { type: "dive_step" };
            } else if (completedActionCount >= this.getPlanesToMove()) {
                partialState = { type: "done" };
            }
        }

        return {
            board, planesRemaining, results, movedPlanes,
            completedActionCount, lastAction, diveState, isPartial,
            error,
            shootablePlanes: error ? [] : this.getShootablePlanes(this.currplayer, board),
            partialState,
        };
    }

    // Calculate which cells to highlight as click hints based on the current partial move state
    private getClickHints(partialMove: string): IClickHint[] {
        const hints: IClickHint[] = [];

        // Helper to add direction chevron hints
        const addDirectionHints = (fromCell: string, dirs: HexDir[]) => {
            for (const dir of dirs) {
                const cells = this.getAdjacentCells(fromCell, [dir]);
                if (cells.length > 0) {
                    hints.push({
                        cell: cells[0],
                        shape: "chevron",
                        rotation: dirToRotation.get(dir)!,
                    });
                }
            }
        };

        // Helper to check if hint already exists for cell
        const hasHint = (cell: string) => hints.some(h => h.cell === cell);

        // Don't highlight on empty move (brand new turn)
        if (partialMove === "" || partialMove.length === 0) {
            return hints;
        }

        // Cloud phase: no hints
        if (this.inCloudPhase()) {
            return hints;
        }

        // Use applyActions to get current board state after partial moves.
        // Start from stack (canonical start-of-turn state) since move() already
        // applied the partial to this.board via processSingleAction.
        const stackState = this.stack[this.stack.length - 1];
        const applied = this.applyActions(partialMove, {
            baseBoard: stackState.board,
            basePlanesRemaining: stackState.planesRemaining as [number, number],
        });
        const workingBoard = applied.board;
        const diveState = applied.diveState;
        const movedPlanes = applied.movedPlanes;

        // Use the canonical start-of-turn calculation for required actions
        const requiredActions = this.getRequiredActionsFromStack();

        // Helper: show unmoved planes, entry cells, and shootable enemies
        const addNextActionHints = () => {
            if (applied.completedActionCount < requiredActions) {
                for (const [c, info] of workingBoard) {
                    if (info[0] === this.currplayer && !movedPlanes.has(c) && !hasHint(c)) {
                        hints.push({ cell: c });
                    }
                }
                if (applied.planesRemaining[this.currplayer - 1] > 0) {
                    const startingHexes = this.getStartingHexes(this.currplayer);
                    for (const c of startingHexes) {
                        if (!workingBoard.has(c) && !hasHint(c)) {
                            hints.push({ cell: c });
                        }
                    }
                }
            }
            for (const c of this.getShootablePlanes(this.currplayer, workingBoard)) {
                if (!hasHint(c)) {
                    hints.push({ cell: c, shape: "explosion" });
                }
            }
        };

        switch (applied.partialState.type) {
            case "entry_direction": {
                const { entryCell } = applied.partialState;
                addDirectionHints(entryCell, allDirections);
                break;
            }
            case "move_direction": {
                const { targetCell, currentDir } = applied.partialState;
                if (targetCell && this.graph.graph.hasNode(targetCell)) {
                    const [leftDir, rightDir] = adjacentDirs(currentDir);
                    addDirectionHints(targetCell, [currentDir, leftDir, rightDir]);
                }
                break;
            }
            case "plane_selected": {
                const { selectedCell, dir, height } = applied.partialState;
                if (!this.graph.graph.hasNode(selectedCell)) {
                    break;
                }
                const [x, y] = this.graph.algebraic2coords(selectedCell);
                const internalDir = visualToInternal.get(dir)!;

                // 1 ahead (climb) - regular circle
                const oneAhead = this.graph.move(x, y, internalDir);
                if (oneAhead !== undefined) {
                    const oneAheadCell = this.graph.coords2algebraic(...oneAhead);
                    if (!workingBoard.has(oneAheadCell)) {
                        hints.push({ cell: oneAheadCell });
                    }
                    // 2 ahead (level) - only if 1 ahead is not blocked
                    const twoAhead = this.graph.move(oneAhead[0], oneAhead[1], internalDir);
                    if (twoAhead !== undefined && !workingBoard.has(oneAheadCell)) {
                        const twoAheadCell = this.graph.coords2algebraic(...twoAhead);
                        if (!workingBoard.has(twoAheadCell)) {
                            hints.push({ cell: twoAheadCell });
                        }
                    }
                }
                // Dive: same cell (only if height >= 2) - ring
                if (height >= 2) {
                    hints.push({ cell: selectedCell, shape: "ring" });
                }
                break;
            }
            case "dive_direction": {
                // Dive waiting for direction
                const { currentCell, currentDir } = diveState!;
                const [leftDir, rightDir] = adjacentDirs(currentDir);
                addDirectionHints(currentCell, [currentDir, leftDir, rightDir]);
                break;
            }
            case "dive_step": {
                // In dive mode - highlight swoop (1 ahead) and power dive (same cell)
                const { currentCell, currentDir, currentHeight } = diveState!;

                if (currentHeight >= 1) {
                    const oneAhead = this.moveForward(currentCell, currentDir, workingBoard);
                    if (oneAhead) {
                        hints.push({ cell: oneAhead });
                    }
                }
                if (currentHeight >= 2) {
                    hints.push({ cell: currentCell, shape: "ring-large" });
                }

                // If dive step is complete (extendable), show other planes and entry
                if (!applied.isPartial) {
                    if (applied.completedActionCount < requiredActions) {
                        for (const [c, info] of workingBoard) {
                            if (info[0] === this.currplayer && !movedPlanes.has(c) && !hasHint(c)) {
                                hints.push({ cell: c });
                            }
                        }
                        if (this.planesRemaining[this.currplayer - 1] > 0) {
                            const startingHexes = this.getStartingHexes(this.currplayer);
                            for (const c of startingHexes) {
                                if (!workingBoard.has(c) && !hasHint(c)) {
                                    hints.push({ cell: c });
                                }
                            }
                        }
                    }
                }
                // Show shootable enemy planes only when dive step is complete (extendable)
                // During an in-progress dive step, you must first click swoop/power-dive destination
                if (!applied.isPartial) {
                    for (const c of this.getShootablePlanes(this.currplayer, workingBoard)) {
                        if (!hasHint(c)) {
                            hints.push({ cell: c, shape: "explosion" });
                        }
                    }
                }
                break;
            }
            case "shooting":
            case "next_action":
            case "done": {
                addNextActionHints();
                break;
            }
        }

        return hints;
    }

    public move(m: string, { partial = false, trusted = false } = {}): CrosshairsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // For partial moves, just apply and return
            // complete === -1 means truly incomplete (needs more input)
            // complete === 0 means submittable (optional actions like shooting remain)
            // complete === 1 means fully complete
            if (result.complete === -1) {
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
            // Non-cloud phase: apply all actions via unified processor
            const applied = this.applyActions(m, { generateResults: true });
            this.board = applied.board;
            this.planesRemaining = applied.planesRemaining;
            this.results = applied.results;
        }

        if (partial) {
            // Populate click hints for partial moves
            this.dots = this.getClickHints(m);
            return this;
        }

        // Clear click hints for complete moves
        this.dots = [];

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
            if (planeCount + remaining <= 1 && !this.inCloudPhase()) {
                this.gameover = true;
                this.winner = [player === 1 ? 2 : 1];
                this.results.push({ type: "eog" });
                this.results.push({ type: "winners", players: [...this.winner] });
                break;
            }
        }
        return this;
    }

    public randomMove(sillymoves = false): string {
        // Cloud phase: pick a random valid cloud cell
        if (this.inCloudPhase()) {
            const validCells: string[] = [];
            for (const cell of this.graph.listCells() as string[]) {
                if (!this.clouds.has(cell) && !this.wouldCreateLargeCloud(cell, this.clouds)) {
                    validCells.push(cell);
                }
            }
            if (validCells.length === 0) {
                throw new Error("No valid cloud placements available");
            }
            return `cloud:${validCells[Math.floor(Math.random() * validCells.length)]}`;
        }

        // Non-cloud phase: simulate random clicks to build a move
        let move = "";

        for (let iteration = 0; iteration < 200; iteration++) {
            // Check if move is already complete
            const validation = this.validateMove(move);
            if (validation.complete === 1) {
                return sillymoves ? this.applySillyMoves(move) : move;
            }

            // Get valid click targets
            let validCells: string[] = [];

            if (move === "") {
                // Initial state: no click hints, so manually determine valid first clicks
                // Own planes that can be moved
                for (const [cell, info] of this.board) {
                    if (info[0] === this.currplayer) {
                        validCells.push(cell);
                        // Bias toward high-altitude planes (more dive options)
                        if (sillymoves && info[2] >= 2) {
                            for (let i = 0; i < info[2] - 1; i++) {
                                validCells.push(cell);
                            }
                        }
                    }
                }
                // Entry cells (if planes remaining)
                if (this.planesRemaining[this.currplayer - 1] > 0) {
                    const startingHexes = this.getStartingHexes(this.currplayer);
                    for (const cell of startingHexes) {
                        if (!this.board.has(cell)) {
                            validCells.push(cell);
                        }
                    }
                }
                // Shootable enemies (at start of turn)
                const shootable = this.getShootablePlanes(this.currplayer, this.board);
                validCells.push(...shootable);
            } else {
                // Use getClickHints to determine valid clicks
                const hints = this.getClickHints(move);
                validCells = hints.map(h => h.cell);

                // Bias toward dives: give extra weight to ring/ring-large hints
                // (dive start and power dive continuation), proportional to height.
                if (sillymoves) {
                    for (const hint of hints) {
                        if (hint.shape === "ring" || hint.shape === "ring-large") {
                            // Look up the plane's height at this cell
                            const stackState = this.stack[this.stack.length - 1];
                            const applied = this.applyActions(move, {
                                baseBoard: stackState.board,
                                basePlanesRemaining: stackState.planesRemaining as [number, number],
                            });
                            const planeInfo = applied.board.get(hint.cell);
                            const height = planeInfo ? planeInfo[2] : (applied.diveState?.currentHeight ?? 2);
                            // Add the dive cell extra times proportional to height
                            for (let i = 0; i < height; i++) {
                                validCells.push(hint.cell);
                            }
                        }
                    }
                }
            }

            // If no valid clicks, we're done (or stuck)
            if (validCells.length === 0) {
                if (validation.complete === 0) {
                    return sillymoves ? this.applySillyMoves(move) : move;
                }
                // Special case: plane flew into corner, waiting for direction but no valid clicks
                // Just remove the trailing "/" to keep plane facing straight ahead
                if (move.endsWith("/")) {
                    move = move.slice(0, -1);
                    continue;
                }
                throw new Error(`No valid clicks from "${move}" but move is incomplete`);
            }

            // If actions are complete (complete=0), randomly decide to end without shooting
            if (validation.complete === 0 && Math.random() < 0.5) {
                return sillymoves ? this.applySillyMoves(move) : move;
            }

            // Pick a random valid click and apply it
            const randomCell = validCells[Math.floor(Math.random() * validCells.length)];
            const [col, row] = this.graph.algebraic2coords(randomCell);
            const clickResult = this.handleClick(move, row, col);

            if (clickResult.move !== move) {
                move = clickResult.move;
            }
            // If click didn't change move, loop will try again
        }

        throw new Error(`Could not complete random move after 200 iterations - partial: "${move}"`);
    }

    // Post-process a move to randomly downgrade climbs to levels or dives.
    // A climb "src+dst/DIR" to 1-ahead can also be expressed as level "src-dst/DIR"
    // or dive "src vdst/DIR", producing different heights. These are valid moves
    // but not reachable via click UI (which always generates climbs to 1-ahead).
    private applySillyMoves(move: string): string {
        const stackState = this.stack[this.stack.length - 1];
        const baseBoard = stackState.board as Map<string, PlaneInfo>;
        const actions = this.splitActions(move);
        const newActions: string[] = [];

        for (const action of actions) {
            const clean = this.removeShootNotation(action);
            // Match climbs: "src+dst" or "src+dst/DIR"
            const climbMatch = clean.match(/^([a-z]\d+)\+([a-z]\d+)(\/[A-Z]+)?$/);
            if (climbMatch) {
                const src = climbMatch[1];
                // Look up the plane's height from the board state at start of turn
                const planeInfo = baseBoard.get(src);
                if (planeInfo) {
                    const height = planeInfo[2];
                    const roll = Math.random();
                    if (roll < 0.15) {
                        // Level flight to 1-ahead (same height)
                        newActions.push(action.replace("+", "-"));
                        continue;
                    } else if (roll < 0.30 && height >= 1) {
                        // Dive to 1-ahead (height - 1)
                        newActions.push(action.replace("+", "v"));
                        continue;
                    }
                }
            }
            newActions.push(action);
        }

        const result = newActions.join(",");
        // Validate the silly move — if invalid, fall back to original
        const validation = this.validateMove(result);
        if (validation.valid && validation.complete !== undefined && validation.complete >= 0) {
            return result;
        }
        return move;
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

    public getCustomRotation(): number {
        return 0;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        // Check for abstract display mode
        const abstractMode = opts?.altDisplay === "abstract";

        // Build legend for planes with altitude indicators
        const myLegend: { [key: string]: Glyph | [Glyph, ...Glyph[]] } = {};

        const altitudeColor = "#87CEEB"; // Light blue
        const wedgeScale = 1.34;

        // Helper type for wedge specifications
        type WedgeSpec = {
            type: "wedge" | "wedge-top-half" | "wedge-bottom-half";
            rotation: number;
        };

        // Helper to get wedge specifications for a given plane rotation and height
        // Wedges fill from the front (plane direction) outward as height increases
        // Base wedge rotation = plane rotation + 90
        const getWedgesForHeight = (planeRotation: number, height: number): WedgeSpec[] => {
            if (height === 0) return [];

            const base = planeRotation + 90;
            const wedges: WedgeSpec[] = [];

            // Normalize rotation to 0-360 range
            const normalize = (r: number) => ((r % 360) + 360) % 360;

            // Height 1+: base wedge (front)
            if (height >= 1) {
                wedges.push({ type: "wedge", rotation: normalize(base) });
            }

            // Height 2: add half wedges at adjacent positions (±60)
            // Height 3+: adjacent positions become full wedges
            if (height === 2) {
                wedges.push({ type: "wedge-top-half", rotation: normalize(base - 60) });
                wedges.push({ type: "wedge-bottom-half", rotation: normalize(base + 60) });
            } else if (height >= 3) {
                wedges.push({ type: "wedge", rotation: normalize(base - 60) });
                wedges.push({ type: "wedge", rotation: normalize(base + 60) });
            }

            // Height 4: add half wedges at back-adjacent positions (±120)
            // Height 5+: back-adjacent positions become full wedges
            if (height === 4) {
                wedges.push({ type: "wedge-top-half", rotation: normalize(base - 120) });
                wedges.push({ type: "wedge-bottom-half", rotation: normalize(base + 120) });
            } else if (height >= 5) {
                wedges.push({ type: "wedge", rotation: normalize(base - 120) });
                wedges.push({ type: "wedge", rotation: normalize(base + 120) });
            }

            // Height 6: add back wedge (+180)
            if (height >= 6) {
                wedges.push({ type: "wedge", rotation: normalize(base + 180) });
            }

            return wedges;
        };

        // Cloud glyph (defined first so we can use it in plane legends)
        // Abstract mode: white disc
        // Regular mode: fluffy cloud shape
        const cloudGlyph: Glyph = abstractMode
            ? {
                name: "piece",
                colour: "#ffffff",
                opacity: 0.5,
            }
            : {
                name: "cloud",
                colour: "#ffffff",
                opacity: 0.7,
                rotate: 270,
                scale: 1.5,
            };
        myLegend["cloud"] = cloudGlyph;

        // Create plane glyphs for each direction, player, and height combination
        // Abstract mode: use arrowhead (chevron) glyph
        // Regular mode: use plane glyph
        for (const player of [1, 2]) {
            for (const dir of allDirections) {
                const planeRotation = dirToRotation.get(dir)!;
                const planeGlyph: Glyph = abstractMode
                    ? {
                        name: "arrowhead",
                        colour: player,
                        rotate: planeRotation,
                    }
                    : {
                        name: "plane",
                        colour: player,
                        rotate: planeRotation,
                    };

                // Height 0 - just the plane
                myLegend[`P${player}${dir}_0`] = planeGlyph;
                // Height 0 in cloud - plane with cloud on top
                myLegend[`P${player}${dir}_0_cloud`] = [planeGlyph, cloudGlyph];

                // Heights 1-6 - plane with altitude wedges
                for (let height = 1; height <= 6; height++) {
                    const glyphs: Glyph[] = [];

                    // Add altitude wedges first (so they're behind the plane)
                    const wedgeSpecs = getWedgesForHeight(planeRotation, height);
                    for (const spec of wedgeSpecs) {
                        glyphs.push({
                            name: spec.type,
                            rotate: spec.rotation,
                            scale: wedgeScale,
                            colour: altitudeColor,
                        });
                    }

                    // Add the plane on top
                    glyphs.push(planeGlyph);

                    myLegend[`P${player}${dir}_${height}`] = glyphs as [Glyph, ...Glyph[]];
                    // In-cloud variant with cloud on top of everything
                    const cloudGlyphs: [Glyph, ...Glyph[]] = [glyphs[0], ...glyphs.slice(1), cloudGlyph];
                    myLegend[`P${player}${dir}_${height}_cloud`] = cloudGlyphs;
                }
            }
        }

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
                    // If plane is in a cloud, use the cloud overlay variant
                    if (this.clouds.has(cell)) {
                        pieces.push(`P${owner}${dir}_${height}_cloud`);
                    } else {
                        pieces.push(`P${owner}${dir}_${height}`);
                    }
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

        // Add entry hex markers during entry phase
        if (this.inEntryPhase()) {
            for (const player of [1, 2] as playerid[]) {
                const startingHexes = this.getStartingHexes(player);
                for (const cell of startingHexes) {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    markers.push({
                        type: "flood",
                        colour: player,
                        opacity: 0.3,
                        points: [{ row: y, col: x }],
                    });
                }
            }
        }

        const rep: APRenderRep = {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                rotate: 90,
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

        // Add click hint dots grouped by shape and rotation
        if (this.dots.length > 0) {
            if (rep.annotations === undefined) {
                rep.annotations = [];
            }
            // Group hints by shape and rotation
            const groups = new Map<string, IClickHint[]>();
            for (const hint of this.dots) {
                const shape = hint.shape ?? "circle";
                const rotation = hint.rotation ?? 0;
                const key = `${shape}:${rotation}`;
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key)!.push(hint);
            }
            // Create annotation for each group
            for (const [key, hints] of groups) {
                const [shape, rotStr] = key.split(":");
                const rotation = parseInt(rotStr, 10);
                const points: RowCol[] = hints.map(h => {
                    const [x, y] = this.graph.algebraic2coords(h.cell);
                    return { row: y, col: x };
                });
                const annotation: {
                    type: "dots";
                    targets: [RowCol, ...RowCol[]];
                    dotShape?: "circle" | "ring" | "ring-large" | "chevron" | "explosion";
                    rotation?: number;
                } = {
                    type: "dots",
                    targets: points as [RowCol, ...RowCol[]],
                };
                if (shape !== "circle") {
                    annotation.dotShape = shape as "ring" | "ring-large" | "chevron" | "explosion";
                }
                if (rotation !== 0) {
                    annotation.rotation = rotation;
                }
                rep.annotations.push(annotation);
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.what === "plane") {
                    node.push(i18next.t("apresults:PLACE.crosshairs_plane", { player, where: r.where }));
                } else if (r.what === "cloud") {
                    node.push(i18next.t("apresults:PLACE.crosshairs_cloud", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "move":
                if (r.how === "swoop") {
                    node.push(i18next.t("apresults:MOVE.crosshairs_swoop", { player, from: r.from, to: r.to }));
                } else if (r.how === "power-dive") {
                    node.push(i18next.t("apresults:MOVE.crosshairs_power-dive", { player, from: r.from }));
                } else {
                    node.push(i18next.t("apresults:MOVE.crosshairs", { player, from: r.from, to: r.to }));
                }
                resolved = true;
                break;
            case "orient":
                node.push(i18next.t("apresults:ORIENT.crosshairs", { player, where: r.where, facing: r.facing }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.crosshairs", { player, where: r.where }));
                resolved = true;
                break;
            case "destroy":
                node.push(i18next.t("apresults:DESTROY.crosshairs", { player, where: r.where }));
                resolved = true;
                break;
        }
        return resolved;
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
