import { writeCommittedApresultsPathMap } from "./apresults-path-map.mjs";
import { seedManagedGameNamesFromEnglishApgames } from "./sync-game-names-locale-lib.mjs";

/**
 * After `locale-en merge --write`: seed managed `names.*` and refresh apresults path map.
 * @param {readonly ('apgames' | 'apresults')[]} namespaces
 */
export function runLocaleEnMergeWriteFollowups(namespaces) {
    if (namespaces.includes("apgames")) {
        seedManagedGameNamesFromEnglishApgames();
    }
    if (namespaces.includes("apresults")) {
        writeCommittedApresultsPathMap();
        console.log("Wrote locale-src/en/apresults/apresults-path-map.json");
    }
}
