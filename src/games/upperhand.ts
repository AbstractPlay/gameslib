import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2 | 3;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    piecesLeft: [number, number];
    lastmove?: string;
}

export interface IUpperHandState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class UpperHandGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Upper Hand",
        uid: "upperhand",
        playercounts: [2],
        version: "20240501",
        dateAdded: "2024-05-01",
        // i18next.t("apgames:descriptions.upperhand")
        description: "apgames:descriptions.upperhand",
        urls: ["https://boardgamegeek.com/boardgame/4545/upper-hand"],
        people: [
            {
                type: "designer",
                name: "Margalith Akavya",
            },
        ],
        variants: [
            { uid: "size-7", group: "board" },
            { uid: "size-9", group: "board" },
        ],
        categories: ["goal>score>race", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "pie", "scores", "rotate90"],
    };

    public coords2algebraic(x: number, y: number, boardSize = this.boardSize): string {
        return GameBase.coords2algebraic(x, y, 2 * boardSize - 1);
    }

    public algebraic2coords(cell: string, boardSize = this.boardSize): [number, number] {
        // Remove all numbers from the beginning of the string.
        return GameBase.algebraic2coords(cell.replace(/^\d+/, ""), 2 * boardSize - 1);
    }

    private layerCoords2algebraic(col: number, row: number, layer: number, boardSize = this.boardSize): string {
        // Convert layer coordinates to algebraic.
        // This is the "intuitive" coordinates where sequence of col or row indices are adjacent.
        // Bottom layer is 0, top layer is boardSize - 1.
        // Origin is at the top left corner of the board as usual.
        if (layer >= boardSize) { throw new Error(`Layer index ${layer} is out of bounds for board size ${boardSize}`); }
        if (col < 0 || row < 0 || col > boardSize - layer || row > boardSize - layer) { throw new Error(`Coordinates (${col},${row}) are out of bounds for layer ${layer}`); }
        const l = layer + 1;
        const x = 2 * col + layer;
        const y = 2 * row + layer;
        return `${l}${this.coords2algebraic(x, y, boardSize)}`;
    }

    private algebraicToPosition(cell: string): [number, number] {
        // Convert algebraic coordinates to position on the board for annotations.
        const [x, y, l] = this.algebraic2coords2(cell);
        let row = (y - l) / 2;
        for (let i = 0; i < l; i++) {
            row += this.boardSize - i;
        }
        return [(x - l) / 2, row];
    }

    private coords2algebraic2(x: number, y: number, layer: number): string {
        // The same as coords2algebraic, but with concatenated layer index.
        return `${layer + 1}${this.coords2algebraic(x, y)}`;
    }

    private algebraic2coords2(cell: string): [number, number, number] {
        // The same as algebraic2coords, but also return the layer.
        const [l, coords] = cell.split(/(?<=^\d)/);
        const layer = parseInt(l, 10) - 1;
        const [x, y] = this.algebraic2coords(coords);
        return [x, y, layer];
    }

    private placeableCell(i: number, j: number): string | undefined {
        // Get the highest supported layer for a cell.
        // If that cell is not placeable, return undefined.
        if (i % 2 !== j % 2) { return undefined; }
        let layer = i % 2 ? 1 : 0;
        while (layer < this.boardSize) {
            const cell = `${layer + 1}${this.coords2algebraic(i, j)}`
            if (this.board.has(cell)) {
                layer += 2;
                continue;
            }
            if (layer > 0) {
                if (i < layer || j < layer || i >= 2 * this.boardSize - layer || j >= 2 * this.boardSize - layer) { return undefined; }
                // Check the four cells below the currentone.
                if (!this.board.has(this.coords2algebraic2(i - 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i - 1, j + 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j + 1, layer - 1))) { return undefined; }
            }
            return cell;
        }
        return undefined;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public piecesLeft: [number, number] = [999, 999];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;

    constructor(state?: IUpperHandState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const boardSize = this.getBoardSize();
            const board = new Map([[this.getCentre(boardSize), 3 as playerid]]);
            const piecesLeft = this.initialPieces(boardSize);
            const fresh: IMoveState = {
                _version: UpperHandGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                piecesLeft,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IUpperHandState;
            }
            if (state.game !== UpperHandGame.gameinfo.uid) {
                throw new Error(`The UpperHanUpperHand process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): UpperHandGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.piecesLeft = [...state.piecesLeft];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private initialPieces(boardSize: number): [number, number] {
        let totalPieces = 0;
        for (let i = 0; i < boardSize; i++) {
            totalPieces += (i + 1) ** 2;
        }
        const eachPieces = Math.floor(totalPieces / 2);
        return [eachPieces, totalPieces % 2 ? eachPieces : eachPieces - 1];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
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

    private getCentre(boardSize: number): string {
        // Get the centre cell of the board.
        return this.layerCoords2algebraic((boardSize - 1) / 2, (boardSize - 1) / 2, 0, boardSize);
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    moves.push(cell);
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
            const cell = this.placeableCell(col, row);
            if (cell === undefined) {
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.upperhand.CANNOT_PLACE", {move: this.coords2algebraic(col, row)})
                };
            }
            let newmove = "";
            newmove = cell;
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.upperhand.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // valid cell
        try {
            const [x, y] = this.algebraic2coords(m);
            if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }
        if (!this.moves().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.upperhand.CANNOT_PLACE", {move: m});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private checkPlatformMajority(x: number, y: number, l: number): playerid | undefined {
        // Check if there is a platform and is a majority owner of the 4 cells
        // with reference to the top left corner of the cell.
        const counts = [0, 0];
        for (let i = x; i < x + 4; i += 2) {
            for (let j = y; j < y + 4; j += 2) {
                const c = this.coords2algebraic2(i, j, l);
                if (this.board.has(c)) {
                    if (this.board.get(c) === 1) {
                        counts[0]++;
                    } else if (this.board.get(c) === 2) {
                        counts[1]++;
                    }
                } else {
                    return undefined;
                }
            }
        }
        if (counts[0] > 2) { return 1; }
        if (counts[1] > 2) { return 2; }
        return undefined;
    }

    private platfromCreated(place: string): [string, playerid][] {
        // Check that a 2x2 platform is created and if there is a majority owner.
        // If yes, return the cell in the middel of the platform and the owner.
        // Be sure to check for repeated cells returned by this function.
        const [x, y, l] = this.algebraic2coords2(place);
        const autoPlacements: [string, playerid][] = [];
        const piecesLeft = [...this.piecesLeft];
        if (piecesLeft[0] === 0 || piecesLeft[1] === 0) { return autoPlacements; }
        for (const [x1, y1] of [[x - 2, y - 2], [x - 2, y], [x, y - 2], [x, y]] as [number, number][]) {
            if (x1 < l || y1 < l || x1 >= 2 * this.boardSize - l - 1 || y1 >= 2 * this.boardSize - l - 1) { continue; }
            const majority = this.checkPlatformMajority(x1, y1, l);
            if (majority !== undefined) {
                if (piecesLeft[majority - 1] === 0) { continue; }
                const cell = this.coords2algebraic2(x1 + 1, y1 + 1, l + 1);
                autoPlacements.push([cell, majority]);
                piecesLeft[majority - 1]--;
            }
        }
        return autoPlacements;
    }

    public move(m: string, {partial = false, trusted = false} = {}): UpperHandGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);
        this.piecesLeft[this.currplayer - 1]--;
        let chain = this.platfromCreated(m);
        while (chain.length > 0) {
            const newChain = [];
            for (const [cell, player] of chain) {
                if (this.board.has(cell)) { continue; }
                if (this.piecesLeft[player - 1] === 0) { continue; }
                this.board.set(cell, player);
                this.results.push({ type: "place", where: cell, who: player, what: "chain" });
                this.piecesLeft[player - 1]--;
            }
            for (const [cell,] of chain) {
                newChain.push(...this.platfromCreated(cell));
            }
            chain = newChain;
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): UpperHandGame {
        if (this.piecesLeft[0] === 0) {
            this.winner.push(1);
        }
        if (this.piecesLeft[1] === 0) {
            this.winner.push(2);
        }
        if (this.winner.length > 0) {
            this.gameover = true;
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IUpperHandState {
        return {
            game: UpperHandGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: UpperHandGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            piecesLeft: [...this.piecesLeft],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let layer = 0; layer < this.boardSize; layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        if (contents === 1) {
                            pstr += "A";
                        } else if (contents === 2) {
                            pstr += "B";
                        } else {
                            pstr += "C";
                        }
                    } else {
                        pstr += "-";
                    }
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-stacked",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: { name: "piece", player: 1, scale: 1.15 },
                B: { name: "piece", player: 2, scale: 1.15 },
                C: { name: "piece", player: 3, scale: 1.15 },
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraicToPosition(move.where!);
                    if (move.what === "chain") {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }], opacity: 0.7 });
                    } else {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                }
            }
        }
        return rep;
    }

    public getPlayerPieces(player: number): number {
        return this.piecesLeft[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        return status;
    }

    public chatLog(players: string[]): string[][] {
        // Use `chatLog` to determine if capture is self-capture.
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "place":
                                if (r.what === "chain") {
                                    const whose = r.who === this.currplayer ? name : players.filter(p => p !== name)[0];
                                    node.push(i18next.t("apresults:PLACE.upperhand_chain", {whose, where: r.where }));
                                } else {
                                    node.push(i18next.t("apresults:PLACE.ball", {player: name, where: r.where }));
                                }
                                break;
                            case "eog":
                                node.push(i18next.t("apresults:EOG"));
                                break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "timeout":
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:TIMEOUT", {player: tname}));
                                break;
                            case "gameabandoned":
                                node.push(i18next.t("apresults:ABANDONED"));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): UpperHandGame {
        return new UpperHandGame(this.serialize());
    }
}