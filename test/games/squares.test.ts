/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import i18next from "i18next";
import {
    BOARD_CELLS,
    RESERVES,
    SquaresGame,
    connectedTo,
    diagonalTo,
    distance,
    type playerid,
} from "../../src/games/squares";

/** Put a unit somewhere (call `commit` afterwards if the position must survive a clone). */
const place = (g: SquaresGame, id: string, loc: string): void => {
    g.unit(id).loc = loc;
};

/** Spread a player's reserve over the given cells, leaving any extra units in the reserve. */
const evacuate = (g: SquaresGame, player: playerid, cells: string[]): void => {
    const pool = [...cells];
    for (const u of g.reserveUnits(player)) {
        const cell = pool.shift();
        if (cell !== undefined) {
            u.loc = cell;
        }
    }
};

const commit = (g: SquaresGame): SquaresGame => {
    g.stack[0] = g.moveState();
    return g;
};

/** A position to play from: the units named stand on the given squares, everything else waits in its reserve. Committed, so clones and previews see it. */
const setup = (units: Record<string, string>): SquaresGame => {
    const g = new SquaresGame();
    for (const [id, loc] of Object.entries(units)) {
        g.unit(id).loc = loc;
    }
    return commit(g);
};

const alive = (g: SquaresGame, id: string): boolean => g.unit(id).loc !== "X";

describe("Squares", () => {
    before(() => {
        addResource("en");
    });

    describe("board geometry", () => {
        it("names thirty cells and two reserves", () => {
            expect(BOARD_CELLS.length).to.equal(30);
            expect(RESERVES[1]).to.equal("GR");
            expect(RESERVES[2]).to.equal("BR");
        });

        it("connects cells that share any length of edge", () => {
            expect(connectedTo("G3R")).to.include.members(["G3C", "G2R", "G2CR", "SEF", "GR"]);
            expect(connectedTo("G3R")).to.not.include("G2CL");
            expect(connectedTo("G2L")).to.include.members(["G3L", "G2CL", "G1L", "SWF", "WF"]);
            expect(connectedTo("G2R")).to.include.members(["G1R", "SEF", "EF"]);
            expect(connectedTo("G1R")).to.include.members(["B1L", "G1CR", "EF", "G2R", "G2CR"]);
            expect(connectedTo("G1R")).to.not.include("B1R");
            expect(connectedTo("SEF")).to.have.members(["G3R", "G2R", "EF", "NEF"]);
            expect(connectedTo("EF")).to.have.members(["SEF", "NEF", "G2R", "G1R", "B1L", "B2L"]);
        });

        it("only has diagonals between the two centre rows", () => {
            expect(diagonalTo("G1R")).to.have.members(["B1CL"]);
            expect(diagonalTo("G1C")).to.have.members(["B1CL", "B1CR"]);
            expect(diagonalTo("B1L")).to.have.members(["G1CR"]);
            for (const cell of BOARD_CELLS) {
                if (diagonalTo(cell).length > 0) {
                    expect(cell.startsWith("B1") || cell.startsWith("G1"), cell).to.be.true;
                }
            }
        });

        it("attaches each reserve to its three back-line squares only", () => {
            expect(connectedTo("GR")).to.have.members(["G3R", "G3C", "G3L"]);
            expect(connectedTo("BR")).to.have.members(["B3L", "B3C", "B3R"]);
            expect(diagonalTo("GR")).to.be.empty;
        });

        it("measures distance from the centre of each square", () => {
            expect(distance("G3C", 1)).to.equal(25);
            expect(distance("G1L", 1)).to.equal(125);
            expect(distance("SEF", 1)).to.equal(100);
            expect(distance("EF", 1)).to.equal(150);
            expect(distance("EF", 2)).to.equal(150);
            expect(distance("NEF", 1)).to.equal(200);
            expect(distance("B3C", 2)).to.equal(25);
            expect(distance("GR", 1)).to.be.lessThan(distance("G3C", 1));
        });
    });

    describe("setup and basic movement", () => {
        it("starts with sixteen units per side in reserve and Gray to move", () => {
            const g = new SquaresGame();
            for (const p of [1, 2] as playerid[]) {
                const reserve = g.reserveUnits(p);
                expect(reserve.length).to.equal(16);
                expect(reserve.filter(u => u.type === "I").length).to.equal(9);
                expect(reserve.filter(u => u.type === "A").length).to.equal(3);
                expect(reserve.filter(u => u.type === "C").length).to.equal(4);
            }
            expect(g.currplayer).to.equal(1);
            const moves = g.moves();
            expect(moves).to.include.members(["pass", "IGR-G3L", "AGR-G3C", "CGR-G3R", "CGR-G3L-G2L", "CGR-G3L,CGR-G3C"]);
            expect(moves.some(m => m.includes(">"))).to.be.false;
            expect(moves.filter(m => m === "IGR-G3L").length).to.equal(1);
        });

        it("moves infantry orthogonally only, one square", () => {
            const g = setup({ "1I1": "G1C" });
            const mine = g.moves().filter(m => m.startsWith("IG1C"));
            expect(mine).to.have.members(["IG1C-G1CL", "IG1C-G1CR", "IG1C-B1C", "IG1C-G2CL", "IG1C-G2CR"]);
            expect(g.validateMove("IG1C-B1CL").valid).to.be.false;
        });

        it("lets cavalry go two squares, diagonally, or one square into a forest", () => {
            const g = setup({ "1C1": "G2L" });
            const mine = g.moves().filter(m => m.startsWith("CG2L"));
            expect(mine).to.include.members(["CG2L-G1L-B1R", "CG2L-G1L-B1CR", "CG2L-WF", "CG2L-G3L-GR", "CG2L-G1L"]);
            expect(mine).to.not.include("CG2L-G1L-B1L");
            expect(mine.some(m => m.startsWith("CG2L-WF-"))).to.be.false;
            expect(g.validateMove("CG2L-G1L-G2L").valid).to.be.false;
        });

        it("lets cavalry pass through its own reserve", () => {
            const g = setup({ "1C1": "G3L" });
            expect(g.moves()).to.include("CG3L-GR-G3R");
            g.move("CG3L-GR-G3R");
            expect(g.unit("1C1").loc).to.equal("G3R");
        });

        it("moves two cavalry in either order, and lets the second use the first's square", () => {
            const g = new SquaresGame();
            expect(g.validateMove("CGR-G3L,CGR-G3C").valid).to.be.true;
            expect(g.validateMove("CGR-G3C,CGR-G3L").valid).to.be.true;
            place(g, "1C1", "G2L");
            place(g, "1C2", "G3L");
            expect(g.validateMove("CG2L-G1L,CG3L-G2L").valid).to.be.true;
            expect(g.validateMove("CG3L-G2L,CG2L-G1L").valid).to.be.false;
            expect(g.validateMove("CG2L-G1L,CG2L-G1CL").valid).to.be.false;
            g.move("CG2L-G1L,CG3L-G2L");
            expect(g.unit("1C1").loc).to.equal("G1L");
            expect(g.unit("1C2").loc).to.equal("G2L");
            expect(g.currplayer).to.equal(2);
        });

        it("keeps infantry and artillery out of forests without a double turn", () => {
            const g = setup({ "1I1": "G2R", "1A1": "G2L" });
            expect(g.validateMove("IG2R-SEF").valid).to.be.false;
            expect(g.validateMove("AG2L-WF").valid).to.be.false;
            expect(g.moves()).to.include("IG2R-G1R");
            g.move("pass");
            g.move("IBR-B3C");
            expect(g.isDouble).to.be.true;
            expect(g.moves()).to.include.members(["IG2R-SEF", "AG2L-WF"]);
            g.move("IG2R-SEF");
            expect(g.unit("1I1").loc).to.equal("SEF");
            // the whole double turn is spent
            expect(g.currplayer).to.equal(2);
            expect(g.unit("1I1").moveStreak).to.equal(2);
        });

        it("lets infantry move diagonally only with a double move", () => {
            const g = setup({ "1I1": "G1C", "2I1": "B1C" });
            expect(g.validateMove("IG1C-B1CL").valid).to.be.false;
            g.move("pass");
            g.move("IBR-B3C");
            expect(g.moves()).to.include("IG1C-B1CL");
            g.move("IG1C-B1CL");
            expect(g.unit("1I1").loc).to.equal("B1CL");
            expect(g.currplayer).to.equal(2);
        });

        it("forbids passing during a double turn and gives it two actions", () => {
            const g = new SquaresGame();
            g.move("pass");
            expect(g.currplayer).to.equal(2);
            g.move("IBR-B3C");
            expect(g.currplayer).to.equal(1);
            expect(g.isDouble).to.be.true;
            expect(g.actionsLeft).to.equal(2);
            expect(g.validateMove("pass").valid).to.be.false;
            g.move("IGR-G3C");
            expect(g.currplayer).to.equal(1);
            expect(g.actionsLeft).to.equal(1);
            g.move("IG3C-G2CL");
            expect(g.currplayer).to.equal(2);
            expect(g.isDouble).to.be.false;
            expect(g.validateMove("pass").valid).to.be.true;
        });

        it("wins by entering an empty enemy reserve", () => {
            const g = new SquaresGame();
            evacuate(g, 2, ["B2L", "B2CL", "B2CR", "B2R", "B1L", "B1CL", "B1C", "B1CR", "B1R", "NEF", "NWF", "EF", "WF", "G2L", "G2R", "G3R"]);
            place(g, "1I1", "B3C");
            expect(g.moves()).to.include("IB3C-BR");
            g.move("IB3C-BR");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });
    });

    describe("consecutive-turn limits and freezes", () => {
        it("stops a unit moving on a third consecutive turn", () => {
            const g = setup({ "1I1": "G3C" });
            g.move("IG3C-G2CL");
            g.move("IBR-B3C");
            g.move("IG2CL-G1C");
            g.move("IB3C-B2CL");
            expect(g.unit("1I1").moveStreak).to.equal(2);
            expect(g.moves().some(m => m.startsWith("IG1C-"))).to.be.false;
            expect(g.validateMove("IG1C-G1CL").valid).to.be.false;
            g.move("IGR-G3L");
            g.move("IBR-B3C");
            expect(g.moves()).to.include("IG1C-G1CL");
        });

        it("follows the rulebook example: a pass resets the count, a double turn counts as two turns", () => {
            const g = setup({ "1C1": "G3C" });
            g.move("CG3C-G2CL");
            g.move("IBR-B3C");
            g.move("pass");
            g.move("IB3C-B2CL");
            g.move("CG2CL-G1C");
            g.move("CG1C-G1CL");
            expect(g.currplayer).to.equal(2);
            g.move("IBR-B3C");
            expect(g.moves().some(m => m.startsWith("CG1CL-"))).to.be.false;
            expect(g.canMove(g.unit("1C1"))).to.be.false;
            expect(g.canAttack(g.unit("1C1"))).to.be.true;
        });

        it("freezes a retreated infantry for its owner's next turn only", () => {
            const g = setup({ "1I1": "G1C", "2I1": "B1C" });
            evacuate(g, 2, ["B2L", "B2CL", "B2CR", "B2R", "B1L", "B1CL", "B1CR", "B1R", "NEF", "NWF", "EF", "WF", "SEF", "SWF", "G2R"]);
            g.move("IG1C>IB1C");
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.have.members(["stand", "retreat:IB1C-BR"]);
            g.move("retreat:IB1C-BR");
            expect(g.unit("2I1").loc).to.equal("BR");
            expect(g.currplayer).to.equal(2);
            expect(g.canMove(g.unit("2I1"))).to.be.false;
            expect(g.moves().some(m => m.startsWith("IBR-"))).to.be.false;
            g.move("CG2R-G3R");
            g.move("IGR-G3L");
            expect(g.canMove(g.unit("2I1"))).to.be.true;
            expect(g.moves()).to.include("IBR-B3C");
        });
    });

    describe("attacks", () => {
        it("eliminates both units when an unsupported attack is met by a stand", () => {
            const g = setup({ "1I1": "G1C", "2I1": "B1C" });
            g.move("IG1C>IB1C");
            g.move("stand");
            expect(alive(g, "1I1")).to.be.false;
            expect(alive(g, "2I1")).to.be.false;
            expect(g.combat).to.be.undefined;
            expect(g.currplayer).to.equal(2);
            expect(g.points(1)).to.equal(1);
            expect(g.points(2)).to.equal(1);
        });

        it("never lets cavalry attack infantry unsupported, and never lets artillery attack anything but artillery", () => {
            const g = setup({ "1C1": "G1R", "1I1": "G1CR", "2I1": "B1L" });
            let moves = g.moves();
            expect(moves).to.not.include("CG1R>IB1L");
            expect(moves).to.include("CG1R+IG1CR>IB1L");
            // G1CR only touches B1L at a corner, so the infantry may support but never attack it
            expect(moves).to.not.include("IG1CR>IB1L");
            // the unsupported attack is a legal step towards the supported one, but cannot be submitted
            expect(g.validateMove("CG1R>IB1L").complete).to.equal(-1);
            expect(() => g.move("CG1R>IB1L")).to.throw();
            let click = g.handleClick("", 2, 5);
            click = g.handleClick(click.move, 2, 4);
            expect(click.move).to.equal("CG1R>IB1L");
            expect(click.complete).to.equal(-1);
            click = g.handleClick(click.move, 2, 6);
            expect(click.move).to.equal("CG1R+IG1CR>IB1L");
            expect(click.complete).to.equal(1);
            place(g, "1I1", "GR");
            expect(g.validateMove("CG1R>IB1L").valid).to.be.false;

            const h = setup({ "1A1": "G1C", "1A2": "G1L", "2A1": "B1C", "2I1": "B1R" });
            moves = h.moves();
            expect(moves).to.include("AG1C>AB1C");
            expect(moves).to.not.include("AG1L>IB1R");
            expect(moves).to.not.include("AG1L+AG1C>IB1R");
        });

        it("pins units next to enemy artillery", () => {
            const g = setup({ "1I1": "G1C", "1I2": "G1CR", "2I1": "B1CL", "2I2": "B1C", "2A1": "B1CR" });
            // G1C touches B1CR only at a corner, so it can neither attack the guns nor anything else
            expect(g.moves().some(m => m.startsWith("IG1C>") || m.startsWith("IG1C+"))).to.be.false;
            expect(g.moves()).to.not.include("IG1CR+IG1C>IB1CL");
            expect(g.moves()).to.include("IG1CR>IB1CL");
            // a unit sharing an edge with the guns may attack them and nothing else
            place(g, "1I3", "G1CL");
            expect(g.moves()).to.include("IG1CL>AB1CR");
            expect(g.moves()).to.not.include("IG1CL>IB1C");
            // artillery in a reserve pins nothing
            place(g, "2A1", "BR");
            expect(g.moves()).to.include("IG1C>IB1C");
            expect(g.moves()).to.include("IG1CR+IG1C>IB1CL");
        });

        it("throws away an unsupported attacker against a forest or against artillery", () => {
            const g = setup({ "1I1": "G1R", "2I1": "EF" });
            g.move("IG1R>IEF");
            expect(alive(g, "1I1")).to.be.false;
            expect(alive(g, "2I1")).to.be.true;
            expect(g.currplayer).to.equal(2);
            g.move("pass");
            place(g, "1I2", "G1C");
            place(g, "2A1", "B1C");
            g.move("IG1C>AB1C");
            expect(alive(g, "1I2")).to.be.false;
            expect(alive(g, "2A1")).to.be.true;
        });

        it("lets unsupported artillery and defending artillery destroy each other", () => {
            const g = setup({ "1A1": "G1C", "2A1": "B1C" });
            g.move("AG1C>AB1C");
            expect(alive(g, "1A1")).to.be.false;
            expect(alive(g, "2A1")).to.be.false;
        });

        it("offers the attacker the rulebook options when a supported attack is stood", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            g.move("IG1C+CG1CL>IB1C");
            expect(g.currplayer).to.equal(2);
            g.move("stand");
            expect(g.currplayer).to.equal(1);
            expect(g.combat!.stage).to.equal("resolve");
            expect(g.moves()).to.have.members(["option1:CG1CL-G2CL", "option2/advance", "option2/stay", "option3", "option4", "option5:CG1CL-G2CL"]);
            // the advance is the attacker's decision too, so it belongs to the same ply; left unsaid, the attacker stays put
            expect(g.validateMove("option2").complete).to.equal(0);
            const stays = g.clone();
            stays.move("option2");
            expect(stays.unit("1I1").loc).to.equal("G1C");
            expect(stays.combat).to.be.undefined;
            expect(stays.currplayer).to.equal(2);
            g.move("option2/advance");
            expect(alive(g, "2I1")).to.be.false;
            expect(alive(g, "1C1")).to.be.false;
            expect(g.combat).to.be.undefined;
            expect(g.unit("1I1").loc).to.equal("B1C");
            expect(g.currplayer).to.equal(2);
        });

        it("denies attacking cavalry the retreat options", () => {
            const g = setup({ "1C1": "G1C", "1I1": "G1CL", "2I1": "B1C" });
            g.move("CG1C+IG1CL>IB1C");
            g.move("stand");
            expect(g.moves()).to.have.members(["option2/advance", "option2/stay", "option3", "option5"]);
            g.move("option5");
            expect(g.unit("1I1").loc).to.equal("GR");
            expect(alive(g, "2I1")).to.be.true;
            expect(g.combat).to.be.undefined;
        });

        it("gives the defender a second chance when supporting artillery withdraws under option 1", () => {
            const g = setup({ "1I1": "G1C", "1A1": "G1CL", "2I1": "B1C" });
            g.move("IG1C+AG1CL>IB1C");
            g.move("stand");
            expect(g.moves()).to.include("option1");
            g.move("option1");
            expect(g.unit("1A1").loc).to.equal("GR");
            expect(g.combat!.stage).to.equal("second");
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.have.members(["stand", "retreat:IB1C-BR"]);
            g.move("retreat:IB1C-BR");
            expect(alive(g, "2I1")).to.be.true;
            expect(g.combat!.stage).to.equal("advance");
            g.move("stay");
            expect(g.unit("1I1").loc).to.equal("G1C");
            expect(g.currplayer).to.equal(2);
        });

        it("eliminates a defender that stands again after the second chance, and retreats the attacker", () => {
            const g = setup({ "1I1": "G1C", "1A1": "G1CL", "2I1": "B1C" });
            g.move("IG1C+AG1CL>IB1C");
            g.move("stand");
            g.move("option1");
            g.move("stand");
            expect(alive(g, "2I1")).to.be.false;
            expect(g.unit("1I1").loc).to.equal("GR");
            expect(g.combat).to.be.undefined;
        });

        it("resolves a flank attack: forced retreat, or elimination at no cost", () => {
            const g = setup({ "1C1": "B3C", "1I1": "B1C", "2I1": "B2CL" });
            // the retreat is forced and unique, so it happens at once; advancing is decided in the same ply, staying put by default
            expect(g.validateMove("CB3C+IB1C>IB2CL").complete).to.equal(0);
            expect(g.moves()).to.include.members(["CB3C+IB1C>IB2CL/advance", "CB3C+IB1C>IB2CL/stay"]);
            const stays = g.clone();
            stays.move("CB3C+IB1C>IB2CL");
            expect(stays.unit("2I1").loc).to.equal("BR");
            expect(stays.unit("1C1").loc).to.equal("B3C");
            expect(stays.currplayer).to.equal(2);
            g.move("CB3C+IB1C>IB2CL/advance");
            expect(g.unit("2I1").loc).to.equal("BR");
            expect(g.combat).to.be.undefined;
            expect(g.unit("1C1").loc).to.equal("B2CL");
            expect(g.currplayer).to.equal(2);

            const h = setup({ "1C1": "B3C", "1I1": "B1C", "1I2": "B3L", "2I1": "B2CL" });
            h.move("CB3C+IB1C>IB2CL/stay");
            expect(alive(h, "2I1")).to.be.false;
            expect(alive(h, "1C1")).to.be.true;
            expect(alive(h, "1I1")).to.be.true;
            expect(h.combat).to.be.undefined;
            expect(h.unit("1C1").loc).to.equal("B3C");
        });

        it("answers the rulebook FAQ: flanked artillery outside a forest simply dies", () => {
            const g = new SquaresGame();
            g.move("pass");
            place(g, "1A1", "G1L");
            place(g, "2C1", "G2L");
            place(g, "2C2", "G1CL");
            g.move("CG2L+CG1CL>AG1L/advance");
            expect(alive(g, "1A1")).to.be.false;
            expect(alive(g, "2C1")).to.be.true;
            expect(alive(g, "2C2")).to.be.true;
            expect(g.combat).to.be.undefined;
            expect(g.unit("2C1").loc).to.equal("G1L");
        });
    });

    describe("retreats", () => {
        it("makes attacked cavalry retreat, displacing friends when nothing is vacant", () => {
            const g = setup({ "1C1": "G1C", "1I1": "G1CL", "2C1": "B1C", "2I1": "B2CL", "2I2": "B2CR" });
            g.move("CG1C+IG1CL>CB1C");
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.have.members(["retreat:CB1C-B2CL,IB2CL-BR", "retreat:CB1C-B2CR,IB2CR-BR"]);
            g.move("retreat:CB1C-B2CL,IB2CL-BR");
            expect(g.unit("2C1").loc).to.equal("B2CL");
            expect(g.unit("2I1").loc).to.equal("BR");
            expect(g.canMove(g.unit("2I1"))).to.be.false;
            expect(g.canMove(g.unit("2C1"))).to.be.true;
            expect(g.combat!.stage).to.equal("advance");
        });

        it("lets cavalry stand against unsupported cavalry, in a forest, or when it cannot retreat", () => {
            const g = setup({ "1C1": "G1C", "2C1": "B1C" });
            g.move("CG1C>CB1C");
            expect(g.moves()).to.include("stand");
            expect(g.moves()).to.include("retreat:CB1C-B2CL");

            const h = setup({
                "1C1": "G1C",
                "1I1": "G1CL",
                "2C1": "B1C",
                "2A1": "B2CL",
                "2A2": "B2CR",
                "1I2": "B3L",
                "1I3": "B3C",
                "1I4": "B3R",
            });
            // both squares behind are friendly artillery with no clear path, so the cavalry must stand
            expect(h.validateMove("CG1C+IG1CL>CB1C").complete).to.equal(-1);
            expect(h.moves()).to.include.members(["CG1C+IG1CL>CB1C/option3", "CG1C+IG1CL>CB1C/option2/advance"]);
            h.move("CG1C+IG1CL>CB1C/option3");
            expect(alive(h, "2C1")).to.be.false;
            expect(alive(h, "1C1")).to.be.false;
            expect(h.currplayer).to.equal(2);
        });

        it("lets infantry attacked in a forest fall back into a closer forest", () => {
            const g = setup({ "1I1": "G1R", "1C1": "G2R", "2I1": "EF" });
            g.move("IG1R+CG2R>IEF");
            expect(g.moves()).to.have.members(["stand", "retreat:IEF-BR", "retreat:IEF-NEF"]);
            g.move("retreat:IEF-NEF");
            expect(g.unit("2I1").loc).to.equal("NEF");
        });

        it("blocks a clear path with enemy units but not with friendly ones", () => {
            const g = setup({ "2I1": "B1CL", "2I2": "B2CL" });
            expect(g.hasClearPath(g.unit("2I1"))).to.be.true;
            place(g, "1I1", "B3L");
            place(g, "1I2", "B3C");
            expect(g.hasClearPath(g.unit("2I1"))).to.be.false;
            place(g, "1I2", "X");
            expect(g.hasClearPath(g.unit("2I1"))).to.be.true;
            place(g, "1I3", "B2CL");
            place(g, "2I2", "BR");
            expect(g.hasClearPath(g.unit("2I1"))).to.be.false;
        });
    });

    describe("reserves and winning", () => {
        it("lets the reserve's owner choose which unit type is lost", () => {
            const g = setup({ "1I1": "B3C" });
            g.move("IB3C>BR");
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.have.members(["lose:I", "lose:A", "lose:C"]);
            g.move("lose:A");
            expect(g.reserveUnits(2).filter(u => u.type === "A").length).to.equal(2);
            expect(alive(g, "1I1")).to.be.true;
            expect(g.combat).to.be.undefined;
            expect(g.currplayer).to.equal(2);
        });

        it("lets a supported attack that empties the reserve advance into it and win", () => {
            const g = new SquaresGame();
            evacuate(g, 2, ["B2L", "B2CL", "B2CR", "B2R", "B1L", "B1CL", "B1C", "B1CR", "B1R", "G2L", "G2R", "G3R", "NEF", "NWF", "EF"]);
            expect(g.reserveUnits(2).length).to.equal(1);
            place(g, "1I1", "B3C");
            place(g, "1I2", "B3L");
            expect(g.moves()).to.include.members(["IB3C+IB3L>BR/advance", "IB3C+IB3L>BR/stay"]);
            g.move("IB3C+IB3L>BR/advance");
            expect(g.reserveUnits(2).length).to.equal(0);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });

        it("scores artillery double and cavalry double once three are lost, per the rulebook example", () => {
            const g = new SquaresGame();
            g.move("pass");
            // Gray has lost 1 artillery, 2 cavalry and 4 infantry; Blue 1 artillery, 2 cavalry and 5 infantry.
            for (const id of ["1A1", "1C1", "1C2", "1I1", "1I2", "1I3", "1I4"]) {
                place(g, id, "X");
            }
            for (const id of ["2A1", "2C1", "2C2", "2I1", "2I2", "2I3", "2I4", "2I5"]) {
                place(g, id, "X");
            }
            expect(g.points(2)).to.equal(8);
            expect(g.points(1)).to.equal(9);
            place(g, "1C4", "G1C");
            place(g, "2I6", "B1C");
            place(g, "2A2", "B1CL");
            place(g, "2I7", "G2CL");
            place(g, "2I8", "G2CR");
            expect(g.validateMove("IB1C+AB1CL>CG1C").complete).to.equal(-1);
            expect(g.validateMove("IB1C+AB1CL>CG1C/option2").complete).to.equal(0);
            expect(g.validateMove("IB1C+AB1CL>CG1C/option2/stay").complete).to.equal(0);
            g.move("IB1C+AB1CL>CG1C/option2/stay");
            expect(g.points(2)).to.equal(12);
            expect(g.points(1)).to.equal(11);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("draws when both reach ten with the same totals and unit counts", () => {
            const g = new SquaresGame();
            for (let i = 1; i <= 9; i++) {
                place(g, `1I${i}`, "X");
                place(g, `2I${i}`, "X");
            }
            place(g, "1C1", "G1C");
            place(g, "2C1", "B1C");
            g.move("CG1C>CB1C");
            g.move("stand");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1, 2]);
        });

        it("loses a player who cannot complete a double turn", () => {
            const g = setup({ "2I1": "G3R", "2I2": "G3C", "2I3": "G3L" });
            expect(g.moves()).to.deep.equal(["pass"]);
            g.move("pass");
            g.move("IBR-B3C");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });
    });

    describe("plumbing", () => {
        it("lists only moves that validate and apply, and validates every listed move", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "1A1": "G2CL", "1C2": "G3L", "2I1": "B1C", "2C1": "B1CR", "2A1": "B2CR" });
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(20);
            for (const m of moves) {
                const result = g.validateMove(m);
                expect(result.valid, m).to.be.true;
                expect(result.complete, m).to.not.equal(-1);
                const clone = g.clone();
                clone.move(m);
            }
            expect(new Set(moves).size).to.equal(moves.length);
        });

        it("survives serialisation with a combat pending", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            g.move("IG1C+CG1CL>IB1C");
            const clone = g.clone();
            expect(clone.currplayer).to.equal(2);
            expect(clone.combat).to.deep.equal(g.combat);
            expect(clone.moves()).to.have.members(g.moves());
            clone.move("stand");
            expect(clone.currplayer).to.equal(1);
            expect(clone.moves()).to.include("option2/advance");
        });

        it("closes an export round whenever the round's opener acts again", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            g.move("IG1C+CG1CL>IB1C");
            g.move("retreat:IB1C-BR");
            g.move("advance");
            g.move("IBR-B3C");
            g.move("pass");
            g.move("IB3C-B2CL");
            g.move("IGR-G3C");
            g.move("IG3C-G2CL");
            const plies = g.getPlies();
            expect(plies.map(p => p.actor)).to.deep.equal([1, 2, 1, 2, 1, 2, 1, 1]);
            expect(plies.map(p => p.round)).to.deep.equal([0, 0, 1, 1, 2, 2, 3, 4]);
        });

        it("builds moves from clicks", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            let click = g.handleClick("", 2, 7);
            expect(click.move).to.equal("IG1C");
            click = g.handleClick(click.move, 2, 2);
            expect(click.move).to.equal("IG1C>IB1C");
            expect(click.complete).to.equal(0);
            click = g.handleClick(click.move, 2, 8);
            expect(click.move).to.equal("IG1C+CG1CL>IB1C");
            expect(click.complete).to.equal(1);
            click = g.handleClick("", -1, -1, "GC");
            expect(click.move).to.equal("CGR");
            click = g.handleClick(click.move, 0, 7);
            expect(click.move).to.equal("CGR-G3L");
            expect(click.complete).to.equal(0);
            click = g.handleClick(click.move, 1, 8);
            expect(click.move).to.equal("CGR-G3L-G2L");
            expect(click.complete).to.equal(1);
            // clicking the square the cavalry was just shown on leaves the move as it is
            click = g.handleClick("CGR-G3L", 0, 7);
            expect(click.move).to.equal("CGR-G3L");
            expect(click.valid).to.be.true;
            expect(click.complete).to.equal(0);
            // a square two steps away can be clicked directly; the engine supplies the path
            click = g.handleClick("CGR", 1, 8);
            expect(click.move).to.equal("CGR-G3L-G2L");
            expect(click.complete).to.equal(1);
            place(g, "1C1", "G1CR");
            click = g.handleClick("CG1CR", 1, 6);
            expect(click.move).to.equal("CG1CR-G2CR");
            expect(click.complete).to.equal(0);
            click = g.handleClick("CG1CR", 1, 7);
            expect(click.move).to.match(/^CG1CR-[A-Z0-9]+-G2CL$/);
            expect(click.complete).to.equal(1);
        });

        it("builds retreat chains and reserve losses from clicks", () => {
            const g = setup({ "1C1": "G1C", "1I1": "G1CL", "2C1": "B1C", "2I1": "B2CL", "2I2": "B2CR" });
            g.move("CG1C+IG1CL>CB1C");
            let click = g.handleClick("", 1, 2);
            expect(click.move).to.equal("retreat:CB1C-B2CL");
            expect(click.complete).to.equal(-1);
            click = g.handleClick(click.move, -1, -1, "_reserves_N");
            expect(click.move).to.equal("retreat:CB1C-B2CL,IB2CL-BR");
            expect(click.complete).to.equal(1);
            // a piece framed as just arrived, or faded as about to be lost, is still the piece it shows
            const f = setup({ "1I1": "G1C", "2I1": "B1C" });
            ["B2L", "B2CL", "B2CR", "B2R", "B1L", "B1CL", "B1CR", "B1R"].forEach((cell, i) => place(f, `2I${i + 2}`, cell));
            f.move("IG1C>IB1C");
            f.move("retreat:IB1C-BR");
            expect(f.currplayer).to.equal(2);
            expect((f.render().areas![1] as { pieces: string[] }).pieces.filter(k => k === "BIe").length).to.equal(1);
            click = f.handleClick("", -1, -1, "BIe");
            expect(click.valid).to.be.false;
            expect(click.message).to.contain("retreated and may not move");
            click = f.handleClick("", -1, -1, "BCx");
            expect(click.move).to.equal("CBR");

            const h = setup({ "1I1": "B3C" });
            h.move("IB3C>BR");
            click = h.handleClick("", -1, -1, "BA");
            expect(click.move).to.equal("lose:A");
            expect(click.complete).to.equal(1);
        });

        it("renders the dvgc board with both reserves, each player's side at the bottom and Gray's view the default", () => {
            const g = setup({ "1I1": "G1C", "2C1": "B1C" });
            const rep = g.render({ perspective: 1 });
            expect(rep.board).to.deep.equal({ style: "dvgc" });
            expect(rep.pieces).to.equal("-,-,-,-,-,-,-,-,-,-\n-,-,-,-,-,-,-,-,-,-\n-,-,BC,-,-,-,-,GI,-,-");
            expect(Object.keys(rep.legend!)).to.have.members(["GI", "GA", "GC", "BI", "BA", "BC"]);
            expect(rep.areas!.length).to.equal(2);
            const south = rep.areas![0] as { side: string; pieces: string[] };
            expect(south.side).to.equal("S");
            expect(south.pieces.length).to.equal(15);
            expect(south.pieces.every(k => k.startsWith("G"))).to.be.true;
            expect(g.render({ perspective: 2 }).board).to.deep.equal({ style: "dvgc", rotate: 180 });
            expect(g.render().board).to.deep.equal({ style: "dvgc" });
            expect(g.getCustomRotation()).to.equal(180);
        });

        it("writes a move log that matches the legacy formatter", () => {
            const g = setup({ "1I1": "G1C", "1A1": "G1CL", "2I1": "B1C", "2C1": "B1L" });
            g.move("IG1C+AG1CL>IB1C");
            g.move("stand");
            g.move("option1");
            g.move("retreat:IB1C-BR");
            g.move("advance");
            g.move("CB1L-B2L");
            g.move("pass");
            const names = ["Alice", "Bob"];
            assertChatLogParity(g, names);
            const text = g.chatLog(names).flat().join("\n");
            expect(text).to.contain("Alice's infantry at G1C attacked B1C.");
            expect(text).to.contain("supported by artillery at G1CL");
            expect(text).to.contain("Bob's unit at B1C stands its ground.");
            expect(text).to.contain("Alice's artillery retreated from G1CL to GR.");
            expect(text).to.contain("Bob's infantry retreated from B1C to BR.");
            expect(text).to.contain("Alice's infantry advanced from G1C into B1C.");
            expect(text).to.contain("Bob moved cavalry from B1L to B2L.");
            expect(text).to.contain("Alice passed and will take a double turn next.");
        });
    });

    describe("interface helpers", () => {
        it("adds a second cavalry from the reserve by clicking the strip again", () => {
            const g = new SquaresGame();
            let click = g.handleClick("", -1, -1, "GC");
            click = g.handleClick(click.move, 0, 7);
            expect(click.move).to.equal("CGR-G3L");
            click = g.handleClick(click.move, -1, -1, "GC");
            expect(click.move).to.equal("CGR-G3L,CGR");
            expect(click.complete).to.equal(-1);
            click = g.handleClick(click.move, 0, 6);
            expect(click.move).to.equal("CGR-G3L,CGR-G3C");
            expect(click.complete).to.equal(1);
        });

        it("labels every button with a key that has English text", () => {
            const labels = new Set<string>();
            const collect = (g: SquaresGame): void => g.getButtons().forEach(b => labels.add(b.label));
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            collect(g);
            g.move("IG1C+CG1CL>IB1C");
            collect(g);
            g.move("stand");
            collect(g);
            const advance = g.clone();
            advance.move("option2", { partial: true });
            collect(advance);
            const forest = setup({ "1I1": "G1R", "1C1": "G2R", "2I1": "EF" });
            forest.move("IG1R+CG2R>IEF");
            collect(forest);
            const reserve = setup({ "1I1": "B3C" });
            reserve.move("IB3C>BR");
            collect(reserve);
            const keys = ["pass", "stand", "retreatReserve", "retreat", "option1", "option2", "option3", "option4", "option5", "advance", "stay", "loseI", "loseA", "loseC"];
            expect([...labels]).to.have.members(keys.map(k => k === "pass" ? "apgames:buttons.pass" : `apgames:buttons.squares.${k}`));
            for (const label of labels) {
                expect(i18next.exists(label), label).to.be.true;
            }
        });

        it("offers buttons for every combat decision and finishes option prefixes by clicking", () => {
            const g = new SquaresGame();
            expect(g.getButtons()).to.deep.equal([{ label: "apgames:buttons.pass", move: "pass" }]);
            place(g, "1I1", "G1C");
            place(g, "1C1", "G1CL");
            place(g, "2I1", "B1C");
            g.move("IG1C+CG1CL>IB1C");
            expect(g.getButtons().map(b => [b.label, b.move])).to.deep.equal([["apgames:buttons.squares.stand", "stand"], ["apgames:buttons.squares.retreatReserve", "retreat:IB1C-BR"]]);
            g.move("stand");
            const buttons = g.getButtons();
            expect(buttons.map(b => b.label)).to.deep.equal(["apgames:buttons.squares.option1", "apgames:buttons.squares.option2", "apgames:buttons.squares.option3", "apgames:buttons.squares.option4", "apgames:buttons.squares.option5"]);
            expect(buttons[0].move).to.equal("option1:CG1CL-G2CL");
            expect(buttons[4].move).to.equal("option5:CG1CL-G2CL");
            expect(g.validateMove("option1").complete).to.equal(-1);
            expect(g.validateMove("option5:").complete).to.equal(-1);
            const click = g.handleClick("option1", 1, 7);
            expect(click.move).to.equal("option1:CG1CL-G2CL");
            expect(click.complete).to.equal(1);
            // option 2 leaves the advance to decide (staying put unless told otherwise); the previewed position offers it as buttons
            expect(g.validateMove("option2").complete).to.equal(0);
            const preview = g.clone();
            preview.move("option2", { partial: true });
            expect(preview.getButtons().map(b => [b.label, b.move])).to.deep.equal([["apgames:buttons.squares.advance", "option2/advance"], ["apgames:buttons.squares.stay", "option2/stay"]]);
            expect(g.validateMove("option2/stay").complete).to.equal(0);
            const done = g.clone();
            done.move("option2/stay", { partial: true });
            expect(done.getButtons()).to.deep.equal([]);
            g.move("option2/stay");
            expect(g.getButtons()).to.deep.equal([{ label: "apgames:buttons.pass", move: "pass" }]);
            const h = setup({ "1I1": "B3C" });
            h.move("IB3C>BR");
            expect(h.getButtons().map(b => [b.label, b.move])).to.deep.equal([["apgames:buttons.squares.loseI", "lose:I"], ["apgames:buttons.squares.loseA", "lose:A"], ["apgames:buttons.squares.loseC", "lose:C"]]);
            expect(h.validateMove("lose:").complete).to.equal(-1);
            h.move("pass".slice(0, 0) + "lose:C");
            expect(h.getButtons()).to.deep.equal([{ label: "apgames:buttons.pass", move: "pass" }]);
        });

        it("folds the attacker's own decisions into the attack's ply, entered by clicks or buttons", () => {
            const g = setup({ "1I1": "G1C", "1A1": "G1CL", "2A1": "B1C" });
            // the artillery must stand, so the attack alone is not a whole ply
            expect(g.validateMove("IG1C+AG1CL>AB1C").complete).to.equal(-1);
            expect(g.moves().filter(m => m.startsWith("IG1C+AG1CL>AB1C"))).to.have.members([
                "IG1C+AG1CL>AB1C/option1", "IG1C+AG1CL>AB1C/option2/advance", "IG1C+AG1CL>AB1C/option2/stay",
                "IG1C+AG1CL>AB1C/option3", "IG1C+AG1CL>AB1C/option4", "IG1C+AG1CL>AB1C/option5",
            ]);
            // clicking the defender marks it for elimination; the next click says how the attack ends
            let click = g.handleClick("IG1C+AG1CL>AB1C", 2, 2);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option");
            expect(click.complete).to.equal(-1);
            expect(click.message).to.contain("will be eliminated");
            const marked = g.clone();
            marked.move(click.move, { partial: true });
            expect(marked.render().pieces!.split("\n")[2].split(",")[2]).to.equal("BAx");
            expect(marked.render().annotations).to.deep.include({ type: "exit", targets: [{ row: 2, col: 2 }] });
            // the defender again: option 1
            click = g.handleClick(click.move, 2, 2);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option1");
            expect(click.complete).to.equal(0);
            expect(click.message).to.contain("Option 1");
            // the support after the defender: option 2, which leaves the advance to decide
            click = g.handleClick("IG1C+AG1CL>AB1C/option", 2, 8);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option2");
            expect(click.complete).to.equal(0);
            expect(click.message).to.contain("click it to advance");
            click = g.handleClick(click.move, 2, 2);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option2/advance");
            expect(click.complete).to.equal(0);
            click = g.handleClick(click.move, 2, 7);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option2/stay");
            // the attacker after the defender: option 3
            click = g.handleClick("IG1C+AG1CL>AB1C/option", 2, 7);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option3");
            expect(click.complete).to.equal(0);
            // the attacker or the support straight away: options 4 and 5
            click = g.handleClick("IG1C+AG1CL>AB1C", 2, 7);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option4");
            click = g.handleClick("IG1C+AG1CL>AB1C", 2, 8);
            expect(click.move).to.equal("IG1C+AG1CL>AB1C/option5");
            expect(click.complete).to.equal(0);
            // any other square starts the decision again
            expect(g.handleClick("IG1C+AG1CL>AB1C/option3", 0, 0).move).to.equal("IG1C+AG1CL>AB1C");
            expect(g.handleClick("IG1C+AG1CL>AB1C/option2/advance", 1, 1).move).to.equal("IG1C+AG1CL>AB1C");
            expect(g.handleClick("IG1C+AG1CL>AB1C/option", 1, 1).move).to.equal("IG1C+AG1CL>AB1C");
            expect(g.handleClick("IG1C+AG1CL>AB1C", 0, 0).move).to.equal("IG1C+AG1CL>AB1C");
            // the previewed position offers the pending decisions as buttons that continue the ply
            const preview = g.clone();
            preview.move("IG1C+AG1CL>AB1C", { partial: true });
            expect(preview.getButtons().map(b => b.move)).to.deep.equal([1, 2, 3, 4, 5].map(n => `IG1C+AG1CL>AB1C/option${n}`));
            const advance = g.clone();
            advance.move("IG1C+AG1CL>AB1C/option2", { partial: true });
            expect(advance.getButtons().map(b => [b.label, b.move])).to.deep.equal([["apgames:buttons.squares.advance", "IG1C+AG1CL>AB1C/option2/advance"], ["apgames:buttons.squares.stay", "IG1C+AG1CL>AB1C/option2/stay"]]);
            expect(advance.render().annotations).to.deep.include({ type: "exit", targets: [{ row: 2, col: 2 }] });
            // decisions in the wrong place are refused with a reason
            expect(g.validateMove("IG1C/option2").message).to.contain("too early");
            expect(g.validateMove("IG1C-G2CL/advance").message).to.contain("not needed");
            expect(g.validateMove("IG1C+AG1CL>AB1C/option1/advance").message).to.contain("not needed");
            expect(g.validateMove("IG1C+AG1CL>AB1C/stand").valid).to.be.false;
            // a ply completed with the advance undecided stays put
            const stays = g.clone();
            stays.move("IG1C+AG1CL>AB1C/option2");
            expect(stays.unit("1I1").loc).to.equal("G1C");
            expect(alive(stays, "2A1")).to.be.false;
            expect(stays.currplayer).to.equal(2);
            // the whole thing is one ply, by the attacker
            g.move("IG1C+AG1CL>AB1C/option2/advance");
            expect(g.unit("1I1").loc).to.equal("B1C");
            expect(alive(g, "1A1")).to.be.false;
            expect(alive(g, "2A1")).to.be.false;
            expect(g.stack.length).to.equal(2);
            expect(g.getPlies().map(p => [p.actor, p.move])).to.deep.equal([[1, "IG1C+AG1CL>AB1C/option2/advance"]]);
            expect(g.currplayer).to.equal(2);
        });

        it("lets a cavalry support's retreat square be clicked after stepping to option 1 or 5", () => {
            const g = setup({ "1I1": "G1CL", "1C1": "G1C", "2A1": "B1CR" });
            expect(g.moves().filter(m => m.startsWith("IG1CL+CG1C>AB1CR/option5"))).to.have.members(["IG1CL+CG1C>AB1CR/option5:CG1C-G2CR", "IG1CL+CG1C>AB1CR/option5:CG1C-G2CL"]);
            // the support straight away: option 5, then its square
            let click = g.handleClick("IG1CL+CG1C>AB1CR", 2, 7);
            expect(click.move).to.equal("IG1CL+CG1C>AB1CR/option5:");
            expect(click.complete).to.equal(-1);
            click = g.handleClick(click.move, 1, 6);
            expect(click.move).to.equal("IG1CL+CG1C>AB1CR/option5:CG1C-G2CR");
            expect(click.complete).to.equal(0);
            // the defender twice: option 1, then the square
            click = g.handleClick("IG1CL+CG1C>AB1CR", 2, 1);
            expect(click.move).to.equal("IG1CL+CG1C>AB1CR/option");
            click = g.handleClick(click.move, 2, 1);
            expect(click.move).to.equal("IG1CL+CG1C>AB1CR/option1:");
            expect(click.complete).to.equal(-1);
            click = g.handleClick(click.move, 1, 7);
            expect(click.move).to.equal("IG1CL+CG1C>AB1CR/option1:CG1C-G2CL");
            expect(click.complete).to.equal(0);
            // a square that is no retreat square starts the decision again; a bad one nearby is explained
            expect(g.handleClick("IG1CL+CG1C>AB1CR/option5:", 0, 0).move).to.equal("IG1CL+CG1C>AB1CR");
            expect(g.handleClick("IG1CL+CG1C>AB1CR/option5:", 2, 6).valid).to.be.false;
            const preview = g.clone();
            preview.move("IG1CL+CG1C>AB1CR/option5:CG1C-G2CL", { partial: true });
            expect(preview.render().annotations).to.deep.include({ type: "move", targets: [{ row: 2, col: 7 }, { row: 1, col: 7 }], style: "dashed" });
            g.move("IG1CL+CG1C>AB1CR/option5:CG1C-G2CL");
            expect(g.unit("1C1").loc).to.equal("G2CL");
            expect(alive(g, "2A1")).to.be.true;
            expect(g.currplayer).to.equal(2);
        });

        it("adds the advance to a ply whose defender was swept aside, by clicking the target or the attacker", () => {
            const g = setup({ "1C1": "B3C", "1I1": "B1C", "2I1": "B2CL" });
            expect(g.validateMove("CB3C+IB1C>IB2CL").complete).to.equal(0);
            let click = g.handleClick("CB3C+IB1C>IB2CL", 1, 2);
            expect(click.move).to.equal("CB3C+IB1C>IB2CL/advance");
            expect(click.complete).to.equal(0);
            click = g.handleClick(click.move, 0, 1);
            expect(click.move).to.equal("CB3C+IB1C>IB2CL/stay");
            // there is no option to choose here, so any other square just starts again
            expect(g.handleClick(click.move, 2, 2).move).to.equal("CB3C+IB1C>IB2CL");
            const preview = g.clone();
            preview.move("CB3C+IB1C>IB2CL", { partial: true });
            expect(preview.getButtons().map(b => b.move)).to.deep.equal(["CB3C+IB1C>IB2CL/advance", "CB3C+IB1C>IB2CL/stay"]);
            expect(preview.render().annotations).to.deep.include({ type: "exit", targets: [{ row: 1, col: 2 }] });
        });

        it("explains why a retreat square is not allowed", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            g.move("IG1C+CG1CL>IB1C");
            expect(g.validateMove("retreat:IB1C-B2CL").message).to.contain("retreat to their reserve");
            expect(g.validateMove("retreat:IB1C-WF").message).to.contain("attacked while in a forest");
            // lone cavalry attacking cavalry: the defender may stand or take the one vacant square
            const h = setup({ "1C1": "G1C", "2C1": "B1C", "2I1": "B2CL" });
            h.move("CG1C>CB1C");
            expect(h.moves()).to.have.members(["stand", "retreat:CB1C-B2CR"]);
            expect(h.validateMove("retreat:CB1C-B2CL,IB2CL-BR").message).to.contain("vacant");
            expect(h.validateMove("retreat:CB1C-G1CR").message).to.contain("not closer");
            expect(h.validateMove("retreat:CB1C-B3C").message).to.contain("touching");
            expect(h.validateMove("retreat:CB1C-B2CR").valid).to.be.true;
            // supported attack with two vacant squares behind: the cavalry must retreat
            const k = setup({ "1C1": "G1C", "1I1": "G1CL", "2C1": "B1C" });
            k.move("CG1C+IG1CL>CB1C");
            expect(k.moves()).to.have.members(["retreat:CB1C-B2CL", "retreat:CB1C-B2CR"]);
            expect(k.validateMove("stand").message).to.contain("must retreat");
        });

        it("previews selections, attacks and reserve-bound retreats", () => {
            const g = setup({ "1I1": "G1C", "1C1": "G1CL", "2I1": "B1C" });
            expect(g.validateMove("IG1C").canrender).to.be.true;
            const sel = g.clone();
            sel.move("IG1C", { partial: true });
            expect(sel.render().annotations).to.deep.include({ type: "enter", targets: [{ row: 2, col: 7 }] });
            const atk = g.clone();
            atk.move("IG1C>IB1C", { partial: true });
            expect(atk.render().annotations).to.deep.include({ type: "move", targets: [{ row: 2, col: 7 }, { row: 2, col: 2 }], style: "solid" });
            const sup = g.clone();
            sup.move("IG1C+CG1CL>IB1C", { partial: true });
            expect(sup.render().annotations).to.deep.include({ type: "move", targets: [{ row: 2, col: 8 }, { row: 2, col: 2 }], style: "dashed" });
            const r = g.clone();
            r.move("IG1C>IB1C");
            r.move("retreat:IB1C-BR");
            const rep = r.render({ perspective: 2 });
            expect(rep.board).to.deep.equal({ style: "dvgc", rotate: 180, markers: [{ type: "edge", edge: "N", colour: r.getPlayerColour(2) }] });
            expect(rep.annotations).to.deep.include({ type: "exit", targets: [{ row: 2, col: 2 }] });
            expect(rep.annotations!.some(a => a.type === "move")).to.be.false;
            // the unit that came home is framed in its strip
            const strip = rep.areas![1] as { pieces: string[] };
            expect(strip.pieces.filter(k => k === "BIe").length).to.equal(1);
            expect(strip.pieces.length).to.equal(16);
            expect(rep.legend!.BIe).to.be.an("array");
            expect(JSON.stringify(rep.annotations)).to.not.contain("#c00");
            const out = new SquaresGame();
            out.move("IGR-G3C");
            expect(out.render().board).to.deep.equal({ style: "dvgc", markers: [{ type: "edge", edge: "S", colour: out.getPlayerColour(1) }] });
            expect(out.render().annotations).to.deep.include({ type: "enter", targets: [{ row: 0, col: 6 }] });
        });

        it("paints every legend glyph through its slots rather than the deprecated colour field", () => {
            const g = setup({ "1I1": "G1R", "1C1": "G2R", "2I1": "EF" });
            const preview = g.clone();
            preview.move("IG1R>IEF", { partial: true });
            const played = g.clone();
            played.move("IG1R+CG2R>IEF");
            played.move("retreat:IEF-BR");
            const parts = [g, preview, played].flatMap(game => Object.values(game.render().legend!).flat()) as { colour?: unknown; paint?: unknown }[];
            expect(parts.length).to.be.greaterThan(6);
            expect(parts.every(part => part.colour === undefined && part.paint !== undefined)).to.be.true;
        });

        it("fades a unit that the move being entered would lose, instead of removing it", () => {
            const g = setup({ "1I1": "G1R", "1C1": "G2R", "2I1": "EF" });
            // an unsupported attack on a forest costs the attacker, so the preview shows it going
            expect(g.validateMove("IG1R>IEF").complete).to.equal(0);
            const preview = g.clone();
            preview.move("IG1R>IEF", { partial: true });
            const rep = preview.render();
            expect(rep.legend!.GIx).to.deep.equal({ name: "nato-infantry", paint: { fill: g.getPlayerColour(1) }, opacity: 0.5 });
            expect(rep.pieces!.split("\n")[2].split(",")[5]).to.equal("GIx");
            expect(rep.annotations).to.deep.include({ type: "exit", targets: [{ row: 2, col: 5 }] });
            // with support added, the attacker is back in full
            const supported = g.clone();
            supported.move("IG1R+CG2R>IEF", { partial: true });
            expect(supported.render().pieces).to.not.contain("GIx");
            // played for real, it is gone
            g.move("IG1R>IEF");
            expect(g.render().pieces).to.not.contain("GIx");
            expect(g.render().legend).to.not.have.property("GIx");
            // a forced loss from the reserve fades in the strip
            const h = new SquaresGame();
            evacuate(h, 2, ["B2L", "B2CL", "B2CR", "B2R", "B1L", "B1CL", "B1C", "B1CR", "B1R", "G2L", "G2R", "G3R", "NEF", "NWF", "EF"]);
            place(h, "1I1", "B3C");
            commit(h);
            const strip = h.clone();
            strip.move("IB3C>BR", { partial: true });
            const north = strip.render().areas![1] as { pieces: string[] };
            expect(north.pieces).to.deep.equal(["BCx"]);
        });

        it("shows a unit that has entered the enemy reserve inside that reserve", () => {
            const g = new SquaresGame();
            evacuate(g, 2, ["B2L", "B2CL", "B2CR", "B2R", "B1L", "B1CL", "B1C", "B1CR", "B1R", "G2L", "G2R", "G3R", "NEF", "NWF", "EF", "WF"]);
            expect(g.reserveUnits(2).length).to.equal(0);
            place(g, "1I1", "B3C");
            commit(g);
            g.move("IB3C-BR");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            const rep = g.render();
            const areas = rep.areas as { side: string; pieces: string[] }[];
            expect(areas[1].side).to.equal("N");
            // framed, since it arrived this ply
            expect(areas[1].pieces).to.deep.equal(["GIe"]);
            const frame = rep.legend!.GIe as { name: string; paint: { fill: { opacity?: number } } }[];
            expect(frame.map(part => part.name)).to.deep.equal(["piece-square-dashed", "nato-infantry"]);
            expect(frame[0].paint.fill.opacity).to.equal(0);
            expect(g.render({ perspective: 2 }).areas![1]).to.deep.include({ pieces: ["GIe"] });
            expect(areas[0].pieces.length).to.equal(15);
        });

        it("reports losses with glyphs and points with unit counts", () => {
            const g = setup({ "1I1": "G1C", "2I1": "B1C" });
            g.move("IG1C>IB1C");
            g.move("stand");
            expect(JSON.stringify(g.sidebarStatuses())).to.contain('{"kind":"sheet","name":"nato-infantry"');
            expect(g.sidebarScores()[0].scores).to.deep.equal(["1 (1)", "1 (1)"]);
        });

        it("draws by threefold repetition", () => {
            const g = setup({ "1C1": "G1C", "1I1": "G2R", "2C1": "B1C", "2I1": "B2L" });
            const cycle = ["CG1C-G1CL", "CB1C-B1CL", "CG1CL-G1C", "CB1CL-B1C", "IG2R-G2CR", "IB2L-B2CL", "IG2CR-G2R", "IB2CL-B2L"];
            let plies = 0;
            while (!g.gameover && plies < 40) {
                g.move(cycle[plies % cycle.length]);
                plies += 1;
            }
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1, 2]);
            expect(plies).to.equal(18);
            expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "repetition" });
        });
    });

    describe("annotation safety", () => {
        const sameEnds = (g: SquaresGame): boolean => (g.render().annotations ?? []).some(a =>
            a.type === "move" && a.targets.length === 2 && a.targets[0].row === a.targets[1].row && a.targets[0].col === a.targets[1].col);

        it("never draws an arrow from a square to itself", () => {
            // out of the reserve straight onto the back line, previewed and played
            const g = new SquaresGame();
            const preview = g.clone();
            preview.move("IGR-G3C", { partial: true });
            expect(sameEnds(preview)).to.be.false;
            g.move("IGR-G3C");
            expect(sameEnds(g)).to.be.false;
            // an attack on a reserve from the back line, previewed, pending and resolved
            const h = setup({ "1I1": "B3C", "1I2": "B3L" });
            const hp = h.clone();
            hp.move("IB3C+IB3L>BR", { partial: true });
            expect(sameEnds(hp)).to.be.false;
            h.move("IB3C+IB3L>BR");
            expect(sameEnds(h)).to.be.false;
            h.move("lose:A");
            expect(sameEnds(h)).to.be.false;
            // a retreat into the reserve from the back line itself
            const k = setup({ "1I1": "B3C", "2I1": "B2CL", "1C1": "B1C" });
            const kp = k.clone();
            kp.move("IB3C+CB1C>IB2CL", { partial: true });
            expect(sameEnds(kp)).to.be.false;
            k.move("IB3C+CB1C>IB2CL/stay");
            expect(sameEnds(k)).to.be.false;
            const m = setup({ "1I1": "G1C", "2I1": "B3C" });
            m.move("IG1C-G2CL");
            m.move("IB3C-BR");
            expect(sameEnds(m)).to.be.false;
            expect(m.render().board).to.deep.include({ markers: [{ type: "edge", edge: "N", colour: m.getPlayerColour(2) }] });
        });
    });
});
