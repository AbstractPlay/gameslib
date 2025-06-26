/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
// import { EmuGame } from '../../src/games';
import { birdDir, getBirdSuits, canGrowBird, interpolateWilds, scoreBird } from "../../src/games/emu";

describe("Emu Ranchers", () => {
    it("Bird direction", () => {
        // birds hatched with Aces are ascending
        expect(birdDir(["1M"])).equal("A");
        // birds hatched with Crowns are descending
        expect(birdDir(["NM"])).equal("D");
        // all other single-card birds are undefined
        expect(birdDir(["5SV"])).to.be.null;
        // 2 + wild is ascending because wilds can't be Aces
        expect(birdDir(["2SY", "PSVK"])).equal("A");
        // 3 + wild is undefined
        expect(birdDir(["3SK", "PSVK"])).to.be.null;
        // 3 + 2 wilds must be ascending
        expect(birdDir(["3SK", "PSVK", "PMSL"])).equal("A");
        // 9 + wild is descending because wilds can't be Crowns
        expect(birdDir(["9MS", "PSVK"])).equal("D");
        // 8 + wild is undefined
        expect(birdDir(["8MS", "PSVK"])).to.be.null;
        // 8 + 2 wilds must be descending
        expect(birdDir(["8MS", "PSVK", "PMSL"])).equal("D");
        // nums with no wilds
        expect(birdDir(["2SY", "6SY"])).equal("A");
        expect(birdDir(["6SY", "2SY"])).equal("D");
        // nums with wilds
        expect(birdDir(["2SY", "PSVK", "6SY"])).equal("A");
        expect(birdDir(["6SY", "PSVK", "2SY"])).equal("D");
    });

    it("Bird suits", () => {
        // single card returns both suits
        expect(getBirdSuits(["5YK"])).eql(["Y", "K"]);
        // multiple matches found correctly
        expect(getBirdSuits(["5YK", "4YK"])).eql(["Y", "K"]);
        expect(getBirdSuits(["5YK", "PMYK"])).eql(["Y", "K"]);
        // singles
        expect(getBirdSuits(["1M", "6MV"])).eql(["M"]);
        expect(getBirdSuits(["7ML", "6MV"])).eql(["M"]);
    });

    it("Bird growth", () => {
        // must match suits
        expect(canGrowBird(["1M"], "5YK")).to.be.false;
        expect(canGrowBird(["1M"], "5ML")).to.be.true;

        // no wilds: direction consistent
        expect(canGrowBird(["1M", "3MV"], "2MK")).to.be.false;
        expect(canGrowBird(["1M", "3MV"], "4MS")).to.be.true;
        expect(canGrowBird(["5ML", "4MS"], "6MV")).to.be.false;
        expect(canGrowBird(["5ML", "4MS"], "3MV")).to.be.true;

        // wilds: middle wild lets you go either direction
        expect(canGrowBird(["5ML", "PMYK"], "8MS")).to.be.true;
        expect(canGrowBird(["5ML", "PMYK"], "3MV")).to.be.true;
        expect(canGrowBird(["5ML", "PMYK", "PMSL"], "2MK")).to.be.true;
        expect(canGrowBird(["5ML", "PMYK", "PMSL"], "8MS")).to.be.true;
        // wilds: but there has to be room
        expect(canGrowBird(["5ML", "PMYK"], "6MV")).to.be.false;
        expect(canGrowBird(["5ML", "PMYK"], "4MS")).to.be.false;
        expect(canGrowBird(["5ML", "PMYK", "PMSL"], "3MV")).to.be.false;
        expect(canGrowBird(["5ML", "PMYK", "PMSL"], "7ML")).to.be.false;
        // wilds: can't be Aces or Crowns
        expect(canGrowBird(["8MS", "9MS"], "PMYK")).to.be.false;
        expect(canGrowBird(["3MV", "1V"], "PMYK")).to.be.false;
        // wilds: but they can be others
        expect(canGrowBird(["7ML", "8MS"], "PMYK")).to.be.true;
        expect(canGrowBird(["4MS", "3MV"], "PMYK")).to.be.true;
    });

    it("Interpolate wilds", () => {
        // single wild, two options
        expect(interpolateWilds(["5YK", "PMYK", "8YK"])).eql([["5YK","6SY","8YK"],["5YK","7SK","8YK"]]);
        // two wilds, open ended
        expect(interpolateWilds(["5YK", "PMYK", "PSVK"])).eql([["5YK","6LK","7SK"],["5YK","6LK","8YK"],["5YK","6LK","9LK"],["5YK","7SK","8YK"],["5YK","7SK","9LK"],["5YK","8YK","9LK"]]);
        // two wilds descending (has to be explicit because otherwise it defaults to ascending)
        expect(interpolateWilds(["5YK", "PMYK", "PSVK", "1K"])).eql([["5YK","4YK","3SK","1K"],["5YK","4YK","2MK","1K"],["5YK","3SK","2MK","1K"]]);
    });

    it("Bird scores", () => {
        // no wilds
        expect(scoreBird(["2MK", "8YK"]).value).equal(-8);
        expect(scoreBird(["1K", "2MK", "8YK"]).value).equal(-13);
        expect(scoreBird(["2MK", "8YK", "NK"]).value).equal(-13);
        expect(scoreBird(["1K", "2MK", "8YK", "NK"]).value).equal(-18);
        expect(scoreBird(["2MK", "8YK", "9LK"]).value).equal(0);
        expect(scoreBird(["1K", "2MK", "8YK", "9LK"]).value).equal(5);
        expect(scoreBird(["2MK", "8YK", "9LK", "NK"]).value).equal(5);
        expect(scoreBird(["1K", "2MK", "8YK", "9LK", "NK"]).value).equal(10);
        expect(scoreBird(["2MK", "7SK", "8YK", "9LK"]).value).equal(8);
        expect(scoreBird(["1K", "2MK", "7SK", "8YK", "9LK"]).value).equal(13);
        expect(scoreBird(["2MK", "7SK", "8YK", "9LK", "NK"]).value).equal(13);
        expect(scoreBird(["1K", "2MK", "7SK", "8YK", "9LK", "NK"]).value).equal(18);
        // wilds
        expect(scoreBird(["5YK", "PMYK", "PSVK", "1K"]).value).equal(-11);
        expect(scoreBird(["5YK", "PMYK", "PSVK"]).value).equal(0);
        expect(scoreBird(["5YK", "PMYK", "PSVK", "9LK"]).value).equal(9);
    });
});

