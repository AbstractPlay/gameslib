import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { AnnotationTree, APRenderRep, AreaPieces, Glyph, PiecesTree } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
import { Card, Deck, Component, cardSortAsc, cardsBasic, cardsExtended, suits as decktetSuits } from "../common/decktet";
import { DirectedGraph } from "graphology";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export type Node = {
    id: string;
    glyph?: string;
    parents: string[];
    owner?: playerid;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Node[];
    hands: string[][];
    lastmove?: string;
};

export interface ISiegeOfJState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export class SiegeOfJGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Siege of Jacynth",
        uid: "siegeofj",
        playercounts: [2],
        version: "20250523",
        dateAdded: "2024-12-15",
        // i18next.t("apgames:descriptions.siegeofj")
        description: "apgames:descriptions.siegeofj",
        // i18next.t("apgames:notes.siegeofj")
        notes: "apgames:notes.siegeofj",
        urls: [
            "http://wiki.decktet.com/game:siege-of-jacynth",
        ],
        people: [
            {
                type: "designer",
                name: "Greg James",
                urls: ["http://wiki.decktet.com/designer:greg-james"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "open", group: "rules" },
            { uid: "full", group: "rules" },
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>network", "mechanic>hidden", "board>dynamic", "components>decktet"],
        flags: ["experimental", "random-start", "no-explore", "scores"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Node[];
    public hands: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private deck!: Deck;
    private node2parents = new Map<string, string[]>();
    private node2children = new Map<string, string[]>();
    private node2owner = new Map<string, playerid>();
    private orgBoard: Node[][] = [];
    private selected: string|undefined;

    constructor(state?: ISiegeOfJState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            // init deck
            // all basic cards except aces and crowns
            const cards = [...cardsBasic].filter(c => c.rank.uid !== "1" && c.rank.uid !== "N");
            const deck = new Deck(cards);
            deck.shuffle();

            // init hands
            const hands: string[][] = [];
            let handSize = 5;
            if (this.variants.includes("full")) {
                handSize = 12;
            }
            for (let i = 0; i < this.numplayers; i++) {
                hands.push(deck.draw(handSize).map(c => c.uid));
            }

            // init board
            const excuse = cardsExtended.find(c => c.uid === "0");
            if (excuse === undefined) {
                throw new Error("Could not find The Excuse in the extended deck.");
            }
            const excuseIdx = randomInt(6, 0);
            const suits = shuffle([...decktetSuits, ...decktetSuits]) as Component[];
            const startpos = [];
            for (let i = 0; i < 7; i++) {
                if (i === excuseIdx) {
                    startpos.push(excuse.uid);
                } else {
                    const suit1 = suits.pop();
                    const suit2 = suits.pop();
                    if (suit1 === undefined || suit2 === undefined) {
                        throw new Error("Could not create a root card due to not having enough suits.");
                    }
                    const card = Card.deserialize(`1${suit1.uid}${suit2.uid}`, true);
                    if (card === undefined) {
                        throw new Error(`Something went wrong when deserializing the card ${`1${suit1.uid}${suit2.uid}`}`);
                    }
                    startpos.push(card.uid);
                }
            }
            if (startpos.length !== 7 || suits.length > 0) {
                throw new Error("An error occurred while initializing the wall.");
            }
            const board: Node[] = [];
            startpos.forEach((c, idx) => board.push({id: `wall${idx+1}(${c !== "0" ? c.substring(1) : "0"})`, glyph: c, parents: []}));

            const fresh: IMoveState = {
                _version: SiegeOfJGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISiegeOfJState;
            }
            if (state.game !== SiegeOfJGame.gameinfo.uid) {
                throw new Error(`The SiegeOfJ engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    private extrapolate(): void {
        // init node maps
        this.board.forEach(n => {
            this.node2children.set(n.id, []);
            this.node2parents.set(n.id, n.parents);
            if (n.owner !== undefined) {
                this.node2owner.set(n.id, n.owner);
            }
        });
        for (const node of this.board) {
            for (const parent of node.parents) {
                const curr = this.node2children.get(parent)!;
                this.node2children.set(parent, [...curr, node.id])
            }
        }
        this.orgBoard = [];
        const roots = this.board.filter(n => n.parents.length === 0);
        this.orgBoard.push(roots);
        while (this.orgBoard.flat().length < this.board.length) {
            const currIds = new Set<string>(this.orgBoard[this.orgBoard.length - 1].map(n => n.id));
            const children = this.board.filter(n => n.parents?.some(p => currIds.has(p)));
            // if none were found, then an error has happened somewhere
            if (children.length === 0) {
                throw new Error("An error occurred while processing tree nodes.");
            }
            this.orgBoard.push([...children]);
        }
    }

    public load(idx = -1): SiegeOfJGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Node[];
        this.hands = state.hands.map(h => [...h]);
        this.lastmove = state.lastmove;

        // init node maps
        this.extrapolate();

        // Deck is reset every time you load
        const cards = [...cardsBasic].filter(c => c.rank.uid !== "1" && c.rank.uid !== "N");
        this.deck = new Deck(cards);
        // remove cards from the deck that are on the board or in known hands
        for (const uid of this.board.filter(n => n.owner !== undefined).map(n => n.id)) {
            this.deck.remove(uid);
        }
        for (const hand of this.hands) {
            for (const uid of hand) {
                this.deck.remove(uid);
            }
        }
        this.deck.shuffle();

        return this;
    }

    public get graph(): DirectedGraph {
        const g = new DirectedGraph();
        this.board.forEach(node => {
            if (!g.hasNode(node.id)) {
                g.addNode(node.id);
            }
            node.parents.forEach(parent => {
                if (!g.hasNode(parent)) {
                    g.addNode(parent);
                }
                if (!g.hasEdge(parent, node.id)) {
                    g.addEdge(parent, node.id);
                }
            });
        });
        return g;
    }

    public getAdjacent(card: string): string[] {

        const areAdj = (card1: string, card2: string): boolean => {
            // cards are adjacent if
            // - they are root cards that are next to each other OR
            // - they each have exactly one parent AND those parents are adjacent OR
            // - they share a parent

            const parents1 = this.node2parents.get(card1)!;
            const parents2 = this.node2parents.get(card2)!;

            // roots
            if (parents1.length === 0 && parents2.length === 0) {
                const idx1 = this.board.findIndex(n => n.id === card1);
                const idx2 = this.board.findIndex(n => n.id === card2);
                if (idx1 >= 0 && idx2 >= 0 && Math.abs(idx1 - idx2) === 1) {
                    return true;
                }
            }
            // adjacent parents
            else if (parents1.length === 1 && parents2.length === 1) {
                return areAdj(parents1[0], parents2[0]);
            }
            // share parents
            else if (parents1.filter(n => parents2.includes(n)).length > 0) {
                return true;
            }

            // if we get here, definitely not adjacent
            return false;
        }

        const adj: string[] = [];
        const sets = this.orgBoard.map(row => new Set<string>(row.map(n => n.id)));
        const idx = sets.findIndex(r => r.has(card));
        if (idx >= 0) {
            // if the card is a root, just return the cards on either side
            if (idx === 0) {
                const rootIdx = this.orgBoard[0].findIndex(n => n.id === card);
                if (rootIdx > 0) {
                    adj.push(this.orgBoard[0][rootIdx - 1].id);
                }
                if (rootIdx < this.orgBoard[0].length - 1) {
                    adj.push(this.orgBoard[0][rootIdx + 1].id);
                }
            } else {
                const row = this.orgBoard[idx].filter(n => n.id !== card);
                for (const n of row) {
                    if (areAdj(card, n.id)) {
                        adj.push(n.id);
                    }
                }
            }
        }
        return adj;
    }

    public get slots(): string[][] {
        const slots: string[][] = [];
        // all cards with no children are slots
        // cards with no children may also be able to share a slot with an adjacent card
        const childless = [...this.node2children.entries()].filter(([,c]) => c.length === 0).map(([n,]) => n);
        for (const node of childless) {
            slots.push([node]);
            const adjs = this.getAdjacent(node);
            // to share an adjacent slot, the adjacent can have at most one child, and that child must have two parents
            for (const adj of adjs) {
                const children = this.node2children.get(adj)!;
                if (children.length === 0 || (children.length === 1 && this.node2parents.get(children[0])!.length === 2)) {
                    slots.push([node, adj]);
                }
            }
        }
        // all cards with one child are *potential* slots
        // the child must have two parents, and there must be an adjacent card that is NOT one of those parents, and that adjacent card must have 0 children or a single child with two parents
        const singles = [...this.node2children.entries()].filter(([,c]) => c.length === 1).map(([n,]) => n);
        for (const node of singles) {
            const child = this.node2children.get(node)![0];
            const parents = this.node2parents.get(child)!;
            if (parents.length === 2) {
                const adjs = this.getAdjacent(node).filter(n => !parents.includes(n));
                if (adjs.length > 0) {
                    const adj = adjs[0];
                    const adjChildren = this.node2children.get(adj);
                    let adjFree: boolean;
                    if (adjChildren === undefined || adjChildren.length === 0) {
                        adjFree = true;
                    } else if (adjChildren.length === 2) {
                        adjFree = false;
                    } else {
                        const adjParents = this.node2parents.get(adjChildren[0])!;
                        if (adjParents.length === 2) {
                            adjFree = true;
                        } else {
                            adjFree = false;
                        }
                    }
                    if (adjFree) {
                        slots.push([node, adjs[0]]);
                    }
                }
            }
        }
        return slots;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        for (const card of this.hands[player - 1]) {
            for (const slot of this.slots) {
                moves.push(`${card}>${slot.join("+")}`);
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // in this handler, row and col are ignore, and piece is always passed
    public handleClick(move: string, row: number, col: number, piece: string): IClickResult {
        try {
            let newmove = "";
            const hand = this.hands[this.currplayer - 1];
            const clicked = piece.startsWith("wall") ? piece : piece.substring(1);
            // clicking on your hand
            if (hand.includes(clicked) || move === "") {
                newmove = clicked;
            }
            // otherwise, on the board
            else {
                const [placed, last] = move.split(">");
                if (move.includes(">")) {
                    const [last1, last2] = last.split("+");
                    // if clicking the last-clicked card, deselect
                    if (clicked === last2) {
                        newmove = `${placed}>${last1}`;
                    }
                    // ditto
                    else if (clicked === last1) {
                        newmove = placed;
                    }
                    // adding a second parent
                    else if (last1 !== undefined && last1.length > 0) {
                        newmove = `${placed}>${last1}+${clicked}`;
                    }
                }
                // adding the first parent
                else {
                    newmove = `${placed}>${clicked}`;
                }
            }

            // autocomplete
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toUpperCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/WALL/g, "wall");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.siegeofj.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            // this is the only legal move
            if (matches.length === 1) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // double parents is possible
            else {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.siegeofj.VALID_BUT");
                return result;
            }
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.siegeofj.PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.siegeofj.INVALID_MOVE");
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): SiegeOfJGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toUpperCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/WALL/g, "wall");
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.selected = undefined;
        if (!m.includes(">")) {
            this.selected = m;
        }

        if (m.includes(">")) {
            const [placed, targets] = m.split(">");
            const parents = targets.split("+");
            this.board.push({
                id: placed,
                parents,
                owner: this.currplayer,
            });
            this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(c => c !== placed);
            this.extrapolate();
            const card = Card.deserialize(placed);
            if (card === undefined) {
                throw new Error(`Could not load the card ${placed}.`);
            }
            let where = "";
            for (const p of parents) {
                // not all node ids are valid cards (the wall)
                let c = p;
                if (p.startsWith("wall")) {
                    const node = this.board.find(n => n.id === p);
                    if (node !== undefined) {
                        c = node.glyph!;
                    }
                }
                const obj = Card.deserialize(c, true);
                if (obj === undefined) {
                    throw new Error(`Could not load the card ${p}.`);
                }
                let plain = obj.plain;
                if (obj.name === "_custom") {
                    plain = ["Wall", ...obj.suits.map(s => s.name)].join(" ")
                }
                if (where.length === 0) {
                    where = plain;
                } else {
                    where += `, ${plain}`;
                }
            }
            this.results.push({type: "place", what: card.plain, where, how: card.uid});
        }

        if (partial || emulation ) { return this; }

        // draw new card
        const [drawn] = this.deck.draw();
        if (drawn !== undefined) {
            this.hands[this.currplayer - 1].push(drawn.uid);
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

    // must always start with a root card
    // but never returns root cards
    public cardsConnectedTo(card: string): Node[] {
        if (!this.node2parents.has(card)) {
            throw new Error(`Could not find the card ${card} on the board.`);
        }
        if (this.node2parents.get(card)!.length > 0) {
            throw new Error(`The card ${card} is not a root card.`);
        }
        const g = this.graph;
        const visited = new Set<string>();
        const toVisit: string[] = [card];
        while (toVisit.length > 0) {
            const node = toVisit.shift()!;
            if (visited.has(node)) {
                continue;
            }
            visited.add(node);
            g.outNeighbors(node).forEach(n => {
                if (!visited.has(n)) {
                    toVisit.push(n);
                }
            });
        }
        visited.delete(card);
        return this.board.filter(n => visited.has(n.id));
    }

    public get tieBreaker(): [number,number] {
        const suits: [string[],string[]] = [[], []];
        for (const node of this.orgBoard[0]) {
            const cardObj = Card.deserialize(node.id.startsWith("wall") ? node.glyph! : node.id, true)!;
            if (cardObj.uid === "0") {
                continue;
            }
            const rootSuits = new Set<string>();
            cardObj.suits.forEach(s => rootSuits.add(s.uid));
            const nodes = this.cardsConnectedTo(node.id);
            for (const p of [1,2] as const) {
                const theirs = nodes.filter(n => n.owner === p);
                const theirSuits = theirs.map(c => Card.deserialize(c.id)!.suits.map(s => s.uid)).flat().filter(s => rootSuits.has(s));
                suits[p - 1].push(...theirSuits);
            }
        }
        return [suits[0].length, suits[1].length];
    }

    public winnerOf(card: string): playerid|null {
        if (!this.node2parents.has(card)) {
            throw new Error(`Could not find the card ${card} on the board.`);
        }
        if (this.node2parents.get(card)!.length > 0) {
            throw new Error(`The card ${card} is not a root card.`);
        }
        // console.log(`Looking for the winner of ${card}`);
        const node = this.board.find(n => n.id === card)!;
        const cardObj = Card.deserialize(node.glyph!, true)!;
        const rootSuits = new Set<string>();
        cardObj.suits.forEach(s => rootSuits.add(s.uid));
        const nodes = this.cardsConnectedTo(card);
        // ace/crown pairs first
        if (cardObj.uid !== "0") {
            const suits: [string[],string[]] = [[], []];
            const sums: [number,number] = [0, 0];
            for (const p of [1,2] as const) {
                const theirs = nodes.filter(n => n.owner === p);
                const theirSuits = theirs.map(c => Card.deserialize(c.id)!.suits.map(s => s.uid)).flat().filter(s => rootSuits.has(s));
                if (theirSuits.length >= 2) {
                    const includesAll = [...rootSuits].reduce((acc, curr) => acc && theirSuits.includes(curr), true);
                    if (includesAll) {
                        suits[p - 1] = [...theirSuits];
                    }
                }
                sums[p - 1] = theirs.map(c => Card.deserialize(c.id)!.rank.seq).reduce((acc, curr) => acc + curr, 0);
            }

            // if only one player satisfies the base conditions, they win outright
            // otherwise nobody wins
            if (suits[0].length === 0 && suits[1].length === 0) {
                // console.log(`nobody satisfies the base condition`)
                return null;
            } else if (suits[0].length > 0 && suits[1].length === 0) {
                // console.log(`1 wins due to conditions`)
                return 1;
            } else if (suits[1].length > 0 && suits[0].length === 0) {
                // console.log(`2 wins due to conditions`)
                return 2;
            } else {
                if (suits[0].length > suits[1].length) {
                    // console.log(`1 wins due to suits`)
                    return 1;
                } else if (suits[1].length > suits[0].length) {
                    // console.log(`2 wins due to suits`)
                    return 2;
                } else {
                    if (sums[0] > sums[1]) {
                        // console.log(`1 wins due to sums`)
                        return 1;
                    } else if (sums[1] > sums[0]) {
                        // console.log(`2 wins due to sums`)
                        return 2;
                    } else {
                        // console.log(`full tie\n${JSON.stringify(suits)}\n${JSON.stringify(sums)}`);
                        return null;
                    }
                }
            }
        }
        // excuse is special
        else {
            const suits: [string[],string[]] = [[], []];
            const sums: [number,number] = [0, 0];
            for (const p of [1,2] as const) {
                const theirs = nodes.filter(n => n.owner === p);
                const theirSuits = theirs.map(c => Card.deserialize(c.id)!.suits.map(s => s.uid)).flat();
                suits[p - 1] = [...theirSuits];
                sums[p - 1] = theirs.map(c => Card.deserialize(c.id)!.rank.seq).reduce((acc, curr) => acc + curr, 0);
            }
            if (sums[0] > sums[1]) {
                // console.log(`1 wins due to sums`)
                return 1;
            } else if (sums[1] > sums[0]) {
                // console.log(`2 wins due to sums`)
                return 2;
            } else {
                if (suits[0].length > suits[1].length) {
                    // console.log(`1 wins due to suits`)
                    return 1;
                } else if (suits[1].length > suits[0].length) {
                    // console.log(`1 wins due to suits`)
                    return 2;
                } else {
                    // console.log(`full tie\n${JSON.stringify(suits)}\n${JSON.stringify(sums)}`);
                    return null;
                }
            }
        }
    }

    protected checkEOG(): SiegeOfJGame {
        // 24 cards 2-9, + 6 ace/crown pairs + The Excuse
        if (this.board.length === 31) {
            this.gameover = true;
            const scores: number[] = [this.getPlayerScore(1), this.getPlayerScore(2)];
            if (scores[0] > scores[1]) {
                this.winner = [1];
            } else if (scores[1] > scores[0]) {
                this.winner = [2];
            } else {
                const tb = this.tieBreaker;
                if (tb[0] > tb[1]) {
                    this.winner = [1];
                } else if (tb[1] > tb[0]) {
                    this.winner = [2];
                } else {
                    this.winner = [1,2];
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

    public state(opts?: {strip?: boolean, player?: number}): ISiegeOfJState {
        const state: ISiegeOfJState = {
            game: SiegeOfJGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
        if (opts !== undefined && opts.strip) {
            if (!this.variants.includes("open") && this.deck.size > 0) {
                state.stack = state.stack.map(mstate => {
                    for (let p = 1; p <= this.numplayers; p++) {
                        if (p === opts.player) { continue; }
                        mstate.hands[p-1] = [];
                    }
                    return mstate;
                });
            }
        }
        return state;
    }

    public moveState(): IMoveState {
        return {
            _version: SiegeOfJGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Node[],
            hands: this.hands.map(h => [...h]),
        };
    }

    public render(): APRenderRep {
        // build legend of real cards
        const allcards = [...cardsBasic].filter(c => c.rank.uid !== "1" && c.rank.uid !== "N");
        const legend: ILegendObj = {};
        for (const card of allcards) {
            let glyph = card.toGlyph();
            // colour the selected card in their hand
            if (this.selected === card.uid) {
                glyph = card.toGlyph({border: true, fill: {
                            func: "flatten",
                            fg: "_context_fill",
                            bg: "_context_background",
                            opacity: 0.2,
                        }
                });
            }
            // all other on-board cards need to have a border
            else if (this.node2parents.has(card.uid)) {
                const fill = this.node2owner.get(card.uid)!;
                glyph = card.toGlyph({border: true, fill, opacity: 0.25});
            }
            legend["c" + card.uid] = glyph;
        }
        // roots are handled differently
        for (const card of this.orgBoard[0]) {
            const obj = Card.deserialize(card.glyph!, true);
            if (obj === undefined) {
                throw new Error(`Unable to deserialize the card ${card.id}`);
            }
            let glyph = obj.toGlyph({border: true});
            // colour the root cards by winner
            const winner = this.winnerOf(card.id);
            if (winner !== null) {
                glyph = obj.toGlyph({border: true, fill: winner, opacity: 0.25})
            }
            legend["c" + obj.uid] = glyph;
        }

        // build pieces areas
        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const hand = this.hands[p-1];
            if (hand.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: hand.map(c => "c" + c) as [string, ...string[]],
                    label: i18next.t("apgames:validation.siegeofj.LABEL_STASH", {playerNum: p}) || `P${p} hand`,
                    spacing: 0.5,
                    width: 6,
                });
            }
        }
        // create an area for all invisible cards (if there are any cards left)
        const hands = this.hands.map(h => [...h]);
        const visibleCards = [...[...this.board].map(n => n.id), ...hands.flat()];
        const remaining = allcards.sort(cardSortAsc).filter(c => !visibleCards.includes(c.uid)).map(c => "c" + c.uid) as [string, ...string[]]
        if (remaining.length > 0) {
            areas.push({
                type: "pieces",
                label: i18next.t("apgames:validation.jacynth.LABEL_REMAINING") || "Cards in deck",
                spacing: 0.25,
                pieces: remaining,
                width: 6,
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "tree-pyramid",
            board: {
                style: "other",
                tileSpacing: 0.2,
            },
            legend,
            pieces: this.board.map(n => {
                return {
                    id: n.id.startsWith("wall") ? n.id : `c${n.id}`,
                    glyph: n.glyph === undefined ? undefined : `c${n.glyph}`,
                    parents: n.parents.length === 0 ? null : n.parents.map(p => p.startsWith("wall") ? p : "c" + p),
                };
            }) as PiecesTree,
            areas: areas.length > 0 ? areas : undefined,
            annotations: [
                {type: "rule"}
            ]
        };

        // Add annotations
        if (this.results.length > 0) {
            // rep.annotations = [] as AnnotationTree[];
            for (const move of this.results) {
                if (move.type === "place") {
                    (rep.annotations! as AnnotationTree[]).push({type: "enter", nodes: ["c" + move.how!]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        for (const node of this.orgBoard[0]) {
            if (this.winnerOf(node.id) === player) {
                score++;
            }
        }
        return score;
    }

    public getPlayersScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        const combined: string[] = [];
        if (scores[0] === scores[1]) {
            const tb = this.tieBreaker;
            for (let i = 0; i < this.numplayers; i++) {
                combined.push(`${scores[i]} (${tb[i]})`);
            }
        } else {
            combined.push(scores[0].toString(), scores[1].toString());
        }
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: combined},
        ];
    }

    public getStartingPosition(): string {
        return this.orgBoard[0].map(n => n.id).join(",");
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.siegeofj", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SiegeOfJGame {
        return Object.assign(new SiegeOfJGame(), deepclone(this) as SiegeOfJGame);
    }
}
