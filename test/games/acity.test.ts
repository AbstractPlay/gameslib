/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { ACityGame } from "../../src/games/acity";
import { addResource } from "../../src";
import i18next from "i18next";

// Alien City's starting position is randomised on construction (guild colour +
// marker position for each of the 20 tiles). These helpers pin it down so the
// board geometry is deterministic for each test.
type Color = "R" | "B" | "G" | "N";
type MarkerPos = 0 | 1 | 2 | 3;

// Give every tile the same guild colour and put every marker in the tile's
// top-left (even/even) lot, so odd-column / odd-row lots are never markers.
function setUniformStart(g: ACityGame, colour: Color = "N", pos: MarkerPos = 0): void {
    g.startpos = Array.from({ length: 20 }, () => [colour, pos] as [Color, MarkerPos]);
}

// Per-tile guild colours (index = tileY*4 + tileX), markers all at position 0.
function setStartByTile(g: ACityGame, colours: Color[]): void {
    g.startpos = colours.map((c) => [c, 0] as [Color, MarkerPos]);
}

function msg(key: string): string {
    return i18next.t(`apgames:validation.acity.${key}`);
}

describe("Alien City", () => {
    before(() => {
        addResource("en");
    });

    after(() => {
        i18next.removeResourceBundle("en", "apgames");
        i18next.removeResourceBundle("en", "apresults");
    });

    describe("move parsing / validation basics", () => {
        it("empty string returns the initial instructions", () => {
            const g = new ACityGame();
            setUniformStart(g);
            const r = g.validateMove("");
            expect(r.valid).to.be.true;
            expect(r.complete).to.equal(-1);
            expect(r.message).to.equal(msg("INITIAL_INSTRUCTIONS"));
        });

        it("a bare piece is a valid partial move", () => {
            const g = new ACityGame();
            setUniformStart(g);
            const r = g.validateMove("ND");
            expect(r.valid).to.be.true;
            expect(r.complete).to.equal(-1);
            expect(r.message).to.equal(msg("PARTIAL_MOVE"));
        });

        it("rejects a piece that is not in the player's stash", () => {
            const g = new ACityGame();
            setUniformStart(g);
            g.stashes[0] = g.stashes[0].filter((p) => p !== "RT");
            const r = g.validateMove("RT-b9");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(
                i18next.t("apgames:validation.acity.INVALID_PIECE", {
                    piece: ACityGame.piece2string("RT"),
                })
            );
        });

        it("rejects placement onto an occupied lot", () => {
            const g = new ACityGame();
            setUniformStart(g);
            g.board.set("b9", "ND");
            const r = g.validateMove("ND-b9");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", { where: "b9" }));
        });

        it("rejects garbage input", () => {
            const g = new ACityGame();
            setUniformStart(g);
            expect(g.validateMove("xyzzy").valid).to.be.false;
        });

        it("accepts a simple legal dome placement (complete, no claim offered)", () => {
            const g = new ACityGame();
            setUniformStart(g);
            const r = g.validateMove("ND-b9");
            expect(r.valid).to.be.true;
            expect(r.complete).to.equal(1);
        });

        it("offers a claim when a tower is placed and claims remain", () => {
            const g = new ACityGame();
            setUniformStart(g);
            const r = g.validateMove("RT-b9");
            expect(r.valid).to.be.true;
            expect(r.complete).to.equal(0);
            expect(r.canrender).to.be.true;
            expect(r.message).to.equal(msg("VALID_W_CLAIMS"));
        });
    });

    describe("road connectivity rules", () => {
        // Fill column d (x = 3) except d5, pinching the empty network into a
        // left half (cols a-c) and a right half (cols e-h) joined only at d5.
        function pinchedBoard(): ACityGame {
            const g = new ACityGame();
            setUniformStart(g);
            for (const row of [10, 9, 8, 7, 6, 4, 3, 2, 1]) {
                g.board.set(`d${row}`, "ND");
            }
            return g;
        }

        it("isConnected() is true while the pinch point is still open", () => {
            expect(pinchedBoard().isConnected()).to.be.true;
        });

        it("rejects a placement that would break the road", () => {
            const g = pinchedBoard();
            const r = g.validateMove("ND-d5");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(i18next.t("apgames:validation.acity.BROKEN_ROAD", { where: "d5" }));
        });

        it("isConnected() is false once the pinch point is filled", () => {
            const g = pinchedBoard();
            g.board.set("d5", "ND");
            expect(g.isConnected()).to.be.false;
        });

        it("rejects a placement that would strand an existing structure", () => {
            const g = new ACityGame();
            setUniformStart(g);
            // a10 (corner) touches only b10 and a9; occupy b10 so a9 is a10's
            // last open neighbour, then try to build on a9.
            g.board.set("a10", "ND");
            g.board.set("b10", "ND");
            const r = g.validateMove("ND-a9");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(i18next.t("apgames:validation.acity.ISOLATED", { where: "a9" }));
        });

        it("a fresh board is fully connected", () => {
            const g = new ACityGame();
            setUniformStart(g);
            expect(g.isConnected()).to.be.true;
        });
    });

    describe("dome guild rules", () => {
        it("rejects an off-colour dome when a legal same-colour lot is available", () => {
            const g = new ACityGame();
            // tile 0 (a10,b10,a9,b9) is blue; everything else black.
            setStartByTile(g, ["B", ...Array<Color>(19).fill("N")]);
            const r = g.validateMove("BD-c7");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("BAD_DOME"));
        });

        it("allows an off-colour dome when the matching guild has no legal lot", () => {
            const g = new ACityGame();
            // no blue tiles at all -> a blue dome may go anywhere legal
            setUniformStart(g, "N");
            const r = g.validateMove("BD-c7");
            expect(r.valid).to.be.true;
        });

        it("allows a dome on its own guild colour", () => {
            const g = new ACityGame();
            setStartByTile(g, ["B", ...Array<Color>(19).fill("N")]);
            const r = g.validateMove("BD-b9");
            expect(r.valid).to.be.true;
        });
    });

    describe("tower guild rules", () => {
        it("rejects an off-colour tower as one of the first two structures on a coloured tile", () => {
            const g = new ACityGame();
            setStartByTile(g, ["R", ...Array<Color>(19).fill("N")]);
            const r = g.validateMove("BT-b9");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("BAD_TOWER"));
        });

        it("allows a same-colour tower on a coloured tile", () => {
            const g = new ACityGame();
            setStartByTile(g, ["R", ...Array<Color>(19).fill("N")]);
            expect(g.validateMove("RT-b9").valid).to.be.true;
        });

        it("allows an off-colour tower once two structures already stand on the tile", () => {
            const g = new ACityGame();
            setStartByTile(g, ["R", ...Array<Color>(19).fill("N")]);
            g.board.set("a10", "RD");
            g.board.set("b10", "RD");
            expect(g.validateMove("BT-b9").valid).to.be.true;
        });

        it("allows an off-colour tower on a black tile", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            expect(g.validateMove("RT-b9").valid).to.be.true;
        });
    });

    describe("marker lot rules", () => {
        it("rejects building on a marker while other lots on the tile remain playable", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            // tile 1 = c10,d10,c9,d9; marker at c10.
            const r = g.validateMove("ND-c10");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("MARKER"));
        });

        it("allows building on a marker once the rest of the tile is full", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("d10", "ND");
            g.board.set("c9", "ND");
            g.board.set("d9", "ND");
            const r = g.validateMove("ND-c10");
            expect(r.valid).to.be.true;
        });
    });

    describe("claims", () => {
        it("lets a player claim the tower they just placed", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const r = g.validateMove("RT-b9(b9)");
            expect(r.valid).to.be.true;
            expect(r.complete).to.equal(1);
        });

        it("will not let a player claim a dome they just placed", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const r = g.validateMove("RD-b9(b9)");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("CLAIM_TOWERS"));
        });

        it("lets a player claim an existing unclaimed tower", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("c9", "BT");
            expect(g.validateMove("RT-b9(c9)").valid).to.be.true;
        });

        it("rejects claiming a non-tower", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("c9", "ND");
            const r = g.validateMove("ND-b9(c9)");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("CLAIM_TOWERS"));
        });

        it("rejects claiming an already-claimed tower", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("c9", "BT");
            g.claimed[1] = ["c9"];
            const r = g.validateMove("RT-b9(c9)");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(i18next.t("apgames:validation.acity.DOUBLE_CLAIM", { where: "c9" }));
        });

        it("rejects a fourth claim", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("c9", "BT");
            g.claimed[0] = ["h1", "h2", "h3"];
            const r = g.validateMove("RT-b9(c9)");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("NO_MORE_CLAIMS"));
        });
    });

    describe("applying moves", () => {
        it("places a piece, removes it from the stash, and passes the turn", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const beforeND = g.stashes[0].filter((p) => p === "ND").length;
            g.move("ND-b9");
            expect(g.board.get("b9")).to.equal("ND");
            expect(g.stashes[0].filter((p) => p === "ND").length).to.equal(beforeND - 1);
            expect(g.currplayer).to.equal(2);
            expect(g.results.some((r) => r.type === "place")).to.be.true;
        });

        it("records a claim", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.move("RT-b9(b9)");
            expect(g.claimed[0]).to.deep.equal(["b9"]);
            expect(g.results.some((r) => r.type === "claim")).to.be.true;
        });

        it("rejects an invalid move via move()", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("b9", "ND");
            expect(() => g.move("ND-b9")).to.throw();
        });
    });

    describe("end of game", () => {
        it("ends after two consecutive passes and ties on an empty board", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.move("pass", { trusted: true });
            g.move("pass", { trusted: true });
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1, 2]);
        });

        it("nullifies the last-move claim when the game passes out", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.move("RT-b9(b9)"); // p1 places and claims
            expect(g.claimed[0]).to.deep.equal(["b9"]);
            g.move("pass", { trusted: true }); // p2
            g.move("pass", { trusted: true }); // p1 -> two passes in a row
            expect(g.gameover).to.be.true;
            expect(g.claimed[0]).to.deep.equal([]);
            expect(g.results.some((r) => r.type === "nullifyClaim")).to.be.true;
        });

        it("pass is not a legal move when placements are available", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const r = g.validateMove("pass");
            expect(r.valid).to.be.false;
            expect(r.message).to.equal(msg("INVALID_PASS"));
        });
    });

    describe("move generation", () => {
        it("randomMove() returns a well-formed placement on a fresh board", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const m = g.randomMove();
            expect(m).to.not.equal("pass");
            expect(m).to.match(/^[RGBN][DT]-[a-h]\d+$/);
            expect(g.validateMove(m).valid).to.be.true;
        });

        it("getButtons() offers no pass button on a fresh board", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            expect(g.getButtons()).to.deep.equal([]);
        });

        it("moves() yields only valid, complete moves and never 'pass' on a fresh board", function () {
            this.timeout(120000);
            const g = new ACityGame();
            setUniformStart(g, "N");
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves).to.not.include("pass");
            for (const m of moves.slice(0, 25)) {
                const r = g.validateMove(m);
                expect(r.valid, `expected ${m} to be valid`).to.be.true;
                expect(r.complete).to.be.greaterThan(-1);
            }
        });
    });

    describe("scoring", () => {
        it("scores a claimed tower by customer base times distance to a like tower", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            // two red towers two lots apart on column a, plus one black dome
            // within range as a customer.
            g.board.set("a10", "RT");
            g.board.set("a8", "RT");
            g.board.set("c10", "ND");
            g.claimed[0] = ["a10"];
            expect(g.getPlayerScore(1)).to.equal(1);
            expect(g.getPlayerScore(2)).to.equal(0);
        });

        it("an unclaimed board scores zero for both players", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.board.set("a10", "RT");
            g.board.set("a8", "BT");
            expect(g.getPlayerScore(1)).to.equal(0);
            expect(g.getPlayerScore(2)).to.equal(0);
        });

        it("sidebarScores reports score and remaining claims", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.claimed[0] = ["a10"];
            const scores = g.sidebarScores();
            expect(scores[1].scores).to.deep.equal([2, 3]);
        });
    });

    describe("rendering / clicks", () => {
        it("render() produces a board rep", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const rep = g.render();
            expect(rep.board).to.not.be.undefined;
        });

        it("handleClick on a stash piece selects it", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            const r = g.handleClick("", -1, -1, "ND");
            expect(r.move).to.equal("ND");
        });

        it("handleClick on an empty lot after selecting a piece forms a placement", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            // b9 -> col 1, row 1
            const r = g.handleClick("ND", 1, 1, undefined);
            expect(r.move).to.equal("ND-b9");
        });
    });

    describe("serialisation", () => {
        it("round-trips through clone()", () => {
            const g = new ACityGame();
            setUniformStart(g, "N");
            g.move("ND-b9");
            const clone = g.clone();
            expect(clone.board.get("b9")).to.equal("ND");
            expect(clone.currplayer).to.equal(2);
            expect(clone.getStartingPosition()).to.equal(g.getStartingPosition());
        });
    });
});
