import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { diagDirections, reviver, SquareDirectedGraph, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Tile = "W"|"B";
export type Piece = "AB"|"AW"|"BB"|"BW";

const cell2tile = new Map<string, Tile>([
    ["a5", "B"], ["b5", "W"], ["c5", "B"], ["d5", "W"], ["e5", "B"],
    ["a4", "W"], ["b4", "B"], ["c4", "W"], ["d4", "B"], ["e4", "W"],
    ["a3", "B"], ["b3", "W"], ["c3", "B"], ["d3", "W"], ["e3", "B"],
    ["a2", "W"], ["b2", "B"], ["c2", "W"], ["d2", "B"], ["e2", "W"],
    ["a1", "B"], ["b1", "W"], ["c1", "B"], ["d1", "W"], ["e1", "B"],
]);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
};

export interface IChameleonState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ChameleonGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Chameleon",
        uid: "chameleon",
        playercounts: [2],
        version: "20250130",
        dateAdded: "2025-01-31",
        // i18next.t("apgames:descriptions.chameleon")
        description: "apgames:descriptions.chameleon",
        urls: [
            "https://boardgamegeek.com/boardgame/273396/chameleon",
        ],
        people: [
            {
                type: "designer",
                name: "Mitsuo Yamamoto",
            },
            {
                type: "publisher",
                name: "Logy Games",
                urls: ["http://www.logygames.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>annihilate", "goal>breakthrough", "mechanic>asymmetry", "mechanic>capture", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "automove", "custom-rotation"],
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Piece>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private graph!: SquareDirectedGraph;
    private dots: string[] = [];

    constructor(state?: IChameleonState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Piece>([
                ["a5", "BW"], ["b5", "BB"], ["c5", "BW"], ["d5", "BB"], ["e5", "BW"],
                ["a1", "AW"], ["b1", "AB"], ["c1", "AW"], ["d1", "AB"], ["e1", "AW"],
            ]);
            const fresh: IMoveState = {
                _version: ChameleonGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IChameleonState;
            }
            if (state.game !== ChameleonGame.gameinfo.uid) {
                throw new Error(`The Chameleon engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ChameleonGame {
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
        this.graph = new SquareDirectedGraph(5, 5);
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves = new Set<string>();

        const mine = [...this.board.entries()].filter(([,pc]) => pc.startsWith(this.currplayer === 1 ? "A" : "B"));
        for (const [cell, pc] of mine) {
            // all pieces can move like kings
            for (const n of this.graph.graph.neighbors(cell)) {
                if (!this.board.has(n)) {
                    moves.add(`${cell}-${n}`);
                } else if (this.board.get(n)!.startsWith(this.currplayer === 1 ? "B" : "A")) {
                    moves.add(`${cell}x${n}`);
                }
            }
            // now look at nature
            const tile = cell2tile.get(cell)!;
            // matching nature
            if (pc.endsWith(tile)) {
                for (const dir of diagDirections) {
                    const ray = this.graph.ray(cell, dir);
                    for (const n of ray) {
                        if (!this.board.has(n)) {
                            moves.add(`${cell}-${n}`);
                        } else if (this.board.get(n)!.startsWith(this.currplayer === 1 ? "B" : "A")) {
                            moves.add(`${cell}x${n}`);
                            break;
                        } else {
                            break;
                        }
                    }
                }
            }
            // opposing nature
            else {
                const [x, y] = ChameleonGame.algebraic2coords(cell);
                for (const two of [2, -2]) {
                    for (const one of [1, -1]) {
                        const newx1 = x + two;
                        const newy1 = y + one;
                        const newx2 = x + one;
                        const newy2 = y + two;
                        for (const [newx, newy] of [[newx1, newy1], [newx2, newy2]]) {
                            if (newx >= 0 && newx < 5 && newy >= 0 && newy < 5) {
                                const newcell = this.graph.coords2algebraic(newx, newy);
                                if (!this.board.has(newcell)) {
                                    moves.add(`${cell}-${newcell}`);
                                } else if (this.board.get(newcell)!.startsWith(this.currplayer === 1 ? "B" : "A")) {
                                    moves.add(`${cell}x${newcell}`);
                                }
                            }
                        }
                    }
                }
            }
        }

        // if there's a piece on your home row, you must capture it if you can
        const onHome = [...this.board.entries()].filter(([,p]) => p.startsWith(this.currplayer === 1 ? "B" : "A")).map(([c,]) => ChameleonGame.algebraic2coords(c)).filter(([,y]) => y === (this.currplayer === 1 ? 4 : 0)).map(c => ChameleonGame.coords2algebraic(...c));
        if (onHome.length > 0) {
            for (const mv of moves) {
                if (!mv.endsWith(`x${onHome[0]}`)) {
                    moves.delete(mv);
                }
            }
        }

        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = ChameleonGame.coords2algebraic(col, row);
            let newmove: string;

            // empty move means starting a move
            if (move === "") {
                newmove = cell;
            } else {
                // clicking on a friendly piece resets
                if (this.board.has(cell) && this.board.get(cell)!.startsWith(this.currplayer === 1 ? "A" : "B")) {
                    newmove = cell;
                } else {
                    const [from,] = move.split(/[-x]/);
                    if (this.board.has(cell)) {
                        newmove = `${from}x${cell}`;
                    } else {
                        newmove = `${from}-${cell}`;
                    }
                }
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.chameleon.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.chameleon.PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): ChameleonGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];

        if (partial) {
            const matches = allMoves.filter(mv => mv.startsWith(m)).filter(mv => mv.length > 2);
            if (matches.length > 0) {
                this.dots = [...new Set<string>(matches.map(mv => mv.split(/[-x]/)[1])).values()];
            }
            return this;
        }

        const [from, to] = m.split(/[-x]/);
        const fcontents = this.board.get(from)!;
        const tcontents = this.board.get(to);
        this.board.delete(from);
        this.board.set(to, fcontents);
        this.results.push({type: "move", from, to});
        if (tcontents !== undefined) {
            this.results.push({type: "capture", where: to});
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

    protected checkEOG(): ChameleonGame {
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        let reason: string|undefined;

        // if current player has no moves, previous player wins
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prev];
            reason = "annihilation";
        }

        // if current player has a piece on opposing home row, they win
        if (!this.gameover) {
            const onHome = [...this.board.entries()].filter(([,pc]) => pc.startsWith(this.currplayer === 1 ? "A" : "B")).map(([c,]) => ChameleonGame.algebraic2coords(c)).filter(([,y]) => y === (this.currplayer === 1 ? 0 : 4));
            if (onHome.length > 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
                reason = "full infiltration";
            }
        }

        // if previous player moved their last piece onto opposing home row, they win
        if (!this.gameover) {
            const mine = [...this.board.values()].filter(pc => pc.startsWith(prev === 1 ? "A" : "B"));
            if (mine.length === 1) {
                const onHome = [...this.board.entries()].filter(([,pc]) => pc.startsWith(prev === 1 ? "A" : "B")).map(([c,]) => ChameleonGame.algebraic2coords(c)).filter(([,y]) => y === (prev === 1 ? 0 : 4));
                if (onHome.length > 0) {
                    this.gameover = true;
                    this.winner = [prev];
                    reason = "last-minute infiltration";
                }
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IChameleonState {
        return {
            game: ChameleonGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ChameleonGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 5; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 5; col++) {
                const cell = ChameleonGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // pstr = pstr.replace(/-{5}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 5,
                height: 5,
                markers: [
                    {
                        type: "edge",
                        edge: "N",
                        colour: 2,
                    },
                    {
                        type: "edge",
                        edge: "S",
                        colour: 1,
                    },
                ],
            },
            legend: {
                AB: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "piece-borderless",
                        colour: "#000",
                        scale: 0.33,
                    }
                ],
                AW: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "piece-borderless",
                        colour: "#fff",
                        scale: 0.33,
                    }
                ],
                BB: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "piece-borderless",
                        colour: "#000",
                        scale: 0.33,
                    }
                ],
                BW: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "piece-borderless",
                        colour: "#fff",
                        scale: 0.33,
                    }
                ],
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = ChameleonGame.algebraic2coords(move.from);
                    const [toX, toY] = ChameleonGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = ChameleonGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = ChameleonGame.algebraic2coords(cell);
                targets.push({col: x, row: y});
            }
            rep.annotations!.push({
                type: "dots",
                targets: targets as [RowCol, ...RowCol[]],
                colour: 3,
            });
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
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getCustomRotation(): number | undefined {
        return 180;
    }

    public clone(): ChameleonGame {
        return new ChameleonGame(this.serialize());
    }
}
