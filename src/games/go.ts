import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, replacer, reviver, UserFacingError, SquareOrthGraph } from "../common";
//import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";

import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
import pako, { Data } from "pako";

type playerid = 1 | 2 | 3; // 3 is for neutral owned areas

type Territory = {
    cells: string[];
    owner: playerid|undefined;
};

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
    komi?: number;
    swapped: boolean;
}

export interface IGoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Go",
        uid: "go",
        playercounts: [2],
        version: "20260225",
        dateAdded: "2026-02-25",
        // i18next.t("apgames:descriptions.go")
        description: "apgames:descriptions.go",
        urls: ["https://boardgamegeek.com/boardgame/12146/go"],
        people: [
            {
                type: "designer",
                name: "Traditional",
                urls: ["https://boardgamegeek.com/boardgamedesigner/"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "size-5",  group: "board" },
            { uid: "size-9",  group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "size-17", group: "board" },
            { uid: "#board", },
            { uid: "size-21", group: "board" },
            { uid: "size-25", group: "board" },
            { uid: "size-37", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>connect>rect", "components>simple"],
        flags: ["scores", "custom-buttons", "custom-colours", "experimental"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0.5];
    public komi?: number;
    public swapped = true;

    private boardSize = 19;
    private grid: RectGrid;

    constructor(state?: IGoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: GoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0.5],
                swapped: true
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                // is the state a raw JSON obj
                if (state.startsWith("{")) {
                    state = JSON.parse(state, reviver) as IGoState;
                } else {
                    const decoded = Buffer.from(state, "base64") as Data;
                    const decompressed = pako.ungzip(decoded, {to: "string"});
                    state = JSON.parse(decompressed, reviver) as IGoState;
                }
            }
            if (state.game !== GoGame.gameinfo.uid) {
                throw new Error(`The Go game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
    }

    public load(idx = -1): GoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        this.scores = [...state.scores];
        this.komi = state.komi;
        this.swapped = false;
        // We have to check the first state because we store the updated version in later states
        if (state.swapped === undefined) {
            this.swapped = this.stack.length < 3 || this.stack[2].lastmove !== "play-second";
        } else {
            this.swapped = state.swapped;
        }
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 19;
    }

    public isKomiTurn(): boolean {
        return this.stack.length === 1;
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        const moves: string[] = [];

        if (this.isKomiTurn()) {
            return [];
        } else if (this.isPieTurn()) {
            moves.push("play-second");
        } else {
            moves.push("pass");
        }

        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.isSelfCapture(cell, player)) { continue; }
                if (this.checkKo(cell, player)) { continue; }
                moves.push(cell);
            }
        }
        return moves;
    }

    private hasMoves(player?: playerid): boolean {
        // Check if the player has any valid moves.
        if (player === undefined) {
            player = this.currplayer;
        }
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.isSelfCapture(cell, player)) { continue; }
                if (this.checkKo(cell, player)) { continue; }
                return true;
            }
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public getButtons(): ICustomButton[] {
        if (this.moves().includes("pass"))
            return [{ label: "pass", move: "pass" }];
        if (this.moves().includes("play-second"))
            return [{ label: "playsecond", move: "play-second" }];
        return []; // no buttons should appear when typing Komi at start
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (this.isKomiTurn()) { // Komi time, so no clicks are acceptable
                const dummyResult = this.validateMove("") as IClickResult;
                dummyResult.move = "";
                dummyResult.valid = false;
                return dummyResult;
            }

            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            newmove = cell;
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.isKomiTurn()) {
            if (m.length === 0) {
                // game is starting, show initial KOMI message
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.go.INITIAL_SETUP");
                return result;
            }

            // player typed something in the move textbox,
            // check if it is an integer or a number with 0.5 decimal part
            if (! /^-?\d+(\.[05])?$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.go.INVALID_KOMI");
                return result
            }
            result.valid = true;
            result.complete = 0; // partial because player can continue typing for abs(Komi) > 9
            result.message = i18next.t("apgames:validation.go.INSTRUCTIONS");
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            //result.canrender = true;
            if (this.isPieTurn()) {
                result.message = i18next.t("apgames:validation.go.KOMI_CHOICE");
            } else {
                result.message = i18next.t("apgames:validation.go.INSTRUCTIONS")
            }
            return result;
        }

        if (m === "play-second") {
            if (this.isPieTurn()) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.go.INVALID_PLAYSECOND");
            }
            return result;
        }

        // get all valid complete moves (so each move will be like "a1,b1,c1")
        const allMoves = this.moves();

        if (m === "pass") {
            if (allMoves.includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.plurality.INVALID_PASS");
                return result;
            }
        }

        // Valid cell
        try {
            this.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
            return result;
        }
        if (this.isSelfCapture(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.go.SELF_CAPTURE", { where: m });
            return result;
        }
        if (this.checkKo(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.go.KO");
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        result.canrender = true;
        return result;
    }

    private orthNeighbours(cell: string): string[] {
        const [x, y] = this.algebraic2coords(cell);
        const neighbours = this.grid.adjacencies(x, y, false);
        return neighbours.map(n => this.coords2algebraic(...n));
    }

    private getGroupLiberties(cell: string, opponentPlaced: string[], player: playerid): [Set<string>, number] {
        // Get all groups associated with `cell` and the liberties of the group.
        // The `cell` does not need to be placed on the `board`. We assume that it's already there.
        const seen: Set<string> = new Set();
        const liberties = new Set<string>();
        const todo: string[] = [cell]
        while (todo.length > 0) {
            const cell1 = todo.pop()!;
            if (seen.has(cell1)) { continue; }
            seen.add(cell1);
            for (const n of this.orthNeighbours(cell1)) {
                if (!this.board.has(n) && !opponentPlaced.includes(n) && n !== cell) {
                    liberties.add(n);
                    continue;
                }
                if (this.board.get(n) === player) { todo.push(n);
                }
            }
        }
        return [seen, liberties.size];
    }

    private getCaptures(cell: string, player: playerid): Set<string>[] {
        // Get all captured cells if `cell` is placed on the board.
        const allCaptures: Set<string>[] = []
        for (const n of this.orthNeighbours(cell)) {
            if (allCaptures.some(x => x.has(n)) || !this.board.has(n) || this.board.get(n) === player) { continue; }
            const [group, liberties] = this.getGroupLiberties(n, [cell], player % 2 + 1 as playerid);
            if (liberties === 0) {
                const captures = new Set<string>();
                for (const c of group) {
                    captures.add(c);
                }
                if (captures.size > 0) { allCaptures.push(captures); }
            }
        }
        return allCaptures;
    }

    private isSelfCapture(cell: string, player: playerid): boolean {
        // Check if placing `cell` would result in a self-capture.
        if (this.getCaptures(cell, player).length > 0) { return false; }
        return this.getGroupLiberties(cell, [], player)[1] === 0;
    }

    private checkKo(cell: string, player: playerid): boolean {
        // Check if the move is a ko.
        if (this.stack.length < 2) { return false; }
        const captures = this.getCaptures(cell, player);
        if (captures.length !== 1) { return false; }
        if (captures[0].size !== 1) { return false; }
        const previous = this.stack[this.stack.length - 1];
        const previousMove = previous.lastmove!;
        if (!captures.some(x => x.has(previousMove))) { return false; }
        const previousCaptures = previous._results.filter(r => r.type === "capture")
        if (previousCaptures.length !== 1) { return false; }
        return (previousCaptures[0] as Extract<APMoveResult, { type: 'capture' }>).count! === 1;
    }

    // --- These next methods are helpers to find territories and their eventual owners ---- //

    public getGraph(): SquareOrthGraph { // just orthogonal connections
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    /**
     * What pieces are orthogonally adjacent to a given area?
     */
    public getAdjacentPieces(area: string[], pieces: string[]): string[] {
      // convert area strings to numeric coordinates
      const areaCoords = area.map(cell => this.algebraic2coords(cell));

      return pieces.filter(pieceStr => {   // Filter the pieces array
        const piece = this.algebraic2coords(pieceStr);

        return areaCoords.some(square => {  // check adjacency
          const dx = Math.abs(piece[0] - square[0]);
          const dy = Math.abs(piece[1] - square[1]);
          return (dx == 1 && dy == 0) || (dx == 0 && dy == 1);
        });
      });
    }

    /**
     * Get all available territories (based in Asli)
     * This is used in (1) computing scores, and (2) in the render process
     */
    public getTerritories(): Territory[] {
        const p1Pieces = [...this.board.entries()].filter(([,owner]) => owner === 1).map(pair => pair[0]);
        const p2Pieces = [...this.board.entries()].filter(([,owner]) => owner === 2).map(pair => pair[0]);
        const allPieces = [...p1Pieces, ...p2Pieces];

        // compute empty areas
        const gEmpties = this.getGraph();
        for (const node of gEmpties.graph.nodes()) {
            if (allPieces.includes(node)) {  // remove intersections/nodes with pieces
                gEmpties.graph.dropNode(node);
            }
        }
        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);

        const territories: Territory[] = [];
        for(const area of emptyAreas) {
            let owner : playerid = 3; // default value: neutral area
            // find who owns it
            const p1AdjacentCells = this.getAdjacentPieces(area, p1Pieces);
            const p2AdjacentCells = this.getAdjacentPieces(area, p2Pieces);
            if (p2AdjacentCells.length == 0) {
                owner = 1;
            }
            if (p1AdjacentCells.length == 0) {
                owner = 2;
            }
            territories.push({cells: area, owner});
        }
        return territories;
    }

    public move(m: string, {partial = false, trusted = false} = {}): GoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && ! this.isKomiTurn() && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];

        if (this.isKomiTurn()) {
            // first move, get the Komi proposed value, and add komi to game state
            this.komi = parseInt(m, 10);
            this.results.push({type: "komi", value: this.komi});
            this.komi *= -1; // Invert it for backwards compatibility reasons
        } else if (m === "play-second") {
            this.komi! *= -1;
            this.swapped = false;
            this.results.push({type: "play-second"});
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
            const allCaptures = this.getCaptures(m, this.currplayer);
            if (allCaptures.length > 0) {
                for (const captures of allCaptures) {
                    for (const capture of captures) { this.board.delete(capture); }
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.size });
                }
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): GoGame {
        if (this.stack.length < 4) {
            return this; // no time for komi and two consecutive passes
        }

        // game ends if two consecutive passes occurred
        this.gameover = this.lastmove === "pass" &&
                        this.stack[this.stack.length - 1].lastmove === "pass";

        const otherPlayer = this.currplayer % 2 + 1 as playerid;

        if (!this.gameover && !this.hasMoves(this.currplayer)) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "stalemate" });
            return this;
        }

        // if a cycle is found, the game ends in a draw
        if (!this.gameover) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const count = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));
            if (count >= 1) {
                this.gameover = true;
                this.winner = [1, 2];
                this.results.push({ type: "eog", reason: "repetition" });
                return this;
            }
        }

        if (this.gameover) {
            this.scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
            // draws by score are impossible
            this.winner = this.scores[0] > this.scores[1] ? [1] : [2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IGoState {
        return {
            game: GoGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: GoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            komi: this.komi,
            swapped: this.swapped
        };
    }

    public getPlayerColour(player: playerid): number | string {
        return (player == 1 && !this.swapped) || (player == 2 && this.swapped) ? 1 : 2;
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: this.getPlayerColour(1) }],
                B: [{ name: "piece", colour: this.getPlayerColour(2) }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
        }

        if (this.gameover) {
            const territories = this.getTerritories();
            const markers: Array<MarkerDots> = []
            for (const t of territories) {
                if (t.owner !== undefined) {
                    const points = t.cells.map(c => this.algebraic2coords(c));
                    if (t.owner !== 3) {
                        markers.push({type: "dots",
                                      colour: this.getPlayerColour(t.owner),
                                      points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
                    }
                }
            }
            if (markers.length > 0) {
                (rep.board as BoardBasic).markers = markers;
            }
        }

        return rep;
    }

    public getPlayerScore(player: playerid): number {
        const playerPieces =
          [...this.board.entries()].filter(([,owner]) => owner === player)
                                   .map(pair => pair[0]);
        let komi = 0.0;
        if (player === 1 && this.komi !== undefined && this.komi < 0)
            komi = -this.komi;
        if (player === 2 && this.komi !== undefined && this.komi > 0)
            komi = this.komi;

        const terr = this.getTerritories();
        return terr.filter(t => t.owner === player).reduce((prev, curr) => prev + curr.cells.length, komi + playerPieces.length);
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.group_nowhere", { player, count: r.count }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "repetition") {
                    node.push(i18next.t("apresults:EOG.repetition", { count: 1 }));
                } else if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public serialize(opts?: {strip?: boolean, player?: number}): string {
        const json = JSON.stringify(this.state(), replacer);
        const compressed = pako.gzip(json);

        return Buffer.from(compressed).toString("base64") as string;
    }

    public clone(): GoGame {
        return new GoGame(this.serialize());
    }
}
