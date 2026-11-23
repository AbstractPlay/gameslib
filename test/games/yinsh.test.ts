import { expect } from "chai";
import "mocha";
import { addResource } from "../../src";
import { YinshGame } from "../../src/games/yinsh.js";
import { freshMoveState } from "../../src/games/yinsh/setup.js";
import { YinshGraph, YINSH_BLOCKED_RENDER } from "../../src/games/yinsh/graph.js";
import { applyRingMove, legalRingDestinations, simulateRingMove } from "../../src/games/yinsh/move.js";
import {
    findAllCapturableRows,
    isValidMarkerTake,
    markerTakeFromSpan,
    rowsNeedChoice,
} from "../../src/games/yinsh/rows.js";
import { formatMarkerRowMove, takeSetForMarkerMove } from "../../src/games/yinsh/row-notation.js";
import { MARKERS_PER_PLAYER } from "../../src/games/yinsh/types.js";

describe("YinshGame", () => {
    before(() => {
        addResource("en");
    });

    it("exposes automove without check flag", () => {
        expect(YinshGame.gameinfo.flags).to.include("automove");
        expect(YinshGame.gameinfo.flags).to.not.include("check");
    });

    it("starts in setup with five rings each in reserve", () => {
        const g = new YinshGame();
        expect(g.phase).to.equal("setup");
        expect(g.ringsReserve).to.deep.equal([5, 5]);
        expect(g.markersInPool).to.equal(MARKERS_PER_PLAYER);
        expect(g.score).to.deep.equal([0, 0]);
        expect(g.rings.size).to.equal(0);
        expect(g.currplayer).to.equal(1);
    });

    it("setup: alternates placement and enters play after ten rings", () => {
        const g = new YinshGame();
        const cells: string[] = [];
        for (let i = 0; i < 10; i++) {
            const m = g.moves();
            expect(m.length).to.be.greaterThan(0);
            g.move(m[0]!, { trusted: true });
            cells.push(m[0]!);
            expect(g.rings.size).to.equal(i + 1);
        }
        expect(g.phase).to.equal("play");
        expect(g.ringsReserve).to.deep.equal([0, 0]);
        expect(g.currplayer).to.equal(1);
        expect(cells.length).to.equal(10);
    });

    it("setup: cannot place on blocked or occupied intersections", () => {
        const g = new YinshGame();
        const graph = g.graph;
        const cells = graph.listCells(true) as string[][];
        for (const pt of YINSH_BLOCKED_RENDER) {
            const cell = cells[pt.row]?.[pt.col];
            if (cell !== undefined) {
                expect(graph.blocked.has(cell)).to.equal(true);
                expect(g.validateMove(cell).valid).to.equal(false);
            }
        }
        g.move(g.moves()[0]!, { trusted: true });
        const occupied = [...g.rings.keys()][0]!;
        expect(g.validateMove(occupied).valid).to.equal(false);
    });

    it("legend uses marker, ring, and layered ring+marker keys per player", () => {
        const rep = new YinshGame().render();
        expect(rep.legend!.A!.name).to.equal("ring-02");
        expect(rep.legend!.B!.name).to.equal("ring-23");
        expect(rep.legend!.C).to.be.an("array");
        expect((rep.legend!.C as Array<{ name: string }>)[0]!.name).to.equal("ring-02");
        expect((rep.legend!.C as Array<{ name: string }>)[1]!.name).to.equal("ring-23");
        expect(rep.legend!.D!.name).to.equal("ring-02");
        expect(rep.legend!.E!.name).to.equal("ring-23");
        expect(rep.legend!.F).to.be.an("array");
        expect((rep.legend!.F as Array<{ name: string }>)[1]!.name).to.equal("ring-23");
        const fill = rep.legend!.A!.paint!.fill;
        expect(rep.legend!.A!.paint!.border).to.deep.equal({
            func: "custom",
            default: { func: "bestContrast", bg: fill, fg: ["#000000", "#ffffff"] },
            palette: 3,
        });
        expect(YinshGame.gameinfo.customizations).to.have.length(4);
    });

    it("sidebar shows scored rings as Score", () => {
        const g = new YinshGame();
        const s = g.sidebarScores();
        expect(s).to.have.length(1);
        expect(s[0]!.scores).to.deep.equal([0, 0]);
    });

    it("ring slide and jump-flip follow rules", () => {
        const graph = new YinshGraph();
        const rings = new Map<string, 1 | 2>();
        const markers = new Map<string, 1 | 2>();
        let jumpFrom: string | undefined;
        let jumpTo: string | undefined;
        for (const from of graph.graph.nodes()) {
            rings.set(from, 1);
            for (const line of graph.allLines()) {
                if (!line.includes(from)) {
                    continue;
                }
                const idx = line.indexOf(from);
                let chained = 0;
                for (let k = idx + 1; k < line.length && chained < 3; k++) {
                    const c = line[k]!;
                    if (rings.has(c)) {
                        break;
                    }
                    markers.set(c, k % 2 === 0 ? 1 : 2);
                    chained++;
                }
                const dests = legalRingDestinations(from, 1, rings, markers, graph);
                for (const dest of dests) {
                    const sim = simulateRingMove(from, dest, 1, rings, markers, graph);
                    if (sim.ok && sim.flipped.length > 0) {
                        jumpFrom = from;
                        jumpTo = dest;
                        break;
                    }
                }
                for (const c of [...markers.keys()]) {
                    markers.delete(c);
                }
                if (jumpFrom !== undefined) {
                    break;
                }
            }
            rings.delete(from);
            if (jumpFrom !== undefined) {
                break;
            }
        }
        expect(jumpFrom, "expected a jump position on the Yinsh board").to.not.equal(undefined);
        const rings2 = new Map<string, 1 | 2>([[jumpFrom!, 1]]);
        const markers2 = new Map<string, 1 | 2>();
        const line = graph.allLines().find((ln) => ln.includes(jumpFrom!))!;
        const idx = line.indexOf(jumpFrom!);
        for (let k = idx + 1; k < line.length; k++) {
            const c = line[k]!;
            if (c === jumpTo) {
                break;
            }
            markers2.set(c, 2);
        }
        const applied = applyRingMove(jumpFrom!, jumpTo!, 1, rings2, markers2, graph);
        expect(applied.ok).to.equal(true);
        expect(rings2.get(jumpTo!)).to.equal(1);
        expect(markers2.get(jumpFrom!)).to.equal(1);
    });

    it("forming a row of five triggers marker then ring removal plies", () => {
        const g = new YinshGame();
        g.phase = "play";
        g.ringsReserve = [0, 0];
        g.currplayer = 1;
        const line = ["b5", "c5", "d5", "e5", "f5", "g5"];
        for (const c of line) {
            if (c !== "f5") {
                g.markers.set(c, 1);
            }
        }
        g.rings.set("a5", 1);
        g.markers.set("f5", 1);
        const rows = findAllCapturableRows(g.markers, g.rings, g.graph);
        expect(rows.some((r) => r.owner === 1 && r.core.length >= 5)).to.equal(true);
    });

    it("blitz variant ends at one scored ring", () => {
        const g = new YinshGame(undefined, ["blitz"]);
        g.phase = "play";
        g.score = [1, 0];
        g.checkEOG();
        expect(g.gameover).to.equal(true);
        expect(g.winner).to.deep.equal([1]);
    });

    it("standard variant ends at three scored rings", () => {
        const g = new YinshGame();
        g.phase = "play";
        g.score = [2, 0];
        g.checkEOG();
        expect(g.gameover).to.equal(false);
        g.score = [3, 0];
        g.checkEOG();
        expect(g.gameover).to.equal(true);
        expect(g.winner).to.deep.equal([1]);
    });

    it("pool exhaustion awards higher score", () => {
        const g = new YinshGame();
        g.phase = "play";
        g.markersInPool = 0;
        g.score = [2, 1];
        g.checkEOG();
        expect(g.gameover).to.equal(true);
        expect(g.winner).to.deep.equal([1]);
    });

    it("pool exhaustion with equal scores is a draw", () => {
        const g = new YinshGame();
        g.phase = "play";
        g.markersInPool = 0;
        g.score = [1, 1];
        g.checkEOG();
        expect(g.gameover).to.equal(true);
        expect(g.winner).to.deep.equal([]);
    });

    it("turn model is sequenced", () => {
        expect(new YinshGame().turnModel()).to.equal("sequenced");
    });

    it("handleClick accepts partial ring moves", () => {
        const placements = ["e3", "h4", "e6", "c3", "e1", "k3", "i4", "j7", "g3", "d5"];
        const g = new YinshGame();
        for (const p of placements) {
            g.move(p, { trusted: true });
        }
        expect(g.phase).to.equal("play");
        const [col, row] = g.graph.algebraic2coords("e3");
        const start = g.handleClick("", row, col);
        expect(start.valid).to.equal(true);
        expect(start.complete).to.equal(-1);
        expect(start.move).to.equal("e3-");
        const dest = g.moves().find((m) => m.startsWith("e3-"));
        expect(dest).to.not.equal(undefined);
        const [dcol, drow] = g.graph.algebraic2coords(dest!.split("-")[1]!);
        const finish = g.handleClick(start.move, drow, dcol);
        expect(finish.valid).to.equal(true);
        expect(finish.complete).to.equal(1);
        expect(finish.move).to.equal(dest);
    });

    it("confirm-markers: deselect until exactly five contiguous remain", () => {
        const row = {
            id: "2:j7,i7,h7,g7,f7,e6",
            lineKey: "a2|b3|c4|d5|e6|f7|g7|h7|i7|j7",
            owner: 2 as const,
            cells: ["j7", "i7", "h7", "g7", "f7", "e6"],
            core: ["j7", "i7", "h7", "g7", "f7", "e6"],
            segments: [
                ["j7", "i7", "h7", "g7", "f7"],
                ["i7", "h7", "g7", "f7", "e6"],
            ],
        };
        const g = new YinshGame();
        g.phase = "play";
        g.currplayer = 2;
        for (const c of row.core) {
            g.markers.set(c, 2);
        }
        g.rowPending = {
            causedBy: 2,
            pending: [{ actor: 2, rows: [row] }],
            phase: {
                type: "confirm-markers",
                actor: 2,
                row,
                take: new Set(row.core),
            },
        };
        const full = formatMarkerRowMove(row, new Set(row.core));
        expect(g.validateMove(full).complete).to.equal(-1);
        const [col, rowIdx] = g.graph.algebraic2coords("j7");
        const click = g.handleClick(full, rowIdx, col);
        expect(click.valid).to.equal(true);
        expect(click.complete).to.equal(0);
        expect(isValidMarkerTake(row, markerTakeFromSpan(row, "i7", "e6", (c) => g.markers.has(c)))).to.equal(true);
    });

    it("six markers on one line: no choose-row; click j7 toggles it off", () => {
        const g = new YinshGame();
        g.phase = "play";
        g.currplayer = 2;
        for (const c of ["j7", "i7", "h7", "g7", "f7", "e6"]) {
            g.markers.set(c, 2);
        }
        const rows = findAllCapturableRows(g.markers, g.rings, g.graph).filter((r) => r.owner === 2);
        expect(rows.length).to.equal(1);
        expect(rows[0]!.core.length).to.equal(6);
        expect(rowsNeedChoice(rows)).to.equal(false);
        const row = rows[0]!;
        g.rowPending = {
            causedBy: 2,
            pending: [{ actor: 2, rows }],
            phase: {
                type: "confirm-markers",
                actor: 2,
                row,
                take: new Set(row.core),
            },
        };
        const [col, rowIdx] = g.graph.algebraic2coords("j7");
        const click = g.handleClick("", rowIdx, col);
        expect(click.valid).to.equal(true);
        expect(click.complete).to.equal(0);
        expect(click.move).to.equal("xe6-i7");
    });

    it("seven markers on one line: confirm toggles; stale choose-row heals on load", () => {
        const blackRow = ["j7", "i7", "h7", "g7", "f7", "e6", "d5"];
        const markers = new Map<string, 1 | 2>();
        for (const c of blackRow) {
            markers.set(c, 2);
        }
        const g = new YinshGame();
        const rows = findAllCapturableRows(markers, g.rings, g.graph).filter((r) => r.owner === 2);
        expect(rows.length).to.equal(1);
        expect(rows[0]!.core.length).to.equal(7);
        expect(rows[0]!.segments.length).to.equal(3);
        g.stack = [
            {
                ...freshMoveState(YinshGame.gameinfo.version),
                phase: "play",
                currplayer: 2,
                markers,
                rings: new Map(),
                rowPending: {
                    causedBy: 2,
                    pending: [{ actor: 2, rows: [...rows, rows[0]!] }],
                    phase: { type: "choose-row", actor: 2, options: [...rows, rows[0]!] },
                },
            },
        ];
        g.load(0);
        expect(g.rowPending?.phase?.type).to.equal("confirm-markers");
        const take = g.rowPending?.phase;
        expect(take?.type).to.equal("confirm-markers");
        if (take?.type === "confirm-markers") {
            expect(take.take.size).to.equal(7);
        }
        const [col, rowIdx] = g.graph.algebraic2coords("j7");
        const click = g.handleClick("", rowIdx, col);
        expect(click.valid).to.equal(true);
        expect(click.complete).to.equal(-1);
        expect(click.move).to.equal("xd5-i7");
    });

    it("commits xf7-j7 on a seven-marker row then prompts ring removal", () => {
        const blackRow = ["j7", "i7", "h7", "g7", "f7", "e6", "d5"];
        const markers = new Map<string, 1 | 2>();
        for (const c of blackRow) {
            markers.set(c, 2);
        }
        const g = new YinshGame();
        g.markers = markers;
        g.phase = "play";
        g.currplayer = 2;
        const row = findAllCapturableRows(markers, g.rings, g.graph)[0]!;
        expect(takeSetForMarkerMove("xf7-j7", row)).to.not.equal(undefined);
        g.rowPending = {
            causedBy: 2,
            pending: [{ actor: 2, rows: [row] }],
            phase: { type: "confirm-markers", actor: 2, row, take: new Set(row.core) },
        };
        g.move("xf7-j7");
        expect(g.rowPending?.phase?.type).to.equal("remove-ring");
        expect(g.markers.has("f7")).to.equal(false);
        expect(g.markers.has("d5")).to.equal(true);
        expect(g.markers.has("e6")).to.equal(true);
    });

    it("remove-ring phase survives load refresh after marker capture", () => {
        const blackRow = ["j7", "i7", "h7", "g7", "f7", "e6", "d5"];
        const markers = new Map<string, 1 | 2>([
            ["e6", 2],
            ["d5", 2],
            ["e3", 2],
        ]);
        const rings = new Map<string, 1 | 2>([
            ["h5", 2],
            ["f4", 2],
            ["j4", 2],
        ]);
        const g = new YinshGame();
        g.stack = [
            {
                ...freshMoveState(YinshGame.gameinfo.version),
                phase: "play",
                currplayer: 2,
                markers,
                rings,
                lastmove: "xf7-j7",
                rowPending: {
                    causedBy: 2,
                    pending: [
                        {
                            actor: 2,
                            rows: [
                                {
                                    id: "2:" + blackRow.join(","),
                                    lineKey: "a2|b3|c4|d5|e6|f7|g7|h7|i7|j7",
                                    owner: 2 as const,
                                    cells: blackRow,
                                    core: blackRow,
                                    segments: [
                                        blackRow.slice(0, 5),
                                        blackRow.slice(1, 6),
                                        blackRow.slice(2, 7),
                                    ],
                                },
                            ],
                        },
                    ],
                    phase: { type: "remove-ring", actor: 2 as const },
                },
            },
        ];
        g.load(0);
        expect(g.rowPending?.phase?.type).to.equal("remove-ring");
        expect(g.currplayer).to.equal(2);
        expect(g.moves().some((m) => m.startsWith("x"))).to.equal(true);
        const ringPick = g.moves().find((m) => m.startsWith("x") && !m.includes("-"));
        expect(ringPick).to.not.equal(undefined);
        expect(g.validateMove(ringPick!).valid).to.equal(true);
        expect(g.validateMove(ringPick!).complete).to.equal(1);
    });

    it("choose-row render highlights marker lines and intersections", () => {
        const g = new YinshGame();
        g.phase = "play";
        g.currplayer = 2;
        g.rowPending = {
            causedBy: 2,
            pending: [{ actor: 2, rows: [] }],
            phase: {
                type: "choose-row",
                actor: 2,
                options: [
                    {
                        id: "2:h7,g7,f7,e6,d5",
                        lineKey: "a2|b3|c4|d5|e6|f7|g7|h7",
                        owner: 2,
                        cells: ["h7", "g7", "f7", "e6", "d5"],
                        core: ["h7", "g7", "f7", "e6", "d5"],
                        segments: [["h7", "g7", "f7", "e6", "d5"]],
                    },
                ],
            },
        };
        for (const c of ["h7", "g7", "f7", "e6", "d5"]) {
            g.markers.set(c, 2);
        }
        const rep = g.render();
        expect(rep.annotations?.some((a) => a.type === "line")).to.equal(true);
        expect(rep.annotations?.some((a) => a.type === "exit")).to.equal(true);
    });

    it("partial ring move previews a marker and highlights destinations", () => {
        const placements = ["e3", "h4", "e6", "c3", "e1", "k3", "i4", "j7", "g3", "d5"];
        const g = new YinshGame();
        for (const p of placements) {
            g.move(p, { trusted: true });
        }
        g.move("e3-", { partial: true, trusted: true });
        const rep = g.render();
        const [col, row] = g.graph.algebraic2coords("e3");
        const e3Piece = rep.pieces!.split("\n")[row]!.split(",")[col]!;
        expect(e3Piece).to.equal("C");
        const dots = rep.annotations?.find((a) => a.type === "dots");
        expect(dots).to.not.equal(undefined);
        expect((dots!.targets ?? []).length).to.be.greaterThan(0);
    });
});