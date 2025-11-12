import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IRenderOpts } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError, StackSet } from "../common";
import { bfsFromNode, dfsFromNode } from 'graphology-traversal';
import i18next from "i18next";

export type playerid = 1|2;
export type cellcontent = playerid;
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

type MovePart = {
    action?: (
        board: Map<string,cellcontent>,
        action: string,
        previousAction: string
    ) => [boolean, Map<string, cellcontent>];
    condition?: (board: Map<string, cellcontent>, previousAction: string) => boolean;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontent>;
    lastmove?: string;
    winningLoop: string[];
}

export interface ISunspotState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SunspotGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Sunspot",
        uid: "sunspot",
        playercounts: [2],
        version: "1.0",
        dateAdded: "2025-10-28",
        // i18next.t("apgames:descriptions.sunspot")
        description: "apgames:descriptions.sunspot",
        urls: ["https://boardgamegeek.com/boardgame/444740/sunspot"],
        people: [
            {
                type: "designer",
                name: "Hoembla",
                urls: ["https://boardgamegeek.com/boardgamedesigner/148212/hoembla"],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        flags: ["pie", "no-moves", "experimental"],
        categories: ["goal>connect", "mechanic>place", "mechanic>convert", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        variants: [
            {uid: "size-4", group: "board"},
            {uid: "size-5", group: "board"},
            {uid: "size-6", group: "board"},
            {uid: "#board", },
            {uid: "size-8", group: "board"}
        ],
        displays: [{uid: "hide-interior"}]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontent>;
    public boardsize = 7;
    public graph: HexTriGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public outerRing: Set<string> = new Set();

    public winningLoop: string[] = [];

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, this.boardsize * 2 - 1);
    }

    public setRegions() {

        this.outerRing = new Set();

        for(const cell of this.graph.listCells() as string[]) {
            const numNeighbours = this.graph.neighbours(cell).length;
            switch(numNeighbours) {
                case 4:
                case 3:
                    this.outerRing.add(cell);
                    break;
            }
        }
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
    }

    public applyVariants(variants?: string[]) {
        this.variants = (variants !== undefined) ? [...variants] : [];
        for(const v of this.variants) {
            if(v.startsWith("size")) {
                const [,size] = v.split("-");
                this.boardsize = parseInt(size, 10);
                this.graph = this.getGraph();
            }
        }
        this.setRegions();
    }

    constructor(state?: ISunspotState | string, variants?: string[]) {
        super();

        if (state === undefined) {
            this.applyVariants(variants);

            const fresh: IMoveState = {
                _version: SunspotGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, cellcontent>(),
                winningLoop: [],
            };
            this.stack = [fresh];

        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISunspotState;
            }
            if (state.game !== SunspotGame.gameinfo.uid) {
                throw new Error(`The Sunspot engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.applyVariants(state.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SunspotGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];

        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.winningLoop = [...state.winningLoop];

        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newaction;
            if (this.board.has(cell) || move.startsWith(cell)) { // Have to accomodate counter-flipping the initially placed stone
                newaction = "X" + cell;
            } else {
                newaction = cell;
            }
            let newmove;
            if (move === "") {
                newmove = newaction;
            } else {
                newmove = move + ";" + newaction;
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

    /* Move parsing functions. There are both actions and conditions, which behave slightly differently.
     - The first return value indicates validity of (part of) the move
     - Finally, actions also return the board after the action has been applied.
     - Note that conditions don't have an 'action' argument.
     - Note that they must be arrow functions, to keep the 'this' in scope.
    */

    /* Actions */

    private doPlaceAction = (board: Map<string, cellcontent>, action: string): [boolean, Map<string, cellcontent>] => {
        const place = action.length > 0 && !action.startsWith('X') && !board.has(action);
        const newBoard = new Map(board);
        newBoard.set(action, this.currplayer);
        return [place, newBoard];
    }

    private doFlipAction = (board: Map<string, cellcontent>, action: string): [boolean, Map<string, cellcontent>] => {
        if (!action.startsWith('X')) {
            return [false, board];
        }
        const cell = action.slice(1);
        const flip = board.has(cell) && board.get(cell) === this.otherPlayer()
            && this.isInteriorStoneInCombinedGroup(cell, this.otherPlayer(), board);
        if (!flip) {
            return [false, board];
        }
        const newBoard = new Map(board);
        newBoard.set(cell, this.currplayer);
        return [true, newBoard];
    }

    private doCounterFlipAction = (board: Map<string, cellcontent>, action: string, previousAction: string): [boolean, Map<string, cellcontent>] => {
        if (!action.startsWith('X') || !previousAction.startsWith('X')) {
            return [false, board];
        }
        const cell = action.slice(1);
        const previousCell = previousAction.slice(1);
        // the stone must be an edge stone in the same group as the previously flipped stone
        const counterFlip = board.has(cell) && board.get(cell) === this.currplayer
            && this.isEdgeStone(cell, board) && this.areInSameGroup(previousCell, cell, this.currplayer, board);
        if (!counterFlip) {
            return [false, board]
        }
        const newBoard = new Map(board);
        dfsFromNode(this.graph.graph, cell, (c) => {
            if (board.get(c) === this.currplayer && this.isEdgeStone(c, board)) {
                newBoard.set(c, this.otherPlayer());
                return false;
            } else {
                return true;
            }
        });
        return [true, newBoard]
    }

    /* Conditions */

    private checkPlaceIsNotPossible = (board: Map<string, cellcontent>): boolean => {
        return board.size === this.graph.graph.order;
    }

    private checkCounterFlipIsPossible = (board: Map<string, cellcontent>, previousAction: string): boolean => {
        if (!previousAction.startsWith('X')) {
            return false;
        }
        const cell = previousAction.slice(1);
        return this.isInteriorStoneInCombinedGroup(cell, this.currplayer, board);
    }
    
    private checkCounterFlipIsNotPossible = (board: Map<string, cellcontent>, previousAction: string): boolean => {
        if (!previousAction.startsWith('X')) {
            return false;
        }
        const cell = previousAction.slice(1);
        const possible = this.isInteriorStoneInCombinedGroup(cell, this.currplayer, board);
        return !possible;
    }

    private checkFlipIsPossible = (board: Map<string, cellcontent>): boolean => {
        for (const [cell, content] of board) {
            if(content === this.otherPlayer() && !this.isEdgeStone(cell, board)){
                for(const cell2 of this.graph.neighbours(cell)){
                    if(this.board.has(cell2) && this.board.get(cell2) === this.otherPlayer()
                        && this.isEdgeStone(cell2, board)){
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private placeAction = {
        action: this.doPlaceAction
    }

    private flipAction = {
        condition: this.checkFlipIsPossible,
        action: this.doFlipAction
    }

    private counterFlipAction = {
        condition: this.checkCounterFlipIsPossible,
        action: this.doCounterFlipAction
    }

    private placeIsNotPossible = {
        condition: this.checkPlaceIsNotPossible
    }

    private counterFlipIsNotPossible = {
        condition: this.checkCounterFlipIsNotPossible
    }

    public validateMove(m: string): IValidationResult {
        if (m.length === 0) {
            return {
                valid: true,
                complete: -1,
                canrender: true,
                message: i18next.t("apgames:validation.slither.INITIAL_INSTRUCTIONS")
            }
        }

        const actions: string[] = m.split(';');
        // Valid cells
        try {
            for (const action of actions) {
                let cell;
                if(action.startsWith('X')){
                    cell = action.slice(1);
                } else {
                    cell = action;
                }
                this.graph.algebraic2coords(cell);
            }
        } catch {
            return {
                valid: false,
                complete: -1,
                message: i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
            }
        }

        const validMoves: MovePart[][] = [
            [this.placeAction],
            [this.placeIsNotPossible, this.flipAction, this.counterFlipIsNotPossible],
            [this.placeIsNotPossible, this.flipAction, this.counterFlipAction],
            [this.placeAction, this.flipAction, this.counterFlipIsNotPossible],
            [this.placeAction, this.flipAction, this.counterFlipAction]
        ];


        let complete = false; // found at least one (valid) complete move
        let incomplete = false; // found at least one (valid) incomplete move
        for (const movePartSequence of validMoves) {
            let remainingActionStrs = m.split(';');
            let previousActionStr = "";
            let board = this.board;
            let validComplete = true;
            for (const movePart of movePartSequence) {
                if (movePart.condition !== undefined) {
                    if(!movePart.condition(board, previousActionStr)){
                        validComplete = false;
                        break;
                    }
                }
                if (movePart.action !== undefined) {
                    if(remainingActionStrs.length) {
                        const thisActionStr = remainingActionStrs[0];
                        const [valid, newBoard] = movePart.action(board, thisActionStr, previousActionStr);
                        if (valid) { // all good, continue parsing
                            remainingActionStrs = remainingActionStrs.slice(1);
                            previousActionStr = thisActionStr;
                            board = newBoard;
                        } else { // Failed to apply this movePart, on to the next move type
                            validComplete = false;
                            break;
                        }
                    } else {
                        /* A possible action remains in this movePartSequence, but the move strings
                        have ran out. Since we got this far without any action or condition returnig false,
                        the move string represents a a valid but incomplete move corresponding to this
                        movePartSequence. */
                        incomplete = true;
                        validComplete = false;
                        break;
                    }
                }
            }
            if (validComplete && remainingActionStrs.length === 0) {
                complete = true;
            }
        }
        /* eslint-disable no-console */
        console.log("complete", complete, "incomplete", incomplete);

        if (complete || incomplete){
            const result: IValidationResult = {
                valid: true,
                complete: -1,
                canrender: true,
                message: i18next.t("apgames:validation._general.VALID_MOVE")
            };
            if (complete && !incomplete) {
                result.complete = 1;
            } else if (complete && incomplete) {
                result.complete = 0;
            } else if (!complete && incomplete) {
                result.complete = -1;
                result.message = i18next.t("apgames:validation._general.INCOMPLETE_MOVE");
            }
            return result
        } else {
            return {
                valid: false,
                complete: -1,
                message: i18next.t("apgames:validation._general.INVALID_MOVE")
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): SunspotGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        if (m === "") { return this; }

        this.results = [];

        let actions: string[] = m.split(';');

        if (!actions[0].startsWith('X')) {
            this.board = this.doPlaceAction(this.board, actions[0])[1];
            this.results.push({type: "place", where: actions[0]});
            actions = actions.slice(1);
        }
        const counterflippedStones: string[] = [];
        if (actions.length > 0) {
            this.board = this.doFlipAction(this.board, actions[0])[1];
            this.results.push({type: "convert", where: actions[0].slice(1), what: "p" + this.otherPlayer(), into: "p" + this.currplayer});
            if (actions.length > 1) {
                const counterflipCell = actions[1].slice(1);
                /* Store the counterflipped subgroup because we need it for end-of-game checking */
                dfsFromNode(this.graph.graph, counterflipCell, (c) => {
                    if (this.board.get(c) === this.currplayer && this.isEdgeStone(c, this.board)) {
                        counterflippedStones.push(c);
                        return false;
                    } else {
                        return true;
                    }
                });
                this.board = this.doCounterFlipAction(this.board, actions[1], actions[0])[1];
                this.results.push({type: "convert", where: counterflippedStones.join(','), what: "p" + this.currplayer, into: "p" + this.otherPlayer});
            }
        }

        if (partial) { return this; }

        this.lastmove = m;

        this.checkEOG(counterflippedStones);
        this.currplayer = this.otherPlayer();

        this.saveState();
        return this;
    }

    private isEdgeStone(cell: string, board: Map<string, cellcontent>): boolean {
        /* The stone is on the edge or can see the edge */
        if(this.outerRing.has(cell)){
            return true;
        }
        for (const dir of allDirections) {
            const ray = this.graph.ray(...this.graph.algebraic2coords(cell), dir).map(c => this.graph.coords2algebraic(...c));
            for (const c of ray) {
                if (board.has(c)) {
                    break;
                } else if(this.outerRing.has(c)) {
                    return true;
                }
            }
        }
        return false;
    }

    private isInteriorStoneInCombinedGroup(startCell: string, player: playerid, board: Map<string, cellcontent>): boolean {
        if(this.isEdgeStone(startCell, board)) {
            return false;
        } else {
            // We know the stone itself is an interior stone, so we can do a dfs on the group
            // and if we find one edge stone, we know it is a combined group
            let isCombinedGroup = false;
            dfsFromNode(this.graph.graph, startCell, (c) => {
                if (board.has(c) && board.get(c) === player) {
                    if(this.isEdgeStone(c, board)) {
                        isCombinedGroup = true;
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    return true;
                }
            });
            return isCombinedGroup;
        }
    }

    private areInSameGroup(cell1: string, cell2: string, player: playerid, board: Map<string, cellcontent>): boolean {
        let found = false;
        dfsFromNode(this.graph.graph, cell1, (c) => {
            if (c === cell2) {
                found = true;
                return true;
            }
            if (board.has(c) && board.get(c) === player) {
                return false;
            } else {
                return true;
            }
        });
        return found;
    }

    private isLoopAround(group: Set<string>, center: string): boolean {
        if (group.has(center)) {
            return false;
        }
        let reachedOuter = false;
        dfsFromNode(this.graph.graph, center, (cell) => {
            if (group.has(cell)) {
                return true;
            }
            else if (this.outerRing.has(cell)) {
                reachedOuter = true;
            }
            return false;
        });
        return !reachedOuter;
    }

    private isLoop(group: Set<string>, laststone: string): boolean {
        /* Check whether the group is a loop. For all neighbours of the last-added
        stone, check whether the path to the edge is blocked by the current group. */
        if(group.size < 6) {
            return false;
        }
        const neighbours = this.graph.neighbours(laststone);
        let isLoop = false;
        const checked = new Set()
        const graph = this.graph.graph;
        for (const neighbour of neighbours) {
            if(this.board.has(neighbour) && (this.board.get(neighbour) === this.board.get(laststone))){
                continue;
            }
            for(const checkedPiece of checked){
                if(graph.hasEdge(checkedPiece, neighbour)){
                    checked.add(neighbour);
                    continue;
                }
            }
            if (this.isLoopAround(group, neighbour)){
                isLoop = true;
                break;
            }
            checked.add(neighbour);
        }
        return isLoop;
    }

    private allShortestCycles(group: Set<string>, source: string): string[][] {
        /* Adapted from Graphology's allSimplePaths. Finds the shortest winning cycle,
        and any other cycles (if existing) of the same length, then returns them in
        an array.
        */
        const groupGraph = this.getGraph();
        for (const cell of this.graph.graph.nodes()) {
            if (!group.has(cell)) { groupGraph.graph.dropNode(cell); }
        }
        const graph = groupGraph.graph;

        let found = false;
        /* Iterative deepening dfs */
        for(let maxDepth = 6; maxDepth <= group.size; maxDepth++){
            const stack = [graph.outboundNeighbors(source)];
            const visited = StackSet.of(source, true);

            const paths: string[][] = [];
            let p: string[];
            let children;
            let child;

            while (stack.length !== 0) {
                children = stack[stack.length - 1];
                child = children.pop();

                if (!child) {
                    stack.pop();
                    visited.pop();
                } else {
                    if (visited.has(child)) continue;

                    /* Check whether the last three nodes of the path form a triangle,
                    if so we can skip the rest of this branch, because the shortest loop
                    will never contain an acute angle. */
                    p = visited.path(child);
                    const tri = p.slice(-3);
                    if(graph.hasEdge(tri[0], tri[1]) && graph.hasEdge(tri[1], tri[2]) &&
                        graph.hasEdge(tri[2], tri[0])){
                        continue;
                    }

                    if (child === source) {
                        if(this.isLoop(new Set(p), child)){
                            paths.push(p);
                            found = true;
                        }
                    }

                    visited.push(child);

                    if (!visited.has(source) && stack.length < maxDepth) {
                        stack.push(graph.outboundNeighbors(child));
                    } else {
                        visited.pop();
                    }
                }
            }
            if(found){
                return paths;
            }
        }
        return [];
    }

    public getWinningLoop(player: playerid, lastmove: string): string[] {
        /*
        Do a BFS to find all possible paths emanating from the placed stone, for each check if it's a winning loop.
        Since it is a BFS the shortest one will be found first.
        Could be sped up by not taking sharp-angled steps in the BFS.
        */
        // Find the current group of player stones
        const currentGroup = new Set<string>();
        bfsFromNode(this.graph.graph, lastmove, (cell) => {
            const value = this.board.get(cell);
            if (value === player) {
                currentGroup.add(cell);
                return false;
            } else {
                return true;
            }
        });
        // First check if there's a winning loop at all (i.e. path from center to edge is blocked by player stones)
        if (!this.isLoop(currentGroup, lastmove)) { return []; };

        const cycles = this.allShortestCycles(currentGroup, lastmove);

        return cycles[0]; // Arbitrary choice, all shortest cycles are equally winning
    }

    protected checkEOG(counterflippedStones: string[]): SunspotGame {
        /* Check for a loop of either player */
        if (this.lastmove == undefined) { return this; }

        let actions: string[] = this.lastmove.split(';');

        let currplayerloop: string[] = [];
        let otherplayerloop: string[] = [];

        if (!actions[0].startsWith('X')) { // Placement
            currplayerloop = this.getWinningLoop(this.currplayer, actions[0]);
            actions = actions.slice(1);
        }
        if (actions.length > 0) { // Flip
            const flipCell = actions[0].slice(1)
            currplayerloop = this.getWinningLoop(this.currplayer, flipCell);
            /* Special case: A flip could make an opponent's blob into a winning loop */
            let loopAround = true;
            for (const nb of this.graph.neighbours(flipCell)) {
                if (! (this.board.has(nb) && this.board.get(nb) === this.otherPlayer())) {
                    loopAround = false;
                }
            }
            if (loopAround) {
                // Just to get the loop in the right order
                otherplayerloop = this.getWinningLoop(this.otherPlayer(), this.graph.neighbours(flipCell)[0]);
            }

            if (actions.length > 1) { // Counter-flip
                // Have to check all of them and not just the clicked stone,
                // since not all stones in a counter-flipped group
                // will necessarily be part of a loop, but some may be.
                for (const counterflipCell of counterflippedStones) {
                    const loop = this.getWinningLoop(this.otherPlayer(), counterflipCell);
                    if (loop.length) {
                        otherplayerloop = loop;
                        break;
                    }
                }
            }
        }

        if (currplayerloop.length > 0) {
            this.winner.push(this.currplayer);
            this.winningLoop = currplayerloop;
        } else if (otherplayerloop.length > 0) {
            this.winner.push(this.otherPlayer());
            this.winningLoop = otherplayerloop;
        }

        this.gameover = this.winner.length > 0;
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ISunspotState {
        return {
            game: SunspotGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        const state = {
            _version: SunspotGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningLoop: [...this.winningLoop],
        };
        return state;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showInterior = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-interior") {
                showInterior = false;
            }
        }

        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                const piece: string[] = [];
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;

                    if (player === 1) { piece.push(
                        (!this.isEdgeStone(cell, this.board) && showInterior) ? "A2" : "A"); }
                    else { piece.push(
                        (!this.isEdgeStone(cell, this.board) && showInterior) ? "B2" : "B"); }
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        // Build rep

        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardsize,
                maxWidth: this.boardsize * 2 - 1,
                alternatingSymmetry: false
            },
            legend: {
                A: {name: "piece", colour: 1},
                A2: [
                    {name: "piece", colour: 1},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: 1,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.3, opacity: 0.5}
                ],
                B: {name: "piece", colour: 2},
                B2: [
                    {name: "piece", colour: 2},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: 2,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.3, opacity: 0.5}
                ],
            },
            pieces: pstr as [string[][], ...string[][][]]
        };

        rep.annotations = [];
        for (const move of this.stack.at(-1)!._results) {
            if (move.type === "place" || move.type === "convert") {
                for (const cell of move.where!.split(',')){
                    const [x, y] = this.graph.algebraic2coords(cell);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this.winningLoop.length > 0) {
            const targets: RowCol[] = [];
            for (const cell of this.winningLoop) {
                const [x, y] = this.graph.algebraic2coords(cell);
                targets.push({row: y, col: x})
            }
            rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        return rep;
    }

    public clone(): SunspotGame {
        return new SunspotGame(this.serialize());
    }
};
