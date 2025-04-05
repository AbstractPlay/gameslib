/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareOrthGraph } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IPaintbucketState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PaintbucketGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Paintbucket",
        uid: "paintbucket",
        playercounts: [2],
        version: "20250330",
        dateAdded: "2025-04-05",
        // version: "20231225",
        // i18next.t("apgames:descriptions.paintbucket")
        description: "apgames:descriptions.paintbucket",
        urls: ["https://boardgamegeek.com/boardgame/362682/paintbucket"],
        people: [
            {
                type: "designer",
                name: "Michael Amundsen",
                urls: ["https://boardgamegeek.com/boardgamedesigner/133389/michael-amundsen"],
            },
            {
                type: "designer",
                name: "Alek Erickson",
                urls: ["https://boardgamegeek.com/boardgamedesigner/101050/alek-erickson"],
            },
        ],
        variants: [
            {uid: "size-16", group: "board"},
        ],
        categories: ["goal>annihilate", "mechanic>convert",  "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["automove", "limited-pieces"],
    };
    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;

    constructor(state?: IPaintbucketState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPaintbucketState;
            }
            if (state.game !== PaintbucketGame.gameinfo.uid) {
                throw new Error(`The Paintbucket game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string,playerid>();
            const g = this.graph;
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = g.coords2algebraic(col, row);
                    if (row % 2 === 0) {
                        if (col % 2 === 0) {
                            board.set(cell, 1);
                        } else {
                            board.set(cell, 2);
                        }
                    } else {
                        if (col % 2 === 0) {
                            board.set(cell, 2);
                        } else {
                            board.set(cell, 1);
                        }
                    }
                }
            }

            const fresh: IMoveState = {
                _version: PaintbucketGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): PaintbucketGame {
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
        this.board = deepclone(state.board) as Map<string, playerid>;
        this.lastmove = state.lastmove;
        return this;
    }

    public get boardSize(): number {
        const size = this.variants.find(v => v.startsWith("size-"));
        if (size !== undefined) {
            const [,nstr] = size.split("-");
            return parseInt(nstr, 10);
        }
        return 12;
    }

    private get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardSize, this.boardSize);
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

    private getGroupSizes(p?: playerid): number[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const groups = this.getGroups(p);
        return [...new Set<number>(groups.map(g => g.length))].sort((a,b) => b - a);
    }

    public getPlayersScores(): IScores[] {
        const groupSizes1 = this.getGroupSizes(1);
        const groupSizes2 = this.getGroupSizes(2);
        return [
            { name: i18next.t("apgames:status.GROUPSIZES"), scores: [groupSizes1.join(","), groupSizes2.join(",")] },
        ]
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const g = this.graph;

        // any enemy cell is a valid move
        for (const node of g.graph.nodes()) {
            if (this.board.get(node) !== player) {
                moves.push(node);
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const newmove = g.coords2algebraic(col, row);

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
        const allMoves = this.moves();

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.paintbucket.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (!allMoves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.paintbucket.INITIAL_INSTRUCTIONS");
            return result;
        }

        // all good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): PaintbucketGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const group = this.getGroups(this.currplayer === 1 ? 2 : 1).find(grp => grp.includes(m));
        if (group === undefined) {
            throw new Error(`Could not find an enemy group containing the cell ${m}`);
        }
        for (const cell of group) {
            this.board.set(cell, this.currplayer);
        }
        this.results.push({type: "convert", what: group.join(","), into: this.currplayer.toString(), where: m});

        // update currplayer
        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        return status;
    }

    protected checkEOG(): PaintbucketGame {
        const g1 = this.getGroupSizes(1);
        const g2 = this.getGroupSizes(2);
        if (g1.length === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (g2.length === 0) {
            this.gameover = true;
            this.winner = [1];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IPaintbucketState {
        return {
            game: PaintbucketGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: PaintbucketGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const g = this.graph;
        const pieces: string[][] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const nodes: string[] = [];
            for (let x = 0; x <= this.boardSize; x++) {
                const cell = g.coords2algebraic(x, y);
                const val = this.board.get(cell)!;
                nodes.push(val === 1 ? "A" : "B");
            }
            pieces.push(nodes);
        }
        const pstr: string = pieces.map(r => r.join("")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-beveled",
                width:  this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: {
                        name: "piece-square-borderless",
                        colour: 1,
                },
                B: {
                        name: "piece-square-borderless",
                        colour: 2,
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "convert") {
                    const targets: RowCol[] = [];
                    const cells = move.what.split(",");
                    for (const cell of cells) {
                        const [col, row] = g.algebraic2coords(cell);
                        targets.push({row, col})
                    }
                    rep.annotations.push({type: "dots", targets: targets as [RowCol, ...RowCol[]]});
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "convert":
                const count = r.what.split(",").length;
                node.push(i18next.t("apresults:CONVERT.paintbucket", {player, count, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PaintbucketGame {
        return Object.assign(new PaintbucketGame(), deepclone(this) as PaintbucketGame);
        // return new PaintbucketGame(this.serialize());
    }
}
