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

import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { PowerSet } from "js-combinatorics";

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
    const bases: string[][] = [];
    const cycles: string[][] = [];
    const components = connectedComponents(g);
    for (const grp of components) {
        const subset = g.copy();
        // eslint-disable-next-line @typescript-eslint/no-shadow
        for (const missing of g.nodes().filter(n => ! grp.includes(n))) {
            subset.dropNode(missing);
        }
        const st = spanningTree(subset);
        if (st === null) {
            throw new Error(`Could not form a spanning tree`);
        }
        const edgesOrig = subset.edges().map(e => {
            const lst = subset.extremities(e);
            lst.sort((a,b) => a.localeCompare(b));
            return lst.join("|");
        });
        const edgesNew = st.edges().map(e => {
            const lst = st.extremities(e);
            lst.sort((a,b) => a.localeCompare(b));
            return lst.join("|");
        });
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

        const normalizeEdges = (inlst: string[]): string[] => {
            const normed: string[] = [];
            for (let i = 0; i < inlst.length - 1; i++) {
                const split = [inlst[i], inlst[i+1]];
                split.sort((a,b) => a.localeCompare(b));
                normed.push(split.join("|"));
            }
            return normed;
        }

        // Takes a list of present edges, builds the cycle,
        // and returns it in normalized order, not circular
        const unwindEdges = (inlst: string[]): string[] => {
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
                throw new Error(`Error occured while normalizing the list`);
            }
            return [...path.slice(idx), ...path.slice(0, idx)];
        }

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
            // first item in the powerset is empty
            if (first === undefined) {
                continue;
            }
            // if AND is all zeroes, skip
            const anded: number[] = [...first];
            for (const other of rest) {
                for (let i = 0; i < other.length; i++) {
                    // eslint-disable-next-line no-bitwise
                    anded[i] = anded[i] & other[i];
                }
            }
            if (anded.reduce((prev, curr) => prev + curr, 0) === 0) {
                continue;
            }
            // Otherwise, do XOR
            const xord: number[] = [...first];
            for (const other of rest) {
                for (let i = 0; i < other.length; i++) {
                    // eslint-disable-next-line no-bitwise
                    xord[i] = xord[i] ^ other[i];
                }
            }
            const cycle = xord.map((n, idx) => n === 1 ? edgesOrig[idx] : null).filter(s => s !== null) as string[];
            cycles.push(unwindEdges(cycle));
        }
    }

    return cycles;
}

