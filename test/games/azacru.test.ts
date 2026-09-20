/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { AzacruGame } from "../../src/games/azacru";

function borderCrossingBaseMove(g: AzacruGame): string {
    for (const mv of g.baseMoves()) {
        const [from, to] = mv.split("-");
        if (g.getSideEffects(from, to).has("blChange")) {
            return mv;
        }
    }
    throw new Error("expected at least one border-crossing move from the opening position");
}

describe("Azacru", () => {
    it("allows Complete move after crossing a border (optional reorientation)", () => {
        const g = new AzacruGame(2);
        const base = borderCrossingBaseMove(g);
        const pending = `${base}*`;

        const validation = g.validateMove(pending);
        expect(validation.valid).to.be.true;
        expect(validation.complete).to.equal(0);

        const click = g.handleClick(pending, -1, -1);
        expect(click.valid).to.be.true;
        expect(click.move).to.equal(`${base}^`);
        expect(click.complete).to.equal(1);

        const afterStar = g.clone();
        afterStar.move(pending);
        const afterCaret = g.clone();
        afterCaret.move(`${base}^`);
        expect(afterStar.currplayer).to.equal(afterCaret.currplayer);
        expect(afterStar.board.get(base.split("-")[1]!)!.chevron!.facing)
            .to.equal(afterCaret.board.get(base.split("-")[1]!)!.chevron!.facing);
    });
});
