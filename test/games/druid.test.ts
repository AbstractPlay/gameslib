/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { DruidGame, IDruidState, IMoveState, playerid } from "../../src/games/druid";
import { MarkerEdge } from "@abstractplay/renderer/build/schemas/schema";

type StackCell = [string, Array<{ kind: "sarsen"; owner: playerid }>];

function druidFrom(opts: {
    board: StackCell[];
    currplayer?: playerid;
    variants?: string[];
    version?: string;
    druid?: { 1?: string; 2?: string };
    druidSpawnEdge?: { 1?: "N" | "E" | "S" | "W"; 2?: "N" | "E" | "S" | "W" };
}): DruidGame {
    const version = opts.version ?? DruidGame.gameinfo.version;
    const state: IDruidState = {
        game: "druid",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack: [{
            _version: version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            stacks: new Map(opts.board),
            druid: opts.druid ?? {},
            druidSpawnEdge: opts.druidSpawnEdge ?? {},
            passCount: 0,
            nextLintelId: 1,
            connPath: [],
        } as IMoveState],
    };
    return new DruidGame(state);
}

function edgeMarkerColour(markers: MarkerEdge[] | undefined, edge: "N" | "E" | "S" | "W"): number | undefined {
    const colour = markers?.find(m => m.type === "edge" && m.edge === edge)?.colour;
    return typeof colour === "number" ? colour : undefined;
}

function horizontalBridge(missing: string): StackCell[] {
    return "abcdefghij".split("")
        .filter(c => `${c}5` !== missing)
        .map(c => [`${c}5`, [{ kind: "sarsen" as const, owner: 1 as const }]]);
}

function verticalBridge(missing: string): StackCell[] {
    return "1234567890".split("")
        .filter(r => `a${r}` !== missing)
        .map(r => [`a${r}`, [{ kind: "sarsen" as const, owner: 1 as const }]]);
}

describe("Druid rect side assignment", () => {
    it("renders legacy edge markers for games before 20260815", () => {
        const g = druidFrom({ board: [], version: "20260706" });
        const markers = (g.render().board as { markers?: MarkerEdge[] }).markers;
        expect(edgeMarkerColour(markers, "W")).to.equal(1);
        expect(edgeMarkerColour(markers, "E")).to.equal(1);
        expect(edgeMarkerColour(markers, "N")).to.equal(2);
        expect(edgeMarkerColour(markers, "S")).to.equal(2);
    });

    it("renders inverted edge markers for new games", () => {
        const g = new DruidGame();
        const markers = (g.render().board as { markers?: MarkerEdge[] }).markers;
        expect(edgeMarkerColour(markers, "W")).to.equal(2);
        expect(edgeMarkerColour(markers, "E")).to.equal(2);
        expect(edgeMarkerColour(markers, "N")).to.equal(1);
        expect(edgeMarkerColour(markers, "S")).to.equal(1);
    });

    it("awards a legacy horizontal bridge win to player 1", () => {
        const g = druidFrom({
            board: horizontalBridge("j5"),
            version: "20260706",
            currplayer: 1,
        });
        g.move("j5", { trusted: true });
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("does not award a legacy vertical bridge win to player 1", () => {
        const g = druidFrom({
            board: verticalBridge("a10"),
            version: "20260706",
            currplayer: 1,
        });
        g.move("a10", { trusted: true });
        expect(g.gameover).to.be.false;
    });

    it("awards an inverted vertical bridge win to player 1", () => {
        const g = druidFrom({
            board: verticalBridge("a10"),
            version: "20260815",
            currplayer: 1,
        });
        g.move("a10", { trusted: true });
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("does not award an inverted horizontal bridge win to player 1", () => {
        const g = druidFrom({
            board: horizontalBridge("j5"),
            version: "20260815",
            currplayer: 1,
        });
        g.move("j5", { trusted: true });
        expect(g.gameover).to.be.false;
    });

    it("spawns a druid on the north edge in inverted walk games", () => {
        const g = druidFrom({
            board: [],
            variants: ["walk"],
            version: "20260815",
            currplayer: 1,
        });
        g.move("a10", { trusted: true });
        expect(g.druid[1]).to.equal("a10");
        expect(g.druidSpawnEdge[1]).to.equal("N");
    });

    it("spawns a druid on the west edge in legacy walk games", () => {
        const g = druidFrom({
            board: [],
            variants: ["walk"],
            version: "20260706",
            currplayer: 1,
        });
        g.move("a5", { trusted: true });
        expect(g.druid[1]).to.equal("a5");
        expect(g.druidSpawnEdge[1]).to.equal("W");
    });

    it("renders no edge markers on hex boards regardless of version", () => {
        const g = druidFrom({
            board: [],
            variants: ["hex-5"],
            version: "20260815",
        });
        const markers = (g.render().board as { markers?: MarkerEdge[] }).markers;
        expect(markers ?? []).to.deep.equal([]);
    });
});
