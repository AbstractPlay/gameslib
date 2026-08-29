import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, ColourResolvable } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexTriGraph } from "../common/graphs";
import i18next from "i18next";
import {
    CAPTURE_THRESHOLD,
    preyIndex,
    speciesIndex,
} from "./circleOfLife/species";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
    lastSpecies?: number;
    lastSpeciesBy?: playerid;
};

export interface ICircleOfLifeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CircleOfLifeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Circle of Life",
        uid: "circleOfLife",
        playercounts: [2],
        version: "20260808",
        dateAdded: "2026-08-25",
        // i18next.t("apgames:descriptions.circleOfLife")
        description: "apgames:descriptions.circleOfLife",
        // i18next.t("apgames:notes.circleOfLife")
        notes: "apgames:notes.circleOfLife",
        urls: [
            "https://web.archive.org/web/20230224011604/https://www.nickbentley.games/circle-of-life-an-ecosystem-simulation-with-rules-that-fit-on-a-napkin/",
            "https://boardgamegeek.com/boardgame/184730/circle-of-life",
        ],
        bggid: "184730",
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
                apid: "52077877-93bb-4fff-9e5f-f1c41ac8e866",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: [
            "goal>score>race",
            "mechanic>place",
            "mechanic>capture",
            "board>shape>hex",
            "components>simple>1per",
        ],
        flags: ["scores"],
    };

    public static readonly boardSize = 5;

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(CircleOfLifeGame.boardSize, CircleOfLifeGame.boardSize * 2 - 1);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0];
    public lastSpecies?: number;
    public lastSpeciesBy?: playerid;

    constructor(state?: ICircleOfLifeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: CircleOfLifeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICircleOfLifeState;
            }
            if (state.game !== CircleOfLifeGame.gameinfo.uid) {
                throw new Error(`The Circle of Life engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CircleOfLifeGame {
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
        this.scores = [...state.scores];
        this.lastSpecies = state.lastSpecies;
        this.lastSpeciesBy = state.lastSpeciesBy;
        return this;
    }

    private getGroups(player?: playerid): string[][] {
        player ??= this.currplayer;
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();

        for (const piece of pieces) {
            if (seen.has(piece)) { continue; }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) { continue; }
                group.add(cell);
                seen.add(cell);
                for (const n of this.graph.neighbours(cell)) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }

        return [...groups].map(group => [...group]);
    }

    private isAdjacent(cell: string, group: string[]): boolean {
        for (const part of group) {
            for (const neigh of this.graph.neighbours(part)) {
                if (cell === neigh) {
                    return true;
                }
            }
        }
        return false;
    }

    private isAdjacentGroups(groupA: string[], groupB: string[]): boolean {
        for (const cell of groupA) {
            if (this.isAdjacent(cell, groupB)) {
                return true;
            }
        }
        return false;
    }

    private newGroup(cell: string, groups: string[][]): string[] {
        const newGroup = [cell];
        for (const group of groups) {
            if (this.isAdjacent(cell, group)) {
                newGroup.push(...group);
            }
        }
        return newGroup;
    }

    private wouldCapture(cell: string): boolean {
        const newGroup = this.newGroup(cell, this.getGroups());
        const species = speciesIndex(newGroup, this.graph);
        const prey = preyIndex(species);
        const oppGroups = this.getGroups(this.currplayer % 2 + 1 as playerid);
        for (const oppGroup of oppGroups) {
            if (speciesIndex(oppGroup, this.graph) !== prey) { continue; }
            if (this.isAdjacentGroups(newGroup, oppGroup)) { return true; }
        }
        return false;
    }

    private normalizePlacement(m: string): string {
        let placement = m.toLowerCase().replace(/\s+/g, "");
        if (placement.endsWith("x")) {
            placement = placement.slice(0, -1);
        }
        return placement;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const groups = this.getGroups();
        const cells = this.graph.listCells(false) as string[];
        return cells.filter(c => !this.board.has(c))
            .filter(c => this.newGroup(c, groups).length <= 4);
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            if (result.valid) {
                result.move = this.wouldCapture(cell) ? `${cell}x` : cell;
            } else {
                result.move = move;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.circleOfLife.INSTRUCTIONS");
            return result;
        }

        m = this.normalizePlacement(m);
        const allMoves = this.moves();

        try {
            this.graph.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }

        if (!allMoves.includes(m)) {
            result.valid = false;
            if (this.newGroup(m, this.getGroups()).length > 4) {
                result.message = i18next.t("apgames:validation.circleOfLife.GROUP_TOO_LARGE");
            } else {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        result.canrender = true;
        return result;
    }

    public move(m: string, { trusted = false } = {}): CircleOfLifeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message); }
        }

        if (m.length === 0) { return this; }

        const placement = this.normalizePlacement(m);

        this.results = [];
        const mover = this.currplayer;
        const newGroup = this.newGroup(placement, this.getGroups());
        this.board.set(placement, mover);
        this.results.push({type: "place", where: placement});

        const species = speciesIndex(newGroup, this.graph);
        this.lastSpecies = species;
        this.lastSpeciesBy = mover;
        const prey = preyIndex(species);
        const oppGroups = this.getGroups(mover % 2 + 1 as playerid);

        for (const oppGroup of oppGroups) {
            if (speciesIndex(oppGroup, this.graph) !== prey) { continue; }
            if (!this.isAdjacentGroups(newGroup, oppGroup)) { continue; }
            for (const cell of oppGroup) {
                this.board.delete(cell);
            }
            this.scores[mover - 1] += oppGroup.length;
            this.results.push({
                type: "capture",
                where: [...oppGroup].join(","),
                count: oppGroup.length,
                what: String(prey),
            });
        }

        const captured = this.results.some(r => r.type === "capture");
        this.lastmove = captured ? `${placement}x` : placement;

        if (this.scores[mover - 1] >= CAPTURE_THRESHOLD) {
            this.gameover = true;
            this.winner = [mover];
            this.results.push({type: "eog"}, {type: "winners", players: [...this.winner]});
        } else {
            this.currplayer = mover % 2 + 1 as playerid;
            if (this.moves().length === 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push({type: "eog"}, {type: "winners", players: [...this.winner]});
            }
        }

        this.saveState();
        return this;
    }

    public render(): APRenderRep {
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    pieces.push(this.board.get(cell) === 1 ? "A" : "B");
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const referenceStyles: Record<string, ColourResolvable> = {
            species: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.55,
            },
            arrows: "_context_strokes",
            background: "_context_background",
            ring: "_context_background",
        };
        if (this.lastSpecies !== undefined && this.lastSpeciesBy !== undefined) {
            referenceStyles[`species-${this.lastSpecies}`] = this.lastSpeciesBy;
        }

        const rep: APRenderRep = {
            board: {
                style: "hex-of-hex",
                minWidth: CircleOfLifeGame.boardSize,
                maxWidth: CircleOfLifeGame.boardSize * 2 - 1,
                reference: {
                    layout: "annulus",
                    source: "circle-of-life-ring",
                    rotateWithBoard: true,
                    gap: 0.5,
                    styles: referenceStyles,
                },
            },
            legend: {
                A: {name: "hex-pointy", scale: 1.25, colour: 1},
                B: {name: "hex-pointy", scale: 1.25, colour: 2},
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "place" && move.where) {
                const [x, y] = this.graph.algebraic2coords(move.where);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
            } else if (move.type === "capture" && move.where) {
                for (const cell of move.where.split(",")) {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public sidebarScores(): IScores[] {
        return [{
            name: i18next.t("apgames:status.SCORES"),
            scores: [this.getPlayerScore(1), this.getPlayerScore(2)],
        }];
    }



    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.complete", {
                    where: r.where!, what: "piece",
                });
                return true;
            case "capture":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.circleOfLife", {
                    prey: r.what!, count: r.count!, where: r.where!,
                });
                return true;
            case "eog":
                this.pushNeutralChatLine(lines, "apresults:EOG.default");
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public state(): ICircleOfLifeState {
        return {
            game: CircleOfLifeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CircleOfLifeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            lastSpecies: this.lastSpecies,
            lastSpeciesBy: this.lastSpeciesBy,
        };
    }

    public clone(): CircleOfLifeGame {
        return new CircleOfLifeGame(this.serialize());
    }
}
