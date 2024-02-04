import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import type { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Piece } from "./fightopia/piece";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Piece[];
    lastmove?: string;
};

export interface IFightopiaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FightopiaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Fightopia",
        uid: "fightopia",
        playercounts: [2],
        version: "20240203",
        // i18next.t("apgames:descriptions.fightopia")
        description: "apgames:descriptions.fightopia",
        urls: ["https://static1.squarespace.com/static/5e1ce8815cb76d3000d347f2/t/650f2c8b474f371e5dee3168/1695493264900/Fightopia2Pages.pdf"],
        people: [
            {
                type: "designer",
                name: "James Ernest",
            },
            {
                type: "designer",
                name: "Mike Selinker"
            }
        ],
        flags: ["experimental", "perspective", "pie"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Piece[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IFightopiaState | string) {
        super();
        if (state === undefined) {
            const board: Piece[] = [
                new Piece({owner: 2, tlx: 3, tly: 0, height: 2, width: 2}),
                new Piece({owner: 2, tlx: 0, tly: 0, height: 2}),
                new Piece({owner: 2, tlx: 7, tly: 0, height: 2}),
                new Piece({owner: 2, tlx: 1, tly: 0}),
                new Piece({owner: 2, tlx: 2, tly: 0}),
                new Piece({owner: 2, tlx: 2, tly: 1}),
                new Piece({owner: 2, tlx: 2, tly: 2}),
                new Piece({owner: 2, tlx: 3, tly: 2}),
                new Piece({owner: 2, tlx: 4, tly: 2}),
                new Piece({owner: 2, tlx: 5, tly: 2}),
                new Piece({owner: 2, tlx: 5, tly: 1}),
                new Piece({owner: 2, tlx: 5, tly: 0}),
                new Piece({owner: 2, tlx: 6, tly: 0}),

                new Piece({owner: 1, tlx: 3, tly: 6, height: 2, width: 2}),
                new Piece({owner: 1, tlx: 0, tly: 6, height: 2}),
                new Piece({owner: 1, tlx: 7, tly: 6, height: 2}),
                new Piece({owner: 1, tlx: 1, tly: 7}),
                new Piece({owner: 1, tlx: 2, tly: 7}),
                new Piece({owner: 1, tlx: 2, tly: 6}),
                new Piece({owner: 1, tlx: 2, tly: 5}),
                new Piece({owner: 1, tlx: 3, tly: 5}),
                new Piece({owner: 1, tlx: 4, tly: 5}),
                new Piece({owner: 1, tlx: 5, tly: 5}),
                new Piece({owner: 1, tlx: 5, tly: 6}),
                new Piece({owner: 1, tlx: 5, tly: 7}),
                new Piece({owner: 1, tlx: 6, tly: 7}),
            ];
            const fresh: IMoveState = {
                _version: FightopiaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFightopiaState;
            }
            if (state.game !== FightopiaGame.gameinfo.uid) {
                throw new Error(`The Fightopia engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FightopiaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(obj => new Piece(obj))];
        this.lastmove = state.lastmove;
        return this;
    }

    private isEmpty(x: number, y: number): boolean {
        const contains = this.board.filter(p => p.includes(x, y));
        if (contains.length > 0) {
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

        // pawns
        for (const pawn of this.board.filter(p => p.size === 1 && p.owner === player)) {
            const from = FightopiaGame.coords2algebraic(pawn.tlx, pawn.tly);
            for (const [nx, ny] of grid.adjacencies(pawn.tlx, pawn.tly, true)) {
                const to = FightopiaGame.coords2algebraic(nx, ny);
                if (this.board.filter(p => p.includes(nx, ny)).length === 0) {
                    moves.push(`${from}-${to}`);
                }
            }
        }

        // giants
        for (const giant of this.board.filter(p => p.size === 4 && p.owner === player)) {
            const from = FightopiaGame.coords2algebraic(giant.tlx, giant.tly);
            // moves
            const others = this.board.filter(p => p.id !== giant.id);
            for (const [nx, ny] of grid.adjacencies(giant.tlx, giant.tly, true)) {
                const to = FightopiaGame.coords2algebraic(nx, ny);
                const moved = giant.clone();
                moved.tlx = nx;
                moved.tly = ny;
                let isClear = true;
                for (const [mx, my] of moved.cells()) {
                    if (! grid.inBounds(mx, my) || others.filter(p => p.includes(mx, my)).length > 0) {
                        isClear = false;
                        break;
                    }
                }
                if (isClear) {
                    moves.push(`${from}-${to}`);
                }
            }

            // captures
            const contained = new Set<string>(giant.cells().map(pt => FightopiaGame.coords2algebraic(...pt)));
            const perimeterOrth = new Set<string>();
            for (const [x,y] of giant.cells()) {
                const adj = grid.adjacencies(x, y, false).map(pt => FightopiaGame.coords2algebraic(...pt)).filter(cell => ! contained.has(cell));
                for (const cell of adj) {
                    perimeterOrth.add(cell);
                }
            }
            for (const oppTank of this.board.filter(p => p.size === 2 && p.owner !== player)) {
                let isAdj = false;
                for (const pt of oppTank.cells()) {
                    if (perimeterOrth.has(FightopiaGame.coords2algebraic(...pt))) {
                        isAdj = true;
                        break;
                    }
                }
                if (isAdj) {
                    const oppCell = FightopiaGame.coords2algebraic(oppTank.tlx, oppTank.tly);
                    moves.push(`x${oppCell}`);
                }
            }
        }

        // tanks
        for (const tank of this.board.filter(p => p.size === 2 && p.owner === player)) {
            const tlCell = FightopiaGame.coords2algebraic(tank.tlx, tank.tly);
            let otherCell: string;
            let otherX: number;
            let otherY: number;
            if (tank.width === 2) {
                otherX = tank.tlx + 1;
                otherY = tank.tly;
                otherCell = FightopiaGame.coords2algebraic(otherX, otherY);
            } else {
                otherX = tank.tlx;
                otherY = tank.tly + 1;
                otherCell = FightopiaGame.coords2algebraic(otherX, otherY);
            }
            const facings: [string,"N"|"S"|"E"|"W"][] = [];
            if (tank.facing === "NS") {
                facings.push([tlCell, "N"]);
                facings.push([otherCell, "S"]);
            } else if (tank.facing === "EW") {
                facings.push([tlCell, "W"]);
                facings.push([otherCell, "E"]);
            }

            // move
            for (const [from, dir] of facings) {
                const ray = grid.ray(...FightopiaGame.algebraic2coords(from), dir).slice(0, 2);
                for (const [nx,ny] of ray) {
                    if (this.isEmpty(nx, ny)) {
                        const to = FightopiaGame.coords2algebraic(nx, ny);
                        moves.push(`${from}-${to}`);
                    } else {
                        break;
                    }
                }
            }
            // capture
            for (const [from, dir] of facings) {
                const ray = grid.ray(...FightopiaGame.algebraic2coords(from), dir);
                for (const [nx,ny] of ray) {
                    if (! this.isEmpty(nx,ny)) {
                        const piece = this.board.filter(p => p.includes(nx,ny))[0];
                        if (piece.size === 1 && piece.owner !== player) {
                            moves.push(`x${FightopiaGame.coords2algebraic(nx,ny)}`);
                        }
                        break;
                    }
                }
            }
            // pivot
            if (tank.facing === "NS") {
                let newx: number; let newy: number;
                // tl >
                newx = tank.tlx + 1;
                newy = tank.tly + 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${tlCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
                // tl <
                newx = tank.tlx - 1;
                newy = tank.tly + 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${tlCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
                // other >
                newx = otherX + 1;
                newy = otherY - 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${otherCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
                // other <
                newx = otherX - 1;
                newy = otherY - 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${otherCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
            } else if (tank.facing === "EW") {
                let newx: number; let newy: number;
                // tl ^
                newx = tank.tlx + 1;
                newy = tank.tly - 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${tlCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
                // tl v
                newx = tank.tlx + 1;
                newy = tank.tly + 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${tlCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
                // other ^
                newx = otherX - 1;
                newy = otherY - 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${otherCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
                // other v
                newx = otherX - 1;
                newy = otherY + 1;
                if (grid.inBounds(newx, newy) && this.isEmpty(newx, newy)) {
                    moves.push(`${otherCell}-${FightopiaGame.coords2algebraic(newx, newy)}`);
                }
            }
        }

        return moves.sort();
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = FightopiaGame.coords2algebraic(col, row);
            const pieces = this.board.filter(p => p.includes(col, row));
            let selected: Piece|undefined;
            if (pieces.length > 0) {
                selected = pieces[0];
            }
            let newmove = "";
            if (move.length === 0) {
                // if you selected your own piece, it's movement
                if (selected !== undefined && selected.owner === this.currplayer) {
                    // if it's a tank, which end you clicked on matters
                    if (selected.size === 2) {
                        newmove = cell;
                    }
                    // otherwise, just go with TL
                    else {
                        newmove = FightopiaGame.coords2algebraic(selected.tlx, selected.tly);
                    }
                }
                // otherwise it has to be capture
                else if (selected !== undefined && selected.owner !== this.currplayer) {
                    // whether pawn or tank, capture the TL corner
                    newmove = "x" + FightopiaGame.coords2algebraic(selected.tlx, selected.tly);
                }
                // otherwise ignore
                else {
                    return {move: "", message: i18next.t("apgames:validation.fightopia.INITIAL_INSTRUCTIONS")} as IClickResult;
                }
            } else {
                // only option is movement, so must be empty
                if (selected === undefined) {
                    newmove = `${move}-${cell}`;
                }
                // otherwise ignore
                else {
                    return {move: "", message: i18next.t("apgames:validation.fightopia.INITIAL_INSTRUCTIONS")} as IClickResult;
                }
            }

            // autocomplete if possible
            const matches = this.moves().filter(m => m.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
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

    /**
     * Relies heavily on the list of moves to avoid duplicating the logic.
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.fightopia.INITIAL_INSTRUCTIONS")
            return result;
        }

        // Captures first
        if (m.startsWith("x")) {
            const cell = m.slice(1);
            // valid cell
            try {
                FightopiaGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // eslint-disable-next-line @typescript-eslint/no-shadow
            let selected: Piece|undefined;
            const [capX, capY] = FightopiaGame.algebraic2coords(cell);
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const pieces = this.board.filter(p => p.includes(capX, capY));
            if (pieces.length > 0) {
                selected = pieces[0];
            }

            // cell has a piece
            if (selected === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                return result;
            }

            // belongs to enemy
            if (selected.owner === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // if pawn, is in range of enemy tank
            if (selected.size === 1) {
                if (! allMoves.includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fightopia.BAD_CAPTURE", {context: "pawn"});
                    return result;
                }
            }
            // if tank, is touching enemy giant
            else if (selected.size === 2) {
                if (! allMoves.includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fightopia.BAD_CAPTURE", {context: "tank"});
                    return result;
                }
            }
            // otherwise error
            else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fightopia.INVULNERABLE");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // partials first
        if (! m.includes("-")) {
            // valid cell
            let selX: number; let selY: number;
            try {
                [selX, selY] = FightopiaGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // eslint-disable-next-line @typescript-eslint/no-shadow
            let selected: Piece|undefined;
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const pieces = this.board.filter(p => p.includes(selX, selY));
            if (pieces.length > 0) {
                selected = pieces[0];
            }

            // cell has a piece
            if (selected === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // that piece belongs to you
            if (selected.owner !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // at least one move possible
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fightopia.INVALID_PARTIAL");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.fightopia.PARTIAL");
            return result;
        }

        // full moves
        const [from, to] = m.split("-");
        // cells valid
        for (const cell of [from, to]) {
            try {
                FightopiaGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
        }

        const [fx, fy] = FightopiaGame.algebraic2coords(from);
        const [tx, ty] = FightopiaGame.algebraic2coords(to);
        let selected: Piece|undefined;
        const pieces = this.board.filter(p => p.includes(fx, fy));
        if (pieces.length > 0) {
            selected = pieces[0];
        }

        // cell has a piece
        if (selected === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
            return result;
        }
        // that piece belongs to you
        if (selected.owner !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // destination is empty (unless giant)
        if (selected.size !== 4 && ! this.isEmpty(tx, ty)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
            return result;
        }

        // move is valid
        if (! allMoves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): FightopiaGame {
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
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        if (m.startsWith("x")) {
            const cell = m.slice(1);
            const [capX, capY] = FightopiaGame.algebraic2coords(cell);
            // find captured piece
            const idx = this.board.findIndex(p => p.includes(capX, capY));
            if (idx === -1) {
                throw new Error(`Attempting to capture a nonexistent piece at ${cell}`);
            }
            // remove piece
            const captured = this.board.splice(idx, 1);
            // annotate it
            for (const [col, row] of captured[0].cells()) {
                this.results.push({type: "capture", where: FightopiaGame.coords2algebraic(col, row), what: captured[0].size.toString()});
            }
        } else {
            const [from, to] = m.split("-");
            const [fx, fy] = FightopiaGame.algebraic2coords(from);
            const [tx, ty] = FightopiaGame.algebraic2coords(to);
            let selected: Piece|undefined;
            const pieces = this.board.filter(p => p.includes(fx, fy));
            if (pieces.length > 0) {
                selected = pieces[0];
            }
            if (selected === undefined) {
                throw new Error(`Could not find a piece to move at ${from}`);
            }
            let how: "pivot"|undefined;
            // if it's a pawn or giant, from is the top-left corner
            if (selected.size !== 2) {
                selected.tlx = tx;
                selected.tly = ty;
            }
            // otherwise, get finicky
            else {
                // it's a pivot if from and to coords are diagonal to each other
                if (fx !== tx && fy !== ty) {
                    how = "pivot";
                    // new TL is the minimum of current TL and to, depending on axis
                    if (selected.facing === "NS") {
                        selected.tlx = Math.min(selected.tlx, tx);
                        selected.tly = ty;
                    } else if (selected.facing === "EW") {
                        selected.tlx = tx;
                        selected.tly = Math.min(selected.tly, ty);
                    }
                    // swap the facing
                    selected.rotate();
                }
                // otherwise, it's simple movement
                else {
                    // if from and TL are the same, just move
                    if (selected.tlx === fx && selected.tly === fy) {
                        selected.tlx = tx;
                        selected.tly = ty;
                    }
                    // otherwise, move based on facing
                    else {
                        if (selected.facing === "NS") {
                            selected.tly = ty - 1;
                        } else if (selected.facing === "EW") {
                            selected.tlx = tx - 1;
                        }
                    }
                }
            }
            this.results.push({type: "move", from, to, what: selected.size.toString(), how});
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

    protected checkEOG(): FightopiaGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        // if prevPlayer's giant is on the far row
        let goal = 0;
        if (prevPlayer === 2) {
            goal = 7;
        }
        const giant = this.board.find(p => p.size === 4 && p.owner === prevPlayer);
        if (giant === undefined) {
            throw new Error(`Could not find a giant for player ${prevPlayer}`);
        }
        for (const [,y] of giant.cells()) {
            if (y === goal) {
                this.gameover = true;
                this.winner = [prevPlayer];
                break;
            }
        }

        // otherwise, if current player has no tanks, prevPlayer wins
        if (! this.gameover) {
            const tanks = this.board.filter(p => p.size === 2 && p.owner === this.currplayer);
            if (tanks.length === 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    public state(): IFightopiaState {
        return {
            game: FightopiaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FightopiaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: [...this.board.map(obj => obj.clone())],
        };
    }

    public render(): APRenderRep {
        // Build rep
        const rep: APRenderRep =  {
            renderer: "multicell-square",
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
                markers: [
                    {
                        type: "edge",
                        colour: 1,
                        edge: "S",
                    },
                    {
                        type: "edge",
                        colour: 2,
                        edge: "N",
                    },
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                }
            },
            pieces: this.board.map(p => p.render())
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = FightopiaGame.algebraic2coords(move.from);
                    const [toX, toY] = FightopiaGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = FightopiaGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(r.how !== undefined ?
                    i18next.t("apresults:MOVE.fightopia", {context: "pivot", player, from: r.from, to: r.to}) :
                    i18next.t("apresults:MOVE.fightopia", {context: r.what, player, from: r.from, to: r.to})
                );
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.fightopia", {context: r.what, player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): FightopiaGame {
        return new FightopiaGame(this.serialize());
    }
}
