/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../../src";
import { ArimaaGame, resolveGameFlags } from '../../src/games';
import { dieSquare } from "../../src/games/arimaa/dice";

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
        // a rabbit in front hides a stronger piece too, unless it is a cat
        result = g.validateMove("ed7,me7,hb7,hg7,ra7,ra8,rb8,rc8,rg8,rh8,rh7,df8,rf7,cd8,ce8,dc7");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_HIDE"));
        // and so is any non-cat on the back rank with a weaker piece in front, for Gold as well
        const gold = new ArimaaGame();
        expect(gold.validateMove("Ed2,Me2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rg1,Rh1,Rh2,Df1,Rf2,Cd1,Ce1,Dc2").message)
            .to.include(i18next.t("apgames:validation.arimaa.WARN_HIDE"));
        expect(gold.validateMove("Ed2,Me2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rg1,Rh1,Rh2,Cf1,Rf2,Dd1,De1,Cc2").message)
            .to.equal(i18next.t("apgames:validation._general.VALID_MOVE"));
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

    it ("Setup clicks that mean nothing are controls", () => {
        const nonrabbits = "Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1,De1";
        // standard setup: an empty square outside the setup area (d4) finishes
        // a setup that can be submitted, and otherwise drops the selection
        let g = new ArimaaGame();
        let result = g.handleClick(nonrabbits, 4, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal(nonrabbits);
        expect(result.complete).to.equal(1);
        result = g.handleClick(`${nonrabbits},R`, 4, 3);
        expect(result.move).to.equal(nonrabbits);
        expect(result.complete).to.equal(0);
        result = g.handleClick("Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1", 4, 3);
        expect(result.move).to.equal("Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1");
        expect(result.complete).to.equal(-1);
        result = g.handleClick("E", 4, 3);
        expect(result.move).to.equal("");
        result = g.handleClick("", 4, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("");
        expect(result.complete).to.equal(-1);
        // an opponent's piece (Gold's on e2) drops the selection, or else the last piece placed
        g.move(nonrabbits);
        result = g.handleClick("ee7,md7,m", 6, 4);
        expect(result.move).to.equal("ee7,md7");
        result = g.handleClick("ee7,md7", 6, 4);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("ee7");
        result = g.handleClick("", 6, 4);
        expect(result.move).to.equal("");
        result = g.handleClick("ee7,md7,hb7,hg7,cf7,cc7,dd8,de8", 4, 3);
        expect(result.complete).to.equal(1);

        // free placement: every empty square takes a piece, but an opponent's piece is a control
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ec3,Rd4");
        result = g.handleClick("ed5,rd6,m", 5, 2);
        expect(result.move).to.equal("ed5,rd6");
        result = g.handleClick("ed5,rd6", 5, 2);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("ed5");
        result = g.handleClick("ed5", 4, 4);
        expect(result.move).to.equal("ed5,re4");
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
        expect(result.complete).to.equal(0);
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
            { kind: "sheet", name: "piece", colour: g.getPlayerColour(1) },
            g.harlog().toFixed(2),
        ]);

        // silver ahead: the number is unsigned
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2,Rd3");
        g.move("ed7,mg7,rd6");
        [status] = g.sidebarStatuses();
        expect(g.harlog()).to.be.lessThan(0);
        expect(status.value).to.deep.equal([
            { kind: "sheet", name: "piece", colour: g.getPlayerColour(2) },
            Math.abs(g.harlog()).toFixed(2),
        ]);

        // infinite values keep the leader's glyph; NaN has no leader
        g.harlog = () => Infinity;
        expect(g.sidebarStatuses()[0].value).to.deep.equal([
            { kind: "sheet", name: "piece", colour: g.getPlayerColour(1) },
            "Infinity",
        ]);
        g.harlog = () => -Infinity;
        expect(g.sidebarStatuses()[0].value).to.deep.equal([
            { kind: "sheet", name: "piece", colour: g.getPlayerColour(2) },
            "Infinity",
        ]);
        g.harlog = () => NaN;
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["NaN"]);
    });
});


// ---------------------------------------------------------------------------
// Lightvector notation and arrow entry

import { isLegacy, parseMove, parseToken, NotationError } from "../../src/games/arimaa/notation";
import { canMoveWithin, fewestDisplaced, resolve, serializeTurn, sqIndex, sqName, turnFromSteps, type CellContents, type Found, type Turn } from "../../src/games/arimaa/turns";
import { arimaaRecords } from "../fixtures/arimaa/records";
import { allPlays, unsupportedOnTrap } from "../fixtures/arimaa/coverage";

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
        // two trailing squares: both are kept, oldest first
        const q = parseMove("Ed4e4 d4 e4", true);
        expect(q.tokens.map(t => t.text)).to.deep.equal(["Ed4e4"]);
        expect(q.selections).to.deep.equal(["d4", "e4"]);
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
    it("counts a right-sized pull even where the position is first reached without one", () => {
        // The cat steps north and the rabbit follows it; then the dog takes
        // the rabbit's square. Those same three steps are also the cat
        // stepping away and the dog pushing the rabbit, which the search
        // comes to first, and a dog is not one rank above a rabbit while
        // there is a cat on the board.
        const b = boardOf("Ce5 Dd4 Ra1 re4 ra8 ee8");
        const tokens = parseMove("re4e5 Ce5e6 Dd4f4").tokens;
        for (const prune of [true, false]) {
            const found = fewestDisplaced(b, 1, 4, tokens, undefined, prune);
            expect(found, `prune ${prune}`).to.have.length(1);
            expect(found[0].turn.steps, `prune ${prune}`).to.have.length(4);
            expect(found[0].rightSized, `prune ${prune}`).to.equal(1);
        }
    });
    it("knows which pieces can move this turn, alone and alongside what an entry says", function () {
        this.timeout(120000);
        // crowded random positions, so that pieces block, freeze and push one another
        let seed = 777;
        const rnd = (n: number): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) % n;
        };
        const types = ["E", "M", "H", "D", "C", "R", "R", "C", "D", "H"];
        let blocked = 0;
        let withTokens = 0;
        for (let trial = 0; trial < 40; trial++) {
            const b = new Map<string, CellContents>();
            const [cx, cy] = [1 + rnd(6), 1 + rnd(6)];
            for (let i = 0; i < 24 && b.size < 5 + rnd(5); i++) {
                const cell = ArimaaGame.coords2algebraic(Math.min(7, Math.max(0, cx + rnd(5) - 2)), Math.min(7, Math.max(0, cy + rnd(5) - 2)));
                if (!b.has(cell)) {
                    b.set(cell, [types[rnd(types.length)] as CellContents[0], (1 + rnd(2)) as 1 | 2]);
                }
            }
            let trap: string | undefined;
            while ((trap = unsupportedOnTrap(b as unknown as Parameters<typeof unsupportedOnTrap>[0])) !== undefined) {
                b.delete(trap);
            }
            const player = (1 + rnd(2)) as 1 | 2;
            const label = `${[...b.entries()].map(([c, [pc, o]]) => (o === 1 ? pc : pc.toLowerCase()) + c).join(" ")} / player ${player}`;
            // every way of playing every turn, enumerated independently of the engine
            const plays = allPlays(b as unknown as Parameters<typeof allPlays>[0], player, 4);
            for (const cell of b.keys()) {
                for (let limit = 1; limit <= 4; limit++) {
                    const can = plays.some(p => p.steps <= limit && (p.paths.get(cell)?.visited.length ?? 1) > 1);
                    expect(canMoveWithin(b, player, limit, cell), `${label} / ${cell} in ${limit}`).to.equal(can);
                    blocked += can ? 0 : 1;
                }
            }
            // and with an entry, against a search that prunes nothing
            const play = plays[rnd(plays.length)];
            const moved = play === undefined ? undefined : [...play.paths].find(([from, path]) => path.final !== from);
            if (moved !== undefined) {
                const [from, path] = moved;
                const letter = path.owner === 1 ? path.type : path.type.toLowerCase();
                const tokens = parseMove(path.captured ? `${letter}${from}x` : `${letter}${from}${path.final}`).tokens;
                for (const cell of b.keys()) {
                    const start = sqIndex(cell);
                    const full = resolve(b, player, 4, tokens, false, false, turn => turn.trajectories.some(tr => tr.start === start && tr.visited.length > 1));
                    expect(canMoveWithin(b, player, 4, cell, tokens), `${label} / ${tokens.map(t => t.text).join(" ")} / ${cell}`)
                        .to.equal(full.status !== "unsatisfiable");
                    withTokens++;
                }
            }
        }
        expect(blocked).to.be.greaterThan(100);
        expect(withTokens).to.be.greaterThan(100);
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
            const label = `${[...b.entries()].map(([c, [p, o]]) => (o === 1 ? p : p.toLowerCase()) + c).join(" ")} / ${tokens.join(" ")} / player ${player} / ${maxSteps} steps`;
            expect(key(pruned), label).to.equal(key(full));
            // nor when displaced pieces are counted before steps, as click
            // entry in Advanced mode counts them: then a longer turn can beat
            // a shorter one, and the count of right-sized pushes matters
            const bucket = (found: Found[]): string => found.map(f => `${f.turn.signature}:${f.turn.displaced}:${f.turn.steps.length}:${f.rightSized}`).sort().join(" ");
            expect(bucket(fewestDisplaced(b, player, maxSteps, parsed)), `${label} / displaced first`)
                .to.equal(bucket(fewestDisplaced(b, player, maxSteps, parsed, undefined, false)));
            // nor with a filter of the kinds click entry passes, which read
            // only where pieces start, pass and end: one piece has to move,
            // or nothing else may
            if (cells.length > 0) {
                const chosen = sqIndex(cells[tokens.length % cells.length]);
                for (const [name, accept] of [
                    ["moves", (turn: Turn): boolean => turn.trajectories.some(tr => tr.start === chosen && tr.visited.length > 1)],
                    ["alone", (turn: Turn): boolean => turn.trajectories.every(tr => tr.start === chosen || tr.visited.length === 1)],
                ] as Array<[string, (turn: Turn) => boolean]>) {
                    expect(key(resolve(b, player, maxSteps, parsed, false, true, accept)), `${label} / ${name}`)
                        .to.equal(key(resolve(b, player, maxSteps, parsed, false, false, accept)));
                }
            }
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
    it("reads an enemy arrow onto a trap as a flip and records it as dx", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        const r = g.validateMove("dh3f3");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        const preview = g.clone();
        preview.move("dh3f3", {partial: true});
        expect(annotations(preview)).to.have.members(["enter:g3", "move:h3>f3", "exit:f3"]);
        g.move("dh3f3");
        expect(g.lastmove).to.equal("dx");
        expect(g.board.has("h3")).to.be.false;
        expect(g.board.get("g3")).to.deep.equal(["H", 1]);
        expect(annotations(g)).to.have.members(["enter:g3", "move:h3>f3", "exit:f3"]);
        expect(g.results.filter(x => x.type === "move").length).to.equal(4);
        expect(g.results.filter(x => x.type === "destroy").length).to.equal(1);
    });
    it("settles an ambiguous push with an arrow of the pusher onto the vacated square", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        // either pusher fits: one is shown, and the message says so
        const r = g.validateMove("re4e5");
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain(i18next.t("apgames:validation.arimaa.AMBIGUOUS", {count: 2}));
        expect(g.validateMove("re4e5 Ed4e4").complete).to.equal(0);
        g.move("re4e5 Ed4e4");
        expect(g.lastmove).to.equal("re5 Ee4");
    });
    it("reads a pull from the arrows of the puller and the pulled piece", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        expect(g.validateMove("Ed4c4 re4d4").complete).to.equal(0);
        g.move("Ed4c4 re4d4");
        expect(g.lastmove).to.equal("Ec4 rd4");
        expect(annotations(g)).to.have.members(["move:d4>c4", "move:e4>d4"]);
    });
    it("lets an arrow end on an occupied square, leaving open where the occupant goes", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        const r = g.validateMove("Ed4f4");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain(i18next.t("apgames:validation.arimaa.AMBIGUOUS", {count: 6}));
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
        // an enemy piece nothing can push or pull
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
    it("keeps a piece that steps out and back on its square with a hold", () => {
        // the elephant pushes the dog into the trap and returns; without the hold
        // the arrows read as the three-step turn that leaves it on d6
        const g = position("Ee6,Cg2,Ra1", "dd6,ra8,ee8");
        const unheld = g.validateMove("dd6c6 Cg2g3");
        expect(unheld.valid).to.be.true;
        expect(unheld.message).to.contain("Ee6d6");
        const r = g.validateMove("dd6c6 Cg2g3 Ee6e6");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        const preview = g.clone();
        preview.move("dd6c6 Cg2g3 Ee6e6", {partial: true});
        expect(annotations(preview)).to.include.members(["enter:e6", "move:d6>c6", "exit:c6", "move:g2>g3"]);
        g.move("dd6c6 Cg2g3 Ee6e6");
        expect(g.lastmove).to.equal("Cg3 dx Ee6");
        expect(g.board.get("e6")).to.deep.equal(["E", 1]);
        expect(g.board.has("c6")).to.be.false;
    });
    it("reads a rotation from arrows onto occupied squares", () => {
        // the elephant pulls one rabbit and pushes the other, ending where the
        // second one stood
        const g = position("Eh5,Ra1", "rh6,rg6,ra8,ee8");
        expect(g.validateMove("Eh5g6").valid).to.be.true;
        const r = g.validateMove("Eh5g6 rg6h6 rh6h5");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        g.move("Eh5g6 rg6h6 rh6h5");
        expect(g.board.get("g6")).to.deep.equal(["E", 1]);
        expect(g.board.get("h6")).to.deep.equal(["R", 2]);
        expect(g.board.get("h5")).to.deep.equal(["R", 2]);
    });
    it("holds a blocker so that a piece walks around it", () => {
        const g = position("Re2,De3,Ra1", "ra8,ee8");
        // the shorter reading moves the dog aside (to d3 rather than the trap)
        const unheld = g.validateMove("Re2e4");
        expect(unheld.complete).to.equal(0);
        expect(unheld.message).to.contain("De3d3");
        const r = g.validateMove("Re2e4 De3e3");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        g.move("Re2e4 De3e3");
        expect(g.board.get("e4")).to.deep.equal(["R", 1]);
        expect(g.board.get("e3")).to.deep.equal(["D", 1]);
        expect(g.lastmove).to.equal("Re4 De3");
    });
    it("marks a piece on a trap captured", () => {
        // from a recorded game, mirrored: the horse leaves its rabbit on the
        // trap unsupported; read without the mark, the rabbit's own move comes
        // first and keeps it alive
        const g = position("Ra1,Rg1,Rh1,Rh2,Ce1,Ca2,Hb3,Dh3,Rg2,Rb2,Ef2,Rd2,Hf3,Dc5,Rc3,Mb4", "ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cc7,df7,ce8,dd7,mf4,hg3,he3,ec4");
        const arrows = "Hb3a4 Mb4b3 Rb2c2";
        expect(g.validateMove(arrows).valid).to.be.true;
        const reading = g.clone();
        reading.move(arrows, {partial: true});
        expect(reading.board.has("c3")).to.be.true;
        // a hold changes nothing here...
        expect(g.validateMove(`${arrows} Rc3c3`).valid).to.be.true;
        // ...and a capture mark has the rabbit die
        const r = g.validateMove(`${arrows} Rc3x`);
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        const preview = g.clone();
        preview.move(`${arrows} Rc3x`, {partial: true});
        expect(preview.board.has("c3")).to.be.false;
        expect(annotations(preview)).to.include("exit:c3");
        g.move(`${arrows} Rc3x`);
        expect(g.board.has("c3")).to.be.false;
    });
    it("marks an enemy piece captured by pieces that step out and back", () => {
        // from a recorded game, mirrored: the elephant steps aside, pulls the
        // camel off the rabbit's trap and pushes it back; nothing is displaced
        const g = position("Rh3,Re3,Rf3,Rh2,Re2,Rd2,Rg3,Rg2,Re1,Rg1,Ra3,Rd3,Ra2,Hb5,Cb2,Eb4", "rg8,cb8,hf7,rh5,ef2,rd7,cb6,ra4,rf5,rd4,rc3,mb3");
        let r = g.validateMove("rc3x");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        r = g.validateMove("rc3x Eb4b4");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        g.move("rc3x Eb4b4");
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
        expect(r.complete).to.equal(0);
        g.move("re4e6 Ed4e5");
        expect(g.board.get("e6")).to.deep.equal(["R", 2]);
        expect(g.board.get("e5")).to.deep.equal(["E", 1]);
        expect(g.lastmove).to.equal("re6 Ee5");
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


describe("Arimaa Dicey Moves", () => {
    before(() => {
        addResource("en");
    });

    // run `fn` with the engine's source of randomness pinned to `value`
    const withRandom = <T>(value: number, fn: () => T): T => {
        const original = Math.random;
        Math.random = () => value;
        try {
            return fn();
        } finally {
            Math.random = original;
        }
    };
    // a free setup with Gold's pieces placed; Silver's placement then casts
    // the die for Gold's first move
    const freeStart = (): ArimaaGame => {
        const g = new ArimaaGame(undefined, ["free", "dicey"]);
        g.move("Ed2, Ra2");
        return g;
    };

    it("casts no die during setup and one for every move after", () => {
        const g = new ArimaaGame(undefined, ["dicey"]);
        expect(g.die).to.be.undefined;
        // the standard setup keeps its conveniences
        expect(g.getButtons().length).to.equal(1);
        g.move("Ee2,Md2,Hb2,Hg2,Dc2,Df2,Cb1,Cg1");
        expect(g.board.size).to.equal(16);
        expect(g.die).to.be.undefined;
        expect(g.getButtons().length).to.equal(2);
        g.move("ee7,md7,hb7,hg7,dc7,df7,cb8,cg8");
        expect(g.board.size).to.equal(32);
        expect(g.die).to.not.be.undefined;
        expect(g.die!.steps).to.be.within(1, 4);
        // shown on an empty square in the open centre: the four centre
        // squares tie, and d5 is the first of them read from rank 8 down
        expect(g.board.has(g.die!.square)).to.be.false;
        expect(g.die!.square).to.equal("d5");
        expect(g.stack[g.stack.length - 1].die).to.deep.equal(g.die);
        expect(g.validateMove("").message).to.contain(i18next.t("apgames:validation.arimaa.DIE", {count: g.die!.steps}));
    });

    it("places the die by openness, empty traps included", () => {
        // every square full but the ones named
        const boardWithout = (...empty: string[]): Map<string, CellContents> => {
            const board = new Map<string, CellContents>();
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const cell = ArimaaGame.coords2algebraic(col, row);
                    if (!empty.includes(cell)) {
                        board.set(cell, ["R", 1]);
                    }
                }
            }
            return board;
        };
        // b4 scores 5 + 2 + 3/8 + 1/6. That beats b5 and a4, which have e4
        // four steps away rather than three, though both are read first.
        expect(dieSquare(boardWithout("a4", "a5", "b4", "b5", "e4"))).to.equal("b4");
        // an empty trap can take the die
        expect(dieSquare(boardWithout("c3"))).to.equal("c3");
        // but it counts as full in its own openness, so even a corner beats it
        expect(dieSquare(boardWithout("c3", "a1"))).to.equal("a1");
        // with every square full, the die sits under the piece on d4
        expect(dieSquare(boardWithout())).to.equal("d4");
    });

    it("caps a d6 at four steps", () => {
        expect(withRandom(0, () => freeStart().move("ee7, ra7").die!.steps)).to.equal(1);
        expect(withRandom(0.34, () => freeStart().move("ee7, ra7").die!.steps)).to.equal(3);
        expect(withRandom(0.5, () => freeStart().move("ee7, ra7").die!.steps)).to.equal(4);
        expect(withRandom(0.99, () => freeStart().move("ee7, ra7").die!.steps)).to.equal(4);
        expect(withRandom(0.2, () => freeStart().move("ee7, ra7").die!.steps)).to.equal(2);
    });

    it("gives the opening move of Endless endgame one step or two", () => {
        // seeded (mulberry32), as the random setup draws on Math.random too
        const seeded = (seed: number) => (): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const seen = new Set<number>();
        const original = Math.random;
        try {
            for (let seed = 1; seed <= 20; seed++) {
                Math.random = seeded(seed);
                const g = new ArimaaGame(undefined, ["eee", "dicey"]);
                expect([1, 2]).to.include(g.die!.steps);
                expect(g.board.has(g.die!.square)).to.be.false;
                seen.add(g.die!.steps);
            }
        } finally {
            Math.random = original;
        }
        expect([...seen].sort()).to.deep.equal([1, 2]);
    });

    it("limits the turn to the die in both notations", () => {
        const g = freeStart().move("ee7, ra7");
        g.die = {steps: 1, square: g.die!.square};
        let result = g.validateMove("Ed3");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        result = g.validateMove("Ed4");
        expect(result.valid).to.be.false;
        result = g.validateMove("Ed2d4");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation.arimaa.TOO_LONG", {num: 1}));
        result = g.validateMove("Ed2d3");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        result = g.validateMove("Ed2d3,Ed3d4");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation.arimaa.TOO_MANY", {num: 1}));
        // the roll heads the turn's record, and the next die is cast for Silver
        g.move("Ed3");
        expect(g.results[0]).to.deep.equal({type: "roll", values: [1]});
        expect(g.lastmove).to.equal("Ed3");
        expect(g.die!.steps).to.be.within(1, 4);
        expect(g.board.has(g.die!.square)).to.be.false;
        expect(g.currplayer).to.equal(2);
        const lines = g.chatLogEntries(["Gold", "Silver"]).pop()!.lines;
        expect(lines[0].textKey).to.equal("apresults:arimaa.ROLL");
        expect(lines[0].textParams!.count).to.equal(1);
        expect(g.chatLog(["Gold", "Silver"]).flat().join(" ")).to.contain("a single step this turn");
    });

    it("keeps this turn's die through the preview of a complete move and casts the next on submission", () => {
        const g = freeStart().move("ee7, ra7");
        const die = {...g.die!};
        // the front end previews a complete move under `emulation` before it
        // is submitted, and only the submission casts the next die
        let calls = 0;
        const original = Math.random;
        Math.random = () => { calls++; return 0.5; };
        let preview: ArimaaGame;
        try {
            preview = g.clone().move("Ed3", {emulation: true});
        } finally {
            Math.random = original;
        }
        expect(calls).to.equal(0);
        expect(preview.currplayer).to.equal(2);
        expect(preview.lastmove).to.equal("Ed3");
        expect(preview.results[0]).to.deep.equal({type: "roll", values: [die.steps]});
        expect(preview.die).to.deep.equal(die);
        expect(preview.stack[preview.stack.length - 1].die).to.deep.equal(die);
        const rep = preview.render();
        expect((rep.legend as Record<string, {name: string}>).DIE.name).to.equal(`d6-${die.steps}`);
        const [x, y] = ArimaaGame.algebraic2coords(die.square);
        const markers = (rep.board as {markers: Array<{type: string; glyph?: string; points?: Array<{row: number; col: number}>}>}).markers;
        expect(markers.find(m => m.type === "glyph" && m.glyph === "DIE")!.points).to.deep.equal([{row: y, col: x}]);
        // the submitted move casts the next die
        const submitted = withRandom(0, () => g.clone().move("Ed3"));
        expect(submitted.die!.steps).to.equal(1);
        // a preview that ends the game hides the die, as the submission would
        const nearGoal = new ArimaaGame(undefined, ["free", "dicey"]).move("Rd7, Ee2").move("ee5, ra7");
        const won = nearGoal.clone().move("Rd8", {emulation: true});
        expect(won.gameover).to.be.true;
        expect(won.die).to.be.undefined;
        expect(won.render().legend).to.not.have.property("DIE");
    });

    it("ends the game when the die allows one step and only a push remains", () => {
        // Gold's elephant is boxed in by rabbits it could push; its rabbit is frozen
        const boxed = (): ArimaaGame => new ArimaaGame(undefined, ["free", "dicey"]).move("Ea8, Rh1");
        let g = withRandom(0, () => boxed().move("ra7, rb8, ch2, dg1"));
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
        expect(g.die).to.be.undefined;
        g = withRandom(0.99, () => boxed().move("ra7, rb8, ch2, dg1"));
        expect(g.gameover).to.be.false;
        expect(g.die!.steps).to.equal(4);
        expect(g.validateMove("Ea7").valid).to.be.true;
        // a preview has no roll to decide it, so the game goes on
        g = withRandom(0, () => boxed().move("ra7, rb8, ch2, dg1", {emulation: true}));
        expect(g.gameover).to.be.false;
        expect(g.die).to.be.undefined;
    });

    it("hides the die when the rules end the game, but not after a resignation, timeout or draw", () => {
        const drawsDie = (g: ArimaaGame): boolean => (g.render().legend as Record<string, unknown>).DIE !== undefined;
        // a Gold rabbit one step from goal, so any roll lets it score
        const nearGoal = (): ArimaaGame => new ArimaaGame(undefined, ["free", "dicey"]).move("Rd7, Ee2").move("ee5, ra7");
        const won = nearGoal().move("Rd8");
        expect(won.gameover).to.be.true;
        expect(won.winner).to.deep.equal([1]);
        expect(won.die).to.be.undefined;
        expect(drawsDie(won)).to.be.false;
        // the die that was showing may have informed the decision, so it stays
        const endings: Array<(g: ArimaaGame) => void> = [g => g.resign(1), g => g.resign(2), g => g.timeout(1), g => g.draw()];
        for (const end of endings) {
            const g = nearGoal();
            const die = {...g.die!};
            end(g);
            expect(g.gameover).to.be.true;
            g.load();
            expect(g.die).to.deep.equal(die);
            expect(drawsDie(g)).to.be.true;
        }
    });

    it("keeps the die where it is while a move is entered and draws it under the pieces", () => {
        const g = freeStart().move("ee7, ra7");
        const die = {...g.die!};
        const partial = g.clone();
        partial.move("Ed3", {partial: true});
        expect(partial.die).to.deep.equal(die);
        const rep = partial.render();
        expect((rep.legend as Record<string, {name: string}>).DIE.name).to.equal(`d6-${die.steps}`);
        const [x, y] = ArimaaGame.algebraic2coords(die.square);
        const markers = (rep.board as {markers: Array<{type: string; glyph?: string; points?: Array<{row: number; col: number}>}>}).markers;
        const marker = markers.find(m => m.type === "glyph" && m.glyph === "DIE");
        expect(marker).to.not.be.undefined;
        expect(marker!.points).to.deep.equal([{row: y, col: x}]);
        // a resumed game carries it
        const resumed = new ArimaaGame(g.serialize());
        expect(resumed.die).to.deep.equal(die);
        expect(resumed.variants).to.deep.equal(["free", "dicey"]);
    });

    it("reports how the die has been rolling, whatever steps were left unused", () => {
        const means = (g: ArimaaGame) => g.sidebarScores()[0].scores;
        const totals = (g: ArimaaGame) => g.sidebarScores()[1].scores;
        expect(new ArimaaGame().sidebarScores()).to.deep.equal([]);
        expect(new ArimaaGame(undefined, ["eee"]).sidebarScores()).to.deep.equal([]);
        // nothing to report before the first die
        expect(freeStart().sidebarScores()).to.deep.equal([]);
        // the die for the turn in progress counts as soon as it is cast
        const g = withRandom(0.34, () => freeStart().move("ee7, ra7"));
        expect(g.die!.steps).to.equal(3);
        const scores = g.sidebarScores();
        expect(scores.map(s => (s.name as {textKey: string}).textKey)).to.deep.equal([
            "apgames:status.arimaa.ROLL_MEAN",
            "apgames:status.arimaa.ROLL_TOTAL",
        ]);
        expect(scores.every(s => s.spoiler === true)).to.be.true;
        expect(means(g)).to.deep.equal(["3.00", "-"]);
        expect(totals(g)).to.deep.equal([3, 0]);
        // one step of the three rolled, then one of the one
        withRandom(0, () => g.move("Ed3"));
        withRandom(0.99, () => g.move("ee6"));
        expect(means(g)).to.deep.equal(["3.50", "1.00"]);
        expect(totals(g)).to.deep.equal([7, 1]);
        // a resignation keeps the die it ended on, which counts only once
        g.resign(2);
        g.load();
        expect(means(g)).to.deep.equal(["3.50", "1.00"]);
        expect(totals(g)).to.deep.equal([7, 1]);
    });

    it("counts the opening roll of Endless endgame double towards the mean only", () => {
        // any step onto an empty square for the player to move (the setup is
        // random, and an arrow onto an occupied square can fit several moves)
        const oneStep = (g: ArimaaGame): string => {
            for (const [cell, [pc, owner]] of g.board) {
                if (owner !== g.currplayer) {
                    continue;
                }
                const [x, y] = ArimaaGame.algebraic2coords(cell);
                for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    if (x + dx < 0 || x + dx > 7 || y + dy < 0 || y + dy > 7) {
                        continue;
                    }
                    const to = ArimaaGame.coords2algebraic(x + dx, y + dy);
                    const mv = `${owner === 1 ? pc : pc.toLowerCase()}${cell}${to}`;
                    const result = g.validateMove(mv);
                    if (!g.board.has(to) && result.valid && result.complete !== -1) {
                        return mv;
                    }
                }
            }
            throw new Error("No one-step move found");
        };
        const g = new ArimaaGame(undefined, ["eee", "dicey"]);
        const opening = g.die!.steps;
        expect(g.sidebarScores()[0].scores).to.deep.equal([(opening * 2).toFixed(2), "-"]);
        expect(g.sidebarScores()[1].scores).to.deep.equal([opening, 0]);
        withRandom(0.99, () => g.move(oneStep(g)));
        withRandom(0, () => g.move(oneStep(g)));
        expect(g.sidebarScores()[0].scores).to.deep.equal([((opening * 2 + 1) / 2).toFixed(2), "4.00"]);
        expect(g.sidebarScores()[1].scores).to.deep.equal([opening + 1, 4]);
    });

    it("turns exploration off only with the die", () => {
        expect(new ArimaaGame().getFlags()).to.not.include("no-explore");
        expect(new ArimaaGame(undefined, ["eee"]).getFlags()).to.not.include("no-explore");
        expect(new ArimaaGame(undefined, ["dicey"]).getFlags()).to.include("no-explore");
        expect(resolveGameFlags("arimaa", {variants: ["free", "dicey"]})).to.include("no-explore");
        expect(resolveGameFlags("arimaa", {variants: []})).to.not.include("no-explore");
    });

    it("leaves games without the die untouched", () => {
        const g = new ArimaaGame();
        g.move("Ee2,Md2,Hb2,Hg2,Dc2,Df2,Cb1,Cg1");
        g.move("ee7,md7,hb7,hg7,dc7,df7,cb8,cg8");
        g.move("Ee4");
        expect(g.die).to.be.undefined;
        expect(JSON.stringify(g.state())).to.not.contain('"die"');
        expect(g.results.some(r => r.type === "roll")).to.be.false;
        expect(g.render().legend).to.not.have.property("DIE");
        expect(g.validateMove("").message).to.equal(i18next.t("apgames:validation.arimaa.INITIAL_INSTRUCTIONS", {context: "play"}));
    });
});

describe("Arimaa setup clicks", () => {
    it("unplaces a piece when the click lands beside it in the same square", () => {
        const g = new ArimaaGame();
        let result = g.handleClick("", 6, 4);
        expect(result.move).to.equal("Ee2");
        result = g.handleClick("Ee2", 6, 3);
        expect(result.move).to.equal("Ee2,Md2");
        // the renderer reports no piece for a click on the empty part of an occupied square
        result = g.handleClick("Ee2,Md2", 6, 3, "");
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ee2");
        result = g.handleClick("Ee2", 6, 4);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("");
        // clicking the piece glyph itself works as before
        result = g.handleClick("Ee2,Md2", 6, 3, "M1");
        expect(result.move).to.equal("Ee2");
    });

    it("preserves placed pieces when another piece is selected from either setup tray", () => {
        for (const variants of [[], ["free"]]) {
            const game = new ArimaaGame(undefined, variants);
            const selected = game.handleClick("Ee2", -1, -1, "pC1");
            expect(selected.move).to.equal("Ee2,C");
            expect(selected.canrender).to.equal(true);
            const preview = game.clone().move(selected.move, {partial: true});
            expect(preview.board.get("e2")).to.deep.equal(["E", 1]);
            expect(preview.render().pieces).to.be.a("string").and.include("E1");
        }
    });
});
