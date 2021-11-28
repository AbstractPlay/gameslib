import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, RectGrid, UserFacingError } from "../common";
import i18next from "i18next";
// import { RectGrid } from "../common";

interface ILooseObj {
    [key: string]: any;
}

interface ILocalStash {
    [k: string]: unknown;
    type: "localStash";
    label: string;
    stash: string[][];
}

interface IOrganizedCaps {
    triosMono: CellContents[][];
    partialsMono: CellContents[][];
    triosMixed: CellContents[][];
    partialsMixed: CellContents[][];
    miscellaneous: CellContents[];
}

export type playerid = 1|2;
export type Size = 1|2|3;
export type Colour = "RD"|"BU"|"GN"|"YE"|"VT"|"OG"|"BN"|"PK";
export type CellContents = [Colour, Size];
const colours: string[] = ["RD", "BU", "GN", "YE", "VT", "OG", "BN", "PK"];

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
const clone = (items: Array<any>): Array<any> => items.map((item: any) => Array.isArray(item) ? clone(item) : item);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: Array<Array<CellContents[]>>;
    caps: Set<string>;
    captured: [CellContents[], CellContents[]];
};

export interface IVolcanoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const hasContiguous = (inlst: string[], width = 5): boolean => {
    for (let i = 0; i < inlst.length; i++) {
        const iN = i - width;
        if ( (iN > 0) && (inlst[iN] === inlst[i]) ) {
            return true;
        }
        const iE = i + 1;
        if ( (iE < inlst.length) && (inlst[iE] === inlst[i]) ) {
            return true;
        }
        const iS = i + width;
        if ( (iS < inlst.length) && (inlst[iS] === inlst[i]) ) {
            return true;
        }
        const iW = i - 1;
        if ( (iW > 0) && (inlst[iW] === inlst[i]) ) {
            return true;
        }
    }
    return false;
}

export class VolcanoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Volcano",
        uid: "volcano",
        playercounts: [2],
        version: "20211104",
        // i18next.t("apgames:descriptions.volcano")
        description: "apgames:descriptions.volcano",
        urls: ["https://www.looneylabs.com/content/volcano"],
        people: [
            {
                type: "designer",
                name: "Kristin Looney",
                urls: ["http://www.wunderland.com/WTS/Kristin/Kristin.html"]
            }
        ],
        flags: ["shared-pieces", "stacking-expanding", "no-moves", "multistep"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Array<Array<CellContents[]>>;
    public caps!: Set<string>;
    public lastmove?: string;
    public erupted = false;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public captured: [CellContents[], CellContents[]] = [[], []];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public static newBoard(): Array<Array<CellContents[]>> {
        let order: string[] = shuffle([...colours, ...colours, ...colours]) as string[];
        order.push(order[12]);
        order[12] = "-";
        while (hasContiguous(order)) {
            order = shuffle([...colours, ...colours, ...colours]) as string[];
            order.push(order[12]);
            order[12] = "-";
        }
        order.splice(12, 1);
        const board: Array<Array<CellContents[]>> = [];
        for (let row = 0; row < 5; row++) {
            const node: Array<CellContents[]> = [];
            for (let col = 0; col < 5; col++) {
                if ( (row === 2) && (col === 2) ) {
                    node.push([]);
                } else {
                    const colour = order.pop() as Colour;
                    node.push([[colour, 1], [colour, 2], [colour, 3]]);
                }
            }
            board.push(node);
        }
        return board;
    }

    constructor(state?: IVolcanoState | string) {
        super();
        if (state === undefined) {
            this.board = VolcanoGame.newBoard();
            this.caps = new Set();
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    const cell = this.board[row][col];
                    if ( (cell !== undefined) && (cell.length > 0) && ( (cell[0][0] === "RD") || (cell[0][0] === "OG") ) ) {
                        this.caps.add(VolcanoGame.coords2algebraic(col, row));
                    }
                }
            }
            const fresh: IMoveState = {
                _version: VolcanoGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: this.board,
                caps: this.caps,
                captured: [[], []]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IVolcanoState;
            }
            if (state.game !== VolcanoGame.gameinfo.uid) {
                throw new Error(`The Volcano engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): VolcanoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = clone(state.board) as Array<Array<CellContents[]>>;
        this.lastmove = state.lastmove;
        this.captured = clone(state.captured) as [CellContents[], CellContents[]];
        this.caps = new Set(state.caps);
        return this;
    }

    // Giving up on move generation for now. It simply takes too long, even after
    // eliminating obvious circularity.

    /**
     * The `partial` flag leaves the object in an invalid state. It should only be used on a disposable object,
     * or you should call `load()` before finalizing the move.
     *
     * @param m The move string itself
     * @param partial A signal that you're just exploring the move; don't do end-of-move processing
     * @returns [VolcanoGame]
     */
     public move(m: string, partial = false): VolcanoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const grid = new RectGrid(5, 5);
        this.erupted = false;
        let powerPlay = false;
        this.results = [];
        for (const move of moves) {
            const [from, to] = move.split("-");
            const [toX, toY] = VolcanoGame.algebraic2coords(to);
            if ( (from === undefined) || (to === undefined) || (to.length !== 2) || (from.length < 2) || (from.length > 3) ) {
                throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID"));
            }
            // This is a regular cap move
            if (from.length === 2) {
                if (this.erupted) {
                    throw new UserFacingError("MOVES_AFTER_EUPTION", i18next.t("apgames:volcano.MOVES_AFTER_ERUPTION"));
                }
                const [fromX, fromY] = VolcanoGame.algebraic2coords(from);
                if (! this.caps.has(from)) {
                    throw new UserFacingError("MOVES_CAPS_ONLY", i18next.t("apgames:volcano.MOVES_CAPS_ONLY"));
                }
                if (this.caps.has(to)) {
                    throw new UserFacingError("MOVES_DOUBLE_CAP", i18next.t("apgames:volcano.MOVES_DOUBLE_CAP"));
                }
                if ( (Math.abs(fromX - toX) > 1) || (Math.abs(fromY - toY) > 1) ) {
                    throw new UserFacingError("MOVES_TOO_FAR", i18next.t("apgames:volcano.MOVES_TOO_FAR"));
                }
                this.results.push({type: "move", from, to});
                // detect eruption
                const dir = RectGrid.bearing(fromX, fromY, toX, toY);
                if (dir === undefined) {
                    throw new UserFacingError("MOVES_ONE_SPACE", i18next.t("apgames:volcano.MOVES_ONE_SPACE"));
                }
                const ray = grid.ray(toX, toY, dir);
                if ( (ray.length > 0) && (! this.caps.has(VolcanoGame.coords2algebraic(...ray[0]))) && (this.board[fromY][fromX].length > 0) ) {
                    // Eruption triggered
                    for (const r of ray ) {
                        const cell = VolcanoGame.coords2algebraic(...r);
                        if (this.caps.has(cell)) {
                            break;
                        }
                        const piece = this.board[fromY][fromX].pop();
                        if (piece === undefined) {
                            break;
                        }
                        // check for capture
                        const boardTo = this.board[r[1]][r[0]];
                        this.results.push({type: "eject", from, to: cell, what: piece.join("")});
                        // captured
                        if ( (boardTo.length > 0) && (boardTo[boardTo.length - 1][1] === piece[1]) ) {
                            this.captured[this.currplayer - 1].push(piece);
                            this.results.push({type: "capture", what: piece.join(""), where: cell});
                        // otherwise just move the piece
                        } else {
                            boardTo.push(piece);
                        }
                    }
                    this.erupted = true;
                }
                this.caps.delete(from);
                this.caps.add(to);
            // This is a power play
            } else {
                if (powerPlay) {
                    throw new UserFacingError("MOVES_ONE_POWERPLAY", i18next.t("apgames:volcano.MOVES_ONE_POWERPLAY"));
                }
                const colour = (from[0] + from[1]).toUpperCase();
                const size = parseInt(from[2], 10);
                const idx = (this.captured[this.currplayer - 1]).findIndex(p => p[0] === colour && p[1] === size);
                if (idx < 0) {
                    throw new UserFacingError("MOVES_NOPIECE", i18next.t("apgames:volcano.MOVES_NOPIECE", {piece: `${colour}${size}`}));
                }
                this.captured[this.currplayer - 1].splice(idx, 1);
                if (this.caps.has(to)) {
                    throw new UserFacingError("MOVES_DOUBLE_CAP", i18next.t("apgames:volcano.MOVES_DOUBLE_CAP"));
                }
                this.board[toY][toX].push([colour as Colour, size as Size]);
                this.results.push({type: "place", what: from, where: to});
                powerPlay = true;
            }
        }

        if (partial) {
            return this;
        }

        if (! this.erupted) {
            throw new UserFacingError("MOVES_MUST_ERUPT", i18next.t("apgames:volcano.MOVES_MUST_ERUPT"));
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

    protected checkEOG(): VolcanoGame {
        let prevplayer = this.currplayer - 1;
        if (prevplayer < 1) {
            prevplayer = this.numplayers;
        }
        const org = this.organizeCaps(prevplayer as playerid);
        if ( (org.triosMono.length === 3) || (org.triosMono.length + org.triosMixed.length === 5) ) {
            this.gameover = true;
            this.winner = [prevplayer as playerid];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public organizeCaps(player: playerid = 1): IOrganizedCaps {
        const org: IOrganizedCaps = {
            triosMono: [],
            partialsMono: [],
            triosMixed: [],
            partialsMixed: [],
            miscellaneous: []
        };

        const pile = [...this.captured[player - 1]];
        const stacks: CellContents[][] = [];

        const lgs = pile.filter(x => x[1] === 3);
        const mds = pile.filter(x => x[1] === 2);
        const sms = pile.filter(x => x[1] === 1);
        // Put each large in a stack and then look for a matching medium and small
        // This will find all monochrome trios
        while (lgs.length > 0) {
            const stack: CellContents[] = [];
            const next = lgs.pop();
            stack.push(next!);
            const mdIdx = mds.findIndex(x => x[0] === next![0]);
            if (mdIdx >= 0) {
                stack.push(mds[mdIdx]);
                mds.splice(mdIdx, 1);
                const smIdx = sms.findIndex(x => x[0] === next![0]);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
            stacks.push(stack);
        }
        // Look at each stack that has only a large and find any leftover mediums and stack them
        for (const stack of stacks) {
            if (stack.length === 1) {
                const mdIdx = mds.findIndex(x => x[1] === 2);
                if (mdIdx >= 0) {
                    stack.push(mds[mdIdx]);
                    mds.splice(mdIdx, 1);
                }
            }
        }
        // Look at each stack that has a large and a medium and add any loose smalls
        for (const stack of stacks) {
            if (stack.length === 2) {
                const smIdx = sms.findIndex(x => x[1] === 1);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
        }
        // All remaning mediums now form the basis of their own stack and see if there is a matching small
        while (mds.length > 0) {
            const stack: CellContents[] = [];
            const next = mds.pop();
            stack.push(next!);
            const smIdx = sms.findIndex(x => x[0] === next![0]);
            if (smIdx >= 0) {
                stack.push(sms[smIdx]);
                sms.splice(smIdx, 1);
            }
            stacks.push(stack);
        }
        // Find stacks with just a medium and put any loose smalls on top of them
        for (const stack of stacks) {
            if ( (stack.length === 1) && (stack[0][1] === 2) ) {
                const smIdx = sms.findIndex(x => x[1] === 1);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
        }
        // Now all you should have are loose smalls, add those
        stacks.push(...sms.map(x => [x]));

        // Validate that all the pieces in the original pile are now found in the stack structure
        const pieces: CellContents[] = stacks.reduce((accumulator, value) => accumulator.concat(value), []);
        if (pieces.length !== this.captured[player - 1].length) {
            throw new Error("Stack lengths don't match.");
        }

        // Categorize each stack
        for (const stack of stacks) {
            if (stack.length === 3) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.triosMono.push(stack);
                } else {
                    org.triosMixed.push(stack);
                }
            } else if (stack.length === 2) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.partialsMono.push(stack);
                } else {
                    org.partialsMixed.push(stack);
                }
            } else {
                org.miscellaneous.push(...stack);
            }
        }

        return org;
    }

    public resign(player: playerid): VolcanoGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results.push(
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        );
        this.saveState();
        return this;
    }

    public state(): IVolcanoState {
        return {
            game: VolcanoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: VolcanoGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: clone(this.board) as Array<Array<CellContents[]>>,
            caps: new Set(this.caps),
            captured: clone(this.captured) as [CellContents[], CellContents[]]
        };
    }

    public render(expandCol?: number, expandRow?: number): APRenderRep {
        // Build piece object
        const pieces: string[][][] = [];
        for (let row = 0; row < 5; row++) {
            const rownode: string[][] = [];
            for (let col = 0; col < 5; col++) {
                let cellnode: string[] = [];
                if (this.board[row][col] !== undefined) {
                    cellnode = [...this.board[row][col]!.map(c => c.join(""))];
                    const cell = VolcanoGame.coords2algebraic(col, row);
                    if (this.caps.has(cell)) {
                        cellnode.push("X");
                    }
                }
                rownode.push(cellnode);
            }
            pieces.push(rownode);
        }

        // build legend based on number of players
        const myLegend: ILooseObj = {
            "X": {
                "name": "pyramid-up-small",
                "colour": "#000"
            },
            "XN": {
                "name": "pyramid-flat-small",
                "colour": "#000"
            },
        };

        const opacity = 0.75;
        for (let n = 0; n < colours.length; n++) {
            myLegend[colours[n] + "1"] = {
                name: "pyramid-up-small-upscaled",
                player: n+1,
                opacity
            };
            myLegend[colours[n] + "2"] = {
                name: "pyramid-up-medium-upscaled",
                player: n+1,
                opacity
            };
            myLegend[colours[n] + "3"] = {
                name: "pyramid-up-large-upscaled",
                player: n+1,
                opacity
            };
            myLegend[colours[n] + "1N"] = {
                name: "pyramid-flat-small",
                player: n+1
            };
            myLegend[colours[n] + "2N"] = {
                name: "pyramid-flat-medium",
                player: n+1
            };
            myLegend[colours[n] + "3N"] = {
                name: "pyramid-flat-large",
                player: n+1
            };
            myLegend[colours[n] + "1c"] = {
                name: "pyramid-flattened-small",
                player: n+1
            };
            myLegend[colours[n] + "2c"] = {
                name: "pyramid-flattened-medium",
                player: n+1
            };
            myLegend[colours[n] + "3c"] = {
                name: "pyramid-flattened-large",
                player: n+1
            };
        }

        const list: object[] = []
        for (const colour of [...colours].sort((a, b) => a.localeCompare(b))) {
            list.push({piece: colour + "3", name: colour})
        }
        const key = {placement: "right", textPosition: "outside", list};


        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-expanding",
            board: {
                style: "squares",
                width: 5,
                height: 5
            },
            legend: myLegend,
            // @ts-ignore
            key,
            // @ts-ignore
            pieces
        };

        const areas = [];
        if ( (expandCol !== undefined) && (expandRow !== undefined) && (expandCol >= 0) && (expandRow >= 0) && (expandCol < 5) && (expandRow < 5) && (this.board[expandRow][expandCol] !== undefined) ) {
            const cell: string[] = this.board[expandRow][expandCol]!.map(c => `${c.join("")}N`);
            const cellname = VolcanoGame.coords2algebraic(expandCol, expandRow);
            if (this.caps.has(cellname)) {
                cell.push("XN")
            }
            if (cell !== undefined) {
                areas.push({
                    type: "expandedColumn",
                    cell: VolcanoGame.coords2algebraic(expandCol, expandRow),
                    stack: cell
                });
            }
        }

        // Add captured stashes
        for (let player = 0; player < 2; player++) {
            if (this.captured[player].length > 0) {
                const node: ILocalStash = {
                    type: "localStash",
                    label: `Player ${player + 1}: Captured Pieces`,
                    stash: []
                };
                const org = this.organizeCaps((player + 1) as playerid);
                node.stash.push(...org.triosMono.map((s) => [...s.map((t) => t.join("") + "c")]));
                node.stash.push(...org.triosMixed.map((s) => [...s.map((t) => t.join("") + "c")]));
                node.stash.push(...org.partialsMono.map((s) => [...s.map((t) => t.join("") + "c")]));
                node.stash.push(...org.partialsMixed.map((s) => [...s.map((t) => t.join("") + "c")]));
                node.stash.push(...org.miscellaneous.map((s) => [s.join("") + "c"]));
                areas.push(node);
            }
        }
        if (areas.length > 0) {
            // @ts-ignore
            rep.areas = areas;
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = VolcanoGame.algebraic2coords(move.from);
                    const [toX, toY] = VolcanoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "eject") {
                    const [fromX, fromY] = VolcanoGame.algebraic2coords(move.from);
                    const [toX, toY] = VolcanoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = VolcanoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public status(): string {
        const status = super.status();

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move"]);
    }

    public chatLog(players: string[]): string[][] {
        // move, eject, capture, eog, resign, winners
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                const moves = state._results.filter(r => r.type === "move" || r.type === "place");
                node.push(i18next.t("apresults:MOVE.multiple", {player: name, moves: moves.map(m => {
                    if (m.type === "move") {
                        return `${m.from}-${m.to}`;
                    } else if (m.type === "place") {
                        return `${m.what!}-${m.where!}`;
                    } else {
                        throw new Error("Should never happen.");
                    }
                }).join(", ")}));
                const eruptions = state._results.filter(r => r.type === "eject");
                // @ts-ignore
                node.push(i18next.t("apresults:ERUPTIONS", {eruptions: eruptions.map(m => m.what as string).join(", ")}));
                const captures = state._results.filter(r => r.type === "capture");
                if (captures.length > 0) {
                    // @ts-ignore
                    node.push(i18next.t("apresults:CAPTURE.noperson.multiple", {capped: captures.map(m => m.what as string).join(", ")}));
                }
                for (const r of state._results) {
                    switch (r.type) {
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

    public clone(): VolcanoGame {
        return new VolcanoGame(this.serialize());
    }
}
