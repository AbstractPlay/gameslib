import type { IIndividualState } from "./_base";

export type SoloOutcomeType = "binary" | "graded" | "score" | "timed";
export type ScoreDirection = "higher" | "lower";

export interface IGradeTier {
    /** Stable id stored in records (e.g. "excellent"). */
    id: string;
    /** i18n key for UI — not written to archive. */
    label: string;
    /** Compared to score using scoreDirection. */
    threshold: number;
}

export interface ISoloOutcomeMeta {
    outcomeType: SoloOutcomeType;
    /** For timed: always "lower" (enforced by framework). */
    scoreDirection: ScoreDirection;
    /** i18n key for UI (e.g. "apgames:solo.scoreLabel.moves"). */
    scoreLabel?: string;
}

/** Score direction enforced for timed outcomes. */
export function soloScoreDirection(meta: ISoloOutcomeMeta): ScoreDirection {
    if (meta.outcomeType === "timed") {
        return "lower";
    }
    return meta.scoreDirection;
}

/**
 * Assign the best tier id for a final score.
 * Tiers are sorted ascending by threshold; the highest qualifying tier wins.
 */
export function evaluateGrade(
    score: number,
    tiers: IGradeTier[],
    direction: ScoreDirection,
): IGradeTier | undefined {
    const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
    let best: IGradeTier | undefined;

    if (direction === "higher") {
        for (const tier of sorted) {
            if (score >= tier.threshold) {
                best = tier;
            }
        }
    } else {
        for (const tier of sorted) {
            if (score <= tier.threshold) {
                if (best === undefined || tier.threshold < best.threshold) {
                    best = tier;
                }
            }
        }
    }

    return best;
}

/** Wall-clock ms from first stack timestamp to last (timed outcome default). */
export function computeElapsedMs(stack: Array<Pick<IIndividualState, "_timestamp">>): number {
    if (stack.length === 0) {
        return 0;
    }
    const start = new Date(stack[0]._timestamp).getTime();
    const end = new Date(stack[stack.length - 1]._timestamp).getTime();
    return end - start;
}
