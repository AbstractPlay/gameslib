import {
  IAPGameState,
  IClickResult,
  IIndividualState,
  IScores,
  IValidationResult,
  chatPlayerToken,
  type ChatLogCollectContext,
  type ChatLogLine,
} from "./_base.js";
import { GameBaseSequenced } from "./_turn-sequenced.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { type FlagContext, type GameFlag } from "./_base.js";
import type { APRenderRep, Colourfuncs, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import { DvonnGraph } from "../common/graphs/dvonn.js";
import i18next from "i18next";
import {
  allLegalMoves,
  applyStackMove,
  cloneBoard,
  isSurrounded,
  legalDestinations,
  removeIsolated,
} from "./dvonn/move.js";
import { parsePlayMove, parseSetupPlace } from "./dvonn/notation.js";
import {
  buildRandomSetupBoard,
  cloneReserves,
  emptyReserves,
  initialReserves,
  reserveForDisc,
  serializeBoard,
  setupComplete,
  setupDisc,
  stackFromDisc,
} from "./dvonn/setup.js";
import {
  DVONN_FILL,
  GIPF_P1,
  GIPF_P2,
  GIPF_PIECE_BORDER,
  type CellStack,
  type Phase,
  type playerid,
  type Reserves,
  type StackDisc,
  isDvonnDisc,
} from "./dvonn/types.js";
import { bothImmobilized, controlledPieceCount, resolveWinner } from "./dvonn/win.js";

const BASIC_OVERLAY_SCALE = 0.85;

function contrastBorder(fill: Colourfuncs, palette: 3 | 4): Colourfuncs {
  return {
    func: "custom",
    default: { func: "bestContrast", bg: fill, fg: ["#000000", "#ffffff"] },
    palette,
  };
}

function basicPieceLegend(fill: Colourfuncs, borderPalette: 3 | 4): [Glyph, Glyph] {
  const border: Colourfuncs = { func: "custom", default: GIPF_PIECE_BORDER, palette: borderPalette };
  return [
    { name: "piece", paint: { fill, border } },
    {
      name: "piece",
      scale: BASIC_OVERLAY_SCALE,
      paint: { fill, border: contrastBorder(fill, borderPalette) },
    },
  ];
}

function dvonnPieceLegend(fill: Colourfuncs): [Glyph, Glyph] {
  const border: Colourfuncs = { func: "custom", default: GIPF_PIECE_BORDER, palette: 5 };
  const innerBorder: Colourfuncs = {
    func: "custom",
    default: { func: "bestContrast", bg: fill, fg: ["#000000", "#ffffff"] },
    palette: 5,
  };
  return [
    { name: "piece", paint: { fill, border } },
    {
      name: "piece",
      scale: BASIC_OVERLAY_SCALE,
      paint: { fill, border: innerBorder },
    },
  ];
}

function discGlyph(disc: StackDisc): string {
  if (isDvonnDisc(disc)) {
    return "D";
  }
  return disc === 1 ? "W" : "X";
}

function stackGlyphs(pieces: StackDisc[]): string[] {
  return pieces.map((d) => discGlyph(d));
}

export const gameApgamesEn = {
  validation: {
    INITIAL_INSTRUCTIONS_SETUP: "Click an empty intersection to place the next piece from the setup queue.",
    INITIAL_INSTRUCTIONS: "Click one of your stacks, then click a legal destination.",
    NO_PASS: "You must make a move when one is available.",
    MUST_PASS: "You have no legal move; your turn will pass automatically.",
    OCCUPIED: "That intersection is already occupied.",
    EMPTY: "There is no stack at {{where}}.",
    NOT_YOUR_STACK: "You may only move a stack you control.",
    INVALID_MOVE: "That slide is not legal.",
    SURROUNDED: "Stacks that are surrounded on six sides may not move.",
    WRONG_SETUP_PIECE: "That is not the next piece due in the setup sequence.",
  },
  status: {
    CONTROLLED: "Controlled pieces",
  },
  variants: {
    quickstart: {
      name: "Quick start",
      description: "The full setup is dealt at random; player 1 moves first.",
    },
  },
};

export const gameApresultsEn = {
  REMOVE: {
    isolated_one: "1 stack was removed for losing contact with DVONN.",
    isolated_other: "{{count}} stacks were removed for losing contact with DVONN.",
  },
  PASS: {
    skipped: "{{player}} had no legal move and passed.",
  },
  EOG: {
    score: "{{player}} wins with {{count}} controlled pieces.",
    tie: "The game is a draw with {{count}} controlled pieces each.",
  },
};

export interface IMoveState extends IIndividualState {
  currplayer: playerid;
  phase: Phase;
  board: Map<string, CellStack>;
  reserves: Reserves;
  lastmove?: string;
}

export interface IDvonnState extends IAPGameState {
  winner: playerid[];
  stack: Array<IMoveState>;
}

export { playStartStackIndex } from "./dvonn/setup.js";

export class DvonnGame extends GameBaseSequenced {
  public static readonly gameinfo: APGamesInformation = {
    name: "DVONN",
    uid: "dvonn",
    playercounts: [2],
    version: "20261122",
    dateAdded: "2026-11-22",
    description:
      "Stack pieces on a hex grid and stay linked to the red DVONN pieces. Isolate enemy stacks, control the most discs when neither player can move, and win.",
    urls: [
      "https://www.gipf.com/dvonn/rules/rules.html",
      "https://boardgamegeek.com/boardgame/2346/dvonn",
    ],
    bggid: "2346",
    people: [
      {
        type: "designer",
        name: "Kris Burm",
        urls: ["https://www.gipf.com/"],
      },
      {
        type: "coder",
        name: "Aaron Dalton (Perlkönig)",
        urls: [],
        apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
      },
    ],
    variants: [{ uid: "quickstart" }],
    customizations: [
      { num: 1, default: GIPF_P1, explanation: "Player 1 basic piece fill", player: 1 },
      { num: 2, default: GIPF_P2, explanation: "Player 2 basic piece fill", player: 2 },
      { num: 3, default: GIPF_PIECE_BORDER, explanation: "Player 1 basic piece border", player: 1 },
      { num: 4, default: GIPF_PIECE_BORDER, explanation: "Player 2 basic piece border", player: 2 },
      { num: 5, default: DVONN_FILL, explanation: "DVONN piece fill" },
    ],
    categories: [
      "goal>score>eog",
      "mechanic>stack",
      "mechanic>place",
      "mechanic>move",
      "board>shape>hex",
      "board>connect>hex",
      "components>simple>1per",
      "family>gipf",
    ],
    flags: ["custom-colours", "automove", "scores", "experimental"],
  };

  public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
    const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
    if (context.variants?.includes("quickstart")) {
      flags.push("random-start");
    }
    return flags;
  }

  public readonly graph = new DvonnGraph();
  public numplayers = 2;
  public currplayer: playerid = 1;
  public phase: Phase = "setup";
  public board!: Map<string, CellStack>;
  public reserves!: Reserves;
  public gameover = false;
  public winner: playerid[] = [];
  public variants: string[] = [];
  public stack!: Array<IMoveState>;
  public results: Array<APMoveResult> = [];
  private moveHighlights: string[] = [];

  constructor(state?: IDvonnState | string, variants?: string[]) {
    super();
    if (state === undefined) {
      if (variants !== undefined) {
        this.variants = [...variants];
      }
      const quickstart = this.isQuickstart();
      const fresh: IMoveState = {
        _version: DvonnGame.gameinfo.version,
        _results: [],
        _timestamp: new Date(),
        currplayer: 1,
        phase: quickstart ? "play" : "setup",
        board: quickstart ? buildRandomSetupBoard(this.graph, this.rng) : new Map(),
        reserves: quickstart ? emptyReserves() : initialReserves(),
      };
      this.stack = [fresh];
    } else {
      if (typeof state === "string") {
        state = JSON.parse(state, reviver) as IDvonnState;
      }
      if (state.game !== DvonnGame.gameinfo.uid) {
        throw new Error(`The DVONN engine cannot process a game of '${state.game}'.`);
      }
      this.gameover = state.gameover;
      this.winner = [...state.winner];
      this.variants = [...state.variants];
      this.stack = [...state.stack];
    }
    this.load();
  }

  public isQuickstart(): boolean {
    return this.variants.includes("quickstart");
  }

  public getStartingPosition(): string {
    return serializeBoard(this.stack[0]!.board);
  }

  public load(idx = -1): DvonnGame {
    if (idx < 0) {
      idx += this.stack.length;
    }
    const s = this.stack[idx];
    if (s === undefined) {
      throw new Error("Could not load the requested state from the stack.");
    }
    this.currplayer = s.currplayer;
    this.phase = s.phase;
    this.board = cloneBoard(s.board);
    this.reserves = cloneReserves(s.reserves);
    this.lastmove = s.lastmove;
    this.results = this.resultsForDisplay(s._results, s.phase);
    this.moveHighlights = [];
    return this;
  }

  /** Render/validate UI: play omits setup-only place echoes; chat uses stack `_results`. */
  private resultsForDisplay(stored: APMoveResult[], phase: Phase): APMoveResult[] {
    if (phase === "play") {
      return stored.filter((r) => r.type !== "place");
    }
    return [...stored];
  }

  private rowCol(cell: string): RowCol {
    const [col, row] = this.graph.algebraic2coords(cell);
    return { row, col };
  }

  private clearMoveHighlights(): void {
    this.moveHighlights = [];
  }

  private syncMoveHighlightsFromMove(m: string): void {
    this.clearMoveHighlights();
    const fromOnly = /^([a-z]+\d+)-$/i.exec(m);
    if (fromOnly === null) {
      return;
    }
    const from = fromOnly[1]!.toLowerCase();
    if (this.board.get(from)?.owner !== this.currplayer) {
      return;
    }
    this.moveHighlights = legalDestinations(this.graph, this.board, from, this.currplayer);
  }

  private nextSetupDisc(): StackDisc {
    return setupDisc(this.board.size);
  }

  public legalMoves(player: playerid = this.currplayer): Array<{ from: string; to: string }> {
    if (this.phase !== "play" || this.gameover) {
      return [];
    }
    return allLegalMoves(this.graph, this.board, player);
  }

  public moves(player?: playerid): string[] {
    if (this.gameover) {
      return [];
    }
    const p = player ?? this.currplayer;
    if (this.phase === "setup") {
      return this.graph.playableCells()
        .filter((c) => !this.board.has(c))
        .sort((a, b) => a.localeCompare(b));
    }
    const legs = this.legalMoves(p);
    if (legs.length === 0) {
      return ["pass"];
    }
    return legs.map((mv) => `${mv.from}-${mv.to}`).sort((a, b) => a.localeCompare(b));
  }

  public validateMove(m: string): IValidationResult {
    const result: IValidationResult = {
      valid: false,
      message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
    };
    if (this.gameover) {
      result.message = i18next.t("apgames:validation._general.MOVES_GAMEOVER");
      return result;
    }
    m = m.toLowerCase().replace(/\s+/g, "");
    if (m.length === 0) {
      this.clearMoveHighlights();
      result.valid = true;
      result.complete = -1;
      result.canrender = true;
      result.message = this.phase === "setup"
        ? i18next.t("apgames:validation.dvonn.INITIAL_INSTRUCTIONS_SETUP")
        : i18next.t("apgames:validation.dvonn.INITIAL_INSTRUCTIONS");
      return result;
    }

    if (this.phase === "setup") {
      const cell = parseSetupPlace(m);
      if (cell === undefined) {
        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
        return result;
      }
      if (!this.graph.isPlayable(cell)) {
        result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
        return result;
      }
      if (this.board.has(cell)) {
        result.message = i18next.t("apgames:validation.dvonn.OCCUPIED");
        return result;
      }
      result.valid = true;
      result.complete = 1;
      result.message = i18next.t("apgames:validation.dvonn.INITIAL_INSTRUCTIONS_SETUP");
      return result;
    }

    if (m === "pass") {
      if (this.legalMoves(this.currplayer).length > 0) {
        result.message = i18next.t("apgames:validation.dvonn.NO_PASS");
        return result;
      }
      result.valid = true;
      result.complete = 1;
      result.message = i18next.t("apgames:validation.dvonn.MUST_PASS");
      return result;
    }

    const parsed = parsePlayMove(m);
    if (parsed === undefined) {
      const fromOnly = /^([a-z]+\d+)-$/i.exec(m);
      if (fromOnly !== null) {
        const from = fromOnly[1]!.toLowerCase();
        if (this.board.get(from)?.owner !== this.currplayer) {
          this.clearMoveHighlights();
          result.message = i18next.t("apgames:validation.dvonn.NOT_YOUR_STACK");
          return result;
        }
        const dests = legalDestinations(this.graph, this.board, from, this.currplayer);
        if (dests.length === 0) {
          this.clearMoveHighlights();
          if (isSurrounded(this.graph, this.board, from)) {
            result.message = i18next.t("apgames:validation.dvonn.SURROUNDED");
          } else {
            result.message = i18next.t("apgames:validation.dvonn.INVALID_MOVE");
          }
          return result;
        }
        result.valid = true;
        result.complete = 0;
        result.canrender = true;
        result.message = i18next.t("apgames:validation.dvonn.INITIAL_INSTRUCTIONS");
        this.syncMoveHighlightsFromMove(m);
        return result;
      }
      result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
      return result;
    }

    const { from, to } = parsed;
    if (!this.board.has(from)) {
      result.message = i18next.t("apgames:validation.dvonn.EMPTY", { where: from });
      return result;
    }
    if (!this.board.has(to)) {
      result.message = i18next.t("apgames:validation.dvonn.EMPTY", { where: to });
      return result;
    }
    const ok = this.legalMoves(this.currplayer).some((mv) => mv.from === from && mv.to === to);
    if (!ok) {
      result.message = i18next.t("apgames:validation.dvonn.INVALID_MOVE");
      return result;
    }
    result.valid = true;
    result.complete = 1;
    result.message = i18next.t("apgames:validation.dvonn.INITIAL_INSTRUCTIONS");
    return result;
  }

  protected checkEOG(): DvonnGame {
    if (this.phase !== "play" || this.gameover) {
      return this;
    }
    if (!bothImmobilized(this.graph, this.board)) {
      return this;
    }
    this.gameover = true;
    this.winner = resolveWinner(this.board);
    const s1 = controlledPieceCount(this.board, 1);
    const s2 = controlledPieceCount(this.board, 2);
    if (this.winner.length === 2) {
      this.results.push({ type: "eog", reason: "tie" });
    } else {
      this.results.push({ type: "eog", reason: "score" });
    }
    void s1;
    void s2;
    this.results.push({ type: "winners", players: [...this.winner] });
    return this;
  }

  public move(m: string, { trusted = false, partial = false } = {}): DvonnGame {
    if (this.gameover) {
      throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
    }
    m = m.toLowerCase().replace(/\s+/g, "");
    if (!trusted) {
      const v = this.validateMove(m);
      if (!v.valid) {
        throw new UserFacingError("VALIDATION_GENERAL", v.message);
      }
      if (!partial && m.endsWith("-") && v.complete !== 0) {
        throw new UserFacingError("VALIDATION_GENERAL", v.message);
      }
      if (!partial && !m.endsWith("-") && v.complete !== 1) {
        throw new UserFacingError("VALIDATION_GENERAL", v.message);
      }
    }

    if (partial) {
      if (this.phase === "play") {
        this.syncMoveHighlightsFromMove(m);
      }
      return this;
    }

    this.results = [];
    this.clearMoveHighlights();
    const player = this.currplayer;

    if (this.phase === "setup") {
      const cell = parseSetupPlace(m)!;
      const disc = this.nextSetupDisc();
      if (!reserveForDisc(this.reserves, player, disc)) {
        throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.dvonn.WRONG_SETUP_PIECE"));
      }
      this.board.set(cell, stackFromDisc(disc));
      this.results.push({ type: "place", who: player, where: cell });
      this.lastmove = cell;
      if (setupComplete(this.board.size)) {
        this.phase = "play";
        this.currplayer = 1;
      } else {
        this.currplayer = player === 1 ? 2 : 1;
      }
      this.saveState();
      if (this.phase === "play") {
        this.results = this.resultsForDisplay(this.results, "play");
      }
      return this;
    }

    if (m === "pass") {
      this.results.push({ type: "pass" });
      this.lastmove = m;
      this.currplayer = player === 1 ? 2 : 1;
      this.checkEOG();
      this.saveState();
      return this;
    }

    const { from, to } = parsePlayMove(m)!;
    applyStackMove(this.board, from, to);
    this.results.push({ type: "move", who: player, from, to });
    const removed = removeIsolated(this.graph, this.board);
    if (removed.length > 0) {
      this.results.push({ type: "remove", where: removed.join(","), num: removed.length });
    }
    this.lastmove = m;
    this.currplayer = player === 1 ? 2 : 1;
    this.checkEOG();
    this.saveState();
    return this;
  }

  public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
    try {
      const cells = this.graph.listCells(true) as string[][];
      const cell = cells[row]?.[col];
      if (cell === undefined || !this.graph.isPlayable(cell)) {
        throw new Error("Invalid click");
      }

      let newmove = move.toLowerCase().replace(/\s+/g, "");

      if (this.phase === "setup") {
        if (!this.board.has(cell)) {
          newmove = cell;
        }
      } else {
        const stack = this.board.get(cell);
        const owns = stack?.owner === this.currplayer;
        const [from, to] = newmove.split("-") as [string, string | undefined];
        if (to === undefined || to === "") {
          if (from === cell) {
            newmove = "";
          } else if (from !== undefined && from.length > 0 && this.board.has(cell)) {
            // Finish partial `from-` before treating an occupied click as a new source
            // (landing cells may belong to the same player, e.g. b2-d3).
            newmove = `${from}-${cell}`;
          } else if (owns) {
            newmove = `${cell}-`;
          }
        } else if (owns && from !== cell) {
          newmove = `${cell}-`;
        }
      }

      const result = this.validateMove(newmove) as IClickResult;
      result.move = result.valid ? newmove : move;
      return result;
    } catch (e) {
      return {
        move,
        valid: false,
        message: i18next.t("apgames:validation._general.GENERIC", {
          move,
          row,
          col,
          piece,
          emessage: (e as Error).message,
        }),
      };
    }
  }

  public getPlayerColour(p: playerid): Colourfuncs {
    if (p === 1) {
      return { func: "custom", default: GIPF_P1, palette: 1 };
    }
    return { func: "custom", default: GIPF_P2, palette: 2 };
  }

  public dvonnColour(): Colourfuncs {
    return { func: "custom", default: DVONN_FILL, palette: 5 };
  }

  public sidebarScores(): IScores[] {
    return [
      {
        name: this.neutralAreaLabel("apgames:status.dvonn.CONTROLLED"),
        scores: [
          String(controlledPieceCount(this.board, 1)),
          String(controlledPieceCount(this.board, 2)),
        ],
      },
    ];
  }

  public render(): APRenderRep {
    const p1 = this.getPlayerColour(1);
    const p2 = this.getPlayerColour(2);
    const dv = this.dvonnColour();
    const cells = this.graph.listCells(true) as string[][];
    const pstr: string[][][] = [];
    for (const row of cells) {
      const line: string[][] = [];
      for (const cell of row) {
        const stack = this.board.get(cell);
        if (stack === undefined) {
          line.push([]);
        } else {
          line.push(stackGlyphs(stack.pieces));
        }
      }
      pstr.push(line);
    }

    const rep: APRenderRep = {
      renderer: "stacking-offset",
      board: {
        style: "hex-of-tri",
        minWidth: 9,
        maxWidth: 11,
      },
      legend: {
        W: basicPieceLegend(p1, 3),
        X: basicPieceLegend(p2, 4),
        D: dvonnPieceLegend(dv),
      },
      pieces: pstr as [string[][], ...string[][][]],
    };

    rep.annotations = [];
    if (this.moveHighlights.length > 0) {
      rep.annotations.push({
        type: "enter",
        shape: "circle",
        targets: this.moveHighlights.map((c) => this.rowCol(c)) as [RowCol, ...RowCol[]],
      });
    }
    for (const r of this.results) {
      if (r.type === "place" && r.where) {
        const [x, y] = this.graph.algebraic2coords(r.where);
        rep.annotations!.push({
          type: "enter",
          shape: "circle",
          targets: [{ row: y, col: x }],
        });
      } else if (r.type === "move" && r.from && r.to) {
        const [fx, fy] = this.graph.algebraic2coords(r.from);
        const [tx, ty] = this.graph.algebraic2coords(r.to);
        rep.annotations!.push({
          type: "move",
          targets: [
            { row: fy, col: fx },
            { row: ty, col: tx },
          ],
        });
      } else if (r.type === "remove" && r.where) {
        for (const cell of r.where.split(",").map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0)) {
          rep.annotations!.push({
            type: "exit",
            shape: "circle",
            targets: [this.rowCol(cell)],
          });
        }
      }
    }
    if (rep.annotations.length === 0) {
      delete rep.annotations;
    }
    return rep;
  }

  public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
    if (r.type === "pass") {
      this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:dvonn.PASS.skipped");
      return true;
    }
    if (r.type === "place" && r.where) {
      this.pushSeatChatLine(lines, r.who ?? ctx.defaultSeat, "apresults:_general.PLACE.nowhat", {
        where: r.where,
      });
      return true;
    }
    if (r.type === "move" && r.from && r.to) {
      this.pushSeatChatLine(lines, r.who ?? ctx.defaultSeat, "apresults:_general.MOVE.nowhat", {
        from: r.from,
        to: r.to,
      });
      return true;
    }
    if (r.type === "remove" && r.num !== undefined) {
      this.pushNeutralChatLine(lines, "apresults:dvonn.REMOVE.isolated", { count: r.num });
      return true;
    }
    if (r.type === "eog" && r.reason === "tie") {
      const count = controlledPieceCount(this.board, 1);
      this.pushNeutralChatLine(lines, "apresults:dvonn.EOG.tie", { count });
      return true;
    }
    if (r.type === "eog" && this.winner.length === 1) {
      const w = this.winner[0]!;
      const count = controlledPieceCount(this.board, w);
      this.pushSeatChatLine(lines, w, "apresults:dvonn.EOG.score", {
        count,
        player: chatPlayerToken(w),
      });
      return true;
    }
    return false;
  }

  public state(): IDvonnState {
    return {
      game: DvonnGame.gameinfo.uid,
      numplayers: this.numplayers,
      variants: [...this.variants],
      gameover: this.gameover,
      winner: [...this.winner],
      stack: [...this.stack],
    };
  }

  public moveState(): IMoveState {
    return {
      _version: DvonnGame.gameinfo.version,
      _results: [...this.results],
      _timestamp: new Date(),
      currplayer: this.currplayer,
      phase: this.phase,
      board: cloneBoard(this.board),
      reserves: cloneReserves(this.reserves),
      lastmove: this.lastmove,
    };
  }

  public clone(): DvonnGame {
    return new DvonnGame(this.state());
  }
}