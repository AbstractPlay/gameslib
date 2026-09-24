/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../../src";
import { ArimaaGame } from '../../src/games';

describe("Arimaa", () => {
    before(() => {
        addResource("en");
    });

    it ("EOG scenarios", () => {
        // all rabbits on same turn
        let g = new ArimaaGame(undefined, ["free"]);
        g.move("Rc3,Ed3");
        g.move("re3,ee5");
        g.move("re3f3,Ed3e3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);

        // no possible moves (all frozen or blocked in)
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Rd4, Eh1");
        g.move("hd5, eh2, eg1, rg6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);

        // pushing a rabbit onto the goal then pulling it off doesn't end the game
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2, Rb7");
        g.move("eg7, re2");
        g.move("re2e1, Ed2e2, Ee2e3, re1e2");
        expect(g.gameover).to.be.false;

        // both at same time, person who just moved wins
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Rd7, Ee2");
        g.move("rd2");
        g.move("Rd7d8, rd2d1, Ee2d2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it ("Free placement", () => {
        const g = new ArimaaGame(undefined, ["free"]);
        // can place anywhere
        let result = g.validateMove("Ec3");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        // must place a rabbit
        result = g.validateMove("Ec3,Rd4");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        // can't place a rabbit on the goal row
        result = g.validateMove("Ec3,Rd4,Rd8");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        g.move("Ec3,Rd4");
        g.move("ed5,rd6");
        // traps trigger after setup
        expect(g.board.get("c3")).to.be.undefined;
        // setup phase ends correctly
        result = g.validateMove("Ec3");
        expect(result.valid).to.be.false;
    });

    it ("General setup issues", () => {
        // can't place opposing pieces manually
        let g = new ArimaaGame();
        g.move("ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2,Cf2,Cc2,Dd1,De1");
        const [pc, owner] = g.board.get("e2")!;
        expect(pc).to.equal("E");
        expect(owner).to.equal(1);

        // warnings
        g = new ArimaaGame();
        g.move("Ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2,Cf2,Cc2,Dd1,De1");
        // no warnings
        let result = g.validateMove("me7,ed7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,de8,cd8,dc7");
        expect(result.message).to.equal(i18next.t("apgames:validation._general.VALID_MOVE"));
        // same file
        result = g.validateMove("ee7,md7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,de8,cd8,dc7");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_FILE"));
        // unbalanced
        result = g.validateMove("ea7,mb7,hc7,hd7,ce7,df7,dg7,ch7,ra8,rb8,rc8,rd8,re8,rf8,rg8,rh8");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_BALANCE"));
        // hiding
        result = g.validateMove("ed7,me7,hb7,hg7,ra7,ra8,rb8,rc8,rg8,rh8,rh7,cf8,rf7,cd8,de8,dc7");
        expect(result.message).to.equal(i18next.t("apgames:validation._general.VALID_MOVE"));
        result = g.validateMove("ed7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,ce7,dc7,dd8,me8");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_HIDE"));
    });

    it ("Rabbit autofill in standard setup", () => {
        const nonrabbits = "Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1,De1";
        let g = new ArimaaGame();
        // not until every non-rabbit is down
        let result = g.validateMove("Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        // eight non-rabbits and no rabbits is submittable
        result = g.validateMove(nonrabbits);
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.PARTIAL_RABBITS"));
        // and so is anything between that and a full setup
        result = g.validateMove(`${nonrabbits},Ra2,Ra1,Rb1`);
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        // advice is given against the filled-in setup, not the partial one
        result = g.validateMove("Ea2,Mb2,Hc2,Hd2,Ce2,Df2,Dg2,Ch2");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_BALANCE"));

        // submitting fills the empty cells of the setup area with rabbits
        g.move(nonrabbits);
        for (const cell of ["a2", "h2", "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"]) {
            const contents = g.board.get(cell);
            expect(contents).to.not.be.undefined;
            if (cell === "d1" || cell === "e1") {
                expect(contents![0]).to.equal("D");
            } else {
                expect(contents![0]).to.equal("R");
                expect(contents![1]).to.equal(1);
            }
        }
        expect(g.hands![0]).to.be.empty;
        // silver works the same way
        g.move("ee7,md7,hb7,hg7,cf7,cc7,dd8,de8");
        expect(g.board.get("a7")![0]).to.equal("R");
        expect(g.board.get("a7")![1]).to.equal(2);
        expect(g.hands).to.be.undefined;
        expect([...g.board.values()].filter(([pc,]) => pc === "R")).to.have.lengthOf(16);

        // partially placed rabbits are left where the player put them
        g = new ArimaaGame();
        g.move(`${nonrabbits},Ra2,Rh2`);
        expect(g.board.get("a2")![0]).to.equal("R");
        expect([...g.board.values()].filter(([pc,]) => pc === "R")).to.have.lengthOf(8);
        expect(g.hands![0]).to.be.empty;

        // a complete setup still produces the same result as before
        g = new ArimaaGame();
        g.move(`${nonrabbits},Ra2,Rh2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1`);
        const filled = new ArimaaGame();
        filled.move(nonrabbits);
        expect(g.signature()).to.equal(filled.signature());

        // the shortcut doesn't apply to the free variant
        g = new ArimaaGame(undefined, ["free"]);
        result = g.validateMove("Ec3");
        expect(result.message).to.not.include(i18next.t("apgames:validation.arimaa.PARTIAL_RABBITS"));
    });

    it ("Free setup defaults to placing a rabbit", () => {
        // clicking an empty cell with nothing selected places a rabbit
        let g = new ArimaaGame(undefined, ["free"]);
        let result = g.handleClick("", 4, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Rd4");
        // but an explicitly chosen piece still wins
        result = g.handleClick("E", 4, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ed4");
        // silver too
        g.move("Rd4");
        result = g.handleClick("", 3, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("rd5");

        // standard setup still offers the strongest piece in hand
        g = new ArimaaGame();
        result = g.handleClick("", 6, 4);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ee2");
        result = g.handleClick("Ee2", 6, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ee2,Md2");
    });

    it ("Can't place two pieces on one cell", () => {
        // only reachable by typing; the click handler refuses to drop onto an
        // occupied cell. Used to throw an unhandled TypeError in standard setup
        // (the hand emptied while a home cell stayed empty) and to be accepted
        // silently in free setup, overwriting the earlier piece.
        let g = new ArimaaGame();
        let result = g.validateMove("Ee2,Me2,Hb2,Hg2,Cf2,Cc2,Dd1,De1,Ra2,Rh2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "e2"}));
        g = new ArimaaGame(undefined, ["free"]);
        result = g.validateMove("Ec3,Mc3,Rd4");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "c3"}));
        // placing onto an opponent's piece is still caught the same way
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ec3,Rd4");
        result = g.validateMove("ec3");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "c3"}));
    });

    it ("classifications", () => {
        expect(ArimaaGame.classify(1, "Ra1,Ed4".split(","))).to.deep.equal(["placement", "placement"]);
        expect(ArimaaGame.classify(2, "Ra1,Ed4".split(","))).to.deep.equal([undefined, undefined]);
        expect(ArimaaGame.classify(1, "rd5d6,Ed4d5,rd3d4".split(","))).to.deep.equal(["pushee", "pusher", undefined]);
        expect(ArimaaGame.classify(1, "Hd6d7,rd5d6,Ed4d5,rd3d4".split(","))).to.deep.equal(["puller", "pullee", "puller", "pullee"]);
    });

    it ("Push + Pull", () => {
        // can't immediately push then pull
        let g = new ArimaaGame(undefined, ["free"]);
        g.move("Ra1,Ed4");
        g.move("rd3,rd5");
        let result = g.validateMove("rd5d6,Ed4d5,rd3d4");
        expect(result.valid).to.be.false;

        // but can pull out from then push into
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ra1,Ed4,Hd6");
        g.move("rd5,rd3");
        result = g.validateMove("Hd6d7,rd5d6,Ed4d5,rd3d4");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(1);
    });

    it ("Harlog status shows the leader's colour instead of a sign", () => {
        // balanced material: no glyph
        let g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2,Rd3");
        g.move("ed7,rd6");
        let [status] = g.sidebarStatuses();
        expect(status.value).to.deep.equal(["0.00"]);

        // nonzero but displayed as all zeros: no glyph, no sign
        g.harlog = () => -0.004;
        [status] = g.sidebarStatuses();
        expect(status.value).to.deep.equal(["0.00"]);

        // gold ahead
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2,Mg2,Rd3");
        g.move("ed7,rd6");
        [status] = g.sidebarStatuses();
        expect(g.harlog()).to.be.greaterThan(0);
        expect(status.value).to.deep.equal([
            { glyph: "piece", colour: g.getPlayerColour(1) },
            g.harlog().toFixed(2),
        ]);

        // silver ahead: the number is unsigned
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2,Rd3");
        g.move("ed7,mg7,rd6");
        [status] = g.sidebarStatuses();
        expect(g.harlog()).to.be.lessThan(0);
        expect(status.value).to.deep.equal([
            { glyph: "piece", colour: g.getPlayerColour(2) },
            Math.abs(g.harlog()).toFixed(2),
        ]);

        // infinite values keep the leader's glyph; NaN has no leader
        g.harlog = () => Infinity;
        expect(g.sidebarStatuses()[0].value).to.deep.equal([{ glyph: "piece", colour: g.getPlayerColour(1) }, "Infinity"]);
        g.harlog = () => -Infinity;
        expect(g.sidebarStatuses()[0].value).to.deep.equal([{ glyph: "piece", colour: g.getPlayerColour(2) }, "Infinity"]);
        g.harlog = () => NaN;
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["NaN"]);
    });
});


// ---------------------------------------------------------------------------
// Lightvector notation and arrow entry

import { isLegacy, parseMove, parseToken, NotationError } from "../../src/games/arimaa/notation";
import { resolve, serializeTurn, sqName, turnFromSteps, type CellContents } from "../../src/games/arimaa/turns";
import { arimaaRecords } from "../fixtures/arimaa/records";
import { allTurns, boardOf as coverageBoard, unsupportedOnTrap, type Owner } from "../fixtures/arimaa/coverage";

const rc = (cell: string): [number, number] => {
    const [x, y] = ArimaaGame.algebraic2coords(cell);
    return [y, x];
};
const click = (g: ArimaaGame, move: string, cell: string) => g.handleClick(move, ...rc(cell));
const annotations = (g: ArimaaGame): string[] => {
    const rep = g.render();
    const name = (t: {row: number; col: number}): string => ArimaaGame.coords2algebraic(t.col, t.row);
    return ((rep.annotations ?? []) as Array<{type: string; targets: Array<{row: number; col: number}>}>).map(a => `${a.type}:${a.targets.map(name).join(">")}`);
};
// free placement lets a test build any position: gold places, silver places, gold to move
const position = (gold: string, silver: string): ArimaaGame => {
    const g = new ArimaaGame(undefined, ["free"]);
    g.move(gold);
    g.move(silver);
    return g;
};
const boardOf = (spec: string): Map<string, CellContents> => {
    const b = new Map<string, CellContents>();
    for (const t of spec.trim().split(/\s+/)) {
        b.set(t.slice(1), [t[0].toUpperCase() as CellContents[0], t[0] === t[0].toUpperCase() ? 1 : 2]);
    }
    return b;
};

describe("Arimaa notation parser", () => {
    it("splits tokens from the right", () => {
        const cases: Array<[string, string, string]> = [
            ["Ed4", "E", "dest:d4"],
            ["d4e5", "d4", "dest:e5"],
            ["Ed4e5", "Ed4", "dest:e5"],
            ["ee", "e", "steps:e"],
            ["eee", "e", "steps:ee"],
            ["en", "e", "steps:n"],
            ["d4ee", "d4", "steps:ee"],
            ["de4e", "de4", "steps:e"],
            ["Ed4news", "Ed4", "steps:news"],
            ["h5x", "h5", "capture"],
            ["hh5", "h", "dest:h5"],
            ["hx", "h", "capture"],
            ["Rc3x", "Rc3", "capture"],
        ];
        for (const [text, spec, prop] of cases) {
            const t = parseToken(text);
            const specText = `${t.spec.piece === undefined ? "" : (t.spec.owner === 1 ? t.spec.piece : t.spec.piece.toLowerCase())}${t.spec.square ?? ""}`;
            const propText = t.prop.kind === "dest" ? `dest:${t.prop.square}` : t.prop.kind === "steps" ? `steps:${t.prop.dirs.join("")}` : "capture";
            expect(specText, text).to.equal(spec);
            expect(propText, text).to.equal(prop);
        }
    });
    it("rejects malformed tokens", () => {
        for (const bad of ["x", "e4", "R", "n", "garbage!", "4e", "Ex4", "z3", "i9x", "Ed4x4"]) {
            expect(() => parseToken(bad), bad).to.throw(NotationError);
        }
    });
    it("recognises legacy strings", () => {
        expect(isLegacy("Db4b5, Ra5a6")).to.be.true;
        expect(isLegacy("Dc4c3(xDc3)")).to.be.true;
        expect(isLegacy("Ec3,Rd4,xRc3")).to.be.true;
        expect(isLegacy("Db4b5")).to.be.false;
        expect(isLegacy("Ed4 Me")).to.be.false;
        expect(isLegacy("dx")).to.be.false;
    });
    it("keeps a trailing bare square as the pending selection only when allowed", () => {
        const p = parseMove("Ed4e4 e4", true);
        expect(p.tokens.map(t => t.text)).to.deep.equal(["Ed4e4"]);
        expect(p.pending).to.equal("e4");
        expect(() => parseMove("Ed4e4 e4")).to.throw(NotationError);
        expect(() => parseMove("e4 Ed4e4", true)).to.throw(NotationError);
        // two trailing squares: the selection before the current one is kept too
        const q = parseMove("Ed4e4 d4 e4", true);
        expect(q.tokens.map(t => t.text)).to.deep.equal(["Ed4e4"]);
        expect(q.previous).to.equal("d4");
        expect(q.pending).to.equal("e4");
        expect(() => parseMove("d4 e4 Ed4e4", true)).to.throw(NotationError);
    });
});

describe("Arimaa resolution", () => {
    const flip = boardOf("Hg3 dh3 Cf2 Ra2 ra7 Ee1 ee8");
    it("resolves the flip from any of its spellings and writes it as dx", () => {
        for (const m of ["dx", "df3", "dh3f3", "dh3x"]) {
            const r = resolve(flip, 1, 4, parseMove(m).tokens, false);
            expect(r.status, m).to.equal("resolved");
            if (r.status === "resolved") {
                expect(r.bucket).to.deep.equal([4, 1]);
                expect(r.turn.captures.map(c => sqName(c.square))).to.deep.equal(["f3"]);
                expect(serializeTurn(flip, 1, 4, r.turn)).to.equal("dx");
            }
        }
    });
    it("reports ambiguity and unsatisfiability", () => {
        expect(resolve(flip, 1, 4, parseMove("dg3").tokens, false).status).to.equal("ambiguous");
        expect(resolve(flip, 1, 4, parseMove("Hg3g4 dh3f3").tokens, false).status).to.equal("unsatisfiable");
        expect(resolve(flip, 1, 4, parseMove("Ea8").tokens, false).status).to.equal("unsatisfiable");
    });
    it("needs the pusher named when two pieces could push", () => {
        const b = boardOf("Ed4 Hf4 re4 Ra1 ra8 ee8");
        expect(resolve(b, 1, 4, parseMove("re4e5").tokens, false).status).to.equal("ambiguous");
        const r = resolve(b, 1, 4, parseMove("re4e5 Ed4e4").tokens, false);
        expect(r.status).to.equal("resolved");
        if (r.status === "resolved") {
            expect(r.bucket).to.deep.equal([2, 2]);
            expect(serializeTurn(b, 1, 4, r.turn)).to.equal("re5 Ee4");
        }
    });
    it("treats a round trip as equivalent to the walk that reaches the same position", () => {
        const b = boardOf("Ed2 re2 Rb7 eg7 rf8 Ra1");
        const turn = turnFromSteps(b, 1, [{from: "e2", to: "e1"}, {from: "d2", to: "e2"}, {from: "e2", to: "e3"}, {from: "e1", to: "e2"}]);
        expect(turn.displaced).to.equal(1);
        expect(serializeTurn(b, 1, 4, turn)).to.equal("Ee3");
        const r = resolve(b, 1, 4, parseMove("Ee3").tokens, false);
        expect(r.status).to.equal("resolved");
        if (r.status === "resolved") {
            expect(r.bucket).to.deep.equal([2, 1]);
            expect(r.turn.signature).to.equal(turn.signature);
        }
    });
    it("does not count a piece that steps out and dies back on its start square", () => {
        // net displacement: the cat's final square is the trap it started on
        const b = boardOf("Cc3 Rc2 Ra1 ee8 ra8");
        const turn = turnFromSteps(b, 1, [{from: "c3", to: "b3"}, {from: "c2", to: "d2"}, {from: "b3", to: "c3"}]);
        const cat = turn.trajectories.find(tr => tr.type === "C")!;
        expect(cat.captured).to.be.true;
        expect(cat.final).to.equal(cat.start);
        expect(turn.displaced).to.equal(1);
    });
    it("orders step tokens as written", () => {
        // Lightvector's example, shifted off the traps: the same four tokens
        // in another order name a different sequence, here one nobody can play
        const b = boardOf("Rd3 Rc4 Ee1 Ra1 ra8 ee8");
        const a = resolve(b, 1, 4, parseMove("d3n d4n c4e d4e").tokens, false);
        expect(a.status).to.equal("resolved");
        if (a.status === "resolved") {
            expect(a.turn.steps.map(s => `${sqName(s.from)}${s.dir}`)).to.deep.equal(["d3n", "d4n", "c4e", "d4e"]);
        }
        expect(resolve(b, 1, 4, parseMove("d3n d4e d4n c4e").tokens, false).status).to.equal("unsatisfiable");
        // without the ordering the tokens would also fit the other interleaving
        const c = resolve(b, 1, 4, parseMove("c4e d4n d3n d4e").tokens, false);
        expect(c.status).to.equal("resolved");
        if (c.status === "resolved") {
            expect(c.turn.steps.map(s => `${sqName(s.from)}${s.dir}`)).to.deep.equal(["c4e", "d4n", "d3n", "d4e"]);
        }
    });
    it("lets a pulled piece end where the puller started", () => {
        // the pruning heuristic once demanded the pulled rabbit be moved off g5 again
        const b = boardOf("mg5 Rh5 hh7 ee8 Ee1 ra8 Ra1");
        const r = resolve(b, 2, 4, parseMove("mg5g3 Rh5g5 hh7h6").tokens, false);
        expect(r.status).to.equal("resolved");
        if (r.status === "resolved") {
            expect(r.bucket).to.deep.equal([4, 3]);
            expect(serializeTurn(b, 2, 4, r.turn)).to.equal("mg3 Rg5 hh6");
        }
        const c = boardOf("rb6 mb5 Ra5 ee8 Ee1 ra8 Rh1");
        const r2 = resolve(c, 2, 4, parseMove("rb6x mb5x Ra5b5").tokens, false);
        expect(r2.status).to.equal("resolved");
    });
    it("pruning never changes an answer", function () {
        this.timeout(120000);
        // deterministic pseudo-random positions and token sets: sparse boards
        // searched four steps deep, then denser ones three steps deep
        // mulberry32: a plain LCG overflows double precision here and collapses
        let seed = 12345;
        const rnd = (n: number): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) % n;
        };
        const types = ["E", "M", "H", "D", "C", "R"];
        const key = (r: ReturnType<typeof resolve>): string => r.status === "resolved" ? `${r.status}:${r.bucket}:${r.turn.signature}` : r.status === "ambiguous" ? `${r.status}:${r.bucket}:${r.positions}` : r.status;
        const square = (): string => `${"abcdefgh"[rnd(8)]}${1 + rnd(8)}`;
        const check = (pieces: number, maxSteps: number): void => {
            const b = new Map<string, CellContents>();
            for (let i = 0; i < pieces; i++) {
                const cell = square();
                if (!b.has(cell)) {
                    b.set(cell, [types[rnd(6)] as CellContents[0], (1 + rnd(2)) as 1 | 2]);
                }
            }
            // a legal position has no unsupported piece on a trap
            for (const trap of ["c3", "f3", "c6", "f6"]) {
                if (b.has(trap)) {
                    const [x, y] = ArimaaGame.algebraic2coords(trap);
                    const owner = b.get(trap)![1];
                    const supported = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => b.get(ArimaaGame.coords2algebraic(nx, ny))?.[1] === owner);
                    if (!supported) {
                        b.delete(trap);
                    }
                }
            }
            const player = (1 + rnd(2)) as 1 | 2;
            const cells = [...b.keys()];
            const letterOf = (cell: string): string => {
                const [pc, owner] = b.get(cell)!;
                return owner === 1 ? pc : pc.toLowerCase();
            };
            const tokens: string[] = [];
            for (let k = 0; k < 1 + rnd(2) && cells.length > 0; k++) {
                const from = cells[rnd(cells.length)];
                // half the destinations are squares other pieces occupy, where the
                // heuristic's occupancy reasoning is exercised
                const to = rnd(2) === 0 ? cells[rnd(cells.length)] : square();
                const letter = letterOf(from);
                switch (rnd(6)) {
                    case 0:
                        tokens.push(`${letter}${from}x`);
                        break;
                    case 1:
                        tokens.push(`${letter}${to}`);
                        break;
                    case 2:
                        tokens.push(`${letter}${from}${"nsew"[rnd(4)]}`);
                        break;
                    case 3:
                        // two tokens for one square
                        tokens.push(`${letter}${from}${to}`, `${letterOf(cells[rnd(cells.length)])}${to}`);
                        break;
                    default:
                        tokens.push(`${letter}${from}${to}`);
                }
            }
            const parsed = parseMove(tokens.join(" ")).tokens;
            const pruned = resolve(b, player, maxSteps, parsed, false, true);
            const full = resolve(b, player, maxSteps, parsed, false, false);
            expect(key(pruned), `${[...b.entries()].map(([c, [p, o]]) => (o === 1 ? p : p.toLowerCase()) + c).join(" ")} / ${tokens.join(" ")} / player ${player} / ${maxSteps} steps`).to.equal(key(full));
        };
        for (let trial = 0; trial < 150; trial++) {
            check(4 + rnd(4), 4);
        }
        for (let trial = 0; trial < 60; trial++) {
            check(9 + rnd(5), 3);
        }
    });
});

describe("Arimaa arrow entry", () => {
    it("enters a flip in two clicks and records it as dx", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        let r = click(g, "", "h3");
        expect(r.move).to.equal("h3");
        expect(r.complete).to.equal(-1);
        r = click(g, r.move, "f3");
        expect(r.move).to.equal("dh3f3");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        const preview = g.clone();
        preview.move(r.move, {partial: true});
        expect(annotations(preview)).to.have.members(["enter:g3", "move:h3>f3", "exit:f3"]);
        g.move(r.move);
        expect(g.lastmove).to.equal("dx");
        expect(g.board.has("h3")).to.be.false;
        expect(g.board.get("g3")).to.deep.equal(["H", 1]);
        expect(annotations(g)).to.have.members(["enter:g3", "move:h3>f3", "exit:f3"]);
        expect(g.results.filter(x => x.type === "move").length).to.equal(4);
        expect(g.results.filter(x => x.type === "destroy").length).to.equal(1);
    });
    it("holds an ambiguous push by arrowing the pusher onto the vacated square", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let r = click(g, "", "e4");
        r = click(g, r.move, "e5");
        expect(r.move).to.equal("re4e5");
        expect(r.complete).to.equal(-1);
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("re4e5 d4");
        r = click(g, r.move, "e4");
        expect(r.move).to.equal("re4e5 Ed4e4");
        expect(r.complete).to.equal(0);
        g.move(r.move);
        expect(g.lastmove).to.equal("re5 Ee4");
    });
    it("enters a pull in four clicks", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let r = click(g, "", "d4");
        r = click(g, r.move, "c4");
        r = click(g, r.move, "e4");
        expect(r.move).to.equal("Ed4c4 e4");
        // the arrows already form a move; the selection only adds a hint
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain(i18next.t("apgames:validation.arimaa.INCOMPLETE"));
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("Ed4c4 re4d4");
        g.move(r.move);
        expect(g.lastmove).to.equal("Ec4 rd4");
        expect(annotations(g)).to.have.members(["move:d4>c4", "move:e4>d4"]);
    });
    it("re-selects, holds, extends from an arrow head and deletes from its tail", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let r = click(g, "", "d4");
        r = click(g, r.move, "f4");
        // another piece re-selects, remembering the first for a second click
        expect(r.move).to.equal("d4 f4");
        r = click(g, r.move, "f4");
        // which sends the first onto this square; the horse has to make way,
        // and where it goes is still open
        expect(r.move).to.equal("Ed4f4");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(-1);
        r = click(g, "d4", "d6");
        expect(r.move).to.equal("Ed4d6");
        r = click(g, r.move, "d6");
        expect(r.move).to.equal("Ed4d6 d6");
        r = click(g, r.move, "e6");
        expect(r.move).to.equal("Ed4e6");
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("d4");
        // a second click on a selected piece holds it; a click on the hold lifts it
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("Ed4d4");
        expect(r.valid).to.be.true;
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("d4");
        // an empty square with nothing selected is a no-op
        r = click(g, "", "b5");
        expect(r.move).to.equal("");
    });
    it("rejects a click that no legal move can satisfy and keeps the previous move", () => {
        const g = position("Ed4,Ra1", "ee5,ra8");
        let r = click(g, "d4", "h8");
        expect(r.move).to.equal("d4");
        expect(r.valid).to.be.false;
        // an occupied, unvacated square is a re-selection, never a destination
        r = click(g, "d4", "e5");
        expect(r.move).to.equal("d4 e5");
        expect(r.valid).to.be.true;
    });
    it("rejects arrows no turn can satisfy on a full board, and says why", () => {
        const g = new ArimaaGame();
        g.move("Ee2,Md2,Hb2,Hg2,Dd1,De1,Cc2,Cf2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2");
        g.move("ee7,md7,hb7,hg7,dd8,de8,cc7,cf7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7");
        const rejected = (m: string): string => {
            const r = g.validateMove(m);
            expect(r.valid, m).to.be.false;
            return r.message!;
        };
        // a rabbit backward
        expect(rejected("Ra2a1")).to.equal(i18next.t("apgames:validation.arimaa.BACKWARDS"));
        // two pieces on one square: each arrow works alone
        expect(rejected("Hb2b3 Ra2b3")).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE_TOGETHER", {num: 4}));
        // a boxed-in piece, and one on the back rank with the front rank in the way
        expect(rejected("Rh1h4")).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE_REACH", {from: "h1", to: "h4", num: 4}));
        expect(rejected("De1d3")).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE_REACH", {from: "e1", to: "d3", num: 4}));
        // an enemy piece nothing can push or pull, which is also what a click
        // on the wrong side's piece produces
        expect(rejected("ra7a6")).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE_ENEMY", {from: "a7", num: 4}));
        // the old step list typed with spaces reads as two elephants
        expect(rejected("Ee2e3 Ee3e4")).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE_CHAIN", {first: "Ee2e3", second: "Ee3e4", combined: "Ee2e4"}));
        // typed tokens with nothing to point at keep the plain message
        for (const m of ["ex", "mx", "Ra2s"]) {
            expect(rejected(m), m).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE"));
        }
        // a frozen piece nothing can free in time
        const f = position("Ma4,Rh1", "ea5,rh8");
        const fr = f.validateMove("Ma4b4");
        expect(fr.valid).to.be.false;
        expect(fr.message).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE_FROZEN", {from: "a4"}));
    });
    it("charges a destination for its longest arrow only, since one piece can answer for all of them", () => {
        // three steps by one elephant, however many of its squares are named
        const g = position("Ed4,Ra1", "ee8,ra8");
        for (const m of ["Ed4g4 Ee4g4", "Ed4g4 Ed4g4", "Ed4g4 Ef4g4"]) {
            const r = g.validateMove(m);
            expect(r.valid, m).to.be.true;
            expect(r.complete, m).to.equal(0);
        }
        // one rabbit can visit c3 on its way, once the other steps aside
        const h = position("Rc2,Rc3,Ra1", "ee8,ra8");
        expect(h.validateMove("Rc3c5 Rc2c5").valid).to.be.true;
        // distinct destinations are distinct pieces, whose steps still add up
        const r = g.validateMove("Ed4g4 Ed4a4");
        expect(r.valid).to.be.false;
        expect(r.message).to.equal(i18next.t("apgames:validation.arimaa.TOO_LONG", {num: 4}));
    });
    it("keeps a hold visible once the move resolves", () => {
        const g = position("Ed4,Cc4,Ra1", "ee8,ra8");
        let r = click(g, "", "d4");
        r = click(g, r.move, "e4");
        r = click(g, r.move, "c4");
        r = click(g, r.move, "c4");
        expect(r.move).to.equal("Ed4e4 Cc4c4");
        expect(r.valid).to.be.true;
        g.move(r.move, {partial: true});
        expect(annotations(g)).to.include("move:d4>e4");
        expect(annotations(g)).to.include("enter:c4");
    });
    it("holds a piece that steps out and back with a second click on it", () => {
        // the elephant pushes the dog into the trap and returns; without the hold
        // the arrows read as the three-step turn that leaves it on d6
        const g = position("Ee6,Cg2,Ra1", "dd6,ra8,ee8");
        let r = click(g, "", "d6");
        r = click(g, r.move, "c6");
        r = click(g, r.move, "g2");
        r = click(g, r.move, "g3");
        expect(r.move).to.equal("dd6c6 Cg2g3");
        expect(r.valid).to.be.true;
        expect(r.message).to.contain("Ee6d6");
        r = click(g, r.move, "e6");
        r = click(g, r.move, "e6");
        expect(r.move).to.equal("dd6c6 Cg2g3 Ee6e6");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        const preview = g.clone();
        preview.move(r.move, {partial: true});
        expect(annotations(preview)).to.include.members(["enter:e6", "move:d6>c6", "exit:c6", "move:g2>g3"]);
        g.move(r.move);
        expect(g.lastmove).to.equal("Cg3 dx Ee6");
        expect(g.board.get("e6")).to.deep.equal(["E", 1]);
        expect(g.board.has("c6")).to.be.false;
    });
    it("completes an arrow onto an occupied square with a second click on it", () => {
        // a rotation: the elephant pulls one rabbit and pushes the other,
        // ending where the second one stood
        const g = position("Eh5,Ra1", "rh6,rg6,ra8,ee8");
        let r = click(g, "", "h5");
        r = click(g, r.move, "g6");
        expect(r.move).to.equal("h5 g6");
        r = click(g, r.move, "g6");
        expect(r.move).to.equal("Eh5g6");
        expect(r.valid).to.be.true;
        r = click(g, r.move, "g6");
        expect(r.move).to.equal("Eh5g6 g6");
        r = click(g, r.move, "h6");
        r = click(g, r.move, "h6");
        expect(r.move).to.equal("Eh5g6 rg6h6");
        r = click(g, r.move, "h6");
        r = click(g, r.move, "h5");
        expect(r.move).to.equal("Eh5g6 rg6h6 rh6h5");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        g.move(r.move);
        expect(g.board.get("g6")).to.deep.equal(["E", 1]);
        expect(g.board.get("h6")).to.deep.equal(["R", 2]);
        expect(g.board.get("h5")).to.deep.equal(["R", 2]);
    });
    it("holds a blocker so that a piece walks around it", () => {
        const g = position("Re2,De3,Ra1", "ra8,ee8");
        let r = click(g, "", "e2");
        r = click(g, r.move, "e4");
        expect(r.move).to.equal("Re2e4");
        // the shorter reading moves the dog aside (to d3 rather than the trap)
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain("De3d3");
        r = click(g, r.move, "e3");
        r = click(g, r.move, "e3");
        expect(r.move).to.equal("Re2e4 De3e3");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        g.move(r.move);
        expect(g.board.get("e4")).to.deep.equal(["R", 1]);
        expect(g.board.get("e3")).to.deep.equal(["D", 1]);
        expect(g.lastmove).to.equal("Re4 De3");
    });
    it("marks a piece on a trap captured with a third click on it", () => {
        // from a recorded game, mirrored: the horse leaves its rabbit on the
        // trap unsupported; read without the mark, the rabbit's own move comes
        // first and keeps it alive
        const g = position("Ra1,Rg1,Rh1,Rh2,Ce1,Ca2,Hb3,Dh3,Rg2,Rb2,Ef2,Rd2,Hf3,Dc5,Rc3,Mb4", "ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cc7,df7,ce8,dd7,mf4,hg3,he3,ec4");
        let r = click(g, "", "b3");
        r = click(g, r.move, "a4");
        r = click(g, r.move, "b4");
        r = click(g, r.move, "b3");
        r = click(g, r.move, "b2");
        r = click(g, r.move, "c2");
        expect(r.move).to.equal("Hb3a4 Mb4b3 Rb2c2");
        expect(r.valid).to.be.true;
        const reading = g.clone();
        reading.move(r.move, {partial: true});
        expect(reading.board.has("c3")).to.be.true;
        r = click(g, r.move, "c3");
        r = click(g, r.move, "c3");
        // the second click holds it, which changes nothing here...
        expect(r.move).to.equal("Hb3a4 Mb4b3 Rb2c2 Rc3c3");
        expect(r.valid).to.be.true;
        // ...and on a trap a third click turns the hold into a capture mark
        r = click(g, r.move, "c3");
        expect(r.move).to.equal("Hb3a4 Mb4b3 Rb2c2 Rc3x");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        const preview = g.clone();
        preview.move(r.move, {partial: true});
        expect(preview.board.has("c3")).to.be.false;
        expect(annotations(preview)).to.include("exit:c3");
        // a click on the mark lifts it
        r = click(g, r.move, "c3");
        expect(r.move).to.equal("Hb3a4 Mb4b3 Rb2c2 c3");
        g.move("Hb3a4 Mb4b3 Rb2c2 Rc3x");
        expect(g.board.has("c3")).to.be.false;
    });
    it("marks an enemy piece captured by pieces that step out and back", () => {
        // from a recorded game, mirrored: the elephant steps aside, pulls the
        // camel off the rabbit's trap and pushes it back; nothing is displaced
        const g = position("Rh3,Re3,Rf3,Rh2,Re2,Rd2,Rg3,Rg2,Re1,Rg1,Ra3,Rd3,Ra2,Hb5,Cb2,Eb4", "rg8,cb8,hf7,rh5,ef2,rd7,cb6,ra4,rf5,rd4,rc3,mb3");
        let r = click(g, "", "c3");
        r = click(g, r.move, "c3");
        expect(r.move).to.equal("rc3c3");
        r = click(g, r.move, "c3");
        expect(r.move).to.equal("rc3x");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        r = click(g, r.move, "b4");
        r = click(g, r.move, "b4");
        expect(r.move).to.equal("rc3x Eb4b4");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        g.move(r.move);
        expect(g.board.has("c3")).to.be.false;
        expect(g.board.get("b4")).to.deep.equal(["E", 1]);
        expect(g.board.get("b3")).to.deep.equal(["M", 2]);
        expect(g.lastmove).to.equal("rc3x Eb4");
    });
    it("draws a past turn from its results, with nothing left over from an entry", () => {
        // a half-entered move leaves arrows, holds and a selection behind; going
        // back to a committed state must not draw any of them over it
        const committed = (): string[] => {
            const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
            return annotations(g);
        };
        for (const partial of ["re4e5", "Ed4d4", "d4"]) {
            const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
            g.move(partial, {partial: true});
            g.load();
            expect(annotations(g), partial).to.deep.equal(committed());
            const markers = (g.render().board as {markers?: Array<{type: string}>}).markers ?? [];
            expect(markers.filter(m => m.type === "flood"), partial).to.be.empty;
        }
    });
    it("submits with a piece still selected", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        const r = g.validateMove("Ed4c4 f4");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain(i18next.t("apgames:validation.arimaa.INCOMPLETE"));
        g.move("Ed4c4 f4");
        expect(g.lastmove).to.equal("Ec4");
        expect(g.board.get("f4")).to.deep.equal(["H", 1]);
    });
    it("accepts a double push with the pusher arrowed", () => {
        const g = position("Ed4,Ra1,Cc1", "re4,ra8,ee8");
        const r = g.validateMove("re4e6 Ed4e5");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        g.move("re4e6 Ed4e5");
        expect(g.board.get("e6")).to.deep.equal(["R", 2]);
        expect(g.board.get("e5")).to.deep.equal(["E", 1]);
        expect(g.lastmove).to.equal("re6 Ee5");
    });
    it("names the pieces it inferred", () => {
        const g = position("Ed4,Ra1,Cc1", "re4,ra8,ee8");
        const r = g.validateMove("re4e5");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain("Ed4e4");
    });
    it("applies the two-step ceiling on the first ply of an endless endgame", () => {
        const g = new ArimaaGame(undefined, ["eee"]);
        const e = [...g.board.entries()].find(([, [pc, owner]]) => pc === "E" && owner === 1)![0];
        const [x, y] = ArimaaGame.algebraic2coords(e);
        const far = ArimaaGame.coords2algebraic(x, y < 4 ? y + 3 : y - 3);
        const r = g.validateMove(`E${e}${far}`);
        expect(r.valid).to.be.false;
        expect(r.message).to.contain("2");
    });
});

describe("Arimaa notation compatibility", () => {
    it("reads the old step notation and writes the new one", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        g.move("Hg3g4,dh3g3,dg3f3(xdf3),Hg4g3");
        expect(g.lastmove).to.equal("dx");
        expect(g.board.has("f3")).to.be.false;
    });
    it("compares moves by the position they reach", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        g.move("dh3f3");
        expect(g.sameMove("dx", "Hg3g2, dh3g3, dg3f3, Hg2g3")).to.be.true;
        expect(g.sameMove("dx", "df3")).to.be.true;
        expect(g.sameMove("dx", "Hg3g4")).to.be.false;
    });
    it("stored notation replays to the same position", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1,Db4", "re4,ra8,ee8,md7");
        for (const m of ["Db4b5 Ed4c4", "md7d6 ra8b8", "Hf4e4 re4e5 Ec4c5", "ee8e7", "Hf4 Db5b4"]) {
            const before = g.clone();
            g.move(m);
            const replay = before.clone();
            replay.move(g.lastmove!);
            expect(replay.signature(), `${m} -> ${g.lastmove}`).to.equal(g.signature());
            const strict = resolve(before.board, before.currplayer, 4, parseMove(g.lastmove!).tokens, false);
            expect(strict.status, g.lastmove).to.equal("resolved");
        }
    });
    it("rejects a submitted move the rules do not allow, but still reads a recorded one", () => {
        // from a recorded game (mirrored so that Gold moves): the rabbit on a2
        // completes a push of its equal, which the validator once accepted
        // because the elephant on a4 satisfied the push precondition
        const g = position("De1,Dg2,Cd2,Ch1,Rh2,Ra2,Ra1,Hf2,Mc2,Eb4", "hb8,ca8,rh7,rh8,cf7,ra3,db6,ec4,dd6,mg5");
        const push = "Mc2b2, Eb4a4, ra3b3, Ra2a3";
        const rejected = g.validateMove(push);
        expect(rejected.valid).to.be.false;
        expect(rejected.message).to.equal(i18next.t("apgames:validation.arimaa.INVALID_PUSH", {where: "a2"}));
        expect(() => g.move(push)).to.throw();
        // typing it in the new notation does not get round the rules either
        expect(g.validateMove("Mb2 Ea4 rb3 Ra3").valid).to.be.false;
        // but a record replays: no validation, and the notation is kept as it was
        g.move(push, {trusted: true});
        expect(g.lastmove).to.equal(push);
        expect(g.board.get("b3")).to.deep.equal(["R", 2]);
        expect(g.sameMove(g.lastmove!, "Mc2b2,Eb4a4,ra3b3,Ra2a3")).to.be.true;
        // from another: a "pull" that moves the pulled rabbit beside the
        // vacated square, which the validator never checked
        const h = position("Db3,Cc2,Rb1,Cf7,Ee6", "ef5,db2,re7,cd8,cg4");
        const pull = "Ee6d6, re7d7, Db3c3, Dc3d3";
        const rejectedPull = h.validateMove(pull);
        expect(rejectedPull.valid).to.be.false;
        expect(rejectedPull.message).to.equal(i18next.t("apgames:validation.arimaa.INVALID_PUSH", {where: "b3"}));
        expect(h.validateMove("Ed6 rd7 Dd3").valid).to.be.false;
        h.move(pull, {trusted: true});
        expect(h.lastmove).to.equal(pull);
        // a capture along the way is written as the old engine wrote it: the
        // rabbit is "pulled" sideways onto f6 and dies there, and the other
        // two steps leave no room for the legal way to reach that position
        const k = position("Ee5,Ra1", "re6,ra8,eh8");
        k.move("Ee5e4, re6f6, Ra1a2, Ra2a3", {trusted: true});
        expect(k.lastmove).to.equal("Ee5e4, re6f6(xrf6), Ra1a2, Ra2a3");
        expect(k.board.has("f6")).to.be.false;
    });
    it("still allows a push and a pull the rules do allow", () => {
        // a stronger pusher, and a pull into the square the puller vacated
        const g = position("Ed4,Ra1,Cc1", "re4,ra8,ee8");
        expect(g.validateMove("re4e5, Ed4e4").valid).to.be.true;
        const h = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        expect(h.validateMove("Ed4c4, re4d4").valid).to.be.true;
    });
    it("refuses a third repetition only after resolving the move", () => {
        const g = position("Ed4,Ra2", "ee8,ra7");
        const cycle = ["Ed4d5", "ee8e7", "Ed5d4", "ee7e8"];
        for (let i = 0; i < 7; i++) {
            g.move(cycle[i % 4]);
        }
        const r = g.validateMove("ee7e8");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(-1);
        expect(r.message).to.equal(i18next.t("apgames:validation.arimaa.REPEAT"));
        expect(() => g.move("ee7e8")).to.throw();
    });
});

describe("Arimaa recorded games", () => {
    // stored legacy moves from real games replay, and each turn's new notation
    // resolves strictly to the position played and compares equal to the record
    const positionOf = (spec: string): Map<string, CellContents> => {
        const b = new Map<string, CellContents>();
        for (const t of spec.split(",").filter(Boolean)) {
            b.set(t.slice(1), [t[0].toUpperCase() as CellContents[0], t[0] === t[0].toUpperCase() ? 1 : 2]);
        }
        return b;
    };
    for (const rec of arimaaRecords) {
        it(`replays ${rec.name}`, function () {
            this.timeout(20000);
            const g = new ArimaaGame(undefined, rec.variants);
            if (rec.startingPosition !== undefined) {
                g.stack[0].board = positionOf(rec.startingPosition);
                g.load();
            }
            rec.moves.forEach((recorded, i) => {
                const before = g.clone();
                const setup = g.hands !== undefined && g.hands[g.currplayer - 1].length > 0;
                const illegal = rec.legacyTurns?.includes(i + 1) ?? false;
                // a record replays trusted, but the rules still judge each move
                expect(g.validateMove(recorded).valid, recorded).to.equal(!illegal);
                g.move(recorded, {trusted: true});
                if (setup) {
                    return;
                }
                const maxSteps = rec.variants.includes("eee") && before.stack.length === 1 ? 2 : 4;
                const stored = g.lastmove!;
                if (illegal) {
                    // no legal turn reaches it, so it keeps the old notation
                    expect(isLegacy(stored), stored).to.be.true;
                    expect(stored.replace(/\s+/g, "")).to.equal(recorded.replace(/\s+/g, ""));
                } else {
                    expect(isLegacy(stored), stored).to.be.false;
                    const strict = resolve(before.board, before.currplayer, maxSteps, parseMove(stored).tokens, false);
                    expect(strict.status, `${recorded} -> ${stored}`).to.equal("resolved");
                }
                const replay = before.clone();
                replay.move(stored, {trusted: true});
                expect(replay.signature(), `${recorded} -> ${stored}`).to.equal(g.signature());
                expect(g.sameMove(stored, recorded), `${recorded} -> ${stored}`).to.be.true;
            });
            expect(g.gameover).to.equal(rec.gameover);
        });
    }
});


describe("Arimaa click coverage", () => {
    // a position to click on, with no hands and the given player to move
    const ready = (spec: string, player: Owner, eee: boolean): ArimaaGame => {
        const board = boardOf(spec.replace(/,/g, " "));
        const g = new ArimaaGame(undefined, eee ? ["eee"] : ["free"]);
        g.stack[0].board = new Map(board);
        if (!eee) {
            g.stack.push({...g.stack[0], _results: [], _timestamp: new Date(), currplayer: player, board: new Map(board), hands: undefined, lastmove: "x"});
        }
        g.load();
        g.hands = undefined;
        return g;
    };
    const perms = <T,>(xs: T[]): T[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r]));
    // every arrow first: naming every displaced piece is what usually works
    const subsets = <T,>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map(a => [...a, x])], [[]]).sort((a, b) => b.length - a.length);

    // every legal turn from a position must be reachable with clicks alone
    for (const [name, spec, player, eee] of [
        ["a frozen-piece tangle", "Ed5,Mf5,Rd3,Ra1,me5,rd4,rf4,ee8,ra8", 2, false],
        ["a rabbit near goal", "Eb2,Hc4,Rh1,Ra1,rb1,rc2,ed8,ra8", 2, false],
        ["pieces dying on a trap", "Rb4,Ec2,rc4,ee8,Ra1", 1, false],
    ] as Array<[string, string, Owner, boolean]>) {
        it(`enters every legal turn in ${name}`, function () {
            this.timeout(120000);
            const board = coverageBoard(spec.replace(/,/g, " "));
            expect(unsupportedOnTrap(board), "the position itself must be legal").to.be.undefined;
            const maxSteps = eee ? 2 : 4;
            const reachable = allTurns(board, player, maxSteps);
            expect(reachable.size).to.be.greaterThan(20);
            const missed: string[] = [];
            for (const [target, stepLists] of reachable.entries()) {
                const g = ready(spec, player, eee);
                let entered = false;
                for (const steps of stepLists) {
                    if (entered) {
                        break;
                    }
                    const turn = turnFromSteps(board as Map<string, CellContents>, player, steps.map(([from, to]) => ({from, to})));
                    const arrows = turn.trajectories.filter(t => t.final !== t.start)
                        .map(t => ({letter: t.owner === 1 ? t.type : t.type.toLowerCase(), from: sqName(t.start), to: sqName(t.final), dies: t.captured}));
                    const extras = turn.trajectories.filter(t => (t.captured && t.visited.length === 1) || (!t.captured && t.final === t.start && t.visited.length > 1))
                        .map(t => ({sq: sqName(t.start), mark: t.captured}));
                    const draw = (order: typeof arrows, holds: typeof extras): string | undefined => {
                        let m = "";
                        for (const a of order) {
                            let r = click(g, m, a.from);
                            if (!r.valid || !r.move!.endsWith(a.from)) { return undefined; }
                            m = r.move!;
                            r = click(g, m, a.to);
                            if (!r.valid) { return undefined; }
                            m = r.move!;
                            if (!m.endsWith(`${a.letter}${a.from}${a.to}`)) {
                                r = click(g, m, a.to);
                                if (!r.valid) { return undefined; }
                                m = r.move!;
                            }
                            if (!m.endsWith(`${a.letter}${a.from}${a.to}`)) { return undefined; }
                            if (a.dies) {
                                r = click(g, m, a.to);
                                if (!r.valid) { return undefined; }
                                m = r.move!;
                                r = click(g, m, a.to);
                                if (!r.valid || !r.move!.endsWith(`${a.letter}${a.from}x`)) { return undefined; }
                                m = r.move!;
                            }
                        }
                        for (const {sq, mark} of holds) {
                            let r = click(g, m, sq);
                            if (!r.valid) { return undefined; }
                            m = r.move!;
                            r = click(g, m, sq);
                            if (!r.valid || !r.move!.endsWith(`${sq}${sq}`)) { return undefined; }
                            m = r.move!;
                            if (mark) {
                                r = click(g, m, sq);
                                if (!r.valid || !r.move!.endsWith(`${sq}x`)) { return undefined; }
                                m = r.move!;
                            }
                        }
                        return m;
                    };
                    for (const subset of subsets(arrows)) {
                        if (entered) {
                            break;
                        }
                        for (const order of (subset.length <= 4 ? perms(subset) : [subset])) {
                            for (const holds of [[], extras]) {
                                const m = draw(order, holds as typeof extras);
                                if (m === undefined || m.length === 0) {
                                    continue;
                                }
                                const v = g.validateMove(m);
                                if (!v.valid || v.complete === -1) {
                                    continue;
                                }
                                const preview = g.clone();
                                preview.move(m, {partial: true});
                                if (preview.signature() === target) {
                                    entered = true;
                                    break;
                                }
                            }
                            if (entered) {
                                break;
                            }
                        }
                    }
                }
                if (!entered) {
                    missed.push(stepLists[0].map(([f, t]) => f + t).join(" "));
                }
            }
            expect(missed, `${missed.length} of ${reachable.size} turns could not be entered`).to.be.empty;
        });
    }
});
