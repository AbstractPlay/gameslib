import type { i18n } from "i18next";

/** Localized meta-game title; falls back to englishFallback or uid when the key is absent. */
export function resolveGameNameOn(
    i18next: i18n,
    uid: string,
    englishFallback?: string,
): string {
    const key = `names.${uid}`;
    if (i18next.exists(`apgames:${key}`)) {
        return i18next.t(`apgames:${key}`);
    }
    return englishFallback ?? uid;
}
