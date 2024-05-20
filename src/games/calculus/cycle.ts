import { playerid } from "../calculus";

type Vertex = [number,number];

export class Cycle {
    public readonly perimeter: Vertex[];
    public readonly owner: playerid;

    get id(): string {
        return this.perimeterIds.join("|");
    }
    get perimeterIds(): string[] {
        return this.perimeter.map(v => v.join(","));
    }
    get path(): string {
        let path = "";
        for (let i = 0; i < this.perimeter.length; i++) {
            const pt = this.perimeter[i];
            if (i === 0) {
                path += `M${pt.join(",")}`;
            } else {
                path += `L${pt.join(",")}`;
            }
        }
        path += "Z";
        return path;
    }

    constructor(p: Vertex[], owner: playerid) {
        this.perimeter = [...p.map(pt => [...pt] as Vertex)];
        this.owner = owner;
    }
}