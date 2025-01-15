import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerOutline, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { CubeoBoard } from "./cubeo/board";
import { CubeoDie } from "./cubeo/die";
import { UndirectedGraph } from "graphology/dist/graphology";
import { Combination } from "js-combinatorics";
import { Glyph } from "@abstractplay/renderer/build";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
// 0 means >6, and therefore a winning merge
export type Pips = 1|2|3|4|5|6|0;

export type NodeData = {
    contents?: CubeoDie;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: CubeoBoard;
    lastmove?: string;
};

export interface ICubeoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const genPathsRecursive = (g: UndirectedGraph, paths: string[][], sofar: string[], pips: number): void => {
    if (sofar.length === pips+1) {
        paths.push([...sofar]);
    } else {
        for (const n of g.neighbors(sofar[sofar.length - 1])) {
            genPathsRecursive(g, paths, [...sofar, n], pips);
        }
    }
}

export class CubeoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Cubeo",
        uid: "cubeo",
        playercounts: [2],
        version: "20250105",
        dateAdded: "2025-01-09",
        // i18next.t("apgames:descriptions.cubeo")
        description: "apgames:descriptions.cubeo",
        urls: ["https://boardgamegeek.com/boardgame/191916/cubeo"],
        people: [
            {
                type: "designer",
                name: "Marek Kolcun",
                urls: ["https://boardgamegeek.com/boardgamedesigner/88381/marek-kolcun"],
            },
        ],
        variants: [
            {uid: "strict", group: "moves"}
        ],
        categories: ["goal>immobilize", "goal>score>race", "mechanic>place", "mechanic>move", "board>dynamic", "board>shape>rect", "board>connect>rect", "components>dice"],
        flags: ["automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: CubeoBoard;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public dots: [number,number][] = [];
    private eogTriggered = false;

    constructor(state?: ICubeoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new CubeoBoard();
            board.add(new CubeoDie({x: 0, y: 0, owner: 1, pips: 1}));
            board.add(new CubeoDie({x: 1, y: 0, owner: 2, pips: 1}));
            const fresh: IMoveState = {
                _version: CubeoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICubeoState;
            }
            if (state.game !== CubeoGame.gameinfo.uid) {
                throw new Error(`The Cubeo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CubeoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = CubeoBoard.deserialize(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public diceInHand(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        return 6 - this.board.getDiceOf(p).length;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];
        const g = this.board.graph;
        const gOrth = new SquareOrthGraph(g.width, g.height);

        // adding to the board
        if (this.diceInHand() > 0) {
            const empties = [...g.graph.nodeEntries()].filter(({attributes}) => !("contents" in attributes)).map(({node}) => node);
            for (const cell of empties) {
                // if orthogonally adjacent to your own dice but don't touch enemy dice
                let isSelfAdj = false;
                let isEnemyAdj = false;
                for (const n of gOrth.graph.neighbors(cell)) {
                    if (g.graph.hasNode(n) && g.graph.hasNodeAttribute(n, "contents")) {
                        const die = CubeoDie.deserialize((g.graph as UndirectedGraph<NodeData>).getNodeAttribute(n, "contents")!);
                        if (die.owner === this.currplayer) {
                            isSelfAdj = true;
                        } else {
                            isEnemyAdj = true;
                        }

                    }
                }
                if (isSelfAdj && !isEnemyAdj) {
                    const [absx, absy] = this.board.rel2abs(...g.algebraic2coords(cell));
                    // finally, make sure this final cell can be slid to
                    if (this.board.canSlide(absx, absy)) {
                        moves.push(`+${absx},${absy}`);
                    }
                }
            }
        }
        const mine = this.board.getDiceOf(this.currplayer);
        // moving
        for (const die of mine) {
            // pinned dice may not move *at all*
            if (this.board.isPinned(die.x, die.y)) {
                continue;
            }
            // get graph of moving die and all empty spaces
            const gMove = this.board.moveGraphFor(die.x, die.y);
            if (gMove !== undefined) {
                const start = gMove.coords2algebraic(...this.board.abs2rel(die.x, die.y)!);
                // recursively generate a list of paths of the correct length, including backtracking
                const paths: string[][] = [];
                genPathsRecursive(gMove.graph, paths, [start], die.pips);
                // for each path, move the piece and make sure the board has changed
                const validTargets = new Set<string>(paths.map(p => p[p.length - 1]));
                // remove the starting cell from this list
                validTargets.delete(start);
                for (const target of validTargets) {
                    const [newx, newy] = this.board.rel2abs(...gMove.algebraic2coords(target));
                    const next = new CubeoDie({x: newx, y: newy, owner: die.owner, pips: die.pips});
                    const cloned = this.board.clone();
                    // these should never throw!
                    cloned.removeDie(die);
                    cloned.add(next);
                    if (this.variants.includes("strict")) {
                        if (!this.board.isEquivalent(cloned)) {
                            moves.push(`${[die.pips, die.x, die.y].join(",")}->${next.x},${next.y}`);
                        }
                    } else {
                        moves.push(`${[die.pips, die.x, die.y].join(",")}->${next.x},${next.y}`);
                    }
                }
            }
        }
        // merging
        if (mine.length >= 3) {
            // get all pairs of dice
            const pairs: Combination<CubeoDie> = new Combination(mine, 2);
            for (const [d1, d2] of pairs) {
                // must share an x or y coordinate
                if (d1.x === d2.x || d1.y === d2.y) {
                    // must be adjacent
                    if (Math.max(Math.abs(d1.x - d2.x), Math.abs(d1.y - d2.y)) === 1) {
                        // at least one die can't be pinned
                        let isPinned = true;
                        for (const d of [d1, d2]) {
                            if (!this.board.isPinned(d.x, d.y)) {
                                isPinned = false;
                                break;
                            }
                        }
                        // at least one die must have access to the outside
                        let canSlide = false;
                        for (const d of [d1, d2]) {
                            if (this.board.canSlide(d.x, d.y)) {
                                canSlide = true;
                                break;
                            }
                        }
                        if (!isPinned && canSlide) {
                            // still no guarantee
                            // it's possible one die is pinned and the other is blocked
                            if (!this.board.isPinned(d1.x, d1.y) && this.board.canSlide(d1.x, d1.y)) {
                                moves.push(`${[d1.pips, d1.x, d1.y].join(",")}+>${[d2.x, d2.y].join(",")}`);
                            }
                            if (!this.board.isPinned(d2.x, d2.y) && this.board.canSlide(d2.x, d2.y)) {
                                moves.push(`${[d2.pips, d2.x, d2.y].join(",")}+>${[d1.x, d1.y].join(",")}`);
                            }
                        }
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b))
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const realx = this.board.minX + (col - 1);
            const realy = this.board.maxY - (row - 1);
            const die = this.board.getDieAt(realx, realy);
            let newmove = "";

            // if clicking on empty space, either place or ending move
            if (die === undefined) {
                // empty move means placement
                if (move === "") {
                    newmove = `+${realx},${realy}`;
                }
                // otherwise moving
                else {
                    const [from,] = move.split("->")
                    newmove = `${from}->${realx},${realy}`;
                }
            }
            // if clicking on a die, starting a move or starting/ending a merge
            else {
                // empty move means starting a move or merge
                if (move === "") {
                    newmove = [die.pips, die.x, die.y].join(",");
                }
                // otherwise ending a merge
                else {
                    const [from,] = move.split("+>")
                    newmove = `${from}+>${realx},${realy}`;
                }
            }

            // autocomplete moves when there is only one option
            const starts = this.moves().filter(m => m.startsWith(newmove));
            if (starts.length === 1) {
                newmove = starts[0];
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.cubeo.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allmoves = this.moves();
        if (allmoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // validate placements
        if (m.startsWith("+")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.cubeo.BAD_PLACE");
            return result;
        }
        // then moves and merges
        else {
            // check for partials first
            if (/^\d,\-?\d+,\-?\d+$/.test(m)) {
                const [,x,y] = m.split(",").map(n => parseInt(n, 10));
                const die = this.board.getDieAt(x,y);
                // die exists
                if (die === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: `${x},${y}`});
                    return result;
                }
                // die belongs go you
                if (die.owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
                // if die is pinned, then it can't do anything
                if (this.board.isPinned(x, y)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cubeo.PINNED");
                    return result;
                }

                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            } else {
                // bad moves
                if (m.includes("->")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cubeo.BAD_MOVE", {context: this.variants.includes("strict") ? "strict" : "standard"});
                    return result;
                }
                // bad merge
                else if (m.includes("+>")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.cubeo.BAD_MERGE");
                    return result;
                }
                // catchall
                else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): CubeoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allmoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (!partial) && (! allmoves.includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        // if partial, populate dots and get out
        if (partial && !m.startsWith("+")) {
            const [from,] = m.split(/[-\+]\>/);
            this.dots = [...allmoves.filter(mv => mv.startsWith(from)).map(mv => mv.split(">")[1])].map(coords => coords.split(",").map(n => parseInt(n, 10)) as [number,number]);
            return this;
        }

        this.dots = [];
        this.results = [];
        // placements
        if (m.startsWith("+")) {
            const [x, y] = m.substring(1).split(",").map(n => parseInt(n, 10));
            this.board.add(new CubeoDie({x, y, pips: 1, owner: this.currplayer}));
            this.results.push({type: "place", where: m.substring(1)})
        }
        // moves and merges
        else {
            const [from, to] = m.split(/[-\+]\>/);
            const [fsize, fx, fy] = from.split(",").map(n => parseInt(n, 10));
            const [tx, ty] = to.split(",").map(n => parseInt(n, 10));
            const fDie = this.board.getDieAt(fx, fy)!;
            const tDie = this.board.getDieAt(tx, ty);
            // if to is empty, then move
            if (tDie === undefined) {
                this.board.removeDieAt(fx, fy);
                this.board.add(new CubeoDie({x: tx, y: ty, pips: fDie.pips, owner: fDie.owner}));
                this.results.push({type: "move", from: `${fx},${fy}`, to, what: fsize.toString()});
            }
            // otherwise merge
            else {
                let newsize = fDie.pips + tDie.pips;
                if (newsize > 6) {
                    newsize = 0;
                    this.eogTriggered = true;
                }
                this.board.removeDieAt(fx, fy);
                this.board.replaceDieAt(tx, ty, newsize as Pips);
                this.results.push({type: "move", from: `${fx},${fy}`, to, what: fsize.toString()});
                this.results.push({type: "promote", from: tDie.pips.toString(), to: newsize.toString(), where: to});
            }
        }

        // failsafe connection check
        if (!this.board.isConnected) {
            throw new Error("Invalid formation detected.");
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CubeoGame {
        const otherPlayer = this.currplayer === 1 ? 2 : 1;

        let reason: string|undefined;
        // if eog triggered by merge, previous player wins
        if (this.eogTriggered) {
            this.gameover = true;
            this.winner = [otherPlayer];
            reason = "promotion";
        }
        // if current player has no moves, previous player wins
        else if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [otherPlayer];
            reason = "nomoves";
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ICubeoState {
        return {
            game: CubeoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CubeoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.clone(),
        };
    }

    public render(): APRenderRep {
        const {minX, minY, maxX, maxY} = this.board.dimensions;
        const g = this.board.graph;
        const [width, height] = [g.width, g.height];

        const rowLabels: string[] = [];
        for (let y = minY - 1; y <= maxY + 1; y++) {
            rowLabels.push(y.toString());
        }
        const columnLabels: string[] = [];
        for (let x = minX - 1; x <= maxX + 1; x++) {
            columnLabels.push(x.toString());
        }

        // build pieces string
        const pieces = (g.listCells(true) as string[][]).map(r => r.map(node => {
            const [x, y] = this.board.rel2abs(...g.algebraic2coords(node));
            const die = this.board.getDieAt(x, y);
            if (die === undefined) {
                return "-";
            } else {
                return `${die.owner === 1 ? "A" : "B"}${die.pips}`;
            }
        })).map(r => r.join(",")).join("\n");

        // build legend
        const legend: {[k: string]: Glyph} = {};
        for (const p of [1,2] as const) {
            for (const size of [0,1,2,3,4,5,6] as const) {
                legend[`${p === 1 ? "A" : "B"}${size}`] = {
                    name: `d6-${size === 0 ? "empty" : size}`,
                    colour: p,
                    scale: 1.15,
                };
            }
        }

        const markers: MarkerOutline[] = [];
        if (this.dots.length > 0) {
            markers.push({
                type: "outline",
                points: this.dots.map(([xabs, yabs]) => {
                    const [x, y] = this.board.abs2rel(xabs, yabs)!;
                    return {row: y, col: x};
                }) as [RowCol, ...RowCol[]],
                colour: this.currplayer,
            });
        }

        // block unreachable nodes and occupied cells (cleaner looking)
        const blocked: RowCol[] = [];
        for (let row = 0; row < g.height; row++) {
            for (let col = 0; col < g.width; col++) {
                const node = g.coords2algebraic(col, row);
                if (!g.graph.hasNode(node) || g.graph.hasNodeAttribute(node, "contents")) {
                    blocked.push({row, col});
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width,
                height,
                rowLabels: rowLabels.map(l => l.replace("-", "\u2212")),
                columnLabels: columnLabels.map(l => l.replace("-", "\u2212")),
                markers: markers.length > 0 ? markers : undefined,
                blocked: blocked as [RowCol, ...RowCol[]],
                strokeColour: {
                    func: "flatten",
                    fg: "_context_strokes",
                    bg: "_context_background",
                    opacity: 0.15,
                },
            },
            legend,
            pieces,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fxAbs, fyAbs] = move.from.split(",").map(n => parseInt(n, 10));
                    const [txAbs, tyAbs] = move.to.split(",").map(n => parseInt(n, 10));
                    const [fxRel, fyRel] = this.board.abs2rel(fxAbs, fyAbs)!;
                    const [txRel, tyRel] = this.board.abs2rel(txAbs, tyAbs)!;
                    rep.annotations.push({type: "move", targets: [{row: fyRel, col: fxRel}, {row: tyRel, col: txRel}]});
                } else if (move.type === "place" || move.type === "promote") {
                    const [xAbs, yAbs] = move.where!.split(",").map(n => parseInt(n, 10));
                    const [xRel, yRel] = this.board.abs2rel(xAbs, yAbs)!;
                    rep.annotations.push({type: "enter", targets: [{row: yRel, col: xRel}]});
                }
            }
        }

        return rep;
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
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", {player, what: r.what, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "promote":
                node.push(i18next.t("apresults:PROMOTE.cubeo", {player, where: r.where, from: r.from, to: r.to}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        const statuses: IScores[] = [];
        if (this.diceInHand(1) > 0 || this.diceInHand(2) > 0) {
            statuses.push({ name: i18next.t("apgames:status.PIECESINHAND"), scores: [this.diceInHand(1), this.diceInHand(2)] });
        }
        return statuses;
    }

    public clone(): CubeoGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        return Object.assign(new CubeoGame(), deepclone(this) as CubeoGame);
    }
}
