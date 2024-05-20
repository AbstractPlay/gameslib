import { UndirectedGraph } from "graphology";
import { SquareGraph } from "./square";
import { SquareOrthGraph } from "./square-orth";
import { SquareDiagGraph } from "./square-diag";
import { SquareFanoronaGraph } from "./square-fanorona";
import { SnubSquareGraph } from "./snubsquare";
import { HexTriGraph } from "./hextri";
import { HexSlantedGraph } from "./hex-slanted";
import { BaoGraph } from "./bao";
import { SowingNoEndsGraph } from "./sowing-no-ends";
import { IGraph } from "./IGraph";

export { IGraph, SquareGraph, SquareOrthGraph, SquareDiagGraph, SquareFanoronaGraph, SnubSquareGraph, HexTriGraph, HexSlantedGraph, BaoGraph, SowingNoEndsGraph };

// export const findGraphCycles = (graph: UndirectedGraph): string[][] => {
//     const visited = new Set<string>();
//     const stack = new Set<string>();
//     const cycles: string[][] = [];

//     const dfs = (node: string, path: string[], initial: string|null = null) => {
//         // console.log(`\tDFS: node ${node}, path ${path.join("|")}`);
//         visited.add(node);
//         stack.add(node);
//         path.push(node);

//         for (const neighbor of graph.neighbors(node)) {
//             // console.log(`\t\tFound neighbor: ${neighbor}`);
//             if (!visited.has(neighbor) && neighbor !== initial) {
//                 // console.log(`\t\tContinuing the search`);
//                 dfs(neighbor, [...path], node);
//             } else if (stack.has(neighbor) && neighbor !== initial) {
//                 // console.log(`\t\tCycle found`);
//                 const cycle = [...path.slice(path.indexOf(neighbor)), neighbor];
//                 cycles.push(cycle);
//             }
//         }

//         stack.delete(node);
//     };

//     for (const node of graph.nodes()) {
//       if (!visited.has(node)) {
//         // console.log(`Starting a round of searches from ${node}`)
//         dfs(node, []);
//       }
//     }

//     return cycles;
// };

export const findGraphCycles = (g: UndirectedGraph): string[][] => {
    const cycles: string[][] = [];

    const normalizeList = (lst: string[]): string[] => {
        const scratch = [...lst];
        scratch.sort((a, b) => a.localeCompare(b));
        const min = scratch[0];
        const idx = lst.indexOf(min);
        if (idx === -1) {
            throw new Error(`Error occured while normalizing the list`);
        }
        return [...lst.slice(idx), ...lst.slice(0, idx)];
    }

    const invertList = (lst: string[]): string[] => {
        const newlst = [...lst];
        newlst.reverse();
        newlst.unshift(newlst.pop()!);
        return newlst;
    }

    const findNew = (lst: string[]) => {
        const start = lst[0];
        let next: string;
        let sub: string[];

        for (const edge of g.edges()) {
            const [node1, node2] = g.extremities(edge);
            if ([node1, node2].includes(start)) {
                if (node1 === start) {
                    next = node2;
                } else {
                    next = node1
                }
                // next is not yet on the path
                if (! lst.includes(next)) {
                    sub = [next, ...lst];
                    findNew(sub);
                }
                // cycle found
                else if (lst.length > 2 && lst[lst.length - 1] === next) {
                    // normalize list
                    const norm = normalizeList(lst);
                    // invert it
                    const inv = invertList(norm);
                    // make sure neither version is already known
                    const comp = cycles.map(c => c.join("|"));
                    if ( (! comp.includes(norm.join("|"))) && (! comp.includes(inv.join("|")))) {
                        cycles.push(norm);
                    }
                }
            }
        }
    }

    for (const edge of g.edges()) {
        for (const node of g.extremities(edge)) {
            findNew([node]);
        }
    }

    return cycles;
}
