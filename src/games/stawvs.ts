import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const clone = require("rfdc/default");

export type playerid = 1|2|3|4;
export type Mode = "place"|"collect";
export type Size = 1|2|3;
export type Colour = "PI"|"BL"|"GR"|"OR"|"GH";
export type Pyramid = [Colour, Size];
export type CellContents = [Pyramid, playerid?];
const allColours: string[] = ["PI", "BL", "GR", "OR"];

const boardDim = 8; /* there's a pyramid-poor variant of 7 */
const triosPerColor = 5; /* in the pyramid-poor variant it's 4 */
const numberOfColors = 4; /* there's a stash-poor variant of 5 */

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface ILocalStash {
    [k: string]: unknown;
    type: "localStash";
    label: string;
    stash: string[][];
}

interface IOrganizedCaps {
    triosMono: Pyramid[][];
    partialsMono: Pyramid[][];
    triosMixed: Pyramid[][];
    partialsMixed: Pyramid[][];
    miscellaneous: Pyramid[];
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    mode: Mode;
    board: Map<string, CellContents>;
    captured: [Pyramid[], Pyramid[]];
    lastmove?: string;
    eliminated: playerid[];
}

export interface IStawvsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StawvsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Stawvs",
        uid: "stawvs",
        playercounts: [2,3,4],
        version: "20251113",
        dateAdded: "2025-11-13",
        // i18next.t("apgames:descriptions.stawvs")
        description: "apgames:descriptions.stawvs",
        urls: [
            "https://looneypyramids.wiki/wiki/Stawvs",
            "https://boardgamegeek.com/boardgame/130579/stawvs",
        ],
        people: [
            {
                type: "designer",
                name: "Russ Williams",
                urls: ["https://boardgamegeek.com/boardgamedesigner/43454/russ-williams"],
                apid: "4223967c-d922-47c6-8f57-69b6025f5a9b",
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        variants: [
            {uid: "hole", group: "setup"},
            {uid: "random", group: "setup"},
            {uid: "hey"},
            {uid: "finalfree"},
            {uid: "pieces-2"}
        ],
        categories: ["goal>score>eog", "mechanic>set", "board>shape>rect", "board>connect>rect", "components>pyramids", "other>2+players"],
        flags: ["scores", "autopass"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, boardDim);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, boardDim);
    }

    public numplayers!: number;
    public currplayer!: playerid;
    public mode!: Mode;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public captured: [Pyramid[], Pyramid[]] = [[], []];
    public eliminated: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    private pieceCount = 3;

    constructor(state: number | IStawvsState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            //Init board
            let emptyCells: string[] = ["a1","a8","h1","h8"];
            if (this.variants.includes("hole"))
                emptyCells = ["d4","e4","d5","e5"];
            else if (this.variants.includes("random"))
                emptyCells = this.getFourRandomCells();

            this.pieceCount = this.getPieceCount();
            
            const board = new Map<string, CellContents>([]);
            let bag: Pyramid[] = [];
            for (let stash = 0; stash < triosPerColor; stash++) {
                for (let size = 1; size < numberOfColors; size++) {
                    for (let c = 0; c < allColours.length; c++) {
                        bag.push([allColours[c], size] as Pyramid);   
                    }
                }
            }
            const shuffled = shuffle(bag);
            for (let x = 0; x < boardDim; x++) {
                for (let y = 0; y < boardDim; y++) {
                    const cell = StawvsGame.coords2algebraic(x, y);
                    if (emptyCells.indexOf(cell) === -1) {
                        board.set(cell, [shuffled.pop()]);
                    }
                }
            }
            
            const fresh: IMoveState = {
                _version: StawvsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                mode: "place",
                board: board,
                captured: [[], []],
                eliminated: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStawvsState;
            }
            if (state.game !== StawvsGame.gameinfo.uid) {
                throw new Error(`The Stawvs game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.variants = state.variants;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];

            this.pieceCount = this.getPieceCount();
        }
        this.load();
    }

    public load(idx = -1): StawvsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.mode = state.mode;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.captured = clone(state.captured) as [Pyramid[], Pyramid[]];
        this.eliminated = [...state.eliminated];

        return this;
    }

    public getFourRandomCells(): string[] {
        const cells: string[] = [];
        cells.push(this.getOneRandomCell());
        while (cells.length < 4) {
            const newcell = this.getOneRandomCell();
            if (cells.indexOf(newcell) < 0)
                cells.push(newcell);
        }
        return cells;
    }

    public getOneRandomCell(): string {
        const randx: number = Math.floor(Math.random() * boardDim);
        const randy: number = Math.floor(Math.random() * boardDim);
        return StawvsGame.coords2algebraic(randx,randy);
    }

    public canFish(cellA: string, cellB: string): boolean {
        //The unobstructed straight line test for moves and claims.
        //Named for Hey, That's My Fish!
        //Assumes that we're starting from a rational value of cellA.

        //Can't fish yourself.
        if (cellA === cellB)
            return false;
        
        //Test cellB for existence and availability.
        if (! this.isAvailable(cellB) )
            return false;

        // We need the coordinates for more testing.
        const [xA,yA] = StawvsGame.algebraic2coords(cellA);
        const [xB,yB] = StawvsGame.algebraic2coords(cellB);

        //Test the fishing line is a straight line.
        if (!RectGrid.isOrth(xA,yA,xB,yB) && !RectGrid.isDiag(xA,yA,xB,yB))
            return false;

        //Test all the intervening cells are available.
        const testCells: Array<[number, number]> = RectGrid.between(xA,yA,xB,yB);
        for (let t = 0; t < testCells.length; t++) {
            const testCoords = testCells[t];
            const testCell =  StawvsGame.coords2algebraic(testCoords[0],testCoords[1]);
            if (! this.isAvailable(testCell))
                return false;
        }
        
        //Passed all our tests.
        return true;
    }

    public isAvailable(cell: string): boolean {
        //Test if a cell is unoccupied and occupiable/claimable.
        //That is, it is not empty and is not owned.
        if (! this.board.has(cell)) {
            return false;
        }

        const contents = this.board.get(cell);
        if (contents === undefined) {
            throw new Error("Malformed cell contents.");
        }
        //const pyramid = contents[0];
        if (contents.length > 1) {
            //The cell has an owner already.
            return false;
        }

        return true;
    }

    public hasOwner(cell: string): boolean {
        if (! this.board.has(cell)) {
            return false;
        }

        const contents = this.board.get(cell);
        if (contents === undefined) {
            throw new Error("Malformed cell contents.");
        }

        if (contents.length > 1) {
            return true;
        }

        return false;
    }

    public getOwnCells(player: playerid): string[] {
        //Used for move generation.
        const mycells: string[] = [];
        for (let row = 0; row < boardDim; row++) {
            for (let col = 0; col < boardDim; col++) {
                const cell = StawvsGame.coords2algebraic(col, row);
                if (this.hasOwner(cell) && this.getOwner(cell) === player) {
                    mycells.push(cell);
                }
            }
        }
        return mycells;
    }

    public getOwner(cell: string): playerid | undefined {
        if (! this.board.has(cell)) {
            return undefined;
        }

        const contents = this.board.get(cell);
        if (contents!.length > 1) {
            return contents![1];
        } else {
            return undefined;
        }
    }

    public getPieceCount() : number {
        return this.variants.includes("pieces-2") ? 2 : 3;
    }

    public disown(cell: string) : void {
        if (! this.board.has(cell)) {
            throw new Error("Illicit cell clearance.");
        }
        const contents = this.board.get(cell);
        this.board.set(cell,[contents![0]]);
        return;
    }

    public place(cell: string, owner: playerid): void {
        if (! this.board.has(cell)) {
            throw new Error("Attempt to play to empty cell.");
        }

        const contents = this.board.get(cell);
        if (contents === undefined) {
            throw new Error("Malformed cell contents.");
        }
        if (contents.length > 1) {
            throw new Error("Cell already claimed.");
        }

        const newContents: CellContents = [contents[0], owner];
        this.board.set(cell, newContents);
        return;
    }

    public checkPlaced(): boolean {
        //Count up pieces placed to support Mode change.
        let placements: number[] = Array(this.numplayers).fill(0);
        for (let row = 0; row < boardDim; row++) {
            for (let col = 0; col < boardDim; col++) {
                const cell = StawvsGame.coords2algebraic(col, row);
                const owner = this.getOwner(cell);
                if (owner) {
                    placements[owner as number - 1]++;
                }
            }
        }
        const total = Math.min(...placements);
        if (total > this.pieceCount) {
            throw new Error("Too many pieces have been placed.");
        }
        return (total === this.pieceCount);
    }

    public namePyramid(pyramid: Pyramid): string {
        //Name the captured pyramid for the chat log.
        const colors = ["pink","blue","green","orange"];
        const sizes = ["small","medium","large"];
        let name = "";
        name += sizes[pyramid[1] as number - 1] + " ";
        name += colors[allColours.indexOf(pyramid[0])] + " pyramid";
        return name;
    }

    public moves(player?: playerid): string[] {
        //Generate the list of moves, for pass validation and autopass.
        //If this is too inefficient, generating only the moves for the "hey" variant,
        // would still suffice for pass testing in all cases.
        
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        if (this.mode === "collect" && this.eliminated.indexOf(this.currplayer) > -1) {
            return ["pass"];
        }
        
        if (this.mode === "place") {
            // If the player is placing pieces, enumerate the available cells.
            for (let row = 0; row < boardDim; row++) {
                for (let col = 0; col < boardDim; col++) {
                    const cell = StawvsGame.coords2algebraic(col, row);
                    if (this.isAvailable(cell)) {
                        moves.push(cell);
                    }
                }
            }
        } else {
            const starts = this.getOwnCells(this.currplayer);
            for (let s = 0; s < starts.length; s++) {
                const start = starts[s];
                for (let row = 0; row < boardDim; row++) {
                    for (let col = 0; col < boardDim; col++) {
                        const cell = StawvsGame.coords2algebraic(col, row);
                        if (this.canFish(start,cell)) {
                            moves.push(start + "-" + cell + "," + start);
                            if (! this.variants.includes("hey") ) {
                                for (let subrow = 0; subrow < boardDim; subrow++) {
                                    for (let subcol = 0; subcol < boardDim; subcol++) {
                                        const subcell = StawvsGame.coords2algebraic(subcol, subrow);
                                        if (this.canFish(cell,subcell)) {
                                            moves.push(start + "-" + cell + "," + subcell);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (moves.length === 0)
                moves.push("pass");

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
            const cell = StawvsGame.coords2algebraic(col, row);
            
            if (this.mode === "place" || move === "")
                newmove = cell;
            else if (move.indexOf(",") > -1) {
               //No more clicking, please
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.stawvs.EXTRA_CLAIMS")
                }
            } else if (move.indexOf("-") > -1)
                newmove = `${move},${cell}`;
            else if (this.variants.includes("hey"))
                newmove = `${move}-${cell},${move}`;
            else
                newmove = `${move}-${cell}`;

            const result = this.validateMove(newmove) as IClickResult;

            if (! result.valid) {
                //Revert latest addition to newmove.
                if (this.variants.includes("hey"))
                    result.move = newmove.includes("-") ? newmove.split("-")[0] : "";
                else
                    result.move = newmove.includes(",") ? newmove.split(",")[0] : (newmove.includes("-") ? newmove.split("-")[0] : "");
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
            if (this.mode === "place")
                result.message = i18next.t("apgames:validation.stawvs.INITIAL_PLACEMENT_INSTRUCTIONS")
            else
                result.message = i18next.t("apgames:validation.stawvs.INITIAL_MOVE_INSTRUCTIONS")
            return result;
        }

        // check for "pass" first
        if (m === "pass") {
            if (this.eliminated.indexOf(this.currplayer) > -1) {
                //This would be caught by the next condition but why calculate the moves?
                result.valid = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else if (this.mode === "place" || this.moves()[0] !== "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.stawvs.NOPASS")
                return result;
            } else {
                result.valid = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        if (m !== "pass" && this.eliminated.indexOf(this.currplayer) > -1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stawvs.MUST_PASS");
        }

        if (this.mode === "place") {
            if (! this.isAvailable(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.stawvs.BAD_PLACEMENT");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation.stawvs.VALID_PLACEMENT");
                return result;
            }
        } //else

        //Parse the move into three cells.
        //The first must be occupied by currplayer.
        //The second must be in a straight (incl. diagonal), legal line from there.
        //The third must be in a straight legal line from the second.

        const cells = m.split("-");
        const cell0 = cells[0];
        if (!this.hasOwner(cell0) || this.getOwner(cell0) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stawvs.BAD_START", {m});
            return result;
        }

        if (cells.length === 1) { 
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.stawvs.PARTIAL_MOVE");
            return result;
        }

        const [cell1,cell2] = cells[1].split(",");
        
        if (! this.canFish(cell0,cell1) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stawvs.BAD_MOVE");
            return result;
        }

        if (! cell2) { 
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.stawvs.PARTIAL_CLAIM");
            return result;
        }

        //Claiming the cell you left is always allowed, most notably
        //  in the simple moves variant, where it's the only legal choice.
        if (this.variants.includes("hey")) {
            if (cell2 !== cell0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.stawvs.BAD_CLAIM_HEY");
                return result;
            } else {
                //cell0 is always available for capture
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation.stawvs.VALID_PLAY");
                return result;
            }
        }
            
        if (cell2 !== cell0 && (! this.canFish(cell1,cell2)) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stawvs.BAD_CLAIM");
            return result;
        } else {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.stawvs.VALID_PLAY");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): StawvsGame {
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
        }

        if (m.toLowerCase() === "pass") {
            this.results = [{type: "pass"}];
            //passing is forevah
            if (this.eliminated.indexOf(this.currplayer) < 0) {
                this.eliminated.push(this.currplayer);
                if (this.eliminated.length < this.numplayers)
                    this.results = [{type: "eliminated", who: this.currplayer.toString()}];
                else 
                    this.results = [{type: "pass"}];
            } else {
                this.results = [{type: "pass"}];
            }
        } else {
            // enact move
            if (this.mode === "place") {
                const cell = m;
                if (this.isAvailable(cell)) {
                    // place the piece
                    this.place(cell, this.currplayer);
                    this.results = [{type: "place", where: cell, who: this.currplayer}]
                }
            } else {
                const cells = m.split("-");
                const cell0 = cells[0];
                if (cells[1]) {
                    const [cell1,cell2] = cells[1].split(",");
                    //1. Move piece
                    this.disown(cell0);
                    this.place(cell1,this.currplayer);
                    if (cell2) {
                        //2. Claim target.
                        const pyramid = this.board.get(cell2)![0];
                        this.captured[this.currplayer - 1].push(pyramid);
                        const captive = this.namePyramid(pyramid);
                        //3. Remove target.
                        this.board.delete(cell2);
                        this.results = [{type: "move", from: cell0, to: cell1, how: cell2, what: captive}]
                    }
                }
            }
        }

        // update mode if all pieces are placed.
        if (this.mode === "place" && this.checkPlaced()) {
            this.mode = "collect";
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

    protected checkEOG(): StawvsGame {
        if ( (this.lastmove === "pass") && (this.eliminated.length === this.numplayers) ) {
            this.gameover = true;

            if (! this.variants.includes("finalfree")) {
                //Make final captures.
                for (let row = 0; row < boardDim; row++) {
                    for (let col = 0; col < boardDim; col++) {
                        const cell = StawvsGame.coords2algebraic(col, row);
                        if (this.board.has(cell)) {
                            const contents = this.board.get(cell);
                            if (contents!.length > 1) {
                                const player = contents![1];
                                const pyramid = contents![0];
                                this.captured[player as number - 1].push(pyramid);
                                this.board.set(cell,[["GH",pyramid![1]],player]);
                            }
                        }
                    }
                }
            }
                
            const scores = this.getPlayersScores()[0].scores as number[];
            const max = Math.max(...scores);
            for (let p = 1; p <= this.numplayers; p++) {
                if (scores[p-1] === max) {
                    this.winner.push(p as playerid);
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

    public getPlayerScore(indata: number | IOrganizedCaps): number {
        //Scoring algorithm simplified from the one for mega-volcano.
        let org: IOrganizedCaps;
        if (typeof indata === "number") {
            org = this.organizeCaps(indata as playerid);
        } else {
            org = indata;
        }
        let score = 0;
        score += 7 * org.triosMono.length;
        score += 5 * org.triosMixed.length;
        for (const stack of org.partialsMono) {
            score += stack.length;
        }
        for (const stack of org.partialsMixed) {
            score += stack.length;
        }
        score += org.miscellaneous.length;
        return score;
    }

    public organizeCaps(indata: playerid | Pyramid[] = 1): IOrganizedCaps {
        /* Organization borrowed from Mega-Volcano, but white is not distinguished here. */
        let pile: Pyramid[];
        if (Array.isArray(indata)) {
            pile = [...indata];
        } else {
            pile = [...(this.captured[indata - 1])];
        }

        let org: IOrganizedCaps = {
            triosMono: [],
            partialsMono: [],
            triosMixed: [],
            partialsMixed: [],
            miscellaneous: []
        };
        const stacks: Pyramid[][] = [];

        const lgs = pile.filter(x => x[1] === 3);
        const mds = pile.filter(x => x[1] === 2);
        const sms = pile.filter(x => x[1] === 1);
        
        // Put each large in a stack and then look for a matching medium and small
        // This will find all monochrome trios
        while (lgs.length > 0) {
            const stack: Pyramid[] = [];
            const next = lgs.pop();
            stack.push(next!);
            const mdIdx = mds.findIndex(x => x[0] === next![0]);
            if (mdIdx >= 0) {
                stack.push(mds[mdIdx]);
                mds.splice(mdIdx, 1);
                const smIdx = sms.findIndex(x => x[0] === next![0]);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
            stacks.push(stack);
        }
        // Look at each stack that has only a large and find any leftover mediums and stack them
        for (const stack of stacks) {
            if (stack.length === 1) {
                const mdIdx = mds.findIndex(x => x[1] === 2);
                if (mdIdx >= 0) {
                    stack.push(mds[mdIdx]);
                    mds.splice(mdIdx, 1);
                }
            }
        }
        // Look at each stack that has a large and a medium and add any loose smalls
        for (const stack of stacks) {
            if (stack.length === 2) {
                const smIdx = sms.findIndex(x => x[1] === 1);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
        }
        // All remaining mediums now form the basis of their own stack and see if there is a matching small
        while (mds.length > 0) {
            const stack: Pyramid[] = [];
            const next = mds.pop();
            stack.push(next!);
            const smIdx = sms.findIndex(x => x[0] === next![0]);
            if (smIdx >= 0) {
                stack.push(sms[smIdx]);
                sms.splice(smIdx, 1);
            }
            stacks.push(stack);
        }
        // Find stacks with just a medium and put any loose smalls on top of them
        for (const stack of stacks) {
            if ( (stack.length === 1) && (stack[0][1] === 2) ) {
                const smIdx = sms.findIndex(x => x[1] === 1);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
        }
        // Now all you should have are loose smalls, add those
        stacks.push(...sms.map(x => [x]));

        // Categorize each stack
        for (const stack of stacks) {
            if (stack.length === 3) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.triosMono.push(clone(stack) as Pyramid[]);
                } else {
                    org.triosMixed.push(clone(stack) as Pyramid[]);
                }
            } else if (stack.length === 2) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.partialsMono.push(clone(stack) as Pyramid[]);
                } else {
                    org.partialsMixed.push(clone(stack) as Pyramid[]);
                }
            } else {
                org.miscellaneous.push(...clone(stack) as Pyramid[]);
            }
        }
        
        return org;
    }

    public state(): IStawvsState {
        return {
            game: StawvsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: StawvsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            mode: this.mode,
            lastmove: this.lastmove,
            eliminated: [...this.eliminated],
            board: new Map(this.board),
            captured: clone(this.captured) as [Pyramid[], Pyramid[]]
        };
    }

    private renderStashHelper(s: Pyramid[]): string[] {
        return s.map((t) => t.join("") + "c");
    }

    public render(): APRenderRep {
        // Arrays of pieces in the style of Tritium.
        // Flat pyramids in the style of Blam!
        // Standing stashes in the alternate style of (Mega-)Volcano.

        //Build piece string.
        const pstr: string[][][] = [];
        for (let row = 0; row < boardDim; row++) {
            const pieces: string[][] = [];
            for (let col = 0; col < boardDim; col++) {
                const piece: string[] = [];
                const cell = StawvsGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    const pyramid = contents[0];
                    piece.push(pyramid[0].toString() + pyramid[1].toString());
                    if (contents.length > 1)
                        piece.push("P" + contents[1]!.toString());
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        // build legend 
        const myLegend: ILegendObj = {};
        for (let c = 0; c < allColours.length; c++) {
            // Use lighter colors from the end of the palette.
            let color = c + 8;
            //The board pyramids.
            myLegend[allColours[c] as String + "1"] = {
                name: "pyramid-up-small-upscaled",
                colour: color
            };
            myLegend[allColours[c].toString() + "2"] = {
                name: "pyramid-up-medium-upscaled",
                colour: color
            };
            myLegend[allColours[c].toString() + "3"] = {
                name: "pyramid-up-large-upscaled",
                colour: color
            };
            //The stash area pyramids.
            myLegend[allColours[c] as String + "1c"] = {
                name: "pyramid-flattened-small",
                colour: color
            };
            myLegend[allColours[c].toString() + "2c"] = {
                name: "pyramid-flattened-medium",
                colour: color
            };
            myLegend[allColours[c].toString() + "3c"] = {
                name: "pyramid-flattened-large",
                colour: color
            };
        }

        //An extra set of "ghost" board pyramids for the end state
        const color = "#aaa";
        myLegend["GH1"] = {
            name: "pyramid-up-small-upscaled",
            colour: color,
            opacity: 0.25
        };
        myLegend["GH2"] = {
            name: "pyramid-up-medium-upscaled",
            colour: color,
            opacity: 0.25
        };
        myLegend["GH3"] = {
            name: "pyramid-up-large-upscaled",
            colour: color,
            opacity: 0.25
        };

        //Player pieces.
        for (let p = 0; p < this.numplayers; p++) {
            let color = p + 1;
            myLegend["P" + color] = {
                name: "piece",
                scale: 0.3,
                colour: color,
            };
        }

        //X marks the captures.
        myLegend["note"] = {
            text: "\u2718",
            scale: 0.5
        };

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-expanding",
            board: {
                style: "squares-checkered",
                width: boardDim,
                height: boardDim
            },
            legend: myLegend,
            pieces: pstr as [string[][], ...string[][][]],
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const areas: any[] = [];        

        // Add captured pyramids
        for (let p = 1; p <= this.numplayers; p++) {
            if (this.captured[p - 1].length > 0) {

                const node: ILocalStash = {
                    type: "localStash",
                    label: i18next.t("apgames:validation.stawvs.LABEL_COLLECTION", {playerNum: p}) || `P${p}'s pyramids`,
                    stash: []
                };
                
                const org = this.organizeCaps((p) as playerid);
                node.stash.push(...org.triosMono.map((s) => this.renderStashHelper(s)));
                node.stash.push(...org.triosMixed.map((s) => this.renderStashHelper(s)));
                node.stash.push(...org.partialsMono.map((s) => this.renderStashHelper(s)));
                node.stash.push(...org.partialsMixed.map((s) => this.renderStashHelper(s)));
                node.stash.push(...org.miscellaneous.map((s) => this.renderStashHelper([s])));
                areas.push(node);
                
            }
        }

        if (areas.length > 0) {
            //console.log("Testing areas: " + JSON.stringify(areas));
            rep.areas = areas;
        }

        console.log("Testing areas:");
        console.log(JSON.stringify(rep));
        
        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [toX, toY] = StawvsGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                } else if (move.type === "move") {
                    //The move.
                    const [fromX, fromY] = StawvsGame.algebraic2coords(move.from);
                    const [toX, toY] = StawvsGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    //The capture.
                    const [capX, capY] = StawvsGame.algebraic2coords(move.how!);
                    rep.annotations.push({type: "glyph", glyph: "note", targets: [{row: capY, col: capX}]});
                    rep.annotations.push({type: "move", style: "dashed", targets: [{row: toY, col: toX}, {row: capY, col: capX}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
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
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }]
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place", "pass", "winners", "eog", "deltaScore"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.stawvs", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.stawvs", {player, what: r.what, from: r.from, to: r.to, how: r.how}));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.simple", {player}));
                resolved = true;
                break;
            case "eliminated":
                node.push(i18next.t("apresults:ELIMINATED", {player}));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.stawvs", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): StawvsGame {
        return new StawvsGame(this.serialize());
    }
}
