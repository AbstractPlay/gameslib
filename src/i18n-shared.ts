export const supportedLocales: string[] = ["en", "fr", "de", "it", "es-US"];

const SPANISH_LOCALE = "es-US";

/** Map browser / user language tags to a supported gameslib locale. */
export function resolveLocale(lang?: string): string {
    if (lang !== undefined && supportedLocales.includes(lang)) {
        return lang;
    }
    if (lang !== undefined) {
        const lower = lang.toLowerCase();
        if (lower === "es" || lower.startsWith("es-")) {
            return SPANISH_LOCALE;
        }
    }
    return "en";
}

export type AddResourceOptions = {
    bundles?: Partial<Record<"apgames" | "apresults", object>>;
};
