import { resolveNamespaceList } from "./locale-en-namespace-config.mjs";

const SUBCOMMANDS = new Set(["merge", "check", "keys", "remap", "prune", "audit", "help"]);
const NAMESPACE_TOKENS = new Set(["apgames", "apresults", "both"]);

/**
 * @param {string[]} argv
 */
export function parseLocaleEnArgv(argv) {
    let rest = [...argv];
    let subcommand = "check";
    if (rest.length > 0 && SUBCOMMANDS.has(rest[0])) {
        subcommand = rest.shift();
    }

    let namespaceToken;
    const nsIdx = rest.findIndex((a) => !a.startsWith("-") && NAMESPACE_TOKENS.has(a));
    if (nsIdx >= 0) {
        namespaceToken = rest[nsIdx];
        rest.splice(nsIdx, 1);
    }

    const namespaces = resolveNamespaceList(namespaceToken);

    const flags = new Set(rest.filter((a) => a.startsWith("--")));
    const uidIdx = rest.indexOf("--uid");
    const uidFilter = uidIdx >= 0 ? rest[uidIdx + 1] : undefined;
    const generalScopeArg = rest.find((a, i) => rest[i - 1] === "--general-scope");
    const generalScope =
        generalScopeArg === "global" || generalScopeArg === "perResultType" || generalScopeArg === "both"
            ? generalScopeArg
            : "both";

    return {
        subcommand,
        namespaces,
        write: flags.has("--write"),
        warn: flags.has("--warn"),
        strict: flags.has("--strict"),
        summary: flags.has("--summary") || (flags.has("--warn") && !flags.has("--verbose")),
        verbose: flags.has("--verbose"),
        uidFilter,
        generalScope,
    };
}

export function printLocaleEnHelp() {
    console.log(`English locale tooling (apgames + apresults)

Usage:
  npm run locale-en                              check both merged files (default)
  npm run locale-en -- merge --write             merge sources → locales/en/*.json (+ path map, managed names)
  npm run locale-en -- keys --warn --strict --summary
  npm run locale-en -- remap --write             apgames: src-match; apresults: path-map
  npm run locale-en -- prune [--write] [--uid <uid>]
  npm run locale-en -- audit                       strict coverage summary

Namespace (optional, default both — apgames then apresults):
  apgames | apresults | both

Subcommands: merge | check | keys | remap | prune | audit | help
`);
}
