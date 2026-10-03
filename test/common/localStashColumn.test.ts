import { expect } from "chai";
import "mocha";
import {
    bagStashColumn,
    localStashKeysBottomFirst,
    stawvsStashColumn,
    volcanoStashColumn,
} from "../../src/common/localStashColumn.js";

describe("localStashColumn", () => {
    it("volcanoStashColumn emits dense 3D keys bottom to top", () => {
        const stack = [
            ["RD", 3],
            ["OG", 2],
            ["RD", 1],
        ] as const;
        expect(volcanoStashColumn(stack, false)).to.deep.equal(["RD3", "OG2", "RD1"]);
        expect(volcanoStashColumn(stack, false)).to.not.include("-");
    });

    it("volcanoStashColumn adds c suffix when expanding", () => {
        const stack = [
            ["PK", 3],
            ["PK", 2],
        ] as const;
        expect(volcanoStashColumn(stack, true)).to.deep.equal(["PK3c", "PK2c"]);
    });

    it("bagStashColumn maps pool pieces bottom to top", () => {
        const stack = [
            [1, 3],
            [1, 1],
        ] as const;
        const keys = bagStashColumn(stack, ([c, s]) => `C${c}S${s}`);
        expect(keys).to.deep.equal(["C1S3", "C1S1"]);
        expect(keys).to.not.include("-");
    });

    it("stawvsStashColumn appends c to each key", () => {
        expect(stawvsStashColumn([{ join: () => "OR3" }, { join: () => "OR2" }])).to.deep.equal([
            "OR3c",
            "OR2c",
        ]);
    });

    it("localStashKeysBottomFirst copies keys in order", () => {
        expect(localStashKeysBottomFirst(["a", "b"])).to.deep.equal(["a", "b"]);
    });
});
