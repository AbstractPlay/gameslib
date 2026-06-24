import "mocha";
import { expect } from "chai";
import {
    columnLabels,
    generateColumnLabel,
    indexToColumnLabel,
    columnLabelToIndex,
} from "../../src/common";

describe("columnLabels", () => {
    it("should match the generator sequence", () => {
        const iter = generateColumnLabel(columnLabels.join(""));
        const labels: string[] = [];
        for (let i = 0; i < 30; i++) {
            labels.push(iter.next().value as string);
        }
        expect(labels[0]).to.equal("a");
        expect(labels[25]).to.equal("z");
        expect(labels[26]).to.equal("aa");
        expect(labels[29]).to.equal("ad");
        for (let i = 0; i < 30; i++) {
            expect(indexToColumnLabel(i)).to.equal(labels[i]);
            expect(columnLabelToIndex(labels[i]!)).to.equal(i);
        }
    });
});
