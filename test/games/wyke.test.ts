import "mocha";
import { expect } from "chai";
import {
    AlfredsWykeGame,
    playerWhoPlayedBlockedMove,
    type playerid,
} from "../../src/games/wyke.js";
import type { AreaButtonBar, ButtonBarButton } from "@abstractplay/renderer/build/schemas/schema";

function buttonBar(rep: ReturnType<AlfredsWykeGame["render"]>): AreaButtonBar {
    const bar = rep.areas?.find((a) => a.type === "buttonBar") as AreaButtonBar | undefined;
    if (bar === undefined) {
        throw new Error("expected buttonBar area");
    }
    return bar;
}

function buttonForLabel(bar: AreaButtonBar, label: string): ButtonBarButton {
    const b = bar.buttons.find((btn) => btn.label === label);
    if (b === undefined) {
        throw new Error(`expected button ${label}`);
    }
    return b;
}

const selectedFill = {
    func: "flatten",
    fg: "_context_fill",
    bg: "_context_background",
    opacity: 0.5,
};

function cooldownFill(player: playerid) {
    return {
        func: "flatten",
        fg: { func: "custom", default: player, palette: player === 1 ? 3 : 4 },
        bg: "_context_background",
        opacity: 0.25,
    };
}

describe("Alfred's Wyke", () => {
    describe("playerWhoPlayedBlockedMove", () => {
        it("maps lastTwo slots to seats when it is player 1's turn", () => {
            expect(playerWhoPlayedBlockedMove(1, 1)).to.equal(2);
            expect(playerWhoPlayedBlockedMove(0, 1)).to.equal(1);
        });

        it("maps lastTwo slots to seats when it is player 2's turn", () => {
            expect(playerWhoPlayedBlockedMove(1, 2)).to.equal(1);
            expect(playerWhoPlayedBlockedMove(0, 2)).to.equal(2);
        });
    });

    describe("button bar fills", () => {
        it("highlights the move type during a partial ply", () => {
            const g = new AlfredsWykeGame();
            g.move("2-1-1()", { partial: true });
            const bar = buttonBar(g.render());
            expect(buttonForLabel(bar, "2-1-1").fill).to.deep.equal(selectedFill);
            expect(buttonForLabel(bar, "3-1").fill).to.equal(undefined);
        });

        it("clears selection after a completed ply", () => {
            const g = new AlfredsWykeGame();
            g.move("2-1-1()", { partial: true });
            expect(g.selectingMoveType).to.equal("2-1-1");
            g.move("2-1-1(a1,b1,c1)");
            expect(g.selectingMoveType).to.equal(undefined);
        });

        it("strikes through and tints the most recent blocked move type", () => {
            const g = new AlfredsWykeGame();
            g.move("4(a1)");
            expect(g.currplayer).to.equal(2);

            const bar = buttonBar(g.render());
            expect(buttonForLabel(bar, "4").fill).to.deep.equal(cooldownFill(1));
            expect(buttonForLabel(bar, "4").attributes).to.deep.equal([
                { name: "text-decoration", value: "line-through" },
            ]);
        });

        it("uses distinct cooldown colours per player on blocked move types", () => {
            const g = new AlfredsWykeGame();
            g.move("3-1(a1,b1)");
            g.move("2-2(c1,d1)");
            expect(g.currplayer).to.equal(1);
            expect(g.lastTwo).to.deep.equal(["3-1", "2-2"]);

            const bar = buttonBar(g.render());
            expect(buttonForLabel(bar, "3-1").fill).to.deep.equal(cooldownFill(1));
            expect(buttonForLabel(bar, "2-2").fill).to.deep.equal(cooldownFill(2));
        });
    });
});
