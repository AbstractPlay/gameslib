/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { MiradorGame } from "../../src/games/mirador";
import { addResource } from "../../src";

describe("Mirador", () => {
    before(() => {
        addResource("en");
    });

    it("names both board sizes and the opening protocols in the variant metadata", () => {
        expect(MiradorGame.gameinfo.variants).to.deep.equal([
            { uid: "#board" },
            { uid: "size-40", group: "board" },
            { uid: "#opening" },
            { uid: "swap-2", group: "opening" },
            { uid: "swap-5", group: "opening" },
        ]);
    });

    it("keeps the standard 28x28 board as the default", () => {
        const game = new MiradorGame();
        const rep = game.render();

        expect(game.board).to.have.length(27);
        expect(Object.keys(game.board[0])).to.have.length(27);
        expect(rep.board).to.include({ width: 28, height: 28 });
        expect(game.moves()).to.have.length(26 * 26 + 1);
        expect(game.moves()).to.include.members(["a26", "z1", "declare"]);
    });

    it("supports legal placements and multi-letter notation on the 40x40 board", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        const rep = game.render();
        const board = rep.board as { columnLabels: string[]; height: number; rowLabels: string[]; width: number };

        expect(game.board).to.have.length(39);
        expect(Object.keys(game.board[0])).to.have.length(39);
        expect(board).to.include({ width: 40, height: 40 });
        expect(board.columnLabels).to.have.length(40);
        expect(board.columnLabels.slice(-3)).to.deep.equal(["ak", "al", ""]);
        expect(board.rowLabels).to.have.length(40);
        expect(board.rowLabels.slice(-3)).to.deep.equal(["37", "38", ""]);

        const moves = game.moves();
        expect(moves).to.have.length(38 * 38 + 1);
        expect(moves).to.include.members(["a38", "z38", "aa38", "al1", "declare"]);
        expect(game.validateMove("aa38").valid).to.equal(true);
        expect(game.validateMove("al1").valid).to.equal(true);
        expect(game.validateMove("am1").valid).to.equal(false);
        expect(game.validateMove("al0").valid).to.equal(false);

        const click = game.handleClick("", 1, 27);
        expect(click.valid).to.equal(true);
        expect(click.move).to.equal("aa38");
        expect(game.handleClick("", 1, 39).valid).to.equal(false);

        game.move("al1");
        expect(game.board[37][37]).to.equal(1);
        expect(game.board[37][38]).to.equal(1);
        expect(game.board[38][37]).to.equal(1);
        expect(game.board[38][38]).to.equal(1);

        const restored = new MiradorGame(game.serialize());
        expect(restored.variants).to.deep.equal(["size-40"]);
        expect(restored.render().board).to.include({ width: 40, height: 40 });
    });

    it("accepts multi-letter placements during a challenge", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        game.move("declare");

        const validation = game.validateMove("aa38-al1");
        expect(validation.valid).to.equal(true);
        expect(validation.complete).to.equal(0);
    });

    it("rejects adjacent placements within the same challenge response", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        game.move("declare");

        expect(game.validateMove("a38-c37").valid).to.equal(false);
    });

    it("preserves earlier challenge placements after rejecting orthogonal adjacency", () => {
        for (const variants of [[], ["size-40"]]) {
            const game = new MiradorGame(undefined, variants);
            game.move("declare");

            const first = game.handleClick("", 1, 1);
            expect(first.valid).to.equal(true);

            // a rejected click keeps the move (and its preview) and explains itself
            const illegal = game.handleClick(first.move, 2, 3);
            expect(illegal.valid).to.equal(true);
            expect(illegal.canrender).to.equal(true);
            expect(illegal.move).to.equal(first.move);
            expect(illegal.message).to.include("You can not play at");
        }
    });

    it("preserves earlier challenge placements after rejecting diagonal contact with an opponent", () => {
        for (const variants of [[], ["size-40"]]) {
            const game = new MiradorGame(undefined, variants);
            game.board[0][0] = 1;
            game.board[0][1] = 1;
            game.board[1][0] = 1;
            game.board[1][1] = 1;
            game.move("declare");

            const first = game.handleClick("", 5, 5);
            expect(first.valid).to.equal(true);

            const illegal = game.handleClick(first.move, 3, 3);
            expect(illegal.valid).to.equal(true);
            expect(illegal.canrender).to.equal(true);
            expect(illegal.move).to.equal(first.move);
            expect(illegal.message).to.include("You can not play at");
        }
    });

    it("checks connections against the enlarged board edge", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        game.board[0][0] = 1;
        game.board[0][25] = 1;
        game.board[0][30] = 2;

        expect(game["isConnected"](true, 1)).to.equal(false);
    });
});

describe("Mirador openings", () => {
    before(() => {
        addResource("en");
    });

    // the colour of the 2x2 block whose top-left placement cell is `cell`
    const colourAt = (game: MiradorGame, cell: string): number | null => {
        const [x, y] = MiradorGame.algebraic2coords(cell, 26);
        return game.board[y][x];
    };
    const click = (game: MiradorGame, move: string, cell: string) => {
        const [x, y] = MiradorGame.algebraic2coords(cell, 26);
        return game.handleClick(move, y + 1, x + 1);
    };
    const buttons = (game: MiradorGame) => game.getButtons().map(b => b.move);

    it("never relies on the generic pie", () => {
        expect(MiradorGame.gameinfo.flags).to.not.include("pie");
        for (const variants of [[], ["size-40"], ["swap-2"], ["swap-5"]]) {
            const flags = new MiradorGame(undefined, variants).getFlags();
            expect(flags).to.not.include("pie");
            expect(flags).to.include.members(["custom-buttons", "custom-colours"]);
        }
    });

    it("makes every opening decision by passing, as in the gomoku family", () => {
        for (const variants of [[], ["swap-2"], ["swap-5"]]) {
            const game = new MiradorGame(undefined, variants);
            game.move(variants[0] === "swap-2" ? "a1-z26-c3" : "a1");
            expect(game.moves(), variants.join()).to.include("pass");
            expect(buttons(game)[0], variants.join()).to.equal("pass");
            for (const m of ["swap", "keep"]) {
                expect(game.moves(), m).to.not.include(m);
                expect(game.validateMove(m).valid, m).to.be.false;
            }
        }
    });

    it("simple pie: the second player may pass to swap colours after the first mirador", () => {
        const game = new MiradorGame();
        expect(game.moves()).to.include("declare");
        expect(game.moves()).to.not.include("pass");
        expect(game.validateMove("pass").valid).to.be.false;
        expect(game.validateMove("pass").message).to.include("choice of colours");
        expect(buttons(game)).to.deep.equal(["declare"]);
        expect(game.getPlayerColour(1)).to.equal(1);
        expect(game.getPlayerColour(2)).to.equal(2);

        game.move("a1");
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.include("declare");
        // Declare means custom buttons, so the pass gets a standard Pass button among them
        expect(game.getButtons()).to.deep.equal([
            { label: "apgames:buttons.pass", move: "pass" },
            { label: "apgames:buttons.declare", move: "declare" },
        ]);
        expect(game.validateMove("pass").complete).to.equal(1);
        expect(game.validateMove("").message).to.include("pass to swap colours");

        // declining the swap by placing ends the offer
        const declines = new MiradorGame(game.serialize());
        declines.move("z26");
        expect(colourAt(declines, "z26")).to.equal(2);
        expect(declines.swapped).to.be.false;
        expect(declines.moves()).to.not.include("pass");

        // passing leaves the mirador as it is and gives the first player the second colour
        game.move("pass");
        expect(game.lastmove).to.equal("pass");
        expect(colourAt(game, "a1")).to.equal(1);
        expect(game.swapped).to.be.true;
        expect(game.getPlayerColour(1)).to.equal(2);
        expect(game.getPlayerColour(2)).to.equal(1);
        expect(game.currplayer).to.equal(1);
        expect(game.results.some(r => r.type === "pie")).to.be.true;
        expect(game.chatLog(["Alice", "Bob"]).flat().some(l => l.includes("Bob invoked the pie rule"))).to.be.true;
        expect(game.moves()).to.not.include("pass");
        expect(game.moves()).to.include("declare");
        expect(buttons(game)).to.deep.equal(["declare"]);
        game.move("z26");
        expect(colourAt(game, "z26")).to.equal(2);
        game.move("a26");
        expect(colourAt(game, "a26")).to.equal(1);
        expect(game.moves()).to.not.include("pass");
        expect(game.validateMove("pass").valid).to.be.false;
        expect(new MiradorGame(game.serialize()).getPlayerColour(1)).to.equal(2);

        // a declaration on the first move leaves nothing to swap
        const declared = new MiradorGame();
        declared.move("declare");
        expect(declared.moves()).to.not.include("pass");
        expect(declared.validateMove("pass").valid).to.be.false;
    });

    it("takes a Pass button sent as a click", () => {
        const game = new MiradorGame();
        // no decision on the first move: the entry is kept and the reason given
        let r = game.handleClick("m13", -1, -1, "_btn_pass");
        expect(r.valid).to.be.false;
        expect(r.move).to.equal("m13");
        expect(r.message).to.include("choice of colours");
        game.move("a1");
        r = game.handleClick("", -1, -1, "_btn_pass");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        expect(r.move).to.equal("pass");
        // a placement being entered gives way to the pass
        expect(game.handleClick("z26", -1, -1, "_btn_pass").move).to.equal("pass");
        // the swap openings pass the same way
        const swap5 = new MiradorGame(undefined, ["swap-5"]);
        swap5.move("a1");
        expect(swap5.handleClick("", -1, -1, "_btn_pass").move).to.equal("pass");
        // but not before the first swap-2 placements
        const swap2 = new MiradorGame(undefined, ["swap-2"]);
        r = swap2.handleClick("a1", -1, -1, "_btn_pass");
        expect(r.valid).to.be.false;
        expect(r.move).to.equal("a1");
    });

    it("lets a board click replace a pass that has not been submitted", () => {
        const offer = new MiradorGame(undefined, ["swap-2"]);
        offer.move("a1-z26-c3");
        const r = click(offer, "pass", "m13");
        expect(r.valid).to.be.true;
        expect(r.move).to.equal("m13");
        expect(r.complete).to.equal(0);

        const pie = new MiradorGame();
        pie.move("a1");
        expect(click(pie, "pass", "z26").move).to.equal("z26");
        expect(click(pie, "declare", "z26").move).to.equal("z26");
    });

    it("swap-2: the first player places three miradors of alternating colour", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        expect(game.moves()).to.deep.equal(["No movelist in opening"]);
        expect(game.getButtons()).to.have.length(0);
        expect(game.validateMove("declare").valid).to.be.false;
        expect(game.validateMove("pass").valid).to.be.false;

        let v = game.validateMove("a1");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(-1);
        expect(v.canrender).to.be.true;
        v = game.validateMove("a1-z26");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(-1);
        // the second mirador is the opponent's colour, so it may not touch the first diagonally
        expect(game.validateMove("a1-c3").valid).to.be.false;
        // the third is the first player's again, so diagonal contact with the first is fine
        v = game.validateMove("a1-z26-c3");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(1);
        expect(game.validateMove("a1-z26-c3-m13").valid).to.be.false;
        // the first and third placement are interchangeable, so the move is normalised
        expect(game.validateMove("c3-z26-a1").valid).to.be.false;
        const r = click(game, "c3-z26", "a1");
        expect(r.valid).to.be.true;
        expect(r.move).to.equal("a1-z26-c3");

        game.move("a1-z26-c3");
        expect(colourAt(game, "a1")).to.equal(1);
        expect(colourAt(game, "z26")).to.equal(2);
        expect(colourAt(game, "c3")).to.equal(1);
        expect(game.currplayer).to.equal(2);
        expect(game.moves()).to.deep.equal(["No movelist in opening", "pass"]);
        expect(buttons(game)).to.deep.equal(["pass"]);
        expect(game.validateMove("declare").valid).to.be.false;
        expect(game.validateMove("").message).to.include("pass to swap colours");

        const restored = new MiradorGame(game.serialize());
        expect(restored.variants).to.deep.equal(["swap-2"]);
        expect(colourAt(restored, "z26")).to.equal(2);
    });

    it("swap-2: the first turn can't skip any of its three miradors", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        for (const m of ["a1", "a1-z26"]) {
            expect(() => game.move(m), m).to.throw();
        }
        expect(game.stack).to.have.length(1);
        game.move("a1-z26-c3");
        expect(game.stack).to.have.length(2);
    });

    it("keeps the miradors already placed this turn when a click is rejected", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        let r = click(game, "", "a1");
        r = click(game, r.move, "z26");
        expect(r.move).to.equal("a1-z26");
        // clicking a mirador placed this turn, or the board edge, leaves the move (and its preview) as it was
        const again = click(game, r.move, "a1");
        expect(again.valid).to.be.true;
        expect(again.canrender).to.be.true;
        expect(again.move).to.equal("a1-z26");
        expect(again.message).to.include("You can not play at");
        const edge = game.handleClick(r.move, 0, 5);
        expect(edge.valid).to.be.true;
        expect(edge.canrender).to.be.true;
        expect(edge.move).to.equal("a1-z26");
        expect(edge.message).to.include("very edge");
        // with nothing placed yet there is nothing to keep, so the click is simply rejected
        const nothing = game.handleClick("", 0, 5);
        expect(nothing.valid).to.be.false;
        expect(nothing.move).to.equal("");
        expect(nothing.message).to.include("very edge");
    });

    it("swap-2: the second player may continue with their colour", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        game.move("a1-z26-c3");
        const v = game.validateMove("m13");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(0);
        game.move("m13");
        expect(colourAt(game, "m13")).to.equal(2);
        expect(colourAt(game, "a1")).to.equal(1);
        expect(game.swapped).to.be.false;
        expect(game.getPlayerColour(2)).to.equal(2);
        expect(game.currplayer).to.equal(1);
        expect(game.moves()).to.not.include("pass");
        expect(game.moves()).to.include("declare");
        expect(buttons(game)).to.deep.equal(["declare"]);
        game.move("f20");
        expect(colourAt(game, "f20")).to.equal(1);
    });

    it("swap-2: the second player may pass to swap colours, leaving the miradors as they are", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        game.move("a1-z26-c3");
        game.move("pass");
        expect(colourAt(game, "a1")).to.equal(1);
        expect(colourAt(game, "z26")).to.equal(2);
        expect(colourAt(game, "c3")).to.equal(1);
        expect(game.swapped).to.be.true;
        expect(game.getPlayerColour(1)).to.equal(2);
        expect(game.getPlayerColour(2)).to.equal(1);
        expect(game.currplayer).to.equal(1);
        expect(game.results.some(r => r.type === "pie")).to.be.true;
        const log = game.chatLog(["Alice", "Bob"]).flat();
        expect(log.some(l => l.includes("Bob invoked the pie rule"))).to.be.true;
        expect(game.moves()).to.not.include("pass");
        expect(game.moves()).to.include("declare");
        // the first player now plays the second colour, which is the one to move
        game.move("m13");
        expect(colourAt(game, "m13")).to.equal(2);
        game.move("f20");
        expect(colourAt(game, "f20")).to.equal(1);
        expect(new MiradorGame(game.serialize()).getPlayerColour(1)).to.equal(2);
    });

    it("swap-2: the second player may place two more and let the first player choose sides", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        game.move("a1-z26-c3");
        expect(game.validateMove("m13-p16").complete).to.equal(1);
        expect(game.validateMove("m13-p16-s19").valid).to.be.false;
        game.move("m13-p16");
        // the second player's colour, then the first player's; nothing changes colour
        expect(colourAt(game, "m13")).to.equal(2);
        expect(colourAt(game, "p16")).to.equal(1);
        expect(colourAt(game, "a1")).to.equal(1);
        expect(game.swapped).to.be.false;
        expect(game.currplayer).to.equal(1);
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.not.include("declare");
        expect(game.moves()).to.not.include("No movelist in opening");
        expect(buttons(game)).to.deep.equal(["pass"]);
        expect(game.validateMove("").message).to.include("pass to keep your colour");

        // passing keeps the first colour and hands the move to the opponent, who plays the second
        const keeps = new MiradorGame(game.serialize());
        keeps.move("pass");
        expect(keeps.swapped).to.be.false;
        expect(colourAt(keeps, "a1")).to.equal(1);
        expect(keeps.currplayer).to.equal(2);
        expect(keeps.results).to.deep.equal([{ type: "pass", why: "keep" }]);
        expect(keeps.chatLog(["Alice", "Bob"]).flat().some(l => l.includes("Alice kept their colour"))).to.be.true;
        expect(keeps.moves()).to.not.include("pass");
        expect(keeps.moves()).to.include("declare");
        keeps.move("f20");
        expect(colourAt(keeps, "f20")).to.equal(2);

        // placing instead takes the second colour, the one that is to move
        game.move("f20");
        expect(colourAt(game, "f20")).to.equal(2);
        expect(game.swapped).to.be.true;
        expect(game.getPlayerColour(1)).to.equal(2);
        expect(game.currplayer).to.equal(2);
        expect(game.moves()).to.not.include("pass");
        expect(game.moves()).to.include("declare");
        game.move("s7");
        expect(colourAt(game, "s7")).to.equal(1);
    });

    it("swap-5: each of the first five placements may be answered with a pass to swap", () => {
        const game = new MiradorGame(undefined, ["swap-5"]);
        expect(game.moves()).to.not.include("pass");
        expect(game.moves()).to.not.include("declare");
        expect(game.validateMove("pass").valid).to.be.false;
        expect(game.validateMove("declare").valid).to.be.false;

        game.move("a1");
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.not.include("declare");
        expect(buttons(game)).to.deep.equal(["pass"]);
        expect(game.validateMove("").message).to.include("pass to swap colours");
        game.move("pass");
        expect(colourAt(game, "a1")).to.equal(1);
        expect(game.swapped).to.be.true;
        expect(game.currplayer).to.equal(1);
        // no swapping straight back
        expect(game.moves()).to.not.include("pass");

        // the first player now places the second colour, and the opponent may swap again
        game.move("z26");
        expect(colourAt(game, "z26")).to.equal(2);
        expect(game.moves()).to.include("pass");
        game.move("pass");
        expect(game.swapped).to.be.false;
        game.move("a26");
        expect(colourAt(game, "a26")).to.equal(1);
        game.move("z1");
        expect(colourAt(game, "z1")).to.equal(2);
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.not.include("declare");
        game.move("m13");
        // five miradors are down: the opponent may still swap, and declaring opens up
        expect(game.moves()).to.include("pass");
        expect(game.moves()).to.include("declare");
        expect(buttons(game)).to.deep.equal(["pass", "declare"]);
        game.move("pass");
        expect(game.swapped).to.be.true;
        game.move("f20");
        expect(colourAt(game, "f20")).to.equal(2);
        // after the sixth placement the swap is gone for good
        expect(game.moves()).to.not.include("pass");
        expect(game.moves()).to.include("declare");
        expect(game.validateMove("pass").valid).to.be.false;
        expect(buttons(game)).to.deep.equal(["declare"]);
    });

    it("renders a partial swap-2 placement without ending the turn", () => {
        const game = new MiradorGame(undefined, ["swap-2"]);
        game.move("a1-z26", { partial: true });
        expect(colourAt(game, "a1")).to.equal(1);
        expect(colourAt(game, "z26")).to.equal(2);
        expect(game.currplayer).to.equal(1);
        expect(game.stack).to.have.length(1);
    });
});
