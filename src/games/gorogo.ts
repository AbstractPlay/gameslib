/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareOrthDirectedGraph } from "../common/graphs";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Piece = playerid|"X";

type InHand = {
    normal: number;
    neutral: number;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Piece>;
    lastmove?: string;
    pieces: [InHand,InHand];
};

export interface IGorogoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GorogoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "GoRoGo",
        uid: "gorogo",
        playercounts: [2],
        version: "20250425",
        dateAdded: "2025-01-27",
        // i18next.t("apgames:descriptions.gorogo")
        description: "apgames:descriptions.gorogo",
        urls: [
            "https://www.logygames.com/english/GoRoGo.html",
            "https://boardgamegeek.com/boardgame/216789/gorogo"
        ],
        people: [
            {
                type: "designer",
                name: "Mitsuo Yamamoto",
                apid: "14dcbd2c-e6f7-421b-a051-025461c38158",
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
        categories: ["goal>score>eog", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>3c"],
        flags: ["experimental", "limited-pieces", "scores"]
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
    public pieces!: [InHand,InHand];

    constructor(state?: IGorogoState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, Piece>();
            const fresh: IMoveState = {
                _version: GorogoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces: [
                    {
                        normal: 10,
                        neutral: 3,
                    },
                    {
                        normal: 10,
                        neutral: 2,
                    }
                ],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGorogoState;
            }
            if (state.game !== GorogoGame.gameinfo.uid) {
                throw new Error(`The Gorogo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GorogoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string,Piece>;
        this.lastmove = state.lastmove;
        this.pieces = deepclone(state.pieces) as [InHand,InHand];
        return this;
    }

    public get graph(): SquareOrthDirectedGraph {
        return new SquareOrthDirectedGraph(5, 5);
    }

    // normally called on cloned states
    // takes the last placed cell and returns whether the formed group has liberties
    // you need to take into account whose turn it is to handle neutral pieces correctly
    public hasLiberties(cell: string, p?: playerid): boolean {
        if (p === undefined) {
            p = this.currplayer;
        }
        if (!this.board.has(cell)) {
            throw new Error(`The cell ${cell} is empty!`);
        }
        const owner = this.board.get(cell)!;
        if (owner === "X") {
            throw new Error(`Neutral placements are always legal and shouldn't be checked.`);
        }
        const g = this.graph.graph;
        for (const node of [...g.nodes()]) {
            if (!this.board.has(node)) {
                g.dropNode(node);
            } else {
                const contents = this.board.get(node)!;
                // if the player is the owner, then you also own neutrals
                if (p === owner) {
                    if (contents !== owner && contents !== "X") {
                        g.dropNode(node);
                    }
                }
                // otherwise, neutrals don't count
                else {
                    if (contents !== owner) {
                        g.dropNode(node);
                    }
                }
            }
        }
        const group = connectedComponents(g).find(grp => grp.includes(cell))!;
        const graph = this.graph;
        const liberties = new Set<string>();
        for (const node of group) {
            for (const n of graph.neighbours(node)) {
                if (!this.board.has(n)) {
                    liberties.add(n);
                }
            }
        }
        return liberties.size > 0;
    }

    // scans the current board state for groups belonging to the opponent with no liberties
    // it then returns the locations of all such captures
    // (remember that neutral pieces are never captured)
    public toCapture(p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const opp = p === 1 ? 2 : 1;

        // to avoid unnecessarily checking all the cells in groups already tested,
        // do a connectedComponents run first
        const g = this.graph.graph;
        for (const node of [...g.nodes()]) {
            if (!this.board.has(node)) {
                g.dropNode(node);
            } else {
                const contents = this.board.get(node)!;
                if (contents !== opp) {
                    g.dropNode(node);
                }
            }
        }
        const conn = connectedComponents(g);

        // for each group, do a liberties check on the first owned cell
        // if no liberties, then add to the captured list
        const capped: string[] = [];
        for (const grp of conn) {
            // find first cell of the group that's not a neutral
            const found = grp.find(n => this.board.get(n)! !== "X");
            // if there is one, test it
            if (found !== undefined) {
                // if no liberties
                if (!this.hasLiberties(found, p)) {
                    // capture each non-neutral cell
                    for (const cell of grp) {
                        if (this.board.get(cell)! !== "X") {
                            capped.push(cell);
                        }
                    }
                }
            }
            // otherwise this is a group of neutrals and can't be captured anyway
        }

        return capped.sort((a,b) => a.localeCompare(b));
    }

    public canPlace(cell: string, p?: playerid): boolean {
        if (p === undefined) {
            p = this.currplayer;
        }

        // if the group created by placing at `cell` has liberties or triggers a capture, we're good
        const cloned = this.clone();
        cloned.board.set(cell, p);
        const hasLiberties = cloned.hasLiberties(cell);
        // if no liberties, check that captures create a liberty
        if (!hasLiberties) {
            const toCap = this.toCapture(p === 1 ? 2 : 1);
            if (toCap.length > 0) {
                toCap.forEach(c => cloned.board.delete(c));
                if (cloned.hasLiberties(cell)) {
                    return true;
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }
        return true;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const g = this.graph;
        const moves: string[] = [];

        const empties = g.graph.nodes().filter(n => !this.board.has(n));
        // opening placement
        if (this.stack.length === 1) {
            for (const cell of empties) {
                moves.push(`&${cell}`);
            }
        }
        // all other moves
        else {
            const {normal, neutral} = this.pieces[this.currplayer - 1];
            // neutrals may always be placed anywhere
            if (neutral > 0) {
                for (const cell of empties) {
                    moves.push(`&${cell}`);
                }
            }
            // normal pieces require some checks
            if (normal > 0) {
                for (const cell of empties) {
                    if (this.canPlace(cell)) {
                        moves.push(cell);
                    }
                }
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
            let cell: string|undefined;
            if (row >= 0 && col >= 0) {
                cell = GorogoGame.coords2algebraic(col, row);
            }
            let newmove: string;

            // empty move means placing a regular piece or selecting a neutral
            if (move === "") {
                if (cell !== undefined) {
                    if (this.stack.length === 1) {
                        newmove = `&${cell}`
                    } else {
                        newmove = cell;
                    }
                } else {
                    newmove = "&";
                }
            }
            // otherwise you're choosing a cell or changing your previous choice
            else {
                // clicking off the board twice toggles
                if (cell === undefined) {
                    newmove = "";
                }
                // if move is a neutral, change to place at this cell
                else if (move.startsWith("&")) {
                    newmove = `&${cell}`;
                }
                // otherwise just place at the cell
                else {
                    newmove = cell;
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
            result.message = i18next.t("apgames:validation.gorogo.INITIAL_INSTRUCTIONS", {context: this.stack.length === 1 ? "setup" : "play"})
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
                result.message = i18next.t("apgames:validation.gorogo.PARTIAL");
                return result;
            } else {
                const {normal, neutral} = this.pieces[this.currplayer - 1];
                if ( (m.startsWith("&") && neutral === 0) || (!m.startsWith("&") && normal === 0)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gorogo.NO_PIECES", {context: m.startsWith("&") ? "neutral" : "normal"});
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gorogo.INVALID_MOVE", {move: m});
                    return result;
                }
            }
        }
    }

    public move(m: string, {trusted = false} = {}): GorogoGame {
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
            if (!allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        let cell: string;
        if (m.startsWith("&")) {
            cell = m.substring(1);
        } else {
            cell = m;
        }

        let {normal, neutral} = this.pieces[this.currplayer - 1];
        if (m.startsWith("&")) {
            this.board.set(cell, "X");
            this.results.push({type: "place", where: cell, what: "henge"});
            neutral--;
        } else {
            this.board.set(cell, this.currplayer);
            this.results.push({type: "place", where: cell, what: "piece"});
            normal--;
        }
        this.pieces[this.currplayer - 1] = {normal, neutral};

        // now check for and execute captures
        const toCap = this.toCapture();
        if (toCap.length > 0) {
            toCap.forEach(c => this.board.delete(c));
            this.results.push({type: "capture", count: toCap.length, where: toCap.join(",")});
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

    public getPlayerScore(player: number): number {
        let captured = 10;
        const opp = player === 1 ? 2 : 1;
        const inhand = this.pieces[opp - 1];
        captured -= inhand.normal;
        const onboard = [...this.board.values()].filter(v => v === opp);
        captured -= onboard.length;
        return captured;
    }

    protected checkEOG(): GorogoGame {
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        let reason: string|undefined;

        const ihPrev = this.pieces[prev - 1];
        const ihCurr = this.pieces[this.currplayer - 1];

        // if last move was a henge and your hand is now empty, then prev loses
        if (this.lastmove?.startsWith("&") && ihPrev.neutral === 0 && ihPrev.normal === 0) {
            this.gameover = true;
            this.winner = [this.currplayer];
            reason = "henge last";
        }
        // if nobody has any pieces, game is scored
        else if (ihPrev.neutral === 0 && ihPrev.normal === 0 && ihCurr.neutral === 0 && ihCurr.normal === 0) {
            this.gameover = true;
            const scorePrev = this.getPlayerScore(prev);
            const scoreCurr = this.getPlayerScore(this.currplayer);
            if (scorePrev > scoreCurr) {
                this.winner = [prev];
            } else if (scoreCurr > scorePrev) {
                this.winner = [this.currplayer];
            } else {
                this.winner = [1];
            }
            reason = "scoring";
        }
        // finally, no moves, curr loses
        else if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prev];
            reason = "no moves";
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IGorogoState {
        return {
            game: GorogoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: GorogoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string,Piece>,
            pieces: deepclone(this.pieces) as [InHand,InHand],
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
                const cell = GorogoGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else if (contents === 2) {
                        pieces.push("B");
                    } else {
                        pieces.push("X");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{5}/g, "_");

        // let mainColour = 1;
        // let smallColour = 2;
        // if (!this.gameover && this.currplayer === 2) {
        //     mainColour = 2;
        //     smallColour = 1;
        // }

        const areas: AreaPieces[] = [];
        for (const p of [1,2]) {
            const {neutral} = this.pieces[p - 1];
            if (neutral > 0) {
                areas.push({
                    type: "pieces",
                    label: `Player ${p}'s neutral pieces`,
                    pieces: Array.from({length: neutral}, () => "pcX") as [string, ...string[]],
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: 5,
                height: 5,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1,
                },
                B: {
                    name: "piece",
                    colour: 2,
                },
                X: {
                    name: "yinyang",
                    colour: 1,
                    colour2: 2,
                },
                pcX: {
                    name: "yinyang",
                    colour: 1,
                    colour2: 2,
                    scale: 0.86,
                },
            },
            pieces: pstr,
            areas: areas.length > 0 ? areas : undefined,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = GorogoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const targets: RowCol[] = [];
                    for (const cell of move.where!.split(",")) {
                        const [col, row] = GorogoGame.algebraic2coords(cell);
                        targets.push({row, col});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [RowCol, ...RowCol[]]});
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

        status += "**In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const {normal, neutral} = this.pieces[n - 1];
            status += `Player ${n}: ${normal}.${neutral}\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.gorogo", {player, where: r.where, context: r.what}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.multiple", {player, count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        const inhand = this.pieces.map(({normal, neutral}) => parseFloat(`${normal}.${neutral}`))
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: inhand }
        ]
    }

    public clone(): GorogoGame {
        return Object.assign(new GorogoGame(), deepclone(this) as GorogoGame);
    }
}
