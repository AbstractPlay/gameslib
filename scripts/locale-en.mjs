#!/usr/bin/env node
import { assertEnLocaleMergeCurrent } from "./lib/ensure-merged-locale-en.mjs";
import { runLocaleEnAudit } from "./lib/locale-en-audit.mjs";
import { parseLocaleEnArgv, printLocaleEnHelp } from "./lib/locale-en-cli.mjs";
import { runLocaleEnKeys } from "./lib/locale-en-keys.mjs";
import { runLocaleEnMerge } from "./lib/locale-en-merge-cmd.mjs";
import { runLocaleEnPrune } from "./lib/locale-en-prune.mjs";
import { runRemapApgamesLocaleLeaves } from "./lib/locale-en-remap-apgames.mjs";
import { runRemapApresultsLocaleLeaves } from "./lib/locale-en-remap-apresults.mjs";

const parsed = parseLocaleEnArgv(process.argv.slice(2));

if (parsed.subcommand === "help") {
    printLocaleEnHelp();
    process.exit(0);
}

let exitCode = 0;

try {
    switch (parsed.subcommand) {
        case "check":
            for (const ns of parsed.namespaces) {
                assertEnLocaleMergeCurrent(ns);
                console.log(`locale-en check ${ns}: OK`);
            }
            break;
        case "merge": {
            const write = parsed.write;
            const check = !write;
            if (!write && !check) {
                console.error("locale-en merge: pass --write to update merged JSON");
                process.exit(2);
            }
            for (const ns of parsed.namespaces) {
                runLocaleEnMerge(ns, { write });
            }
            break;
        }
        case "keys":
            for (const ns of parsed.namespaces) {
                const code = runLocaleEnKeys(ns, {
                    warn: parsed.warn,
                    strict: parsed.strict,
                    summary: parsed.summary,
                    uidFilter: parsed.uidFilter,
                    generalScope: parsed.generalScope,
                });
                if (code !== 0) {
                    exitCode = code;
                }
            }
            break;
        case "remap":
            for (const ns of parsed.namespaces) {
                if (ns === "apgames") {
                    runRemapApgamesLocaleLeaves({ write: parsed.write });
                } else {
                    runRemapApresultsLocaleLeaves({ write: parsed.write });
                }
            }
            break;
        case "prune":
            for (const ns of parsed.namespaces) {
                runLocaleEnPrune(ns, { write: parsed.write, uidFilter: parsed.uidFilter });
            }
            break;
        case "audit":
            for (const ns of parsed.namespaces) {
                runLocaleEnAudit(ns);
            }
            break;
        default:
            console.error(`Unknown subcommand: ${parsed.subcommand}`);
            printLocaleEnHelp();
            process.exit(2);
    }
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}

process.exit(exitCode);
