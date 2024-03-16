/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, IStashEntry } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, shuffle } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type CellContents = "S"|"M"|"C"|"E";
type Affiliation = "S"|"M"|undefined;

const startingBag = "SSSSSSSSSSMMMMMMMMMMEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    affiliations: [Affiliation,Affiliation];
    captured: [CellContents[],CellContents[]];
};

export interface IWitchState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    startpos: CellContents[];
};

interface ICounts {
    [k: string]: number;
}

export class WitchGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Witch Stones",
        uid: "witch",
        playercounts: [2],
        version: "20230612",
        dateAdded: "2023-06-22",
        // i18next.t("apgames:descriptions.witch")
        description: "apgames:descriptions.witch",
        // i18next.t("apgames:notes.witch")
        notes: "apgames:notes.witch",
        urls: ["https://boardgamegeek.com/boardgame/20517/witch-stones"],
        people: [
            {
                type: "designer",
                name: "Justin D. Jacobson",
            }
        ],
        categories: ["goal>score>race", "mechanic>capture",  "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["shared-pieces", "player-stashes", "scores", "random-start"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 9);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 9);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public affiliations: [Affiliation,Affiliation] = [undefined, undefined];
    public captured: [CellContents[],CellContents[]] = [[],[]];
    public gameover = false;
    public startpos: CellContents[] = [];
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IWitchState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>([
                ["a9", "S"], ["i1", "S"],
                ["a1", "M"], ["i9", "M"]
            ]);
            let bag = shuffle(startingBag.split("")) as CellContents[];
            // place edge pieces first
            for (let x = 0; x < 9; x++) {
                for (let y = 0; y < 9; y++) {
                    if ( (x === 0) || (x === 8) || (y === 0) || (y === 8) ) {
                        const cell = WitchGame.coords2algebraic(x, y);
                        if (! board.has(cell)) {
                            board.set(cell, bag.pop()!)
                        }
                    }
                }
            }
            // now shuffle in the crowns
            bag.push(...("CCCCCCCCC".split("") as CellContents[]));
            bag = shuffle(bag) as CellContents[];
            // finish the rest
            for (let x = 0; x < 9; x++) {
                for (let y = 0; y < 9; y++) {
                    const cell = WitchGame.coords2algebraic(x, y);
                    if (! board.has(cell)) {
                        board.set(cell, bag.pop()!)
                    }
                }
            }
            if (bag.length > 0) {
                throw new Error("The bag still has pieces in it! This should never happen!");
            }
            // now store the final starting position
            for (let y = 0; y < 9; y++) {
                for (let x = 0; x < 9; x++) {
                    const cell = WitchGame.coords2algebraic(x, y);
                    this.startpos.push(board.get(cell)!);
                }
            }
            const fresh: IMoveState = {
                _version: WitchGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                affiliations: [undefined, undefined],
                captured: [[],[]],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IWitchState;
            }
            if (state.game !== WitchGame.gameinfo.uid) {
                throw new Error(`The Witch engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.startpos = [...state.startpos];
        }
        this.load();
    }

    public load(idx = -1): WitchGame {
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
        this.captured = deepclone(state.captured) as [CellContents[],CellContents[]];
        this.affiliations = [...state.affiliations]
        return this;
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        const aff = this.affiliations[player - 1];
        if ( (aff !== undefined) && (aff !== null) ) {
            for (const pc of this.captured[player - 1]) {
                if (pc === aff) {
                    continue;
                } else if (pc === "C") {
                    score += 5;
                } else if (pc === "E") {
                    score++;
                } else {
                    score += 2;
                }
            }
        }
        return score;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const entry: IStashEntry[] = [];
        const aff = this.affiliations[player - 1];
        if ( (aff !== undefined) && (aff !== null) ) {
            let glyph: Glyph;
            if (aff === "M") {
                glyph = {"name":"piecepack-suit-moons","player": 2};
            } else {
                glyph = {"name":"piecepack-suit-suns","player": 1};
            }
            entry.push({
                glyph,
                movePart: aff,
                count: 1,
            });
        }
        return entry;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const grid = new RectGrid(9, 9);
        let affActual = this.affiliations[player - 1];
        if (affActual === null) { affActual = undefined; }
        let affs: Affiliation[];
        if ( (player === 2) && (affActual === undefined) ) {
            affs = ["M", "S"];
        } else {
            affs = [affActual];
        }

        const moves: string[] = [];
        for (const aff of affs) {
            for (let x = 0; x < 9; x++) {
                for (let y = 0; y < 9; y++) {
                    const cell = WitchGame.coords2algebraic(x, y);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell)!;
                        // You can never pick up crowns
                        if (contents === "C") {
                            continue;
                        }
                        // You cannot pick up your enemy's pieces once affiliated
                        if ( (contents !== "E") && (aff !== undefined) && (contents !== aff) ) {
                            continue;
                        }
                        // at this point, it's either Earth, or you're unaffliated, or it matches your affiliation
                        if (affs.length === 1) {
                            moves.push(cell);
                        } else {
                            moves.push(`(${aff})${cell}`);
                        }
                    } else {
                        for (const dir of ["N","E","S","W"] as const) {
                            const ray = grid.ray(x, y, dir).map(node => WitchGame.coords2algebraic(...node));
                            const segment: string[] = [];
                            let hasblank = false;
                            for (const next of ray) {
                                segment.push(next);
                                if (! this.board.has(next)) {
                                    hasblank = true;
                                    break;
                                }
                            }
                            if ( (hasblank) && (segment.length > 1) ) {
                                moves.push(`${cell}-${segment[segment.length - 1]}`);
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = WitchGame.coords2algebraic(col, row);
            let aff = this.affiliations[this.currplayer - 1];
            if (aff === null) { aff = undefined; }
            let newmove = "";

            // if move is fresh, can click on basically anything
            if ( (move.length === 0) || (move === "(S)") || (move === "(M)") ) {
                if ( (aff === undefined) && (move === "(S)") ) {
                    aff = "S";
                } else if ( (aff === undefined) && (move === "(M)") ) {
                    aff = "M";
                }
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === "C") {
                        return {move, message: ""} as IClickResult;
                    } else if (contents === "E") {
                        newmove = `${move}${cell}`;
                    } else if ( (aff !== undefined) && (contents !== aff) ) {
                        return {move, message: ""} as IClickResult;
                    } else if ( (aff === undefined) && (this.currplayer === 2) ) {
                        if ( (contents === "S") || (contents === "M") ) {
                            newmove = `(${contents})`;
                        } else {
                            return {move, message: ""} as IClickResult;
                        }
                    } else {
                        newmove = `${move}${cell}`;
                    }
                } else {
                    newmove = `${move}${cell}`;
                }
            // otherwise, must be an empty space
            } else {
                if (! this.board.has(cell)) {
                    newmove = `${move}-${cell}`;
                } else {
                    return {move, message: ""} as IClickResult;
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

        let aff = this.affiliations[this.currplayer - 1];
        if (aff === null) { aff = undefined; }

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            if ( (this.currplayer === 2) && (aff === undefined) ) {
                result.message = i18next.t("apgames:validation.witch.AFFILIATE");
            } else {
                result.message = i18next.t("apgames:validation.witch.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        // look for affiliation choosing
        let move = m;
        if (m.startsWith("(")) {
            if (aff !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.ALREADY_AFFILIATED");
                return result;
            }
            if (this.currplayer !== 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.2P_PRIVILEGE");
                return result;
            }
            if (m.length < 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.INCOMPLETE_AFFILIATION");
                return result;
            }
            aff = m[1].toUpperCase() as Affiliation;
            if ( (aff !== "S") && (aff !== "M") ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.INCOMPLETE_AFFILIATION");
                return result;
            }
            move = m.substring(3);
            if (move.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.witch.INITIAL_INSTRUCTIONS");
                return result;
            }
        }

        if (move.includes("-")) {
            const [from, to] = move.split("-");

            // must be valid cells
            let fx: number; let fy: number;
            let tx: number; let ty: number;
            try {
                [fx, fy] = WitchGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            try {
                [tx, ty] = WitchGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }

            // cells must be empty
            if ( (this.board.has(from)) || (this.board.has(to)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.BOTH_EMPTY");
                return result;
            }

            // cells must be orthogonal
            const dir = RectGrid.bearing(fx, fy, tx, ty);
            if ( (dir === undefined) || (dir.length > 1) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.ORTHOGONAL");
                return result;
            }

            // must be unbroken line of pieces in between
            const between = RectGrid.between(fx, fy, tx, ty).map(node => WitchGame.coords2algebraic(...node));
            if (between.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.EMPTY_CAPTURE");
                return result;
            }
            for (const b of between) {
                if (! this.board.has(b)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.witch.UNBROKEN");
                    return result;
                }
            }
        } else {
            // must be valid cell
            try {
                WitchGame.algebraic2coords(move);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: move});
                return result;
            }

            // if occupied, must be a partial
            if (! this.board.has(move)) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.witch.PARTIAL");
                return result;
            }

            const contents = this.board.get(move)!;
            // must not be a crown
            if (contents === "C") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.NO_CROWNS");
                return result;
            }

            // must not be an opposing piece
            if ( (contents !== "E") && (aff !== undefined) && (contents !== aff) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.witch.NO_ENEMY");
                return result;
            }
        }

        // valid move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // The partial flag enables dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, {partial = false, trusted = false} = {}): WitchGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        if (m.startsWith("(")) {
            m = m[0] + m[1].toUpperCase() + m.substring(2);
        }
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        let move = m;
        if (m.startsWith("(")) {
            const declared = m[1].toUpperCase() as Affiliation;
            this.results.push({type: "affiliate", which: declared!});
            if (declared === "S") {
                this.affiliations = ["M", "S"];
            } else {
                this.affiliations = ["S", "M"];
            }
            move = m.substring(3);
        }
        let aff = this.affiliations[this.currplayer - 1];
        if (aff === null) { aff = undefined; }

        if (move.includes("-")) {
            const [from, to] = move.split("-");
            const between = RectGrid.between(...WitchGame.algebraic2coords(from), ...WitchGame.algebraic2coords(to)).map(node => WitchGame.coords2algebraic(...node));
            const counts: ICounts = {};
            let delta = 0;
            for (const b of between) {
                const contents = this.board.get(b)!;
                if (contents in counts) {
                    counts[contents]++;
                } else {
                    counts[contents] = 1;
                }
                if (contents === "E") {
                    delta++;
                } else if (contents === "C") {
                    delta += 5;
                } else if ( (aff !== undefined) && (contents !== aff) ) {
                    delta += 2;
                }
                this.captured[this.currplayer - 1].push(contents);
                this.board.delete(b);
            }
            // eslint-disable-next-line guard-for-in
            for (const key in counts) {
                this.results.push({type: "capture", "what": key, "count": counts[key]});
            }
            if (delta > 0) {
                this.results.push({type: "deltaScore", delta});
            }
        } else {
            const contents = this.board.get(move)!;
            let delta = 0;
            if (contents === "E") {
                delta = 1;
            } else if (contents === "C") {
                delta = 5;
            } else if ( (aff !== undefined) && (contents !== aff) ) {
                delta = 2;
            }
            this.captured[this.currplayer - 1].push(contents);
            this.results.push({type: "capture", "what": contents, "where": move});
            this.board.delete(move);
            if (delta > 0) {
                this.results.push({type: "deltaScore", delta});
            }
        }

        // Stop here if only requesting partial processing
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

    protected checkEOG(): WitchGame {
        const score1 = this.getPlayerScore(1);
        const score2 = this.getPlayerScore(2);
        if (score1 >= 50) {
            this.gameover = true;
            this.winner = [1];
        } else if (score2 >= 50) {
            this.gameover = true;
            this.winner = [2];
        } else if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [1,2];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IWitchState {
        return {
            game: WitchGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            startpos: [...this.startpos],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: WitchGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            affiliations: [...this.affiliations],
            captured: deepclone(this.captured) as [CellContents[],CellContents[]],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 9; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 9; col++) {
                const cell = WitchGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 9,
                height: 9,
            },
            legend: {
                "S": [
                    {
                        "name": "piece",
                        "player": 1
                    },
                    {
                        "name": "piecepack-suit-suns",
                        "scale": 0.5
                    }
                ],
                "M": [
                    {
                        "name": "piece",
                        "player": 2
                    },
                    {
                        "name": "piecepack-suit-moons",
                        "scale": 0.5
                    }
                ],
                "C": [
                    {
                        "name": "piece",
                        "player": 4
                    },
                    {
                        "name": "piecepack-suit-crowns",
                        "scale": 0.5
                    }
                ],
                "E": {
                    "name": "piece"
                },
            },
            pieces: pstr
        };

        // Add annotations
        const reMove = /^(\([SM]\))?[a-i]\d(\-[a-i]\d)?$/;
        if (this.lastmove !== undefined) {
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
            // let lastmove = this.stack[this.stack.length - 1].lastmove;
            let lastmove = this.lastmove;
            if ( (lastmove !== undefined) && (reMove.test(lastmove)) ) {
                if (lastmove.startsWith("(")) {
                    lastmove = lastmove.substring(3);
                }
                // @ts-ignore
                rep.annotations = [];
                if (lastmove.includes("-")) {
                    const [from, to] = lastmove.split("-");
                    const [fx, fy] = WitchGame.algebraic2coords(from);
                    const [tx, ty] = WitchGame.algebraic2coords(to);
                    rep.annotations.push({type: "exit", targets: [{row: fy, col: fx}, {row: ty, col: tx}]});
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx}, {row: ty, col: tx}]});
                } else {
                    const [x, y] = WitchGame.algebraic2coords(lastmove);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture":
                if ("where" in r) {
                    node.push(i18next.t("apresults:CAPTURE.witch.single", {player, where: r.where, context: r.what!}));
                } else {
                    node.push(i18next.t("apresults:CAPTURE.witch.nowhere", {player, context: r.what!, count: r.count!}));
                }
                resolved = true;
                break;
            case "affiliate":
                node.push(i18next.t("apresults:AFFILIATE.witch", {player, context: r.which}));
                resolved =true;
                break;
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {player, delta: r.delta, count: r.delta}));
                resolved =true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Affiliations**\n\n";
        status += `Player 1: ${this.affiliations[0]}\n\n`;
        status += `Player 2: ${this.affiliations[1]}\n\n`;

        status += "**Scores**\n\n";
        status += `Player 1: ${this.getPlayerScore(1)}\n\n`;
        status += `Player 2: ${this.getPlayerScore(2)}\n\n`;

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["capture", "affiliate", "eog", "winners"]);
    }

    public getStartingPosition(): string {
        return this.startpos.join("");
    }

    public clone(): WitchGame {
        return new WitchGame(this.serialize());
    }
}
