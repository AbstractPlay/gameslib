import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2;
type Piece = "K" | "Q" | "R" | "B" | "N" | "P";
type CellContents = `${playerid}${Piece}`;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    captureCount: number;
    bloodKingsRisen: boolean;
}

export interface IBloodKingState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}
export class BloodKingGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Blood King Rises",
        uid: "bloodking",
        playercounts: [2],
        version: "20260617",
        description: "apgames:descriptions.bloodking",
        notes: "apgames:notes.bloodking",
        people: [
            {
                type: "designer",
                name: "Morgan B",
            },
        ],
        categories: [
            "goal>checkmate",
            "mechanic>capture",
            "mechanic>move",
            "board>shape>rect",
            "board>connect>rect",
            "components>fairychess",
        ],
        flags: [],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }

    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public captureCount = 0;
    public bloodKingsRisen = false;

    constructor(state?: IBloodKingState | string, variants?: string[]) {
        super();

        if (state === undefined) {
            const board = new Map<string, CellContents>([
                ["a1", "1R"], ["b1", "1N"], ["c1", "1B"], ["d1", "1Q"],
                ["e1", "1K"], ["f1", "1B"], ["g1", "1N"], ["h1", "1R"],
                ["a2", "1P"], ["b2", "1P"], ["c2", "1P"], ["d2", "1P"],
                ["e2", "1P"], ["f2", "1P"], ["g2", "1P"], ["h2", "1P"],

                ["a8", "2R"], ["b8", "2N"], ["c8", "2B"], ["d8", "2Q"],
                ["e8", "2K"], ["f8", "2B"], ["g8", "2N"], ["h8", "2R"],
                ["a7", "2P"], ["b7", "2P"], ["c7", "2P"], ["d7", "2P"],
                ["e7", "2P"], ["f7", "2P"], ["g7", "2P"], ["h7", "2P"],
            ]);

            const fresh: IMoveState = {
                _version: BloodKingGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                captureCount: 0,
                bloodKingsRisen: false,
            };

            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBloodKingState;
            }
            if (state.game !== BloodKingGame.gameinfo.uid) {
                throw new Error(`Blood King Rises cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }

        if (variants !== undefined) {
            this.variants = [...variants];
        }

        this.load();
    }

    public load(idx = -1): BloodKingGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ((idx < 0) || (idx >= this.stack.length)) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.captureCount = state.captureCount;
        this.bloodKingsRisen = state.bloodKingsRisen;
        return this;
    }    private owner(piece: CellContents): playerid {
        return piece[0] === "1" ? 1 : 2;
    }

    private kind(piece: CellContents): Piece {
        return piece[1] as Piece;
    }

    private otherPlayer(player: playerid): playerid {
        return player === 1 ? 2 : 1;
    }

    private isFriendly(cell: string, player: playerid): boolean {
        const piece = this.board.get(cell);
        return piece !== undefined && this.owner(piece) === player;
    }

    private isEnemy(cell: string, player: playerid): boolean {
        const piece = this.board.get(cell);
        return piece !== undefined && this.owner(piece) !== player;
    }

    private findKing(player: playerid): string {
        for (const [cell, piece] of this.board.entries()) {
            if (piece === `${player}K`) {
                return cell;
            }
        }
        throw new Error("Could not find king.");
    }

    private cellOnBoard(cell: string): boolean {
        try {
            BloodKingGame.algebraic2coords(cell);
            return true;
        } catch {
            return false;
        }
    }
        private addIfLegalTarget(moves: string[], from: string, to: string, player: playerid): void {
        if (!this.cellOnBoard(to)) {
            return;
        }
        if (this.isFriendly(to, player)) {
            return;
        }
        const sep = this.board.has(to) ? "x" : "-";
        moves.push(`${from}${sep}${to}`);
    }

    private rayMoves(from: string, directions: Array<[number, number]>, player: playerid): string[] {
        const moves: string[] = [];
        const [x, y] = BloodKingGame.algebraic2coords(from);

        for (const [dx, dy] of directions) {
            let nx = x + dx;
            let ny = y + dy;

            while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
                const to = BloodKingGame.coords2algebraic(nx, ny);

                if (this.isFriendly(to, player)) {
                    break;
                }

                if (this.isEnemy(to, player)) {
                    moves.push(`${from}x${to}`);
                    break;
                }

                moves.push(`${from}-${to}`);
                nx += dx;
                ny += dy;
            }
        }

        return moves;
    }
        private pieceMoves(from: string, player: playerid): string[] {
        const piece = this.board.get(from);
        if (piece === undefined) {
            return [];
        }

        if (this.owner(piece) !== player) {
            return [];
        }

        const kind = this.kind(piece);
        const moves: string[] = [];
        const [x, y] = BloodKingGame.algebraic2coords(from);

        if (kind === "P") {
            const dir = player === 1 ? -1 : 1;
            const startRank = player === 1 ? 6 : 1;

            const oneY = y + dir;
            if (oneY >= 0 && oneY < 8) {
                const one = BloodKingGame.coords2algebraic(x, oneY);
                if (!this.board.has(one)) {
                    moves.push(`${from}-${one}`);

                    const twoY = y + (dir * 2);
                    if (y === startRank && twoY >= 0 && twoY < 8) {
                        const two = BloodKingGame.coords2algebraic(x, twoY);
                        if (!this.board.has(two)) {
                            moves.push(`${from}-${two}`);
                        }
                    }
                }
            }

            for (const dx of [-1, 1]) {
                const cx = x + dx;
                const cy = y + dir;
                if (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
                    const target = BloodKingGame.coords2algebraic(cx, cy);
                    if (this.isEnemy(target, player)) {
                        moves.push(`${from}x${target}`);
                    }
                }
            }
        }

        if (kind === "N") {
            const jumps: Array<[number, number]> = [
                [1, 2], [2, 1], [2, -1], [1, -2],
                [-1, -2], [-2, -1], [-2, 1], [-1, 2],
            ];

            for (const [dx, dy] of jumps) {
                const target = BloodKingGame.coords2algebraic(x + dx, y + dy);
                this.addIfLegalTarget(moves, from, target, player);
            }
        }

        if (kind === "B") {
            return this.rayMoves(from, [[1, 1], [1, -1], [-1, 1], [-1, -1]], player);
        }

        if (kind === "R") {
            return this.rayMoves(from, [[1, 0], [-1, 0], [0, 1], [0, -1]], player);
        }

        if (kind === "Q") {
            return this.rayMoves(from, [
                [1, 0], [-1, 0], [0, 1], [0, -1],
                [1, 1], [1, -1], [-1, 1], [-1, -1],
            ], player);
        }

        if (kind === "K") {
            const steps: Array<[number, number]> = [
                [1, 0], [-1, 0], [0, 1], [0, -1],
                [1, 1], [1, -1], [-1, 1], [-1, -1],
            ];

            for (const [dx, dy] of steps) {
                const target = BloodKingGame.coords2algebraic(x + dx, y + dy);
                this.addIfLegalTarget(moves, from, target, player);
            }

            if (this.bloodKingsRisen) {
                const jumps: Array<[number, number]> = [
                    [1, 2], [2, 1], [2, -1], [1, -2],
                    [-1, -2], [-2, -1], [-2, 1], [-1, 2],
                ];

                for (const [dx, dy] of jumps) {
                    const target = BloodKingGame.coords2algebraic(x + dx, y + dy);
                    this.addIfLegalTarget(moves, from, target, player);
                }
            }
        }

        return moves;
    }
    private attacksSquare(from: string, target: string, player: playerid): boolean {
        const piece = this.board.get(from);
        if (piece === undefined || this.owner(piece) !== player) {
            return false;
        }

        const kind = this.kind(piece);
        const [fx, fy] = BloodKingGame.algebraic2coords(from);
        const [tx, ty] = BloodKingGame.algebraic2coords(target);
        const dx = tx - fx;
        const dy = ty - fy;

        if (kind === "P") {
            const dir = player === 1 ? -1 : 1;
            return dy === dir && Math.abs(dx) === 1;
        }

        if (kind === "N") {
            return (Math.abs(dx) === 1 && Math.abs(dy) === 2) ||
                   (Math.abs(dx) === 2 && Math.abs(dy) === 1);
        }

        if (kind === "K") {
            const kingAttack = Math.max(Math.abs(dx), Math.abs(dy)) === 1;
            const bloodAttack = this.bloodKingsRisen &&
                ((Math.abs(dx) === 1 && Math.abs(dy) === 2) ||
                 (Math.abs(dx) === 2 && Math.abs(dy) === 1));
            return kingAttack || bloodAttack;
        }

        const clearLine = (): boolean => {
            const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
            const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
            let x = fx + stepX;
            let y = fy + stepY;

            while (x !== tx || y !== ty) {
                const cell = BloodKingGame.coords2algebraic(x, y);
                if (this.board.has(cell)) {
                    return false;
                }
                x += stepX;
                y += stepY;
            }

            return true;
        };

        if (kind === "B") {
            return Math.abs(dx) === Math.abs(dy) && clearLine();
        }

        if (kind === "R") {
            return (dx === 0 || dy === 0) && clearLine();
        }

        if (kind === "Q") {
            return ((dx === 0 || dy === 0) || Math.abs(dx) === Math.abs(dy)) && clearLine();
        }

        return false;
    }

    private inCheck(player: playerid): boolean {
        const king = this.findKing(player);
        const enemy = this.otherPlayer(player);

        for (const [cell, piece] of this.board.entries()) {
            if (this.owner(piece) === enemy && this.attacksSquare(cell, king, enemy)) {
                return true;
            }
        }

        return false;
    }
    private moveLeavesKingInCheck(move: string, player: playerid): boolean {
        const match = move.match(/^([a-h][1-8])([-x])([a-h][1-8])$/);
        if (match === null) {
            return true;
        }

        const from = match[1];
        const to = match[3];
        const movingPiece = this.board.get(from);
        const capturedPiece = this.board.get(to);

        if (movingPiece === undefined) {
            return true;
        }

        this.board.delete(from);
        this.board.set(to, movingPiece);

        const stillInCheck = this.inCheck(player);

        this.board.delete(to);
        this.board.set(from, movingPiece);
        if (capturedPiece !== undefined) {
            this.board.set(to, capturedPiece);
        }

        return stillInCheck;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }

        if (player === undefined) {
            player = this.currplayer;
        }

        const allMoves: string[] = [];

        for (const [cell, piece] of this.board.entries()) {
            if (this.owner(piece) === player) {
                allMoves.push(...this.pieceMoves(cell, player));
            }
        }

        return allMoves.filter(m => !this.moveLeavesKingInCheck(m, player));
    }
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = BloodKingGame.coords2algebraic(col, row);

            let newmove = "";
            if (move.length === 0) {
                const clicked = this.board.get(cell);
                if (clicked === undefined || this.owner(clicked) !== this.currplayer) {
                    return { move: "", message: "" } as IClickResult;
                }
                newmove = cell;
            } else {
                const from = move;
                if (from === cell) {
                    return { move: "", message: "" } as IClickResult;
                }

                const sep = this.board.has(cell) ? "x" : "-";
                newmove = `${from}${sep}${cell}`;
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : "";
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move, row, col, piece, emessage: (e as Error).message
                })
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")
        };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = "Select one of your pieces.";
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (/^[a-h][1-8]$/.test(m)) {
            const piece = this.board.get(m);
            if (piece === undefined || this.owner(piece) !== this.currplayer) {
                result.valid = false;
                result.message = "That is not your piece.";
                return result;
            }

            const possible = this.moves().filter(mv => mv.startsWith(m));
            if (possible.length === 0) {
                result.valid = false;
                result.message = "That piece has no legal moves.";
                return result;
            }

            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = "Choose a destination.";
            return result;
        }

        if (!/^[a-h][1-8][-x][a-h][1-8]$/.test(m)) {
            result.valid = false;
            result.message = "Moves should look like e2-e4 or e4xd5.";
            return result;
        }

        if (!this.moves().includes(m)) {
            result.valid = false;
            result.message = "That move is not legal.";
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }
    public move(m: string, { trusted = false } = {}): BloodKingGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        const match = m.match(/^([a-h][1-8])([-x])([a-h][1-8])$/);
        if (match === null) {
            throw new Error("Malformed move.");
        }

        const from = match[1];
        const sep = match[2];
        const to = match[3];

        const movingPiece = this.board.get(from);
        const capturedPiece = this.board.get(to);

        if (movingPiece === undefined) {
            throw new Error("No piece on source square.");
        }

        this.results = [];

        this.board.delete(from);
        this.board.set(to, movingPiece);

        this.results.push({ type: "move", from, to, what: movingPiece });

        if (sep === "x" && capturedPiece !== undefined) {
            this.captureCount++;
            this.results.push({ type: "capture", where: to, what: capturedPiece });

            if (this.captureCount >= 6) {
                this.bloodKingsRisen = true;
            }
        }

        this.lastmove = m;
        this.currplayer = this.otherPlayer(this.currplayer);

        this.checkEOG();
        this.saveState();
        return this;
    }
    protected checkEOG(): BloodKingGame {
        const nextPlayer = this.currplayer;

        if (this.moves(nextPlayer).length === 0) {
            this.gameover = true;

            if (this.inCheck(nextPlayer)) {
                this.winner = [this.otherPlayer(nextPlayer)];
            } else {
                this.winner = [1, 2];
            }
        }

        if (this.gameover) {
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }

        return this;
    }
    public state(): IBloodKingState {
        return {
            game: BloodKingGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BloodKingGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            captureCount: this.captureCount,
            bloodKingsRisen: this.bloodKingsRisen,
        };
    }
    public render(): APRenderRep {
        let pstr = "";

        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }

            const pieces: string[] = [];

            for (let col = 0; col < 8; col++) {
                const cell = BloodKingGame.coords2algebraic(col, row);
                const piece = this.board.get(cell);

                if (piece === undefined) {
                    pieces.push("-");
                } else {
                    pieces.push(piece);
                }
            }

            pstr += pieces.join(",");
        }

        pstr = pstr.replace(/-,-,-,-,-,-,-,-/g, "_");

        const rep: APRenderRep = {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
            },
            legend: {
                "1K": { name: this.bloodKingsRisen ? "chess-king" : "chess-king", colour: 1 },
                "1Q": { name: "chess-queen", colour: 1 },
                "1R": { name: "chess-rook", colour: 1 },
                "1B": { name: "chess-bishop", colour: 1 },
                "1N": { name: "chess-knight", colour: 1 },
                "1P": { name: "chess-pawn", colour: 1 },

                "2K": { name: this.bloodKingsRisen ? "chess-king" : "chess-king", colour: 2 },
                "2Q": { name: "chess-queen", colour: 2 },
                "2R": { name: "chess-rook", colour: 2 },
                "2B": { name: "chess-bishop", colour: 2 },
                "2N": { name: "chess-knight", colour: 2 },
                "2P": { name: "chess-pawn", colour: 2 },
            },
            pieces: pstr,
        };

        if (this.lastmove !== undefined) {
            const match = this.lastmove.match(/^([a-h][1-8])[-x]([a-h][1-8])$/);
            if (match !== null) {
                const from = BloodKingGame.algebraic2coords(match[1]);
                const to = BloodKingGame.algebraic2coords(match[2]);
                rep.annotations = [
                    {
                        type: "move",
                        targets: [
                            { row: from[1], col: from[0] },
                            { row: to[1], col: to[0] },
                        ],
                    },
                ];
            }
        }

        return rep;
    }

    public clone(): BloodKingGame {
        return new BloodKingGame(this.serialize());
    }
}