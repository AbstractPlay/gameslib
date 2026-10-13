# Rules PDF mirrors

Official rules PDFs are hosted at [https://rules.abstractplay.com](https://rules.abstractplay.com) as `{uid}.pdf`. A public manifest at `https://rules.abstractplay.com/rules-mirrors.json` lists games with a successful mirror.

Hosting is S3 + CloudFront (same general pattern as [records.abstractplay.com](https://records.abstractplay.com)).

## Maintainer tooling (local only)

1. Copy `bin/mirror-rules.config.example.json` to `bin/mirror-rules.config.json` (gitignored) and adjust if needed.
2. For `bulk --tier all`, provide a BGG XML API Bearer token via `BGG_API_TOKEN` / `BGG_BEARER_TOKEN`, `bgg_api_token` in sibling `../apsecrets.yml`, or `bggApiToken` in `mirror-rules.config.json` (env wins, then apsecrets, then config).
3. Ensure AWS credentials can `PutObject` / `GetObject` on bucket `rules.abstractplay.com`.
4. Run from repo root:

```bash
npx tsx bin/mirror-rules.ts bulk --dry-run
npx tsx bin/mirror-rules.ts bulk --tier pdf
npx tsx bin/mirror-rules.ts upload clearpath ./Clear_Path_rules.pdf
npx tsx bin/mirror-rules.ts backlog stats
```

Incremental work queue: `bin/mirror-rules-backlog.json` (gitignored).

New games: obtain a PDF and use `upload <uid> <file>`; canonical links stay in `gameinfo.urls`.

`bulk` rewrites `github.com/…/blob/…` links to `raw.githubusercontent.com/…` when fetching PDFs (e.g. Oonpia).

**Source order (`--tier all`):** For each game, `bulk` tries sources in order until one succeeds:

1. **Direct PDF** — any `gameinfo.urls` entry that looks like a `.pdf`
2. **Designer sites** — non-BGG URLs in list order. For each site: fetch the page (and a sibling `…/rules` path when present), use a linked rules-like PDF if found, otherwise **Playwright-print** a rules page or the main page
3. **BGG forum rules** — `boardgamegeek.com/thread/…` URLs are printed to PDF with Playwright (forum post body)
4. **BGG API** — `filepage/…` links, then `boardgame/…` (primary `gameinfo.bggid` first). When there is no rules-like uploaded PDF, the script scores the **thing description** (length + rules-like phrases). If it looks like full rules (common for Luis Bolaños Mures BGG-only entries), it Playwright-prints the description HTML to PDF instead of failing.

Install `npm install -D playwright` and `npx playwright install chromium` for HTML rules. Manifest `strategy` is `print` when a designer page, BGG thread, or BGG description is rendered to PDF.

**BGG (`--tier all`):** Uses the XML API, not the website Files tab HTML. For each game it calls `xmlapi2/thing?id={bggid}` and reads `boardgamefile` link ids, then `xmlapi2/file?id={fileid}` for the PDF URL. You can also put a `boardgamegeek.com/filepage/…` URL in `gameinfo.urls` (file id is extracted directly). Requires a Bearer token (`BGG_API_TOKEN`, `BGG_BEARER_TOKEN`, `../apsecrets.yml` `bgg_api_token`, or `bggApiToken` in config); bulk logs `BGG API token: yes (…)` with the source when it sees one. Debug one game: `npx tsx bin/mirror-rules.ts bgg-probe accasta` (shows file links and description adequacy score). Waits **2s** between BGG calls, **10s** after **429**, **5s** after **202** queued responses.

If `thing` returns **0** `boardgamefile` links and the description does not pass the rules heuristic, the game may have rules only in forum threads or off-site. Use a direct `.pdf` in `gameinfo.urls` (tier **pdf**), a `thread/…` URL, or `upload`.
