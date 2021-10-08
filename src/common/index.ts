import { RectGrid } from "./rectGrid";

export { RectGrid };

export type DirectionsCardinal = "N" | "E" | "S" | "W";
export type DirectionsDiagonal = "NE" | "SE" | "SW" | "NW";
export type Directions = DirectionsCardinal | DirectionsDiagonal;
