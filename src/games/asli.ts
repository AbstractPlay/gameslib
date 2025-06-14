import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, shuffle, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
import { Glyph } from "@abstractplay/renderer";

export type playerid = 1|2;
type Territory = {
    cells: string[];
    owner: playerid|undefined;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    prison: [number,number];
    maxGroups: [number,number];
    incursion: boolean;
};

export interface IAsliState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AsliGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Asli",
        uid: "asli",
        playercounts: [2],
        version: "20240610",
        dateAdded: "2024-06-12",
        // i18next.t("apgames:descriptions.asli")
        description: "apgames:descriptions.asli",
        urls: ["https://boardgamegeek.com/boardgame/393166/asli"],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"],
                apid: "6b518a3f-7f63-47b8-b92b-a04792fba8e7",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {uid: "board-9", group: "board"},
            {uid: "board-11", group: "board"},
            { uid: "#board", },
            {uid: "board-15", group: "board"},
            {uid: "board-17", group: "board"},
            {uid: "board-19", group: "board"},
            {uid: "board-27", group: "board"},
            {uid: "woven", group: "rules"},
            {uid: "setkomi", group: "komi"},
        ],
        categories: ["goal>immobilize", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie-even", "custom-buttons", "no-moves", "custom-randomization", "scores"]
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardsize = 13;
    public prison: [number,number] = [0,0];
    public maxGroups: [number,number] = [0,0];
    public incursion = false;

    constructor(state?: IAsliState | string, variants?: string[]) {
        super();
        if (variants !== undefined) {
            this.variants = [...variants];
        }
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: AsliGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                prison: this.variants.includes("setkomi") ? [7,0] : [0,0],
                maxGroups: [0,0],
                incursion: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAsliState;
            }
            if (state.game !== AsliGame.gameinfo.uid) {
                throw new Error(`The Asli engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AsliGame {
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
        this.boardsize = 13;
        for (const variant of this.variants) {
            if (variant.startsWith("board-")) {
                const [,num] = variant.split("-");
                const n = parseInt(num, 10);
                if (!isNaN(n)) {
                    this.boardsize = n;
                    break;
                }
            }
        }
        this.prison = [...state.prison];
        this.maxGroups = [...state.maxGroups];
        this.incursion = state.incursion;
        return this;
    }

    public getGraph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardsize, this.boardsize);
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }
    //     if (this.stack.length === 1) {
    //         return [];
    //     } else if (this.stack.length === 2) {
    //         return ["pie"];
    //     }

    //     const thisPlayer = this.currplayer;
    //     let otherPlayer:playerid = 1;
    //     if (thisPlayer === 1) {
    //         otherPlayer = 2;
    //     }
    //     const moves: string[] = [];

    //     // you can pass if there are enemy pieces in the prison
    //     if (this.prison[otherPlayer - 1] > 0) {
    //         moves.push("pass");
    //     }

    //     const gBase = this.getGraph();
    //     const empties = (gBase.listCells(false) as string[]).filter(cell => ! this.board.has(cell));
    //     for (const cell of empties) {
    //         const result = this.validateMove(cell);
    //         if (result.valid && result.complete === 1) {
    //             moves.push(cell);
    //         }
    //     }

    //     return moves;
    // }

    // In this game only one button is active at a time.
    public getButtons(): ICustomButton[] {
        if (this.stack.length === 2 && !this.variants.includes("setkomi")) return [{ label: "acceptpie", move: "pie" }];
        if (this.stack.length > 2 || this.variants.includes("setkomi")) {
            const otherPlayer = this.currplayer === 1 ? 2 : 1;
            let canpass = false;
            if (this.prison[otherPlayer - 1] > 0) {
                canpass = true;
            }
            if (canpass) {
                return [{ label: "pass", move: "pass" }];
            }
        }
        return [];
    }

    public randomMove(): string {
        if (this.stack.length === 1 && !this.variants.includes("setkomi")) {
            return randomInt(10).toString();
        } else if (this.stack.length === 2 && !this.variants.includes("setkomi")) {
            return "pie";
        } else {
            const otherPlayer = this.currplayer === 1 ? 2 : 1;
            let canpass = false;
            if (this.prison[otherPlayer - 1] > 0) {
                canpass = true;
            }
            if (canpass && Math.random() < 0.1) {
                return "pass";
            }
            const gBase = this.getGraph();
            const empties = shuffle((gBase.listCells(false) as string[]).filter(cell => ! this.board.has(cell))) as string[];
            for (const cell of empties) {
                const result = this.validateMove(cell);
                if (result.valid && result.complete === 1) {
                    return cell
                }
            }
            if (canpass) {
                return "pass";
            }
            return "";
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string;
            if (row === -1 && col === -1) {
                newmove = "pass";
            } else {
                const cell = this.coords2algebraic(col, row);
                newmove = cell;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.asli.INITIAL_INSTRUCTIONS", {context: (this.stack.length === 1 && !this.variants.includes("setkomi")) ? "komi" : (this.stack.length === 2 && !this.variants.includes("setkomi")) ? "pie" : "play"});
            return result;
        }

        if (this.stack.length === 1 && !this.variants.includes("setkomi")) {
            if (! /^-?\d+$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.BAD_KOMI", {cell: m});
                return result
            }
            const max = (this.boardsize**2) + 1;
            const min = max * -1;
            const n = parseInt(m, 10);
            if (isNaN(n) || n > max || n < min) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.BAD_KOMI", {cell: m});
                return result
            }

            // Looks good
            result.valid = true;
            result.complete = 0;
            if (n < 0) {
                result.message = i18next.t("apgames:validation.asli.NEGATIVE_KOMI");
            } else {
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
            return result;
        } else if (!this.variants.includes("setkomi") && (m === "pie" || (m === "pass" && this.stack.length === 2))) {
            if (this.stack.length !== 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.BAD_PIE");
                return result;
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else if (m === "pass") {
            const enemy = this.currplayer === 1 ? 2 : 1;
            if (this.prison[enemy - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.BAD_PASS");
                return result;
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            // no moves allowed at this point of the game
            if (this.stack.length === 2 && !this.variants.includes("setkomi")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.MUST_PIE");
                return result;
            }
            const g = this.getGraph();
            // valid cell
            if (! g.graph.hasNode(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result
            }
            // is empty
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result
            }
            // check if incursion (for later validation check)
            let incursion = false;
            const terr = this.getTerritories().find(t => t.cells.includes(m))!;
            if (terr.owner === (this.currplayer === 1 ? 2 : 1)) {
                incursion = true;
            }

            // if woven rules, incursions are not allowed
            if (this.variants.includes("woven") && incursion && this.stack.length > 4) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.WOVEN_INCURSION");
                return result
            }

            // no dead friendlies (after removing dead enemies)
            // place the piece
            const cloned = new Map(this.board);
            cloned.set(m, this.currplayer);
            // remove dead enemy pieces
            const {dead, numGroups} = this.findDead(this.currplayer === 1 ? 2 : 1, cloned);
            dead.forEach(cell => cloned.delete(cell));
            // now look for dead friendlies
            if (this.findDead(this.currplayer, cloned).dead.length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.SUICIDE");
                return result
            }

            // check for back-to-back minimal incursions
            if (incursion && numGroups === 1 && this.incursion) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.asli.BAD_INCURSION");
                return result
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public findDead(p: playerid, board?: Map<string,playerid>): {dead: string[], numGroups: number} {
        if (board === undefined) {
            board = new Map(this.board);
        }
        const dead: string[] = [];
        let num = 0;

        // get list of pieces owned by each player
        const pcsOwned = [...board.entries()].filter(([,owner]) => owner === p).map(pair => pair[0]);
        const pcsUnowned = [...board.entries()].filter(([,owner]) => owner !== p).map(pair => pair[0]);

        // get groups of owned pieces (just owned pieces, no empty spaces)
        const gOwned = this.getGraph();
        for (const node of gOwned.graph.nodes()) {
            if (! pcsOwned.includes(node)) {
                gOwned.graph.dropNode(node);
            }
        }
        const groupsOwned = connectedComponents(gOwned.graph);

        // if there's only one group, and that's all there has ever been
        // then this single group is, by definition, alive
        if (groupsOwned.length === 1 && this.maxGroups[p - 1] <= 1) {
            return {dead: [], numGroups: 0};
        }

        // check LoS
        // first generate a new graph with owned pcs and empties
        const gLos = this.getGraph();
        for (const node of gLos.graph.nodes()) {
            if (pcsUnowned.includes(node)) {
                gLos.graph.dropNode(node);
            }
        }
        // now test that there's a path from the first cell of each group
        // to the first cell in at least one other group
        for (let i = 0; i < groupsOwned.length; i++) {
            const comp = groupsOwned[i];
            const others = [...groupsOwned.slice(0,i), ...groupsOwned.slice(i+1)];
            let hasLos = false;
            for (const test of others) {
                const path = gLos.path(comp[0], test[0]);
                if (path !== null) {
                    hasLos = true;
                    break;
                }
            }
            if (! hasLos) {
                num++;
                dead.push(...comp);
            }
        }

        return {dead, numGroups: num};
    }

    public reducePrison(): void {
        const min = Math.min(...this.prison);
        this.prison = this.prison.map(n => n - min) as [number,number];
    }

    public updateGroupCounts(): void {
        for (const p of [1,2] as const) {
            const owned = [...this.board.entries()].filter(([,owner]) => owner === p).map(pair => pair[0]);
            const gOwned = this.getGraph();
            for (const node of gOwned.graph.nodes()) {
                if (! owned.includes(node)) {
                    gOwned.graph.dropNode(node);
                }
            }
            const groups = connectedComponents(gOwned.graph);
            this.maxGroups[p - 1] = Math.max(this.maxGroups[p - 1], groups.length);
        }
    }

    public getTerritories(): Territory[] {
        const territories: Territory[] = [];

        const gEmpties = this.getGraph();
        for (const pc of this.board.keys()) {
            gEmpties.graph.dropNode(pc);
        }
        const groups = connectedComponents(gEmpties.graph);

        const gBase = this.getGraph();
        for (const group of groups) {
            let contested = false;
            const surr = new Set<playerid>();
            for (const cell of group) {
                for (const n of gBase.neighbours(cell)) {
                    if (this.board.has(n)) {
                        surr.add(this.board.get(n)!);
                        if (surr.size > 1) {
                            contested = true;
                            break;
                        }
                    }
                }
                if (contested) {
                    break;
                }
            }
            let owner: playerid|undefined;
            if (!contested) {
                owner = [...surr][0];
            }
            territories.push({cells: group, owner});
        }

        return territories;
    }

    public move(m: string, {trusted = false} = {}): AsliGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        const enemy = this.currplayer === 1 ? 2 : 1;
        if (this.stack.length === 1 && !this.variants.includes("setkomi")) {
            const n = parseInt(m, 10);
            this.prison[0] = n;
            this.results.push({type: "komi", value: n});
        } else if (!this.variants.includes("setkomi") && (m === "pie" || (m === "pass" && this.stack.length === 2))) {
            m = "pie";
            this.results.push({type: "pie"});
        } else if (m === "pass") {
            if (this.stack.length > 2 || this.variants.includes("setkomi")) {
                this.prison[enemy - 1] -= 1;
                this.results.push({type: "pass"});
                this.incursion = false;
            }
        } else {
            // need to check for incursion before modifying state
            let incursion = false;
            const terr = this.getTerritories().find(t => t.cells.includes(m))!;
            if (terr.owner === (this.currplayer === 1 ? 2 : 1)) {
                incursion = true;
            }
            // modify state
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
            const {dead, numGroups} = this.findDead(enemy);
            if (numGroups > 0) {
                this.prison[enemy - 1] += dead.length;
                dead.forEach(cell => this.board.delete(cell));
                this.results.push({type: "capture", where: dead.join(",")});
            }
            // set incursion flag
            if (incursion && numGroups === 1) {
                this.incursion = true;
            } else {
                this.incursion = false;
            }
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        // do other cleanup
        this.reducePrison();
        this.updateGroupCounts();

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): AsliGame {
        // game can't end before third ply
        if (this.stack.length > 3) {
            let stateCount = 0;
            if (this.stack[this.stack.length - 2].lastmove !== "pass") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                stateCount = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));
            }

            if (stateCount > 0) {
                this.gameover = true;
                this.winner = [1,2];
            } else  {
                // since we don't want to generate a full move list, check instead
                // to see if randomMove() returns a move. If not, then no moves are possible.
                // This keeps things fast for the most part, but will take a couple seconds
                // as the game gets closer to completion. But to speed this up further,
                // if the player can pass, then it doesn't even bother going further.
                const otherPlayer = this.currplayer === 1 ? 2 : 1;
                let canpass = false;
                if (this.prison[otherPlayer - 1] > 0) {
                    canpass = true;
                }
                if (!canpass && this.randomMove() === "") {
                    const other = this.currplayer === 1 ? 2 : 1;
                    this.gameover = true;
                    this.winner = [other];
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

    public state(): IAsliState {
        return {
            game: AsliGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AsliGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            prison: [...this.prison],
            maxGroups: [...this.maxGroups],
            incursion: this.incursion,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        // pstr = pstr.replace(/-{4}/g, "_");

        const hasPrison = this.prison.reduce((prev, curr) => prev + curr, 0) > 0;
        const prisonPiece: Glyph[] = [];
        if (hasPrison) {
            prisonPiece.push({
                name: "piece",
                colour: this.prison[0] > 0 ? 1 : 2,
                scale: 0.85,
            });
            prisonPiece.push({
                text: this.prison[0] > 0 ? this.prison[0].toString() : this.prison[1].toString(),
                colour: "_context_strokes",
                scale: 0.75,
                rotate: null,
            });
        } else {
            prisonPiece.push({
                name: "piece-borderless",
                colour: "_context_background",
                scale: 0.85,
            });
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardsize,
                height: this.boardsize,
            } as BoardBasic,
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
                P: prisonPiece as [Glyph, ...Glyph[]]
            },
            pieces: pstr,
            areas: [
                {
                    type: "key",
                    height: 1,
                    list: [
                        {
                            name: "",
                            piece: "P",
                        }
                    ],
                }
            ],
        };

        // add territory dots
        if (this.maxGroups[0] > 0 && this.maxGroups[1] > 0) {
            const territories = this.getTerritories();
            let markers: Array<MarkerDots> | undefined = []
            for (const t of territories) {
                if (t.owner !== undefined) {
                    const points = t.cells.map(c => this.algebraic2coords(c));
                    markers.push({type: "dots", colour: t.owner, points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
                }
            }
            if (markers.length === 0) {
                markers = undefined;
            }
            if (markers !== undefined) {
                (rep.board as BoardBasic).markers = markers;
            }
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const cells = move.where!.split(",");
                    for (const cell of cells) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
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
        status += "**Prison**: " + this.prison.join(", ") + "\n\n";
        status += "**Max groups**: " + this.maxGroups.join(", ") + "\n\n";
        status += "**Incursion?**: " + JSON.stringify(this.incursion) + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.asli", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        let scores: number[] = [this.prison[1], this.prison[0]];
        if (this.maxGroups[0] > 0 && this.maxGroups[1] > 0) {
            const terr = this.getTerritories();
            scores = [
                terr.filter(t => t.owner === 1).reduce((prev, curr) => prev + curr.cells.length, 0) + this.prison[1],
                terr.filter(t => t.owner === 2).reduce((prev, curr) => prev + curr.cells.length, 0) + this.prison[0],
            ];
        }
        return [{ name: i18next.t("apgames:status.asli.TERRITORY"), scores, spoiler: true}];
    }

    public clone(): AsliGame {
        return new AsliGame(this.serialize());
    }
}
