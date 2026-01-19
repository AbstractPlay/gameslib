import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Colour = "R"|"B"|"G"|"Y";
export type Direction = "CW"|"CCW";

// used to simplify the render function
// in our case, it's quite cheap to just store these for each frame
// in other cases, the render function may have to do some extra work
export type FrameState = {
    board: Colour[][];
    hands: [Colour[], Colour[]];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Colour[][];
    lastmove?: string;
    hands: [Colour[], Colour[]];
    frames: FrameState[];
};

export interface IRincalaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export function generateLayout(): Colour[][] {
  const colours = ["R", "B", "G", "Y"] as Colour[];
  const countPerColour = 6;
  const stackCount = 8;
  const maxHeight = 3;

  const stacks: Colour[][] = Array.from({ length: stackCount }, () => []);
  const pieces = colours.flatMap(c => Array(countPerColour).fill(c));

  while (pieces.length > 0) {
    // Pick a random piece from remaining pool
    const pieceIndex = Math.floor(Math.random() * pieces.length);
    const piece = pieces.splice(pieceIndex, 1)[0];

    // Find candidate stacks that satisfy constraints
    const candidates = stacks
      .map((stack, i) => ({ stack, i }))
      .filter(({ stack }) => stack.length < maxHeight && stack[stack.length - 1] !== piece);

    if (candidates.length === 0) {
      // Restart if stuck
      return generateLayout();
    }

    // Pick a random candidate
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    choice.stack.push(piece);
  }

  return stacks;
}

export class RincalaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Rincala",
        uid: "rincala",
        playercounts: [2],
        version: "20260108",
        dateAdded: "2026-01-08",
        // i18next.t("apgames:descriptions.rincala")
        description: "apgames:descriptions.rincala",
        // i18next.t("apgames:notes.rincala")
        notes: "apgames:notes.rincala",
        urls: [
            "https://spielstein.com/games/rincala",
            "https://boardgamegeek.com/boardgame/165627/rincala",
        ],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>eog", "mechanic>move>sow", "mechanic>capture", "board>shape>circle", "board>connect>linear", "components>simple>4c"],
        flags: ["no-moves", "custom-randomization", "scores", "random-start", "experimental"]
    };

    public static value(pc: Colour): number {
        return "YGBR".indexOf(pc) + 1;
    }
    public static col2lbl(col: number): string {
        return "ABCDEFGH"[col];
    }
    public static lbl2col(lbl: string): number {
        return "ABCDEFGH".indexOf(lbl);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board: Colour[][] = [[], [], [], [], [], [], [], []];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public hands: [Colour[], Colour[]] = [[],[]];
    public frames: FrameState[] = [];

    constructor(state?: IRincalaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const board = generateLayout();
            const fresh: IMoveState = {
                _version: RincalaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands: [[], []],
                frames: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IRincalaState;
            }
            if (state.game !== RincalaGame.gameinfo.uid) {
                throw new Error(`The Rincala engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): RincalaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Colour[][];
        this.hands = deepclone(state.hands) as [Colour[], Colour[]];
        this.frames = deepclone(state.frames) as FrameState[];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }

    //     const moves: string[] = [];

    //     // for first move of the game, just do gatherMoves and leave it at that
    //     if (this.stack.length === 1) {
    //         moves.push(...this.gatherMoves().map(({move}) => move));
    //     }
    //     // otherwise, recurse
    //     else {
    //         this.recurseMoves(moves, null);
    //     }

    //     return [...moves].sort((a,b) => {
    //         if (a.length === b.length) {
    //             return a.localeCompare(b);
    //         } else {
    //             return a.length - b.length;
    //         }
    //     });
    // }

    // public recurseMoves(moves: string[], working: string[]|null): void {
    //     // null means very first time
    //     if (working === null) {
    //         const results = this.gatherMoves();
    //         // store all terminal moves
    //         moves.push(...results.filter(({terminal}) => terminal).map(({move}) => move));
    //         // recurse with any nonterminal moves
    //         this.recurseMoves(moves, results.filter(({terminal}) => !terminal).map(({move}) => move));
    //     }
    //     // otherwise we have some starting moves
    //     else {
    //         for (const mv of working) {
    //             const cloned = this.clone();
    //             cloned.move(mv, {partial: true, trusted: true});
    //             const results = cloned.gatherMoves();
    //             // store all terminal moves
    //             moves.push(...results.filter(({terminal}) => terminal).map(({move}) => move).map(m => `${mv},${m}`));
    //             // recurse with any nonterminal moves
    //             const nonterminal = results.filter(({terminal}) => !terminal).map(({move}) => move).map(m => `${mv},${m}`);
    //             this.recurseMoves(moves, nonterminal);
    //         }
    //     }
    // }

    // gets a list of all single legal moves from a given position,
    // including whether the move was terminal (capture or empty hollow)
    public gatherMoves(): {move: string, terminal: boolean}[] {
        const moves: {move: string, terminal: boolean}[] = [];
        for (let i = 0; i < this.board.length; i++) {
            for (const dir of ["CW", "CCW"] as Direction[]) {
                let terminal = false;
                const pits = this.mv2pits(i, dir);
                // at least one of those pits must have a piece in it
                if (pits.filter(n => this.board[n].length > 0).length === 0) {
                    continue;
                }
                // if any of the pits are empty, it's terminal
                if (pits.filter(n => this.board[n].length === 0).length > 0) {
                    terminal = true;
                }
                const cloned = this.clone();
                const hand = [...cloned.board[i]];
                cloned.board[i] = [];
                for (const pit of pits) {
                    cloned.board[pit].push(hand.shift()!)
                }
                const move = `${RincalaGame.col2lbl(i)}${dir === "CW" ? ">" : "<"}`
                const caps = cloned.findCaptures();
                if (caps.length > 0) {
                    terminal = true;
                }
                moves.push({move, terminal});
            }
        }
        return moves;
    }

    // tells you what pits the move will drop pieces on
    // will automatically skip stacks of 8 pieces
    public mv2pits(start: number, dir: Direction): number[] {
        const cloned = deepclone(this.board);
        const pits: number[] = [];
        const dist = cloned[start].length;
        cloned[start] = [];
        let i = 0;
        let curr = start;
        while (i < dist) {
            curr = this.nextPit(curr, dir);
            while (cloned[curr].length === cloned.length) {
                curr = this.nextPit(curr, dir);
            }
            pits.push(curr);
            i++;
        }
        return pits;
    }

    // just the logic for moving CW or CCW to the next pit
    public nextPit(start: number, dir: Direction): number {
        if (dir === "CW") {
            return (start + 1) % this.board.length;
        } else {
            return (start - 1 + this.board.length) % this.board.length;
        }
    }

    // checks the whole board for any captures
    public findCaptures(): number[] {
        const caps: number[] = [];
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i].length >= 2 && this.board[i][this.board[i].length - 1] === this.board[i][this.board[i].length - 2]) {
                caps.push(i);
            }
        }
        return caps;
    }

    public randomMove(): string {
        const steps: string[] = [];
        let step: {move: string; terminal: boolean};
        let cloned = this.clone();
        const onlyOne = this.stack.length === 1;
        do {
            const moves = cloned.gatherMoves();
            if (moves.length > 0) {
                step = moves[Math.floor(Math.random() * moves.length)];
                steps.push(step.move);
                cloned = this.clone();
                cloned.move(steps.join(","), {partial: true, trusted: true});
                if (onlyOne) break;
            } else {
                return "pass";
            }
        } while (!step.terminal);
        const combined = steps.join(",");
        const result = this.validateMove(combined);
        if (!result.valid || result.complete !== 1) {
            throw new Error(`The move ${combined} was generated but is not valid.`);
        }
        return steps.join(",");
    }

    public getDirection(first: number, second: number): Direction|undefined {
        const diff = (second - first + this.board.length) % this.board.length;

        if (diff === 1) {
            return "CW"; // Clockwise
        } else if (diff === this.board.length - 1) {
            return "CCW"; // Counterclockwise
        } else {
            return undefined; // not adjacent
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const steps = move.split(",").filter(Boolean);
            let last = "";
            if (steps.length > 0) {
                // if the last step is incomplete, pop it off
                if (steps[steps.length - 1].length === 1) {
                    last = steps.pop()!;
                }
            }
            const cell = RincalaGame.col2lbl(col);
            let newmove = "";
            // if last move is empty, select the cell
            if (last === "") {
                newmove = cell;
            }
            // otherwise we're choosing direction
            else {
                const dir = this.getDirection(RincalaGame.lbl2col(last), col);
                if (dir !== undefined) {
                    newmove = last + (dir === "CW" ? ">" : "<");
                }
            }

            const combined = [...steps, newmove].join(",");
            const result = this.validateMove(combined) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                result.move = combined;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message, estack: (e as Error).stack})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toUpperCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.rincala.INITIAL_INSTRUCTIONS");
            return result;
        }

        const steps = m.split(",");
        const last = steps.pop()!;
        let cloned = this.clone();
        // validate each step
        for (let i = 0; i < steps.length; i++) {
            const moves = cloned.gatherMoves();
            const found = moves.find(({move}) => move === steps[i]);
            if (found === undefined || found.terminal) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: steps.slice(0, i+1).join(",")});
                return result;
            }
            cloned = this.clone();
            cloned.move(steps.slice(0, i+1).join(","), {partial: true, trusted: true});
        }
        // validate very last step
        const moves = cloned.gatherMoves();
        if (moves.filter(({move}) => move.startsWith(last)).length > 0) {
            const found = moves.find(({move}) => move === last);
            // exact match
            if (found !== undefined) {
                // if first move of the game, only one step is allowed, so ignore terminal
                if (this.stack.length === 1) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
                // every other time
                else {
                    // terminal
                    if (found.terminal) {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }
                    // must continue
                    else {
                        const cloned = this.clone();
                        cloned.move(m, {partial: true, trusted: true});
                        const moves = cloned.gatherMoves();
                        // you can't continue if no more moves are possible
                        if (moves.length === 0) {
                            result.valid = true;
                            result.complete = 1;
                            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                            return result;
                        } else {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.rincala.CONTINUE");
                            return result;
                        }
                    }
                }
            }
            // if the last step is incomplete, then partial
            else {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.rincala.PARTIAL");
                return result;
            }
        } else {
            result.valid = false;
            result.message = (m.endsWith(">") || m.endsWith("<")) ?
                i18next.t("apgames:validation.rincala.BAD_DIR") :
                i18next.t("apgames:validation.rincala.NO_MOVES");
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): RincalaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toUpperCase();
        m = m.replace("X", "x");
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && result.complete !== 1) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        this.frames = [{
            board: deepclone(this.board),
            hands: deepclone(this.hands),
        }];
        const capped: Colour[] = [];

        const steps = m.split(",").filter(Boolean);
        for (const step of steps) {
            // skip incomplete steps when partial
            if (partial && step.length < 2) {
                break;
            }
            // otherwise throw
            else if (step.length < 2) {
                throw new Error("Incomplete move somehow made it through.");
            }
            const results: APMoveResult[] = [];
            const [startLbl, dirstr] = step.split("");
            const dir: Direction = dirstr === ">" ? "CW" : "CCW";
            const start = RincalaGame.lbl2col(startLbl);
            const pits = this.mv2pits(start, dir);
            const stack = [...this.board[start]];
            this.board[start] = [];
            const pieces = [...stack];
            for (const pit of pits) {
                this.board[pit].push(stack.shift()!)
            }
            results.push({type: "sow", from: [startLbl], to: pits.map(RincalaGame.col2lbl), pieces});
            const caps = this.findCaptures();
            if (caps.length > 0) {
                for (const pit of caps) {
                    const pc = this.board[pit].pop()!;
                    capped.push(pc);
                    results.push({type: "capture", where: RincalaGame.col2lbl(pit), what: pc});
                    this.hands[this.currplayer - 1].push(pc);
                }
            }
            // group the results for each step together
            this.results.push({type: "_group", who: this.currplayer, results: results as [APMoveResult, ...APMoveResult[]]});
            // store current board and hands in frames
            this.frames.push({
                board: deepclone(this.board) as Colour[][],
                hands: deepclone(this.hands) as [Colour[], Colour[]]
            });
        }

        if (partial) return this;

        // remove the last frame to save space because the current state is the same
        this.frames.pop();
        if (this.results.length !== this.frames.length) {
            throw new Error("There's a mismatch in the length of the results array and the frames array. Something is wrong.");
        }
        this.lastmove = m;
        // add captures to the end of the move
        if (capped.length > 0) {
            this.lastmove += `(x${capped.join("")})`;
        }
        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): RincalaGame {
        // game ends if there is only 4 pieces left on the board
        // (by definition, this would be one of each colour)
        // or if there are no moves available
        if (this.board.flat().length === 4 || this.gatherMoves().length === 0) {
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            this.gameover = true;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score2 > score1) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
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

    public state(): IRincalaState {
        return {
            game: RincalaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: RincalaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board),
            hands: deepclone(this.hands),
            frames: deepclone(this.frames),
        };
    }

    public render(): APRenderRep[] {
        const renders: APRenderRep[] = [];
        // we need to look at each frame, and then finally the base object
        for (let i = 0; i < this.frames.length + 1; i++) {
            let board: Colour[][];
            let hands: [Colour[], Colour[]];
            if (i < this.frames.length) {
                board = this.frames[i].board;
                hands = this.frames[i].hands;
            } else {
                board = this.board;
                hands = this.hands;
            }
            let results: APMoveResult[] = [];
            if (i > 0 && this.results.length > 0) {
                const group = this.results[i-1];
                if (group !== undefined && group.type !== "_group") {
                    throw new Error("The only results that should be present are _group results!");
                } else if (group !== undefined) {
                    results = group.results;
                }
            }

            // build piece string
            const pieces = board.map(stack => stack.length > 0 ? stack.join("") : "-").join(",");

            // build pieces areas for hands
            const areas: AreaPieces[] = [];
            for (let i = 0; i < 2; i++) {
                const hand = hands[i];
                if (hand.length > 0) {
                    areas.push({
                        type: "pieces",
                        pieces: hand as [Colour, ...Colour[]],
                        label: i18next.t("apgames:validation.rincala.LABEL_STASH", {playerNum: i+1}) || `P${i+1} Hand`,
                    });
                }
            }

            // build rep
            const rep: APRenderRep =  {
                renderer: "stacking-offset",
                board: {
                    style: "sowing-round",
                    width: 8,
                    height: 1,
                },
                legend: {
                    R: [
                        {
                            name: "piece",
                            colour: 1,
                        },
                        {
                            text: RincalaGame.value("R").toString(),
                            colour: {
                                func: "bestContrast",
                                bg: 1,
                                fg: ["#000", "#fff"]
                            },
                        }
                    ],
                    B: [
                        {
                            name: "piece",
                            colour: 2,
                        },
                        {
                            text: RincalaGame.value("B").toString(),
                            colour: {
                                func: "bestContrast",
                                bg: 2,
                                fg: ["#000", "#fff"]
                            },
                        }
                    ],
                    G: [
                        {
                            name: "piece",
                            colour: 3,
                        },
                        {
                            text: RincalaGame.value("G").toString(),
                            colour: {
                                func: "bestContrast",
                                bg: 3,
                                fg: ["#000", "#fff"]
                            },
                        }
                    ],
                    Y: [
                        {
                            name: "piece",
                            colour: 4,
                        },
                        {
                            text: RincalaGame.value("Y").toString(),
                            colour: {
                                func: "bestContrast",
                                bg: 4,
                                fg: ["#000", "#fff"]
                            },
                        }
                    ],
                },
                areas: areas.length > 0 ? areas : undefined,
                pieces,
            };

            // annotate
            rep.annotations = [];

            if (results.length > 0) {
                for (const move of results) {
                    if (move.type === "sow") {
                        const fromX = RincalaGame.lbl2col(move.from![0]);
                        const toXs = move.to!.map(x => RincalaGame.lbl2col(x));
                        const targets: RowCol[] = [{row: 0, col: fromX}];
                        targets.push(...toXs.map(x => ({row: 0, col: x})));
                        rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]]});
                    } else if (move.type === "capture") {
                        const x = RincalaGame.lbl2col(move.where!);
                        rep.annotations.push({type: "exit", targets: [{row: 0, col: x}]});
                    }
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }

            renders.push(rep);
        }

        return renders;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public getPlayerScore(player: number): number {
        return this.hands[player - 1].map(pc => RincalaGame.value(pc)).reduce((a, b) => a + b, 0);
    }

     public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        if (r.type === "_group") {
            let resolved = true;
            for (const nested of r.results) {
                if (nested.type === "sow") {
                    node.push(i18next.t("apresults:SOW.rincala", {player, count: nested.pieces!.length, pieces: nested.pieces!.join(","), from: nested.from, to: nested.to!.join(",")}));
                } else if (nested.type === "capture") {
                    node.push(i18next.t("apresults:CAPTURE.complete", {player, where: nested.where, what: nested.what}));
                } else {
                    resolved = false;
                    break;
                }
            }
            return resolved;
        }
        return false;
    }

    public sameMove(move1: string, move2: string): boolean {
        // if either move contains an open parenthesis (showing captures),
        // only compare everything up to that parenthesis.
        const idx1 = move1.indexOf("(");
        const idx2 = move2.indexOf("(");
        return move1.substring(0, idx1 >= 0 ? idx1 : undefined) === move2.substring(0, idx2 >= 0 ? idx2 : undefined);
    }

    public getStartingPosition(): string {
        const board = this.stack[0].board;
        return board.map(stack => stack.join("")).join(",");
    }

    public clone(): RincalaGame {
        const cloned = Object.assign(new RincalaGame(), deepclone(this) as RincalaGame);
        return cloned;
    }
}
