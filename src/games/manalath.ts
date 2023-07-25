/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IManalathState extends IAPGameState {
    winner: playerid[];
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

export class ManalathGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Manalath",
        uid: "manalath",
        playercounts: [2],
        version: "20211118",
        // i18next.t("apgames:descriptions.manalath")
        description: "apgames:descriptions.manalath",
        urls: ["https://spielstein.com/games/manalath/rules"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "designer",
                name: "Néstor Romeral Andrés",
                urls: ["http://nestorgames.com/"]
            }
        ],
        flags: ["automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(5, 9);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IManalathState | string) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: ManalathGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IManalathState;
            }
            if (state.game !== ManalathGame.gameinfo.uid) {
                throw new Error(`The Manalath engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ManalathGame {
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
        this.results = [...state._results];
        this.buildGraph();
        return this;
    }

    private buildGraph(): ManalathGame {
        this.graph = new HexTriGraph(5, 9);
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const empties = (this.graph.listCells() as string[]).filter(c => ! this.board.has(c));
        for (const cell of empties) {
            for (const colour of ["w", "b"]) {
                moves.push(`${cell}${colour}`);
            }
        }
        const valid = moves.filter(m => {
            const g: ManalathGame = Object.assign(new ManalathGame(), deepclone(this) as ManalathGame);
            g.buildGraph();
            const cell = m.slice(0, m.length - 1);
            let owner: playerid = 1;
            if (m[m.length - 1] === "b") {
                owner = 2;
            }
            g.board.set(cell, owner);
            const groups1 = g.getGroups(1);
            const groups2 = g.getGroups(2);
            return ( (groups1.filter(grp => grp.size > 5).length === 0) && (groups2.filter(grp => grp.size > 5)) );
        });

        if (valid.length === 0) {
            return ["pass"];
        } else {
            return [...valid];
        }
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (row === -1 && col === -1) {
                if (move.length === 2) {
                    newmove = `${move}${piece}`;
                } else if (move.length === 3) {
                    newmove = `${move.slice(0, move.length - 1)}${piece}`;
                } else {
                    newmove = piece!;
                }
            } else {
                const cell = this.graph.coords2algebraic(col, row);
                // If you click on an occupied cell, clear the entry
                if (this.board.has(cell)) {
                    return {move: "", message: ""} as IClickResult;
                }
                if (move.length > 0) {
                    if (move.length === 1) {
                        newmove = cell + move;
                    } else {
                        const prev = move.slice(0, move.length - 1);
                        const colour = move[move.length - 1];
                        if (prev === cell) {
                            if (colour === "w") {
                                newmove = `${cell}b`;
                            } else {
                                newmove = `${cell}w`;
                            }
                        } else {
                            newmove = `${cell}w`;
                        }
                    }
                } else {
                    newmove = `${cell}w`;
                }
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.manalath.INITIAL_INSTRUCTIONS");
            return result;
        }

        // pass first
        if (m === "pass") {
            const moves = this.moves();
            if ( (moves.length === 1) && (moves[0] === "pass") ) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.manalath.BAD_PASS");
                return result;
            }
        }

        if (m.length === 1) {
            if (m === 'w' || m === 'b') {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.manalath.DESTINATION");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.manalath.INVALID_COLOUR", {colour: m[m.length - 1]});
                return result;
            }
        }

        const cell = m.slice(0, m.length - 1);
        let colour: playerid;
        if (m[m.length - 1] === "w") {
            colour = 1;
        } else if (m[m.length - 1] === "b") {
            colour = 2;
        } else {
            result.valid = false;
            result.message = i18next.t("apgames:validation.manalath.INVALID_COLOUR", {colour: m[m.length - 1]});
            return result;
        }

        // valid cell
        try {
            this.graph.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }
        // cell is empty
        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }
        // doesn't create oversized group
        const g: ManalathGame = Object.assign(new ManalathGame(), deepclone(this) as ManalathGame);
        g.buildGraph();
        g.board.set(cell, colour);
        const groups = g.getGroups(colour);
        for (const group of groups) {
            if (group.size > 5) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.manalath.OVERSIZED_GROUP");
                return result;
            }
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, partial = false): ManalathGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const cell = m.slice(0, 2);
            const piece = m[2];
            let player: playerid = 1;
            if (piece === "b") {
                player = 2;
            }
            this.board.set(cell, player);
            if (player === this.currplayer) {
                this.results.push({type: "place", what: "mine", where: cell});
            } else {
                this.results.push({type: "place", what: "theirs", where: cell});
            }
        }

        if (partial) { return this; }

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

    protected checkEOG(): ManalathGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // If this move was a pass, and the previous move was a pass, we have a draw
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            this.gameover = true;
            this.winner = [1, 2];
        } else {
            // Get a list of all groups belonging to the previous player
            const groups = this.getGroups(prevPlayer);
            // Extract the one that includes the most recent move (if such a group exists)
            const lastcell = this.lastmove!.slice(0, 2);
            const current = groups.find(g => g.has(lastcell));
            // Then isolate all the others
            const others = groups.filter(g => ! g.has(lastcell));
            // If any of the `others` groups have a quart or quint, that trumps anything the player just built (there will never be both)
            if (others.filter(g => g.size === 4).length > 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            } else if (others.filter(g => g.size === 5).length > 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
            }
            // Otherwise, see if they made a winning/losing move just now
            if ( (! this.gameover) && (current !== undefined) ) {
                if (current.size === 4) {
                    this.gameover = true;
                    this.winner = [this.currplayer];
                } else if (current.size === 5) {
                    this.gameover = true;
                    this.winner = [prevPlayer];
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

    private getGroups(player: playerid): Set<string>[] {
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    public state(): IManalathState {
        return {
            game: ManalathGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ManalathGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: 5,
                maxWidth: 9,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add key so the user can click to select the color to place
        const key: IKey = {
            type: "key",
            position: "left",
            height: 0.7,
            list: [{ piece: "A", name: "", value: "w"}, { piece: "B", name: "", value: "b"}],
            clickable: true
        };
        rep.areas = [key];

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
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
                if (r.what === "mine") {
                    node.push(i18next.t("apresults:PLACE.mine", {player, where: r.where}));
                } else {
                    node.push(i18next.t("apresults:PLACE.theirs", {player, where: r.where}));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ManalathGame {
        return new ManalathGame(this.serialize());
    }
}
