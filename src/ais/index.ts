import { AIBase } from "./_base";
import { AmazonsAI } from "./amazons";
import { BlamAI } from "./blam";
import { CannonAI } from "./cannon";
import { MchessAI } from "./mchess";
import { HomeworldsAI } from "./homeworlds";
import { ChaseAI } from "./chase";
import { AbandeAI } from "./abande";
import { CephalopodAI } from "./ceph";
import { LinesOfActionAI } from "./loa";

export interface IAIResult {
    bestMove: string|null;
    evaluation: number;
}

export interface IAI {
    findmove: (state: any, depth: number) => string;
}

export { AIBase, AmazonsAI, BlamAI, CannonAI, MchessAI, HomeworldsAI, ChaseAI, AbandeAI, CephalopodAI, LinesOfActionAI };

export const supportedGames: string[] = ["amazons"];
export const fastGames: Map<string, number> = new Map([
    ["amazons", 1],
    ["blam", 3],
    ["cannon", 3],
    ["mchess", 5],
    ["homeworlds", 4],
    ["chase", 1],
    ["abande", 2],
    ["ceph", 4],
    ["loa", 4],
]);
export const slowGames: Map<string, number> = new Map([
    ["amazons", 2],
    ["blam", 5],
    ["cannon", 5],
    ["mchess", 7],
    ["homeworlds", 6],
    ["chase", 2],
    ["abande", 3],
    ["ceph", 5],
    ["loa", 5],
]);

export function AIFactory(game: string): AIBase|undefined {
    switch (game) {
        case "amazons":
            return new AmazonsAI();
        case "blam":
            return new BlamAI();
        case "cannon":
            return new CannonAI();
        case "mchess":
            return new MchessAI();
        case "homeworlds":
            return new HomeworldsAI();
        case "chase":
            return new ChaseAI();
        case "abande":
            return new AbandeAI();
        case "ceph":
            return new CephalopodAI();
        case "loa":
            return new LinesOfActionAI();
    }
    return;
}
