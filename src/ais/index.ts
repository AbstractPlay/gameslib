import { AIBase } from "./_base.js";
import { AmazonsAI } from "./amazons.js";
import { BlamAI } from "./blam.js";
import { CannonAI } from "./cannon.js";
import { MchessAI } from "./mchess.js";
import { HomeworldsAI } from "./homeworlds.js";
import { ChaseAI } from "./chase.js";
import { AbandeAI } from "./abande.js";
import { CephalopodAI } from "./ceph.js";
import { LinesOfActionAI } from "./loa.js";
import { PikemenAI } from "./pikemen.js";
import { OrdoAI } from "./ordo.js";
import { AttangleAI } from "./attangle.js";
import { AccastaAI } from "./accasta.js";
import { EpamAI } from "./epam.js";
import { TaijiAI } from "./taiji.js";
import { BreakthroughAI } from "./breakthrough.js";
import { ArchimedesAI } from "./archimedes.js";
import { ZolaAI } from "./zola.js";
import { MonkeyQueenAI } from "./monkey.js";
import { DipoleAI } from "./dipole.js";

export interface IAIResult {
    bestMove: string|null;
    evaluation: number;
}

export interface IAI {
    findmove: (state: any, depth: number) => string;
}

export { AIBase, AmazonsAI, BlamAI, CannonAI, MchessAI, HomeworldsAI, ChaseAI, AbandeAI,
         CephalopodAI, LinesOfActionAI, PikemenAI, OrdoAI, AttangleAI, AccastaAI, EpamAI,
         TaijiAI, BreakthroughAI, ArchimedesAI, ZolaAI, MonkeyQueenAI, DipoleAI };

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
    ["pikemen", 3],
    ["ordo", 1],
    ["attangle", 4],
    ["accasta", 1],
    ["epam", 2],
    ["taiji", 2],
    ["breakthrough", 5],
    ["archimedes", 3],
    ["zola", 4],
    ["monkey", 3],
    ["dipole", 4],
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
    ["pikemen", 4],
    ["ordo", 2],
    ["attangle", 5],
    ["epam", 3],
    ["taiji", 3],
    ["breakthrough", 6],
    ["archimedes", 4],
    ["zola", 5],
    ["monkey", 4],
    ["dipole", 5],
]);

 
export const AIFactory = (game: string): AIBase|undefined => {
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
        case "pikemen":
            return new PikemenAI();
        case "ordo":
            return new OrdoAI();
        case "attangle":
            return new AttangleAI();
        case "accasta":
            return new AccastaAI();
        case "epam":
            return new EpamAI();
        case "taiji":
            return new TaijiAI();
        case "breakthrough":
            return new BreakthroughAI();
        case "archimedes":
            return new ArchimedesAI();
        case "zola":
            return new ZolaAI();
        case "monkey":
            return new MonkeyQueenAI();
        case "dipole":
            return new DipoleAI();
    }
    return;
}
