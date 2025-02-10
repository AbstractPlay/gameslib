/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { PacruGame } from '../../src/games';
import { PacruGraph } from "../../src/games/pacru/graph";

describe("Pacru", () => {
    it ("Side effects detected", () => {
        const graph = new PacruGraph();
        let g = new PacruGame(2);
        let effects = g.getSideEffects("g9", "f8");
        expect(effects.size).equal(1);
        expect(effects.has("blChange")).to.be.true;
        for (const cell of graph.ctr2cells("e8")) {
            if (cell === "f8") {
                g.board.set("f8", {tile: 1});
            } else {
                g.board.set(cell, {tile: 2});
            }
        }
        effects = g.getSideEffects("g9", "f8");
        expect(effects.size).equal(1);
        expect(effects.has("blTransform")).to.be.true;
        for (const cell of graph.ctr2cells("e8")) {
            g.board.delete(cell);
        }
        g.board.set("e7", {tile: 1});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        expect(g.baseMoves().includes("g9-e7")).to.be.true;
        effects = g.getSideEffects("g9", "e7");
        expect(effects.size).equal(2);
        expect(effects.has("blChange")).to.be.true;
        expect(effects.has("connChange")).to.be.true;
        expect(g.board.has("f8")).to.be.false;
        g.executeMove("g9-e7(*)");
        const contents = g.board.get("f8");
        expect(contents).to.not.be.undefined;
        expect(contents!.tile).equal(1);

        // check that blChange is triggered after pincer, too
        g = new PacruGame(2);
        g.board.set("d9", {chevron: {owner: 1, facing: "S"}});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("i7", {tile: 1});
        g.board.set("e9", {tile: 1});
        g.board.set("e8", {tile: 1});
        g.board.set("e7", {tile: 1});
        g.board.set("d6", {chevron: {owner: 2, facing: "S"}});
        expect(g.baseMoves().includes("d9xd6")).to.be.true;
        effects = g.getSideEffects("d9", "d6", true);
        expect(effects.size).equal(1);
        expect(effects.has("blChange")).to.be.true;

        // check that blTransform is caught correctly after pincer
        g = new PacruGame(2);
        g.board.set("d9", {chevron: {owner: 1, facing: "S"}});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("i7", {tile: 1});
        g.board.set("e9", {tile: 1});
        g.board.set("e8", {tile: 1});
        g.board.set("e7", {tile: 1});
        for (const cell of graph.ctr2cells("e5")) {
            if (cell === "d6") {
                g.board.set("d6", {tile: 2, chevron: {owner: 2, facing: "S"}});
            } else {
                g.board.set(cell, {tile: 2});
            }
        }
        expect(g.baseMoves().includes("d9xd6")).to.be.true;
        effects = g.getSideEffects("d9", "d6", true);
        expect(effects.size).equal(1);
        expect(effects.has("blTransform")).to.be.true;
    });

    it ("Pincers detected and executed correctly", () => {
        const g = new PacruGame(2);
        g.board.set("e9", {chevron: {owner: 1, facing: "S"}});
        g.board.set("i9", {tile: 1});
        g.board.set("i8", {tile: 1});
        g.board.set("d9", {tile: 1});
        g.board.set("d8", {tile: 1});
        g.board.set("e7", {chevron: {owner: 2, facing: "S"}});
        expect(g.baseMoves().includes("e9xe7")).to.be.true;
        expect(g.baseMoves().includes("g9xe7")).to.be.true;
        g.executeMove("e9xe7");
        const contents = g.board.get("e7");
        expect(contents).to.not.be.undefined;
        expect(contents?.tile).equal(1);
        expect(contents?.chevron).to.not.be.undefined;
        expect(contents?.chevron?.owner).equal(1);
    });

    it ("Meetings detected", () => {
        // not enough enemy tiles
        const graph = new PacruGraph();
        let g = new PacruGame(2);
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g8", {tile: 1});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        g.executeMove("g9-g8");
        expect(g.isMeeting("g8")).to.be.false;

        // enough enemy tiles
        g = new PacruGame(2);
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g8", {tile: 1});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        for (const cell of graph.ctr2cells("e5")) {
            g.board.set(cell, {tile: 2});
        }
        g.executeMove("g9-g8");
        expect(g.isMeeting("g8")).to.be.true;

        // `to` doesn't have a tile
        g = new PacruGame(2);
        g.board.set("g9", {tile: 1, chevron: {owner: 1, facing: "S"}});
        g.board.set("g7", {tile: 1, chevron: {owner: 1, facing: "N"}});
        for (const cell of graph.ctr2cells("e5")) {
            g.board.set(cell, {tile: 2});
        }
        g.executeMove("g9-g8");
        expect(g.isMeeting("g8")).to.be.false;
    });
});

