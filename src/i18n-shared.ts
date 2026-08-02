export const supportedLocales: string[] = ["en", "fr", "de", "it"];

export type AddResourceOptions = {
    bundles?: Partial<Record<"apgames" | "apresults", object>>;
};
