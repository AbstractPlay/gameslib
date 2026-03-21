/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { MinefieldGame } from '../../src/games';
import { type playerid } from "../../src/games/minefield";

describe("Minefield", () => {
    it ("Hard corners", () => {
        const g = new MinefieldGame(undefined, ["size-19"]);
        g.board = new Map<string, playerid>([
            ["j16", 2],
            ["j15", 1],
        ]);
        expect(g.canPlace("i16", 1)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 2],
            ["i16", 1],
        ]);
        expect(g.canPlace("j15", 1)).to.be.false;
        g.board = new Map<string, playerid>([
            ["i16", 1],
            ["j15", 1],
        ]);
        expect(g.canPlace("j16", 2)).to.be.false;
        g.board = new Map<string, playerid>([
            ["i16", 1],
            ["j15", 1],
        ]);
        expect(g.canPlace("i15", 2)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["j15", 2],
        ]);
        expect(g.canPlace("j14", 1)).to.be.true;
        g.board = new Map<string, playerid>([
            ["i16", 1],
            ["j15", 1],
            ["j16", 1],
        ]);
        expect(g.canPlace("i15", 2)).to.be.true;
    });
    it ("Switches", () => {
        let g = new MinefieldGame(undefined, ["size-19"]);
        // dist 2
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 2],
            ["j14", 2],
        ]);
        expect(g.canPlace("k14", 1)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 2],
            ["k14", 1],
        ]);
        expect(g.canPlace("j14", 2)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["j15", 2],
            ["l16", 2],
        ]);
        expect(g.canPlace("l15", 1)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["l15", 1],
            ["l16", 2],
        ]);
        expect(g.canPlace("j15", 2)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["l15", 2],
            ["l16", 1],
        ]);
        expect(g.canPlace("j15", 2)).to.be.true;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 1],
            ["l15", 1],
            ["l16", 2],
        ]);
        expect(g.canPlace("j15", 2)).to.be.true;
        // dist 3
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 2],
            ["j13", 2],
        ]);
        expect(g.canPlace("k13", 1)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 2],
            ["k13", 1],
        ]);
        expect(g.canPlace("j13", 2)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["j15", 2],
            ["m16", 2],
        ]);
        expect(g.canPlace("m15", 1)).to.be.false;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["m15", 1],
            ["m16", 2],
        ]);
        expect(g.canPlace("j15", 2)).to.be.false;

        // but dist 3 is fine in cartwheel
        g = new MinefieldGame(undefined, ["cartwheel", "size-19"]);
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 2],
            ["j13", 2],
        ]);
        expect(g.canPlace("k13", 1)).to.be.true;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["k16", 2],
            ["k13", 1],
        ]);
        expect(g.canPlace("j13", 2)).to.be.true;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["j15", 2],
            ["m16", 2],
        ]);
        expect(g.canPlace("m15", 1)).to.be.true;
        g.board = new Map<string, playerid>([
            ["j16", 1],
            ["m15", 1],
            ["m16", 2],
        ]);
        expect(g.canPlace("j15", 2)).to.be.true;
    });
    it ("Pinwheels", () => {
        const g = new MinefieldGame(undefined, ["cartwheel", "size-19"]);
        g.board = new Map<string, playerid>([
            ["k16", 2],
            ["l15", 1],
            ["l14", 2],
            ["k13", 1],
            ["j13", 2],
            ["i14", 1],
            ["i15", 2],
        ]);
        expect(g.canPlace("j16", 1)).to.be.false;
        expect(g.canPlace("j16", 2)).to.be.true;
        g.board = new Map<string, playerid>([
            ["k16", 2],
            ["l15", 1],
            ["l14", 2],
            ["k13", 1],
            ["j13", 2],
            ["i14", 1],
            ["i15", 2],
            ["j15", 1],
        ]);
        expect(g.canPlace("j16", 1)).to.be.true;
    });
    it ("Cartwheels", () => {
        let g = new MinefieldGame(undefined, ["cartwheel", "size-19"]);
        g.board = new Map<string, playerid>([
            ["k16", 2],
            ["l15", 1],
            ["l14", 1],
            ["k13", 2],
            ["j13", 2],
            ["i14", 1],
            ["i15", 1],
        ]);
        expect(g.canPlace("j16", 2)).to.be.false;
        expect(g.canPlace("j16", 1)).to.be.true;
        g.board = new Map<string, playerid>([
            ["k16", 2],
            ["l15", 1],
            ["l14", 1],
            ["k13", 2],
            ["j13", 2],
            ["i14", 1],
            ["i15", 1],
            ["j15", 1],
        ]);
        expect(g.canPlace("j16", 2)).to.be.true;
        g = new MinefieldGame(undefined, ["cartwheel"]);
        g.board = new Map<string, playerid>([
            ["c8", 1], ["d10", 2], ["d9", 2],
        ]);
        expect(g.canPlace("b8", 1)).to.be.false;
    });
});

