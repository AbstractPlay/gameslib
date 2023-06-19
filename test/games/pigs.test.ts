/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { PigsGame } from '../../src/games';

describe("Robo Battle Pigs", () => {
    it("Collisions", () => {
        const g = new PigsGame(2);
        g.damage = [4,4];

        // head on
        g.board.clear();
        g.board.set("d4", [1,"N"]);
        g.board.set("d5", [2,"S"]);
        g.move("^xxxx,^xxxx");
        let orig = g.board.get("d4");
        let after = g.board.get("d5");
        expect(orig).to.not.be.undefined;
        expect(after).to.not.be.undefined;
        expect(orig![0]).eq(1);
        expect(after![0]).eq(2);

        // from angle
        g.board.clear();
        g.board.set("e4", [1,"N"]);
        g.board.set("d5", [2,"S"]);
        g.move("\\xxxx,\\xxxx");
        orig = g.board.get("e4");
        after = g.board.get("d5");
        expect(orig).to.not.be.undefined;
        expect(after).to.not.be.undefined;
        expect(orig![0]).eq(1);
        expect(after![0]).eq(2);

        // from behind
        g.board.clear();
        g.board.clear();
        g.board.set("d4", [2,"S"]);
        g.board.set("d5", [1,"N"]);
        g.move("vxxxx,vxxxx");
        orig = g.board.get("d4");
        after = g.board.get("d5");
        expect(orig).to.not.be.undefined;
        expect(after).to.not.be.undefined;
        expect(orig![0]).eq(2);
        expect(after![0]).eq(1);

        // one stationary
        g.board.clear();
        g.board.set("d4", [1,"N"]);
        g.board.set("d5", [2,"S"]);
        g.move("x^xxx,^xxxx");
        orig = g.board.get("d4");
        after = g.board.get("d5");
        expect(orig).to.not.be.undefined;
        expect(after).to.not.be.undefined;
        expect(orig![0]).eq(1);
        expect(after![0]).eq(2);

        // but crossing is ok
        g.board.clear();
        g.board.set("d4", [1,"N"]);
        g.board.set("e4", [2,"N"]);
        g.move("/xxxx,\\xxxx");
        orig = g.board.get("d4");
        after = g.board.get("e4");
        expect(orig).to.be.undefined;
        expect(after).to.be.undefined;
        expect(g.board.get("e5")![0]).eq(1);
        expect(g.board.get("d5")![0]).eq(2);

        // as is moving into a vacated space
        g.board.clear();
        g.board.set("d4", [1,"N"]);
        g.board.set("d3", [2,"N"]);
        g.move("^xxxx,^xxxx");
        const rear = g.board.get("d3");
        const mid = g.board.get("d4");
        const fore = g.board.get("d5");
        expect(rear).to.be.undefined;
        expect(mid).to.not.be.undefined;
        expect(fore).to.not.be.undefined;
        expect(mid![0]).eq(2);
        expect(fore![0]).eq(1);
    });
});

