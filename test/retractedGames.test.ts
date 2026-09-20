import { expect } from "chai";
import {
    archiveMetadataFor,
    getRetraction,
    isCatalogVisible,
    resolveRetractedMetaUidByName,
    shouldOmitFromRecords,
    shouldPublishStats,
} from "../src/retractedGames.js";

describe("retractedGames registry", () => {
    it("registers Binar with omit and hidden stats", () => {
        const entry = getRetraction("binar");
        expect(entry).to.not.equal(undefined);
        expect(entry!.availability).to.equal("hiddenAll");
        expect(entry!.recordsGeneration).to.equal("omit");
        expect(entry!.publishStats).to.equal(false);
        expect(shouldOmitFromRecords("binar")).to.equal(true);
        expect(shouldPublishStats("binar")).to.equal(false);
        expect(isCatalogVisible("binar", true)).to.equal(false);
        expect(isCatalogVisible("binar", false)).to.equal(false);
    });

    it("exposes archive metadata without designer URLs", () => {
        const meta = archiveMetadataFor("binar");
        expect(meta?.name).to.equal("Binar");
        expect(meta?.variants?.map((v) => v.uid)).to.deep.equal([
            "partisan",
            "size-5",
            "size-6",
        ]);
    });

    it("does not affect unknown meta games", () => {
        expect(getRetraction("loa")).to.equal(undefined);
        expect(shouldOmitFromRecords("loa")).to.equal(false);
        expect(shouldPublishStats("loa")).to.equal(true);
        expect(isCatalogVisible("loa", true)).to.equal(true);
    });

    it("resolves archive display names to uid", () => {
        expect(resolveRetractedMetaUidByName("Binar")).to.equal("binar");
        expect(resolveRetractedMetaUidByName("unknown")).to.equal(undefined);
    });
});
