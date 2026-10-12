import i18next from "i18next";

const APGAMES_PREFIX = "apgames:";

/** Build a namespaced apgames key for a per-game section leaf. */
export function gameApgamesUidKey(
    uid: string,
    section: "validation" | "variants" | "displays" | "buttons" | "status",
    ...parts: string[]
): string {
    const leaf = parts.join(".");
    return `${APGAMES_PREFIX}${section}.${uid}${leaf ? `.${leaf}` : ""}`;
}

/**
 * Optional helper — game code normally uses plain `i18next.t("apgames:…")` with English in `gameApgamesEn` for merge.
 * Pass either `apgames:section.uid.KEY` or `section.uid.KEY`.
 */
export function gameApgamesT(
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
): string {
    const fullKey = key.startsWith(APGAMES_PREFIX) ? key : `${APGAMES_PREFIX}${key}`;
    return i18next.t(fullKey, { defaultValue, ...options });
}
