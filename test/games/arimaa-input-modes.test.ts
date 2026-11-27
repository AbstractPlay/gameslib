import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../../src";
import { ArimaaGame } from "../../src/games/arimaa";
import { parseMove } from "../../src/games/arimaa/notation";
import { ARIMAA_CAPTURE_CHOICE, ARIMAA_SPARE_CHOICE, captureAlternatives, captureChoices } from "../../src/games/arimaa/input";
import { resolve } from "../../src/games/arimaa/turns";
import { allPlays, allTurns, boardOf, neighbours, oneRankAbove, signature, type Board, type Owner, type Path, type Play } from "../fixtures/arimaa/coverage";

type Mode = "basic" | "advanced";
const MODES: Mode[] = ["basic", "advanced"];

const at = (cell: string): [number, number] => {
    const [col, row] = ArimaaGame.algebraic2coords(cell);
    return [row, col];
};
const click = (game: ArimaaGame, move: string, cell: string, mode: Mode = "basic", piece?: string) =>
    game.handleClick(move, ...at(cell), piece, {inputMode: mode});

const position = (gold: string, silver: string): ArimaaGame => {
    const game = new ArimaaGame(undefined, ["free"]);
    game.move(gold);
    game.move(silver);
    return game;
};
/** Click squares in order, each of which must be accepted; a leading `^` clicks the trap's capture triangle. */
const enter = (game: ArimaaGame, mode: Mode, squares: string[], start = ""): string => {
    let move = start;
    for (const sq of squares) {
        const r = click(game, move, sq.replace("^", ""), mode, sq.startsWith("^") ? ARIMAA_CAPTURE_CHOICE : undefined);
        expect(r.valid, `${mode} click ${sq} after "${move}": ${r.message}`).to.equal(true);
        move = r.move;
    }
    return move;
};
/** The game after `move`, which has to be one a player could submit. */
const played = (game: ArimaaGame, move: string): ArimaaGame => {
    const v = game.validateMove(move);
    expect(v.valid, `${move}: ${v.message}`).to.equal(true);
    expect(v.complete, `${move}: ${v.message}`).to.be.at.least(0);
    return game.clone().move(move);
};
/** What is drawn for an entry while it is being made, as `type:square>square`. */
const marks = (game: ArimaaGame, move: string): string[] =>
    ((game.clone().move(move, {partial: true}).render().annotations ?? []) as Array<{type: string; targets: Array<{row: number; col: number}>}>)
        .map(a => `${a.type}:${a.targets.map(t => ArimaaGame.coords2algebraic(t.col, t.row)).join(">")}`);

/** What an Advanced entry says, apart from the steps of the move shown that it may list after that. */
const said = (move: string): string[] => parseMove(move, true).tokens.filter(t => t.prop.kind !== "steps").map(t => t.text);
const listed = (move: string): string[] => parseMove(move, true).tokens.filter(t => t.prop.kind === "steps").map(t => t.text);
const ambiguous = (count: number): string => i18next.t("apgames:validation.arimaa.AMBIGUOUS", {count});
const withDie = (game: ArimaaGame, steps: number): ArimaaGame => {
    game.die = {steps, square: "a4"};
    return game;
};
/** A position to click on, with no hands and the given player to move. */
const ready = (board: Board, player: Owner): ArimaaGame => {
    const g = new ArimaaGame(undefined, ["free"]);
    g.stack[0].board = new Map(board) as ArimaaGame["board"];
    g.stack.push({...g.stack[0], _results: [], _timestamp: new Date(), currplayer: player, board: new Map(board) as ArimaaGame["board"], hands: undefined, lastmove: "x"});
    g.load();
    g.hands = undefined;
    return g;
};

describe("Arimaa input modes", () => {
    before(() => addResource("en"));

    it("defaults to Basic, with Advanced on request", () => {
        const g = position("Ed4,Ra1", "ra8,ee8");
        expect(g.inputModes()?.map(({uid}) => uid)).to.deep.equal(["#entry", "advanced"]);
        expect(g.resolveActiveInputMode(undefined)).to.equal(undefined);
        expect(g.resolveActiveInputMode("advanced")).to.equal("advanced");
    });

    describe("Basic", () => {
        it("selects and moves an ordinary piece without automatic submission", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            const selected = click(g, "", "d4");
            expect(selected.move).to.equal("d4");
            expect(selected.complete).to.equal(-1);
            const moved = click(g, selected.move, "e4");
            expect(moved.move).to.equal("Ed4e");
            expect(moved.valid).to.equal(true);
            expect(moved.complete).to.equal(0);
            expect(g.validateMove(moved.move).complete).to.equal(0);
            expect(click(g, moved.move, "h2").complete).to.equal(1);
        });

        it("writes each destination click as the steps the selected piece takes", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            let move = enter(g, "basic", ["d4", "d6"]);
            expect(move).to.equal("Ed4nn");
            move = enter(g, "basic", ["a1", "a2"], move);
            expect(move).to.equal("Ed4nn Ra1n");
            // a piece that has moved is named by the square it now stands on
            move = enter(g, "basic", ["d6", "e6"], move);
            expect(move).to.equal("Ed4nn Ra1n Ed6e");
            const after = played(g, move);
            expect(after.board.get("e6")).to.deep.equal(["E", 1]);
            expect(after.board.get("a2")).to.deep.equal(["R", 1]);
            // what is stored is the usual notation, not the step list
            expect(after.lastmove).to.equal("Ee6 Ra2");
        });

        it("never infers an unselected pusher, though Advanced does", () => {
            const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
            const basicSelected = click(g, "", "h3");
            expect(basicSelected.move).to.equal("h3");
            const basicMoved = click(g, basicSelected.move, "f3");
            expect(basicMoved.move).to.equal("");
            const advancedSelected = click(g, "", "h3", "advanced");
            expect(advancedSelected.move).to.equal("h3");
            const advancedMoved = click(g, advancedSelected.move, "f3", "advanced");
            expect(advancedMoved.valid).to.equal(true);
            expect(advancedMoved.move).to.equal("dh3f3");
            expect(advancedMoved.complete).to.equal(0);
        });

        it("enters an explicitly selected push and pull as ordered chains", () => {
            const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
            let p = click(g, "", "d4");
            p = click(g, p.move, "e4");
            expect(p.move).to.equal("d4 e4");
            p = click(g, p.move, "e5");
            expect(p.valid).to.equal(true);
            expect(p.move).to.equal("re4n Ed4e");
            expect(p.complete).to.equal(0);
            expect(played(g, p.move).lastmove).to.equal("re5 Ee4");

            let pull = click(g, "", "e4");
            pull = click(g, pull.move, "d4");
            expect(pull.move).to.equal("e4 d4");
            pull = click(g, pull.move, "c4");
            expect(pull.valid).to.equal(true);
            expect(pull.move).to.equal("Ed4w re4w");
            expect(pull.complete).to.equal(0);
            expect(played(g, pull.move).lastmove).to.equal("Ec4 rd4");
        });

        it("takes a push or pull as its two steps, one after the other, as well as all at once", () => {
            const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
            const push = enter(g, "basic", ["d4", "e4", "e5"]);
            // the pushed piece first: it waits, drawn as an arrow, for the piece that pushes it
            const waiting = enter(g, "basic", ["e4", "e5"]);
            expect(waiting).to.equal("e4 e5");
            const v = g.validateMove(waiting);
            expect(v.complete).to.equal(-1);
            expect(v.message).to.equal(i18next.t("apgames:validation.arimaa.PARTIAL_PUSH"));
            expect(marks(g, waiting)).to.deep.equal(["move:e4>e5"]);
            // a click on the pusher is enough: it can only follow into the square the pushed piece left
            expect(enter(g, "basic", ["d4"], waiting)).to.equal(push);
            // either piece strong enough can be the one that pushes
            const byHorse = played(g, enter(g, "basic", ["f4"], waiting));
            expect(byHorse.board.get("e4")).to.deep.equal(["H", 1]);
            expect(byHorse.board.get("e5")).to.deep.equal(["R", 2]);
            // the puller first, then the pulled piece into the square it left
            const pull = enter(g, "basic", ["e4", "d4", "c4"]);
            expect(enter(g, "basic", ["d4", "c4", "e4", "d4"])).to.equal(pull);
            // with a two-step die, the pull's second step is the last
            const dicey = withDie(position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8"), 2);
            expect(played(dicey, enter(dicey, "basic", ["d4", "c4", "e4", "d4"])).board.get("d4")).to.deep.equal(["R", 2]);
        });

        it("sends an enemy piece two squares in one arrow, pulled then pushed, as in a flip", () => {
            // the horse steps away, the dog follows it and is pushed on onto the
            // trap, and the horse steps back: the dog dies and nothing else changes
            const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
            const away = enter(g, "basic", ["g3", "g4"]);
            const arrow = enter(g, "basic", ["h3", "f3"], away);
            expect(arrow).to.equal("Hg3n dh3w g3 f3");
            expect(g.validateMove(arrow).message).to.contain(i18next.t("apgames:validation.arimaa.PARTIAL_PUSH"));
            const flipped = enter(g, "basic", ["g4"], arrow);
            expect(flipped).to.equal("Hg3n dh3w dg3w Hg4s");
            const after = played(g, flipped);
            expect(after.lastmove).to.equal("dx");
            expect(after.board.get("g3")).to.deep.equal(["H", 1]);
            // the dog's steps one at a time come to the same thing
            expect(enter(g, "basic", ["h3", "g3", "g3", "f3", "g4"], away)).to.equal(flipped);
            // an enemy piece cannot take a third step in a row
            const three = position("Hg3,Ra2,Ee1", "dh3,ra7,ee8");
            expect(enter(three, "basic", ["h3", "e3"], enter(three, "basic", ["g3", "g4"]))).to.equal("Hg3n");
        });

        it("takes the route that lets an enemy piece follow, of those as short to the same square", () => {
            // the elephant can reach e5 by d5 or by e4: whichever rabbit is
            // to follow it, it comes by the square beside that rabbit
            const g = position("Ed4,Ra1", "rf4,rc5,ra8,ee8");
            const walked = enter(g, "basic", ["d4", "e5"]);
            for (const [rabbit, into] of [["f4", "e4"], ["c5", "d5"]]) {
                const selected = click(g, walked, rabbit, "basic");
                expect(selected.move, rabbit).to.equal(`${walked} ${rabbit}`);
                const after = played(g, click(g, selected.move, into, "basic").move);
                expect(after.board.get("e5"), rabbit).to.deep.equal(["E", 1]);
                expect(after.board.get(into), rabbit).to.deep.equal(["R", 2]);
                expect(after.board.has(rabbit), rabbit).to.equal(false);
            }
        });

        it("does not let a piece that has just pushed pull as well", () => {
            const g = position("Ed4,Ra1", "re4,rd5,ra8,ee8");
            const pushed = enter(g, "basic", ["d4", "e4", "e5"]);
            expect(pushed).to.equal("re4n Ed4e");
            // the rabbit beside the square the elephant left cannot follow it
            const after = click(g, `${pushed} d5`, "d4", "basic");
            expect(after.move).not.to.contain("rd5s");
            expect(click(g, pushed, "d5", "basic").move).not.to.equal(`${pushed} d5`);
        });

        it("plays steps in the order they were entered", () => {
            // the cat is safe on the trap only if the rabbit is beside it first
            const g = position("Re2,Cf2", "rb7,mc7");
            const catFirst = played(g, enter(g, "basic", ["f2", "f3", "e2", "e3"]));
            expect(catFirst.board.has("f3")).to.equal(false);
            expect(catFirst.board.get("e3")).to.deep.equal(["R", 1]);
            const rabbitFirst = played(g, enter(g, "basic", ["e2", "e3", "f2", "f3"]));
            expect(rabbitFirst.board.get("f3")).to.deep.equal(["C", 1]);
            expect(rabbitFirst.board.get("e3")).to.deep.equal(["R", 1]);
        });

        it("can sacrifice a piece by stepping it onto a trap before its support arrives", () => {
            const g = position("Rb4,Ec2,Ra1", "rc4,ee8");
            const sacrificed = played(g, enter(g, "basic", ["c2", "c3", "a1", "b3"]));
            expect(sacrificed.board.has("c3")).to.equal(false);
            expect(sacrificed.board.get("b3")).to.deep.equal(["R", 1]);
            const supported = played(g, enter(g, "basic", ["a1", "b3", "c2", "c3"]));
            expect(supported.board.get("c3")).to.deep.equal(["E", 1]);
            expect(supported.board.get("b3")).to.deep.equal(["R", 1]);
        });

        it("goes round a piece that was not selected rather than move it", () => {
            const g = position("Ed4,Rd5,Cc5,Ra1", "ra8,ee8");
            const move = enter(g, "basic", ["d4", "d6"]);
            const after = played(g, move);
            expect(after.board.get("d5")).to.deep.equal(["R", 1]);
            expect(after.board.get("d6")).to.deep.equal(["E", 1]);
            expect(g.validateMove(move).message).not.to.contain("Rd5");
        });

        it("does not sacrifice an unselected cat to shorten a rabbit's walk (archive 4711e615, ply 73)", () => {
            const g = position("Ha3,Ra6,Rb4,Ed4,Re2,Cg3,Rh1",
                "ra2,ra4,da7,rb6,rc7,ed3,dd5,cf7,rf8,rg5,cg6,rh5,rh6");
            const recorded = g.clone().move("Re2f2, Rf2f3, Rf3f4, Rf4e4");
            const after = played(g, enter(g, "basic", ["e2", "e4"]));
            expect(after.board.get("g3")).to.deep.equal(["C", 1]);
            expect(after.signature()).to.equal(recorded.signature());
        });

        it("keeps a trap occupant supported when its supporters move in turn (archive 21f8a821, ply 57)", () => {
            const g = position("Ra1,Ha6,Rb1,Cc1,Dd2,Ed6,Re2,Rf2,Cf3,Rg2,Hg6,Rh5",
                "ha2,ra7,ra8,eb6,cb7,rc7,df4,rf5,rf6,df7,hg5,rg7,rg8,rh7");
            const recorded = g.clone().move("Rg2h2, Re2e3, Rf2g2, Dd2e2");
            const after = played(g, enter(g, "basic", ["g2", "h2", "e2", "e3", "f2", "g2", "d2", "e2"]));
            expect(after.board.get("f3")).to.deep.equal(["C", 1]);
            expect(after.signature()).to.equal(recorded.signature());
        });

        it("stays open to further steps after any earlier ones", () => {
            const g = position("Re2,Cf2,Ra1", "rb7,mc7");
            const after = played(g, enter(g, "basic", ["e2", "e3", "f2", "f3", "a1", "a2"]));
            expect(after.board.get("e3")).to.deep.equal(["R", 1]);
            expect(after.board.get("f3")).to.deep.equal(["C", 1]);
            expect(after.board.get("a2")).to.deep.equal(["R", 1]);
        });

        it("undoes a push whole, and never leaves an enemy piece moving alone", () => {
            const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
            const push = enter(g, "basic", ["d4", "e4", "e5"]);
            expect(click(g, push, "a8").move).to.equal("");
            const pull = enter(g, "basic", ["e4", "d4", "c4"]);
            const half = click(g, pull, "a8");
            expect(half.move).to.equal("Ed4w");
            expect(click(g, half.move, "a8").move).to.equal("");
        });

        it("treats steps that only restore the starting position as no entry", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            const out = enter(g, "basic", ["d4", "d5"]);
            expect(enter(g, "basic", ["d5", "d4"], out)).to.equal("");
        });

        it("turns a typed entry into the steps shown before adding to it", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            // the rabbit can make way to either side: the preview shows one
            const preview = g.clone().move("Ed4d6", {partial: true});
            const move = enter(g, "basic", ["a1", "a2"], "Ed4d6");
            expect(parseMove(move).tokens.every(t => t.prop.kind === "steps")).to.equal(true);
            const after = played(g, move);
            expect(after.board.get("a2")).to.deep.equal(["R", 1]);
            for (const [cell, piece] of preview.board) {
                if (cell !== "a1") {
                    expect(after.board.get(cell), cell).to.deep.equal(piece);
                }
            }
        });

        it("selects a frozen piece after preparatory support and a blocked piece after clearing space", () => {
            const frozen = position("Rc4,Eb3,Ra1", "ec5,ra8");
            expect(click(frozen, "", "c4").move).to.equal("c4");
            let support = click(frozen, "", "b3");
            support = click(frozen, support.move, "c3");
            expect(support.move).to.equal("Eb3e");
            let rabbit = click(frozen, support.move, "c4");
            expect(rabbit.move).to.equal("Eb3e c4");
            rabbit = click(frozen, rabbit.move, "d4");
            expect(rabbit.valid).to.equal(true);
            expect(frozen.clone().move(rabbit.move).board.get("d4")).to.deep.equal(["R", 1]);

            const blocked = position("Rb1,Rb2,Ra1,Rc1,Ee2", "ra8,ee8");
            expect(click(blocked, "", "b1").move).to.equal("b1");
            const oneStep = position("Rc4,Eb3,Ra1", "ec5,ra8");
            oneStep.die = {steps: 1, square: "a4"};
            expect(click(oneStep, "", "c4").move).to.equal("");
        });

        it("rotates three pieces in a loop, but leaves two trading places to single steps", () => {
            // the dog steps aside, the horse and elephant move up, and the dog comes round to d4
            const g = position("Ed4,He4,De5,Ra1", "ra8,ee8");
            const rotated = played(g, enter(g, "basic", ["d4", "e4", "e5", "d4"]));
            expect(rotated.board.get("e4")).to.deep.equal(["E", 1]);
            expect(rotated.board.get("e5")).to.deep.equal(["H", 1]);
            expect(rotated.board.get("d4")).to.deep.equal(["D", 1]);
            // a click on the first of two selected pieces deselects them, as on any selected piece
            const two = position("Ed4,He4,Ra1", "ra8,ee8");
            for (const sequence of [["d4", "e4", "d4"], ["e4", "d4", "e4"]]) {
                const r = click(two, enter(two, "basic", sequence.slice(0, 2)), sequence[2], "basic");
                expect(r.move, sequence.join(" ")).to.equal("");
                expect(r.complete, sequence.join(" ")).to.equal(-1);
            }
            // the same exchange entered step by step
            const swapped = played(two, enter(two, "basic", ["d4", "d5", "e4", "d4", "d5", "e4"]));
            expect(swapped.board.get("e4")).to.deep.equal(["E", 1]);
            expect(swapped.board.get("d4")).to.deep.equal(["H", 1]);
        });

        it("ignores a click on an empty square while nothing is selected or entered", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            const r = click(g, "", "d6");
            expect(r.move).to.equal("");
            expect(r.complete).to.equal(-1);
        });
    });

    describe("selection in both modes", () => {
        it("uses immovable enemy clicks to undo the last token", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            for (const mode of MODES) {
                const result = click(g, "Ed4e4", "a8", mode);
                expect(result.move, mode).to.equal("");
                expect(result.valid, mode).to.equal(true);
                expect(result.complete, mode).to.equal(-1);
                // During a selection, undo cancels selections, not a move token.
                const cancel = click(g, "Ed4e4 e4", "a8", mode);
                expect(cancel.move, mode).to.equal("Ed4e4");
            }
        });

        it("still selects a pushable enemy when a legal push is available", () => {
            const g = position("Ed4,Ra1", "re4,ra8,ee8");
            for (const mode of MODES) {
                const r = click(g, "", "e4", mode);
                expect(r.valid, mode).to.equal(true);
                expect(r.move, mode).to.equal("e4");
            }
        });

        it("does not select an enemy when the only remaining die step cannot complete a push", () => {
            const g = position("Ed4,Ra1", "re5,ra8,ee8");
            g.die = {steps: 2, square: "b5"};
            for (const mode of MODES) {
                const r = click(g, "Ed4e4", "e5", mode);
                expect(r.move, mode).to.equal("");
            }
        });

        it("adds a piece to the chain only if the newest selection can reach its square", () => {
            const g = position("Ed4,Rd5,Ra1,Rh1", "ra8,ee8");
            for (const mode of MODES) {
                // the elephant cannot get to a1 this turn: the rabbit there is simply selected instead
                expect(enter(g, mode, ["d4", "a1"]), mode).to.equal("a1");
                const after = played(g, enter(g, mode, ["d4", "a1", "a2"]));
                expect(after.board.get("a2"), mode).to.deep.equal(["R", 1]);
                expect(after.board.get("d4"), mode).to.deep.equal(["E", 1]);
                // the rabbit in front of it can make way, so it joins the chain
                expect(enter(g, mode, ["d4", "d5"]), mode).to.equal("d4 d5");
                const chained = played(g, enter(g, mode, ["d4", "d5", "e5"]));
                expect(chained.board.get("e5"), mode).to.deep.equal(["R", 1]);
                expect(chained.board.get("d5"), mode).to.deep.equal(["E", 1]);
            }
        });

        it("closes a loop of two or three pieces, in either selection direction", () => {
            // Advanced only: Basic rotates three pieces but does not swap two.
            // The square to close onto is occupied at the outset. The elephant
            // must take a detour so the horse can take its original square.
            const game = position("Ed4,He4,Ra1", "ra8,ee8");
            for (const sequence of [["d4", "e4", "d4"], ["e4", "d4", "e4"]]) {
                const label = sequence.join(" ");
                expect(enter(game, "advanced", sequence.slice(0, 2)), label).to.equal(sequence.slice(0, 2).join(" "));
                const after = played(game, enter(game, "advanced", sequence));
                expect(after.board.get("e4"), label).to.deep.equal(["E", 1]);
                expect(after.board.get("d4"), label).to.deep.equal(["H", 1]);
                expect(after.board.get("a1"), label).to.deep.equal(["R", 1]);
            }
            const three = position("Ed4,He4,De5,Ra1", "ra8,ee8");
            const rotated = played(three, enter(three, "advanced", ["d4", "e4", "e5", "d4"]));
            expect(rotated.board.get("d4")).to.deep.equal(["D", 1]);
            expect(rotated.board.get("e5")).to.deep.equal(["H", 1]);
        });

        it("accepts either mode with a one-step Dicey Moves limit", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            g.die = {steps: 1, square: "c4"};
            for (const mode of MODES) {
                const entered = click(g, enter(g, mode, ["d4"]), "e4", mode);
                expect(entered.valid, mode).to.equal(true);
                expect(entered.complete, mode).to.equal(0);
                expect(played(g, entered.move).board.get("e4"), mode).to.deep.equal(["E", 1]);
                // nothing further can be selected once the die is spent
                expect(click(g, entered.move, "a1", mode).move, mode).to.equal(entered.move);
            }
        });

        it("pulls with the piece the player moved up, not with one that could push instead (archive 8c4b586f, ply 11)", () => {
            const g = position("Da1,Ra2,Cb1,Rc1,Rc2,Rd1,Hd4,Ed6,Re1,Re2,Rf1,Cg1,Dh1,Rh2",
                "ha7,ra8,mb6,cb8,dc6,rc7,rc8,rd8,de8,ef5,rf7,rf8,hg6,rg8,ch6,rh8");
            const recorded = g.clone().move("Hd4d5, Hd5c5, Hc5c4, dc6c5");
            for (const mode of MODES) {
                // horse to c5, then the dog and the horse as a chain to c4
                const after = played(g, enter(g, mode, ["d4", "c5", "c6", "c5", "c4"]));
                expect(after.board.get("d6"), mode).to.deep.equal(["E", 1]);
                expect(after.signature(), mode).to.equal(recorded.signature());
            }
        });

        it("ignores a click off the board once the pieces are down", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            for (const mode of MODES) {
                const r = g.handleClick("Ed4e4", -1, -1, undefined, {inputMode: mode});
                expect(r.move, mode).to.equal("Ed4e4");
                expect(r.complete, mode).to.equal(0);
            }
        });
    });

    describe("Advanced", () => {
        it("deselects a piece that is clicked again, leaving the entry as it was", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            for (const mode of MODES) {
                const none = click(g, enter(g, mode, ["d5"]), "d5", mode);
                expect(none.move, mode).to.equal("");
                expect(none.complete, mode).to.equal(-1);
                const entry = enter(g, mode, ["a1", "a2"]);
                expect(enter(g, mode, ["d4", "d4"], entry), mode).to.equal(entry);
            }
        });

        it("selects a piece only where it stands, so the square it left is free for a target click", () => {
            // nothing can come to the square the elephant left: as in Basic, the click completes the move
            const g = position("Ed4,Ra1", "ra8,ee8");
            const sent = enter(g, "advanced", ["d4", "d6"]);
            const done = click(g, sent, "d4", "advanced");
            expect(done.move).to.equal(sent);
            expect(done.complete).to.equal(1);
            // the elephant is selected where it now stands
            expect(click(g, sent, "d6", "advanced").move).to.equal(`${sent} d6`);
            // the rabbit beside the square can come to it
            const h = position("Ed4,Rc4,Ra1", "ra8,ee8");
            const filled = click(h, enter(h, "advanced", ["d4", "d6"]), "d4", "advanced");
            expect(said(filled.move)).to.deep.equal(["Ed4d6", "Rc4d4"]);
        });

        it("chooses the piece that pushes by sending it, with no need to keep it anywhere", () => {
            const g = position("Ed4,Hf4,Ra1", "re4,ra8,ee8");
            // the horse pushes, being one rank above a rabbit here, and steps back
            const pushed = enter(g, "advanced", ["e4", "e5"]);
            const shown = g.clone().move(pushed, {partial: true});
            expect(shown.board.has("e4")).to.equal(false);
            expect(shown.board.get("f4")).to.deep.equal(["H", 1]);
            // sending either piece onto the rabbit's square has it push and stay
            for (const [from, piece] of [["d4", "E"], ["f4", "H"]]) {
                const move = enter(g, "advanced", [from, "e4"], pushed);
                expect(move, from).to.equal(`re4e5 ${piece}${from}e4`);
                expect(played(g, move).board.get("e4"), from).to.deep.equal([piece, 1]);
            }
        });

        it("takes a typed same-square token as saying where the piece ends, and draws nothing for it", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            // with the rabbit kept on d5, the elephant has to walk round it
            const after = played(g, "Rd5d5 Ed4d6");
            expect(after.board.get("d5")).to.deep.equal(["R", 1]);
            expect(after.board.get("d6")).to.deep.equal(["E", 1]);
            // the enter glyph is for a piece that moved and came back, not for one said to stay
            expect(marks(g, "Rd5d5")).to.deep.equal([]);
            expect(marks(g, "Rd5d5 Ed4d6")).to.deep.equal(["move:d4>d6"]);
        });

        it("shows one of the moves an entry fits when none is better, and lets the player complete it", () => {
            // three steps are too few to walk round the rabbit, so it has to make way, to either side
            const g = withDie(position("Ed4,Rd5,Ra1", "ra8,ee8"), 3);
            const entered = click(g, enter(g, "advanced", ["d4"]), "d6", "advanced");
            expect(said(entered.move)).to.deep.equal(["Ed4d6"]);
            expect(entered.complete).to.equal(0);
            expect(entered.message).to.contain(ambiguous(2));
            expect(entered.message).to.contain(i18next.t("apgames:validation.arimaa.INFERRED", {pieces: ""}).split(":")[0]);
            const preview = g.clone().move(entered.move, {partial: true});
            expect(preview.board.get("d6")).to.deep.equal(["E", 1]);
            expect(preview.board.has("d5")).to.equal(false);
            // submitted as it is, it plays what was shown and is stored unambiguously
            const submitted = g.clone().move(entered.move);
            expect(submitted.signature()).to.equal(preview.signature());
            expect(resolve(g.board, 1, 3, parseMove(submitted.lastmove!).tokens, false).status).to.equal("resolved");
            // and so does completing it with a click on an empty square
            const done = click(g, entered.move, "h8", "advanced");
            expect(done.complete).to.equal(1);
            expect(resolve(g.board, 1, 3, parseMove(done.move).tokens, false).status).to.equal("resolved");
            expect(g.clone().move(done.move).signature()).to.equal(preview.signature());
        });

        it("sends a piece the engine moved somewhere else instead", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            const preview = g.clone().move("Ed4d6", {partial: true});
            const [shown, other] = preview.board.has("e5") ? ["e5", "c5"] : ["c5", "e5"];
            const move = enter(g, "advanced", [shown, other], "Ed4d6");
            expect(move).to.equal(`Ed4d6 Rd5${other}`);
            const after = played(g, move);
            expect(after.board.get(other)).to.deep.equal(["R", 1]);
            expect(after.board.get("d6")).to.deep.equal(["E", 1]);
        });

        it("completes the supplied partially ambiguous horse-and-rabbit move on an empty square", () => {
            const game = position("Ha2,Hh2,Dd2,De1,Cg2,Rc2,Ra1,Rf1,Rg1,Rh1,Cb2,Rb1,Rc1,Re2,Ee5", "hg7,ra7,ra8,rb8,rf8,rg8,rh8,rh7,dd8,cc7,cf7,rc8,md6,eb5,de4,hb6");
            const move = "Hh2f3 Re2f2";
            expect(game.validateMove(move).valid).to.equal(true);
            const completed = click(game, move, "a6", "advanced");
            expect(completed.valid).to.equal(true);
            expect(completed.complete).to.equal(1);
            expect(completed.move).not.to.equal("");
            const before = game.clone();
            game.move(completed.move);
            expect(game.board.get("f3")).to.deep.equal(["H", 1]);
            expect(game.board.get("f2")).to.deep.equal(["R", 1]);
            expect(before.validateMove(completed.move).valid).to.equal(true);
        });

        it("honours every explicitly selected link of the horse-over-elephant push chain", () => {
            const game = position("Ha2,Dd2,De1,Cg2,Rc2,Ra1,Rf1,Rg1,Rh1,Cb2,Rb1,Rc1,Ee5,Rf2,Hf3", "hg7,ra7,ra8,rb8,rf8,rg8,rh8,cc7,cf7,rc8,md6,eb5,de4,hb6,rh4,dd7");
            let result = click(game, "", "f3", "advanced");
            expect(result.move).to.equal("f3");
            result = click(game, result.move, "e4", "advanced");
            expect(result.move).to.equal("f3 e4");
            result = click(game, result.move, "d4", "advanced");
            expect(result.valid).to.equal(true);
            expect(result.move).to.contain("Hf3e4");
            expect(result.move).to.contain("de4d4");
            const after = game.clone().move(result.move);
            expect(after.board.get("e4")).to.deep.equal(["H", 1]);
            expect(after.board.get("d4")).to.deep.equal(["D", 2]);
            expect(after.board.get("e5")).to.deep.equal(["E", 1]);
        });

        it("allows a different explicitly selected pusher after an inferred dog flip", () => {
            const game = position("Ha2,Dd2,De1,Cg2,Rc2,Ra1,Rf1,Rg1,Rh1,Cb2,Rb1,Rc1,Ee5,Rf2,He3", "hg7,ra7,ra8,rb8,rf8,rg8,rh8,cc7,cf7,md6,eb5,de4,hb6,rh4,dd7,rd8");
            let result = click(game, "", "e4", "advanced");
            result = click(game, result.move, "f3", "advanced");
            expect(result.valid).to.equal(true);
            const dogMove = result.move;
            for (const pusher of ["e5", "e3"]) {
                const selected = click(game, dogMove, pusher, "advanced");
                expect(selected.valid, pusher).to.equal(true);
                expect(selected.move, pusher).to.equal(`${dogMove} ${pusher}`);
                const directed = click(game, selected.move, "f4", "advanced");
                expect(directed.valid, pusher).to.equal(true);
                expect(directed.move, pusher).to.contain(
                    pusher === "e5" ? "Ee5f4" : "He3f4"
                );
                const after = game.clone().move(directed.move);
                // f3 is a trap without adjacent silver support: the pushed dog
                // is captured, not left standing on f3.
                expect(after.board.has("f3"), pusher).to.equal(false);
                expect(after.results.some(r =>
                    r.type === "destroy" && r.where === "f3" && r.what === "d"
                ), pusher).to.equal(true);
                expect(after.board.get("f4"), pusher).to.deep.equal([
                    pusher === "e5" ? "E" : "H", 1
                ]);
            }
        });

        it("frees a frozen piece with one that steps out and comes back (archive 10441479, ply 29)", () => {
            const g = position("Ra2,Ra5,Rb1,Cb2,Mb4,Rc2,Hd3,Ed5,De2,De4,Rf1,Rf2,Cg1,Hg3,Rh1,Rh2",
                "ra6,rb7,ec4,hc6,cc7,rc8,dd4,rd7,re7,cf7,rf8,hg6,rg8,dh6,rh8");
            const recorded = g.clone().move("Ra5b5, Mb4b3, Mb3a3, Rb5a5");
            // Sending the camel is all it takes. Whichever piece frees it
            // comes back, because that leaves every other piece where it was,
            // and it is the same move whichever piece that is.
            expect(played(g, enter(g, "advanced", ["b4", "a3"])).signature()).to.equal(recorded.signature());
            // Basic simply plays the steps
            expect(played(g, enter(g, "basic", ["a5", "b5", "b4", "a3", "b5", "a5"])).signature()).to.equal(recorded.signature());
        });
    });

    describe("Advanced preferences", () => {
        const moves = (g: ArimaaGame): number => g.results.filter(r => r.type === "move").length;

        it("brings a pusher back unless it is sent somewhere too", () => {
            const g = position("Cd4,Ra1", "re4,ra8,ee8");
            const back = played(g, enter(g, "advanced", ["e4", "e5"]));
            expect(back.board.get("e5")).to.deep.equal(["R", 2]);
            expect(back.board.get("d4")).to.deep.equal(["C", 1]);
            expect(back.board.has("e4")).to.equal(false);
            expect(moves(back)).to.equal(3);
            // sent after the rabbit, or selected before it as a chain, the cat stays on the rabbit's square
            for (const clicks of [["e4", "e5", "d4", "e4"], ["d4", "e4", "e5"]]) {
                const move = enter(g, "advanced", clicks);
                expect(move, clicks.join(" ")).to.equal("re4e5 Cd4e4");
                const after = played(g, move);
                expect(after.board.get("e4"), clicks.join(" ")).to.deep.equal(["C", 1]);
                expect(moves(after), clicks.join(" ")).to.equal(2);
            }
        });

        it("pushes with the piece exactly one rank stronger, counting only the ranks on the board", () => {
            // two steps, so whichever piece pushes cannot come back
            const cat = withDie(position("Cd4,Df4,Ra1", "re4,ra8,ee8"), 2);
            const byCat = click(cat, "e4", "e5", "advanced");
            expect(played(cat, byCat.move).board.get("e4")).to.deep.equal(["C", 1]);
            expect(byCat.message).not.to.contain(ambiguous(2));
            // with no cat on the board, a dog is one rank above a rabbit
            const dog = withDie(position("Hd4,Df4,Ra1", "re4,ra8,ee8"), 2);
            const byDog = click(dog, "e4", "e5", "advanced");
            expect(played(dog, byDog.move).board.get("e4")).to.deep.equal(["D", 1]);
            expect(byDog.message).not.to.contain(ambiguous(2));
            // a cat anywhere, of either colour, and neither the dog nor the horse is one rank above it
            const gap = withDie(position("Hd4,Df4,Ra1", "re4,ra8,ee8,cb8"), 2);
            const either = click(gap, "e4", "e5", "advanced");
            expect(either.complete).to.equal(0);
            expect(either.message).to.contain(ambiguous(2));
        });

        it("prefers a right-sized push before leaving enemy pieces, and not its own, beside a piece one rank stronger", () => {
            // two steps: the cat's push is the right-sized one, though it
            // leaves the cat beside the enemy dog, while the dog's push would
            // leave the rabbit on d5 beside the cat
            const g = withDie(position("Cd4,Df4,Ra1", "re4,rd5,de3,ra8,ee8"), 2);
            const pushed = click(g, "e4", "e5", "advanced");
            expect(played(g, pushed.move).board.get("e4")).to.deep.equal(["C", 1]);
            expect(pushed.message).not.to.contain(ambiguous(2));
            // between two right-sized pushes, the cat that stays put is better
            // not left beside the enemy dog (the rabbit on f5 keeps it unfrozen)
            const twins = withDie(position("Cd4,Cf4,Rf5,Ra1", "re4,dg4,ra8,ee8"), 2);
            const either = click(twins, "e4", "e5", "advanced");
            const after = played(twins, either.move);
            expect(after.board.get("e4")).to.deep.equal(["C", 1]);
            expect(after.board.has("f4")).to.equal(false);
            expect(either.message).not.to.contain(ambiguous(2));
        });

        it("lists the steps of the move shown where the notation alone reads otherwise", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            const move = enter(g, "advanced", ["d4", "d6"]);
            // by themselves the tokens mean the shorter move, in which the rabbit makes way
            expect(g.clone().move("Ed4d6", {partial: true}).board.has("d5")).to.equal(false);
            expect(said(move)).to.deep.equal(["Ed4d6"]);
            expect(listed(move).length).to.be.greaterThan(0);
            expect(move.split(" ").slice(1)).to.deep.equal(listed(move));
            // with the steps, it is notation that reads one way only
            expect(resolve(g.board, 1, 4, parseMove(move).tokens, false).status).to.equal("resolved");
            expect(g.validateMove(move).message).not.to.contain(ambiguous(2));
            // what is stored is the usual notation, and it reads back the same
            const after = played(g, move);
            expect(after.lastmove).to.equal("Ed6 Rd5");
            expect(resolve(g.board, 1, 4, parseMove(after.lastmove!).tokens, false).status).to.equal("resolved");
            expect(g.clone().move(after.lastmove!).signature()).to.equal(after.signature());
            // so is a completion by click
            const done = click(g, move, "h8", "advanced");
            expect(done.complete).to.equal(1);
            expect(done.move).to.equal("Ed6 Rd5");
            // an entry the notation reads the same way lists nothing
            expect(enter(g, "advanced", ["a1", "a2"])).to.equal("Ra1a2");
        });

        it("goes by what was said, not by the steps it listed", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            const round = enter(g, "advanced", ["d4", "d6"]);
            // a fifth step is too many: now the rabbit in the way makes room
            const both = click(g, enter(g, "advanced", ["a1"], round), "a2", "advanced");
            expect(said(both.move)).to.deep.equal(["Ed4d6", "Ra1a2"]);
            expect(both.message).to.contain("Rd5");
            const after = played(g, both.move);
            expect(after.board.get("d6")).to.deep.equal(["E", 1]);
            expect(after.board.get("a2")).to.deep.equal(["R", 1]);
            expect(after.board.has("d5")).to.equal(false);
            // undo takes back what was said last, and the elephant walks round again
            expect(click(g, both.move, "a8", "advanced").move).to.equal(round);
            expect(click(g, round, "a8", "advanced").move).to.equal("");
        });

        it("takes steps that were typed or entered in Basic as saying where the pieces end up", () => {
            const g = position("Ed4,Rd5,Ra1", "ra8,ee8");
            const basic = enter(g, "basic", ["d5", "e5", "d4", "d6"]);
            expect(basic).to.equal("Rd5e Ed4nn");
            // neither piece is walked back to where it started
            const move = enter(g, "advanced", ["a1", "a2"], basic);
            expect(said(move)).to.have.members(["Rd5e5", "Ed4d6", "Ra1a2"]);
            const after = played(g, move);
            expect(after.board.get("d6")).to.deep.equal(["E", 1]);
            expect(after.board.get("e5")).to.deep.equal(["R", 1]);
            expect(after.board.get("a2")).to.deep.equal(["R", 1]);
        });
    });

    describe("Advanced target clicks", () => {
        it("take a rabbit to goal before pushing an enemy piece there", () => {
            const g = position("Re7,Dd7,Ra1", "cd8,ra8,ee5");
            const goal = click(g, "", "e8", "advanced");
            expect(goal.move).to.equal("Re7e8");
            expect(played(g, goal.move).winner).to.deep.equal([1]);
            // one rank short of goal, the enemy piece is preferred as before
            const lower = position("Re6,Dd6,Ra1", "cd7,ra8,ee4");
            const pushed = click(lower, "", "e7", "advanced");
            expect(said(pushed.move)).to.deep.equal(["cd7e7"]);
            const after = played(lower, pushed.move);
            expect(after.board.get("e7")).to.deep.equal(["C", 2]);
            expect(after.board.get("e6")).to.deep.equal(["R", 1]);
            // and the dog that pushed is back where it started
            expect(after.board.get("d6")).to.deep.equal(["D", 1]);
        });

        it("take one of two rabbits to goal where nothing else separates them, though short of goal such a tie chooses neither", () => {
            // either rabbit reaches e8 in two steps, and the two moves are alike in everything else
            const g = position("Rd7,Rf7,Ra1", "ra8,eh8");
            const goal = click(g, "", "e8", "advanced");
            expect(said(goal.move)).to.have.length(1);
            expect(["Rd7e8", "Rf7e8"]).to.include(said(goal.move)[0]);
            expect(goal.message).to.contain(ambiguous(2));
            expect(click(g, "", "e8", "advanced").move).to.equal(goal.move);
            expect(played(g, goal.move).winner).to.deep.equal([1]);
            // a row lower the same tie is no win, and the click chooses neither
            const lower = position("Rd5,Rf5,Ra1", "ra8,eh8");
            const none = click(lower, "", "e6", "advanced");
            expect(none.move).to.equal("");
            expect(none.complete).to.equal(-1);
        });

        it("prefer to leave enemy pieces, and not their own, beside a piece one rank stronger", () => {
            // one step: the cat or the dog can step between them, and nothing else separates the two moves
            const rabbit = withDie(position("Cd4,Df4,Ra1", "re5,ra8,ee8"), 1);
            expect(click(rabbit, "", "e4", "advanced").move).to.equal("Cd4e4");
            const cat = withDie(position("Cd4,Df4,Ra1", "ce5,ra8,ee8"), 1);
            expect(click(cat, "", "e4", "advanced").move).to.equal("Df4e4");
            // the cat would stand beside a dog; the rabbit is two ranks below it
            const dog = withDie(position("Cd4,Rf4,Ra1", "de5,ra8,ee8"), 1);
            expect(click(dog, "", "e4", "advanced").move).to.equal("Rf4e4");
            // where nothing separates them, the click chooses neither
            const same = withDie(position("Cd4,Cf4,Ra1", "re5,ra8,ee8"), 1);
            const none = click(same, "", "e4", "advanced");
            expect(none.move).to.equal("");
            expect(none.complete).to.equal(-1);
        });
    });

    describe("Advanced follows its two priority lists", () => {
        // What each list measures, worked out from every way of playing every
        // legal turn rather than by the engine's search.
        const displaced = (p: Play): number => [...p.paths].filter(([from, path]) => path.final !== from).length;
        const captured = (p: Play, owner: Owner): number => [...p.paths.values()].filter(path => path.captured && path.owner === owner).length;
        const wrong = (b: Board, side: Owner): number => [...b].filter(([cell, [pc, owner]]) => owner === side &&
            neighbours(cell).some(n => {
                const o = b.get(n);
                return o !== undefined && o[1] !== side && oneRankAbove(b, o[0], pc);
            })).length;
        const other = (player: Owner): Owner => player === 1 ? 2 : 1;
        // "prefer": keep the candidates with the best value
        const prefer = (plays: Play[], cost: (p: Play) => number): Play[] => {
            const best = Math.min(...plays.map(cost));
            return plays.filter(p => cost(p) === best);
        };
        const normalMove = (plays: Play[], player: Owner): Play[] => [
            displaced,
            (p: Play) => p.steps,
            (p: Play) => captured(p, player),
            (p: Play) => -captured(p, other(player)),
            (p: Play) => -p.rightSized,
            (p: Play) => wrong(p.board, player) - wrong(p.board, other(player)),
        ].reduce(prefer, plays);
        // also whether a rabbit of the player's goes to goal, which lets a tie be broken
        const targetSelection = (plays: Play[], player: Owner, target: string): {best: Play[]; goal: boolean} => {
            const brings = (p: Play, which: (path: Path) => boolean): boolean =>
                [...p.paths.values()].some(path => path.final === target && which(path));
            let left = plays.filter(p => brings(p, () => true));
            let goal = false;
            if (target[1] === (player === 1 ? "8" : "1")) {
                const rabbits = left.filter(p => brings(p, path => path.type === "R" && path.owner === player));
                goal = rabbits.length > 0;
                left = goal ? rabbits : left;
            }
            const enemy = left.filter(p => brings(p, path => path.owner !== player));
            left = enemy.length > 0 ? enemy : left;
            const best = [
                displaced,
                (p: Play) => p.steps,
                (p: Play) => captured(p, player),
                (p: Play) => -captured(p, other(player)),
                (p: Play) => -p.rightSized,
                (p: Play) => wrong(p.board, player) - wrong(p.board, other(player)),
            ].reduce(prefer, left);
            return {best, goal};
        };
        const positions = (plays: Play[]): Set<string> => new Set(plays.map(p => signature(p.board)));
        // whether a click's message says the move shown is one of several, whatever number it gives
        const hinted = (message: string): boolean => new RegExp(ambiguous(0).replace("0", "\\d+")).test(message);
        const squares = "abcdefgh".split("").flatMap(f => "12345678".split("").map(r => `${f}${r}`));
        // triangles clicked over all the positions together
        let offers = 0;
        after(() => expect(offers).to.be.greaterThan(3));
        const shown = (g: ArimaaGame, move: string): string => signature(g.clone().move(move, {partial: true}).board as Board);

        for (const [name, spec, player, steps] of [
            ["pushers of three ranks around a rabbit", "Cd4 Df4 He3 Ra1 re4 rd5 ee8", 1, 4],
            ["a rabbit and an enemy cat one step from goal", "Re7 Dd7 Cf7 cd8 rg8 de6", 1, 3],
            ["pieces beside two traps", "Rb3 Cc2 Ed3 Hf2 rc4 db4 ce3 rf4", 1, 3],
            ["no cats or dogs on the board", "Hd5 Me4 Rd3 rd4 re5 hc5 ef5", 1, 4],
            ["Silver to move, beside a trap", "Rc5 Cb6 Dd6 rc7 hb5 ed5 rc6", 2, 3],
            ["Silver's rabbit near goal", "Ee3 Rd1 Cf2 rd2 re2 hc2 df1", 2, 3],
            ["two rabbits a step from goal", "Rd7 Rf7 Me6 Ra1 cg8 rb8 dh6", 1, 3],
        ] as Array<[string, string, Owner, number]>) {
            it(name, function () {
                this.timeout(120000);
                const board = boardOf(spec);
                const plays = allPlays(board, player, steps);
                const g = ready(board, player);
                if (steps < 4) {
                    withDie(g, steps);
                }
                let sends = 0;
                let aimed = 0;
                // a piece is selected and sent to an empty square: the Normal Move list
                for (const [origin, [pc, owner]] of board) {
                    const selected = click(g, "", origin, "advanced").move;
                    expect(selected === origin, `selecting ${origin}`).to.equal(plays.some(p => (p.paths.get(origin)?.visited.length ?? 1) > 1));
                    for (const dest of selected === origin ? squares : []) {
                        const fit = plays.filter(p => p.paths.get(origin)?.final === dest);
                        if (board.has(dest) || fit.length === 0) {
                            continue;
                        }
                        const label = `${origin} to ${dest}`;
                        const r = click(g, selected, dest, "advanced");
                        expect(said(r.move), label).to.deep.equal([`${owner === 1 ? pc : pc.toLowerCase()}${origin}${dest}`]);
                        const wanted = positions(normalMove(fit, player));
                        expect([...wanted], `${label}: ${r.move}`).to.include(shown(g, r.move));
                        // the player is told when the list leaves more than one move and the one shown is only the first of them
                        expect(hinted(r.message), label).to.equal(wanted.size > 1);
                        // what is shown is what is played, and what is stored reads back as it
                        const after = g.clone().move(r.move);
                        expect(signature(after.board as Board), label).to.equal(shown(g, r.move));
                        expect(signature(g.clone().move(after.lastmove!).board as Board), `${label}: ${after.lastmove}`).to.equal(shown(g, r.move));
                        sends++;
                    }
                }
                // a trap's triangle is offered where the selected piece can end there both ways, and plays
                // the way a click on the square does not
                let triangles = 0;
                for (const [origin, [pc, owner]] of board) {
                    if (click(g, "", origin, "advanced").move !== origin) {
                        continue;
                    }
                    const offered = captureChoices(g.board, player, steps, origin);
                    for (const trap of ["c3", "f3", "c6", "f6"].filter(sq => !board.has(sq))) {
                        const ends = plays.filter(p => p.paths.get(origin)?.final === trap);
                        const dies = ends.filter(p => p.paths.get(origin)!.captured);
                        const lives = ends.filter(p => !p.paths.get(origin)!.captured);
                        const label = `${origin} to ${trap}`;
                        expect(offered.has(trap), label).to.equal(dies.length > 0 && lives.length > 0);
                        if (offered.has(trap)) {
                            const plain = click(g, origin, trap, "advanced");
                            const dying = positions(dies).has(shown(g, plain.move));
                            expect(offered.get(trap), label).to.equal(!dying);
                            const r = click(g, origin, trap, "advanced", dying ? ARIMAA_SPARE_CHOICE : ARIMAA_CAPTURE_CHOICE);
                            const letter = owner === 1 ? pc : pc.toLowerCase();
                            expect(said(r.move), label).to.deep.equal([`${letter}${origin}${trap}`, `${letter}${origin}${dying ? "o" : "x"}`]);
                            expect([...positions(normalMove(dying ? lives : dies, player))], `${label}: ${r.move}`).to.include(shown(g, r.move));
                            triangles++;
                        }
                    }
                }
                // an empty square is clicked with nothing selected: the Target Selection list
                for (const target of squares.filter(sq => !board.has(sq))) {
                    const {best, goal} = targetSelection(plays, player, target);
                    const wanted = positions(best);
                    const r = click(g, "", target, "advanced");
                    // a tie is broken only where a rabbit goes to goal, and the player is told of it
                    if (wanted.size === 1 || (wanted.size > 1 && goal)) {
                        expect(r.move, target).not.to.equal("");
                        expect([...wanted], `${target}: ${r.move}`).to.include(shown(g, r.move));
                        expect(hinted(r.message), target).to.equal(wanted.size > 1);
                        aimed++;
                    } else {
                        expect(r.move, target).to.equal("");
                    }
                }
                expect(sends).to.be.greaterThan(10);
                expect(aimed).to.be.greaterThan(5);
                offers += triangles;
            });
        }
    });

    describe("Advanced trap capture control", () => {
        const fresh = (g: ArimaaGame): ArimaaGame => new ArimaaGame(g.serialize());

        it("is one custom-glyph polygon, shown only for an Advanced selection that has both outcomes", () => {
            const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
            expect(captureAlternatives(g.board, g.currplayer, 4, "g2")).to.deep.equal(["f3"]);
            const before = g.serialize();
            const preview = g.clone().move("g2", {partial: true});
            const advanced = preview.render({inputMode: "advanced"});
            expect(advanced.legend?.[ARIMAA_CAPTURE_CHOICE]).to.include({orientation: "vertical"});
            const layers = advanced.pieces as string[][][];
            expect(layers).to.have.length(8);
            expect(layers[5][5]).to.deep.equal([ARIMAA_CAPTURE_CHOICE]); // f3
            expect(layers.flat(2).filter(key => key === ARIMAA_CAPTURE_CHOICE)).to.have.length(1);
            expect(g.serialize()).to.equal(before); // No virtual board occupant.

            // The control is absent from Basic and from idle Advanced previews.
            const basic = preview.render({inputMode: "basic"});
            expect(basic.glyphDefs).to.equal(undefined);
            expect(typeof basic.pieces).to.equal("string");
            expect(basic.legend?.[ARIMAA_CAPTURE_CHOICE]).to.equal(undefined);
            expect(preview.render().legend?.[ARIMAA_CAPTURE_CHOICE]).to.equal(undefined);
            const idle = g.render({inputMode: "advanced"});
            expect(idle.glyphDefs).to.equal(undefined);
            expect(typeof idle.pieces).to.equal("string");
        });

        it("is drawn as the other glyph where clicking it keeps the piece alive", () => {
            const g = position("Cg2,Rf1,Ra1", "ra8,ee8");
            const rep = g.clone().move("g2", {partial: true}).render({inputMode: "advanced"});
            expect(rep.legend?.[ARIMAA_SPARE_CHOICE]).to.include({orientation: "vertical"});
            expect(rep.legend?.[ARIMAA_CAPTURE_CHOICE]).to.equal(undefined);
            expect((rep.pieces as string[][][])[5][5]).to.deep.equal([ARIMAA_SPARE_CHOICE]); // f3
            // either key is the triangle's click
            expect(click(g, "g2", "f3", "advanced", ARIMAA_SPARE_CHOICE).move).to.equal(click(g, "g2", "f3", "advanced", ARIMAA_CAPTURE_CHOICE).move);
        });

        it("reaches render() through the click result, on a game object that never saw the click", () => {
            const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
            const selected = click(g, "", "g2", "advanced");
            expect(selected.opts).to.deep.equal({inputMode: "advanced"});
            const shown = fresh(g).move(selected.move, {partial: true}).render(selected.opts);
            expect(shown.legend?.[ARIMAA_CAPTURE_CHOICE]).not.to.equal(undefined);
            // a Basic click carries no mode, so its preview has no control
            const basic = click(g, "", "g2", "basic");
            expect(basic.opts).to.equal(undefined);
            const plain = fresh(g).move(basic.move, {partial: true}).render(basic.opts);
            expect(plain.legend?.[ARIMAA_CAPTURE_CHOICE]).to.equal(undefined);
        });

        it("captures an own piece on the trap, where the square itself keeps it alive", () => {
            const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
            const ordinary = click(g, "g2", "f3", "advanced");
            expect(ordinary.move).to.equal("Cg2f3");
            expect(played(g, ordinary.move).board.get("f3")).to.deep.equal(["C", 1]);

            // The renderer reports (row,col,legendKey) for a custom board
            // piece, exactly as for stock sheet pieces.
            const special = click(g, "g2", "f3", "advanced", ARIMAA_CAPTURE_CHOICE);
            expect(special.valid).to.equal(true);
            expect(said(special.move)).to.deep.equal(["Cg2f3", "Cg2x"]);
            // The rabbit beside the trap has to leave for the cat to die,
            // and then comes back: nothing was said of it.
            expect(special.complete).to.equal(0);
            const captured = played(g, special.move);
            expect(captured.board.has("f3")).to.equal(false);
            expect(captured.board.get("f2")).to.deep.equal(["R", 1]);
            expect(captured.results.some(r => r.type === "destroy" && r.where === "f3" && r.what === "C")).to.equal(true);
            expect(captured.lastmove).not.to.contain("o");
            // sent somewhere, it stays there
            const withRabbit = enter(g, "advanced", ["f2", "e2"], special.move);
            expect(said(withRabbit)).to.deep.equal(["Cg2f3", "Cg2x", "Rf2e2"]);
            const away = played(g, withRabbit);
            expect(away.board.get("e2")).to.deep.equal(["R", 1]);
            expect(away.board.has("f3")).to.equal(false);

            // Forged or out-of-mode custom-piece clicks must do nothing.
            expect(click(g, "g2", "f3", "basic", ARIMAA_CAPTURE_CHOICE).move).to.equal("g2");
            expect(click(g, "g2", "c3", "advanced", ARIMAA_CAPTURE_CHOICE).move).to.equal("g2");
        });

        it("is not offered because some other piece of the same kind could meet it", () => {
            // The rabbit on d3 dies on f3 whatever else happens. The other
            // rabbit could cross d3 after it and live, which is another matter.
            const g = ready(boardOf("Hb5 Re5 dc3 ed6 me7 rd3 rd5"), 2);
            expect(click(g, "", "d3", "advanced").move).to.equal("d3");
            expect(captureAlternatives(g.board, 2, 4, "d3")).to.deep.equal([]);
            const sent = click(g, "d3", "f3", "advanced");
            expect(said(sent.move)).to.deep.equal(["rd3f3"]);
            expect(played(g, sent.move).board.has("f3")).to.equal(false);
            // a forged click on the triangle does nothing
            expect(click(g, "d3", "f3", "advanced", ARIMAA_CAPTURE_CHOICE).move).to.equal("d3");
        });

        it("keeps an enemy piece alive on the trap, where the square itself captures it", () => {
            // The dog pushed onto f3 dies unless its rabbit comes up beside
            // the trap, which takes a second push.
            const g = position("Ef5,Hg5,Ra1", "df4,rg4,ra8,ee8");
            const squares = ["f5", "f4"];
            const selection = enter(g, "advanced", squares);
            expect(captureAlternatives(g.board, 1, 4, selection)).to.deep.equal(["f3"]);
            const captured = played(g, enter(g, "advanced", [...squares, "f3"]));
            expect(captured.board.has("f3")).to.equal(false);
            const spared = enter(g, "advanced", [...squares, "^f3"]);
            expect(spared).to.contain("df4o");
            const after = played(g, spared);
            expect(after.board.get("f3")).to.deep.equal(["D", 2]);
            expect(after.lastmove).not.to.contain("o");
            // the stored notation replays to the same position
            expect(g.clone().move(after.lastmove!).signature()).to.equal(after.signature());
        });
    });

    describe("Advanced trap control for a piece already on a trap", () => {
        // the dog can walk round the rabbit, or push it aside and pull it
        // back, which leaves the elephant on c3 alone long enough to die
        const elephant = (): ArimaaGame => ready(boardOf("Ha3 Rd3 Ec3 dd2 Rh1 rh8"), 2);
        const walkRound = (g: ArimaaGame): string => g.clone().move("dd2e2, de2e3, de3e4, de4d4", {trusted: true}).signature();

        it("selects an enemy piece the move shown captures, and its triangle keeps it alive", () => {
            const g = elephant();
            const sent = enter(g, "advanced", ["d2", "d4"]);
            expect(g.clone().move(sent, {partial: true}).board.has("c3")).to.equal(false);
            // the elephant is not drawn, but its square selects it
            const selected = click(g, sent, "c3", "advanced");
            expect(selected.move).to.equal(`${sent} c3`);
            expect(captureAlternatives(g.board, 2, 4, selected.move)).to.deep.equal(["c3"]);
            const spared = click(g, selected.move, "c3", "advanced", ARIMAA_CAPTURE_CHOICE);
            expect(said(spared.move)).to.deep.equal(["dd2d4", "Ec3o"]);
            const after = played(g, spared.move);
            expect(after.signature()).to.equal(walkRound(g));
            expect(after.lastmove).not.to.match(/o( |$)/);
            // a click on the square itself just deselects it
            expect(click(g, selected.move, "c3", "advanced").move).to.equal(sent);
        });

        it("goes the other way from the move shown each time, moving nothing where that is how things stand", () => {
            const g = elephant();
            // nothing entered: the elephant stands, so its triangle captures it
            expect([...captureChoices(g.board, 2, 4, "c3")]).to.deep.equal([["c3", true]]);
            const doomed = enter(g, "advanced", ["c3", "^c3"]);
            expect(said(doomed)).to.deep.equal(["Ec3x"]);
            expect(g.clone().move(doomed, {partial: true}).board.has("c3")).to.equal(false);
            // now that it dies, the triangle keeps it alive, which is how things stood
            expect([...captureChoices(g.board, 2, 4, `${doomed} c3`)]).to.deep.equal([["c3", false]]);
            const spared = enter(g, "advanced", ["c3", "^c3"], doomed);
            expect(spared).to.equal("Ec3o");
            expect(g.validateMove(spared).complete).to.equal(-1);
            expect(played(g, enter(g, "advanced", ["d2", "d4"], spared)).signature()).to.equal(walkRound(g));
        });

        it("keeps an own piece alive where it would die, and has an enemy piece die where it would live", () => {
            // the cat sent alone onto f3 dies there; its triangle brings the rabbit up beside it
            const cat = position("Cg2,Rf1,Ra1", "ra8,ee8");
            expect(played(cat, enter(cat, "advanced", ["g2", "f3"])).board.has("f3")).to.equal(false);
            expect([...captureChoices(cat.board, 1, 4, "g2")]).to.deep.equal([["f3", false]]);
            const kept = enter(cat, "advanced", ["g2", "^f3"]);
            expect(said(kept)).to.deep.equal(["Cg2f3", "Cg2o"]);
            const alive = played(cat, kept);
            expect(alive.board.get("f3")).to.deep.equal(["C", 1]);
            expect(alive.lastmove).not.to.match(/o( |$)/);
            // the dog pushed onto f3 lives beside its rabbit; the triangle has the horse pull the rabbit away
            const dog = position("Ef5,Hh3,Ra1", "df4,rg3,ra8,ee8");
            expect(played(dog, enter(dog, "advanced", ["f5", "f4", "f3"])).board.get("f3")).to.deep.equal(["D", 2]);
            expect([...captureChoices(dog.board, 1, 4, "f5 f4")]).to.deep.equal([["f3", true]]);
            const killed = played(dog, enter(dog, "advanced", ["f5", "f4", "^f3"]));
            expect(killed.board.has("f3")).to.equal(false);
            expect(killed.board.get("f4")).to.deep.equal(["E", 1]);
        });

        it("has an own piece captured where it stands", () => {
            const g = position("Cf3,Rf2,Ra1", "ra8,ee8");
            const move = enter(g, "advanced", ["a1", "a2", "f3", "^f3"]);
            expect(said(move)).to.deep.equal(["Ra1a2", "Cf3x"]);
            const after = played(g, move);
            expect(after.board.has("f3")).to.equal(false);
            expect(after.board.get("a2")).to.deep.equal(["R", 1]);
            // its friend steps away and back: nothing was said of it
            expect(after.board.get("f2")).to.deep.equal(["R", 1]);
        });

        it("offers nothing for a piece on a trap whose fate is settled", () => {
            // no gold piece can reach the silver dog's only friend
            const g = position("Ra1,Rh1", "dc6,rc7,ee8");
            expect(click(g, "", "c6", "advanced").move).to.equal("");
            expect(captureAlternatives(g.board, 1, 4, "c6")).to.deep.equal([]);
        });
    });

    describe("notation", () => {
        it("keeps the cat alive when the rabbit reaches e3 before the cat reaches f3", () => {
            const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
            g.move("Cg2f3 Rf2e3");
            expect(g.board.get("f3")).to.deep.equal(["C", 1]);
            expect(g.board.get("e3")).to.deep.equal(["R", 1]);
        });

        it("treats a same-square token as an assertion, not an obligatory round-trip", () => {
            const g = position("Ed4,Ra1", "ra8,ee8");
            const result = g.validateMove("Ed4d4 Ra1a2");
            expect(result.valid).to.equal(true);
            const before = g.clone();
            g.move("Ed4d4 Ra1a2");
            expect(g.board.get("d4")).to.deep.equal(["E", 1]);
            expect(g.board.get("a2")).to.deep.equal(["R", 1]);
            const replay = before.clone();
            replay.move(g.lastmove!);
            expect(replay.signature()).to.equal(g.signature());
        });

        it("compares a move entered in either mode, or typed, as the same move", () => {
            // what premoves rely on: the stored move matches however it was entered
            const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
            const basic = enter(g, "basic", ["d4", "e4", "e5", "a1", "a2"]);
            const advanced = enter(g, "advanced", ["d4", "e4", "e5", "a1", "a2"]);
            expect(basic).not.to.equal(advanced);
            const after = played(g, basic);
            for (const other of [advanced, "re5 Ee4 Ra2", "re4e5, Ed4e4, Ra1a2", after.lastmove!]) {
                expect(after.sameMove(basic, other), other).to.equal(true);
                expect(played(g, other).signature(), other).to.equal(after.signature());
            }
            expect(after.sameMove(basic, "re5 Ee4")).to.equal(false);
        });
    });

    describe("every legal turn can be entered", () => {
        const TRAPS = ["c3", "f3", "c6", "f6"];
        const legacy = (g: ArimaaGame, steps: Array<[string, string]>): string => {
            const board = new Map(g.board);
            return steps.map(([from, to]) => {
                const [pc, owner] = board.get(from)!;
                board.set(to, board.get(from)!);
                board.delete(from);
                return `${owner === 1 ? pc : pc.toLowerCase()}${from}${to}`;
            }).join(", ");
        };
        // The clicks for a step list: a piece and where its run of steps
        // ends; pusher, pushed piece and where that goes; pulled piece,
        // puller and where that goes.
        // How a push or pull is clicked. As a "chain": pusher, pushed piece
        // and where that goes; pulled piece, puller and where that goes. As
        // "steps", its two steps in the order they happen: the pushed piece
        // and where it goes, then a click on the pusher; the puller and where
        // it goes, then the pulled piece and the square the puller left.
        // "Merged" is "steps" with arrows as long as they can be: a puller's
        // walk up to the pull is one arrow, whose route Basic picks for itself,
        // and a pull and the push of the same piece that follows it are one
        // arrow for that piece, as in a flip.
        type Form = "chain" | "steps" | "merged";
        const clicksFor = (g: ArimaaGame, steps: Array<[string, string]>, form: Form = "chain"): string[][] => {
            const owner = new Map([...g.board].map(([cell, [, o]]): [string, number] => [cell, o]));
            const mine = (sq: string): boolean => owner.get(sq) === g.currplayer;
            const go = (from: string, to: string): void => {
                owner.set(to, owner.get(from)!);
                owner.delete(from);
            };
            const out: string[][] = [];
            // the groups that are one piece's walk
            const walks = new Set<string[]>();
            // where the piece pulled by the last group now stands
            let pulledTo: string | undefined;
            for (let i = 0; i < steps.length; i++) {
                const [from, to] = steps[i];
                const next = steps[i + 1];
                if (next !== undefined && next[1] === from && owner.has(next[0]) && mine(next[0]) !== mine(from)) {
                    const pull = mine(from);
                    const last = out[out.length - 1];
                    if (form === "chain") {
                        out.push([next[0], from, to]);
                    } else if (pull && form === "merged" && last !== undefined && walks.has(last) && last[1] === from) {
                        // the puller's walk goes on to its last step
                        last[1] = to;
                        walks.delete(last);
                        out.push([next[0], from]);
                    } else if (pull) {
                        out.push([from, to, next[0], from]);
                    } else if (form === "merged" && pulledTo === from && last !== undefined) {
                        // the pulled piece's arrow goes on to where it is pushed
                        last[last.length - 1] = to;
                        last.push(next[0]);
                    } else {
                        out.push([from, to, next[0]]);
                    }
                    pulledTo = pull ? from : undefined;
                    go(from, to);
                    go(next[0], next[1]);
                    i++;
                    continue;
                }
                pulledTo = undefined;
                const last = out[out.length - 1];
                if (last !== undefined && walks.has(last) && last[1] === from) {
                    last[1] = to;
                } else {
                    const walk = [from, to];
                    walks.add(walk);
                    out.push(walk);
                }
                go(from, to);
            }
            return out;
        };
        // plain clicks, and in Advanced each variant that clicks one trap
        // destination's triangle instead, or that ends by selecting the piece
        // on that trap and clicking its triangle there
        const sequences = (clicks: string[][], mode: Mode): string[][] => {
            const seqs = [clicks.flat()];
            if (mode === "advanced") {
                clicks.forEach((group, i) => {
                    const trap = group[group.length - 1];
                    if (TRAPS.includes(trap)) {
                        seqs.push(clicks.map((c, j) => j === i ? [...c.slice(0, -1), `^${trap}`] : c).flat());
                        seqs.push([...clicks.flat(), trap, `^${trap}`]);
                    }
                });
            }
            return seqs;
        };
        for (const [name, spec, player] of [
            ["a frozen-piece tangle", "Ed5,Mf5,Rd3,Ra1,me5,rd4,rf4,ee8,ra8", 2],
            ["a rabbit near goal", "Eb2,Hc4,Rh1,Ra1,rb1,rc2,ed8,ra8", 2],
            ["pieces dying on a trap", "Rb4,Ec2,rc4,ee8,Ra1", 1],
            ["pushes and pulls in the open", "Dd4,Ra1,re4,cd5,ra8,ee8", 1],
            ["Silver pushing and pulling beside a trap", "ed5,ra8,Re5,Cd4,Ra1,Ee1", 2],
        ] as Array<[string, string, Owner]>) {
            for (const mode of MODES) {
                it(`${mode}: ${name}`, function () {
                    this.timeout(120000);
                    const reachable = allTurns(boardOf(spec.replace(/,/g, " ")), player, 4);
                    expect(reachable.size).to.be.greaterThan(20);
                    const missed: string[] = [];
                    // Basic also takes every push and pull as its steps in turn
                    for (const form of mode === "basic" ? ["chain", "steps", "merged"] as const : ["chain"] as const) {
                        for (const stepLists of reachable.values()) {
                            const g = ready(boardOf(spec.replace(/,/g, " ")), player);
                            const target = g.clone().move(legacy(g, stepLists[0]), {trusted: true, partial: true}).signature();
                            const entered = stepLists.some(steps => sequences(clicksFor(g, steps, form), mode).some(seq => {
                                let move = "";
                                for (const sq of seq) {
                                    const r = click(g, move, sq.replace("^", ""), mode, sq.startsWith("^") ? ARIMAA_CAPTURE_CHOICE : undefined);
                                    if (r.valid) {
                                        move = r.move;
                                    }
                                }
                                const v = g.validateMove(move);
                                return v.valid && (v.complete ?? -1) >= 0 &&
                                    g.clone().move(move).signature() === target;
                            }));
                            if (!entered) {
                                missed.push(`${form}: ${legacy(g, stepLists[0])}`);
                            }
                        }
                    }
                    expect(missed, missed.slice(0, 5).join("; ")).to.deep.equal([]);
                });
            }
        }
    });
});
