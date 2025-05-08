import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerEdge, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, SquareOrthGraph, UserFacingError } from "../common";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath?: string[];
    lastmove?: string;
    replace?: boolean;
};

export interface IMorphosState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

const base1: [number,number][] = [
    [-1,-1],
    [0,-1],
    [-1,0],
    [0,1],
];

const base2: [number,number][] = [
    [-1,-2],
    [-1,-1],
    [-1,0],
    [0,1],
    [1,1],
];


// base patterns
const offsetsBase: [number,number][][] = [];
for (const pattern of [base1, base2]) {
    const rot90 = pattern.map(([x,y]) => [0 - y, x] as [number,number]);
    const rot180 = rot90.map(([x,y]) => [0 - y, x] as [number,number]);
    const rot270 = rot180.map(([x,y]) => [0 - y, x] as [number,number]);
    for (const rot of [pattern, rot90, rot180, rot270]) {
        offsetsBase.push(rot);
        offsetsBase.push(rot.map(([x,y]) => [x, y*-1]));
    }
}

// simplified patterns
const offsetsSimple: [number,number][][] = [];
for (const pattern of [base1.slice(1), base2.slice(1)]) {
    const rot90 = pattern.map(([x,y]) => [0 - y, x] as [number,number]);
    const rot180 = rot90.map(([x,y]) => [0 - y, x] as [number,number]);
    const rot270 = rot180.map(([x,y]) => [0 - y, x] as [number,number]);
    for (const rot of [pattern, rot90, rot180, rot270]) {
        offsetsSimple.push(rot);
        offsetsSimple.push(rot.map(([x,y]) => [x, y*-1]));
    }
}

export class MorphosGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Morphos",
        uid: "morphos",
        playercounts: [2],
        version: "20250325",
        dateAdded: "2025-03-27",
        // i18next.t("apgames:descriptions.morphos")
        description: "apgames:descriptions.morphos",
        urls: [
            "https://boardgamegeek.com/boardgame/208437/morphos",
        ],
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
            {uid: "size-9", group: "board"},
            {uid: "size-11", group: "board"},
            {uid: "#board"},
            {uid: "size-15", group: "board"},
            {uid: "size-17", group: "board"},
            {uid: "simplified", group: "rules"},
            {uid: "double", group: "rules"},
            {uid: "replace", group: "rules"},
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["no-moves", "custom-randomization", "pie", "custom-buttons"]
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath?: string[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public replace?: boolean;

    constructor(state?: IMorphosState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: MorphosGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMorphosState;
            }
            if (state.game !== MorphosGame.gameinfo.uid) {
                throw new Error(`The Morphos engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MorphosGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map([...state.board.entries()]);
        this.lastmove = state.lastmove;
        this.connPath = state.connPath === undefined ? undefined : [...state.connPath];
        this.replace = state.replace;
        return this;
    }

    private get boardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0) {
            const sizeVariant = this.variants.find(v => v.startsWith("size"))
            if (sizeVariant !== undefined) {
                const [,nstr] = sizeVariant.split("-");
                return parseInt(nstr, 10);
            }
        }
        return 13;
    }

    private get playerLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.coords2algebraic(x, 0);
            const S = this.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.coords2algebraic(this.boardSize-1, y);
            const W = this.coords2algebraic(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN, lineS], [lineE, lineW]];
    }

    private get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    private get empties(): string[] {
        return this.graph.graph.nodes().filter(c => !this.board.has(c));
    }

    public shouldOfferPie(): boolean {
        return (!this.variants.includes("double"));
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    private randomCap(player?: playerid): string|null {
        if (player === undefined) {
            player = this.currplayer
        }
        const enemy = shuffle([...this.board.entries()].filter(([,p]) => p !== player).map(([c,]) => c)) as string[];
        for (const cell of enemy) {
            if (this.isWeak(cell)) {
                return cell;
            }
        }
        return null;
    }

    private get offsets(): [number,number][][] {
        if (this.variants.includes("simplified") || this.variants.includes("double") || this.variants.includes("replace")) {
            return offsetsSimple;
        }
        return offsetsBase;
    }

    public isWeak(stone: string): boolean {
        const p = this.board.get(stone);
        if (p === undefined) {
            return false;
        }
        const g = this.graph;
        const size = this.boardSize;
        const [ox, oy] = g.algebraic2coords(stone);
        for (const pattern of this.offsets) {
            const cells: (string|null)[] = pattern.map(([px,py]) => {
                const x = ox + px;
                const y = oy + py;
                // if both x and y are out of bounds, then illegal
                if ( (x < 0 || x >= size) && (y < 0 || y >= size) ) {
                    return null;
                }
                // otherwise single out of bounds
                // if simplified formations, then no out of bounds is acceptable
                if (
                    (
                        this.variants.includes("simplified") ||
                        this.variants.includes("double") ||
                        this.variants.includes("replace")
                    ) &&
                    (
                        (x < 0 || x >= size) ||
                        (y < 0 || y >= size)
                    )
                ) {
                    return null;
                }
                // there's only one row outside of each edge
                else if (x < 0) {
                    if (x === -1) {
                        return "W";
                    }
                    return null;
                } else if (x >= size) {
                    if (x === size) {
                        return "E";
                    }
                    return null;
                } else if (y < 0) {
                    if (y === -1) {
                        return "N";
                    }
                    return null;
                } else if (y >= size) {
                    if (y === size) {
                        return "S";
                    }
                    return null;
                }
                // otherwise this is an on-board cell
                else {
                    return g.coords2algebraic(x, y);
                }
            });
            // if `cells` contains any `null`s, then skip
            if (cells.includes(null)) {
                continue;
            }
            const target: playerid = p === 1 ? 2 : 1;
            let isGood = true;
            for (const cell of cells as string[]) {
                // check borders
                if (cell.length === 1) {
                    if (target === 1) {
                        if (cell === "E" || cell === "W") {
                            isGood = false;
                            break;
                        }
                    } else {
                        if (cell === "N" || cell === "S") {
                            isGood = false;
                            break;
                        }
                    }
                }
                // otherwise the board itself
                else {
                    if (!this.board.has(cell) || this.board.get(cell)! !== target) {
                        isGood = false;
                        break;
                    }
                }
            }
            if (isGood) {
                return true;
            }
        }
        // if we get here, then it's false
        return false;
    }

    public getButtons(): ICustomButton[] {
        if (this.randomCap() === null && this.empties.length === 0) return [{ label: "pass", move: "pass" }];
        return [];
    }

    public randomMove(): string {
        const empties = shuffle(this.empties) as string[];
        const cap = this.randomCap();
        const rand = Math.random();
        if (this.variants.includes("double")) {
            if (rand < 0.5 && cap !== null) {
                return `x${cap}`;
            } else if (empties.length > 0) {
                if (this.stack.length === 1) {
                    return empties[0];
                }
                else if (empties.length > 1) {
                    return [empties[0], empties[1]].join(",");
                } else {
                    return empties[0];
                }
            } else if (cap !== null) {
                return `x${cap}`;
            } else {
                return "pass";
            }
        } else {
            const parts: string[] = [];
            if (this.variants.includes("replace") && this.replace && empties.length > 0) {
                parts.push(empties.pop()!);
            }
            if (rand < 0.5 && cap !== null) {
                parts.push(`x${cap}`);
            } else if (empties.length > 0) {
                parts.push(empties[0]);
            } else if (cap !== null) {
                return `x${cap}`;
            } else {
                parts.push("pass");
            }
            return parts.join(",");
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove: string;
            if (move === "") {
                if (this.board.has(cell)) {
                    newmove = `x${cell}`;
                } else {
                    newmove = cell;
                }
            } else {
                const parts = move.split(",");
                if (this.board.has(cell)) {
                    parts.push(`x${cell}`);
                } else {
                    parts.push(cell);
                }
                newmove = parts.slice(-2).join(",");
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

        const mustReplace = this.variants.includes("replace") && this.replace && this.empties.length > 0;

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.morphos.INITIAL_INSTRUCTIONS", {context: mustReplace ? "replace" : "normal"})
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const parts = m.split(",");
        // can't start with a capture if replacement is possible
        if (mustReplace && (parts[0].startsWith("x") || parts[0] === "pass")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.morphos.MUST_REPLACE")
            return result;
        }
        // can't do multiple captures
        const caps = parts.filter(mv => mv.startsWith("x"));
        if (caps.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.morphos.ONE_CAP")
            return result;
        }
        // in double placement, can't place and capture
        if (this.variants.includes("double") && parts.length > 1 && m.includes("x")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.morphos.CAP_OR_PLACE")
            return result;
        }
        const cloned = this.clone();
        for (const move of parts) {
            // passes
            if (move === "pass") {
                if (cloned.randomCap() !== null || cloned.empties.length > 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.morphos.BAD_PASS")
                    return result;
                }
            }
            // captures
            else if (move.startsWith("x")) {
                const cap = move.substring(1);
                if (!cloned.board.has(cap)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cap})
                    return result;
                }
                if (cloned.board.get(cap)! === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE")
                    return result;
                }
                if (!cloned.isWeak(cap)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.morphos.NOT_WEAK", {cell: cap});
                    return result;
                }
                cloned.board.set(cap, this.currplayer);
            }
            // placements
            else {
                if (cloned.board.has(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: move});
                    return result;
                }
                cloned.board.set(move, this.currplayer);
            }
        }

        let valid = true;
        let complete: -1|0|1 = -1;
        let message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
        if (this.variants.includes("double")) {
            if ( (parts.length === 1 && (m.startsWith("x") || m === "pass" || cloned.empties.length === 0 || this.stack.length === 1)) || (parts.length === 2 && this.stack.length > 1)) {
                complete = 1;
                message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else if (parts.length === 1 && cloned.empties.length > 0 && this.stack.length > 1) {
                message = i18next.t("apgames:validation.morphos.PARTIAL_DOUBLE");
            } else {
                valid = false;
                message = i18next.t("apgames:validation.morphos.TOO_MANY");
            }
        } else if (this.variants.includes("replace")) {
            if ((mustReplace && parts.length === 2) || (!mustReplace && parts.length === 1)) {
                complete = 1;
                message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else if (mustReplace && parts.length === 1) {
                message = i18next.t("apgames:validation.morphos.INITIAL_INSTRUCTIONS", {context: "normal"});
            } else {
                valid = false;
                message = i18next.t("apgames:validation.morphos.TOO_MANY");
            }
        } else {
            if (parts.length > 1) {
                valid = false;
                message = i18next.t("apgames:validation.morphos.TOO_MANY");
            } else {
                complete = 1;
                message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
        }

        // Looks good
        result.valid = valid;
        result.complete = complete;
        result.message = message;
        result.canrender = true;
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): MorphosGame {
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
            // if (! this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        const parts = m.split(",");
        for (const move of parts) {
            if (move === "pass") {
                this.results.push({type: "pass"});
                if (this.variants.includes("replace")) {
                    this.replace = false;
                }
            }
            else if (move.startsWith("x")) {
                const mv = move.substring(1);
                this.board.set(mv, this.currplayer);
                this.results.push({type: "capture", where: mv});
                if (this.variants.includes("replace")) {
                    this.replace = true;
                }
            }
            else {
                this.board.set(move, this.currplayer);
                this.results.push({type: "place", where: move});
                if (this.variants.includes("replace")) {
                    this.replace = false;
                }
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

    protected checkEOG(): MorphosGame {
        const prevPlayer: playerid = this.currplayer === 1 ? 2 : 1;
        const graph = this.graph.graph;
        for (const node of [...graph.nodes()]) {
            if (!this.board.has(node) || this.board.get(node)! !== prevPlayer) {
                graph.dropNode(node);
            }
        }

        const [sources, targets] = this.playerLines[prevPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevPlayer];
                        if (this.connPath === undefined || path.length < this.connPath.length) {
                            this.connPath = [...path];
                        }
                    }
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

    public state(): IMorphosState {
        return {
            game: MorphosGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MorphosGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: this.connPath === undefined ? undefined : [...this.connPath],
            replace: this.replace,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const weakRed: RowCol[] = [];
        const weakBlue: RowCol[] = [];
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        if (this.isWeak(cell)) {
                            weakRed.push({row, col});
                        }
                        pieces.push("A");
                    } else {
                        if (this.isWeak(cell)) {
                            weakBlue.push({row, col});
                        }
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");
        const markers: Array<MarkerEdge> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr
        };

        rep.annotations = [];
        // add dots on weak stones
        if (weakRed.length > 0 || weakBlue.length > 0) {
            if (weakRed.length > 0) {
                rep.annotations.push({type: "dots", targets: weakRed as [RowCol, ...RowCol[]], colour: 2});
            }
            if (weakBlue.length > 0) {
                rep.annotations.push({type: "dots", targets: weakBlue as [RowCol, ...RowCol[]], colour: 1});
            }
        }

        // Add annotations
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place" || move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this.connPath !== undefined) {
            const targets: RowCol[] = [];
            for (const cell of this.connPath) {
                const [x,y] = this.algebraic2coords(cell);
                targets.push({row: y, col: x})                ;
            }
            rep.annotations.push({type: "move", strokeWidth: 0.04, targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }
        if (rep.annotations.length === 0) {
            rep.annotations = undefined;
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

    public clone(): MorphosGame {

        return Object.assign(new MorphosGame(), deepclone(this) as MorphosGame);
    }
}
