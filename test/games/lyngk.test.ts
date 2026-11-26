import { expect } from "chai";
import "mocha";
import { GameRng } from "../../src/common/rng.js";
import { LyngkGame } from "../../src/games/lyngk.js";
import { LyngkGraph, LYNGK_BLOCKED_RENDER, LYNGK_INTERSECTIONS } from "../../src/games/lyngk/graph.js";
import { applyClaim, canClaimColour, canPlayerUseStack } from "../../src/games/lyngk/colours.js";
import {
    allLegalMoveStrings,
    canSlideBetween,
    legalNextCellsForPath,
    pathIsLegal,
    slideLandings,
} from "../../src/games/lyngk/move.js";
import { parseClaimPrefix, parseCellChain } from "../../src/games/lyngk/notation.js";
import {
    buildRandomBoard,
    cloneBoard,
    initialClaimed,
    initialClaims,
    serializeStartingBoard,
} from "../../src/games/lyngk/setup.js";
import { canMergeStacks, canLandStacks, shouldCaptureStack } from "../../src/games/lyngk/stack.js";
import type { ActiveColour, Board, PieceColour, playerid } from "../../src/games/lyngk/types.js";
import { resolveWinner } from "../../src/games/lyngk/win.js";

function gameFromBoard(
    board: Board,
    opts: {
        currplayer?: playerid;
        claims?: ReturnType<typeof initialClaims>;
        claimed?: [ActiveColour[], ActiveColour[]];
        captured?: [number, number];
    } = {},
): LyngkGame {
    const claims = opts.claims ?? initialClaims();
    const claimed = opts.claimed ?? initialClaimed();
    return new LyngkGame({
        game: "lyngk",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: [
            {
                _version: LyngkGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: opts.currplayer ?? 1,
                board: cloneBoard(board),
                claims,
                claimed: [claimed[0].slice() as ActiveColour[], claimed[1].slice() as ActiveColour[]],
                captured: opts.captured ?? [0, 0],
            },
        ],
    });
}

describe("LyngkGraph", () => {
    const graph = new LyngkGraph();

    it("has 43 playable intersections", () => {
        expect(graph.playableCells().length).to.equal(LYNGK_INTERSECTIONS);
    });

    it("blocks render corners from the graph", () => {
        const cells = graph.listCells(true) as string[][];
        for (const pt of LYNGK_BLOCKED_RENDER) {
            const cell = cells[pt.row]![pt.col]!;
            expect(graph.isPlayable(cell)).to.equal(false);
        }
    });
});

describe("Lyngk setup", () => {
    const graph = new LyngkGraph();

    it("deals 8 of each colour plus 3 jokers", () => {
        const board = buildRandomBoard(graph);
        const counts = new Map<PieceColour, number>();
        for (const stack of board.values()) {
            const c = stack[0]!;
            counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        for (const c of [1, 2, 3, 4, 5] as PieceColour[]) {
            expect(counts.get(c)).to.equal(8);
        }
        expect(counts.get(6)).to.equal(3);
    });

    it("serializeStartingBoard is deterministic for a seeded deal", () => {
        const seed = "lyngk-fixture-seed";
        const a = serializeStartingBoard(graph, buildRandomBoard(graph, new GameRng(seed)));
        const b = serializeStartingBoard(graph, buildRandomBoard(graph, new GameRng(seed)));
        expect(a).to.equal(b);
        expect(a.length).to.equal(LYNGK_INTERSECTIONS);
    });
});

describe("Lyngk serialize", () => {
    it("restores legal moves after serialize round-trip", () => {
        const g = new LyngkGame();
        const before = g.moves().filter((m) => m !== "pass");
        expect(before.length).to.be.greaterThan(0);
        const g2 = new LyngkGame(g.serialize());
        const after = g2.moves().filter((m) => m !== "pass");
        expect(after.length).to.be.greaterThan(0);
    });

    it("lets either seat move neutral stacks after round-trip", () => {
        const g = new LyngkGame(new LyngkGame().serialize());
        const cell = [...g.board.entries()].find(([, s]) => s[0] !== 6)?.[0];
        expect(cell).to.not.equal(undefined);
        expect(g.moves(1).some((m) => m.includes(cell!))).to.equal(true);
        expect(g.moves(2).some((m) => m.includes(cell!))).to.equal(true);
    });
});

describe("Lyngk gameinfo", () => {
    it("exposes integrator flags", () => {
        expect(LyngkGame.gameinfo.flags).to.include.members([
            "shared-pieces",
            "automove",
            "random-start",
            "scores",
        ]);
    });
});

describe("Lyngk claims", () => {
    it("rejects claim-only and claim with pass", () => {
        const graph = new LyngkGraph();
        const cells = graph.playableCells();
        const board = new Map<string, PieceColour[]>([[cells[0]!, [1]], [cells[1]!, [2]]]);
        const g = gameFromBoard(board);
        expect(g.validateMove("3").valid).to.equal(false);
        expect(g.validateMove("3,pass").valid).to.equal(false);
    });

    it("allows at most two claims per player", () => {
        const claims = initialClaims();
        const claimed = initialClaimed();
        applyClaim(claims, claimed, 1, 1);
        applyClaim(claims, claimed, 1, 2);
        expect(canClaimColour(claims, claimed, 1, 3)).to.equal(false);
    });
});

describe("Lyngk jokers", () => {
    it("never treats a joker-topped stack as movable", () => {
        const claims = initialClaims();
        expect(canPlayerUseStack(claims, [6], 1)).to.equal(false);
    });

    it("rejects merges that would leave a joker on top", () => {
        expect(canMergeStacks([1], [6])).to.equal(false);
    });

    it("allows jokers as wildcards when completing height 5", () => {
        expect(canMergeStacks([1, 2, 3, 6], [4])).to.equal(true);
        expect(canMergeStacks([1, 1], [2])).to.equal(false);
    });
});

describe("Lyngk movement", () => {
    it("allows claim-then-LYNGK when unclaimed top colour needs ownership for chains", () => {
        const graph = new LyngkGraph();
        const board = new Map<string, PieceColour[]>([
            ["b3", [2, 5, 3]],
            ["c2", [1]],
            ["c4", [3]],
            ["c5", [4]],
            ["d4", [1]],
            ["d5", [4]],
        ]);
        const g = gameFromBoard(board);
        expect(g.moves().some((m) => m.startsWith("3,b3-"))).to.equal(true);
        const v = g.validateMove("3,b3");
        expect(v.valid).to.equal(true);
        expect(v.complete).to.equal(0);
        const next = legalNextCellsForPath(graph, board, initialClaims(), 1, ["b3"], 3);
        expect(next.length).to.be.greaterThan(0);
    });
    const graph = new LyngkGraph();

    it("parseCellChain accepts optional claim prefix via parseClaimPrefix", () => {
        const { claim, rest } = parseClaimPrefix("3,b4-c5");
        expect(claim).to.equal(3);
        expect(parseCellChain(rest)).to.deep.equal(["b4", "c5"]);
    });

    it("parseClaimPrefix accepts a bare claim digit with trailing comma", () => {
        const { claim, rest } = parseClaimPrefix("4,");
        expect(claim).to.equal(4);
        expect(rest).to.equal("");
    });

    it("neutral singleton may only mount another singleton", () => {
        const claims = initialClaims();
        expect(canLandStacks(claims, [3], [4], 1)).to.equal(true);
        expect(canLandStacks(claims, [3], [4, 4], 1)).to.equal(false);
    });

    it("offers pass when no stack is movable", () => {
        const cells = graph.playableCells();
        const board = new Map<string, PieceColour[]>([[cells[0]!, [6]]]);
        const g = gameFromBoard(board);
        expect(g.moves()).to.deep.equal(["pass"]);
        expect(g.validateMove("pass").valid).to.equal(true);
    });
});

describe("Lyngk capture", () => {
    it("scores only height-5 stacks with claimed colour on top", () => {
        const claims = initialClaims();
        applyClaim(claims, initialClaimed(), 1, 2);
        claims.owner[1] = 1;
        const stack: PieceColour[] = [1, 3, 4, 5, 2];
        expect(shouldCaptureStack(claims, stack, 1)).to.equal(true);
        expect(shouldCaptureStack(claims, [1, 2, 3, 4, 3], 1)).to.equal(false);
    });
});

describe("Lyngk EOG", () => {
    it("uses capture count then stack-height tiebreak", () => {
        const claims = initialClaims();
        const claimed = initialClaimed();
        applyClaim(claims, claimed, 1, 1);
        applyClaim(claims, claimed, 1, 5);
        applyClaim(claims, claimed, 2, 2);
        applyClaim(claims, claimed, 2, 4);
        const board = new Map<string, PieceColour[]>([
            ["b3", [1, 2, 3, 4]],
            ["c4", [1, 2]],
        ]);
        expect(resolveWinner(board, claims, [2, 1])).to.deep.equal([1]);
        expect(resolveWinner(board, claims, [1, 1])).to.deep.equal([2]);
        expect(resolveWinner(new Map([["b3", [3]]]), claims, [0, 0])).to.deep.equal([1, 2]);
    });

    it("tiebreak counts stacks per seat at each height (top-disc ownership)", () => {
        const claims = initialClaims();
        const claimed = initialClaimed();
        applyClaim(claims, claimed, 1, 1);
        applyClaim(claims, claimed, 1, 5);
        applyClaim(claims, claimed, 2, 2);
        applyClaim(claims, claimed, 2, 4);
        const board = new Map<string, PieceColour[]>([
            ["a3", [3, 4, 1]],
            ["c5", [2, 1]],
            ["c6", [5, 1, 3, 4]],
            ["f3", [4, 6, 2, 5]],
        ]);
        expect(resolveWinner(board, claims, [3, 3])).to.deep.equal([1]);
    });
});

describe("Lyngk render", () => {
    it("draws one move arrow per LYNGK chain step", () => {
        const g = new LyngkGame();
        g.results = [{ type: "move", who: 1, from: "b4", to: "d4", what: "b4-c4-d4" }];
        const arrows = g.render().annotations?.filter((a) => a.type === "move") ?? [];
        expect(arrows).to.have.length(2);
    });

    it("marks captured stacks with an exit annotation", () => {
        const g = new LyngkGame();
        g.results = [{ type: "capture", whose: 1, where: "b4" }];
        const exits = g.render().annotations?.filter((a) => a.type === "exit") ?? [];
        expect(exits).to.have.length(1);
        expect((exits[0] as { shape?: string }).shape).to.equal("circle");
    });

    it("uses stacking-offset renderer with reserve area while colours remain", () => {
        const graph = new LyngkGraph();
        const g = new LyngkGame();
        const rep = g.render();
        expect(rep.renderer).to.equal("stacking-offset");
        expect(rep.board?.style).to.equal("hex-of-tri");
        expect(rep.areas?.[0]?.type).to.equal("pieces");
        const reserve = (rep.areas![0] as { pieces: string[] }).pieces;
        for (const key of reserve) {
            expect(rep.legend?.[key], `legend missing reserve key ${key}`).to.not.equal(undefined);
        }
        expect(rep.legend?.F).to.not.equal(undefined);
        const joker = rep.legend?.F;
        expect(joker).to.not.equal(undefined);
        if (joker !== undefined && !Array.isArray(joker) && "name" in joker) {
            expect(joker.name).to.equal("piece");
            expect(joker.paint?.fill).to.deep.equal({ func: "custom", default: "dots", palette: 6 });
        }
        const scores = g.sidebarScores();
        expect(scores.length).to.equal(2);
        expect(g.getStartingPosition().length).to.equal(LYNGK_INTERSECTIONS);
        expect(graph.playableCells().length).to.equal(LYNGK_INTERSECTIONS);
    });
});

describe("Lyngk sliding", () => {
    const graph = new LyngkGraph();

    it("may slide over empty intersections but not across occupied ones", () => {
        const line = graph.playableCells().filter((c) => slideLandings(graph, new Map(), c).length >= 2);
        if (line.length === 0) {
            return;
        }
        const a = line[0]!;
        const lands = slideLandings(graph, new Map([[a, [1]]]), a);
        const b = lands[0]!;
        const board = new Map<string, PieceColour[]>([
            [a, [1]],
            [b, [2]],
        ]);
        expect(canSlideBetween(graph, board, a, b)).to.equal(true);

        const dir = graph.bearing(a, b)!;
        const [x, y] = graph.algebraic2coords(a);
        const raw = graph.ray(x, y, dir, true);
        let mid: string | undefined;
        for (let k = 1; k < raw.length; k++) {
            const cell = graph.coords2algebraic(...raw[k]!);
            if (!graph.isPlayable(cell)) {
                continue;
            }
            if (cell === b) {
                break;
            }
            if (!board.has(cell)) {
                mid = cell;
                break;
            }
        }
        if (mid !== undefined) {
            const c = slideLandings(graph, board, a).find((land) => land !== b);
            if (c !== undefined) {
                board.set(mid, [3]);
                expect(canSlideBetween(graph, board, a, c!)).to.equal(false);
            }
        }
    });

    it("handleClick on reserve area sets a partial claim move", () => {
        const g = new LyngkGame();
        const areas = g.render().areas;
        expect(areas?.[0]?.type).to.equal("pieces");
        const yellow = (areas![0] as { pieces: string[] }).pieces.find((p) => p.endsWith("D"));
        expect(yellow).to.not.equal(undefined);
        const click = g.handleClick("", -1, -1, yellow);
        expect(click.valid).to.equal(true);
        expect(click.move).to.equal("4,");
        expect(click.complete).to.equal(0);
    });

    it("handleClick extends the move box chain onto a legal destination", () => {
        const graph = new LyngkGraph();
        const from = graph.playableCells().find((c) => {
            const probe = new Map<string, PieceColour[]>([[c, [1]]]);
            return slideLandings(graph, probe, c).length > 0;
        });
        if (from === undefined) {
            return;
        }
        const to = slideLandings(graph, new Map([[from, [1]]]), from)[0]!;
        const board = new Map<string, PieceColour[]>([
            [from, [1]],
            [to, [2]],
        ]);
        const g = gameFromBoard(board);
        const cells = graph.listCells(true) as string[][];
        const rc = (cell: string): { row: number; col: number } | undefined => {
            for (let r = 0; r < cells.length; r++) {
                for (let c = 0; c < cells[r]!.length; c++) {
                    if (cells[r]![c] === cell) {
                        return { row: r, col: c };
                    }
                }
            }
            return undefined;
        };
        const fromRc = rc(from);
        const toRc = rc(to);
        if (fromRc === undefined || toRc === undefined) {
            return;
        }
        const start = g.handleClick("", fromRc.row, fromRc.col);
        expect(start.move).to.equal(from);
        const finish = g.handleClick(start.move!, toRc.row, toRc.col);
        expect(finish.move).to.equal(`${from}-${to}`);
        expect(finish.valid).to.equal(true);
        expect(finish.complete).to.equal(1);
    });

    it("accepts a legal adjacent landing", () => {
        const from = graph.playableCells().find((c) => {
            const probe = new Map<string, PieceColour[]>([[c, [1]]]);
            return slideLandings(graph, probe, c).length > 0;
        });
        if (from === undefined) {
            return;
        }
        const board = new Map<string, PieceColour[]>([[from, [1]]]);
        const to = slideLandings(graph, board, from)[0]!;
        board.set(to, [2]);
        const claims = initialClaims();
        claims.owner[0] = 1;
        expect(pathIsLegal(graph, board, claims, 1, [from, to])).to.equal(true);
        const moves = allLegalMoveStrings(graph, board, claims, initialClaimed(), 1);
        expect(moves.some((m) => m === `${from}-${to}`)).to.equal(true);
        const next = legalNextCellsForPath(graph, board, claims, 1, [from]);
        expect(next).to.include(to);
    });
});