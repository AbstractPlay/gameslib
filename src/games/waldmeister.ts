import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, BoardBasic, Glyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, HexTriGraph } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

type playerid = 1|2|3|4|5;
type Colour = "G"|"L"|"Y";
type Size = 1|2|3;
type CellContents = [Colour, Size];

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

const sortColours = (a: CellContents, b: CellContents): number => {
    if (a[0] === b[0]) {
        return a[1] - b[1];
    } else {
        return ["G", "L", "Y"].indexOf(a[0]) - ["G", "L", "Y"].indexOf(b[0]);
    }
}

const sortHeights = (a: CellContents, b: CellContents): number => {
    if (a[1] === b[1]) {
        return ["G", "L", "Y"].indexOf(a[0]) - ["G", "L", "Y"].indexOf(b[0]);
    } else {
        return a[1] - b[1];
    }
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    hands: [CellContents[], CellContents[]];
    round: number;
}

export interface IWaldMeisterState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    scores: [number, number];
};

export class WaldMeisterGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "WaldMeister",
        uid: "waldmeister",
        playercounts: [2],
        version: "20260117",
        dateAdded: "2026-01-17",
        // version: "20231225",
        // i18next.t("apgames:descriptions.waldmeister")
        description: "apgames:descriptions.waldmeister",
        urls: ["https://boardgamegeek.com/boardgame/371135/waldmeister"],
        people: [
            {
                type: "designer",
                name: "Andreas Kuhnekath-Häbler",
                urls: ["https://boardgamegeek.com/boardgamedesigner/42256/andreas-kuhnekath-habler"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place",  "mechanic>move", "mechanic>share", "board>shape>hex", "board>connect>hex", "components>special"],
        flags: ["experimental", "custom-colours", "scores"],
    };
    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public hands!: [CellContents[], CellContents[]];
    public round = 1;
    public scores: [number, number] = [0, 0];
    private dots: string[] = [];
    private selected: string|undefined;
    private loadedIdx = 0;

    constructor(state?: IWaldMeisterState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IWaldMeisterState;
            }
            if (state.game !== WaldMeisterGame.gameinfo.uid) {
                throw new Error(`The WaldMeister game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.scores = [...state.scores] as [number, number];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string,CellContents>();
            const hand: CellContents[] = [];
            for (const colour of ["G","L","Y"] as const) {
                for (const size of [1,2,3] as const) {
                    for (let i = 0; i < 3; i++) {
                        hand.push([colour, size]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: WaldMeisterGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands: [deepclone(hand), deepclone(hand)],
                round: 1,
            };
            this.stack = [fresh];
            this.scores = [0, 0];
        }
        this.load();
    }

    public load(idx = -1): WaldMeisterGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }
        this.loadedIdx = idx;

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.round = state.round;
        this.hands = deepclone(state.hands);
        return this;
    }

    public get graph(): HexTriGraph {
        const g = new HexTriGraph(1, 8);
        g.reverseLetters = true;
        return g;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const g = this.graph;
        const moves: string[] = [];

        // first move, just place a piece
        if (this.board.size === 0) {
            const inHand = new Set<string>(this.hands[player - 1].map(lst => lst.join("")));
            for (const pc of inHand) {
                for (const cell of g.listCells() as string[]) {
                    moves.push(`${pc}@${cell}`);
                }
            }
        }
        // otherwise, move then place
        else {
            const inHand = [...new Set<string>(this.hands[player - 1].map(([colour, size]) => `${colour}${size}`))];
            for (const [from, [colour, size]] of this.board.entries()) {
                const [fx, fy] = g.algebraic2coords(from);
                const pc = `${colour}${size}`;
                for (const dir of HexTriGraph.directions) {
                    let ray = g.ray(fx, fy, dir).map(c => g.coords2algebraic(...c));
                    const idx = ray.findIndex(c => this.board.has(c));
                    if (idx >= 0) {
                        ray = ray.slice(0, idx);
                    }
                    for (const to of ray) {
                        for (const mine of inHand) {
                            moves.push(`${pc}@${from}-${to},${mine}`);
                        }
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public getPlayerColour(p: playerid): number|string {
        switch (p) {
            case 1:
                return 1;
            case 2:
                return 2;
            case 3:
                return "#004529";
            case 4:
                return "#78c679";
            case 5:
                return "#f7fcb9";
        }
    }

    private static parseMove(mv: string): {moved?: [Colour, Size], from?: string, to?: string, placed?: [Colour, Size]} {
        // eslint-disable-next-line prefer-const
        let [pc, from, to, mine] = mv.split(/[@,-]/);
        let moved: [Colour, Size]|undefined;
        if (pc !== undefined && pc.length === 2) {
            moved = [pc[0] as Colour, parseInt(pc[1], 10) as Size];
        }
        if (from !== undefined) {
            from = from.toLowerCase();
        }
        if (to !== undefined) {
            to = to.toLowerCase();
        }
        let placed: [Colour, Size]|undefined;
        if (mine !== undefined && pc.length === 2) {
            placed = [mine[0] as Colour, parseInt(mine[1], 10) as Size];
        }
        return {moved, from, to, placed}
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.replace(/\s+/g, "");
        const g = this.graph;
        const parsed = WaldMeisterGame.parseMove(move);
        let newmove = "";
        try {
            // placement only
            if (this.board.size === 0) {
                // clicking outside of the board resets the move
                if ((row < 0 || col < 0) && piece !== undefined && piece.length === 3) {
                    newmove = piece.substring(1);
                }
                // clicking on the board is placing the piece
                else if (move.length > 0) {
                    const cell = g.coords2algebraic(col, row);
                    newmove = `${move}@${cell}`;
                }
            }
            // move then place
            else {
                // if clicking outside the board, then you must be selecting a piece to place
                if ((row < 0 || col < 0) && piece !== undefined && piece.length === 3 && parsed.moved !== undefined && parsed.from !== undefined && parsed.to !== undefined) {
                    newmove = `${move},${piece.substring(1)}`;
                }
                // otherwise you're clicking the board
                else if (row >= 0 && col >= 0) {
                    const cell = g.coords2algebraic(col, row);
                    // clicking an occupied cell resets the move
                    if (this.board.has(cell)) {
                        const [colour, size] = this.board.get(cell)!;
                        newmove = `${colour}${size}@${cell}`;
                    }
                    // clicking an unoccupied cell moves a piece
                    else if (!this.board.has(cell) && parsed.from !== undefined) {
                        newmove = `${parsed.moved!.join("")}@${parsed.from}-${cell}`;
                    }
                }
            }

            let result = this.validateMove(newmove) as IClickResult;
            if (result.autocomplete !== undefined) {
                newmove = result.autocomplete;
                result = this.validateMove(newmove) as IClickResult;
            }
            if (!result.valid) {
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

        m = m.replace(/\s+/g, "");
        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.waldmeister.INITIAL_INSTRUCTIONS", {context: this.board.size === 0 ? "place" : "move"});
            return result;
        }

        const parsed = WaldMeisterGame.parseMove(m);
        const allMoves = this.moves();
        const matches = allMoves.filter(mv => mv.startsWith(m));
        // if only one match, we're done
        if (matches.length === 1) {
            if (matches[0] === m) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = true;
                result.complete = -1;
                result.autocomplete = matches[0];
                return result;
            }
        }
        // if more than one, we're partial
        else if (matches.length > 1) {
            // initial placement
            if (this.board.size === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.waldmeister.PARTIAL_PLACE", {piece: parsed.moved?.join("")});
                return result;
            }
            // regular moves
            else {
                // still moving the piece
                if (parsed.to === undefined) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.waldmeister.PARTIAL_MOVE", {piece: parsed.moved!.join("")});
                    return result;
                }
                // selecting a piece from your hand
                else if (parsed.placed === undefined) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.waldmeister.PARTIAL_MOVE_PLACE", {piece: parsed.moved!.join("")});
                    return result;
                }
                // otherwise some unexpected error
                else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
            }
        }
        // otherwise, we have a problem
        else {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false, emulation = false} = {}): WaldMeisterGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.replace(/\s+/g, "");

        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (partial) && (allMoves.filter(x => x.startsWith(m)).length < 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.selected = undefined;
        this.dots = [];
        const parsed = WaldMeisterGame.parseMove(m);

        // set dots if appropriate
        if (partial && parsed.from !== undefined && parsed.to === undefined && this.board.size > 0) {
            this.selected = parsed.from;
            this.dots = allMoves.filter(mv => mv.startsWith(m)).map(mv => WaldMeisterGame.parseMove(mv)).map(({to}) => to!);
            return this;
        }

        // initial placement
        if (this.board.size === 0 && parsed.from !== undefined && parsed.moved !== undefined) {
            this.board.set(parsed.from, parsed.moved);
            const idx = this.hands[this.currplayer - 1].findIndex(([colour, size]) => colour === parsed.moved![0] && size === parsed.moved![1]);
            if (idx < 0) {
                throw new Error(`Could not find the piece ${parsed.moved.join("")} in the hand. This should never happen.`);
            }
            this.hands[this.currplayer - 1].splice(idx, 1);
            this.results.push({type: "place", what: parsed.moved.join(""), where: parsed.from});
        }
        // regular moves
        else {
            if (parsed.from !== undefined && parsed.to !== undefined) {
                const pc = this.board.get(parsed.from)!;
                this.board.set(parsed.to, pc);
                this.board.delete(parsed.from);
                this.results.push({type: "move", from: parsed.from, to: parsed.to, what: parsed.moved!.join("")});
                if (parsed.placed !== undefined) {
                    this.board.set(parsed.from, parsed.placed);
                    const idx = this.hands[this.currplayer - 1].findIndex(([colour, size]) => colour === parsed.placed![0] && size === parsed.placed![1]);
                    if (idx < 0) {
                        throw new Error(`Could not find the piece ${parsed.placed.join("")} in the hand. This should never happen.`);
                    }
                    this.hands[this.currplayer - 1].splice(idx, 1);
                    this.results.push({type: "place", what: parsed.placed.join(""), where: parsed.from});
                }
            }
        }

        if (partial || emulation) return this;

        // check for end of year and progress if appropriate (but not when emulating)
        if (!emulation && this.round === 1 && this.hands.flat().length === 0) {
            // do normal end of round stuff
            // P2 placed the last piece, so P1 will pass, and it will become P2's turn next
            this.lastmove = m;
            if (this.currplayer === 1) {
                this.currplayer = 2;
            } else {
                this.currplayer = 1;
            }
            this.saveState();

            this.results = [];

            // score the board
            const [score1, score2] = this.scoreBoard();
            this.scores[0] += score1;
            this.scores[1] += score2;
            this.results.push({type: "deltaScore", who: 1, delta: score1});
            this.results.push({type: "deltaScore", who: 2, delta: score2});

            // update round, insert the pass, and reset the board
            this.round++;
            this.lastmove = "pass";
            this.results.push({type: "pass"});
            const board = new Map<string,CellContents>();
            const hand: CellContents[] = [];
            for (const colour of ["G","L","Y"] as const) {
                for (const size of [1,2,3] as const) {
                    for (let i = 0; i < 3; i++) {
                        hand.push([colour, size]);
                    }
                }
            }
            this.board = board;
            this.hands = [deepclone(hand), deepclone(hand)];
            // don't saveState here
            // let the normal loop take over
        }
        // for year 2, score, but don't pass or reset
        else if (!emulation && this.round === 2 && this.hands.flat().length === 0) {
            // score the board
            const [score1, score2] = this.scoreBoard();
            this.scores[0] += score1;
            this.scores[1] += score2;
            this.results.push({type: "deltaScore", who: 1, delta: score1});
            this.results.push({type: "deltaScore", who: 2, delta: score2});
        }

        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG(emulation);
        this.saveState();
        return this;
    }

    // Should only be called at the end of the year
    // Scores the board and updates the stored scores
    private scoreBoard(): [number, number] {
        let score1: number;
        let score2: number;
        if (this.round === 1) {
            score1 = this.scoreColours().reduce((a, b) => a + b, 0);
            score2 = this.scoreHeights().reduce((a, b) => a + b, 0);
        } else {
            score1 = this.scoreHeights().reduce((a, b) => a + b, 0);
            score2 = this.scoreColours().reduce((a, b) => a + b, 0);
        }
        return [score1, score2];
    }

    // these functions are split into two components so the renderer
    // can highlight scored cells and there's no repeated code
    // small, medium, large
    public scoreHeights(): number[] {
        const heights: number[] = [];

        for (const height of [1, 2, 3] as Size[]) {
            const grp = this.getLargestHeightGroup(height);
            if (grp !== undefined) {
                heights.push(grp.length);
            }
        }

        return heights;
    }

    private getLargestHeightGroup(height: Size): string[]|undefined {
        const g = this.graph;
        const graph = g.graph;
        for (const cell of g.listCells() as string[]) {
            if (!this.board.has(cell) || (this.board.get(cell)![1] !== height)) {
                graph.dropNode(cell);
            }
        }
        const conn = connectedComponents(graph);
        const max = Math.max(...conn.map(grp => grp.length));
        const found = conn.find(grp => grp.length === max);
        return found;
    }

    // dark green, light green, yellow
    public scoreColours(): number[] {
        const colours: number[] = [];

        for (const colour of ["G", "L", "Y"] as Colour[]) {
            const grp = this.getLargestColourGroup(colour);
            if (grp !== undefined) {
                colours.push(grp.length);
            }
        }

        return colours;
    }

    private getLargestColourGroup(colour: Colour): string[]|undefined {
        const g = this.graph;
        const graph = g.graph;
        for (const cell of g.listCells() as string[]) {
            if (!this.board.has(cell) || (this.board.get(cell)![0] !== colour)) {
                graph.dropNode(cell);
            }
        }
        const conn = connectedComponents(graph);
        const max = Math.max(...conn.map(grp => grp.length));
        const found = conn.find(grp => grp.length === max);
        return found;
    }

    protected checkEOG(emulated: boolean): WaldMeisterGame {
        if (!emulated && this.round === 2 && this.hands.flat().length === 0) {
            this.gameover = true;
            const [score1, score2] = this.scores;
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

    public status(): string {
        let status = super.status();
        if (this.gameover) {
            status += `Scores: ${this.scores.join(", ")}\n\n`;
        }
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        return status;
    }

    public state(): IWaldMeisterState {
        return {
            game: WaldMeisterGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            scores: [...this.scores] as [number, number],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: WaldMeisterGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            hands: deepclone(this.hands) as [CellContents[], CellContents[]],
            round: this.round,
        };
    }

    // This render is complicated because I want to highlight the scoring groups
    // at the end of year. So the function has to do some stack inspection that it
    // normally doesn't do.
    public render(opts: IRenderOpts = {perspective: undefined}): APRenderRep|APRenderRep[] {
        // if the current results include `deltaScore`, then render three frames:
        // - colours
        // - heights
        // - current board state (blank for round 1, final unmarked board for round 2)
        if (this.results.find(r => r.type === "deltaScore")) {
            const reps: APRenderRep[] = [];

            const cloned = this.clone();
            cloned.load(this.loadedIdx - 1);
            if (cloned.round === 1) {
                reps.push(cloned.renderColours(1));
                reps.push(cloned.renderHeights(2));
            } else {
                reps.push(this.renderHeights(1));
                reps.push(this.renderColours(2));
            }
            reps.push(this.renderCurrent(opts.perspective as playerid|undefined));

            return reps;
        }
        // otherwise just render the current state
        else {
            return this.renderCurrent(opts.perspective as playerid|undefined);
        }
    }

    private renderCurrent(perspective?: playerid): APRenderRep {
        const g = this.graph;
        // Build piece string
        const pieces: string[][] = [];
        for (const row of g.listCells(true) as string[][]) {
            const nodes: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    nodes.push(contents.join(""));
                } else {
                    nodes.push("-");
                }
            }
            pieces.push(nodes);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const legend: ILegendObj = {};
        for (const colour of ["G", "L", "Y"] as Colour[]) {
            for (const size of [1, 2, 3] as Size[]) {
                const key = `${colour}${size}`;
                legend[key] = {
                    name: `pyramid-flattened-${size === 1 ? "small" : size === 2 ? "medium" : "large"}`,
                    colour: colour === "G" ? this.getPlayerColour(3) : colour === "L" ? this.getPlayerColour(4) : this.getPlayerColour(5),
                    orientation: "vertical",
                };
            }
        }

        const areas: AreaPieces[] = [];
        if (this.hands.flat().length > 0) {
            const order: playerid[] = perspective === 2 ? [2, 1] : [1, 2];
            // add clickable squares to make clicking on these pieces more manageable
            for (const [key, pc] of [...Object.entries(legend)]) {
                const newkey = `p${key}`;
                legend[newkey] = [
                    {
                        name: "piece-square-borderless",
                        colour: "_context_background",
                    },
                    {...pc} as Glyph,
                ];
            }
            for (const p of order) {
                const sorter = this.round === 1 ? (p === 1 ? sortColours : sortHeights) : (p === 1 ? sortHeights : sortColours);
                if (this.hands[p - 1].length > 0) {
                    areas.push({
                        type: "pieces",
                        label: i18next.t("apgames:validation.waldmeister.LABEL_STASH", {playerNum: p}) || `P${p} Hand`,
                        pieces: this.hands[p - 1].sort(sorter).map(([colour, size]) => `p${colour}${size}`) as [string, ...string[]],
                    });
                }
            }
        }

        const rep: APRenderRep =  {
            options: ["reverse-letters"],
            board: {
                style: "hex-of-hex",
                minWidth:  1,
                maxWidth: 8,
                rotate: -90,
            } as BoardBasic,
            legend,
            pieces: pstr,
            areas: areas.length > 0 ? areas: undefined,
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = g.algebraic2coords(move.from);
                    const [tx, ty] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }

        // add selected and dots if present
        if (this.selected !== undefined) {
            const [fx, fy] = g.algebraic2coords(this.selected);
            (rep.board! as BoardBasic).markers = [{
                    type: "flood",
                    colour: this.currplayer,
                    opacity: 0.25,
                    points: [{row: fy, col: fx}],
            }];
        }
        if (this.dots.length > 0) {
            const targets: RowCol[] = [];
            for (const dot of this.dots) {
                const [tx, ty] = g.algebraic2coords(dot);
                targets.push({row: ty, col: tx});
            }
            rep.annotations.push({type: "dots", targets: targets as [RowCol, ...RowCol[]]});
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    // At the end of year one, these are called on cloned states with the pieces where the belong
    private renderColours(player: playerid): APRenderRep {
        const rep = this.renderCurrent();
        // remove any existing annotations or markers
        delete rep.annotations;
        delete (rep.board! as BoardBasic).markers;
        // get scored colour groups
        const points: RowCol[] = [];
        for (const colour of ["G", "L", "Y"] as Colour[]) {
            const group = this.getLargestColourGroup(colour);
            if (group !== undefined) {
                group.forEach(cell => {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    points.push({row: y, col: x});
                });
            }
        }
        if (points.length > 0) {
            (rep.board! as BoardBasic).markers = [{
                type: "flood",
                colour: player,
                opacity: 0.25,
                points: points as [RowCol, ...RowCol[]],
            }];
        }
        return rep;
    }

    private renderHeights(player: playerid): APRenderRep {
        const rep = this.renderCurrent();
        // remove any existing annotations or markers
        delete rep.annotations;
        delete (rep.board! as BoardBasic).markers;
        // get scored height groups
        const points: RowCol[] = [];
        for (const height of [1, 2, 3] as Size[]) {
            const group = this.getLargestHeightGroup(height);
            if (group !== undefined) {
                group.forEach(cell => {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    points.push({row: y, col: x});
                });
            }
        }
        if (points.length > 0) {
            (rep.board! as BoardBasic).markers = [{
                type: "flood",
                colour: player,
                opacity: 0.25,
                points: points as [RowCol, ...RowCol[]],
            }];
        }
        return rep;
    }

    public statuses(): IStatus[] {
        return [{ key: i18next.t("apgames:status.ROUND"), value: [this.round.toString()] }];
    }

    public getPlayersScores(): IScores[] {
        const display = [{ name: i18next.t("apgames:status.waldmeister.GOALS"), scores: (this.round === 1) ? [i18next.t("apgames:status.waldmeister.COLOUR"), i18next.t("apgames:status.waldmeister.HEIGHT")] : [i18next.t("apgames:status.waldmeister.HEIGHT"), i18next.t("apgames:status.waldmeister.COLOUR")]}] as IScores[];
        if (this.scores.reduce((a, b) => a + b, 0) > 0) {
            display.push({ name: i18next.t("apgames:status.SCORES"), scores: this.scores});
        }
        return display;
    }

    public sameMove(move1: string, move2: string): boolean {
        const parsed1 = WaldMeisterGame.parseMove(move1);
        const parsed2 = WaldMeisterGame.parseMove(move2);
        let norm1 = `${parsed1.moved?.join("")}@${parsed1.from}`;
        let norm2 = `${parsed2.moved?.join("")}@${parsed1.from}`;

        if (parsed1.to !== undefined && parsed1.placed !== undefined) {
            norm1 += `-${parsed1.to},${parsed1.placed.join("")}`;
        }
        if (parsed2.to !== undefined && parsed2.placed !== undefined) {
            norm2 += `-${parsed2.to},${parsed2.placed.join("")}`;
        }

        return norm1 === norm2;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {player: `Player ${r.who}`, delta: r.delta, count: r.delta}));
                resolved =true;
                break;
        }
        return resolved;
    }

    public clone(): WaldMeisterGame {
        return Object.assign(new WaldMeisterGame(), deepclone(this) as WaldMeisterGame);
        // return new WaldMeisterGame(this.serialize());
    }
}
