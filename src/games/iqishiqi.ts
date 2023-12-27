/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { HexTriGraph } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2|3;
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW"
const allDirections = ["NE","E","SE","SW","W","NW"];
const oppositeDirection: Map<directions, directions> = new Map([
    ["NE", "SW"],
    ["E", "W"],
    ["SE", "NW"],
    ["SW", "NE"],
    ["W", "E"],
    ["NW", "SE"],
]);

// Because I'm lazy to figure out how to do this programatically...
const edgeSW = new Set(["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"]);
const edgeS = new Set(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
const edgeSE = new Set(["a8", "b9", "c10", "d11", "e12", "f13", "g14", "h15"]);
const edgeNE = new Set(["h15", "i14", "j13", "k12", "l11", "m10", "n9", "o8"]);
const edgeN = new Set(["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"]);
const edgeNW = new Set(["h1", "i1", "j1", "k1", "l1", "m1", "n1", "o1"]);
const edges2p = [[edgeN, edgeSW, edgeSE], [edgeS, edgeNW, edgeNE]];
const edges3p = [[edgeN, edgeS], [edgeNE, edgeSW], [edgeSE, edgeNW]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Set<string>;
    lastmove?: string;
    ball: string;
}

export interface IIqishiqiState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class IqishiqiGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Iqishiqi",
        uid: "iqishiqi",
        playercounts: [2,3],
        version: "20231227",
        // i18next.t("apgames:descriptions.iqishiqi")
        description: "apgames:descriptions.iqishiqi",
        urls: ["https://boardgamegeek.com/boardgame/172250/iqishiqi"],
        people: [
            {
                type: "designer",
                name: "João Pedro Neto",
            },
            {
                type: "designer",
                name: "Bill Taylor",
            }
        ],
        variants: [],
        flags: ["experimental", "multistep"]
    };

    public numplayers!: number;
    public currplayer!: playerid;
    public board!: Set<string>;
    public graph!: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public ball!: string;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private edges: Set<string>[][];

    constructor(state: number | IIqishiqiState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            this.numplayers = state;
            const fresh: IMoveState = {
                _version: IqishiqiGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Set(),
                ball: "h8",
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IIqishiqiState;
            }
            if (state.game !== IqishiqiGame.gameinfo.uid) {
                throw new Error(`The Iqishiqi game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.variants = state.variants;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = new HexTriGraph(8, 15);
        this.edges = this.numplayers === 2 ? edges2p : edges3p;
    }

    public load(idx = -1): IqishiqiGame {
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
        this.board = new Set(state.board);
        this.lastmove = state.lastmove;
        this.ball = state.ball;
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        for (const cell of this.graph.listCells(false)) {
            if (this.board.has(cell as string)) {
                continue;
            }
            const group = this.getGroup(cell as string);
            const unblockedBearings = this.getBearingsFromPiecesInGroup(group).filter(b => this.checkBlocked(b, group.size));
            for (const direction of unblockedBearings) {
                const toLoc = this.moveHex(...this.graph.algebraic2coords(this.ball), direction, group.size);
                if (toLoc !== undefined) {
                    moves.push(`${cell as string}/${this.graph.coords2algebraic(...toLoc)}`);
                }
            }
        }
        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";
            move = move.toLowerCase();
            move = move.replace(/\s+/g, "");

            const [place, to] = move.split("/");
            if (to !== undefined) {
                newmove = move;
            } else {
                if (move.length === 0) {
                    const group = this.getGroup(cell);
                    const bearingsFromPiecesInGroups = this.getBearingsFromPiecesInGroup(group).filter(b => this.checkBlocked(b, group.size));
                    if (bearingsFromPiecesInGroups.length !== 1) {
                        newmove = `${cell}`
                    } else {
                        const ballCoords = this.graph.algebraic2coords(this.ball);
                        const toLoc = this.moveHex(...ballCoords, bearingsFromPiecesInGroups[0], group.size);
                        if (toLoc === undefined) {
                            newmove = `${cell}`
                        } else {
                            newmove = `${cell}/${this.graph.coords2algebraic(...toLoc)}`
                        }
                    }
                } else {
                    newmove = `${place}/${cell}`
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
            result.message = i18next.t("apgames:validation.iqishiqi.INITIAL_INSTRUCTIONS")
            return result;
        }

        // cell exists
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const [place, to] = m.split("/");
        let tryCell;
        try {
            for (const cell of [place, to]) {
                if (cell === undefined) {
                    continue;
                }
                tryCell = cell;
                this.graph.algebraic2coords(tryCell)
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {tryCell})
            return result;
        }

        // space is empty
        if (this.board.has(place) || this.ball === place) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: place});
            return result;
        }

        // check LOS from group at place to ball
        const group = this.getGroup(place);
        const bearingsFromPiecesInGroups = this.getBearingsFromPiecesInGroup(group);
        if (bearingsFromPiecesInGroups.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.iqishiqi.NOLOS", {place, from: this.ball});
            return result;
        }
        // check if blocked
        const unblockedBearings = bearingsFromPiecesInGroups.filter(b => this.checkBlocked(b, group.size));
        if (unblockedBearings.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.iqishiqi.BLOCKED", {place, spaces: group.size});
            return result;
        }
        if (to === undefined) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.iqishiqi.NEED_DESTINATION");
            return result;
        } else {
            for (const bearing of unblockedBearings) {
                const toLoc = this.moveHex(...this.graph.algebraic2coords(this.ball), bearing, group.size);
                if (toLoc !== undefined && to === this.graph.coords2algebraic(...toLoc)) {
                    // Looks good
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.iqishiqi.INVALID_DESTINATION", {to, from: this.ball , place});
            return result;
        }
    }

    private getGroup(start: string): Set<string> {
        // Get group of pieces formed from placement at `start`.
        const seen: Set<string> = new Set();
        const todo: string[] = [start]
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) {
                continue;
            }
            seen.add(cell);
            const neighbours = this.graph.neighbours(cell);
            for (const n of neighbours) {
                if (this.board.has(n)) {
                    todo.push(n);
                }
            }
        }
        return seen;
    }

    private moveHex(x: number, y: number, dir: directions, dist = 1): [number, number] | undefined {
        // Because `HexTriGraph.move` does not work properly when `dist > 1` at the moment.
        const ray = this.graph.ray(x, y, dir);
        if (ray.length >= dist) {
            return ray[dist - 1];
        }
        return undefined;
    }

    private checkBlocked(direction: directions, step: number): boolean {
        // Check if the path of ball is blocked by white stones
        // in the direction of `direction` for `step` steps.
        // Use with `getBearingsFromPiecesInGroup` as filter for valid moves.
        let countDown = step;
        for (
                const cell of this.graph
                .ray(...this.graph.algebraic2coords(this.ball), direction)
                .map(c => this.graph.coords2algebraic(...c))
            ) {
            if (countDown === 0) { break; }
            if (this.board.has(cell)) {
                return false;
            }
            countDown -= 1;
        }
        return true;
    }

    private getBearingsFromPiecesInGroup(fromGroup: Set<string>): directions[] {
        // Get the directions the ball can move from the group of stones `fromGroup`.
        const toCoords = this.graph.algebraic2coords(this.ball);
        const out: directions[] = [];
        for (const direction of allDirections){
            for (const cell of this.graph.ray(...toCoords, direction as directions).map(c => this.graph.coords2algebraic(...c))) {
                if (fromGroup.has(cell)) {
                    out.push(oppositeDirection.get(direction as directions)!);
                    break;
                } else if (this.board.has(cell)) { break; }
            }
        }
        return out;
    }

    public move(m: string, {partial = false, trusted = false} = {}): IqishiqiGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid || !partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        const [place, to] = m.split("/");
        this.board.add(place);
        this.results = [{type: "place", where: place}]
        if (to !== undefined) {
            this.results.push({type: "move", from: this.ball, to});
            this.ball = to;
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = (this.currplayer % this.numplayers + 1) as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private mod(n: number, m: number): number {
        // JS uses remainder instead of modulo so I have to code this function myself.
        return ((n % m) + m) % m;
    }

    protected checkEOG(): IqishiqiGame {
        this.gameover = false;
        const previousPlayer = (this.mod(this.currplayer - 2, this.numplayers) + 1) as playerid;
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [previousPlayer];
        } else {
            const winners = Array(this.numplayers).fill(false);
            for (let i = 0; i < this.numplayers; i++) {
                for (const edge of this.edges[i]) {
                    if (edge.has(this.ball)) {
                        winners[i] = true;
                        break;
                    }
                }
            }
            const winnersIndices = [...winners.keys()].filter(i => winners[i])
            if (winnersIndices.length === 1) {
                this.gameover = true;
                this.winner = [(winnersIndices[0] + 1) as playerid];
            } else if (winnersIndices.length === 2) {
                this.gameover = true;
                if (winnersIndices.includes(previousPlayer - 1)) {
                    this.winner = [previousPlayer]
                } else {
                    this.winner = [this.currplayer]
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

    public state(): IIqishiqiState {
        return {
            game: IqishiqiGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: IqishiqiGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Set(this.board),
            ball: this.ball,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (const cells of this.graph.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of cells) {
                if (this.ball === cell) {
                    pieces.push("B");
                } else if (this.board.has(cell)) {
                    pieces.push("A");
                } else {
                    pieces.push("-");
                }
            }
            // if all pieces are "-", replace with " "
            if (pieces.every(p => p === "-")) {
                pieces = ["_"]
            }
            pstr += pieces.join("");
        }

        // build legend based on number of players
        const rep: APRenderRep =  {
            renderer: "default",
            board: {
                style: "hex-of-hex",
                minWidth: 8,
                maxWidth: 15,
                markers: this.numplayers === 2 ? [
                    { type: "edge", edge: "N", colour: 1 },
                    { type: "edge", edge: "SW", colour: 1 },
                    { type: "edge", edge: "SE", colour: 1 },
                    { type: "edge", edge: "S", colour: 2 },
                    { type: "edge", edge: "NW", colour: 2 },
                    { type: "edge", edge: "NE", colour: 2 },
                ] : [
                    { type: "edge", edge: "N", colour: 1 },
                    { type: "edge", edge: "S", colour: 1 },
                    { type: "edge", edge: "NE", colour: 2 },
                    { type: "edge", edge: "SW", colour: 2 },
                    { type: "edge", edge: "SE", colour: 3 },
                    { type: "edge", edge: "NW", colour: 3 },
                ],
              },
            legend: {
                A: {
                    name: "piece",
                    colour: "#FFF",
                },
                B: {
                    name: "sphere-spiral",
                    colour: "#666",
                },
            },
            pieces: pstr,
        };

        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [toX, toY] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
        }
        if (this.results.length === 1) {
            const points = [];
            const move = this.results[0]
            if (move.type === "place") {
                const group = this.getGroup(move.where!);
                const bearingsFromPiecesInGroups = this.getBearingsFromPiecesInGroup(group).filter(b => this.checkBlocked(b, group.size));
                const ballCoords = this.graph.algebraic2coords(this.ball);
                for (const direction of bearingsFromPiecesInGroups) {
                    const toLoc = this.moveHex(...ballCoords, direction, group.size);
                    points.push({row: toLoc![1], col: toLoc![0]});
                }
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.iqishiqi", {count: parseInt(r.what!, 10), player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.iqishiqi", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        return super.status();
    }

    public clone(): IqishiqiGame {
        return new IqishiqiGame(this.serialize());
    }
}
