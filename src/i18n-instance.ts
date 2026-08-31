import { createInstance, type i18n } from "i18next";

/** Browser-only gameslib i18n. Separate from the host app's global i18next singleton. */
export const i18next: i18n = createInstance();
