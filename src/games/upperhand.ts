/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2 | 3;

interface ILooseObj {
    [key: string]: any;
}
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
        dateAdded: "2024-05-05",
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
        categories: ["goal>score>race", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per", "board>3d"],
        flags: ["pie", "scores", "rotate90"],
        displays: [{ uid: "orb-3d" }],
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
    private hideLayer: number|undefined;

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
            let newmove = "";
            if (row === -1 && col === -1) {
                if (piece === undefined) {
                    throw new Error(`A click was registered off the board, but no 'piece' parameter was passed.`);
                }
                if (! piece.startsWith("scroll_newval_")) {
                    throw new Error(`An invalid scroll bar value was returned: ${piece}`);
                }
                // calculate maximum layer (0 indexed)
                const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
                const [,,nstr] = piece.split("_");
                const n = parseInt(nstr, 10);
                if (isNaN(n)) {
                    throw new Error(`Could not parse '${nstr}' into an integer.`);
                }
                if (n > maxLayer) {
                    this.hideLayer = undefined;
                } else if (n < 1) {
                    this.hideLayer = 1;
                } else {
                    this.hideLayer = n;
                }
            } else {
                const cell = this.placeableCell(col, row);
                if (cell === undefined) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.upperhand.CANNOT_PLACE", {move: this.coords2algebraic(col, row)})
                    };
                }
                newmove = cell;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            result.opts = {hideLayer: this.hideLayer};
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
        // If yes, return the cell in the middle of the platform and the owner.
        // Be sure to check for repeated cells returned by this function.
        const [x, y, l] = this.algebraic2coords2(place);
        const autoPlacements: [string, playerid][] = [];
        const piecesLeft = [...this.piecesLeft];
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
            const seen: Set<string> = new Set();
            for (const [cell,] of chain) {
                if (seen.has(cell)) { continue; }
                seen.add(cell);
                newChain.push(...this.platfromCreated(cell));
            }
            chain = newChain;
        }
        if (partial) { return this; }
        this.hideLayer = undefined;

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

    private getPiece(player: number, layer: number, trans = false, orb3d = false): [Glyph, ...Glyph[]]  {
        // Choose max blackness and whiteness.
        // Returns a combined glyphs based on the player colour for a given layer 1 to boardSize.
        // orb_3d: if true, only return pure orb glyphs, for which some people prefer.
        if (orb3d) {
            if (trans) {
                return [{ name: "circle", colour: player, scale: 1.15, opacity: 0.5 }];
            }
            return [{ name: "orb", colour: player, scale: 1.2 }];
        }
        const layers = this.boardSize;
        if (trans) {
            const minOpacity = 0.2;
            const maxOpacity = 0.6;
            const opacity = (maxOpacity - minOpacity) * (layer - 2) / (layers - 2) + minOpacity;
            return [
                { name: "circle", colour: "#FFF", scale: 1.15, opacity: opacity * 0.75 },
                { name: "circle", colour: player, scale: 1.15, opacity },
            ];
        } else {
            const blackness = 0.1;
            const whiteness = 0.5;
            const scaled = (whiteness + blackness) * (layer - 1) / (layers - 1) - blackness;
            if (scaled === 0) {
                return [
                    { name: "piece-borderless", colour: player, scale: 1.15 },
                    { name: "orb", colour: player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            } else {
                const colour = scaled < 0 ? "#000" : "#FFF";
                const opacity = scaled < 0 ? 1 + scaled : 1 - scaled;
                return [
                    { name: "piece-borderless", colour, scale: 1.15 },
                    { name: "piece-borderless", colour: player, scale: 1.15, opacity },
                    { name: "orb", colour: player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            }
        }
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let hideLayer = this.hideLayer;
        if (opts?.hideLayer !== undefined) {
            hideLayer = opts.hideLayer;
        }
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let orb3d = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "orb-3d") {
                orb3d = true;
            }
        }
        // calculate maximum layer (0 indexed)
        const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
        // Build piece string
        let pstr = "";
        const labels: Set<string> = new Set();
        for (let layer = 0; layer <= (hideLayer ?? maxLayer); layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                let pieces: string[] = [];
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        let key;
                        if (contents === 1) {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `X${layer + 1}`;
                            } else {
                                key = `A${layer + 1}`;
                            }
                        } else if (contents === 2) {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Y${layer + 1}`;
                            } else {
                                key = `B${layer + 1}`;
                            }
                        } else {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Z${layer + 1}`;
                            } else {
                                key = `C${layer + 1}`;
                            }
                        }
                        pieces.push(key);
                        labels.add(key);
                    } else {
                        pieces.push("-");
                    }
                }
                // If all elements are "-", replace with "_"
                if (pieces.every(p => p === "-")) {
                    pieces = ["_"];
                }
                pstr += pieces.join(",");
            }
        }

        const legend: ILooseObj = {};
        for (const label of labels) {
            const piece = label[0];
            const layer = parseInt(label.slice(1), 10);
            const player = piece === "A" || piece === "X" ? 1 : piece === "B" || piece === "Y" ? 2 : 3;
            legend[label] = this.getPiece(player, layer, ["X", "Y", "Z"].includes(piece), orb3d);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-stacked",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend,
            pieces: pstr,
        };

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

        rep.areas = [
            {
                type: "scrollBar",
                position: "left",
                min: 0,
                max: maxLayer + 1,
                current: hideLayer !== undefined ? hideLayer : maxLayer + 1,
            }
        ];

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
                                node.push(i18next.t("apresults:EOG.default"));
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
