import { expect } from "chai";
import "mocha";
import i18next from "i18next";
import { addResource } from "../../src";
import { DvonnGame, playStartStackIndex } from "../../src/games/dvonn.js";
import { DvonnGraph, DVONN_INTERSECTIONS } from "../../src/common/graphs/dvonn.js";
import {
  applyStackMove,
  isBareDvonn,
  isSurrounded,
  legalDestinations,
  removeIsolated,
} from "../../src/games/dvonn/move.js";
import {
  buildRandomSetupBoard,
  serializeBoard,
  setupActor,
  setupDisc,
} from "../../src/games/dvonn/setup.js";
import { DVONN_DISC, SETUP_PLIES } from "../../src/games/dvonn/types.js";
import { GameRng } from "../../src/common/rng.js";
import type { CellStack } from "../../src/games/dvonn/types.js";
import { controlledPieceCount, resolveWinner } from "../../src/games/dvonn/win.js";
import type { HexDir } from "../../src/common/graphs/hextri.js";

describe("DvonnGraph", () => {
  it("has 49 playable intersections", () => {
    const graph = new DvonnGraph();
    expect(graph.playableCells().length).to.equal(DVONN_INTERSECTIONS);
  });
});

describe("Dvonn random setup", () => {
  const graph = new DvonnGraph();

  it("fills every intersection with the setup queue", () => {
    const board = buildRandomSetupBoard(graph);
    expect(board.size).to.equal(DVONN_INTERSECTIONS);
    expect(board.size).to.equal(SETUP_PLIES);
    let dvonn = 0;
    let p1Basic = 0;
    let p2Basic = 0;
    for (const stack of board.values()) {
      const top = stack.pieces[stack.pieces.length - 1]!;
      if (top === DVONN_DISC) {
        dvonn++;
      } else if (top === 1) {
        p1Basic++;
      } else {
        p2Basic++;
      }
    }
    expect(dvonn).to.equal(3);
    expect(p1Basic).to.equal(23);
    expect(p2Basic).to.equal(23);
  });

  it("serializeBoard is stable for a seeded layout", () => {
    const seed = "dvonn-quickstart-fixture";
    const board = buildRandomSetupBoard(graph, new GameRng(seed));
    const encoded = serializeBoard(board);
    expect(encoded).to.equal(serializeBoard(buildRandomSetupBoard(graph, new GameRng(seed))));
    expect(encoded.length).to.be.greaterThan(0);
  });
});

describe("Dvonn setup queue", () => {
  it("opens with three DVONN plies by P1, P2, P1", () => {
    expect(setupActor(0)).to.equal(1);
    expect(setupDisc(0)).to.equal(DVONN_DISC);
    expect(setupActor(1)).to.equal(2);
    expect(setupDisc(1)).to.equal(DVONN_DISC);
    expect(setupActor(2)).to.equal(1);
    expect(setupDisc(2)).to.equal(DVONN_DISC);
    expect(setupActor(3)).to.equal(2);
    expect(setupDisc(3)).to.equal(2);
    expect(setupActor(4)).to.equal(1);
    expect(setupDisc(4)).to.equal(1);
  });
});

describe("Dvonn movement helpers", () => {
  const graph = new DvonnGraph();

  function stack(owner: 1 | 2, height: number): CellStack {
    const pieces = Array.from({ length: height }, () => owner);
    return { owner, pieces };
  }

  it("lands at stack height along a line on occupied cells only", () => {
    const cells = graph.neighbours(graph.playableCells()[10]!);
    const from = cells[0]!;
    const mid = graph.neighbours(from).find((c) => c !== cells[1])!;
    const to = graph.traceLine(from, graph.bearing(from, mid)! as HexDir)[1];
    if (to === undefined) {
      return;
    }
    const board = new Map<string, CellStack>([
      [from, stack(1, 1)],
      [to, stack(2, 1)],
    ]);
    expect(isBareDvonn({ pieces: [DVONN_DISC] })).to.equal(true);
    const dests = legalDestinations(graph, board, from, 1);
    expect(dests).to.include(to);
  });

  it("merges mover on target", () => {
    const from = graph.playableCells()[5]!;
    const neighbours = graph.neighbours(from);
    const to = neighbours[0]!;
    const board = new Map<string, CellStack>([
      [from, { owner: 1, pieces: [1] }],
      [to, { owner: 2, pieces: [2, 2] }],
    ]);
    applyStackMove(board, from, to);
    expect(board.has(from)).to.equal(false);
    expect(board.get(to)!.owner).to.equal(1);
    expect(board.get(to)!.pieces).to.have.length(3);
  });

  it("removeIsolated drops components without DVONN contact", () => {
    const a = graph.playableCells()[0]!;
    const b = graph.neighbours(a)[0]!;
    const c = graph.playableCells().find((cell) => !graph.path(a, cell)?.includes(b))!;
    const board = new Map<string, CellStack>([
      [a, { pieces: [DVONN_DISC] }],
      [b, { owner: 1, pieces: [1] }],
      [c, { owner: 2, pieces: [2] }],
    ]);
    if (graph.neighbours(c).includes(b)) {
      return;
    }
    const removed = removeIsolated(graph, board);
    expect(removed).to.include(c);
    expect(board.has(a)).to.equal(true);
    expect(board.has(b)).to.equal(true);
    expect(board.has(c)).to.equal(false);
  });
});

describe("DvonnGame", () => {
  const graph = new DvonnGraph();

  before(() => {
    addResource("en");
  });

  function finishSetup(g: DvonnGame): void {
    const cells = graph.playableCells();
    for (let i = 0; i < DVONN_INTERSECTIONS; i++) {
      g.move(cells[i]!, { trusted: true });
    }
  }

  it("starts in setup with player 1 to move", () => {
    const g = new DvonnGame();
    expect(g.phase).to.equal("setup");
    expect(g.currplayer).to.equal(1);
    expect(g.board.size).to.equal(0);
    expect(g.sidebarScores()[0]!.scores).to.deep.equal(["0", "0"]);
  });

  it("after full setup enters play with player 1 and 23/23 controlled counts", () => {
    const g = new DvonnGame();
    finishSetup(g);
    expect(g.phase).to.equal("play");
    expect(g.currplayer).to.equal(1);
    expect(g.board.size).to.equal(DVONN_INTERSECTIONS);
    expect(playStartStackIndex(g.stack)).to.equal(g.stack.length - 1);
    const scores = g.sidebarScores();
    expect(scores[0]!.scores).to.deep.equal(["23", "23"]);
  });

  it("moves() returns pass when the active seat has no legal move in play", () => {
    const g = new DvonnGame();
    g.phase = "play";
    g.board = new Map();
    g.currplayer = 1;
    expect(g.moves()).to.deep.equal(["pass"]);
  });

  it("render emits exit on each cell in a multi-stack isolation remove", () => {
    const g = new DvonnGame();
    g.phase = "play";
    g.results = [{ type: "remove", where: "a3,a4,b4", num: 3 }];
    const rep = g.render() as { annotations?: Array<{ type: string; targets: unknown[] }> };
    const exits = rep.annotations?.filter((a) => a.type === "exit") ?? [];
    expect(exits).to.have.length(3);
  });

  it("render uses plain hex-of-tri 9/11 stacking-offset", () => {
    const g = new DvonnGame();
    const rep = g.render() as {
      renderer?: string;
      options?: string[];
      board?: { style?: string; minWidth?: number; maxWidth?: number; rotate?: number };
    };
    expect(rep.renderer).to.equal("stacking-offset");
    expect(rep.options).to.equal(undefined);
    expect(rep.board?.style).to.equal("hex-of-tri");
    expect(rep.board?.minWidth).to.equal(9);
    expect(rep.board?.maxWidth).to.equal(11);
    expect(rep.board?.rotate).to.equal(undefined);
  });

  it("scores ties by equal controlled disc counts", () => {
    const board = new Map<string, CellStack>([
      ["a1", { owner: 1, pieces: [1, 1] }],
      ["a2", { owner: 2, pieces: [2, 2] }],
    ]);
    expect(controlledPieceCount(board, 1)).to.equal(2);
    expect(controlledPieceCount(board, 2)).to.equal(2);
    expect(resolveWinner(board)).to.deep.equal([1, 2]);
  });

  function rowColFor(cell: string): [number, number] {
    const grid = graph.listCells(true) as string[][];
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r]!;
      for (let c = 0; c < row.length; c++) {
        if (row[c] === cell) {
          return [r, c];
        }
      }
    }
    throw new Error(`no grid slot for ${cell}`);
  }

  it("quickstart variant starts in play with player 1 and empty reserves", () => {
    const g = new DvonnGame(undefined, ["quickstart"]);
    expect(g.phase).to.equal("play");
    expect(g.currplayer).to.equal(1);
    expect(g.board.size).to.equal(DVONN_INTERSECTIONS);
    expect(g.reserves).to.deep.equal([{ dvonn: 0, basic: 0 }, { dvonn: 0, basic: 0 }]);
    expect(playStartStackIndex(g.stack)).to.equal(0);
  });

  it("quickstart variant adds random-start flag", () => {
    const flags = DvonnGame.resolveFlags({ variants: ["quickstart"] });
    expect(flags).to.include("random-start");
  });

  it("getStartingPosition records the quickstart board", () => {
    const g = new DvonnGame(undefined, ["quickstart"]);
    const pos = g.getStartingPosition();
    expect(pos).to.equal(serializeBoard(g.board));
    const clone = new DvonnGame(g.state());
    expect(clone.getStartingPosition()).to.equal(pos);
  });

  it("render in play omits setup place circles from persisted results", () => {
    const g = new DvonnGame();
    finishSetup(g);
    const last = g.stack[g.stack.length - 1]!;
    expect(last._results.some((r) => r.type === "place")).to.equal(true);
    g.load();
    const rep = g.render() as { annotations?: Array<{ type: string }> };
    const enters = rep.annotations?.filter((a) => a.type === "enter") ?? [];
    expect(enters).to.deep.equal([]);
  });

  it("validateMove on partial source sets canrender and destination highlights", () => {
    const g = new DvonnGame();
    finishSetup(g);
    const leg = g.legalMoves(1)[0];
    if (leg === undefined) {
      return;
    }
    const v = g.validateMove(`${leg.from}-`);
    expect(v.valid).to.equal(true);
    expect(v.canrender).to.equal(true);
    const rep = g.render() as { annotations?: Array<{ type: string; targets: unknown[] }> };
    const enters = rep.annotations?.filter((a) => a.type === "enter") ?? [];
    expect(enters.length).to.be.greaterThan(0);
    expect(enters[0]!.targets.length).to.be.greaterThan(0);
  });

  it("reports surrounded stacks instead of a generic illegal slide", () => {
    const g = new DvonnGame();
    const centre = graph.playableCells().find((cell) => graph.neighbours(cell).length === 6);
    if (centre === undefined) {
      return;
    }
    g.phase = "play";
    g.currplayer = 1;
    const board = new Map<string, CellStack>();
    for (const nb of graph.neighbours(centre)) {
      board.set(nb, { owner: 2, pieces: [2] });
    }
    board.set(centre, { owner: 1, pieces: [1] });
    g.board = board;
    const v = g.validateMove(`${centre}-`);
    expect(v.valid).to.equal(false);
    expect(v.message).to.equal(i18next.t("apgames:validation.dvonn.SURROUNDED"));
  });

  it("handleClick completes partial move onto own stack at destination", () => {
    const g = new DvonnGame();
    g.phase = "play";
    g.currplayer = 2;
    g.board = new Map([
      ["b2", { owner: 2, pieces: [DVONN_DISC, 2] }],
      ["c3", { owner: 1, pieces: [1] }],
      ["d3", { owner: 2, pieces: [1, 1, 2] }],
    ]);
    const [rFrom, cFrom] = rowColFor("b2");
    const [rTo, cTo] = rowColFor("d3");
    const pick = g.handleClick("", rFrom, cFrom);
    expect(pick.valid).to.equal(true);
    expect(pick.move).to.equal("b2-");
    const land = g.handleClick("b2-", rTo, cTo);
    expect(land.valid).to.equal(true);
    expect(land.move).to.equal("b2-d3");
  });
});

describe("Dvonn surrounded", () => {
  const graph = new DvonnGraph();

  it("interior with six occupied neighbours cannot move", () => {
    const centre = graph.playableCells().find((cell) => graph.neighbours(cell).length === 6);
    if (centre === undefined) {
      return;
    }
    const board = new Map<string, CellStack>();
    for (const nb of graph.neighbours(centre)) {
      board.set(nb, { owner: 2, pieces: [2] });
    }
    board.set(centre, { owner: 1, pieces: [1] });
    expect(isSurrounded(graph, board, centre)).to.equal(true);
    expect(legalDestinations(graph, board, centre, 1)).to.deep.equal([]);
  });
});