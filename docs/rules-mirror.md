# Rules PDF mirrors

Official rules PDFs are hosted at [https://rules.abstractplay.com](https://rules.abstractplay.com) as `{uid}.pdf`. A public manifest at `https://rules.abstractplay.com/rules-mirrors.json` lists games with a successful mirror.

Hosting is S3 + CloudFront (same general pattern as [records.abstractplay.com](https://records.abstractplay.com)).

## Maintainer tooling (local only)

1. Copy `bin/mirror-rules.config.example.json` to `bin/mirror-rules.config.json` (gitignored) and adjust if needed.
2. For `bulk --tier all`, set the BGG XML API Bearer token in `bggApiToken` (same value as `bin/fetchThumbs.ts`) or export `BGG_API_TOKEN`.
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

**Source order (`--tier all`):** For each game, `bulk` walks `gameinfo.urls` in this order until one works: direct `.pdf` links → URLs with `rules` / `rulebook` in the path → explicit BGG `filepage/…` → **other designer/publisher pages (HTML)** → BGG `boardgame/…`. BGG is a fallback after sites such as [spielstein.com](https://spielstein.com).

**Spielstein HTML:** Fetches the game URL and `/rules`, prefers linked `.pdf` files that look like rules (not articles). If only HTML rules exist, renders `…/rules` to PDF via **Playwright** (`npm install -D playwright` and `npx playwright install chromium` on the machine running `bulk`). Manifest `strategy` is `print` for those renders.

**BGG (`--tier all`):** Uses the XML API, not the website Files tab HTML. For each game it calls `xmlapi2/thing?id={bggid}` and reads `boardgamefile` link ids, then `xmlapi2/file?id={fileid}` for the PDF URL. You can also put a `boardgamegeek.com/filepage/…` URL in `gameinfo.urls` (file id is extracted directly). Requires a Bearer token (`BGG_API_TOKEN` or `BGG_BEARER_TOKEN` in **the same terminal** that runs the script, or `bggApiToken` in config); bulk logs `BGG API token: yes (BGG_API_TOKEN)` when it sees one. Debug one game: `npx tsx bin/mirror-rules.ts bgg-probe accasta`. Waits **2s** between BGG calls, **10s** after **429**, **5s** after **202** queued responses.

If `thing` returns **0** `boardgamefile` links, the game may have no uploaded files on BGG (rules only in forum threads). Use a direct `.pdf` in `gameinfo.urls` (tier **pdf**) or `upload`.
