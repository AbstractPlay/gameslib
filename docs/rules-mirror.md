# Rules PDF mirrors

Official rules PDFs are hosted at [https://rules.abstractplay.com](https://rules.abstractplay.com) as `{uid}.pdf`. A public manifest at `https://rules.abstractplay.com/rules-mirrors.json` lists games with a successful mirror.

Hosting is S3 + CloudFront (same general pattern as [records.abstractplay.com](https://records.abstractplay.com)).

## Maintainer tooling (local only)

1. Copy `bin/mirror-rules.config.example.json` to `bin/mirror-rules.config.json` (gitignored) and adjust if needed.
2. For `bulk --tier all`, provide a BGG XML API Bearer token via `BGG_API_TOKEN` / `BGG_BEARER_TOKEN`, `bgg_api_token` in sibling `../apsecrets.yml`, or `bggApiToken` in `mirror-rules.config.json` (env wins, then apsecrets, then config).
3. Ensure AWS credentials can `PutObject` / `GetObject` on bucket `rules.abstractplay.com`.
4. Run from repo root:

```bash
npx tsx bin/mirror-rules.ts bgg-browser-login
npx tsx bin/mirror-rules.ts bulk --dry-run
npx tsx bin/mirror-rules.ts bulk --tier pdf
npx tsx bin/mirror-rules.ts upload clearpath ./Clear_Path_rules.pdf
npx tsx bin/mirror-rules.ts backlog stats
```

**BGG file downloads (Cloudflare):** Rule PDFs on `boardgamegeek.com` are often blocked for headless `fetch`. Use a **persistent Playwright profile** (gitignored `bin/.bgg-browser-profile` by default): run `bgg-browser-login` once in a headed browser, pass Cloudflare, optionally log into BGG, then press Enter. `bulk` reuses that profile for BGG file bytes. Do **not** put your BGG password in config or the repo — use the browser login step or stay logged out if public files download without an account. Override path with `bggBrowserProfileDir` in config or `BGG_BROWSER_PROFILE_DIR`.

The login browser prefers **installed Google Chrome**, then **Edge**, then Playwright Chromium (`BGG_BROWSER_CHANNEL=chrome` to force). Playwright’s bundled Chromium often fails Cloudflare with “Incompatible browser extension or network configuration” — that usually means **`challenges.cloudflare.com` is blocked** (Pi-hole, NextDNS, corporate firewall, VPN) or automation was detected. Allow that host, try another network, or delete `bin/.bgg-browser-profile` and run `bgg-browser-login` again after fixes.

**Bulk BGG file bytes** reuse the same profile in **headed** Chrome by default (**one browser window per game**, not per file). Cloudflare clearance from login usually does **not** apply to headless automation; only set `BGG_BROWSER_HEADLESS=1` if you have confirmed headless works in your environment. Debug a single file: `BGG_MIRROR_DEBUG=1 npx tsx bin/mirror-rules.ts bgg-download-test 292226` (saves `bin/bgg-mirror-debug-*.png` on failure).

Incremental work queue: `bin/mirror-rules-backlog.json` (gitignored).

New games: obtain a PDF and use `upload <uid> <file>`; canonical links stay in `gameinfo.urls`.

`bulk` rewrites `github.com/…/blob/…` links to `raw.githubusercontent.com/…` when fetching PDFs (e.g. Oonpia).

**Source order (`--tier all`):** For each game, `bulk` tries sources in order until one succeeds:

1. **Direct PDF** — any `gameinfo.urls` entry that looks like a `.pdf`
2. **Designer sites** — non-BGG URLs in list order. For each site: fetch the page (and a sibling `…/rules` path when present), use a linked rules-like PDF if found, otherwise **Playwright-print** a rules page or the main page
3. **BGG forum rules** — `boardgamegeek.com/thread/…` URLs are printed to PDF with Playwright (forum post body)
4. **BGG API** — `filepage/…` links, then `boardgame/…` (primary `gameinfo.bggid` first). When there is no rules-like uploaded PDF, the script scores the **thing description** (length + rules-like phrases). If it looks like full rules (common for Luis Bolaños Mures BGG-only entries), it Playwright-prints the description HTML to PDF instead of failing.

Install `npm install -D playwright` and `npx playwright install chromium` for HTML rules. Manifest `strategy` is `print` when a designer page, BGG thread, or BGG description is rendered to PDF.

**BGG (`--tier all`):** Uses the XML API plus BGG’s JSON `api.geekdo.com/api/files?objectid={bggid}&objecttype=thing` (the `xmlapi2/thing` `boardgamefile` links are often empty on modern entries). Picks a rules-like PDF, then tries `xmlapi2/file`, authenticated `/file/download/{id}`, then Playwright with the **persistent browser profile** (`bgg-browser-login`). Put a `boardgamegeek.com/filepage/…` URL in `gameinfo.urls` to pin a filepage id. Requires a Bearer token (`BGG_API_TOKEN`, `BGG_BEARER_TOKEN`, `../apsecrets.yml` `bgg_api_token`, or `bggApiToken` in config); bulk logs `BGG API token: yes (…)` with the source when it sees one. Debug one game: `npx tsx bin/mirror-rules.ts bgg-probe akron` (thing links, geekdo file list, description score). Waits **2s** between BGG calls, **10s** after **429**, **5s** after **202** queued responses.

If `thing` returns **0** `boardgamefile` links and the description does not pass the rules heuristic, the game may have rules only in forum threads or off-site. Use a direct `.pdf` in `gameinfo.urls` (tier **pdf**), a `thread/…` URL, or `upload`.
