/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { QuaxGame, IQuaxState, IMoveState, playerid } from "../../src/games/quax";
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { IClickBoardContext, IHandleClickUi } from "../../src/games/_base";

const DIAMOND_DISPLAY = { altDisplays: ["diamond-board"] };

const SD_BOARD_CTX: IClickBoardContext = {
    boardStyle: "squares-diamonds",
    width: 11,
    height: 11,
};

const SD_CLICK_UI: IHandleClickUi = { board: SD_BOARD_CTX };

function quaxFrom(opts: {
    board: Array<[string, playerid]>;
    diags?: Array<[string, playerid]>;
    currplayer?: playerid;
    variants?: string[];
}): QuaxGame {
    const state: IQuaxState = {
        game: "quax",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack: [{
            _version: QuaxGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board: new Map(opts.board),
            diags: new Map(opts.diags ?? []),
            connPath: [],
        } as IMoveState],
    };
    return new QuaxGame(state);
}

function floodMarkers(rep: APRenderRep): Array<{ points: { row: number; col: number }[] }> {
    const markers = rep.board?.markers ?? [];
    return markers.filter((m): m is { type: "flood"; points: { row: number; col: number }[] } =>
        typeof m === "object" && m !== null && "type" in m && m.type === "flood");
}

function lineMarkers(rep: APRenderRep): unknown[] {
    const markers = rep.board?.markers ?? [];
    return markers.filter((m) => typeof m === "object" && m !== null && "type" in m && m.type === "line");
}

describe("Quax", () => {
    it("defaults to vertex render", () => {
        const g = quaxFrom({ board: [["e6", 1], ["f5", 1]], diags: [["e6-f5", 1]] });
        const rep = g.render();
        expect(rep.board?.style).to.equal("vertex");
    });

    it("diamond-board render uses flood markers for diags", () => {
        const g = quaxFrom({ board: [["e6", 1], ["f5", 1]], diags: [["e6-f5", 1]] });
        const rep = g.render(DIAMOND_DISPLAY);
        expect(rep.board?.style).to.equal("squares-diamonds");
        expect(lineMarkers(rep)).to.have.lengthOf(0);
        expect(floodMarkers(rep)).to.have.lengthOf(1);
    });

    it("maps a diag to stable diamond grid coordinates", () => {
        const g = quaxFrom({ board: [["e6", 1], ["f5", 1]], diags: [["e6-f5", 1]] });
        const sd = (g as unknown as { sdGraph: () => { algebraic2coords: (c: string) => [number, number] } }).sdGraph();
        const diamond = (g as unknown as { crossedDiamond: (a: string, b: string) => string }).crossedDiamond("e6", "f5");
        const [col, row] = sd.algebraic2coords(diamond);
        const flood = floodMarkers(g.render(DIAMOND_DISPLAY))[0]!;
        expect(flood.points[0]).to.deep.equal({ col, row });
    });

    it("enter annotation targets the diamond after a diag ply", () => {
        const g = new QuaxGame();
        g.board.set("e6", 1);
        g.board.set("f5", 1);
        g.currplayer = 1;
        g.move("e6-f5", { trusted: true });
        const rep = g.render(DIAMOND_DISPLAY);
        const enters = rep.annotations?.filter((a) => a.type === "enter") ?? [];
        const sd = (g as unknown as { sdGraph: () => { algebraic2coords: (c: string) => [number, number] } }).sdGraph();
        const diamond = (g as unknown as { crossedDiamond: (a: string, b: string) => string }).crossedDiamond("e6", "f5");
        const [col, row] = sd.algebraic2coords(diamond);
        expect(enters.some((a) => a.targets[0]?.col === col && a.targets[0]?.row === row)).to.be.true;
    });

    it("handleClick on diamond completes a legal connection", () => {
        const g = quaxFrom({ board: [["e6", 1], ["f5", 1]], currplayer: 1 });
        const sd = (g as unknown as { sdGraph: () => { algebraic2coords: (c: string) => [number, number] } }).sdGraph();
        const diamond = (g as unknown as { crossedDiamond: (a: string, b: string) => string }).crossedDiamond("e6", "f5");
        const [col, row] = sd.algebraic2coords(diamond);
        const click = g.handleClick("", row, col, undefined, SD_CLICK_UI);
        expect(click.valid).to.be.true;
        expect(click.complete).to.equal(1);
        expect(click.move).to.equal("e6-f5");
    });

    it("diamond-board square click uses SD grid with boardContext", () => {
        const g = new QuaxGame();
        const sdRowCol = (g as unknown as { sdRowColForSquare: (c: string) => { col: number; row: number } }).sdRowColForSquare("e8");
        const click = g.handleClick("", sdRowCol.row, sdRowCol.col, undefined, SD_CLICK_UI);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("e8");
    });

    it("diamond g7|h6 click connects g6 and h7 on the other diagonal of the 2x2", () => {
        const g = quaxFrom({
            board: [["d9", 1], ["g7", 2], ["e8", 1], ["g6", 2], ["h7", 2], ["e7", 1]],
            diags: [["d9-e8", 1]],
            currplayer: 2,
        });
        const sd = (g as unknown as { sdGraph: () => { algebraic2coords: (c: string) => [number, number] } }).sdGraph();
        const [col, row] = sd.algebraic2coords("g7|h6");
        const click = g.handleClick("", row, col, undefined, SD_CLICK_UI);
        expect(click.valid).to.be.true;
        expect(click.complete).to.equal(1);
        expect(click.move).to.equal("g6-h7");
    });

    it("diamond-board square click on g6 autofill connects to h7", () => {
        const g = quaxFrom({
            board: [["d9", 1], ["g7", 2], ["e8", 1], ["g6", 2], ["h7", 2], ["e7", 1]],
            diags: [["d9-e8", 1]],
            currplayer: 2,
        });
        const sdRowCol = (g as unknown as { sdRowColForSquare: (c: string) => { col: number; row: number } }).sdRowColForSquare("g6");
        const click = g.handleClick("", sdRowCol.row, sdRowCol.col, undefined, SD_CLICK_UI);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("g6-h7");
    });

    it("illegal diamond click returns validation message not generic handler", () => {
        const g = quaxFrom({ board: [["e6", 1], ["f5", 1]], currplayer: 1 });
        const sd = (g as unknown as { sdGraph: () => { algebraic2coords: (c: string) => [number, number] } }).sdGraph();
        const diamond = (g as unknown as { crossedDiamond: (a: string, b: string) => string | undefined }).crossedDiamond("e6", "f7");
        expect(diamond).to.not.equal(undefined);
        const [col, row] = sd.algebraic2coords(diamond!);
        const click = g.handleClick("", row, col, undefined, SD_CLICK_UI);
        expect(click.valid).to.be.false;
        expect(click.move).to.equal("");
        expect(click.message).to.not.match(/DEFAULT_HANDLER|GENERIC/i);
        expect(g.validateMove("e6-f7").message).to.equal(click.message);
    });

    it("vertex grid click resolves e9 not the SD square at the same row and col", () => {
        const g = new QuaxGame();
        const [x, y] = g.algebraic2coords("e9");
        const click = g.handleClick("", y, x);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("e9");
    });

    it("autofills a single legal diag from a square click", () => {
        const g = quaxFrom({ board: [["e6", 1], ["f5", 1]], currplayer: 1 });
        const [x, y] = g.algebraic2coords("e6");
        const click = g.handleClick("", y, x);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("e6-f5");
    });

    it("validateMove accepts place and diag moves", () => {
        const g = new QuaxGame();
        g.board.set("e6", 1);
        g.board.set("f5", 1);
        g.currplayer = 1;
        expect(g.validateMove("a1").valid).to.be.true;
        expect(g.validateMove("e6-f5").valid).to.be.true;
    });
});
