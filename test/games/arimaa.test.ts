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

        // and it stays out of the way when the placements don't add up
        // (two pieces on one cell is caught elsewhere, but must not autofill)
        g = new ArimaaGame();
        result = g.validateMove("Ee2,Me2,Hb2,Hg2,Cf2,Cc2,Dd1,De1");
        expect(result.complete).to.equal(-1);

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
});

