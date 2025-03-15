/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface ISurmountState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SurmountGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Surmount",
        uid: "surmount",
        playercounts: [2],
        version: "20250313",
        dateAdded: "2024-05-13",
        // i18next.t("apgames:descriptions.surmount")
        description: "apgames:descriptions.surmount",
        urls: ["https://boardgamegeek.com/boardgame/436268/surmount"],
        people: [
            {
                type: "designer",
                name: "Corey Clark",
                urls: ["https://boardgamegeek.com/boardgamedesigner/38921/corey-clark"],
            }
        ],
        variants: [
            { uid: "hex-4", group: "board" },
            { uid: "#board"},
            { uid: "hex-6", group: "board" },
            { uid: "hex-7", group: "board" },
        ],
        categories: ["goal>annihilate", "mechanic>place", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "no-moves", "custom-buttons", "custom-randomization"],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }
    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private dots: string[] = [];

    constructor(state?: ISurmountState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SurmountGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISurmountState;
            }
            if (state.game !== SurmountGame.gameinfo.uid) {
                throw new Error(`The Surmount game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SurmountGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map([...state.board.entries()]);
        this.lastmove = state.lastmove;
        return this;
    }

    protected get boardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("hex") || v.includes("square"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 5;
    }

    private get graph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    }

    // Returns a list of valid captures one could make INSTEAD of placing
    private initialCaptures(p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const grpsP = this.getGroups(p);
        const grpsOther = this.getGroups(p === 1 ? 2 : 1);
        const captures: string[] = [];
        const g = this.graph;
        for (const group of grpsP) {
            const neighbours = new Set<string>();
            for (const cell of group) {
                for (const n of g.neighbours(cell)) {
                    // by definition, any such cells are occupied by the opponent
                    if (!group.includes(n) && this.board.has(n)) {
                        neighbours.add(n);
                    }
                }
            }
            for (const n of neighbours) {
                const grpOther = grpsOther.find(grp => grp.includes(n))!;
                if (group.length >= grpOther.length) {
                    captures.push(n);
                }
            }
        }
        return captures;
    }

    // Returns a list of valid initial placements (in this game, all empty cells)
    private initialPlacements(): string[] {
        const g = this.graph.graph;
        return [...g.nodes()].filter(n => !this.board.has(n));
    }

    // determines whether the player is allowed to place additional stones from this point
    // (meaning the placed stone is adjacent to at least one enemy AND at least one friendly)
    private canContinueFrom(cell: string): boolean {
        const player = this.board.get(cell);
        if (player === undefined) {
            throw new Error(`There is no stone at ${cell}`);
        }
        const thisGroup = this.getGroups(player).find(grp => grp.includes(cell))!;
        if (thisGroup.length === 1) {
            return false;
        }
        const g = this.graph;
        const others = new Set<string>();
        for (const node of thisGroup) {
            for (const n of g.neighbours(node)) {
                if (this.board.has(n)) {
                    const owner = this.board.get(n)!;
                    if (owner !== player) {
                        others.add(n);
                    }
                }
            }
        }
        if (others.size === 0) {
            return false;
        }
        const otherGroups = this.getGroups(player === 1 ? 2 : 1).filter(grp => grp.reduce((acc, curr) => acc || others.has(curr), false));
        // but at least one of the opposing groups must be the same size or larger to continue
        for (const grp of otherGroups) {
            if (grp.length >= thisGroup.length) {
                return true;
            }
        }
        return false;
    }

    // Returns a list of enemy groups adjacent to an initial placement
    // Intended to only be called if `canContinueFrom` was already checked to be true
    private getAdjacentOthers(cell: string): string[][] {
        const player = this.board.get(cell);
        if (player === undefined) {
            throw new Error(`There is no stone at ${cell}`);
        }
        const thisGroup = this.getGroups(player).find(grp => grp.includes(cell))!;
        if (thisGroup.length === 1) {
            return [];
        }
        const g = this.graph;
        const others = new Set<string>();
        for (const node of thisGroup) {
            for (const n of g.neighbours(node)) {
                if (this.board.has(n)) {
                    const owner = this.board.get(n)!;
                    if (owner !== player) {
                        others.add(n);
                    }
                }
            }
        }
        if (others.size === 0) {
            return [];
        }
        return this.getGroups(player === 1 ? 2 : 1).filter(grp => grp.reduce((acc, curr) => acc || others.has(curr), false));
    }

    // Assumes the validator has already checked that continuations are even allowed.
    // Given the group so far, find all adjacent empty cells you can place into
    // that do not touch any groups not in the whitelist.
    private getContinuations(group: string[], whitelist: string[][]): string[] {
        const next = new Set<string>();

        const sizes = new Set<number>();
        whitelist.forEach(grp => sizes.add(grp.length));
        // if the group is currently the size of the largest whitelisted group,
        // then no further continuations are permitted
        if (group.length < Math.max(...sizes)) {
            const g = this.graph.graph;
            const adjacent = new Set<string>();
            for (const node of group) {
                for (const n of g.neighbors(node)) {
                    if (!this.board.has(n)) {
                        adjacent.add(n);
                    }
                }
            }

            for (const adj of adjacent) {
                let isGood = true;
                for (const n of g.neighbors(adj)) {
                    if (this.board.has(n)) {
                        const wlIncludes = whitelist.reduce((acc, curr) => acc || curr.includes(n), false);
                        if (!group.includes(n) && !wlIncludes) {
                            isGood = false;
                            break;
                        }
                    }
                }
                if (isGood) {
                    next.add(adj);
                }
            }
        }

        return [...next];
    }

    // Assumes the validator has already checked that continuations were even allowed.
    // Given the group so far, find all adjacent enemy cells you could capture by replacement.
    private getClosingCaptures(group: string[], whitelist: string[][]): string[] {
        const next = new Set<string>();

        const matching = new Set<string>();
        whitelist.filter(grp => grp.length === group.length).flat().forEach(c => matching.add(c));
        if (matching.size > 0) {
            const g = this.graph.graph;
            for (const node of group) {
                for (const n of g.neighbors(node)) {
                    if (matching.has(n)) {
                        next.add(n);
                    }
                }
            }
        }

        return [...next];
    }

    private getGroups(p?: playerid): string[][] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = this.graph.graph;
        for (const node of [...g.nodes()]) {
            if (this.board.get(node) !== p) {
                g.dropNode(node);
            }
        }
        return connectedComponents(g);
    }

    public getButtons(): ICustomButton[] {
        if (this.randomMove() === "pass") {
            return [{ label: "pass", move: "pass" }];
        }
        return [];
    }

    // Always chooses an initial capture when presented.
    // When placing, always continues if possible.
    // But always takes the first capture.
    public randomMove(): string {
        const caps = shuffle(this.initialCaptures()) as string[];
        const places = shuffle(this.initialPlacements()) as string[];

        // always choose initial capture when presented
        if (caps.length > 0) {
            return `x${caps[0]}`;
        }

        // otherwise we're placing
        if (places.length > 0) {
            for (const initial of places) {
                const cloned = this.clone();
                cloned.board.set(initial, this.currplayer);
                // if you can't continue, just return the placement
                if (!cloned.canContinueFrom(initial)) {
                    return initial;
                }
                // at this point, continue until no more placements are possible
                const cells: string[] = [initial];
                let group = cloned.getGroups().find(grp => grp.includes(initial))!;
                const whitelist = cloned.getAdjacentOthers(initial);
                let conts = shuffle(cloned.getContinuations(group, whitelist)) as string[];
                let closing = shuffle(cloned.getClosingCaptures(group, whitelist)) as string[];
                while (closing.length === 0 && conts.length > 0) {
                    const cell = conts[0];
                    cloned.board.set(cell, this.currplayer);
                    cells.push(cell);
                    group = cloned.getGroups().find(grp => grp.includes(initial))!;
                    conts = shuffle(cloned.getContinuations(group, whitelist)) as string[];
                    closing = shuffle(cloned.getClosingCaptures(group, whitelist)) as string[];
                }
                // if a capture is possible, make it
                if (closing.length > 0) {
                    return cells.join(",") + "(x" + closing[0] + ")";
                }
                // otherwise just move to the next possible placement
            }
        }

        // if we make it here, passing is the only option
        return "pass";
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove;
            // empty move, initial placement or initial capture
            if (move === "") {
                if (this.board.has(cell)) {
                    newmove = `x${cell}`;
                } else {
                    newmove = cell;
                }
            }
            // otherwise, continuation
            else {
                // placement
                if (!this.board.has(cell)) {
                    newmove = move + "," + cell;
                }
                // closing capture
                else {
                    newmove = move + "(x" + cell + ")";
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
            result.canrender = true;
            result.message = i18next.t("apgames:validation.surmount.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (this.randomMove() !== "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.surmount.BAD_PASS");
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // initial captures
        if (m.startsWith("x")) {
            const cell = m.substring(1);
            if (!this.initialCaptures().includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.surmount.BAD_INIT_CAP", {cell});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // everything after here is one or more placements
        let stub = m;
        let capCell: string|undefined;
        if (m.includes("(")) {
            const idx = m.indexOf("(");
            stub = m.substring(0, idx);
            capCell = m.substring(idx + 2, m.length - 1);
        }
        const cells = stub.split(",");
        const g = this.graph;
        const cloned = this.clone();

        // validate placements first
        let whitelist: string[][] = [];
        const sizes = new Set<number>();
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            // must be valid
            if (!g.graph.hasNode(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // must be empty
            if (cloned.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
            // if more than a single placement, make sure continuations are even allowed
            if (i === 1 && !cloned.canContinueFrom(cells[0])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.surmount.CANT_CONTINUE", {start: cells[0]});
                return result;
            }
            // for continuations
            if (i > 0) {
                const thisGrp = cloned.getGroups().find(grp => grp.includes(cells[0]))!;
                const incCont = cloned.getContinuations(thisGrp, whitelist);
                if (!incCont.includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.surmount.BAD_CONTINUE", {cell});
                    return result;
                }
            }

            // place piece
            cloned.board.set(cell, this.currplayer);

            // if first placement, initialize whitelist and sizes
            if (i === 0) {
                whitelist = cloned.getAdjacentOthers(cell);
                whitelist.forEach(grp => sizes.add(grp.length));
            }
        }

        const thisGroup = cloned.getGroups().find(grp => grp.includes(cells[0]))!;
        const caps = cloned.getClosingCaptures(thisGroup, whitelist);
        const canCap = caps.length > 0 && capCell === undefined;
        const continuations = cloned.getContinuations(thisGroup, whitelist);
        const mustCap = cells.length > 1;

        // if a capture is present, validate it
        if (capCell !== undefined) {
            if (!caps.includes(capCell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.surmount.BAD_CAP", {cell: capCell});
                return result;
            }
        }

        // return appropriate result
        // BOTH caps and conts available
        if (canCap && continuations.length > 0) {
            result.valid = true;
            result.complete = cells.length === 1 ? 0 : -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.surmount.PARTIAL_BOTH");
            return result;
        }
        // just caps
        else if (canCap && continuations.length === 0) {
            result.valid = true;
            result.complete = cells.length === 1 ? 0 : -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.surmount.PARTIAL_CAP");
            return result;
        }
        // just continuations
        else if (!canCap && continuations.length > 0) {
            result.valid = true;
            result.complete = cells.length === 1 ? 0 : -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.surmount.PARTIAL_CONTINUE");
            return result;
        }
        // error state where there are no continuations available but no capture has been given yet
        else if (mustCap && capCell === undefined && continuations.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.surmount.DEAD_END");
            return result;
        }
        // all other situations are valid
        else {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): SurmountGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        this.results = [];
        this.dots = [];

        if (m === "pass") {
            this.results.push({ type: "pass", who: this.currplayer });
        } else {
            // initial capture
            if (m.startsWith("x")) {
                const cell = m.substring(1);
                const group = this.getGroups(this.currplayer === 1 ? 2 : 1).find(grp => grp.includes(cell))!;
                // capture all stones in the group
                for (const stone of group) {
                    this.board.delete(stone);
                }
                this.results.push({ type: "capture", count: group.length, where: group.join(", ") });
                // place at designated place
                this.board.set(cell, this.currplayer);
                this.results.push({type: "place", where: cell});
            }
            // placements
            else {
                let stub = m;
                const idx = m.indexOf("(");
                let capCell: string|undefined;
                if (idx !== -1) {
                    stub = m.substring(0, idx);
                    capCell = m.substring(idx+2, m.length - 1);
                }
                const cells = stub.split(",");
                let whitelist: string[][] = [];
                for (const cell of cells) {
                    this.board.set(cell, this.currplayer);
                    this.results.push({type: "place", where: cell});

                    // if first cell, populate whitelist
                    if (cell === cells[0]) {
                        whitelist = this.getAdjacentOthers(cell);
                    }
                }
                if (capCell !== undefined) {
                    const group = this.getGroups(this.currplayer === 1 ? 2 : 1).find(grp => grp.includes(capCell!))!;
                    // capture all stones in the group
                    for (const stone of group) {
                        this.board.delete(stone);
                    }
                    this.results.push({ type: "capture", count: group.length, where: group.join(", ") });
                    // place at designated place
                    this.board.set(capCell, this.currplayer);
                    this.results.push({type: "place", where: capCell});
                }

                // if partial and no capture yet, show dots
                if (partial && capCell === undefined) {
                    const thisGroup = this.getGroups().find(grp => grp.includes(cells[0]))!;
                    const continuations = this.getContinuations(thisGroup, whitelist);
                    const captures = this.getClosingCaptures(thisGroup, whitelist);
                    this.dots = [...continuations, ...captures];
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SurmountGame {
        // game only ends if one player has no pieces on the board and two turns have been played
        const count1 = [...this.board.values()].filter(p => p === 1).length;
        const count2 = [...this.board.values()].filter(p => p === 2).length;
        if (this.stack.length >= 3) {
            if (count1 === 0) {
                this.gameover = true;
                this.winner = [2];
            } else if (count2 === 0) {
                this.gameover = true;
                this.winner = [1];
            }
        }

        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): ISurmountState {
        return {
            game: SurmountGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SurmountGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()]),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true) as string[][];
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
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    const targets: RowCol[] = [];
                    for (const m of move.where!.split(", ")) {
                        const [x, y] = this.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [RowCol, ...RowCol[]]});
                }
            }
        }

        // add dots
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const coords: RowCol[] = [];
            for (const dot of this.dots) {
                const [x, y] = this.algebraic2coords(dot);
                coords.push({row: y, col: x});
            }
            rep.annotations!.push({type: "dots", targets: coords as [RowCol, ...RowCol[]]});
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
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.group", { player, count: r.count, cells: r.where }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SurmountGame {
        return Object.assign(new SurmountGame(), deepclone(this) as SurmountGame);
    }
}
