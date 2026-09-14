import { columnLabelToIndex, indexToColumnLabel } from "../../common/columnLabels.js";
import { HexFieldGraph } from "../../common/graphs/index.js";

export class StorisendeGraph extends HexFieldGraph {
    public override coords2algebraic(x: number, y: number): string {
        return indexToColumnLabel(y) + (x + 1).toString();
    }

    public override algebraic2coords(cell: string): [number, number] {
        const match = cell.match(/^([a-z]+)(\d+)$/);
        if (match === null) {
            throw new Error(`The algebraic notation is invalid: ${cell}`);
        }
        const y = columnLabelToIndex(match[1]);
        const num = match[2];
        const x = Number(num);
        if (isNaN(x) || num === "") {
            throw new Error(`The column label is invalid: ${num}`);
        }
        return [x - 1, y];
    }
}
