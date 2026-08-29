import "mocha";
import { expect } from "chai";
import { parseSiteGameId } from "../fixtures/turnModel/siteGameId";

describe("parseSiteGameId", () => {
    it("parses legacy meta#uuid", () => {
        expect(parseSiteGameId("amazons#14dd0485-3b43-465d-9d21-d74750678dbe", "amazons")).to.deep.equal({
            metaGame: "amazons",
            id: "14dd0485-3b43-465d-9d21-d74750678dbe",
            variants: [],
        });
    });

    it("parses current id#meta: with empty variants", () => {
        expect(parseSiteGameId("7d779280-12b0-4907-a4e9-c2800b19bb5d#volcano:", "volcano")).to.deep.equal({
            metaGame: "volcano",
            id: "7d779280-12b0-4907-a4e9-c2800b19bb5d",
            variants: [],
        });
    });

    it("parses current id#meta:variant|variant", () => {
        expect(parseSiteGameId("abc00000-0000-4000-8000-000000000001#frogger:refills|skipto", "frogger")).to.deep.equal({
            metaGame: "frogger",
            id: "abc00000-0000-4000-8000-000000000001",
            variants: ["refills", "skipto"],
        });
    });
});
