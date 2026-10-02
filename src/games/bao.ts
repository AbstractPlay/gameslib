import {  GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, BoardBasic } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { BaoGraph, reviver, UserFacingError, cloneState } from "../common/index.js";
import type { IRenderOpts, IScores } from "./_base.js";
import i18next from "i18next";
import type { PitType } from "../common/graphs/bao.js";


export type playerid = 1|2;

export type BaoRenderStepKind = "place" | "drops" | "capture" | "relay_end" | "sleep";

export interface BaoRenderStep {
    kind: BaoRenderStepKind;
    board: number[][];
    inhand: [number, number];
    houses: [string|undefined, string|undefined];
    blocked: [string|undefined, string|undefined];
    /** Annotations for this step only (capture and/or relay sow pits). */
    lapResults: APMoveResult[];
    /** Pits that received stones in a drop batch (`graph.sow` path). */
    pitsDropped?: string[];
    stonesDropped?: number;
    /** First pit receiving a stone after a capture relay. */
    relayEnterCell?: string;
    /** Sowing direction for this drop batch (pit before first drop → first pit sown). */
    sowArrow?: { from: string; to: string };
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: number[][];
    houses: [string|undefined, string|undefined];
    inhand: [number,number];
    blocked: [string|undefined, string|undefined];
    deltas: number[][];
    /** Malawi (Bawo) stage 2: functional kuu has been lifted at least once. */
    kuuMoved?: [boolean, boolean];
    steps?: BaoRenderStep[];
};

export interface IBaoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type SowingResults = {
    complete: boolean;
    captured: {
        cells: string[];
        stones: number;
    };
    sown: string[];
    infinite: boolean;
    taxed: boolean;
    /** Mtaji kutakata: relay pickup from back row while inner row is empty on the board. */
    illegalEmptyFront: boolean;
    /** Malawi basic: sole end-kichwa takata that slept after crossing the outer row. */
    malawiLoneEndLoss?: boolean;
};

export class BaoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bao",
        uid: "bao",
        playercounts: [2],
        version: "20231126",
        dateAdded: "2023-12-24",
        // i18next.t("apgames:descriptions.bao")
        description: "apgames:descriptions.bao",
        // i18next.t("apgames:notes.bao")
        notes: "apgames:notes.bao",
        urls: [
            "https://mancala.fandom.com/wiki/Bao_la_Kiswahili",
            "https://boardgamegeek.com/boardgame/14186/bao",
            "http://www.gamecabinet.com/rules/Bao2.html",
            "https://mancala.fandom.com/wiki/Bawo",
        ],
        bggid: "14186",
        people: [
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        flags: ["perspective", "automove"],
        variants: [
            {
                uid: "malawi",
                group: "rules",
            },
            {
                uid: "malawi-full",
                group: "rules",
            },
            {
                uid: "kujifunza",
                group: "rules",
            }
        ],
        categories: ["goal>cripple", "mechanic>convert", "mechanic>move>sow", "other>traditional", "board>mancala", "components>simple>1c", "family>mancala"],
        displays: [{uid: "pips"}]
    };

    public static opposites = new Map<string, string>([
        ["a2", "a3"], ["a3", "a2"],
        ["b2", "b3"], ["b3", "b2"],
        ["c2", "c3"], ["c3", "c2"],
        ["d2", "d3"], ["d3", "d2"],
        ["e2", "e3"], ["e3", "e2"],
        ["f2", "f3"], ["f3", "f2"],
        ["g2", "g3"], ["g3", "g2"],
        ["h2", "h3"], ["h3", "h2"],
    ]);

    public static clone(obj: BaoGame): BaoGame {
        const cloned: BaoGame = Object.assign(new BaoGame(), cloneState(obj) as BaoGame);
        cloned.graph = new BaoGraph(cloned.houses);
        return cloned;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: number[][];
    public houses!: [string|undefined,string|undefined];
    public blocked!: [string|undefined,string|undefined];
    public deltas: number[][] = [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],];
    public inhand!: [number,number];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public steps: BaoRenderStep[] = [];
    private graph!: BaoGraph;
    private instalose = false;
    public kuuMoved?: [boolean, boolean];

    private static readonly RULESET_VARIANTS = ["malawi", "malawi-full", "kujifunza"] as const;

    private static assertCompatibleVariants(variants: string[]): void {
        const ruleset = BaoGame.RULESET_VARIANTS.filter((uid) => variants.includes(uid));
        if (ruleset.length > 1) {
            throw new Error(`Only one Bao rules variant may be selected (${ruleset.join(", ")}).`);
        }
    }

    private malawiSetup(): boolean {
        return this.variants.includes("malawi") || this.variants.includes("malawi-full");
    }

    private malawiRules(): boolean {
        return this.variants.includes("malawi-full");
    }

    private houseMinSeeds(): number {
        return this.malawiSetup() ? 8 : 6;
    }

    private autoKutakataThreshold(): number {
        return this.malawiRules() ? 15 : 16;
    }

    constructor(state?: IBaoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            let board = [
                [0,0,0,0,0,0,0,0],
                [0,2,2,6,0,0,0,0],
                [0,0,0,0,6,2,2,0],
                [0,0,0,0,0,0,0,0],
            ];
            let inhand = [22, 22] as [number,number];
            let houses: [string|undefined,string|undefined] = ["e2", "d3"];
            if (variants !== undefined) {
                BaoGame.assertCompatibleVariants(variants);
                if (variants.includes("malawi") || variants.includes("malawi-full")) {
                    board = [
                        [0,0,0,0,0,0,0,0],
                        [0,2,2,8,0,0,0,0],
                        [0,0,0,0,8,2,2,0],
                        [0,0,0,0,0,0,0,0],
                    ];
                    inhand = [20, 20];
                } else if (variants.includes("kujifunza")) {
                    board = [
                        [2,2,2,2,2,2,2,2],
                        [2,2,2,2,2,2,2,2],
                        [2,2,2,2,2,2,2,2],
                        [2,2,2,2,2,2,2,2],
                    ];
                    inhand = [0, 0];
                    houses = [undefined, undefined];
                }
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BaoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                inhand,
                houses,
                blocked: [undefined, undefined],
                deltas: [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBaoState;
            }
            if (state.game !== BaoGame.gameinfo.uid) {
                throw new Error(`The Bao engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            BaoGame.assertCompatibleVariants(this.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BaoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(r => [...r])];
        this.inhand = [...state.inhand];
        this.houses = [...state.houses];
        this.blocked = [...state.blocked];
        this.lastmove = state.lastmove;
        if ( (state.deltas !== undefined) && (state.deltas !== null) ) {
            this.deltas = [...state.deltas.map(l => [...l])];
        }
        if (this.malawiRules()) {
            this.kuuMoved = state.kuuMoved ? [...state.kuuMoved] : [false, false];
        } else {
            this.kuuMoved = undefined;
        }
        this.graph = new BaoGraph(this.houses);
        this.results = [...state._results];
        this.steps = state.steps !== undefined
            ? cloneState(state.steps) as BaoRenderStep[]
            : [];
        return this;
    }

    private ownKuuThreatened(player: playerid): boolean {
        const house = this.houses[player - 1];
        if (house === undefined || house === null || !this.hasWorkingHouse(player)) {
            return false;
        }
        const [col] = this.graph.algebraic2coords(house);
        const theirFront = player === 1 ? 1 : 2;
        const [hcol, hrow] = this.graph.algebraic2coords(house);
        if (this.board[hrow][hcol] === 0) {
            return false;
        }
        return this.board[theirFront][col] > 0;
    }

    private captureOfOpponentKuuForbidden(player: playerid, opposite: string): boolean {
        if (!this.malawiRules() || !this.ownKuuThreatened(player)) {
            return false;
        }
        const opponent: playerid = player === 1 ? 2 : 1;
        return this.houses[opponent - 1] === opposite;
    }

    private malawiOnlyKuuOccupiedOnFront(player: playerid): boolean {
        const myFront = player === 1 ? 2 : 1;
        const house = this.houses[player - 1];
        if (house === undefined || house === null) {
            return false;
        }
        for (let col = 0; col < 8; col++) {
            if (this.board[myFront][col] > 0) {
                const cell = this.graph.coords2algebraic(col, myFront);
                if (cell !== house) {
                    return false;
                }
            }
        }
        const [col, row] = this.graph.algebraic2coords(house);
        return this.board[row][col] > 0;
    }

    private namuaCaptureAvailable(player: playerid): boolean {
        const myFront = player === 1 ? 2 : 1;
        const theirFront = player === 1 ? 1 : 2;
        for (let col = 0; col < 8; col++) {
            if (this.board[myFront][col] > 0 && this.board[theirFront][col] > 0) {
                const cell = this.graph.coords2algebraic(col, myFront);
                if (!this.captureOfOpponentKuuForbidden(player, BaoGame.opposites.get(cell)!)) {
                    return true;
                }
            }
        }
        return false;
    }

    public hasWorkingHouse (player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        if ( (this.houses[player - 1] === null) || (this.houses[player - 1] === undefined) ) {
            return false;
        }
        const [col, row] = this.graph.algebraic2coords(this.houses[player - 1]!);
        if (this.board[row][col] >= this.houseMinSeeds()) {
            return true;
        }
        return false;
    }

    /** Namu kutakata start pits per Zanzibar / Malawi placement rules (non-capture). */
    private malawiNamuTakataLegalStartCells(player: playerid): string[] {
        const myFront = player === 1 ? 2 : 1;
        const house = this.houses[player - 1];
        const nonKuu: string[] = [];
        for (let col = 0; col < 8; col++) {
            const cell = this.graph.coords2algebraic(col, myFront);
            if (house !== undefined && house !== null && cell === house) {
                continue;
            }
            if (this.board[myFront][col] > 0) {
                nonKuu.push(cell);
            }
        }
        const twoPlus = nonKuu.filter((cell) => {
            const [c, r] = this.graph.algebraic2coords(cell);
            return this.board[r][c] >= 2;
        });
        if (twoPlus.length > 0) {
            return twoPlus;
        }
        const allSingletons =
            nonKuu.length > 0 &&
            nonKuu.every((cell) => {
                const [c, r] = this.graph.algebraic2coords(cell);
                return this.board[r][c] === 1;
            });
        if (allSingletons) {
            return nonKuu;
        }
        if (house !== undefined && house !== null && nonKuu.length === 0) {
            const [col, row] = this.graph.algebraic2coords(house);
            if (this.board[row][col] === this.houseMinSeeds() && !this.namuaCaptureAvailable(player)) {
                return [house];
            }
        }
        return [];
    }

    private namuTakataLegalStartCells(player: playerid): string[] {
        if (this.malawiRules()) {
            return this.malawiNamuTakataLegalStartCells(player);
        }
        const myFront = player === 1 ? 2 : 1;
        const house = this.houses[player - 1];
        if (this.hasWorkingHouse(player)) {
            const cells: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = this.graph.coords2algebraic(col, myFront);
                if (this.board[myFront][col] > 0 && this.graph.getType(cell) !== "nyumba") {
                    cells.push(cell);
                }
            }
            return cells;
        }
        const occupied: string[] = [];
        for (let col = 0; col < 8; col++) {
            if (this.board[myFront][col] > 0) {
                occupied.push(this.graph.coords2algebraic(col, myFront));
            }
        }
        const twoPlus = occupied.filter((cell) => {
            const [c, r] = this.graph.algebraic2coords(cell);
            return this.board[r][c] >= 2;
        });
        if (twoPlus.length > 0) {
            return twoPlus;
        }
        const allSingletons =
            occupied.length > 0 &&
            occupied.every((cell) => {
                const [c, r] = this.graph.algebraic2coords(cell);
                return this.board[r][c] === 1;
            });
        if (allSingletons) {
            return occupied;
        }
        if (occupied.length === 0 && house !== undefined && house !== null) {
            const [col, row] = this.graph.algebraic2coords(house);
            if (this.board[row][col] > 0) {
                return [house];
            }
        }
        return occupied;
    }

    /**
     * Checks to see if a given player is in kutakatia.
     * The algorithm involves generating a list of moves for the *opposing* player,
     * executing those moves, and seeing if there is only one cell capturable.
     */
    public getBlocked(player?: playerid): string|undefined {
        if (player === undefined) {
            player = this.currplayer;
        }
        let opponent: playerid = 2;
        if (player === 2) {
            opponent = 1;
        }

        // must be in mtaji phase
        if (this.inhand.reduce((prev, curr) => prev + curr, 0) === 0) {
            // last move has to have been kutakata
            if (this.lastmove?.endsWith("*")) {
                // get moves for opponent
                const moves = this.moves(opponent, true)
                // only proceed if the moves are capture moves
                if ( (moves.length > 0) && (! moves[0].endsWith("*")) ) {
                    // execute each move and get the results
                    const results: SowingResults[] = [];
                    for (const move of moves) {
                        const cloned = BaoGame.clone(this);
                        results.push(cloned.processMove(move));
                    }
                    // Build a set out of the first captured pit of each result
                    const firsts = new Set<string>(results.map(r => r.captured.cells[0]));
                    // if all the first captures are the same, that pit is blocked
                    if (firsts.size === 1) {
                        const blocked = [...firsts.values()][0];
                        const [col, row] = this.graph.algebraic2coords(blocked);
                        // but you can't block a functional nyumba
                        if ( (this.graph.getType(blocked) === "nyumba") && (this.board[row][col] >= this.houseMinSeeds()) ) {
                            return undefined;
                        }
                        const myFront = player === 1 ? 2 : 1;
                        const occupied = this.board[myFront].filter(n => n > 0);
                        // you also can't block the only occupied pit in the front row
                        if (occupied.length === 1) {
                            return undefined
                        }
                        const gt1 = occupied.filter(n => n > 1);
                        // and you can't block the only pit with >1 stones in it
                        if (this.board[row][col] > 1 && gt1.length === 1) {
                            return undefined;
                        }
                        return blocked;
                    }
                }
            }
        }

        return;
    }

    /**
     * This function doesn't do any validation, but it is aware of the basic sowing rules.
     * All it does is execute a given move exactly as provided and return the results.
     * It is used by the `move()` function to execute a valid move, by `getBlocked()` to check
     * for kutakatia, and `moves()` for move generation.
     *
     * It really needs to be efficient and fast!
     */
    public processMove(move: string, opts?: { onStepComplete?: (step: BaoRenderStep) => void }): SowingResults {
        // init return variables
        const capturedCells: string[] = [];
        let capturedStones = 0;
        const sownCells: string[] = [];
        let distance = 0;
        let complete = true;
        let infinite = false;
        let taxed = false;
        let illegalEmptyFront = false;
        let malawiLoneEndLoss = false;
        let lapFromNyumba = false;
        let outerRowVisited = false;

        // init what we need to know about the game state
        const cell = move.substring(0, 2);
        const [startCol, startRow] = this.graph.algebraic2coords(cell);
        const marker = move[2];
        let player: playerid;
        if (startRow <= 1) {
            player = 2;
        } else {
            player = 1;
        }
        const phase: "namua"|"mtaji" = this.inhand[player - 1] > 0 ? "namua" : "mtaji";
        const kutakataAutoMin = this.autoKutakataThreshold();
        const isKutakata = move.endsWith("*") || ( (this.board[startRow][startCol] >= kutakataAutoMin) && (phase === "mtaji") ) ;
        const myFront = player === 1 ? 2 : 1;
        const myBack = player === 1 ? 3 : 0;
        const houseMin = this.houseMinSeeds();
        let loneEndKichwaStart = false;
        if (this.malawiRules() && phase === "mtaji" && isKutakata) {
            const startType = this.graph.getType(cell);
            if (startType !== undefined && startType.startsWith("kichwa")) {
                loneEndKichwaStart = true;
                for (let i = 0; i < 8; i++) {
                    if (this.board[myFront][i] > 0) {
                        const c = this.graph.coords2algebraic(i, myFront);
                        if (c !== cell) {
                            loneEndKichwaStart = false;
                            break;
                        }
                    }
                }
            }
        }
        let dir: "CW"|"CCW";
        switch (startRow) {
            // outer rows
            case 0:
            case 3:
                dir = marker === "<" ? "CW" : "CCW";
                break;
            // inner rows
            case 1:
            case 2:
                dir = marker === "<" ? "CCW" : "CW";
                break;
            default:
                throw new Error(`Invalid startRow specified: ${startRow}`);
        }
        // in namua stage, on a mtaji turn, the marker indicates the kichwa, not the direction
        // so flip it
        if ( (phase === "namua") && (! isKutakata) ) {
            dir = dir === "CW" ? "CCW" : "CW";
        }
        // now let's try to execute the move
        // if in namua phase, add the stone
        if (phase === "namua") {
            this.board[startRow][startCol]++;
        }
        let curr = cell;
        let inhand = 0;
        let awaitFirstDropAfterCapture = false;
        const pushStep = (
            kind: BaoRenderStepKind,
            lapResults: APMoveResult[],
            relayEnterCell?: string,
            pitsDropped?: string[],
            stonesDropped?: number,
            sowArrow?: { from: string; to: string },
        ) => {
            if (opts?.onStepComplete === undefined) {
                return;
            }
            opts.onStepComplete({
                kind,
                board: this.cloneBoard(),
                inhand: [...this.inhand],
                houses: [...this.houses],
                blocked: [...this.blocked],
                lapResults: [...lapResults],
                ...(relayEnterCell !== undefined ? { relayEnterCell } : {}),
                ...(pitsDropped !== undefined ? { pitsDropped: [...pitsDropped] } : {}),
                ...(stonesDropped !== undefined ? { stonesDropped } : {}),
                ...(sowArrow !== undefined ? { sowArrow: { ...sowArrow } } : {}),
            });
        };
        // NOTE: Possible infinite loop
        while (true) {
            let relayEnterThisLap: string | undefined;
            // distribute any seeds in hand
            distance += inhand;
            const stonesThisDrop = inhand;
            const sowOrigin = curr;
            const toSow = this.graph.sow(curr, dir, inhand);
            for (const pit of toSow) {
                const [x, y] = this.graph.algebraic2coords(pit);
                this.board[y][x]++;
                if (awaitFirstDropAfterCapture) {
                    relayEnterThisLap = pit;
                    awaitFirstDropAfterCapture = false;
                }
                curr = pit;
            }
            if (stonesThisDrop > 0 && toSow.length > 0) {
                const firstPit = toSow[0]!;
                const sowArrow =
                    firstPit !== sowOrigin
                        ? { from: sowOrigin, to: firstPit }
                        : undefined;
                pushStep("drops", [], relayEnterThisLap, toSow, stonesThisDrop, sowArrow);
            }
            // `curr` is the last pit you placed a stone in
            const [currCol, currRow] = this.graph.algebraic2coords(curr);
            if (currRow === myBack) {
                outerRowVisited = true;
            }
            // check for capture
            // but only if we're namua phase or mtaji phase after the first turn
            if ( (phase === "namua") || (distance > 0) ) {
                const opposite = BaoGame.opposites.get(curr);
                if (opposite !== undefined) {
                    const [oppCol, oppRow] = this.graph.algebraic2coords(opposite);
                    if ( (! isKutakata) && (this.board[currRow][currCol] > 1) && (this.board[oppRow][oppCol] > 0) &&
                         (! this.captureOfOpponentKuuForbidden(player, opposite)) ) {
                        inhand = this.board[oppRow][oppCol];
                        this.board[oppRow][oppCol] = 0;
                        capturedCells.push(opposite);
                        capturedStones += inhand;

                        // now determine new starting point and direction
                        let enterPit: string|undefined;
                        let enterDir = dir;
                        const currType = this.graph.getType(curr);
                        if (currType === undefined) {
                            throw new Error(`Could not determine pit type for ${curr}`);
                        }
                        // if capture occurred in kimbi or kichwa, predetermined
                        if (currType.startsWith("ki")) {
                            const enterType: PitType = `kichwa${player}${currType[currType.length - 1]}` as PitType;
                            enterPit = this.graph.findType(enterType);
                            if (enterPit === undefined) {
                                throw new Error(`Could not find a pit of type ${enterType}`);
                            }
                            enterDir = currType[currType.length - 1] === "L" ? "CW" : "CCW";
                        }
                        // otherwise, continue in current direction
                        else {
                            const enterType: PitType = `kichwa${player}${dir === "CW" ? "L" : "R"}` as PitType;
                            enterPit = this.graph.findType(enterType);
                            if (enterPit === undefined) {
                                throw new Error(`Could not find a pit of type ${enterType}`);
                            }
                        }
                        // with captures, we don't want to skip the kichwa
                        // so move curr *back* one space
                        curr = this.graph.sow(enterPit, enterDir, -1)[0];
                        dir = enterDir;
                        lapFromNyumba = false;
                        awaitFirstDropAfterCapture = true;
                        pushStep("capture", [{type: "capture", where: opposite, count: inhand}]);
                        // restart loop
                        continue;
                    }
                }
            }

            // no capture happened, so relay sow

            // if there's only one seed in the pit, then our turn is over
            if (this.board[currRow][currCol] === 1) {
                if (this.malawiRules() && phase === "mtaji" && isKutakata && loneEndKichwaStart && outerRowVisited) {
                    const towardCenter = this.mtajiKutakataDirMarkers(player, cell, myFront);
                    const moveMarker = marker as "<"|">";
                    if (towardCenter.length === 1 && moveMarker !== towardCenter[0]) {
                        malawiLoneEndLoss = true;
                    }
                }
                pushStep("sleep", [], relayEnterThisLap);
                break;
            }
            // if functional nyumba in kunamua phase (no safari or stopping in mtaji phase)
            if ( (this.graph.getType(curr) === "nyumba") && (this.board[currRow][currCol] >= houseMin) && (phase === "namua") ) {
                // if we're in a mtaji move, check for "+" and stop here but mark move incomplete
                if ( (! isKutakata) && (! move.endsWith("+")) ) {
                    complete = false;
                    pushStep("sleep", [], relayEnterThisLap);
                    break;
                }
                // otherwise, in kutakata and relay sowing, just stop
                else if ( (phase === "namua") && (isKutakata) && (distance > 0) ) {
                    pushStep("sleep", [], relayEnterThisLap);
                    break;
                }
            }
            // if we're in a kutakata move and we've reached a blocked pit, we have to stop
            if (isKutakata) {
                // have to check the static `blocked` variable and not the live one
                // otherwise we can get into a situation where your move has changed
                // the state of the blocked cell after the fact
                // const blocked = this.getBlocked(player);
                const blocked = this.blocked[player - 1];
                if ( (blocked !== undefined) && (blocked === curr) && (! lapFromNyumba) ) {
                    pushStep("sleep", [], relayEnterThisLap);
                    break;
                }
            }

            // at this point, we must continue sowing
            sownCells.push(curr);
            const relayLap: APMoveResult = {type: "sow", pits: [curr]};
            let relayFromKuuTax = false;
            // in namua phase, kutakata, very first turn, tax kuu or lift all nine (Malawi)
            if ( (phase === "namua") && (isKutakata) && (distance === 0) && (this.graph.getType(curr) === "nyumba") ) {
                const kuuCount = this.board[currRow][currCol];
                if (this.malawiRules() && kuuCount === houseMin + 1 && this.malawiOnlyKuuOccupiedOnFront(player)) {
                    inhand = kuuCount;
                    this.board[currRow][currCol] = 0;
                    lapFromNyumba = true;
                    relayFromKuuTax = true;
                }
                else if (kuuCount > houseMin) {
                    inhand = 2;
                    this.board[currRow][currCol] -= 2;
                    taxed = true;
                    lapFromNyumba = true;
                    relayFromKuuTax = true;
                }
            }
            // otherwise pick them all up
            if (! relayFromKuuTax) {
                const stonesToLift = this.board[currRow][currCol];
                if (phase === "mtaji" && isKutakata && stonesToLift > 0) {
                    let frontSum = 0;
                    for (let i = 0; i < 8; i++) {
                        frontSum += this.board[myFront][i];
                    }
                    if (frontSum === 0 && currRow === myBack) {
                        illegalEmptyFront = true;
                        complete = false;
                        pushStep("relay_end", [relayLap], relayEnterThisLap);
                        break;
                    }
                }
                inhand = stonesToLift;
                this.board[currRow][currCol] = 0;
                lapFromNyumba = this.graph.getType(curr) === "nyumba";
            }

            // FAILSAFE
            // infinite (or just very long) loops are very rare but possible
            // if a move travels the distance of more than 12 times around the board, abort
            if (distance > 16 * 12) {
                infinite = true;
                pushStep("relay_end", [relayLap], relayEnterThisLap);
                break;
            }
            pushStep("relay_end", [relayLap], relayEnterThisLap);
        }

        return {
            complete,
            captured: {
                cells: capturedCells,
                stones: capturedStones,
            },
            sown: sownCells,
            infinite,
            taxed,
            illegalEmptyFront,
            malawiLoneEndLoss,
        }
    }

    /** Mtaji kutakata: allowed direction markers when starting from an inner-row pit. */
    private mtajiKutakataDirMarkers(player: playerid, cell: string, myFront: number): ("<"|">")[] {
        const occupied: string[] = [];
        for (let i = 0; i < 8; i++) {
            if (this.board[myFront][i] > 0) {
                occupied.push(this.graph.coords2algebraic(i, myFront));
            }
        }
        if (occupied.length !== 1 || occupied[0] !== cell) {
            return ["<", ">"];
        }
        const type = this.graph.getType(cell);
        if (type === undefined || !type.startsWith("kichwa")) {
            return ["<", ">"];
        }
        const [col, row] = this.graph.algebraic2coords(cell);
        if (this.board[row][col] < 2) {
            return ["<", ">"];
        }
        const allowed: ("<"|">")[] = [];
        for (const dir of ["CW", "CCW"] as const) {
            const dirMarker: "<"|">" = dir === "CW" ? ">" : "<";
            const first = this.graph.sow(cell, dir, 1)[0];
            const [, firstRow] = this.graph.algebraic2coords(first);
            if (firstRow === myFront) {
                allowed.push(dirMarker);
            }
        }
        return allowed;
    }

    private malawiMustPlayUnmovedKuu(player: playerid): string|undefined {
        if (!this.malawiRules() || this.inhand[player - 1] > 0) {
            return undefined;
        }
        const moved = this.kuuMoved ?? [false, false];
        if (moved[player - 1] || !this.hasWorkingHouse(player)) {
            return undefined;
        }
        return this.houses[player - 1];
    }

    private filterMtajiKutakataIllegalEmptyFront(player: playerid, moves: string[]): string[] {
        if (this.inhand[player - 1] > 0) {
            return moves;
        }
        return moves.filter((mv) => {
            if (!mv.endsWith("*")) {
                return true;
            }
            const r = BaoGame.clone(this).processMove(mv);
            return !r.illegalEmptyFront && !r.malawiLoneEndLoss;
        });
    }

    public moves(player?: playerid, ignoreBlocked = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        let myFront = 2; let myBack = 3; let theirFront = 1;
        if (player === 2) {
            myFront = 1;
            myBack = 0;
            theirFront = 2;
        }

        /**
         * Decision tree:
         *   Namua
         *     - Any pits with seeds with opposing seeds? --> Mtaji
         *     - If functional house and pits with seeds that are not house --> Kutakata
         *     - If any non-house pits with 2+ seeds --> Kutakata
         *     - If any non-house pits with any seeds --> Kutakata
         *     - If all that's left is the house --> Kutakata
         *   Mtaji
         *     - Any pits with opposing seeds that can be reached by sowing (<16 seeds)? --> Mtaji
         *     - Any unblocked inner pits with 2+ seeds ? --> Kutakata
         *     - Any outer pit with 2+ seeds? --> Kutakata
         */

        let caps: string[] = [];
        const noncaps: string[] = [];
        // namua
        if (this.inhand[player - 1] > 0) {
            // find all holes in your front row that have pieces in them
            const cols: number[] = [];
            for (let i = 0; i < 8; i++) {
                if (this.board[myFront][i] > 0) {
                    cols.push(i);
                }
            }
            // look for capture moves first
            for (const col of cols) {
                const cell = this.graph.coords2algebraic(col, myFront);
                const type = this.graph.getType(cell)!;
                // this is a capturing move
                if (this.board[theirFront][col] > 0) {
                    // if it's a kichwa or kimbi, then direction is predetermined
                    if (type.startsWith("ki")) {
                        if (type.endsWith("L")) {
                            caps.push(`${cell}<`);
                        } else {
                            caps.push(`${cell}>`);
                        }
                    }
                    // otherwise both are possible
                    else {
                        caps.push(`${cell}<`);
                        caps.push(`${cell}>`);
                    }
                }
            }
            caps = caps.filter((mv) => {
                const start = mv.substring(0, 2);
                const opposite = BaoGame.opposites.get(start);
                if (opposite === undefined) {
                    return true;
                }
                return !this.captureOfOpponentKuuForbidden(player, opposite);
            });
            // for each capture move, check to see if it includes "playing the house"
            for (const m of [...caps]) {
                const cloned = BaoGame.clone(this);
                const result = cloned.processMove(m);
                if (! result.complete) {
                    caps.push(`${m}+`);
                }
            }
            // only look for non-capturing moves if no captures were found
            if (caps.length === 0) {
                for (const cell of this.namuTakataLegalStartCells(player)) {
                    noncaps.push(`${cell}<*`);
                    noncaps.push(`${cell}>*`);
                }
            }
        }
        // mtaji
        else {
            // review every owned pit with >=2 seeds and see if it will trigger a capture
            for (const row of [myFront, myBack]) {
                for (let col = 0; col < 8; col++) {
                    const cell = this.graph.coords2algebraic(col, row);
                    const num = this.board[row][col];
                    if (num >= 2) {
                        for (const dir of ["CW", "CCW"] as const) {
                            let dirMarker: "<"|">";
                            if (row === myFront) {
                                dirMarker = dir === "CW" ? ">" : "<";
                            } else {
                                dirMarker = dir === "CW" ? "<" : ">";
                            }
                            let staticCapture = false;
                            const sown = this.graph.sow(cell, dir, num);
                            const final = sown[sown.length - 1];
                            const opp = BaoGame.opposites.get(final);
                            if (opp !== undefined) {
                                const [myX, myY] = this.graph.algebraic2coords(final);
                                const [theirX, theirY] = this.graph.algebraic2coords(opp);
                                if ( (this.board[myY][myX] > 0) && (this.board[theirY][theirX] > 0) ) {
                                    staticCapture = true;
                                }
                            }
                            if (num < this.autoKutakataThreshold()) {
                                const mv = `${cell}${dirMarker}`;
                                if (staticCapture) {
                                    const opposite = BaoGame.opposites.get(final);
                                    if (opposite !== undefined && this.captureOfOpponentKuuForbidden(player, opposite)) {
                                        continue;
                                    }
                                    const cloned = BaoGame.clone(this);
                                    const result = cloned.processMove(mv);
                                    if (result.captured.cells.length > 0) {
                                        caps.push(mv);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // for each capture move, check to see if it includes "playing the house"
            for (const m of [...caps]) {
                const cloned = BaoGame.clone(this);
                const result = cloned.processMove(m);
                if (! result.complete) {
                    caps.push(`${m}+`);
                }
            }
            // if no captures were found, examine kutakata
            if (caps.length === 0) {
                let blocked: string|undefined;
                if (! ignoreBlocked) {
                    blocked = this.getBlocked(player);
                }
                const forcedKuu = this.malawiMustPlayUnmovedKuu(player);
                // check every inner cell with 2+ seeds
                for (let i = 0; i < 8; i++) {
                    if (this.board[myFront][i] >= 2) {
                        // make sure it's not blocked
                        const cell = this.graph.coords2algebraic(i, myFront);
                        if (forcedKuu !== undefined && cell !== forcedKuu) {
                            continue;
                        }
                        if ( (blocked !== undefined) && (blocked === cell) ) {
                            continue;
                        }
                        for (const dirMarker of this.mtajiKutakataDirMarkers(player, cell, myFront)) {
                            noncaps.push(`${cell}${dirMarker}*`);
                        }
                    }
                }
                // if still no moves, check outer row
                if (noncaps.length === 0) {
                    for (let i = 0; i < 8; i++) {
                        if (this.board[myBack][i] >= 2) {
                            const cell = this.graph.coords2algebraic(i, myBack);
                            noncaps.push(`${cell}<*`);
                            noncaps.push(`${cell}>*`);
                        }
                    }
                }
            }
        }

        if (caps.length > 0) {
            // remove any captures that do not clear a blocked pit
            const blockee = player === 1 ? 2 : 1;
            if ( (this.blocked[blockee - 1] !== null) && (this.blocked[blockee - 1] !== undefined) ) {
                const allowed: string[] = [];
                for (const mv of caps) {
                    const cloned = BaoGame.clone(this);
                    cloned.move(mv, {trusted: true, skipeog: true, skipEconomy: true});
                    if (cloned.blocked[blockee - 1] === undefined) {
                        allowed.push(mv);
                    }
                }
                caps = [...allowed];
            }
            return caps;
        } else {
            return this.filterMtajiKutakataIllegalEmptyFront(player, noncaps);
        }
    }

    /**
     * Because `moves()` is efficient, and the number of moves is generally quite small,
     * this function uses it to autocomplete valid moves where possible.
     */
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove: string;
            // starting fresh
            if (move.length === 0) {
                newmove = cell;
            }
            // something is already there
            else {
                // if all that's there is a cell, assume you're choosing a direction
                if (move.length === 2) {
                    const [, origRow] = this.graph.algebraic2coords(move);
                    const dir = this.graph.getDir(move, cell);
                    if (dir !== undefined) {
                        if (dir === "CW") {
                            if ( (origRow === 0) || (origRow === 3) ) {
                                newmove = move + "<";
                            } else {
                                newmove = move + ">";
                            }
                        } else {
                            if ( (origRow === 0) || (origRow === 3) ) {
                                newmove = move + ">";
                            } else {
                                newmove = move + "<";
                            }
                        }
                    } else {
                        // make them try again
                        newmove = move;
                    }
                }
                else {
                    // if the later click was on the house, add a plus sign
                    if (this.graph.getType(cell) === "nyumba") {
                        newmove = move + "+"
                    }
                    // otherwise, ignore the click
                    else {
                        newmove = move;
                    }
                }
            }

            // check to see if we can autocomplete the move
            const validMoves = this.moves();
            const matches = validMoves.filter(m => m.startsWith(newmove));
            matches.sort((a, b) => a.length - b.length);
            if ( (matches.length === 1) || ( (matches.length > 1) && (matches[0].length < matches[1].length) ) ) {
                newmove = matches[0];
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
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

    /**
     * Because `move()` is relatively efficient, this function uses it extensively.
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        const phase = this.inhand[this.currplayer - 1] > 0 ? "namua" : "mtaji";
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            const mvtype = this.moves().length > 0 ? this.moves()[0].endsWith("*") ? "kutakata" : "mtaji" : "";
            result.message = i18next.t("apgames:validation.bao.INITIAL_INSTRUCTIONS", {context: `${phase}|${mvtype}`});
            return result;
        }

        const cell = m.substring(0, 2);
        // valid cell
        if (! this.graph.graph.hasNode(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }

        // yours
        if ( ( (this.currplayer === 1) && ( (cell[1] === "3") ||
                                            (cell[1] === "4")
                                          )
             ) ||
             ( (this.currplayer === 2) && ( (cell[1] === "1") ||
                                            (cell[1] === "2")
                                          )
             )
           ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // has pieces
        const [x, y] = this.graph.algebraic2coords(cell);
        if (this.board[y][x] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.EMPTY");
            return result;
        }

        // direction marker is required
        // in cases where it can be assumed, `handleClick()` will autocomplete
        if (m.length === 2) {
            result.valid = true;
            result.complete = -1;
            result.canrender = false;
            result.message = i18next.t("apgames:validation.bao.CHOOSE_DIR", {context: this.inhand[this.currplayer - 1] === 0 ? "mtaji" : "namua"});
            return result;
        }

        const validMoves = this.moves();
        const matches = validMoves.filter(mv => mv.startsWith(m));
        if (matches.includes(m)) {
            // exact match
            if (matches.length === 1) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // move is indeed valid, but there's an alternative
            // this only happens if one can "play the house"
            else if (matches.length > 1) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.bao.PLAY_HOUSE");
                return result;
            }
        }

        if (this.graph.getType(cell) === "nyumba") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.BAD_TAX", {move: m});
            return result;
        }

        if (
            (this.inhand[this.currplayer - 1] > 0) &&
            (m.endsWith("*")) &&
            (! this.namuTakataLegalStartCells(this.currplayer).includes(cell))
        ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.TWO_PLUS", {move: m});
            return result;
        }

        if ( (this.board[y][x] === 1) && (this.inhand[this.currplayer - 1] === 0) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.NEVER_SINGLE");
            return result;
        }

        if (this.blocked.includes(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.BLOCKED");
            return result;
        }

        if (y === 0 || y === 3) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.NO_BACK_ROW", {context: phase});
            return result;
        }

        if (validMoves.length > 0) {
            const examples = validMoves.join(", ");
            const kutakataOnly = validMoves.every(mv => mv.endsWith("*"));
            const captureAvailable = validMoves.some(mv => !mv.endsWith("*"));

            if (captureAvailable && !kutakataOnly) {
                if (m.endsWith("*")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.bao.NO_KUTAKATA_WHILE_CAPTURE", {examples});
                    return result;
                }
                const fromPit = validMoves.filter(mv => mv.startsWith(cell));
                if (fromPit.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.bao.MUST_CAPTURE", {examples});
                    return result;
                }
                result.valid = false;
                result.message = i18next.t("apgames:validation.bao.WRONG_CAPTURE", {move: m, examples});
                return result;
            }

            if (kutakataOnly && !m.endsWith("*")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.bao.KUTAKATA_ONLY", {examples});
                return result;
            }
        }

        // failsafe
        result.valid = false;
        result.message = i18next.t("apgames:validation._general.FAILSAFE", {move: m});
        return result;
    }

    public move(m: string, {trusted = false, partial = false, skipeog = false, skipEconomy = false} = {}): BaoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const mover = this.currplayer;

        // annotate initial move
        const cell = m.substring(0, 2);
        if (this.inhand[this.currplayer - 1] > 0) {
            this.results.push({type: "place", where: cell});
            // Don't place a piece on the board at this point
            // because `processMove()` does that for us.
            // And don't remove the inhand piece until after `processMove()`.

            // check for partial in namua phase and get out
            if ( (m.length === 2) && (partial) ) {
                // remove the piece from the hand here because the UI needs to be correct
                // this is a partial move anyway
                this.inhand[this.currplayer - 1]--;
                const [x, y] = this.graph.algebraic2coords(cell);
                this.board[y][x]++;
                return this;
            }
        }

        // determine very first direction for annotation
        const marker = m[2];
        // for kunamua phase, mtaji turn, note the kichwa->kimbi
        if ( (this.inhand[this.currplayer - 1] > 0) && (! m.endsWith("*")) ) {
            const dir: "L"|"R" = marker === "<" ? "L" : "R";
            const kichwa = this.graph.findType(`kichwa${this.currplayer}${dir}`);
            const kimbi = this.graph.findType(`kimbi${this.currplayer}${dir}`);
            if ( (kichwa === undefined) || (kimbi === undefined) ) {
                throw new Error(`Unable to find the ${dir} kichwa or kimbi for player ${this.currplayer}`);
            }
            this.results.push({type: "move", from: kichwa, to: kimbi});
        }
        // for all other moves and phases, draw a simple arrow from selected cell
        else {
            let dir: "CW"|"CCW";
            const [, row] = this.graph.algebraic2coords(cell);
            if ( (row === 0) || (row === 3) ) {
                dir = marker === "<" ? "CW" : "CCW";
            } else {
                dir = marker === "<" ? "CCW" : "CW";
            }
            const next = this.graph.sow(cell, dir, 1)[0];
            this.results.push({type: "move", from: cell, to: next});
        }

        // store board in advance for comparison
        const before = this.cloneBoard();
        const renderBaseline = {
            inhand: [...this.inhand] as [number, number],
            houses: [...this.houses] as [string|undefined, string|undefined],
            blocked: [...this.blocked] as [string|undefined, string|undefined],
        };
        this.steps = [];
        const stepSnapshots: BaoRenderStep[] = [];
        const results = this.processMove(m, {
            onStepComplete: (step) => {
                stepSnapshots.push({
                    kind: step.kind,
                    board: step.board.map((r) => [...r]),
                    inhand: [...step.inhand],
                    houses: [...step.houses],
                    blocked: [...step.blocked],
                    lapResults: [...step.lapResults],
                    ...(step.pitsDropped !== undefined
                        ? { pitsDropped: [...step.pitsDropped] }
                        : {}),
                    ...(step.stonesDropped !== undefined
                        ? { stonesDropped: step.stonesDropped }
                        : {}),
                    ...(step.relayEnterCell !== undefined
                        ? { relayEnterCell: step.relayEnterCell }
                        : {}),
                    ...(step.sowArrow !== undefined
                        ? { sowArrow: { ...step.sowArrow } }
                        : {}),
                });
            },
        });
        const after = this.cloneBoard();
        // now calculate deltas
        this.deltas = [];
        for (let y = 0; y < 4; y++) {
            const row: number[] = [];
            for (let x = 0; x < 8; x++) {
                row.push(after[y][x] - before[y][x]);
            }
            this.deltas.push([...row]);
        }

        // we can't remove the inhand piece until after `processMove()`
        if (this.inhand[this.currplayer - 1] > 0) {
            this.inhand[this.currplayer - 1]--;
        }
        // if a blocked cell is captured or sown, or if the threatening pit is captured, remove it from the blocked list
        for (let i = 0; i < this.blocked.length; i++) {
            if ( (this.blocked[i] !== undefined) && (this.blocked[i] !== null) ) {
                const blocked = this.blocked[i]!;
                const blocker = BaoGame.opposites.get(blocked)!;
                if ( (results.sown.includes(blocked)) || (results.captured.cells.includes(blocked)) || (results.captured.cells.includes(blocker)) ) {
                    this.blocked[i] = undefined;
                }
            }
        }

        // now process results
        // if we have an infinite loop, nothing else matters
        if (results.infinite) {
            this.results.push({type: "infinite"});
            this.instalose = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
        }
        else if (results.malawiLoneEndLoss) {
            this.instalose = true;
            this.winner = [mover === 1 ? 2 : 1];
        }
        // otherwise, check other possible results
        else {
            // captures and sowings
            if (results.captured.cells.length > 0) {
                this.results.push({type: "capture", where: results.captured.cells.join(", "), count: results.captured.stones})
            } else {
                this.results.push({type: "sow", pits: [...results.sown]});
            }
            // destroyed houses
            // captured
            for (const capped of results.captured.cells) {
                const idx = this.houses.findIndex(s => s === capped);
                if (idx !== -1) {
                    this.results.push({type: "destroy", where: capped});
                    this.houses[idx] = undefined;
                    break;
                }
            }
            // sown
            for (const sown of results.sown) {
                const idx = this.houses.findIndex(s => s === sown);
                if ( (idx !== -1) && (! results.taxed) ) {
                    this.results.push({type: "destroy", where: sown});
                    this.houses[idx] = undefined;
                    break;
                }
            }
            // check for kutakatia
            const cloned = BaoGame.clone(this);
            cloned.lastmove = m;
            const blockee = this.currplayer === 1 ? 2 : 1;
            const blocked = cloned.getBlocked(blockee);
            if (blocked !== undefined) {
                this.blocked[blockee - 1] = blocked;
                this.results.push({type: "block", where: blocked});
                if (! m.endsWith("**")) {
                    m += "*";
                }
            }
        }

        if (this.malawiRules() && !results.infinite && !results.malawiLoneEndLoss) {
            const house = this.houses[mover - 1];
            if (house === cell) {
                if (this.kuuMoved === undefined) {
                    this.kuuMoved = [false, false];
                }
                this.kuuMoved[mover - 1] = true;
            }
        }

        if (partial) {
            return this;
        }

        const lapEndCount = stepSnapshots.filter(
            (s) => s.kind !== "drops",
        ).length;
        if (lapEndCount > 1) {
            const hadNamuaPlace = renderBaseline.inhand[mover - 1] > 0;
            const openingBoard = hadNamuaPlace
                ? this.boardAfterNamuaPlace(before, cell)
                : before;
            const steps: BaoRenderStep[] = [];
            if (hadNamuaPlace) {
                steps.push({
                    kind: "place",
                    board: openingBoard,
                    inhand: [...renderBaseline.inhand],
                    houses: [...renderBaseline.houses],
                    blocked: [...renderBaseline.blocked],
                    lapResults: [],
                });
            }
            steps.push(...stepSnapshots);
            this.steps = steps;
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        // THIS IS NOT BEST PRACTICE!
        // It is necessary to avoid looping when calculating move lists
        // because `moves()` relies on `move()` in some instances, as does
        // `checkEOG()`. It's messy.
        if (! skipeog) {
            this.checkEOG();
        }
        this.saveState();
        if (! skipEconomy) {
            this.checkEconomy();
        }
        return this;
    }

    protected checkEOG(): BaoGame {
        // if instalose is set, so is winner, just go with it
        if (this.instalose) {
            this.gameover = true;
        }
        // otherwise check for normal EOG conditions
        else {
            // check either player for having no pieces in their front row
            for (const p of [1, 2] as const) {
                const front = p === 1 ? 2 : 1;
                const num = this.board[front].reduce((prev, curr) => prev + curr, 0);
                if (num === 0) {
                    this.gameover = true;
                    this.winner = [p === 1 ? 2 : 1];
                    break;
                }
            }
            // current player has no moves
            if ( (! this.gameover) && (this.moves().length === 0) ) {
                this.gameover = true;
                this.winner = [this.currplayer === 1 ? 2 : 1];
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

    public state(): IBaoState {
        return {
            game: BaoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BaoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
            houses: [...this.houses],
            inhand: [...this.inhand],
            blocked: [...this.blocked],
            deltas: [...this.deltas.map(l => [...l])],
            ...(this.malawiRules() && this.kuuMoved !== undefined
                ? { kuuMoved: [...this.kuuMoved] as [boolean, boolean] }
                : {}),
            ...(this.steps.length > 0
                ? { steps: cloneState(this.steps) as BaoRenderStep[] }
                : {}),
        };
    }

    public render(opts?: IRenderOpts): APRenderRep | APRenderRep[] {
        if (this.steps.length === 0) {
            return this.buildRenderRep(
                {
                    board: this.board,
                    houses: this.houses,
                    blocked: this.blocked,
                    deltas: this.deltas,
                },
                this.results,
                opts,
            );
        }
        return this.renderFromSteps(opts);
    }

    private boardDeltas(from: number[][], to: number[][]): number[][] {
        const deltas: number[][] = [];
        for (let y = 0; y < 4; y++) {
            const row: number[] = [];
            for (let x = 0; x < 8; x++) {
                row.push(to[y]![x]! - from[y]![x]!);
            }
            deltas.push(row);
        }
        return deltas;
    }

    /** Board after the namua hand stone is placed on `cell` (before sowing). */
    private boardAfterNamuaPlace(before: number[][], cell: string): number[][] {
        const board = before.map((row) => [...row]);
        const [x, y] = this.graph.algebraic2coords(cell);
        board[y]![x]!++;
        return board;
    }

    private boardBeforeDrops(step: BaoRenderStep): number[][] {
        const board = step.board.map((row) => [...row]);
        for (const pit of step.pitsDropped ?? []) {
            const [x, y] = this.graph.algebraic2coords(pit);
            board[y]![x]!--;
        }
        return board;
    }

    private boardBeforeFirstStep(): number[][] {
        const first = this.steps[0]!;
        if (first.kind === "place") {
            const place = this.results.find((r) => r.type === "place");
            if (place === undefined || place.type !== "place" || place.where === undefined) {
                return first.board.map((row) => [...row]);
            }
            const board = first.board.map((row) => [...row]);
            const [x, y] = this.graph.algebraic2coords(place.where);
            board[y]![x]!--;
            return board;
        }
        if (first.kind === "drops") {
            return this.boardBeforeDrops(first);
        }
        return first.board.map((row) => [...row]);
    }

    private boardBeforeGroup(group: BaoRenderStep[]): number[][] {
        const idx = this.steps.indexOf(group[0]!);
        if (idx <= 0) {
            return this.boardBeforeFirstStep();
        }
        return this.steps[idx - 1]!.board.map((row) => [...row]);
    }

    /** Append a lap-ending capture to the sow frame when it immediately follows drops. */
    private withSowEndCapture(steps: BaoRenderStep[], group: BaoRenderStep[], nextIdx: number): number {
        if (steps[nextIdx]?.kind === "capture") {
            group.push(steps[nextIdx]!);
            return nextIdx + 1;
        }
        return nextIdx;
    }

    /** One animation group per pit pickup (`relay_end`) and its sow (`drops`), plus opening/capture steps. */
    private collapsePickupSowGroups(steps: BaoRenderStep[]): BaoRenderStep[][] {
        const groups: BaoRenderStep[][] = [];
        let i = 0;
        if (steps[0]?.kind === "place") {
            if (steps[1]?.kind === "capture") {
                groups.push([steps[0]!, steps[1]!]);
                i = 2;
            } else {
                groups.push([steps[0]!]);
                i = 1;
            }
        }
        while (i < steps.length) {
            const step = steps[i]!;
            if (step.kind === "sleep") {
                i++;
                continue;
            }
            if (step.kind === "capture") {
                groups.push([step]);
                i++;
                continue;
            }
            if (step.kind === "relay_end") {
                const next = steps[i + 1];
                if (next?.kind === "drops") {
                    const group = [step, next];
                    i = this.withSowEndCapture(steps, group, i + 2);
                    groups.push(group);
                    continue;
                }
                groups.push([step]);
                i++;
                continue;
            }
            if (step.kind === "drops") {
                const group = [step];
                i = this.withSowEndCapture(steps, group, i + 1);
                groups.push(group);
                continue;
            }
            i++;
        }
        return groups;
    }

    private isOneSowStep(from: string, to: string): boolean {
        if (from === to) {
            return false;
        }
        for (const dir of ["CW", "CCW"] as const) {
            const next = this.graph.sow(from, dir, 1)[0];
            if (next === to) {
                return true;
            }
        }
        return false;
    }

    private sowArrowForStep(step: BaoRenderStep, stepIdx: number): { from: string; to: string } | undefined {
        if (step.sowArrow !== undefined) {
            return step.sowArrow;
        }
        const firstDrop = step.pitsDropped?.[0];
        if (step.kind !== "drops" || firstDrop === undefined) {
            return undefined;
        }
        let inferred: { from: string; to: string } | undefined;
        if (stepIdx > 0) {
            const prev = this.steps[stepIdx - 1]!;
            const pickup = prev.lapResults.find((r) => r.type === "sow")?.pits?.[0];
            if (pickup !== undefined && pickup !== firstDrop) {
                inferred = { from: pickup, to: firstDrop };
            } else if (prev.kind === "capture" && step.relayEnterCell !== undefined) {
                const enter = step.relayEnterCell;
                if (enter !== firstDrop) {
                    inferred = { from: enter, to: firstDrop };
                }
            }
        } else if (stepIdx === 1 && this.steps[0]?.kind === "place") {
            const place = this.results.find((r) => r.type === "place");
            if (
                place !== undefined
                && place.type === "place"
                && place.where !== undefined
                && place.where !== firstDrop
            ) {
                inferred = { from: place.where, to: firstDrop };
            }
        }
        if (
            inferred !== undefined
            && this.isOneSowStep(inferred.from, inferred.to)
        ) {
            return inferred;
        }
        return undefined;
    }

    private moveAnnotationForGroup(group: BaoRenderStep[]): APMoveResult | undefined {
        const openingMove = this.results.find((r) => r.type === "move");
        for (const step of group) {
            if (
                step.kind === "drops"
                && step.relayEnterCell !== undefined
                && step.pitsDropped?.[0] === step.relayEnterCell
            ) {
                return openingMove;
            }
        }
        for (const step of group) {
            const stepIdx = this.steps.indexOf(step);
            const arrow = stepIdx >= 0 ? this.sowArrowForStep(step, stepIdx) : undefined;
            if (arrow !== undefined) {
                return {
                    type: "move",
                    from: arrow.from,
                    to: arrow.to,
                };
            }
        }
        return openingMove;
    }

    private groupAnnotations(
        group: BaoRenderStep[],
        groupIndex: number,
    ): APMoveResult[] {
        const place = this.results.find((r) => r.type === "place");
        const dropsStep = group.find((s) => s.kind === "drops");
        if (
            dropsStep !== undefined
            && group.length === 1
            && dropsStep.relayEnterCell !== undefined
            && groupIndex > 0
        ) {
            const relayAnn: APMoveResult[] = [
                { type: "place", where: dropsStep.relayEnterCell },
            ];
            const moveAnn = this.moveAnnotationForGroup(group);
            if (moveAnn !== undefined) {
                relayAnn.push(moveAnn);
            }
            return relayAnn;
        }

        const out: APMoveResult[] = [];
        for (const step of group) {
            out.push(...step.lapResults);
        }

        const openingWithCapture =
            groupIndex === 0
            && place !== undefined
            && group.some((s) => s.kind === "capture");
        if (openingWithCapture) {
            if (!out.some((r) => r.type === "place")) {
                out.unshift(place);
            }
        } else if (groupIndex === 0 && place !== undefined && group[0]?.kind === "place") {
            if (!out.some((r) => r.type === "place")) {
                out.unshift(place);
            }
        }

        const includeMove =
            this.moveAnnotationForGroup(group) !== undefined
            && groupIndex > 0
            && !openingWithCapture;
        if (includeMove) {
            const moveAnn = this.moveAnnotationForGroup(group);
            if (moveAnn !== undefined) {
                out.push(moveAnn);
            }
        }

        return out;
    }

    private boardBeforeGroupRep(group: BaoRenderStep[]): number[][] {
        const relayEnd = group.find((s) => s.kind === "relay_end");
        const drops = group.find((s) => s.kind === "drops");
        if (relayEnd !== undefined && drops !== undefined) {
            return relayEnd.board.map((row) => [...row]);
        }
        if (drops !== undefined) {
            return this.boardBeforeDrops(drops);
        }
        return this.boardBeforeGroup(group);
    }

    private buildStepGroupRep(
        group: BaoRenderStep[],
        groupIndex: number,
        opts?: IRenderOpts,
    ): APRenderRep {
        const last = group[group.length - 1]!;
        const board = last.board.map((row) => [...row]);
        const houses = last.houses;
        const blocked = last.blocked;
        const before = this.boardBeforeGroupRep(group);
        const deltas = this.boardDeltas(before, last.board);

        const annotations = this.groupAnnotations(group, groupIndex);
        return this.buildRenderRep(
            { board, houses, blocked, deltas },
            annotations,
            opts,
        );
    }

    private renderFromSteps(opts?: IRenderOpts): APRenderRep[] {
        const groups = this.collapsePickupSowGroups(this.steps);
        const reps = groups.map((group, i) =>
            this.buildStepGroupRep(group, i, opts),
        );
        reps.push(
            this.buildRenderRep(
                {
                    board: this.board,
                    houses: this.houses,
                    blocked: this.blocked,
                    deltas: this.deltas,
                },
                this.results,
                opts,
            ),
        );
        return reps;
    }

    private buildRenderRep(
        view: {
            board: number[][];
            houses: [string|undefined, string|undefined];
            blocked: [string|undefined, string|undefined];
            deltas: number[][];
        },
        annotationResults: APMoveResult[],
        opts?: IRenderOpts,
    ): APRenderRep {

        // Build piece string
        let pstr = "";
        for (let row = 0; row < 4; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: number[] = [];
            for (let col = 0; col < 8; col++) {
                pieces.push(view.board[row]![col]!);
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: this.hasDisplay(opts, "pips") ? "sowing-pips" : "sowing-numerals",
            board: {
                style: "sowing",
                width: 8,
                height: 4,
                showEndPits: false,
                markers: [
                    {
                        type:"edge",
                        edge:"N",
                        colour:2
                    },
                    {
                        type:"edge",
                        edge:"S",
                        colour:1
                    },
                ],
            },
            pieces: pstr
        };
        // Mark blocked pits
        for (const blocked of view.blocked) {
            if ( (blocked !== undefined) && (blocked !== null) ) {
                const [col, row] = this.graph.algebraic2coords(blocked);
                (rep.board as BoardBasic).markers!.push({
                    type: "outline",
                    colour: 1,
                    points: [{row, col}],
                })
            }
        }
        // Mark houses
        const houses: {row: number; col: number;}[] = [];
        for (const h of view.houses) {
            if ( ( h !== undefined) && (h !== null) ) {
                const [col, row] = this.graph.algebraic2coords(h);
                houses.push({row, col});
            }
        }
        if (houses.length > 0) {
            (rep.board as BoardBasic).squarePits = houses as [{row: number; col: number;}, ...{row: number; col: number;}[]]
        }

        // record deltas
        rep.annotations = [];
        const deltas: {row: number; col: number; delta: number}[] = [];
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 8; x++) {
                if (view.deltas[y]![x]! !== 0) {
                    deltas.push({row: y, col: x, delta: view.deltas[y]![x]!});
                }
            }
        }
        if (deltas.length > 0) {
            rep.annotations.push({type: "deltas", deltas});
        }

        // Add annotations
        if (annotationResults.length > 0) {
            for (const move of annotationResults) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    let wherestr = move.where!;
                    wherestr = wherestr.replace(/ /g, "");
                    const targets: {row: number; col: number;}[] = [];
                    for (const where of wherestr.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(where);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
                } else if (move.type === "sow") {
                    // sow pits are shown via deltas; no extra annotation type in scalar render
                }
            }
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.nowhat", {where: r.where!});
                return true;
            case "move":
                return true;
            case "sow":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:SOW.general", {pits: r.pits!.join(", "), count: r.pits!.length});
                return true;
            case "capture":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.bao", {pits: r.where!, count: r.count!});
                return true;
            case "infinite":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:INFINITE", {});
                return true;
            case "destroy":
                this.pushNeutralChatLine(lines, "apresults:DESTROY.bao", {pit: r.where!});
                return true;
            case "block":
                this.pushNeutralChatLine(lines, "apresults:BLOCK.bao", {pit: r.where!});
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public sidebarScores(): IScores[] {
        const statuses: IScores[] = [];
        if (this.inhand.reduce((prev, curr) => prev + curr, 0) > 0) {
            statuses.push({ name: this.neutralAreaLabel("apgames:status.PIECESINHAND"), scores: this.inhand });
        }
        statuses.push({ name: this.neutralAreaLabel("apgames:status.bao.BALANCE"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] });
        return statuses;
    }

    public getPlayerScore(player: number): number {
        let thisScore: number; let otherScore: number;
        if (player === 1) {
            thisScore = [...this.board[2], ...this.board[3]].reduce((prev, curr) => prev + curr, 0);
            otherScore = [...this.board[0], ...this.board[1]].reduce((prev, curr) => prev + curr, 0);
        } else {
            thisScore = [...this.board[0], ...this.board[1]].reduce((prev, curr) => prev + curr, 0);
            otherScore = [...this.board[2], ...this.board[3]].reduce((prev, curr) => prev + curr, 0);
        }
        return thisScore - otherScore;
    }

    public sameMove(move1: string, move2: string): boolean {
        move1 = move1.toLowerCase().replace(/\s+/g, "");
        move2 = move2.toLowerCase().replace(/\s+/g, "");
        if (move1 !== move2) {
            if ( (`${move1}*` === move2) || (move1 === `${move2}*`) ) {
                return true;
            } else {
                return false
            }
        }
        return true;
    }

    public clone(): BaoGame {
        return new BaoGame(this.serialize());
    }

    protected cloneBoard(): number[][] {
        return [...this.board.map(l => [...l])];
    }

    public checkEconomy() {
        const inhand = this.inhand[0] + this.inhand[1];
        const board = this.board.map(r => r.reduce((prev, curr) => prev + curr, 0)).reduce((prev, curr) => prev + curr, 0);
        if ( (inhand + board) !== 64) {
            throw new Error(`Invalid game economy! In hand: ${inhand}, on board: ${board}`);
        }
    }
}
