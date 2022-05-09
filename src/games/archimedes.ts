import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
const playerHomes = ["a1", "h8"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IArchimedesState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ArchimedesGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Archimedes",
        uid: "archimedes",
        playercounts: [2],
        version: "20211210",
        // i18next.t("apgames:descriptions.archimedes")
        description: "apgames:descriptions.archimedes",
        urls: ["http://www.di.fc.ul.pt/~jpn/gv/archimedes.htm", "http://superdupergames.org/rules/archimedes.pdf"],
        people: [
            {
                type: "designer",
                name: "Scott Marley",
            },
            {
                type: "designer",
                name: "Philip Cohen"
            }
        ],
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public pieces!: [number, number];
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IArchimedesState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>([
                ["a2", 1], ["a3", 1], ["a4", 1],
                ["b1", 1], ["b2", 1], ["b3", 1], ["b4", 1],
                ["c1", 1], ["c2", 1], ["c3", 1],
                ["d1", 1], ["d2", 1],
                ["h7", 2], ["h6", 2], ["h5", 2],
                ["g8", 2], ["g7", 2], ["g6", 2], ["g5", 2],
                ["f8", 2], ["f7", 2], ["f6", 2],
                ["e8", 2], ["e7", 2],
            ]);
            const fresh: IMoveState = {
                _version: ArchimedesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IArchimedesState;
            }
            if (state.game !== ArchimedesGame.gameinfo.uid) {
                throw new Error(`The Archimedes engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ArchimedesGame {
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
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        const myhome = playerHomes[player - 1];

        // rebuilds first
        if (this.pieceCount(player) < 12) {
            if (! this.board.has(myhome)) {
                for (const to of this.findValidMoves(myhome)) {
                    moves.push(`${myhome}-${to}`);
                }
            }
        }

        // now look for all possible movement
        const mypieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const piece of mypieces) {
            for (const to of this.findValidMoves(piece)) {
                if (to === myhome) { continue; }
                moves.push(`${piece}-${to}`);
            }
        }

        return moves;
    }

    private findValidMoves(from: string): string[] {
        const targets: string[] = [];
        const grid = new RectGrid(8, 8);
        const [x, y] = ArchimedesGame.algebraic2coords(from);
        for (const dir of allDirections) {
            const ray = grid.ray(x, y, dir).map(pt => ArchimedesGame.coords2algebraic(...pt));
            for (const cell of ray) {
                if (this.board.has(cell)) {
                    break;
                } else {
                    targets.push(cell);
                }
            }
        }
        return targets;
    }

    private findAttackers(target: string, owner?: playerid): string[] {
        const attackers: string[] = [];
        const grid = new RectGrid(8, 8);
        if (owner === undefined) {
            owner = this.board.get(target);
            if (owner === undefined) {
                throw new Error("Empty spaces can't be attacked.");
            }
        }
        const [x, y] = ArchimedesGame.algebraic2coords(target);
        for (const dir of allDirections) {
            const ray = grid.ray(x, y, dir).map(pt => ArchimedesGame.coords2algebraic(...pt));
            for (const cell of ray) {
                if (this.board.has(cell)) {
                    if (this.board.get(cell)! !== owner) {
                        attackers.push(cell);
                    }
                    break;
                }
            }
        }
        return attackers;
    }

    private findVulnerable(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }

        const vulnerable: string[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const piece of pieces) {
            if (this.findAttackers(piece).length >= 3) {
                vulnerable.push(piece);
            }
        }
        return vulnerable;
    }

    private pieceCount(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        const pieces = [...this.board.entries()].filter(e => e[1] === player);
        return pieces.length;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = ArchimedesGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length > 0) {
                let prev = move;
                if (move.includes("-")) {
                    prev = move.split("-")[0];
                }
                if (! this.board.has(cell)) {
                    newmove = `${prev}-${cell}`;
                } else {
                    return {move: "", message: ""} as IClickResult;
                }
            } else if (
                ( (this.board.has(cell)) && (this.board.get(cell)! === this.currplayer) && (this.findValidMoves(cell).length > 0) ) ||
                ( (! this.board.has(cell)) && (cell === playerHomes[this.currplayer - 1]) )
                ) {
                newmove = cell;
            } else {
                return {move: "", message: ""} as IClickResult;
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
        const myhome = playerHomes[this.currplayer - 1];

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.archimedes.INITIAL_INSTRUCTIONS")
            return result;
        }

        // partials first
        if (! m.includes("-")) {
            // valid cell
            try {
                ArchimedesGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // cell has a piece
            if ( (! this.board.has(m)) && (m !== myhome) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // that piece belongs to you
            if ( (m !== myhome) && (this.board.get(m)! !== this.currplayer) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.archimedes.PARTIAL");
            return result;
        }

        // full moves
        const [from, to] = m.split("-");
        // cells valid
        for (const cell of [from, to]) {
            try {
                ArchimedesGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
        }
        // `from` has a piece
        if ( (! this.board.has(from)) && (from !== myhome) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        if ( (from !== myhome) && (this.board.get(from)! !== this.currplayer) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        // to is empty
        if (this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
            return result;
        }
        // to is not your home
        if (to === myhome) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.archimedes.SELF_OCCUPATION");
            return result;
        }
        // must move at least one space
        if (from === to) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.archimedes.MUST_MOVE");
            return result;
        }

        const [xFrom, yFrom] = ArchimedesGame.algebraic2coords(from);
        const [xTo, yTo] = ArchimedesGame.algebraic2coords(to);
        const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
        const grid = new RectGrid(8, 8);
        const ray = grid.ray(xFrom, yFrom, bearing).map(pt => ArchimedesGame.coords2algebraic(...pt));
        const idx = ray.findIndex(c => c === to);
        // moving in straight lines
        if (idx < 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NOLOS", {from, to});
            return result;
        }
        // unobstructed
        const between = ray.slice(0, idx);
        for (const cell of between) {
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, partial = false): ArchimedesGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];
        const [from, to] = m.split("-");
        this.board.delete(from);
        this.board.set(to, this.currplayer);
        this.results.push({type: "move", from, to});
        let otherPlayer: playerid = 2;
        if (this.currplayer === 2) {
            otherPlayer = 1;
        }
        let vuln = this.findVulnerable(otherPlayer);
        while (vuln.length > 0) {
            for (const cell of vuln) {
                this.board.delete(cell);
                this.results.push({type: "capture", where: cell, what: otherPlayer.toString()});
            }
            vuln = this.findVulnerable(otherPlayer);
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

    protected checkEOG(): ArchimedesGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // If at the beginning of your turn, you have a piece on the opponent's home port
        const enemyHome = playerHomes[prevPlayer - 1];
        if ( (this.board.has(enemyHome)) && (this.board.get(enemyHome)! === this.currplayer) ) {
            this.gameover = true;
            this.winner = [this.currplayer];
        // if the current player has no moves, then they lose
        } else if (this.moves().length === 0) {
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

    public resign(player: playerid): ArchimedesGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): IArchimedesState {
        return {
            game: ArchimedesGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ArchimedesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
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
                const cell = ArchimedesGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
                markers: [
                    {
                        type: "glyph",
                        glyph: "AHome",
                        points: [
                            {row: 7, col: 0}
                        ],
                    },
                    {
                        type: "glyph",
                        glyph: "BHome",
                        points: [
                            {row: 0, col: 7}
                        ],
                    },
                ],
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                AHome: {
                    name: "piecepack-suit-anchors",
                    player: 1,
                    opacity: 0.5,
                    scale: 0.85,
                },
                B: {
                    name: "piece",
                    player: 2
                },
                BHome: {
                    name: "piecepack-suit-anchors",
                    player: 2,
                    opacity: 0.5,
                    scale: 0.85,
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = ArchimedesGame.algebraic2coords(move.from);
                    const [toX, toY] = ArchimedesGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = ArchimedesGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    // highlight all the attackers
                    const atkrs = this.findAttackers(move.where!, parseInt(move.what!, 10) as playerid);
                    for (const atkr of atkrs) {
                        const [xAtk, yAtk] = ArchimedesGame.algebraic2coords(atkr);
                        rep.annotations.push({type: "move", style: "dashed", colour: "#ff4500", targets: [{row: yAtk, col: xAtk}, {row: y, col: x}]});
                    }
                }
            }
        }

        return rep;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of ArchimedesGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move"]);
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, promote, deltaScore
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toLocaleString()) || "unknown"];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.nowhat", {player: name, where: r.where}));
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
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                                break;
                        }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): ArchimedesGame {
        return new ArchimedesGame(this.serialize());
    }
}
