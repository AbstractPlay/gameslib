import { Vertex } from "../pentagons";

/**
 * Vertices of one pentagonal ring, clockwise from the top quark (side 0 corner).
 */
export const orderedRing = (layerSides: Vertex[][]): Vertex[] => {
    if (layerSides.length === 0 || layerSides[0]!.length === 0) {
        return [];
    }

    if (layerSides[0]!.length === 1) {
        return [layerSides[0]![0]!];
    }

    const ring: Vertex[] = [];
    const seen = new Set<number>();
    for (let side = 0; side < 5; side++) {
        const curve = layerSides[side]!;
        for (let n = 0; n < curve.length - 1; n++) {
            const vtx = curve[n]!;
            if (seen.has(vtx.id)) {
                continue;
            }
            ring.push(vtx);
            seen.add(vtx.id);
        }
    }
    return ring;
};

/**
 * Playable rings outside-in: row 0 is the perimeter from the top quark clockwise.
 */
export const buildGridLayers = (
    topologyLayers: Vertex[][][],
    frequency: number,
): Vertex[][] => {
    const gridLayers: Vertex[][] = [];
    for (let ring = frequency; ring >= 0; ring--) {
        gridLayers.push(orderedRing(topologyLayers[ring]!));
    }
    return gridLayers;
};
