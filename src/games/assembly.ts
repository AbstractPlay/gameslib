import { GameBaseSimultaneous, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { AnnotationBasic, APRenderRep, AreaPieces, Colourfuncs, Glyph, MarkerFlood, MarkerGlyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
type CellContents = "R"|"G"|"B"|"Y";

const sortContents = (a: CellContents, b: CellContents): number => {
    const valA = a === "R" ? 3 : a === "B" ? 2 : a === "G" ? 1 : -5;
    const valB = b === "R" ? 3 : b === "B" ? 2 : b === "G" ? 1 : -5;
    return valB - valA;
}

export interface IMoveState extends IIndividualState {
    line: (CellContents|null)[];
    bag: CellContents[];
    lastmove?: string;
    scores: [number,number];
};

export interface IAssemblyState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    board: playerid[];
};

export class AssemblyGame extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "Assembly Line",
        uid: "assembly",
        playercounts: [2],
        version: "20250330",
        dateAdded: "2025-03-30",
        // i18next.t("apgames:descriptions.assembly")
        description: "apgames:descriptions.assembly",
        urls: [
            "https://boardgamegeek.com/boardgame/6568/assembly-line",
        ],
        people: [
            {
                type: "designer",
                name: "Stephen Glenn",
                urls: ["https://boardgamegeek.com/boardgamedesigner/2118/stephen-glenn"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {uid: "defective"}
        ],
        categories: ["goal>score>eog", "mechanic>displace",  "mechanic>simultaneous", "mechanic>random>setup", "mechanic>random>play", "board>shape>rect", "board>connect>rect", "components>simple>5c"],
        flags: ["simultaneous", "scores", "custom-buttons", "custom-colours"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 1);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 1);
    }

    public numplayers = 2;
    public board!: playerid[];
    public line!: (CellContents|null)[];
    public bag!: CellContents[];
    public scores!: [number,number];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];
    public lastmove?: string;

    constructor(state?: IAssemblyState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAssemblyState;
            }
            if (state.game !== AssemblyGame.gameinfo.uid) {
                throw new Error(`The Assembly Line game code cannot process a game of '${state.game}'.`);
            }
            this.variants = [...state.variants];
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
            this.board = [...state.board];
        } else {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const bag: CellContents[] = [
                "R","R","R","R","R","R",
                "B","B","B","B","B","B",
                "G","G","G","G","G","G",
            ];
            if (this.variants.includes("defective")) {
                bag.push("Y");
            }
            const line: (CellContents|null)[] = Array.from({length: 18}, () => null);
            this.board = shuffle([...Array.from({length: 9}, () => 1), ...Array.from({length: 9}, () => 2)]) as playerid[];
            const fresh: IMoveState = {
                _version: AssemblyGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                bag,
                line,
                scores: [0,0],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): AssemblyGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.bag = [...state.bag];
        this.line = [...state.line];
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        return this;
    }

    public getButtons(): ICustomButton[] {
        return [
            {label: "numbers.one", move: "1"},
            {label: "numbers.two", move: "2"},
            {label: "numbers.three", move: "3"},
        ];
    }

    public getPlayerColour(p: playerid): number|string|Colourfuncs {
        if (p === 1) {
            return "_context_background";
        } else {
            return {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5,
            };
        }
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        return ["1","2","3"];
    }

    public randomMove(): string {
        const allmoves = this.moves();
        const move1 = allmoves[Math.floor(Math.random() * allmoves.length)];
        const move2 = allmoves[Math.floor(Math.random() * allmoves.length)];
        return `${move1}, ${move2}`;
    }

    public handleClickSimultaneous(move: string, row: number, col: number, player: playerid, piece?: string): IClickResult {
        try {
            const newmove = "";
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.assembly.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (!["1","2","3"].includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.assembly.BAD_MOVE");
            return result;
        }

        // valid final move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): AssemblyGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const moves: string[] = m.split(/\s*,\s*/);
        if (moves.length !== 2) {
            throw new UserFacingError("MOVES_SIMULTANEOUS_PARTIAL", i18next.t("apgames:MOVES_SIMULTANEOUS_PARTIAL"));
        }
        for (let i = 0; i < moves.length; i++) {
            if ( (partial) && ( (moves[i] === undefined) || (moves[i] === "") ) ) {
                continue;
            }
            moves[i] = moves[i].toLowerCase();
            moves[i] = moves[i].replace(/\s+/g, "");
            if (! trusted) {
                const result = this.validateMove(moves[i]);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
                // if (! ((partial && moves[i] === "") || this.moves().includes(moves[i]))) {
                //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                // }
            }
        }
        if (partial) {
            return this;
        }

        this.results = [];
        // if moves are the same, possible scoring
        if (moves[0] === moves[1]) {
            let left: string|undefined; let right: string|undefined;
            if (this.lastmove !== undefined) {
                [left, right] = this.lastmove.split(",");
            }
            // if lastmove is undefined or the same (already scored), then pass
            if (this.lastmove === undefined || left === right) {
                this.results.push({type: "pass"});
            }
            // score as usual
            else {
                let d1 = 0;
                let d2 = 0;
                for (let i = 0; i < 18; i++) {
                    if (this.line[i] !== null) {
                        const pc = this.line[i];
                        const val = pc === "R" ? 3 : pc === "B" ? 2 : pc === "G" ? 1 : -5;
                        if (this.board[i] === 1) {
                            d1 += val;
                        } else {
                            d2 += val;
                        }
                    }
                }
                this.scores[0] += d1;
                this.scores[1] += d2;
                this.results.push({type: "pass"});
                this.results.push({type: "deltaScore", delta: d1, who: 1});
                this.results.push({type: "deltaScore", delta: d2, who: 2});
            }
        }
        // otherwise, move the line
        else {
            const dist = parseInt(moves[0], 10) + parseInt(moves[1], 10);
            const shuffled = shuffle([...this.bag]) as CellContents[];
            const truncated = [...this.line.slice(0, dist * -1)];
            while (truncated.length < 18) {
                const next = shuffled.pop();
                if (next === undefined) {
                    truncated.unshift(null);
                } else {
                    truncated.unshift(next);
                }
            }
            this.bag = [...shuffled].sort(sortContents);
            this.line = [...truncated];
            this.results.push({type: "eject", from: "0", to: dist.toString()});
        }

        this.lastmove = [...moves].join(',');
        this.checkEOG();
        this.saveState();
        return this;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [...this.scores] },
        ]
    }

    protected checkEOG(): AssemblyGame {
        if (this.line.filter(c => c !== null).length === 0 && this.bag.length === 0) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public state(): IAssemblyState {
        return {
            game: AssemblyGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            board: [...this.board],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AssemblyGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: this.lastmove,
            line: [...this.line],
            bag: [...this.bag].sort(sortContents),
            scores: [...this.scores],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let col = 0; col < 18; col++) {
            if (this.line[col] !== null) {
                pstr += this.line[col];
            } else {
                pstr += "-";
            }
        }

        const legend: {[k: string]: string | Glyph | [Glyph, ...Glyph[]];} = {
            R: [
                {
                    name: "piece",
                    colour: 1,
                },
                {
                    text: "3",
                    colour: {
                        func: "bestContrast",
                        bg: 1,
                        fg: [
                            "_context_strokes",
                            "_context_fill",
                        ]
                    },
                }
            ],
            B: [
                {
                    name: "piece",
                    colour: 2,
                },
                {
                    text: "2",
                    colour: {
                        func: "bestContrast",
                        bg: 2,
                        fg: [
                            "_context_strokes",
                            "_context_fill",
                        ]
                    },
                }
            ],
            G: [
                {
                    name: "piece",
                    colour: 3,
                },
                {
                    text: "1",
                    colour: {
                        func: "bestContrast",
                        bg: 3,
                        fg: [
                            "_context_strokes",
                            "_context_fill",
                        ]
                    },
                }
            ],
            Y: [
                {
                    name: "piece",
                    colour: 4,
                },
                {
                    text: "-5",
                    colour: {
                        func: "bestContrast",
                        bg: 4,
                        fg: [
                            "_context_strokes",
                            "_context_fill",
                        ]
                    },
                }
            ],
            X: {
                "text": "\u2192"
            },
        };

        const markers: (MarkerFlood|MarkerGlyph)[] = [];
        const pts: RowCol[] = [];
        for (let i = 0; i < 18; i++) {
            pts.push({row: 0, col: i});
        }
        markers.push({
            type: "glyph",
            glyph: "X",
            points: pts as [RowCol, ...RowCol[]],
        });
        const p2pts: RowCol[] = [];
        for (let i = 0; i < 18; i++) {
            if (this.board[i] === 2) {
                p2pts.push({row: 0, col: i});
            }
        }
        markers.push({
            type: "flood",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5
            },
            points: p2pts as [RowCol, ...RowCol[]],
        });

        const areas: AreaPieces[] = [];
        if (this.bag.length > 0) {
            areas.push({
                type: "pieces",
                label: i18next.t("apgames:validation.assembly.LABEL_BAG") || "Bag",
                pieces: [...this.bag] as [string, ...string[]],
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: 18,
                maxWidth: 18,
                markers,
            },
            legend,
            pieces: pstr,
            areas: areas.length === 0 ? undefined : areas,
        };

        if (this.results.length > 0) {
            rep.annotations = [] as AnnotationBasic[];
            for (const move of this.results) {
                if (move.type === "eject") {
                    const to = parseInt(move.to, 10) - 1;
                    rep.annotations.push({
                        type: "move",
                        targets: [{row: 0, col: 0}, {row: 0, col: to}],
                    });
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        status += `Player 1: ${this.scores[0]}\n\n`;
        status += `Player 2: ${this.scores[1]}\n\n`;
        return status;
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                for (const r of state._results) {
                    switch (r.type) {
                        case "pass":
                            node.push(i18next.t("apresults:PASS.assembly"));
                            break;
                        case "eject": {
                            const dist = parseInt(r.to, 10);
                            node.push(i18next.t("apresults:EJECT.assembly", {distance: dist}));
                            break;
                        }
                        case "deltaScore":
                            node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {count: r.delta, delta: r.delta, player: players[r.who! - 1]}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG.default"));
                            break;
                        case "resigned": {
                            let rname = `Player ${r.player}`;
                            if (r.player <= players.length) {
                                rname = players[r.player - 1]
                            }
                            node.push(i18next.t("apresults:RESIGN", {player: rname}));
                            break;
                        }
                        case "winners": {
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

    public getCustomRotation(): number | undefined {
        return 0;
    }

    public clone(): AssemblyGame {
        return new AssemblyGame(this.serialize());
    }
}
