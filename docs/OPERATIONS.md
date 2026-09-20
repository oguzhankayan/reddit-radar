# Operations Guide

For someone running Reddit Radar on their own machine. Setup lives in
`README.md`; this file covers keys, data, cost, and troubleshooting.

## Keys

| variable | required | purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | ✅ | Stage 1/2 classification |
| `DEEPSEEK_API_KEY` | ✅ | plan compilation + cluster synthesis |
| `LLM_BASE_URL` | — | OpenAI-compatible provider (default `https://api.deepseek.com`) |
| `LLM_MODEL` | — | Model name (default `deepseek-flash`) |
| `RADAR_HOME` | — | Data directory (default `~/.reddit-radar`) |
| `RADAR_RAW_RETENTION_HOURS` | — | Raw text retention (default 48) |
| `RADAR_STAGE1_BATCH` | — | Items per call (default 10) |
| `RADAR_HEADFUL` | — | `0` = headless browser (debug only) |

Keys come from one of two places: the MCP configuration or a `.env` file.
**The MCP configuration always wins.** Files read, in order:
`~/.reddit-radar/.env` and `.env` in the working directory. An existing
environment variable is never overwritten.

```bash
cp .env.example .env
chmod 600 .env
```

## Data directory

```
~/.reddit-radar/
  .env                  keys (optional)
  browser-profile/      persistent Chrome profile (cookie lives here, unread)
  browser.lock          one browser at a time
  cache/                page cache (raw text, same retention)
  scans/<scan_id>/
    state.json          MCP progress state
    plan.json           compiled search plan
    items.ndjson        collected raw posts
    stage1.ndjson       Stage 1 decisions
    stage2.ndjson       Stage 2 scores
    results.json        final result (clusters + prospects + coverage)
    evidence.csv        flat evidence table
```

The directory is created with `700` permissions.

## Retention

- Raw Reddit text (`items.ndjson`) and the page cache are deleted after **48
  hours** by default. An `items.ndjson.purged` trace is left behind.
- `results.json` holds no text; it keeps URLs, scores, and short excerpts.
- Delete manually with `radar_forget`:
  - `scope="raw"` — deletes only collected posts; results remain.
  - `scope="all"` — removes the scan entirely.

## Cost

Reference measurement: a real run of 3,022 items → Jev $0.1023 + DeepSeek $0.0116.

| item | per 1,000 items |
|---|---|
| Jev (Stage 1 + Stage 2) | ~$0.03 |
| DeepSeek (plan + synthesis) | ~$0.01 per scan |

Scaling happens on two axes: **Jev per item**, **DeepSeek per scan**. Spending
the same volume in fewer, larger scans lowers the DeepSeek cost and leaves Jev
unchanged. `radar_usage` reports the accumulated estimate on this machine; the
exact bill is with your providers.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `missing_api_keys` | no keys | pass with `-e` to the MCP or use `~/.reddit-radar/.env` |
| `no_key` | classification/synthesis key missing | add the relevant key |
| Scan never starts, `browser_failed` | Chrome missing or profile open in another Chrome | install Chrome; close the open window |
| A window opened on the first scan | expected | do not close it |
| Scan stuck in `collecting` | MCP process died | on the next start, half-finished scans are marked `failed` |
| Result is `partial` | check `partial_reason` | usually under-target collection or a cluster chunk failure |
| Reddit 403 / challenge | running headless | use a visible browser with `RADAR_HEADFUL=1` |
| `npx` runs an old version | npm metadata cache | install with `--prefer-online`; if urgent `npm cache clean --force` |

Read scan status from disk:

```bash
cat ~/.reddit-radar/scans/<scan_id>/state.json
```

## Publishing to npm (maintainers)

```bash
# bump the version in apps/mcp/package.json, update CHANGELOG.md:
cd apps/mcp && node build.mjs && npm publish --access public
```

The version is **injected at build time** from `package.json`
(`__PKG_VERSION__`). Do not hardcode it.

## Privacy notes

- Cookies are never read/serialized/logged by the code.
- Keys are never logged.
- The only external services are TypeSafe (classification), the LLM provider
  (planning/synthesis), and the npm registry (version check). None of them can
  block the product on failure.
