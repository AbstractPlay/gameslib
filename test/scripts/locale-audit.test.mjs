import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isAllowlisted,
    isIssueSuppressed,
    loadLocaleAuditAllowlist,
    localeAuditExitCode,
} from "../../scripts/lib/locale-audit.mjs";

describe("locale-audit allowlist", () => {
    it("supports exact and prefix* suppression", () => {
        assert.equal(isAllowlisted("orphan:apgames:validation.foo.BAR", ["orphan:apgames:validation.foo.BAR"]), true);
        assert.equal(isAllowlisted("orphan:apresults:acity.EOG.x", ["orphan:apresults:acity.*"]), true);
        assert.equal(isAllowlisted("orphan:apresults:acity.EOG.x", ["orphan:apresults:other.*"]), false);
    });

    it("suppresses issues by category bucket", () => {
        const allowlist = loadLocaleAuditAllowlist({
            suppress: { orphanApresultsGeneral: ["orphan:apresults:_general.NULLIFY_CLAIM.default"] },
            warnOnly: new Set(["orphanApresultsGeneral"]),
        });
        const issue = {
            id: "orphan:apresults:_general.NULLIFY_CLAIM.default",
            category: "orphanApresultsGeneral",
            severity: "warn",
            message: "example",
        };
        assert.equal(isIssueSuppressed(issue, allowlist), true);
    });

    it("errors fail exit; warn-only categories do not", () => {
        const allowlist = loadLocaleAuditAllowlist({
            suppress: {},
            warnOnly: new Set(["orphanApgames"]),
        });
        assert.equal(
            localeAuditExitCode(
                {
                    issues: [
                        {
                            id: "orphan:apgames:validation.x.Y",
                            category: "orphanApgames",
                            severity: "warn",
                            message: "",
                        },
                    ],
                    suppressed: [],
                },
                allowlist,
            ),
            0,
        );
        assert.equal(
            localeAuditExitCode(
                {
                    issues: [
                        {
                            id: "missing:apgames:validation.x.Y",
                            category: "missingApgames",
                            severity: "error",
                            message: "",
                        },
                    ],
                    suppressed: [],
                },
                allowlist,
            ),
            1,
        );
    });
});
