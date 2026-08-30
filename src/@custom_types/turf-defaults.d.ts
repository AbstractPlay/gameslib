declare module "@turf/boolean-intersects" {
    import type { Feature } from "geojson";
    function booleanIntersects(
        feature1: Feature | Feature[],
        feature2: Feature | Feature[],
    ): boolean;
    export default booleanIntersects;
}

declare module "@turf/boolean-contains" {
    import type { Feature } from "geojson";
    function booleanContains(feature1: Feature, feature2: Feature): boolean;
    export default booleanContains;
}

declare module "@turf/boolean-within" {
    import type { Feature } from "geojson";
    function booleanWithin(feature1: Feature, feature2: Feature): boolean;
    export default booleanWithin;
}

declare module "@turf/boolean-point-in-polygon" {
    import type { Feature, Point, Polygon } from "geojson";
    function booleanPointInPolygon(
        point: Point | Feature<Point>,
        polygon: Polygon | Feature<Polygon>,
    ): boolean;
    export default booleanPointInPolygon;
}

declare module "@turf/difference" {
    import type { Feature, Polygon } from "geojson";
    function difference(
        polygon1: Feature<Polygon> | Polygon,
        polygon2: Feature<Polygon> | Polygon,
    ): Feature<Polygon> | null;
    export default difference;
}

declare module "@turf/helpers" {
    import type { Feature, LineString, Point, Polygon, Position } from "geojson";
    export type { Feature, LineString, Point, Polygon, Position };
    export function polygon(coordinates: Position[][]): Feature<Polygon>;
    export function lineString(coordinates: Position[]): Feature<LineString>;
}

declare module "@abstractplay/recranks" {
    export { APGameRecord } from "@abstractplay/recranks/build/schemas/gamerecord";
    export * from "@abstractplay/recranks/build/index";
}
