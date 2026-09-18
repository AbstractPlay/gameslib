/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    PieceId,
    Structure,
    cellOf,
    legalCellsFor,
    legalPalacePlacement,
    placeInto,
} from "../../src/games/icepalace/rules";
import { maximumBuild } from "../../src/games/icepalace/solver";

const palaceOf = (stacks: Record<string, PieceId[]>): Structure => {
    const struct: Structure = new Map();
    for (const [cell, stack] of Object.entries(stacks)) {
        struct.set(cell, [...stack]);
    }
    return struct;
};

/** Replays a plan against the building code so a reported maximum is never taken on trust. */
const replay = (palace: Structure, pieces: PieceId[], plan: ReturnType<typeof maximumBuild>): void => {
    const struct: Structure = new Map();
    for (const [cell, stack] of palace.entries()) {
        struct.set(cell, [...stack]);
    }
    const pool = [...pieces];
    for (const { piece, cell } of plan.sequence) {
        const idx = pool.indexOf(piece);
        expect(idx, `plan used ${piece}, which was not in the Yard`).to.be.greaterThan(-1);
        pool.splice(idx, 1);
        expect(
            legalPalacePlacement(struct, piece, cell),
            `plan placed ${piece} illegally at ${cell}`,
        ).to.be.true;
        placeInto(struct, piece, cell);
    }
    expect(plan.sequence.length).to.equal(plan.max);
};

const check = (palace: Structure, pieces: PieceId[], expected: number): void => {
    const plan = maximumBuild(palace, pieces);
    replay(palace, pieces, plan);
    expect(plan.max).to.equal(expected);
};

describe("Ice Palace: maximum build", () => {
    it("places nothing when the Yard held only Black and White", () => {
        check(palaceOf({ "0,0": ["1L"] }), [], 0);
    });

    it("stacks a whole large-medium-small tower into an empty Palace", () => {
        check(new Map(), ["1L", "2M", "3S"], 3);
    });

    it("cannot place a second medium with no large left to cover", () => {
        // Seed the large, cover it with one medium, and the other medium is stranded:
        // nothing larger is left to stack onto and its colour tops nothing.
        check(new Map(), ["1L", "2M", "3M"], 2);
    });

    it("finds the ordering that beats a greedy build", () => {
        // Covering the large with the small first strands the medium. The medium has to
        // go down first so the small has a medium to sit on.
        check(palaceOf({ "0,0": ["1L"] }), ["2S", "3M"], 2);
    });

    it("spends the only large top on one colour and strands the other", () => {
        check(palaceOf({ "0,0": ["1L"] }), ["2M", "3M"], 1);
    });

    it("regrows a large top by founding, enabling a second colour", () => {
        // Colour 2 is enabled off the existing large, then its own large is founded as a
        // fresh large top, which colour 3's medium can then use.
        check(palaceOf({ "0,0": ["1L"] }), ["2M", "2L", "3M"], 3);
    });

    it("founds without limit once a colour is enabled", () => {
        const pieces: PieceId[] = [];
        for (let i = 0; i < 12; i++) {
            pieces.push("1S");
        }
        check(palaceOf({ "0,0": ["1L"] }), pieces, 12);
    });

    it("strands colours that are absent when every open top is small", () => {
        check(palaceOf({ "0,0": ["1L", "1M", "1S"] }), ["2S", "2M", "3L"], 0);
    });

    it("places a large only when its own colour is already on an open top", () => {
        check(palaceOf({ "0,0": ["1L", "1M", "1S"] }), ["1L", "1L"], 2);
    });

    it("chains large to medium to small across three new colours", () => {
        check(palaceOf({ "0,0": ["1L"] }), ["2M", "3S"], 2);
    });

    it("opens an empty Palace with a medium when that beats leading with the large", () => {
        // Seeding the large only reaches four. Seeding 2M, covering it with 1S to enable
        // colour 1, then founding 1L as a fresh large top, carries 3M and 4S as well.
        check(new Map(), ["1L", "1S", "2M", "3M", "4S"], 5);
    });

    it("uses every pyramid when each colour has something small enough", () => {
        check(palaceOf({ "0,0": ["1L"], "1,0": ["1L"] }), ["2M", "2S", "3M", "3S"], 4);
    });

    it("keeps the Palace connected and never buries a small", () => {
        const palace = palaceOf({ "0,0": ["1L"] });
        const pieces: PieceId[] = ["1M", "1S", "1L", "2M"];
        const plan = maximumBuild(palace, pieces);
        replay(palace, pieces, plan);
        expect(plan.max).to.equal(4);
    });

    it("does not mutate the Palace it was handed", () => {
        const palace = palaceOf({ "0,0": ["1L"] });
        maximumBuild(palace, ["2M", "2S"]);
        expect(palace.size).to.equal(1);
        expect(palace.get(cellOf(0, 0))).to.deep.equal(["1L"]);
    });
});

/** Exhaustive search over every legal build order, for cross-checking small positions. */
const bruteForce = (palace: Structure, pieces: PieceId[]): number => {
    const memo = new Map<string, number>();

    const key = (struct: Structure, remaining: PieceId[]): string => {
        const cells = [...struct.keys()].map(c => {
            const parts = c.split(",");
            return [Number(parts[0]), Number(parts[1])] as [number, number];
        });
        const minX = Math.min(...cells.map(c => c[0]));
        const minY = Math.min(...cells.map(c => c[1]));
        const board = [...struct.entries()]
            .map(([c, stack]) => {
                const parts = c.split(",");
                return `${Number(parts[0]) - minX},${Number(parts[1]) - minY}:${stack.join("")}`;
            })
            .sort()
            .join("|");
        return `${board}//${[...remaining].sort().join(",")}`;
    };

    const search = (struct: Structure, remaining: PieceId[]): number => {
        if (remaining.length === 0) {
            return 0;
        }
        const memoKey = key(struct, remaining);
        const cached = memo.get(memoKey);
        if (cached !== undefined) {
            return cached;
        }
        let best = 0;
        for (const piece of new Set(remaining)) {
            for (const cell of legalCellsFor(struct, piece, legalPalacePlacement)) {
                const next: Structure = new Map();
                for (const [c, stack] of struct.entries()) {
                    next.set(c, [...stack]);
                }
                placeInto(next, piece, cell);
                const rest = [...remaining];
                rest.splice(rest.indexOf(piece), 1);
                best = Math.max(best, 1 + search(next, rest));
                if (best === remaining.length) {
                    memo.set(memoKey, best);
                    return best;
                }
            }
        }
        memo.set(memoKey, best);
        return best;
    };

    return search(palace, pieces);
};

describe("Ice Palace: maximum build matches exhaustive search", () => {
    const palaces: Record<string, Structure> = {
        "a lone large": palaceOf({ "0,0": ["1L"] }),
        "a lone small": palaceOf({ "0,0": ["1S"] }),
        "a finished tower": palaceOf({ "0,0": ["1L", "2M", "3S"] }),
        "two adjacent larges": palaceOf({ "0,0": ["1L"], "1,0": ["2L"] }),
        "a large beside a covered medium": palaceOf({ "0,0": ["1L"], "0,1": ["2L", "3M"] }),
    };

    const yards: PieceId[][] = [
        ["1S"],
        ["4L"],
        ["2M", "3M"],
        ["2M", "3S"],
        ["1S", "1M"],
        ["2L", "2S"],
        ["3M", "3S", "4M"],
        ["1M", "2S", "3L"],
        ["2S", "2S", "3M"],
    ];

    for (const [name, palace] of Object.entries(palaces)) {
        for (const yard of yards) {
            it(`${name} + [${yard.join(" ")}]`, () => {
                const plan = maximumBuild(palace, yard);
                replay(palace, yard, plan);
                expect(plan.max, "solver must never claim more than is reachable").to.equal(
                    bruteForce(palace, yard),
                );
            });
        }
    }
});
