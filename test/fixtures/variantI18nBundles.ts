/** Minimal apgames bundle for variant i18n tests (self-contained; no repo locale files). */
export const variantI18nApgamesFixture = {
    variants: {
        _default: {
            board: { name: "Default board" },
        },
        archimedes: {
            "8x10": { name: "8x10 board" },
        },
    },
} as const;
