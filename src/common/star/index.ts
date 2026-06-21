import { Graph } from "./Graph";

export { Graph };
export type { Edge, Vertex } from "../pentagons";

/** Segments per outer edge on the standard Star board (matches realstar.png). */
export const STAR_DEFAULT_FREQUENCY = 10;

/** Board frequency from a space-style width (11 → 10 segments per side). */
export const starFrequencyFromWidth = (width: number): number => width - 1;

export const starBoard = (frequency: number): Graph => new Graph(frequency);
