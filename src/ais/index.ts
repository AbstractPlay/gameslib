import { AIBase } from "./_base";
import { AmazonsAI } from "./amazons";
import { BlamAI } from "./blam";
import { CannonAI } from "./cannon";

export interface IAIResult {
    bestMove: string|null;
    evaluation: number;
}

export interface IAI {
    findmove: (state: any, depth: number) => string;
}

export { AIBase, AmazonsAI, BlamAI, CannonAI };

export const supportedGames: string[] = ["amazons"];
export const fastGames: Map<string, number> = new Map([
    ["amazons", 1],
    ["blam", 3],
    ["cannon", 3]
]);
export const slowGames: Map<string, number> = new Map([
    ["blam", 5],
    ["cannon", 5]
]);

export function AIFactory(game: string): AIBase|undefined {
    switch (game) {
        case "amazons":
            return new AmazonsAI();
        case "blam":
            return new BlamAI();
        case "cannon":
            return new CannonAI();
    }
    return;
}
