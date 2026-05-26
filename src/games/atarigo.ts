import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, replacer, reviver, UserFacingError, SquareOrthGraph } from "../common";
import { connectedComponents } from "graphology-components";
import pako, { Data } from "pako";

import i18next from "i18next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

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
}

export interface IAtariGoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AtariGoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Atari Go",
        uid: "atarigo",
        playercounts: [2],
        version: "20260519",
        dateAdded: "2026-05-25",
        // i18next.t("apgames:descriptions.go")
        description: "apgames:descriptions.atarigo",
        urls: [
                "https://senseis.xmp.net/?AtariGo",
              ],
        people: [
            {
                type: "designer",
                name: "安田 泰敏 (Yasuda Yasutoshi)",
                urls: ["https://senseis.xmp.net/?YasutoshiYasuda"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "size-9",  group: "board" },
            { uid: "size-11", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "#board", }, // 19x19
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>rect", "components>simple>1per"],
        flags: ["pie", "scores", "experimental"],
        displays: [{uid: "show-controlled-areas"}],
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
    public scores: [number, number] = [0, 0];

    private boardSize = 19;
    private grid: RectGrid;
    private whoCaptured: playerid = 3; // when 1 or 2 the game ends

    constructor(state?: IAtariGoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: AtariGoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                // is the state a raw JSON obj
                if (state.startsWith("{")) {
                    state = JSON.parse(state, reviver) as IAtariGoState;
                } else {
                    const decoded = Buffer.from(state, "base64") as Data;
                    const decompressed = pako.ungzip(decoded, {to: "string"});
                    state = JSON.parse(decompressed, reviver) as IAtariGoState;
                }
            }
            if (state.game !== AtariGoGame.gameinfo.uid) {
                throw new Error(`The Atari Go game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
    }

    public load(idx = -1): AtariGoGame {
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

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.isSelfCapture(cell, player)) { continue; }
                moves.push(cell);
            }
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.atarigo.INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves(); // get all valid complete moves

        if (m === "pass") { // currently not used (no pass rule in Atari Go)
            if (allMoves.includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.atarigo.INVALID_PASS");
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
            result.message = i18next.t("apgames:validation.atarigo.SELF_CAPTURE", { where: m });
            return result;
        }

        if (this.stack.length > 3) {
            const cloned = this.clone();
            // fake the placement to check cycles
            cloned.board.set(m, this.currplayer);
            const allCaptures = cloned.getCaptures(m, this.currplayer);
            // ... and fake also the captures from that placement
            for (const captures of allCaptures) {
                for (const capture of captures) {
                    cloned.board.delete(capture);
                }
            }

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
                if (captures.size > 0) {
                    allCaptures.push(captures);
                }
            }
        }
        return allCaptures;
    }

    private isSelfCapture(cell: string, player: playerid): boolean {
        // Check if placing `cell` would result in a self-capture.
        if (this.getCaptures(cell, player).length > 0) { return false; }
        return this.getGroupLiberties(cell, [], player)[1] === 0;
    }

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
            if (p1AdjacentCells.length > 0 && p2AdjacentCells.length == 0) {
                owner = 1;
            }
            if (p1AdjacentCells.length == 0 && p2AdjacentCells.length > 0) {
                owner = 2;
            }
            territories.push({cells: area, owner});
        }
        return territories;
    }

    public move(m: string, {partial = false, trusted = false} = {}): AtariGoGame {
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
        }
        if (m.length === 0) { return this; }
        this.results = [];

        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);
        const allCaptures = this.getCaptures(m, this.currplayer);
        if (allCaptures.length > 0) {
            for (const captures of allCaptures) {
                for (const capture of captures) { this.board.delete(capture); }
                this.results.push({ type: "capture", where: [...captures].join(), count: captures.size });
            }
            // a capture was made, so the game will end
            this.whoCaptured = this.currplayer;
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): AtariGoGame {
        this.gameover = this.whoCaptured !== 3;

        if (this.gameover) {
            this.winner = [this.whoCaptured];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IAtariGoState {
        return {
            game: AtariGoGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AtariGoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let highlightAreas = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "show-controlled-areas") {
                highlightAreas = true;
            }
        }

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
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
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

        if (highlightAreas || this.gameover) {
            const territories = this.getTerritories();
            const markers: Array<MarkerDots> = []
            for (const t of territories) {
                if (t.owner !== undefined) {
                    const points = t.cells.map(c => this.algebraic2coords(c));
                    if (t.owner !== 3) {
                        markers.push({type: "dots",
                                      colour: t.owner,
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

        const terr = this.getTerritories();
        return terr.filter(t => t.owner === player).reduce((prev, curr) => prev + curr.cells.length, playerPieces.length);
    }

    public sidebarScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }];
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

    public clone(): AtariGoGame {
        const cloned = Object.assign(new AtariGoGame(), deepclone(this) as AtariGoGame);
        // deepclone() is not cloning RectGrid, so DIY:
        cloned.grid = Object.assign(new RectGrid(this.boardSize, this.boardSize),
                                    deepclone(this.grid) as RectGrid);
        return cloned;
    }
}
