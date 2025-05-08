/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { bearing } from '../../src/common/hexes';
import { Orientation, defineHex } from "honeycomb-grid";

describe("Hexes library", () => {
    it ("bearing", () => {
        const pHex = defineHex({orientation: Orientation.POINTY});
        const fHex = defineHex({orientation: Orientation.FLAT});
        let from = new pHex({q: 0, r: 0});
        let to = new pHex({q: 1, r: -1});
        expect(bearing(from, to)).eq("NE");
        to = new pHex({q: 1, r: 0});
        expect(bearing(from, to)).eq("E");
        to = new pHex({q: 0, r: 1});
        expect(bearing(from, to)).eq("SE");
        to = new pHex({q: -1, r: 1});
        expect(bearing(from, to)).eq("SW");
        to = new pHex({q: -1, r: 0});
        expect(bearing(from, to)).eq("W");
        to = new pHex({q: 0, r: -1});
        expect(bearing(from, to)).eq("NW");
        to = new pHex({q: 1, r: -2});
        expect(bearing(from, to)).to.be.undefined;

        from = new fHex({q: 0, r: 0});
        to = new fHex({q: 0, r: -1})
        expect(bearing(from, to)).eq("N");
        to = new fHex({q: 1, r: -1})
        expect(bearing(from, to)).eq("NE");
        to = new fHex({q: 1, r: 0})
        expect(bearing(from, to)).eq("SE");
        to = new fHex({q: 0, r: 1})
        expect(bearing(from, to)).eq("S");
        to = new fHex({q: -1, r: 1})
        expect(bearing(from, to)).eq("SW");
        to = new fHex({q: -1, r: 0})
        expect(bearing(from, to)).eq("NW");
        to = new fHex({q: -1, r: -1})
        expect(bearing(from, to)).to.be.undefined;
    });
});
