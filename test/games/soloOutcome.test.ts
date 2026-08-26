import "mocha";
import { expect } from "chai";
import {
    buildSoloBinaryRecord,
    buildSoloGradedRecord,
    buildSoloScoreRecord,
    buildSoloTimedRecord,
} from "../fixtures/solo/outcomeFakes";
import { evaluateGrade } from "../../src/games/_solo-outcome";

const recordDetails = {
    uid: "solo-test-uid",
    players: [{ name: "alice", uid: "user-alice" }],
    unrated: true,
};

describe("solo outcome genRecord", () => {
    it("archives binary pass with lower score-direction and challenge-seed", () => {
        const g = buildSoloBinaryRecord();
        const rec = g.genRecord(recordDetails)!;
        expect(rec.header["outcome-type"]).to.equal("binary");
        expect(rec.header["score-direction"]).to.equal("lower");
        expect(rec.header["score-label"]).to.equal("moves");
        expect(rec.header["challenge-seed"]).to.equal("20260819-042");
        expect(rec.header.players[0].score).to.equal(22);
        expect((rec.header.players[0] as { passed?: boolean }).passed).to.equal(true);
        expect(rec.header.players[0].result).to.equal(1);
    });

    it("archives graded tier with higher score-direction", () => {
        const g = buildSoloGradedRecord();
        const rec = g.genRecord(recordDetails)!;
        expect(rec.header["outcome-type"]).to.equal("graded");
        expect(rec.header["score-direction"]).to.equal("higher");
        expect(rec.header["score-label"]).to.equal("points");
        expect(rec.header.players[0].score).to.equal(73);
        expect((rec.header.players[0] as { grade?: string }).grade).to.equal("good");
        expect(rec.header.players[0].result).to.equal(1);
    });

    it("archives pure score with lower score-direction", () => {
        const g = buildSoloScoreRecord();
        const rec = g.genRecord(recordDetails)!;
        expect(rec.header["outcome-type"]).to.equal("score");
        expect(rec.header["score-direction"]).to.equal("lower");
        expect(rec.header.players[0].score).to.equal(14);
        expect(rec.header.players[0].result).to.equal(14);
    });

    it("archives timed elapsed ms with score-direction lower", () => {
        const g = buildSoloTimedRecord();
        const rec = g.genRecord(recordDetails)!;
        expect(rec.header["outcome-type"]).to.equal("timed");
        expect(rec.header["score-direction"]).to.equal("lower");
        expect(rec.header["score-label"]).to.equal("time");
        expect(rec.header["challenge-seed"]).to.equal("20260819-042");
        expect(rec.header.players[0].score).to.equal(184_000);
        expect(rec.header.players[0].result).to.equal(184_000);
    });
});

describe("evaluateGrade", () => {
    const tiers = [
        { id: "pass", label: "apgames:solo.tiers.pass", threshold: 20 },
        { id: "good", label: "apgames:solo.tiers.good", threshold: 15 },
        { id: "excellent", label: "apgames:solo.tiers.excellent", threshold: 10 },
    ];

    it("picks highest tier for lower-is-better scores", () => {
        expect(evaluateGrade(12, tiers, "lower")?.id).to.equal("good");
        expect(evaluateGrade(8, tiers, "lower")?.id).to.equal("excellent");
    });

    it("picks highest tier for higher-is-better scores", () => {
        const highTiers = [
            { id: "pass", label: "l", threshold: 50 },
            { id: "good", label: "l", threshold: 70 },
            { id: "excellent", label: "l", threshold: 90 },
        ];
        expect(evaluateGrade(73, highTiers, "higher")?.id).to.equal("good");
        expect(evaluateGrade(95, highTiers, "higher")?.id).to.equal("excellent");
    });
});
