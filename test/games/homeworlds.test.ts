/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
// import { HomeworldsGame } from '../../src/games';
import { Stash, Ship, System } from "../../src/games/homeworlds/"
import { HomeworldsGame, HomeworldsErrors as HWError } from "../../src/games/homeworlds";
import { IValidationResult } from "../../src/games/_base";

describe("Homeworlds", () => {
    it ("Stash renders correctly", () => {
        const s = new Stash(3);
        const obj = {
            R: "111222333",
            B: "111222333",
            G: "111222333",
            Y: "111222333",
            type: "globalStash"
        };
        expect(s.render()).to.deep.equal(obj);
    });
    it ("Stash min and max are respected", () => {
        const s = new Stash(3);
        expect(() => s.add("R", 1)).to.throw();
        s.remove("R", 1);
        s.remove("R", 1);
        s.remove("R", 1);
        expect(() => s.remove("R", 1)).to.throw(HWError.STASH_EMPTY);
    });
    it ("Ship manipulation", () => {
        const s = new Ship("R", 1, "N");
        expect(s.id()).to.equal("R1N");
        s.colour = "B";
        expect(s.id()).to.equal("B1N");
        s.owner = "S";
        expect(s.id()).to.equal("B1S");
    });
    it ("Systems work properly", () => {
        let s = new System("test", [["R", 3], ["B", 2]], "N");
        expect(s.isHome()).to.be.true;
        for (let i = 0; i < 16; i++) {
            s.dock(new Ship("Y", 1, "S"));
        }
        expect(() => s.dock(new Ship("Y", 1, "S"))).to.throw(HWError.SYSTEM_FULL);

        s = new System("test", [["B", 3]]);
        expect(s.isHome()).to.be.false;
        expect(() => new System("test", [["R", 3], ["B", 2]])).to.throw();
        for (let i = 0; i < 24; i++) {
            s.dock(new Ship("Y", 1, "S"));
        }
        expect(() => s.dock(new Ship("Y", 1, "S"))).to.throw(HWError.SYSTEM_FULL);

        s = new System("test", [["B", 3]]);
        expect(() => s.undock("Y1S")).to.throw(HWError.SYSTEM_NOSHIP);
        s.dock(new Ship("Y", 1, "S"));
        expect(s.ships.length).to.equal(1);
        expect(() => s.undock("Y1S")).to.not.throw();
        expect(s.ships.length).to.equal(0);
    });
    it ("Catastrophes work properly", () => {
        const s = new System("test", [["B", 3], ["Y", 1]], "N");
        s.dock(new Ship("B", 2, "N"));
        s.dock(new Ship("B", 2, "N"));
        s.dock(new Ship("B", 2, "S"));
        s.dock(new Ship("Y", 2, "S"));
        expect(s.canCatastrophe("Y")).to.be.false;
        expect(() => s.catastrophe("Y")).to.throw(HWError.CMD_CATA_INVALID);
        expect(s.canCatastrophe("B")).to.be.true;
        expect(() => s.catastrophe("B")).to.not.throw();
        expect(s.stars.length).to.equal(1);
        expect(s.ships.length).to.equal(1);
    });
    it ("CMD: Homeworld", () => {
        let g = new HomeworldsGame(2);
        // duplicate homeworld command
        expect (() => g.move("homeworld g3 b2 r3")).to.not.throw();
        expect (() => g.move("homeworld g2 b1 r3")).to.not.throw();
        expect(() => g.move("homeworld g3 b2 r3")).to.throw(HWError.CMD_HOME_DOUBLE);
        // malformed command
        g = new HomeworldsGame(2);
        expect(() => g.move("homeworld g3 r3")).to.throw(HWError.CMD_PARAMETERS);
        // malformed ship designations
        expect(() => g.move("homeworld p3 r4 y2")).to.throw(HWError.CMD_STARSHIP_NAME);
        // one star
        expect (() => g.move("homeworld g3 - r3")).to.throw();
        expect (() => g.move("homeworld g3 - r3 *")).to.not.throw(HWError.CMD_HOME_SINGLE);
        // no large ship
        g = new HomeworldsGame(2);
        expect(() => g.move("homeworld g3 b2 r2")).to.throw(HWError.CMD_HOME_SMALLSHIP);
        expect(() => g.move("homeworld g3 b2 r2 *")).to.not.throw();
        // both stars same size
        g = new HomeworldsGame(2);
        expect(() => g.move("homeworld g3 b3 r3")).to.throw(HWError.CMD_HOME_SAMESIZE);
        expect(() => g.move("homeworld g3 b3 r3 *")).to.not.throw();
        // not enough colours
        g = new HomeworldsGame(2);
        expect(() => g.move("homeworld g3 b2 b3")).to.throw(HWError.CMD_HOME_COLOURS);
        expect(() => g.move("homeworld g3 b2 b3 *")).to.not.throw();
        // wrong colours
        g = new HomeworldsGame(2);
        expect(() => g.move("homeworld y3 b2 r3")).to.throw(HWError.CMD_HOME_TECHS);
        expect(() => g.move("homeworld y3 g2 r3")).to.throw(HWError.CMD_HOME_TECHS);
        expect(() => g.move("homeworld y3 b2 r3 *")).to.not.throw();
        expect(() => g.move("homeworld y3 g2 r3 *")).to.not.throw();
        expect(g.systems.length).to.equal(2);
        // Same star sizes as RHO
        g = new HomeworldsGame(2);
        expect (() => g.move("homeworld g3 b2 r3")).to.not.throw();
        expect (() => g.move("homeworld y3 g2 b3")).to.throw(HWError.CMD_HOME_RHO);
        expect (() => g.move("homeworld y3 g2 b3 *")).to.not.throw();
    });
    it ("CMD: Discover", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        // malformed command
        expect(() => g.move("discover y3")).to.throw(HWError.CMD_PARAMETERS);
        // unknown from system
        expect(() => g.move("discover y3 John r1 Alice")).to.throw(HWError.CMD_NOSYSTEM);
        // invalid system name
        expect(() => g.move("discover y3 North r1 _Alice")).to.throw(HWError.SYSTEM_BADNAME);
        // duplicate system name
        expect(() => g.move("discover y3 North r1 South")).to.throw(HWError.CMD_DISC_DOUBLE);
        // nonexistent ship
        expect(() => g.move("discover r3 North r1 Alice")).to.throw(HWError.SYSTEM_NOSHIP);
        // not connected
        expect(() => g.move("discover y3 North r2 Alice")).to.throw(HWError.CMD_MOVE_CONNECTION);

        // no actions remaining
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        expect(() => g.move("discover y1 north r1 Alice, discover y1 alice r3 bob")).to.throw(HWError.CMD_NOACTIONS);

        // no Y tech
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 r3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("R", 1, "N"));
        expect(() => g.move("discover r1 north r1 Alice")).to.throw(HWError.CMD_NOTECH);

        // not in stash
        g = new HomeworldsGame(2);
        g.move("homeworld g3 g2 g3 *");
        g.move("homeworld g2 g1 g3 *");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        north!.dock(new Ship("G", 1, "N"));
        g.stash.remove("G", 1);
        north!.dock(new Ship("G", 1, "N"));
        g.stash.remove("G", 1);
        north!.dock(new Ship("G", 2, "N"));
        g.stash.remove("G", 2);
        expect(() => g.move("discover g1 north g1 Alice")).to.throw(HWError.STASH_EMPTY);
        expect(() => g.move("discover g1 north g2 Alice")).to.throw(HWError.STASH_EMPTY);
        expect(() => g.move("discover g1 north g3 Alice")).to.throw(HWError.STASH_EMPTY);

        // destroy empty systems
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 r3");
        g.move("homeworld g2 b1 y3");
        const newsys = new System("test", [["R", 3]]);
        newsys.dock(new Ship("Y", 1, "N"));
        g.systems.push(newsys);
        expect(() => g.move("discover y1 test r2 Alice")).to.not.throw();
        const found = g.systems.find(s => s.name === "test");
        expect(found).to.be.undefined;

        // but not the current player's home system
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 r3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 3, "N"));
        north!.dock(new Ship("Y", 1, "N"));
        g.move("s y3 north, d y1 north r1 test, m r3 north test, m r3 test north");
        expect(north!.ships.length).to.equal(1);
        expect(north!.hasShip("R3N")).to.be.true;
    });
    it ("CMD: Move", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        g.systems.push(new System("test", [["R", 1]]).dock(new Ship("Y", 1, "N")));
        g.systems.push(new System("disconnected", [["R", 2]]).dock(new Ship("Y", 1, "N")));
        // malformed command
        expect(() => g.move("move y1")).to.throw(HWError.CMD_PARAMETERS);
        // unknown from system
        expect(() => g.move("move y1 John test")).to.throw(HWError.CMD_NOSYSTEM);
        // unknown to system
        expect(() => g.move("move y1 north Alice")).to.throw(HWError.CMD_NOSYSTEM);
        // no ship
        expect(() => g.move("move r1 north test")).to.throw(HWError.SYSTEM_NOSHIP);
        // not connected
        expect(() => g.move("move y1 north disconnected")).to.throw(HWError.CMD_MOVE_CONNECTION);
        // success
        expect(() => g.move("move y1 north test")).to.not.throw();

        // no actions
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        g.systems.push(new System("test", [["R", 1]]).dock(new Ship("Y", 1, "N")));
        g.systems.push(new System("disconnected", [["R", 2]]).dock(new Ship("Y", 1, "N")));
        expect(() => g.move("move y1 north test, move y1 test disconnected")).to.throw(HWError.CMD_NOACTIONS);

        // no tech
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 r3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("G", 1, "N"));
        g.systems.push(new System("test", [["R", 1]]).dock(new Ship("Y", 1, "N")));
        g.systems.push(new System("disconnected", [["R", 2]]).dock(new Ship("Y", 1, "N")));
        expect(() => g.move("move g1 north test")).to.throw(HWError.CMD_NOTECH);
    });
    it ("CMD: Build", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");

        // malformed command
        expect(() => g.move("build y1")).to.throw(HWError.CMD_PARAMETERS);
        // invalid system
        expect(() => g.move("build y1 John")).to.throw(HWError.CMD_NOSYSTEM);
        // missing template
        expect(() => g.move("build g1 north")).to.throw(HWError.CMD_BUILD_TEMPLATE);
        expect(() => g.move("build g north")).to.throw(HWError.CMD_BUILD_TEMPLATE);
        // successful
        expect(() => g.move("build y north")).to.not.throw();

        // empty stash
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        g.stash.remove("Y", 1);
        g.stash.remove("Y", 1);
        g.stash.remove("Y", 1);
        g.stash.remove("Y", 2);
        g.stash.remove("Y", 2);
        g.stash.remove("Y", 2);
        g.stash.remove("Y", 3);
        expect(() => g.move("build y north")).to.throw(HWError.STASH_EMPTY);

        // adding a size doesn't change anything
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        g.stash.remove("Y", 1);
        g.stash.remove("Y", 1);
        g.stash.remove("Y", 1);
        expect(() => g.move("build y1 north")).to.not.throw();
        const north = g.systems.find(s => s.owner === "N");
        expect(north!.hasShip("Y2N")).to.be.true;

        // no actions
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        expect(() => g.move("build y north, build y north")).to.throw(HWError.CMD_NOACTIONS);

        // no tech
        g = new HomeworldsGame(2);
        g.move("homeworld r3 b2 y3 *");
        g.move("homeworld g2 b1 y3");
        expect(() => g.move("build y north")).to.throw(HWError.CMD_NOTECH);
    });
    it ("CMD: Trade", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        g.stash.remove("Y", 1);

        // malformed command
        expect(() => g.move("trade y1")).to.throw(HWError.CMD_PARAMETERS);
        // invalid system
        expect(() => g.move("trade y1 John b")).to.throw(HWError.CMD_NOSYSTEM);
        // same colour
        expect(() => g.move("trade y1 north y")).to.throw(HWError.CMD_TRADE_DOUBLE);
        // success
        expect(() => g.move("trade y1 north b")).to.not.throw();
        expect(north!.hasShip("B1N")).to.be.true;
        expect(north!.hasShip("Y1N")).to.be.false;

        // stash empty
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        g.stash.remove("Y", 1);
        g.stash.remove("B", 1);
        g.stash.remove("B", 1);
        expect(() => g.move("trade y1 north b")).to.throw(HWError.STASH_EMPTY);
        // adding the size doesn't change the outcome
        expect(() => g.move("trade y1 north b2")).to.throw(HWError.STASH_EMPTY);

        // no actions
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        g.stash.remove("Y", 1);
        expect(() => g.move("trade y1 north b, trade b1 north y")).to.throw(HWError.CMD_NOACTIONS);

        // no tech
        g = new HomeworldsGame(2);
        g.move("homeworld g3 r2 y3 *");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 1, "N"));
        g.stash.remove("Y", 1);
        expect(() => g.move("trade y1 north b")).to.throw(HWError.CMD_NOTECH);
    });
    it ("CMD: Attack", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y2 *");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("R", 1, "N"));
        g.stash.remove("R", 1);
        north!.dock(new Ship("Y", 3, "S"));
        g.stash.remove("Y", 1);

        // malformed command
        expect(() => g.move("attack y1")).to.throw(HWError.CMD_PARAMETERS);
        // invalid system
        expect(() => g.move("attack y1 John")).to.throw(HWError.CMD_NOSYSTEM);
        // attacking self
        expect(() => g.move("attack r1n north")).to.throw(HWError.CMD_ATK_SELF);
        // size
        expect(() => g.move("attack y3 north")).to.throw(HWError.CMD_ATK_SIZE);

        // success (attacked clear if not given in 2-player game)
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("R", 1, "N"));
        g.stash.remove("R", 1);
        north!.dock(new Ship("Y", 3, "S"));
        g.stash.remove("Y", 1);
        expect(() => g.move("attack y3 north")).to.not.throw();
        expect(north!.hasShip("Y3S")).to.be.false;
        expect(north!.hasShip("Y3N")).to.be.true;

        // attacked must be specified in 3+ player games
        g = new HomeworldsGame(3);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        g.move("homeworld g3 b2 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("R", 1, "N"));
        g.stash.remove("R", 1);
        north!.dock(new Ship("Y", 3, "S"));
        g.stash.remove("Y", 1);
        expect(() => g.move("attack y3 north")).to.throw(HWError.CMD_ATK_OWNER);
        expect(() => g.move("attack y3s north")).to.not.throw();
        expect(north!.hasShip("Y3S")).to.be.false;
        expect(north!.hasShip("Y3N")).to.be.true;

        // no actions
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("R", 1, "N"));
        g.stash.remove("R", 1);
        north!.dock(new Ship("Y", 3, "S"));
        g.stash.remove("Y", 3);
        north!.dock(new Ship("B", 2, "S"));
        g.stash.remove("B", 2);
        expect(() => g.move("attack y3 north, attack b2 north")).to.throw(HWError.CMD_NOACTIONS);

        // no tech
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 3, "S"));
        g.stash.remove("Y", 3);
        expect(() => g.move("attack y3 north")).to.throw(HWError.CMD_NOTECH);
    });
    it ("CMD: Sacrifice", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);

        // malformed command
        expect(() => g.move("sacrifice y2")).to.throw(HWError.CMD_PARAMETERS);
        // invalid system
        expect(() => g.move("sacrifice y2 John")).to.throw(HWError.CMD_NOSYSTEM);
        // invalid ship
        expect(() => g.move("sacrifice y1 north")).to.throw(HWError.SYSTEM_NOSHIP);
        // success
        expect(() => g.move("sacrifice y2 north")).to.throw(HWError.MOVE_MOREACTIONS);

        // abandon but return to home system
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, discover y3 north r1 Alice, move y3 alice north")).to.not.throw();
        expect(g.systems.find(s => s.owner === "N")).to.not.be.undefined;

        // but destroy other systems
        // and be able to immediately use broken down star
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 g3 *");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        g.systems.push(new System("test", [["G", 1]]).dock(new Ship("G", 2, "N")));
        g.stash.remove("G", 1);
        g.stash.remove("G", 2);
        // arbitrarily empty out G
        g.stash.remove("G", 1);
        g.stash.remove("G", 1);
        g.stash.remove("G", 2);
        g.stash.remove("G", 3);
        expect(() => g.move("sacrifice g2 test, build g3 north, build g north")).to.not.throw();
        expect(north!.hasShip("G1N")).to.be.true;
        expect(north!.hasShip("G2N")).to.be.true;
        expect(north!.hasShip("G3N")).to.be.true;

        // no actions
        g = new HomeworldsGame(2);
        expect(() => g.move("homeworld g3 b2 y3, sacrifice y3 north")).to.throw(HWError.CMD_NOACTIONS);
    });
    it ("CMD: Pass", () => {
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);

        // passing free action
        expect(() => g.move("pass")).to.throw(HWError.CMD_PASS_FREE);

        // malformed command
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass 1 1 1")).to.throw(HWError.CMD_PARAMETERS);

        // passing too many
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass 3")).to.throw(HWError.CMD_PASS_TOOMANY);

        // not passing enough
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass")).to.throw(HWError.MOVE_MOREACTIONS);

        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass 1")).to.throw(HWError.MOVE_MOREACTIONS);

        // passing exactly enough
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass 2")).to.not.throw();
        expect(g.currplayer).to.equal(2);

        // multiple passes
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass, pass")).to.not.throw();
        expect(g.currplayer).to.equal(2);

        // passing all
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("sacrifice y2 north, pass *")).to.not.throw();
        expect(g.currplayer).to.equal(2);
    });
    it ("CMD: Catastrophe", () => {
        // malformed command
        let g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        let north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y1 north, catastrophe")).to.throw(HWError.CMD_PARAMETERS);

        // unknown system
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y1 north, catastrophe john y")).to.throw(HWError.CMD_NOSYSTEM);

        // no overpopulation
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y1 north, catastrophe north b")).to.throw(HWError.CMD_CATA_INVALID);

        // invalid colour
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y1 north, catastrophe north john")).to.throw(HWError.CMD_CATA_INVALID);

        // But let you write out the colour in full
        g = new HomeworldsGame(2);
        expect(g.economyBalanced()).to.be.true;
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y1 north, catastrophe north yellow")).to.not.throw(HWError.CMD_CATA_INVALID);
        expect(g.economyBalanced()).to.be.true;

        // still have actions
        g = new HomeworldsGame(2);
        expect(g.economyBalanced()).to.be.true;
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        // expect(() => g.move("catastrophe north y")).to.throw(HWError.CMD_CATA_ACTIONS);
        expect(() => g.move("catastrophe north y")).to.not.throw;
        expect(g.economyBalanced()).to.be.true;

        // Self elimination
        g = new HomeworldsGame(2);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 y3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y north, catastrophe north y")).to.throw(HWError.MOVE_SELFELIMINATE);

        // success
        g = new HomeworldsGame(2);
        expect(g.economyBalanced()).to.be.true;
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 r3");
        north = g.systems.find(s => s.owner === "N");
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        north!.dock(new Ship("Y", 2, "N"));
        g.stash.remove("Y", 2);
        expect(() => g.move("build y north")).to.not.throw();
        expect(() => g.move("build r south, catastrophe north y")).to.not.throw();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
        expect(g.economyBalanced()).to.be.true;
    });
    it ("End of Game Scenarios", () => {
        // resignation
        let g = new HomeworldsGame(4);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 r3");
        g.move("homeworld g2 b3 r3");
        g.move("homeworld g3 b1 y3");
        expect(() => g.resign(3)).to.not.throw();
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1, 2, 4]);

        // Elimination by other than nemesis does not end the game
        g = new HomeworldsGame(4);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 r3");
        g.move("homeworld g2 b3 r3");
        g.move("homeworld g3 b1 y3");
        let south = g.systems.find(s => s.owner === "S");
        south!.dock(new Ship("R", 3, "W"));
        expect(() => g.move("build y north")).to.not.throw();
        expect(() => g.move("build r east")).to.not.throw();
        expect(() => g.move("trade r3 south y")).to.not.throw();
        expect(() => g.move("attack y3s south")).to.not.throw();
        expect(g.gameover).to.be.false;
        expect(g.systems.find(s => s.owner === "S")).to.be.undefined;
        expect(g.getLHO(2)).to.equal("W");
        expect(g.getRHO(4)).to.equal("E");

        // Elimination by nemesis ends the game
        g = new HomeworldsGame(4);
        g.move("homeworld g3 b2 y3");
        g.move("homeworld g2 b1 r3");
        g.move("homeworld g2 b3 r3");
        g.move("homeworld g3 b1 y3");
        south = g.systems.find(s => s.owner === "S");
        south!.dock(new Ship("R", 3, "E"));
        expect(() => g.move("build y north")).to.not.throw();
        expect(() => g.move("attack r3s south")).to.not.throw();
        expect(g.systems.find(s => s.owner === "S")).to.be.undefined;
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });

    it("Double move bug", () => {
        const state = `{"game":"homeworlds","numplayers":2,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20211024","_results":[],"_timestamp":"2023-05-01T18:32:23.067Z","currplayer":1,"systems":[],"stash":{"maxStash":3,"contents":{"R":[3,3,3],"B":[3,3,3],"G":[3,3,3],"Y":[3,3,3]}}},{"_version":"20211024","_results":[{"type":"homeworld","stars":["B3","G2"],"ship":"R3","name":"North"}],"_timestamp":"2023-05-01T18:38:10.347Z","currplayer":2,"lastmove":"homeworld b3 g2 r3","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3}],"owner":"N"}],"stash":{"maxStash":3,"contents":{"R":[3,3,2],"B":[3,3,2],"G":[3,2,3],"Y":[3,3,3]}}},{"_version":"20211024","_results":[{"type":"homeworld","stars":["B1","R2"],"ship":"G3","name":"South"}],"_timestamp":"2023-05-02T05:25:29.236Z","currplayer":1,"lastmove":"homeworld b1 r2 g3","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[3,2,2],"B":[2,3,2],"G":[3,2,2],"Y":[3,3,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"North","what":"R1"}],"_timestamp":"2023-05-02T20:33:53.240Z","currplayer":2,"lastmove":"build r north","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"R","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[2,3,2],"G":[3,2,2],"Y":[3,3,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"South","what":"G1"}],"_timestamp":"2023-05-02T20:43:13.251Z","currplayer":1,"lastmove":"build g south","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"R","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"G","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[2,3,2],"G":[2,2,2],"Y":[3,3,3]}}},{"_version":"20211024","_results":[{"type":"convert","what":"R1","into":"Y1","where":"North"}],"_timestamp":"2023-05-02T20:51:24.505Z","currplayer":2,"lastmove":"trade r1 north y","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"G","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[3,2,2],"B":[2,3,2],"G":[2,2,2],"Y":[2,3,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"South","what":"G1"}],"_timestamp":"2023-05-03T02:50:39.410Z","currplayer":1,"lastmove":"build g south","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"G","size":1},{"owner":"S","colour":"G","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[3,2,2],"B":[2,3,2],"G":[1,2,2],"Y":[2,3,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"North","what":"R1"}],"_timestamp":"2023-05-03T12:45:46.916Z","currplayer":2,"lastmove":"build r north","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"G","size":1},{"owner":"S","colour":"G","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[2,3,2],"G":[1,2,2],"Y":[2,3,3]}}},{"_version":"20211024","_results":[{"type":"convert","what":"G1","into":"B1","where":"South"}],"_timestamp":"2023-05-04T00:22:22.381Z","currplayer":1,"lastmove":"trade g1 south b","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"G","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[2,2,2],"Y":[2,3,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"North","what":"Y1"}],"_timestamp":"2023-05-04T16:50:35.700Z","currplayer":2,"lastmove":"build y north","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"G","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[2,2,2],"Y":[1,3,3]}}},{"_version":"20211024","_results":[{"type":"convert","what":"G1","into":"Y1","where":"South"}],"_timestamp":"2023-05-05T01:10:48.488Z","currplayer":1,"lastmove":"trade g1 south y","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[3,2,2],"Y":[0,3,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"North","what":"Y2"}],"_timestamp":"2023-05-05T13:16:04.889Z","currplayer":2,"lastmove":"build y north","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"Y","size":2}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":1}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[3,2,2],"Y":[0,2,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"South","what":"Y2"}],"_timestamp":"2023-05-08T21:05:05.814Z","currplayer":1,"lastmove":"build y south","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"Y","size":2}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":1},{"owner":"S","colour":"Y","size":2}],"owner":"S"}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[3,2,2],"Y":[0,1,3]}}},{"_version":"20211024","_results":[{"type":"discover","called":"Foxyg","what":"G1"},{"type":"move","from":"North","to":"Foxyg","what":"Y2"}],"_timestamp":"2023-05-08T22:16:49.074Z","currplayer":2,"lastmove":"discover y2 north g1 foxyg","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":1},{"owner":"S","colour":"Y","size":2}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[2,2,2],"Y":[0,1,3]}}},{"_version":"20211024","_results":[{"type":"discover","called":"Galorndon","what":"G3"},{"type":"move","from":"South","to":"Galorndon","what":"Y1"}],"_timestamp":"2023-05-10T20:55:16.289Z","currplayer":1,"lastmove":"discover y1 south g3 galorndon","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"Y","size":1},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[2,2,1],"Y":[0,1,3]}}},{"_version":"20211024","_results":[{"type":"discover","called":"Zunda","what":"G1"},{"type":"move","from":"North","to":"Zunda","what":"Y1"}],"_timestamp":"2023-05-11T14:15:25.444Z","currplayer":2,"lastmove":"discover y1 north g1 zunda","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1}]},{"name":"Zunda","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[1,2,1],"Y":[0,1,3]}}},{"_version":"20211024","_results":[{"type":"place","where":"South","what":"G1"}],"_timestamp":"2023-05-11T21:28:53.349Z","currplayer":1,"lastmove":"build g south","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"R","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"G","size":1}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1}]},{"name":"Zunda","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,2],"B":[1,3,2],"G":[0,2,1],"Y":[0,1,3]}}},{"_version":"20211024","_results":[{"type":"convert","what":"R3","into":"G3","where":"North"}],"_timestamp":"2023-05-11T22:05:21.609Z","currplayer":2,"lastmove":"trade r3 north g","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"G","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"G","size":1}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1}]},{"name":"Zunda","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[1,3,2],"G":[0,2,0],"Y":[0,1,3]}}},{"_version":"20211024","_results":[{"type":"discover","called":"Bajor","what":"Y3"},{"type":"move","from":"South","to":"Bajor","what":"G1"}],"_timestamp":"2023-05-13T18:13:28.425Z","currplayer":1,"lastmove":"discover g1 south y3 bajor","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"G","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1}]},{"name":"Zunda","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[1,3,2],"G":[0,2,0],"Y":[0,1,2]}}},{"_version":"20211024","_results":[{"type":"place","where":"Foxyg","what":"Y2"}],"_timestamp":"2023-05-15T18:29:30.938Z","currplayer":2,"lastmove":"build y foxyg","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"G","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"G","size":3},{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2},{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1}]},{"name":"Zunda","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[1,3,2],"G":[0,2,0],"Y":[0,0,2]}}},{"_version":"20211024","_results":[{"type":"sacrifice","what":"G3","where":"South"},{"type":"place","where":"South","what":"Y3"},{"type":"place","where":"Galorndon","what":"Y3"},{"type":"place","where":"South","what":"B1"}],"_timestamp":"2023-05-15T20:53:22.674Z","currplayer":1,"lastmove":"sacrifice g3 south, build y south, build y galorndon, build b south","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"G","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Foxyg","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":2},{"owner":"N","colour":"Y","size":2}]},{"name":"Galorndon","stars":[["G",3]],"ships":[{"owner":"S","colour":"Y","size":1},{"owner":"S","colour":"Y","size":3}]},{"name":"Zunda","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[0,3,2],"G":[0,2,1],"Y":[0,0,0]}}},{"_version":"20211024","_results":[{"type":"sacrifice","what":"Y2","where":"Foxyg"},{"type":"move","from":"Foxyg","to":"Galorndon","what":"Y2"},{"type":"move","from":"Zunda","to":"Galorndon","what":"Y1"},{"type":"catastrophe","where":"Galorndon","trigger":"Y"}],"_timestamp":"2023-05-18T12:41:13.049Z","currplayer":2,"lastmove":"sacrifice y2 foxyg, move y2 foxyg galorndon, move y1 zunda galorndon, catastrophe galorndon y","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"G","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[0,3,2],"G":[2,2,1],"Y":[2,2,1]}}},{"_version":"20211024","_results":[{"type":"discover","called":"Orion","what":"G3"},{"type":"move","from":"South","to":"Orion","what":"B1"}],"_timestamp":"2023-05-21T00:19:10.473Z","currplayer":1,"lastmove":"discover b1 south g3 orion","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"G","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]},{"name":"Orion","stars":[["G",3]],"ships":[{"owner":"S","colour":"B","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[0,3,2],"G":[2,2,0],"Y":[2,2,1]}}},{"_version":"20211024","_results":[{"type":"convert","what":"G3","into":"B3","where":"North"}],"_timestamp":"2023-05-22T16:50:54.690Z","currplayer":2,"lastmove":"trade g3 north b","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"B","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]},{"name":"Orion","stars":[["G",3]],"ships":[{"owner":"S","colour":"B","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[0,3,1],"G":[2,2,1],"Y":[2,2,1]}}},{"_version":"20211024","_results":[{"type":"place","where":"Orion","what":"B2"}],"_timestamp":"2023-05-23T19:48:42.816Z","currplayer":1,"lastmove":"build b orion","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"B","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"Y","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]},{"name":"Orion","stars":[["G",3]],"ships":[{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"B","size":2}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[0,2,1],"G":[2,2,1],"Y":[2,2,1]}}},{"_version":"20211024","_results":[{"type":"discover","called":"Owuvew","what":"G1"},{"type":"move","from":"North","to":"Owuvew","what":"Y1"}],"_timestamp":"2023-05-24T14:36:54.269Z","currplayer":2,"lastmove":"discover y1 north g1 owuvew","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"B","size":3},{"owner":"N","colour":"R","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]},{"name":"Orion","stars":[["G",3]],"ships":[{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"B","size":2}]},{"name":"Owuvew","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,2,3],"B":[0,2,1],"G":[1,2,1],"Y":[2,2,1]}}},{"_version":"20211024","_results":[{"type":"convert","what":"B2","into":"R2","where":"Orion"}],"_timestamp":"2023-05-24T19:37:23.193Z","currplayer":1,"lastmove":"trade b2 orion r","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"B","size":3},{"owner":"N","colour":"R","size":1}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]},{"name":"Orion","stars":[["G",3]],"ships":[{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"R","size":2}]},{"name":"Owuvew","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,1,3],"B":[0,3,1],"G":[1,2,1],"Y":[2,2,1]}}},{"_version":"20211024","_results":[{"type":"place","where":"North","what":"B2"}],"_timestamp":"2023-05-25T15:40:03.426Z","currplayer":2,"lastmove":"build b north","systems":[{"name":"North","stars":[["B",3],["G",2]],"ships":[{"owner":"N","colour":"B","size":3},{"owner":"N","colour":"R","size":1},{"owner":"N","colour":"B","size":2}],"owner":"N"},{"name":"South","stars":[["B",1],["R",2]],"ships":[{"owner":"S","colour":"Y","size":2},{"owner":"S","colour":"Y","size":3},{"owner":"S","colour":"B","size":1}],"owner":"S"},{"name":"Bajor","stars":[["Y",3]],"ships":[{"owner":"S","colour":"G","size":1}]},{"name":"Orion","stars":[["G",3]],"ships":[{"owner":"S","colour":"B","size":1},{"owner":"S","colour":"R","size":2}]},{"name":"Owuvew","stars":[["G",1]],"ships":[{"owner":"N","colour":"Y","size":1}]}],"stash":{"maxStash":3,"contents":{"R":[2,1,3],"B":[0,2,1],"G":[1,2,2],"Y":[2,2,1]}}}]}`;
        let g = new HomeworldsGame(state);
        expect(g.economyBalanced()).to.be.true;
        const move = `sacrifice Y2 South, move B1 Orion Owuvew, move B1 Owuvew North, catastrophe North B`;
        const moves = move.split(", ");
        // sacrifice
        g.move(moves[0], true);
        expect(g.actions.Y).to.equal(2);
        let orion = g.systems.find(s => s.name === "Orion");
        expect(orion).to.not.be.undefined;
        let owu = g.systems.find(s => s.name === "Owuvew");
        expect(owu).to.not.be.undefined;
        let north = g.systems.find(s => s.name === "North");
        expect(north).to.not.be.undefined;
        expect(orion!.ships.length).equals(2);
        expect(owu!.ships.length).equals(1);
        expect(north!.ships.length).equals(3);
        expect(north!.stars.length).equals(2);
        expect(g.economyBalanced()).to.be.true;
        // sacrifice and move #1
        g = new HomeworldsGame(state);
        g.move(moves.slice(0, 2).join(","), true);
        expect(g.actions.Y).equals(1);
        orion = g.systems.find(s => s.name === "Orion");
        expect(orion).to.not.be.undefined;
        owu = g.systems.find(s => s.name === "Owuvew");
        expect(owu).to.not.be.undefined;
        north = g.systems.find(s => s.name === "North");
        expect(north).to.not.be.undefined;
        expect(orion!.ships.length).equals(1);
        expect(owu!.ships.length).equals(2);
        expect(north!.ships.length).equals(3);
        expect(north!.stars.length).equals(2);
        expect(g.economyBalanced()).to.be.true;
        // sacrifice and move #2
        g = new HomeworldsGame(state);
        g.move(moves.slice(0, 3).join(","), true);
        expect(g.actions.Y).equals(0);
        orion = g.systems.find(s => s.name === "Orion");
        expect(orion).to.not.be.undefined;
        owu = g.systems.find(s => s.name === "Owuvew");
        expect(owu).to.not.be.undefined;
        north = g.systems.find(s => s.name === "North");
        expect(north).to.not.be.undefined;
        expect(orion!.ships.length).equals(1);
        expect(owu!.ships.length).equals(1);
        expect(north!.ships.length).equals(4);
        expect(north!.stars.length).equals(2);
        expect(north!.canCatastrophe("B"));
        expect(g.economyBalanced()).to.be.true;
        // all in
        g = new HomeworldsGame(state);
        g.move(moves.join(","));
        expect(g.actions.Y).equals(0);
        orion = g.systems.find(s => s.name === "Orion");
        expect(orion).to.not.be.undefined;
        owu = g.systems.find(s => s.name === "Owuvew");
        expect(owu).to.not.be.undefined;
        north = g.systems.find(s => s.name === "North");
        expect(north).to.not.be.undefined;
        expect(orion!.ships.length).equals(1);
        expect(owu!.ships.length).equals(1);
        expect(north!.ships.length).equals(1);
        expect(north!.stars.length).equals(1);
        expect(g.economyBalanced()).to.be.true;
    });

    it("New Handler: Expansion", () => {
        const g = new HomeworldsGame(2);
        let result: string|undefined;
        // partial
        result = g.expandHandlerArray("[Test|pY3N]");
        expect(result).eq("[Test|pY3N]");
        // move
        result = g.expandHandlerArray("[From|pY3N To|]");
        expect(result).eq("move Y3 From To");
        // discover
        result = g.expandHandlerArray("[From|pY3N _void]");
        expect(result).eq("[From|pY3N _void]");
        result = g.expandHandlerArray("[From|pY3N _void B3]");
        expect(result).to.not.be.undefined;
        const parts = result!.split(/\s+/);
        parts.pop();
        result = parts.join(" ");
        expect(result).eq("discover Y3 From B3");
        // build
        result = g.expandHandlerArray("[From|pY3N From|pY3N]");
        expect(result).eq("build Y From");
        // trade
        result = g.expandHandlerArray("[From|pY3N B1]");
        expect(result).eq("trade Y3 From B");
        // attack
        result = g.expandHandlerArray("[From|pY3S]");
        expect(result).eq("attack Y3S From");
        // errors
        result = g.expandHandlerArray("[B3]");
        expect(result).to.be.undefined;
        result = g.expandHandlerArray("[From|B3]");
        expect(result).to.be.undefined;
        result = g.expandHandlerArray("[From|p3YN From|pB1S]");
        expect(result).to.be.undefined;
        result = g.expandHandlerArray("[From|p3YN From|B1]");
        expect(result).to.be.undefined;
        result = g.expandHandlerArray("[From|]");
        expect(result).to.be.undefined;
        result = g.expandHandlerArray("[_void]");
        expect(result).to.be.undefined;
        result = g.expandHandlerArray("[xxxxx]");
        expect(result).to.be.undefined;
    });

    it("New Handler: Validation", () => {
        const g = new HomeworldsGame(2);
        let result: IValidationResult;
        result = g.validateMove("[Test|pY3N]");
        expect(result.valid).to.be.true;
        expect(result.complete).to.not.be.undefined;
        expect(result.complete).eq(-1);
        result = g.validateMove("[Test|pY3N _void]");
        expect(result.valid).to.be.true;
        expect(result.complete).to.not.be.undefined;
        expect(result.complete).eq(-1);
        result = g.validateMove("[Test|pY3N _void B3]");
        expect(result.valid).to.be.false;
        expect(result.complete).to.be.undefined;
        result = g.validateMove("[Test|pY3S]");
        expect(result.valid).to.be.false;
        expect(result.complete).to.be.undefined;
        result = g.validateMove("[From|pY3N B1]");
        expect(result.valid).to.be.false;
        expect(result.complete).to.be.undefined;
        result = g.validateMove("[_void]");
        expect(result.valid).to.be.false;
        expect(result.complete).to.be.undefined;
        result = g.validateMove("[xxxxx]");
        expect(result.valid).to.be.false;
        expect(result.complete).to.be.undefined;
    });
});
