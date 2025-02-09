import { Direction, SquareDirectedGraph } from "../../common";

type Centre = "b2"|"b5"|"b8"|"e2"|"e5"|"e8"|"h2"|"h5"|"h8";

export class PacruGraph extends SquareDirectedGraph {
    public readonly centres: Centre[] = ["b2", "b5", "b8", "e2", "e5", "e8", "h2", "h5", "h8"];

    constructor() {
        super(9, 9);
    }

    public cell2ctr(cell: string): Centre {
        for (const node of [cell, ...this.graph.neighbors(cell)]) {
            if ((this.centres as string[]).includes(node)) {
                return node as Centre;
            }
        }
        throw new Error(`Could not find a centre cell related to ${cell}`);
    }

    public ctr2cells(cell: Centre): string[] {
        if (!this.centres.includes(cell)) {
            throw new Error(`${cell} is not a centre`);
        }
        return [cell, ...this.graph.neighbors(cell)];
    }

    public facing2dirs(facing: Direction): [Direction, Direction, Direction] {
        switch (facing) {
            case "N":
                return ["NW", "N", "NE"];
            case "NE":
                return ["N", "NE", "E"];
            case "E":
                return ["NE", "E", "SE"];
            case "SE":
                return ["E", "SE", "S"];
            case "S":
                return ["SE", "S", "SW"];
            case "SW":
                return ["S", "SW", "W"];
            case "W":
                return ["SW", "W", "NW"];
            case "NW":
                return ["W", "NW", "N"];
        }
    }
}
