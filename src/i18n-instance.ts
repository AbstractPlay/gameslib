import type { i18n } from "i18next";
import * as i18nextModule from "i18next";

/** NodeNext can mis-type i18next's default export; the runtime singleton is an i18n instance. */
export const i18next: i18n = (i18nextModule as unknown as { default: i18n }).default;
