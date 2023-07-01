/**
 * This function contains generic helper functions, interfaces, and classes for dealing with
 * parts of hexes, including edges, points, and connections.
 */

import { Orientation, Hex } from "honeycomb-grid";

export type CompassDirection = "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW";

export interface IQRDir {
    q: number;
    r: number;
    dir: CompassDirection;
    uid: string;
    orientation: Orientation;
}
export type IEdge = IQRDir;
export type IVertex = IQRDir;
export interface IHexCoord {
    q: number;
    r: number;
}

export const hex2edges = (hex: Hex): Map<CompassDirection,IEdge> => {
    const edges = new Map<CompassDirection,IEdge>();
    const {q,r} = hex;
    if (hex.orientation === Orientation.POINTY) {
        edges.set("NE", {q, r, dir: "NE", uid: `${q},${r},NE`, orientation: hex.orientation});
        edges.set("E", {q: q+1, r, dir: "W", uid: `${q+1},${r},W`, orientation: hex.orientation});
        edges.set("SE", {q, r: r+1, dir: "NW", uid: `${q},${r+1},NW`, orientation: hex.orientation});
        edges.set("SW", {q: q-1, r: r+1, dir: "NE", uid: `${q-1},${r+1},NE`, orientation: hex.orientation});
        edges.set("W", {q, r, dir: "W", uid: `${q},${r},W`, orientation: hex.orientation});
        edges.set("NW", {q, r, dir: "NW", uid: `${q},${r},NW`, orientation: hex.orientation});
    } else {
        edges.set("N", {q, r, dir: "N", uid: `${q},${r},N`, orientation: hex.orientation});
        edges.set("NE", {q, r, dir: "NE", uid: `${q},${r},NE`, orientation: hex.orientation});
        edges.set("SE", {q: q+1, r, dir: "NW", uid: `${q+1},${r},NW`, orientation: hex.orientation});
        edges.set("S", {q, r: r+1, dir: "N", uid: `${q},${r+1},N`, orientation: hex.orientation});
        edges.set("SW", {q: q-1, r: r+1, dir: "NE", uid: `${q-1},${r+1},NE`, orientation: hex.orientation});
        edges.set("NW", {q, r, dir: "NW", uid: `${q},${r},NW`, orientation: hex.orientation});
    }
    return edges;
}

export const edge2hexes = (edge: IEdge): [IHexCoord,IHexCoord] => {
    if (edge.orientation === Orientation.POINTY) {
        switch (edge.dir) {
            case "NE":
                return [{q: edge.q, r: edge.r}, {q: edge.q + 1, r: edge.r - 1}];
            case "NW":
                return [{q: edge.q, r: edge.r}, {q: edge.q, r: edge.r - 1}];
            case "W":
                return [{q: edge.q, r: edge.r}, {q: edge.q - 1, r: edge.r}];
            default:
                throw new Error(`Invalid edge: ${JSON.stringify(edge)}`);
        }
    } else {
        switch (edge.dir) {
            case "NE":
                return [{q: edge.q, r: edge.r}, {q: edge.q + 1, r: edge.r - 1}];
            case "NW":
                return [{q: edge.q, r: edge.r}, {q: edge.q - 1, r: edge.r}];
            case "N":
                return [{q: edge.q, r: edge.r}, {q: edge.q, r: edge.r - 1}];
            default:
                throw new Error(`Invalid edge: ${JSON.stringify(edge)}`);
        }
    }
}

export const hex2verts = (hex: Hex): Map<CompassDirection,IVertex> => {
    const verts = new Map<CompassDirection,IEdge>();
    const {q,r} = hex;
    if (hex.orientation === Orientation.POINTY) {
        verts.set("N", {q, r, dir: "N", uid: `${q},${r},N`, orientation: hex.orientation});
        verts.set("NE", {q: q+1, r: r-1, dir: "S", uid: `${q+1},${r-1},S`, orientation: hex.orientation});
        verts.set("SE", {q, r: r+1, dir: "N", uid: `${q},${r+1},N`, orientation: hex.orientation});
        verts.set("S", {q, r, dir: "S", uid: `${q},${r},S`, orientation: hex.orientation});
        verts.set("SW", {q: q-1, r: r+1, dir: "N", uid: `${q-1},${r+1},N`, orientation: hex.orientation});
        verts.set("NW", {q, r: r-1, dir: "S", uid: `${q},${r-1},S`, orientation: hex.orientation});
    } else {
        verts.set("NE", {q, r, dir: "NE", uid: `${q},${r},NE`, orientation: hex.orientation});
        verts.set("E", {q: q+1, r: r-1, dir: "SW", uid: `${q+1},${r-1},SW`, orientation: hex.orientation});
        verts.set("SE", {q, r: r+1, dir: "NE", uid: `${q},${r+1},NE`, orientation: hex.orientation});
        verts.set("SW", {q, r, dir: "SW", uid: `${q},${r},SW`, orientation: hex.orientation});
        verts.set("W", {q: q-1, r: r+1, dir: "NE", uid: `${q-1},${r+1},NE`, orientation: hex.orientation});
        verts.set("NW", {q, r: r-1, dir: "SW", uid: `${q},${r-1},SW`, orientation: hex.orientation});
    }
    return verts;
}

export const vert2hexes = (vert: IVertex): [IHexCoord,IHexCoord,IHexCoord] => {
    if (vert.orientation === Orientation.POINTY) {
        switch (vert.dir) {
            case "N":
                return [{q: vert.q, r: vert.r}, {q: vert.q + 1, r: vert.r - 1}, {q: vert.q, r: vert.r - 1}];
            case "S":
                return [{q: vert.q, r: vert.r}, {q: vert.q, r: vert.r + 1}, {q: vert.q - 1, r: vert.r + 1}];
            default:
                throw new Error(`Invalid vertex: ${JSON.stringify(vert)}`);
        }
    } else {
        switch (vert.dir) {
            case "NE":
                return [{q: vert.q, r: vert.r}, {q: vert.q, r: vert.r - 1}, {q: vert.q + 1, r: vert.r - 1}];
            case "SW":
                return [{q: vert.q, r: vert.r}, {q: vert.q, r: vert.r + 1}, {q: vert.q - 1, r: vert.r + 1}];
            default:
                throw new Error(`Invalid vertex: ${JSON.stringify(vert)}`);
        }
    }
}

export const edge2verts = (edge: IEdge): [IVertex,IVertex] => {
    if (edge.orientation === Orientation.POINTY) {
        switch (edge.dir) {
            case "NE":
                return [
                    {q: edge.q, r: edge.r, dir: "N", uid: `${edge.q},${edge.r},N`, orientation: edge.orientation},
                    {q: edge.q + 1, r: edge.r - 1, dir: "S", uid: `${edge.q+1},${edge.r-1},S`, orientation: edge.orientation}
                ];
            case "NW":
                return [
                    {q: edge.q, r: edge.r, dir: "N", uid: `${edge.q},${edge.r},N`, orientation: edge.orientation},
                    {q: edge.q, r: edge.r - 1, dir: "S", uid: `${edge.q},${edge.r-1},S`, orientation: edge.orientation}
                ];
            case "W":
                return [
                    {q: edge.q, r: edge.r - 1, dir: "S", uid: `${edge.q},${edge.r-1},S`, orientation: edge.orientation},
                    {q: edge.q - 1, r: edge.r + 1, dir: "N", uid: `${edge.q-1},${edge.r+1},N`, orientation: edge.orientation}
                ];
            default:
                throw new Error(`Invalid edge: ${JSON.stringify(edge)}`);
        }
    } else {
        switch (edge.dir) {
            case "NE":
                return [
                    {q: edge.q, r: edge.r, dir: "NE", uid: `${edge.q},${edge.r},NE`, orientation: edge.orientation},
                    {q: edge.q + 1, r: edge.r - 1, dir: "SW", uid: `${edge.q+1},${edge.r-1},SW`, orientation: edge.orientation}
                ];
            case "NW":
                return [
                    {q: edge.q - 1, r: edge.r + 1, dir: "NE", uid: `${edge.q-1},${edge.r+1},NE`, orientation: edge.orientation},
                    {q: edge.q, r: edge.r - 1, dir: "SW", uid: `${edge.q},${edge.r-1},SW`, orientation: edge.orientation}
                ];
            case "N":
                return [
                    {q: edge.q, r: edge.r - 1, dir: "SW", uid: `${edge.q},${edge.r-1},SW`, orientation: edge.orientation},
                    {q: edge.q, r: edge.r, dir: "NE", uid: `${edge.q},${edge.r},NE`, orientation: edge.orientation}
                ];
            default:
                throw new Error(`Invalid edge: ${JSON.stringify(edge)}`);
        }
    }
}

export const vert2edges = (vert: IVertex): [IEdge,IEdge,IEdge] => {
    if (vert.orientation === Orientation.POINTY) {
        switch (vert.dir) {
            case "N":
                return [
                    {q: vert.q, r: vert.r, dir: "NE", uid: `${vert.q},${vert.r},NE`, orientation: vert.orientation},
                    {q: vert.q + 1, r: vert.r - 1, dir: "W", uid: `${vert.q+1},${vert.r-1},W`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r, dir: "NW", uid: `${vert.q},${vert.r},NW`, orientation: vert.orientation},
                ];
            case "S":
                return [
                    {q: vert.q, r: vert.r + 1, dir: "NW", uid: `${vert.q},${vert.r+1},NW`, orientation: vert.orientation},
                    {q: vert.q - 1, r: vert.r + 1, dir: "NE", uid: `${vert.q-1},${vert.r+1},NE`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r + 1, dir: "W", uid: `${vert.q},${vert.r+1},W`, orientation: vert.orientation},
                ];
            default:
                throw new Error(`Invalid vertex: ${JSON.stringify(vert)}`);
        }
    } else {
        switch (vert.dir) {
            case "NE":
                return [
                    {q: vert.q, r: vert.r, dir: "NE", uid: `${vert.q},${vert.r},NE`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r, dir: "N", uid: `${vert.q},${vert.r},N`, orientation: vert.orientation},
                    {q: vert.q + 1, r: vert.r - 1, dir: "NW", uid: `${vert.q+1},${vert.r-1},NW`, orientation: vert.orientation},
                ];
            case "SW":
                return [
                    {q: vert.q, r: vert.r + 1, dir: "N", uid: `${vert.q},${vert.r+1},N`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r + 1, dir: "NW", uid: `${vert.q},${vert.r+1},NW`, orientation: vert.orientation},
                    {q: vert.q - 1, r: vert.r + 1, dir: "NE", uid: `${vert.q-1},${vert.r+1},NE`, orientation: vert.orientation},
                ];
            default:
                throw new Error(`Invalid vertex: ${JSON.stringify(vert)}`);
        }
    }
}

export const vertNeighbours = (vert: IVertex): [IVertex,IVertex,IVertex] => {
    if (vert.orientation === Orientation.POINTY) {
        switch (vert.dir) {
            case "N":
                return [
                    {q: vert.q + 1, r: vert.r - 2, dir: "S", uid: `${vert.q+1},${vert.r-2},S`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r - 1, dir: "S", uid: `${vert.q},${vert.r-1},S`, orientation: vert.orientation},
                    {q: vert.q + 1, r: vert.r - 1, dir: "S", uid: `${vert.q+1},${vert.r-1},S`, orientation: vert.orientation},
                ];
            case "S":
                return [
                    {q: vert.q - 1, r: vert.r + 1, dir: "N", uid: `${vert.q-1},${vert.r+1},N`, orientation: vert.orientation},
                    {q: vert.q - 1, r: vert.r + 2, dir: "N", uid: `${vert.q-1},${vert.r+2},N`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r + 1, dir: "N", uid: `${vert.q},${vert.r+1},N`, orientation: vert.orientation},
                ];
            default:
                throw new Error(`Invalid vertex: ${JSON.stringify(vert)}`);
        }
    } else {
        switch (vert.dir) {
            case "NE":
                return [
                    {q: vert.q + 1, r: vert.r - 2, dir: "SW", uid: `${vert.q+1},${vert.r-2},SW`, orientation: vert.orientation},
                    {q: vert.q + 1, r: vert.r - 1, dir: "SW", uid: `${vert.q+1},${vert.r-1},SW`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r - 1, dir: "SW", uid: `${vert.q},${vert.r-1},SW`, orientation: vert.orientation},
                ];
            case "SW":
                return [
                    {q: vert.q - 1, r: vert.r + 1, dir: "NE", uid: `${vert.q-1},${vert.r+1},NE`, orientation: vert.orientation},
                    {q: vert.q, r: vert.r + 1, dir: "NE", uid: `${vert.q},${vert.r+1},NE`, orientation: vert.orientation},
                    {q: vert.q - 1, r: vert.r + 2, dir: "NE", uid: `${vert.q-1},${vert.r+2},NE`, orientation: vert.orientation},
                ];
            default:
                throw new Error(`Invalid vertex: ${JSON.stringify(vert)}`);
        }
    }
}
