import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { RectGrid, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
export const gameApgamesEn = {
    validation: {
        CAN_PLACE: "If you're moving, provide the destination. If you wish to place a piece you have in hand, click the cell again.",
        INITIAL_INSTRUCTIONS: "Click a stack you control.",
        NONE_INHAND: "You have no pieces in hand to place.",
        ORTHOGONAL: "Stacks may only move orthogonally, never diagonally.",
        TOOFAR: "You may not move the stack more spaces than the number of pieces in the stack.",
        UNCONTROLLED: "You can only move stacks where your piece is on top.",
    },
    status: {
        CAPTURES: "Captures",
        CONTROLLED: "Controlled",
    },
    variants: {
        "#goal": {
            description: "The last player able to move a stack wins.",
            name: "Immobilize",
        },
        "captures-6": {
            description: "The first player to capture six enemy pieces wins.",
            name: "Capture target (6)",
        },
        "captures-10": {
            description: "The first player to capture ten enemy pieces wins.",
            name: "Capture target (10)",
        },
        hegemony: {
            description: "The game ends when one player controls every stack on the board; a player with no controlled stacks loses immediately.",
            name: "Hegemony",
        },
    },
};


export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    inhand: [number,number];
    captures: [number, number];
};

export interface IFocusState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const blockedCells: string[] = ["a1", "b1", "g1", "h1", "a2", "h2", "a7", "h7", "a8", "b8", "g8", "h8"];

export class FocusGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Focus",
        uid: "focus",
        playercounts: [2],
        version: "20230607",
        dateAdded: "2023-06-27",
        description: "A Sid Sackon classic. One may move stacks of pieces as many spaces as pieces in the stack. Once stacks become higher than 5 pieces, the bottom-most pieces are captured. The last person able to move a stack wins.",
        urls: [
            "https://en.wikipedia.org/wiki/Focus_(board_game)",
            "https://boardgamegeek.com/boardgame/789/focus",
        ],
        bggid: "789",
        people: [
            {
                type: "designer",
                name: "Sid Sackson",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>immobilize", "goal>score>race", "mechanic>capture", "mechanic>coopt", "mechanic>move", "mechanic>stack", "board>shape>oct", "board>connect>rect", "components>simple>1per"],
        variants: [
            { uid: "#goal", group: "goal" },
            { uid: "captures-6", group: "goal" },
            { uid: "captures-10", group: "goal" },
            { uid: "hegemony", group: "goal" },
        ],
        flags: []
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public inhand: [number,number] = [0,0];
    public captures: [number, number] = [0, 0];

    constructor(state?: IFocusState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid[]>();
            for (let row = 1; row < 7; row++) {
                let outer: playerid = 1;
                let inner: playerid = 2;
                if (row % 2 === 0) {
                    outer = 2;
                    inner = 1;
                }
                for (let col = 1; col < 7; col++) {
                    const cell = FocusGame.coords2algebraic(col, row);
                    if ( (col === 3) || (col === 4) ) {
                        board.set(cell, [inner]);
                    } else {
                        board.set(cell, [outer]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: FocusGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                inhand: [0,0],
                captures: [0, 0],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFocusState;
            }
            if (state.game !== FocusGame.gameinfo.uid) {
                throw new Error(`The Focus engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FocusGame {
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
        this.inhand = [...state.inhand];
        this.captures = state.captures !== undefined ? [...state.captures] : [0, 0];
        return this;
    }

    private captureTarget(): number | undefined {
        if (this.variants.includes("captures-10")) {
            return 10;
        }
        if (this.variants.includes("captures-6")) {
            return 6;
        }
        return undefined;
    }

    private isImmobilizeGoal(): boolean {
        if (this.variants.includes("hegemony")) {
            return false;
        }
        if (this.captureTarget() !== undefined) {
            return false;
        }
        return true;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(8, 8);
        const mine = [...this.board.entries()].filter(e => e[1][e[1].length - 1] === player).map(e => e[0]);
        for (const cell of mine) {
            const height = this.board.get(cell)!.length;
            const [x, y] = FocusGame.algebraic2coords(cell);
            for (const dir of ["N", "E", "S", "W"] as const) {
                let ray = grid.ray(x, y, dir).map(node => FocusGame.coords2algebraic(...node)).filter(c => ! blockedCells.includes(c));
                if (ray.length > height) {
                    ray = ray.slice(0, height);
                }
                if (ray.length > 0) {
                    for (const next of ray) {
                        moves.push(`${cell}-${next}`);
                    }
                }
            }
        }
        if (this.inhand[player - 1] > 0) {
            for (let x = 0; x < 8; x++) {
                for (let y = 0; y < 8; y++) {
                    const cell = FocusGame.coords2algebraic(x, y);
                    if (! blockedCells.includes(cell)) {
                        moves.push(`+${cell}`);
                    }
                }
            }
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = FocusGame.coords2algebraic(col, row);
            let newmove = "";
            // previous move text
            if (move.length > 0) {
                const prev = move.substring(0, 2);
                // If the same cell, might be trying to place an inhand piece
                if (prev === cell) {
                    if (this.inhand[this.currplayer - 1] > 0) {
                        newmove = `+${cell}`;
                    } else {
                        return {move: "", message: ""} as IClickResult;
                    }
                } else {
                    newmove = `${prev}-${cell}`;
                }
            // fresh move, occupied space
            } else if (this.board.has(cell)) {
                // if enemy occupied and you have pieces in hand, assume placement
                const contents = this.board.get(cell)!;
                if ( (contents[contents.length - 1] !== this.currplayer) && (this.inhand[this.currplayer - 1] > 0) ) {
                    newmove = `+${cell}`;
                // otherwise, let the validator handle it
                } else {
                    newmove = cell;
                }
            // fresh move, empty space
            } else {
                if (this.inhand[this.currplayer - 1] > 0) {
                    newmove = `+${cell}`;
                } else {
                    return {move: "", message: ""} as IClickResult;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.focus.INITIAL_INSTRUCTIONS")
            return result;
        }

        // placements
        if (m.startsWith("+")) {
            const cell = m.substring(1);
            // must have pieces in hand
            if (this.inhand[this.currplayer - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.focus.NONE_INHAND");
                return result;
            }
            // must be a valid cell
            try {
                FocusGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            if (blockedCells.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // partials first
        if (! m.includes("-")) {
            // valid cell
            try {
                FocusGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            if (blockedCells.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // cell has a stack
            if (! this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // that stack belongs to you

            const contents = this.board.get(m)!;
            if (contents[contents.length - 1] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = -1;
            if (this.inhand[this.currplayer - 1] > 0) {
                result.message = i18next.t("apgames:validation.focus.CAN_PLACE");
            } else {
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            }
            return result;
        }

        // full moves
        const [from, to] = m.split("-");
        // cells valid
        for (const cell of [from, to]) {
            try {
                FocusGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            if (blockedCells.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
        }
        // from and to must be different
        if (from === to) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        // `from` has a piece
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        const contents = this.board.get(from)!;
        if (contents[contents.length - 1] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.focus.UNCONTROLLED");
            return result;
        }
        const [xFrom, yFrom] = FocusGame.algebraic2coords(from);
        const [xTo, yTo] = FocusGame.algebraic2coords(to);
        const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
        if (bearing.length !== 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.focus.ORTHOGONAL");
            return result;
        }
        // Max distance the height of the stack
        for (const pair of [[xFrom, xTo], [yFrom, yTo]]) {
            if (Math.abs(pair[0] - pair[1]) > contents.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.focus.TOOFAR");
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): FocusGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        let dest: string;
        if (m.startsWith("+")) {
            this.inhand[this.currplayer - 1]--;
            dest = m.substring(1);

            const contents = this.board.get(dest);
            if (contents === undefined) {
                this.board.set(dest, [this.currplayer]);
            } else {
                this.board.set(dest, [...contents, this.currplayer]);
            }
            this.results.push({type: "place", where: dest});
        } else {
            const [from, to] = m.split("-");
            dest = to;
            const [fx, fy] = FocusGame.algebraic2coords(from);
            const [tx, ty] = FocusGame.algebraic2coords(to);
            const distance = Math.max(Math.abs(fx - tx), Math.abs(fy - ty));
            const fContents = this.board.get(from)!;
            const tContents = this.board.get(to);
            const fStaying = fContents.slice(0, fContents.length - distance);
            const fLeaving = fContents.slice(fContents.length - distance);
            this.results.push({type: "move", from, to, count: distance});
            this.board.set(from, [...fStaying]);
            if (tContents === undefined) {
                this.board.set(to, [...fLeaving]);
            } else {
                this.board.set(to, [...tContents, ...fLeaving]);
            }
            // clean up the board
            if (fStaying.length === 0) {
                this.board.delete(from);
            }
        }
        // check destination for captures
        const contents = this.board.get(dest)!;
        if (contents.length > 5) {
            const remaining = contents.slice(contents.length - 5);
            this.board.set(dest, [...remaining]);
            const removed = contents.slice(0, contents.length - 5);
            const capped = removed.filter(p => p !== this.currplayer).length;
            const reclaimed = removed.filter(p => p === this.currplayer).length;
            if (capped > 0) {
                this.captures[this.currplayer - 1] += capped;
                this.results.push({type: "capture", count: capped, where: dest});
            }
            if (reclaimed > 0) {
                this.results.push({type: "reclaim", count: reclaimed, where: dest});
                this.inhand[this.currplayer - 1] += reclaimed;
            }
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

    protected checkEOG(): FocusGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        const target = this.captureTarget();
        if (target !== undefined && this.captures[prevPlayer - 1] >= target) {
            this.gameover = true;
            this.winner = [prevPlayer];
        } else if (this.variants.includes("hegemony")) {
            const c1 = this.getControlled(1);
            const c2 = this.getControlled(2);
            if (c1 === 0) {
                this.gameover = true;
                this.winner = [2];
            } else if (c2 === 0) {
                this.gameover = true;
                this.winner = [1];
            }
        } else if (this.isImmobilizeGoal() && this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IFocusState {
        return {
            game: FocusGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FocusGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            inhand: [...this.inhand],
            captures: [...this.captures],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = FocusGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents.join(""));
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-tiles",
            board: {
                style: "squares",
                width: 8,
                height: 8,
                blocked: [
                    {row: 0, col: 0},
                    {row: 0, col: 1},
                    {row: 0, col: 6},
                    {row: 0, col: 7},
                    {row: 1, col: 0},
                    {row: 1, col: 7},
                    {row: 6, col: 0},
                    {row: 6, col: 7},
                    {row: 7, col: 0},
                    {row: 7, col: 1},
                    {row: 7, col: 6},
                    {row: 7, col: 7}
                ],
                stackMax: 5
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            let exitNoted = false;
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = FocusGame.algebraic2coords(move.from);
                    const [toX, toY] = FocusGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if ( (move.type === "capture") || (move.type === "reclaim") ) {
                    if (! exitNoted) {
                        exitNoted = true;
                        const [x, y] = FocusGame.algebraic2coords(move.where as string);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                } else if (move.type === "place") {
                    const [x, y] = FocusGame.algebraic2coords(move.where as string);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getControlled(player: number): number {
        return [...this.board.values()].filter(s => s[s.length - 1] === player).length;
    }

    public sidebarScores(): IScores[] {
        const rows: IScores[] = [
            { name: this.neutralAreaLabel("apgames:status.focus.CONTROLLED"), scores: [this.getControlled(1), this.getControlled(2)] },
        ];
        if (this.captureTarget() !== undefined) {
            rows.push({ name: this.neutralAreaLabel("apgames:status.focus.CAPTURES"), scores: [...this.captures] });
        }
        rows.push({ name: this.neutralAreaLabel("apgames:status.PIECESINHAND"), scores: this.inhand });
        return rows;
    }

    protected recordExportExclude(): string[] {
        return ["move", "place", "eog", "winners"];
    }



    public resolveChatSeat(_r: APMoveResult, currplayer: number): number {
        let seat = currplayer + 1;
        if (seat > this.numplayers) {
            seat = 1;
        }
        return seat;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "move":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.MOVE.complete", {
                    from: r.from,
                    to: r.to,
                    count: r.count as number,
                });
                return true;
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PLACE.nowhat", { where: r.where! });
                return true;
            case "capture":
                this.pushNeutralChatLine(lines, "apresults:_general.CAPTURE.multiple", { count: r.count! });
                return true;
            case "reclaim":
                this.pushNeutralChatLine(lines, "apresults:_general.RECLAIM.nowhat", { count: r.count! });
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): FocusGame {
        return new FocusGame(this.serialize());
    }
}

