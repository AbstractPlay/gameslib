import { AIBase } from "./_base";
import { AmazonsAI } from "./amazons";

export interface IAI {
    findmove: (state: any, depth: number) => string;
}

export { AIBase, AmazonsAI };

export const supportedGames: string[] = ["amazons"];
export const fastGames: Map<string, number> = new Map([
    ["amazons", 1]
]);
export const slowGames: Map<string, number> = new Map();

export function AIFactory(game: string): AIBase|undefined {
    switch (game) {
        case "amazons":
            return new AmazonsAI();
    }
    return;
}
