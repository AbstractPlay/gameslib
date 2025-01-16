import { SquareGraph } from "./square";
import { SquareDirectedGraph } from "./square-directed";
import { SquareOrthGraph } from "./square-orth";
import { SquareDiagGraph } from "./square-diag";
import { SquareFanoronaGraph } from "./square-fanorona";
import { SnubSquareGraph } from "./snubsquare";
import { OnyxGraph } from "./onyx";
import { HexTriGraph } from "./hextri";
import { HexMoonGraph } from "./hexMoon";
import { HexSlantedGraph } from "./hex-slanted";
import { HexConeGraph } from "./hex-cone";
import { BaoGraph } from "./bao";
import { SowingNoEndsGraph } from "./sowing-no-ends";
import { IGraph } from "./IGraph";
import { IGraph3D } from "./IGraph3D";
import { Square3DGraph } from "./square-3d";
import { SquareOrth3DGraph } from "./square-orth-3d";
import { SquareDiag3DGraph } from "./square-diag-3d";
import { HexFieldGraph } from "./hex-field";

export { IGraph, IGraph3D, Square3DGraph, SquareGraph, SquareDirectedGraph, SquareOrth3DGraph, SquareOrthGraph, SquareDiag3DGraph, SquareDiagGraph, SquareFanoronaGraph, SnubSquareGraph, OnyxGraph, HexTriGraph, HexMoonGraph, HexSlantedGraph, HexConeGraph, HexFieldGraph, BaoGraph, SowingNoEndsGraph };

import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { PowerSet } from "js-combinatorics";
import { allSimplePaths } from "graphology-simple-path";

export const spanningTree = (g: UndirectedGraph): UndirectedGraph|null => {
    const components = connectedComponents(g);
    // Spanning trees can only be built for connected graphs
    if (components.length > 1) {
        return null;
    }

    const first = g.nodes()[0];
    const newg = new UndirectedGraph();
    newg.addNode(first);
    while (newg.nodes().length !== g.nodes().length) {
        for (const node of newg.nodes()) {
            let found = false;
            for (const n of g.neighbors(node)) {
                if (! newg.hasNode(n)) {
                    found = true;
                    newg.addNode(n);
                    newg.addEdge(node, n);
                    break;
                }
                if (found) { break; }
            }
        }
    }

    return newg;
}

export const fundamentalGraphCycles = (g: UndirectedGraph): string[][] => {
    const cycles: string[][] = [];

    // ensures edges are always presented in the same order
    const normalizeEdges = (inlst: string[]): string[] => {
        const normed: string[] = [];
        for (let i = 0; i < inlst.length - 1; i++) {
            const split = [inlst[i], inlst[i+1]];
            split.sort((a,b) => a.localeCompare(b));
            normed.push(split.join("|"));
        }
        return normed;
    }

    // Takes a cycle and converts it to a graph
    const cycle2graph = (inlst: string[]): UndirectedGraph => {
        // add each edge to a new graph
        const graph = new UndirectedGraph();
        for (const pair of inlst) {
            const [leftNode, rightNode] = pair.split("|");
            if (! graph.hasNode(leftNode)) {
                graph.addNode(leftNode);
            }
            if (! graph.hasNode(rightNode)) {
                graph.addNode(rightNode);
            }
            graph.addEdge(leftNode, rightNode);
        }
        return graph;
    }

    // ANDing 3+ base cycles doesn't work, so we need a special function.
    // There must only be one path to the node, and it must be the same length
    // as the total number of edges in the graph.
    const validMergedCycle = (inlst: string[]): boolean => {
        const graph = cycle2graph(inlst);
        if (graph.edges().length === 0) {
            return false;
        }
        const edge = graph.edges()[0];
        const [left, right] = graph.extremities(edge);
        const pathLens = allSimplePaths(graph, left, right).map(lst => lst.length);
        // console.log(`\t\tPath lengths: ${JSON.stringify(pathLens)}; Num edges: ${graph.edges().length}`);
        return (pathLens.length === 2 &&
                pathLens.includes(2) &&
                pathLens.includes(graph.edges().length)
        );
    }

    // Takes a list of present edges, builds the cycle,
    // and returns it in normalized order, not circular
    const unwindEdges = (inlst: string[]): string[] => {
        // add each edge to a new graph
        const graph = cycle2graph(inlst);
        // pick an edge, record the extremities, delete it
        // get the path, and normalize
        const edge = graph.edges()[0];
        const [left, right] = graph.extremities(edge);
        graph.dropEdge(edge);
        const path = bidirectional(graph, left, right)!;

        const scratch = [...path];
        scratch.sort((a, b) => a.localeCompare(b));
        const min = scratch[0];
        const idx = scratch.indexOf(min);
        if (idx === -1) {
            throw new Error(`Error occurred while normalizing the list`);
        }
        return [...path.slice(idx), ...path.slice(0, idx)];
    }

    const components = connectedComponents(g);
    for (const grp of components) {
        const bases: string[][] = [];
        const subset = g.copy();
        // eslint-disable-next-line @typescript-eslint/no-shadow
        for (const missing of g.nodes().filter(n => ! grp.includes(n))) {
            subset.dropNode(missing);
        }
        // const expectedBases = subset.edges().length - subset.nodes().length + 1;

        const st = spanningTree(subset);
        if (st === null) {
            throw new Error(`Could not form a spanning tree`);
        }

        const edgesOrig = subset.edges().map(e => normalizeEdges(subset.extremities(e)).join("|")
        );
        const edgesNew = st.edges().map(e => normalizeEdges(st.extremities(e)).join("|"));
        const missing = edgesOrig.filter(e => ! edgesNew.includes(e));
        for (const miss of missing) {
            const [left, right] = miss.split("|");
            const path = bidirectional(st, left, right);
            if (path === null) {
                throw new Error(`Could not find a path in the spanning tree from ${left} to ${right}`);
            }
            // must be circular
            bases.push([...path, path[0]]);
        }
        // if (bases.length !== expectedBases) {
        //     throw new Error(`The number of bases expected (${expectedBases}) does not equal the number generated (${bases.length}). Bases: ${JSON.stringify(bases)}`);
        // }

        // do XOR analysis to build all cycles
        // use edgesOrig as the fixed ordered list of original edges
        // convert each base into bit notation
        const bits: number[][] = [];
        for (const base of bases) {
            const normed = normalizeEdges(base);
            bits.push(edgesOrig.map(e => normed.includes(e) ? 1 : 0));
        }

        const pset = new PowerSet(bits);
        for (const [first, ...rest] of pset) {
            // if (rest.length > 0) {
            //     console.log(`Combining the following ${[first, ...rest].length} base sets together`);
            //     console.log(JSON.stringify([first, ...rest].map(bstr => unwindEdges(bstr.map((n, idx) => n === 1 ? edgesOrig[idx] : null).filter(s => s !== null) as string[]))));
            // }
            // first item in the powerset is empty
            if (first === undefined) {
                continue;
            }

            // Do XOR
            const xord: number[] = [...first];
            for (const other of rest) {
                for (let i = 0; i < other.length; i++) {
                    // eslint-disable-next-line no-bitwise
                    xord[i] = xord[i] ^ other[i];
                }
            }
            const cycle = xord.map((n, idx) => n === 1 ? edgesOrig[idx] : null).filter(s => s !== null) as string[];

            // Validate cycle
            if (validMergedCycle(cycle)) {
                // console.log(`\tResult:`)
                // console.log("\t" + JSON.stringify(unwindEdges(cycle)));
                cycles.push(unwindEdges(cycle));
            } else {
                // console.log(`\tDisjoint. Skipping.`);
            }
        }
    }

    return cycles;
}

