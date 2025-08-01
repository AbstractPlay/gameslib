import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaButtonBar, ButtonBarButton } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
const moveTypes = ["1-1-1-1-1", "2-1-1", "2-2", "3-1", "4"];
const winningRays: Map<number, string[][]> = new Map([
    [4, JSON.parse("[[\"a4\",\"b4\",\"c4\",\"d4\"],[\"a4\",\"b3\",\"c2\",\"d1\"],[\"a4\",\"a3\",\"a2\",\"a1\"],[\"a4\",\"b4\",\"a3\",\"b3\"],[\"b4\",\"b3\",\"b2\",\"b1\"],[\"b4\",\"c4\",\"b3\",\"c3\"],[\"c4\",\"c3\",\"c2\",\"c1\"],[\"c4\",\"d4\",\"c3\",\"d3\"],[\"d4\",\"d3\",\"d2\",\"d1\"],[\"d4\",\"c3\",\"b2\",\"a1\"],[\"a3\",\"b3\",\"c3\",\"d3\"],[\"a3\",\"b3\",\"a2\",\"b2\"],[\"b3\",\"c3\",\"b2\",\"c2\"],[\"c3\",\"d3\",\"c2\",\"d2\"],[\"a2\",\"b2\",\"c2\",\"d2\"],[\"a2\",\"b2\",\"a1\",\"b1\"],[\"b2\",\"c2\",\"b1\",\"c1\"],[\"c2\",\"d2\",\"c1\",\"d1\"],[\"a1\",\"b1\",\"c1\",\"d1\"]]") as string[][]],
    [6, JSON.parse("[[\"a6\",\"b6\",\"c6\",\"d6\"],[\"a6\",\"b5\",\"c4\",\"d3\"],[\"a6\",\"a5\",\"a4\",\"a3\"],[\"a6\",\"b6\",\"a5\",\"b5\"],[\"b6\",\"c6\",\"d6\",\"e6\"],[\"b6\",\"c5\",\"d4\",\"e3\"],[\"b6\",\"b5\",\"b4\",\"b3\"],[\"b6\",\"c6\",\"b5\",\"c5\"],[\"c6\",\"d6\",\"e6\",\"f6\"],[\"c6\",\"d5\",\"e4\",\"f3\"],[\"c6\",\"c5\",\"c4\",\"c3\"],[\"c6\",\"d6\",\"c5\",\"d5\"],[\"d6\",\"d5\",\"d4\",\"d3\"],[\"d6\",\"c5\",\"b4\",\"a3\"],[\"d6\",\"e6\",\"d5\",\"e5\"],[\"e6\",\"e5\",\"e4\",\"e3\"],[\"e6\",\"d5\",\"c4\",\"b3\"],[\"e6\",\"f6\",\"e5\",\"f5\"],[\"f6\",\"f5\",\"f4\",\"f3\"],[\"f6\",\"e5\",\"d4\",\"c3\"],[\"a5\",\"b5\",\"c5\",\"d5\"],[\"a5\",\"b4\",\"c3\",\"d2\"],[\"a5\",\"a4\",\"a3\",\"a2\"],[\"a5\",\"b5\",\"a4\",\"b4\"],[\"b5\",\"c5\",\"d5\",\"e5\"],[\"b5\",\"c4\",\"d3\",\"e2\"],[\"b5\",\"b4\",\"b3\",\"b2\"],[\"b5\",\"c5\",\"b4\",\"c4\"],[\"c5\",\"d5\",\"e5\",\"f5\"],[\"c5\",\"d4\",\"e3\",\"f2\"],[\"c5\",\"c4\",\"c3\",\"c2\"],[\"c5\",\"d5\",\"c4\",\"d4\"],[\"d5\",\"d4\",\"d3\",\"d2\"],[\"d5\",\"c4\",\"b3\",\"a2\"],[\"d5\",\"e5\",\"d4\",\"e4\"],[\"e5\",\"e4\",\"e3\",\"e2\"],[\"e5\",\"d4\",\"c3\",\"b2\"],[\"e5\",\"f5\",\"e4\",\"f4\"],[\"f5\",\"f4\",\"f3\",\"f2\"],[\"f5\",\"e4\",\"d3\",\"c2\"],[\"a4\",\"b4\",\"c4\",\"d4\"],[\"a4\",\"b3\",\"c2\",\"d1\"],[\"a4\",\"a3\",\"a2\",\"a1\"],[\"a4\",\"b4\",\"a3\",\"b3\"],[\"b4\",\"c4\",\"d4\",\"e4\"],[\"b4\",\"c3\",\"d2\",\"e1\"],[\"b4\",\"b3\",\"b2\",\"b1\"],[\"b4\",\"c4\",\"b3\",\"c3\"],[\"c4\",\"d4\",\"e4\",\"f4\"],[\"c4\",\"d3\",\"e2\",\"f1\"],[\"c4\",\"c3\",\"c2\",\"c1\"],[\"c4\",\"d4\",\"c3\",\"d3\"],[\"d4\",\"d3\",\"d2\",\"d1\"],[\"d4\",\"c3\",\"b2\",\"a1\"],[\"d4\",\"e4\",\"d3\",\"e3\"],[\"e4\",\"e3\",\"e2\",\"e1\"],[\"e4\",\"d3\",\"c2\",\"b1\"],[\"e4\",\"f4\",\"e3\",\"f3\"],[\"f4\",\"f3\",\"f2\",\"f1\"],[\"f4\",\"e3\",\"d2\",\"c1\"],[\"a3\",\"b3\",\"c3\",\"d3\"],[\"a3\",\"b3\",\"a2\",\"b2\"],[\"b3\",\"c3\",\"d3\",\"e3\"],[\"b3\",\"c3\",\"b2\",\"c2\"],[\"c3\",\"d3\",\"e3\",\"f3\"],[\"c3\",\"d3\",\"c2\",\"d2\"],[\"d3\",\"e3\",\"d2\",\"e2\"],[\"e3\",\"f3\",\"e2\",\"f2\"],[\"a2\",\"b2\",\"c2\",\"d2\"],[\"a2\",\"b2\",\"a1\",\"b1\"],[\"b2\",\"c2\",\"d2\",\"e2\"],[\"b2\",\"c2\",\"b1\",\"c1\"],[\"c2\",\"d2\",\"e2\",\"f2\"],[\"c2\",\"d2\",\"c1\",\"d1\"],[\"d2\",\"e2\",\"d1\",\"e1\"],[\"e2\",\"f2\",\"e1\",\"f1\"],[\"a1\",\"b1\",\"c1\",\"d1\"],[\"b1\",\"c1\",\"d1\",\"e1\"],[\"c1\",\"d1\",\"e1\",\"f1\"]]") as string[][]]
]);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, number>;
    lastmove?: string;
    lastTwo: [string|undefined, string|undefined];
};

export interface IAlfredsWykeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AlfredsWykeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Alfred's Wyke",
        uid: "wyke",
        playercounts: [2],
        version: "20211226",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.wyke")
        description: "apgames:descriptions.wyke",
        urls: ["https://www.abstractgames.org/alfredswyke.html", "http://superdupergames.org/rules/wyke.pdf"],
        people: [
            {
                type: "designer",
                name: "Andrew Perkis",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [
                    "https://boardgamegeek.com/boardgame/37584/alfreds-wyke",
                ],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "6x6",
                group: "size",
            }
        ],
        categories: ["goal>align", "mechanic>asymmetry",  "mechanic>capture", "mechanic>economy", "mechanic>place", "mechanic>share", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>3c"],
        flags: ["no-moves"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, number>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 4;
    public lastTwo: [string|undefined, string|undefined] = [undefined, undefined];

    constructor(state?: IAlfredsWykeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, number>();
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "6x6") ) {
                this.variants = ["6x6"];
                this.boardSize = 6;
            }
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = AlfredsWykeGame.coords2algebraic(col, row, this.boardSize);
                    board.set(cell, 4);
                }
            }
            if (this.boardSize === 4) {
                board.set("a4", 3);
                board.set("d1", 3);
            } else {
                board.set("b5", 3);
                board.set("e2", 3);
            }
            const fresh: IMoveState = {
                _version: AlfredsWykeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                lastTwo: [undefined, undefined],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAlfredsWykeState;
            }
            if (state.game !== AlfredsWykeGame.gameinfo.uid) {
                throw new Error(`The AlfredsWyke engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AlfredsWykeGame {
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
        this.lastTwo = [...state.lastTwo];
        this.results = [...state._results];
        this.boardSize = 4;
        if (this.variants.includes("6x6")) {
            this.boardSize = 6;
        }
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";

            // If they clicked on a button, reset the whole move
            if (col < 0) {
                const clicked = piece!.slice(5);
                // If the move can't be chosen, return existing move
                if (this.lastTwo.includes(clicked)) {
                    return {move, message: ""} as IClickResult;
                // Otherwise, seed the new move
                } else {
                    newmove = `${clicked} ()`;
                }
            } else {
                const cell = AlfredsWykeGame.coords2algebraic(col, row, this.boardSize);
                const match = move.match(/^(\S+?) \((.*?)\)/);
                if (match !== null) {
                    const movestr = match[1];
                    let cells: string[] = [];
                    if (match[2].length > 0) {
                        cells = match[2].split(",");
                    }
                    cells.push(cell);
                    newmove = `${movestr} (${cells.join(",")})`;
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.wyke.INITIAL_INSTRUCTIONS")
            return result;
        }

        const match = m.match(/^(\S+?)\((\S*)\)$/);
        if (match === null) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wyke.INVALID_FORMAT", {move: m});
            return result;
        }
        const moveType = match[1];
        let moveCells: string[] = [];
        if (match[2].length > 0) {
            moveCells = match[2].split(",");
        }

        // validate the move type first
        // in the list
        if (! moveTypes.includes(moveType)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wyke.INVALID_MOVETYPE", {move: moveType});
            return result;
        }
        // not already chosen
        if (this.lastTwo.includes(moveType)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wyke.MOVETYPE_UNAVAILABLE");
            return result;
        }
        const moveNums = moveType.split("-").map(n => parseInt(n, 10));

        // validate cells
        for (const cell of moveCells) {
            // valid cells
            try {
                AlfredsWykeGame.algebraic2coords(cell, this.boardSize);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // unclaimed
            const val = this.board.get(cell)!;
            if ( (val === 0) || (val === 8) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.wyke.CELL_CLAIMED", {cell});
                return result;
            }
        }
        // no duplicates
        const cellSet = new Set<string>(moveCells);
        if (cellSet.size !== moveCells.length) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wyke.DUPLICATE_CELLS");
            return result;
        }
        // at least as many cells as moves
        if (moveCells.length > moveNums.length) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.wyke.TOO_MANY_CELLS");
            return result;
        }
        // enough pieces in each cell
        for (let i = 0; i < moveCells.length; i++) {
            const cell = moveCells[i];
            const num = moveNums[i];
            const val = this.board.get(cell)!;
            // builder
            if (this.currplayer === 1) {
                if (val + num > 8) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.wyke.TOO_MANY_PIECES", {where: cell, num});
                    return result;
                }
            // destroyer
            } else {
                if (val - num < 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.wyke.TOO_FEW_PIECES", {where: cell, num});
                    return result;
                }
            }
        }

        // check for partial
        const unclaimed = [...this.board.values()].filter(v => (v > 0) && (v < 8));
        // complete move
        // Either same number of cells as move numbers
        // Or you've chosen the 5x1 move, and there are only four unclaimed cells, and you've provided four cells
        if ( (moveNums.length === moveCells.length) || ( (moveNums.length === 5) && (unclaimed.length === 4) && (moveCells.length === 4) ) ) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        // otherwise partial
        } else {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.wyke.PARTIAL");
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): AlfredsWykeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (result.complete !== 1) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        const match = m.match(/^(\S+?)\((\S*)\)$/);
        if (match === null) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }
        const moveType = match[1];
        const moveNums = moveType.split("-").map(n => parseInt(n, 10));
        if ( (partial) && (match[2].length === 0) ) { return this; }
        const moveCells = match[2].split(",");
        for (let i = 0; i < moveCells.length; i++) {
            const cell = moveCells[i];
            const num = moveNums[i];
            if (! this.board.has(cell)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            let val = this.board.get(cell)!;
            if (this.currplayer === 1) {
                val += num;
                this.results.push({type: "add", where: cell, num});
            } else {
                val -= num;
                this.results.push({type: "remove", where: cell, num});
            }
            if ( (val < 0) || (val > 8) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            this.board.set(cell, val);
            if ( (val === 0) || (val === 8) ) {
                this.results.push({type: "claim", where: cell});
            }
        }

        if (partial) { return this; }

        // update lastTwo
        this.lastTwo[0] = this.lastTwo[1];
        this.lastTwo[1] = moveType;

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

    private normalizeMove(m: string): string {
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const match = m.match(/^(\S+?)\((\S*)\)$/);
        if (match === null) {
            return m;
        }

        const moveType = match[1];

        if (moveType === "3-1" || moveType === "4") {
            return m;
        }
        let moveCells: string[] = [];
        if (match[2].length > 0) {
            moveCells = match[2].split(",");
        }

        if (moveType === "1-1-1-1-1") {
            return `${moveType}(${moveCells.sort().join(",")})`;
        }
        if (moveType === "2-1-1") {
            if (moveCells[1] < moveCells[2]) {
                return `${moveType}(${moveCells[0]},${moveCells[1]},${moveCells[2]})`;
            } else {
                return `${moveType}(${moveCells[0]},${moveCells[2]},${moveCells[1]})`;
            }
        }
        if (moveType === "2-2") {
            if (moveCells[0] < moveCells[1]) {
                return `${moveType}(${moveCells[0]},${moveCells[1]})`;
            } else {
                return `${moveType}(${moveCells[1]},${moveCells[0]})`;
            }
        }
        throw new Error("Invalid move type");
    }

    public sameMove(move1: string, move2: string): boolean {
        return this.normalizeMove(move1) === this.normalizeMove(move2);
    }

    protected checkEOG(): AlfredsWykeGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        const claimed = this.claimedBy(prevPlayer);

        // numerical win first (7 or 12)
        let target = 7;
        if (this.variants.includes("6x6")) {
            target = 12;
        }
        if (claimed.length >= target) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        // positional wins
        const rays = winningRays.get(this.boardSize)!;
        for (const ray of rays) {
            let complete = true;
            for (const cell of ray) {
                if (! claimed.includes(cell)) {
                    complete = false;
                    break;
                }
            }
            if (complete) {
                this.gameover = true;
                this.winner = [prevPlayer];
                break;
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

    private claimedBy(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        let target = 0;
        if (player === 1) {
            target = 8;
        }
        return [...this.board.entries()].filter(e => e[1] === target).map(e => e[0]);
    }

    public state(): IAlfredsWykeState {
        return {
            game: AlfredsWykeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AlfredsWykeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            lastTwo: [...this.lastTwo],
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        const nums: Set<number> = new Set();
        for (let row = 0; row < this.boardSize; row++) {
            const node: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = AlfredsWykeGame.coords2algebraic(col, row, this.boardSize);
                const val = this.board.get(cell)!;
                if (val === 0) {
                    node.push("D");
                } else if (val === 8) {
                    node.push("B");
                } else {
                    nums.add(val);
                    node.push(`W${val.toString()}`);
                }
            }
            pieces.push(node);
        }
        let pstr: string = pieces.map(r => r.join(",")).join("\n");
        pstr = pstr.replace(/\n,{8}\n/g, "\n_\n");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                tileHeight: 1,
                tileWidth: 1,
                tileSpacing: 0.25
            },
            legend: {
                B: {
                    name: "piece-square",
                    colour: 1
                },
                D: {
                    name: "piece-square",
                    colour: 2
                },
                W1: {
                    name: "wyke-1",
                    scale: 0.85,
                },
                W2: {
                    name: "wyke-2",
                    scale: 0.85,
                },
                W3: {
                    name: "wyke-3",
                    scale: 0.85,
                },
                W4: {
                    name: "wyke-4",
                    scale: 0.85,
                },
                W5: {
                    name: "wyke-5",
                    scale: 0.85,
                },
                W6: {
                    name: "wyke-6",
                    scale: 0.85,
                },
                W7: {
                    name: "wyke-7",
                    scale: 0.85,
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if ( (move.type === "add") || (move.type === "remove") ) {
                    const [x, y] = AlfredsWykeGame.algebraic2coords(move.where, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // Add button bar
        const bar: AreaButtonBar = {
            type: "buttonBar",
            position: "left",
            // Keep this one just because of the pain of initializing
            // @ts-expect-error (I want to add the buttons incrementally)
            buttons: []
        };
        for (const mt of moveTypes) {
            const b = {
                label: mt,
            } as ButtonBarButton;
            if (this.lastTwo.includes(mt)) {
                b.attributes = [{name: "text-decoration", value: "line-through"}]
                if (this.lastTwo[0] === mt) {
                    b.fill = "#ddd";
                } else {
                    b.fill = "#999";
                }
            }
            bar.buttons.push(b);
        }
        rep.areas = [bar];
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }


    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected getMoveList(): any[] {
        return this.getMovesAndResults(["add", "remove", "eog", "winners"]);
    }

    public clone(): AlfredsWykeGame {
        return new AlfredsWykeGame(this.serialize());
    }
}
