import { HexFieldGraph } from "../../common/graphs";
import { Orientation, type HexOffset } from "honeycomb-grid";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export class ModularGraph extends HexFieldGraph {
    public orientation: Orientation;
    public offset: HexOffset;

    constructor(width: number, height: number, orientation: Orientation, offset: HexOffset) {
        super(width, height, orientation, offset);
        this.orientation = orientation;
        this.offset = offset;
    }

    public override coords2algebraic(x: number, y: number): string {
        let label = "";
        let idx = this.height - 1 - y;
        while (idx >= 0) {
            label = columnLabels[idx % 26] + label;
            idx = Math.floor(idx / 26) - 1;
        }
        return label + (x + 1).toString();
    }

    public override algebraic2coords(cell: string): [number, number] {
        const nidx = cell.search(/\d/);
        if (nidx < 0) {
            throw new Error(`Could not find an digit in the cell '${cell}'.`);
        }
        const letters = cell.substring(0, nidx);
        const num = cell.substring(nidx);
        let y = 0;
        for (let i = 0; i < letters.length; i++) {
            const char = letters[i];
            const val = columnLabels.indexOf(char);
            if (val < 0) {
                throw new Error(`The column label is invalid: ${letters}`);
            }
            y = y * 26 + (val + 1);
        }
        y -= 1;
        if (y < 0) {
            throw new Error(`The column label is invalid: ${letters}`);
        }
        const x = Number(num);
        if (x === undefined || isNaN(x) || num === "") {
            throw new Error(`The row label is invalid: ${num}`);
        }
        //  return [x - 1, y];
        return [x - 1, this.height - 1 - y];
    }
}