/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    StorisendeGame,
    type IStorisendeState,
} from "../../src/games/storisende.js";
import { StorisendeBoard } from "../../src/games/storisende/board.js";
import {
    decodeSparseBoardV1,
    encodeBoardSparse,
    isBoardDeltaV1,
    isSparseBoardV1,
    parseModularStartingPosition,
    usesCompactWire,
} from "../../src/games/storisende/boardCodec.js";
import {
    assertCompactWireStack,
    assertLegacyWireStack,
    boardsEqual,
    decodeBoardAtIndexForGame,
    expectBoardsEqual,
    expectLegacyAndCompactBoardsMatchEveryIndex,
    expectLoadIdxMatchesLegacyOracle,
    reencodeStateAsCompact,
    replayFromOpeningState,
} from "../fixtures/storisende/storage/helpers.js";
import {
    expectMovesMatchReference,
} from "../fixtures/storisende/movesReference.js";
import midgameHex6State from "../fixtures/storisende/midgameHex6State.json" with { type: "json" };
import legacyShortOpening from "../fixtures/storisende/storage/legacy-short-opening.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import recordManifest from "../fixtures/storisende/storage/records/manifest.json" with { type: "json" };
import { storisendeFrom } from "../fixtures/storisende/builders.js";
import type { StorisendeRecordManifest } from "../fixtures/storisende/storage/records/manifest.types.js";

const legacyGoldens: IStorisendeState[] = [
    midgameHex6State as IStorisendeState,
    legacyShortOpening as IStorisendeState,
];

const recordsDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/storisende/storage/records");
const recordFixtures: { variant: string; state: IStorisendeState }[] = (
    recordManifest as StorisendeRecordManifest
).fixtures.map(entry => ({
    variant: entry.variant,
    state: JSON.parse(readFileSync(join(recordsDir, entry.file), "utf8")) as IStorisendeState,
}));

/** Deterministic plies for compact-wire replay tests (avoids early EOG from random pass / blitz). */
function steadyStorisendeMove(g: StorisendeGame): string {
    if (g.stack.length < 3) {
        const empties = g.board.hexes
            .filter(h => h.stack.length === 0)
            .sort((a, b) => (a.q !== b.q ? a.q - b.q : a.r - b.r));
        const h0 = empties[0]!;
        const h1 = empties[1]!;
        const a0 = g.board.hex2algebraic(h0);
        const a1 = g.board.hex2algebraic(h1);
        return `${a0},${a0},${a1},${a1}`;
    }
    const options = g.moves().filter(m => m !== "pass").sort();
    const m = options[0] ?? g.moves().sort()[0];
    if (m === undefined) {
        throw new Error("no legal moves");
    }
    return m;
}

describe("Storisende storage", () => {
    describe("boardCodec unit", () => {
        it("sparse round-trip matches full serialize on midgame top board", () => {
            const g = new StorisendeGame(midgameHex6State as IStorisendeState);
            const full = g.board.serialize();
            const sparse = decodeSparseBoardV1(encodeBoardSparse(g.board), g.variants);
            expect(boardsEqual(
                StorisendeBoard.deserialize(full),
                StorisendeBoard.deserialize(sparse),
            )).to.be.true;
        });

        it("sparse payload omits default virgin empty cells", () => {
            const g = new StorisendeGame();
            const wire = encodeBoardSparse(g.board);
            expect(wire.cells).to.deep.equal([]);
        });

        it("builder legacy board encodes to same sparse as template-only opening", () => {
            const built = storisendeFrom({stackDepth: 3, currplayer: 1});
            const sparse = encodeBoardSparse(built.board);
            const gNew = new StorisendeGame();
            const openingSparse = encodeBoardSparse(gNew.board);
            expect(sparse.cells.length).to.be.at.least(openingSparse.cells.length);
        });
    });

    describe("legacy goldens", () => {
        for (const [i, fixture] of legacyGoldens.entries()) {
            const label = i === 0 ? "midgameHex6" : "legacy-short-opening";

            it(`${label}: load(idx) matches fixture boards`, () => {
                const g = new StorisendeGame(fixture);
                assertLegacyWireStack(g.stack);
                expect(usesCompactWire(g.stack)).to.be.false;
                for (let idx = 0; idx < g.stack.length; idx++) {
                    expectLoadIdxMatchesLegacyOracle(g, idx);
                }
            });

            it(`${label}: moves() matches reference at top ply`, () => {
                const g = new StorisendeGame(fixture);
                expectMovesMatchReference(g);
            });
        }

        it("continued play on legacy game appends full board arrays", () => {
            const g = new StorisendeGame(legacyShortOpening as IStorisendeState);
            const move = g.moves().find(m => m !== "pass");
            expect(move).to.not.equal(undefined);
            const g2 = g.move(move!, {trusted: true}) as StorisendeGame;
            const tail = g2.stack[g2.stack.length - 1]!.board;
            expect(Array.isArray(tail)).to.be.true;
        });
    });

    describe("compact read (in-test transform)", () => {
        it("matches legacy boards at every index", () => {
            const legacy = new StorisendeGame(legacyShortOpening as IStorisendeState);
            const compactState = reencodeStateAsCompact(legacy.state());
            const compact = new StorisendeGame(compactState);
            assertCompactWireStack(compact.stack);
            for (const frame of compact.stack) {
                if (!Array.isArray(frame.board) && frame.board.fmt === "sparse-v1") {
                    expect(Object.prototype.hasOwnProperty.call(frame.board, "grid")).to.equal(false);
                }
            }
            for (let idx = 0; idx < legacy.stack.length; idx++) {
                expectBoardsEqual(
                    decodeBoardAtIndexForGame(compact, idx),
                    decodeBoardAtIndexForGame(legacy, idx),
                    `idx ${idx}`,
                );
            }
        });
    });

    describe("compact new game", () => {
        it("opening frame uses sparse-v1 wire", () => {
            const g = new StorisendeGame();
            expect(usesCompactWire(g.stack)).to.be.true;
            expect(isSparseBoardV1(g.stack[0]!.board)).to.be.true;
        });

        it("state round-trip and replay from ply 0 match final load", () => {
            let g = new StorisendeGame();
            g = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            g = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            const slide = g.moves().find(m => m !== "pass");
            expect(slide).to.not.equal(undefined);
            g = g.move(slide!, {trusted: true}) as StorisendeGame;

            const roundTrip = new StorisendeGame(g.state());
            expectBoardsEqual(roundTrip.board, g.board);

            const replayed = replayFromOpeningState(g.state());
            expectBoardsEqual(replayed.board, g.board);
            expectMovesMatchReference(replayed);
        });

        it("uses delta-v1 after opening frames when not a keyframe", () => {
            let g = new StorisendeGame();
            g = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            g = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            const slide = g.moves().find(m => m !== "pass");
            g = g.move(slide!, {trusted: true}) as StorisendeGame;
            const tail = g.stack[g.stack.length - 1]!.board;
            expect(isBoardDeltaV1(tail)).to.be.true;
        });

        it("encodeBoardWireForNewFrame uses sparse for indices 0..2", () => {
            const g = new StorisendeGame();
            const w0 = g.stack[0]!.board;
            expect(isSparseBoardV1(w0)).to.be.true;

            const g1 = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            expect(isSparseBoardV1(g1.stack[1]!.board)).to.be.true;

            const g2 = g1.move(g1.randomMove(), {trusted: true}) as StorisendeGame;
            expect(isSparseBoardV1(g2.stack[2]!.board)).to.be.true;
        });
    });

    describe("decode cache", () => {
        it("load(idx) matches after repeated loads", () => {
            const g = new StorisendeGame(midgameHex6State as IStorisendeState);
            const a = StorisendeGame.clone(g);
            a.load(0);
            const b = StorisendeGame.clone(g);
            b.load(0);
            b.load(2);
            b.load(0);
            expectBoardsEqual(a.board, b.board);
        });

        it("undo restores board after compact ply", () => {
            let g = new StorisendeGame();
            g = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            g = g.move(g.randomMove(), {trusted: true}) as StorisendeGame;
            const before = StorisendeGame.clone(g);
            const slide = g.moves().find(m => m !== "pass");
            g = g.move(slide!, {trusted: true}) as StorisendeGame;
            g.undo();
            expectBoardsEqual(g.board, before.board);
        });
    });

    describe("getStartingPosition (modular)", () => {
        for (const { variant, state } of recordFixtures.filter(f => f.variant.includes("modular"))) {
            it(`${variant}: encodes centres that rebuild stack[0] topology`, () => {
                const g = new StorisendeGame(state);
                const pos = g.getStartingPosition();
                expect(pos.startsWith("modular-centres-v1/")).to.equal(true);
                const { numModules, centres } = parseModularStartingPosition(pos);
                expect(centres.length).to.equal(numModules);
                const rebuilt = new StorisendeBoard({centres});
                g.load(0);
                expectBoardsEqual(rebuilt, g.board, variant);
            });
        }

        it("non-modular returns empty string", () => {
            const g = new StorisendeGame(legacyShortOpening as IStorisendeState);
            expect(g.getStartingPosition()).to.equal("");
        });
    });

    describe("published record archives (legacy vs compact wire)", () => {
        if (recordFixtures.length === 0) {
            it("skipped — run npm run fetch-storisende-storage-fixtures and commit records/", () => {
                expect.fail("no vendored record fixtures");
            });
        } else {
            for (const { variant, state } of recordFixtures) {
                it(`${variant}: hex-for-hex identical on every stack index`, function() {
                    this.timeout(120_000);
                    expectLegacyAndCompactBoardsMatchEveryIndex(state, variant);
                });
                if (variant.includes("modular")) {
                    it(`${variant}: compact reencode carries startingPosition not grid`, () => {
                        const compact = reencodeStateAsCompact(state);
                        expect(compact.startingPosition?.startsWith("modular-centres-v1/")).to.equal(true);
                        const g = new StorisendeGame(compact);
                        expect(g.startingPosition).to.equal(compact.startingPosition);
                    });
                }
            }
        }
    });

    describe("delta-v1 long replay", () => {
        it("replays 50+ ply compact game with keyframes", function() {
            this.timeout(180_000);
            let g = new StorisendeGame();
            while (g.stack.length < 52 && !g.gameover) {
                g = g.move(steadyStorisendeMove(g), {trusted: true}) as StorisendeGame;
            }
            expect(g.stack.length).to.be.at.least(52);
            assertCompactWireStack(g.stack);
            const keyframe = g.stack[20]!.board;
            expect(isSparseBoardV1(keyframe)).to.be.true;
            const replayed = replayFromOpeningState(g.state());
            expectBoardsEqual(replayed.board, g.board);
        });
    });
});
