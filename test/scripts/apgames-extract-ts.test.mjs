import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Project } from "ts-morph";
import { objectLiteralToPlain } from "../../scripts/lib/apgames-extract-ts.mjs";

describe("apgames-extract-ts", () => {
    it("objectLiteralToPlain reads nested string objects", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const source = project.createSourceFile(
            "x.ts",
            `const o = { validation: { A: "a" }, buttons: { pass: "Pass" } };`,
        );
        const decl = source.getVariableDeclaration("o");
        const plain = objectLiteralToPlain(decl.getInitializer());
        assert.deepEqual(plain, { validation: { A: "a" }, buttons: { pass: "Pass" } });
    });

    it("objectLiteralToPlain uses literal keys for quoted variant ids", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const source = project.createSourceFile(
            "x.ts",
            `const o = { variants: { "#board": { name: "Size-8 board" }, "size-9": { name: "Size-9 board" } } };`,
        );
        const decl = source.getVariableDeclaration("o");
        const plain = objectLiteralToPlain(decl.getInitializer());
        assert.deepEqual(plain.variants["#board"].name, "Size-8 board");
        assert.deepEqual(plain.variants["size-9"].name, "Size-9 board");
        assert.equal(Object.prototype.hasOwnProperty.call(plain.variants, '"size-9"'), false);
    });
});
