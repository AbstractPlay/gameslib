import { HexFieldGraph } from "../../common/graphs";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export class StorisendeGraph extends HexFieldGraph {
    public override coords2algebraic(x: number, y: number): string {
        return columnLabels[y] + (x + 1).toString();
    }

    public override algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = pair.slice(1).join("");
        const y = columnLabels.indexOf(pair[0]);
        if (y === undefined || y < 0) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const x = Number(num);
        if (x === undefined || isNaN(x) || num === "") {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x - 1, y];
    }
}