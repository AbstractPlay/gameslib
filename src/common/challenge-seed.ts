import { nanoid } from "nanoid";

/** Generate a URL-safe challenge seed when create omits one. */
export function generateChallengeSeed(): string {
    return nanoid();
}

/** Return `provided` when non-empty; otherwise assign a new seed. */
export function resolveChallengeSeed(provided?: string): string {
    if (provided !== undefined && provided.length > 0) {
        return provided;
    }
    return generateChallengeSeed();
}
