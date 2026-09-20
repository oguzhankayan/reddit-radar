# Reddit Radar

Stop reading thousands of Reddit conversations one by one. Ask a research
question and get a structured result with real Reddit evidence behind it.

Runs entirely on your machine: your data and keys never leave it.

Full documentation (English and Turkish), the security model, and the Reddit
compliance statement live in the project repository.

## Install

```bash
claude mcp add reddit-radar \
  -e TYPESAFE_API_KEY=ts_xxx \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -- npx -y --prefer-online reddit-radar
```

`--prefer-online` is there on purpose: without it npm caches the "latest
version" answer and updates can lag.

This npm package is only a delivery shortcut for the same code in the
repository at https://github.com/oguzhankayan/reddit-radar — it has no server side
and no account. Prefer to skip npm entirely? Clone the repo, run
`pnpm install && pnpm build:mcp`, and add the MCP with
`-- node <repo>/apps/mcp/dist/index.js`.

You need two keys and nothing else. No Reddit account. Chrome must be installed
— the first scan opens a window; do not close it.

Instead of passing keys to the MCP, you can put them in `~/.reddit-radar/.env`:

```
TYPESAFE_API_KEY=ts_xxx
DEEPSEEK_API_KEY=sk-xxx
```

The LLM provider can be any OpenAI-compatible one:
`LLM_BASE_URL=https://openrouter.ai/api/v1`, `LLM_MODEL=deepseek/deepseek-chat`.

## Usage

Ask Claude in plain language:

> "Use Reddit Radar to research the recurring problems small SaaS founders have
> with customer support tools."

The scan runs in the background (5,000 items ≈ 7 minutes). Claude tracks status
and returns clusters with the underlying Reddit posts once it finishes.

## Tools

| tool | purpose |
|---|---|
| `radar_scan` | Starts a scan, immediately returns a `scan_id` |
| `radar_scan_status` | Progress and status |
| `radar_results` | Clusters + coverage |
| `radar_prospects` | People/post list: author, URL, age, comments, subreddit |
| `radar_evidence` | The real posts behind one cluster |
| `radar_usage` | Estimated API spend accumulated on this machine |
| `radar_cancel` | Stops a running scan |
| `radar_export` | Full result JSON |
| `radar_scans` | Scans on this machine |
| `radar_login` | Optional; not for access, only for Reddit quota |

## How it works

Reddit data can only be obtained from a real browser (curl and headless return
403), so collection runs on your machine. Classification, clustering, and
synthesis now run in the same process, with your keys.

```
Claude ──MCP──► reddit-radar (local)
                Chrome · collection · classification · synthesis
```

Output: `~/.reddit-radar/scans/<scan_id>/` — `plan.json`, `results.json`,
`evidence.csv`.

## Compliance and privacy

- The project does not scrape Reddit; it reads public `.json` endpoints from
  inside the user's own real browser session.
- The Reddit session cookie stays in the browser profile; it is never read or
  transmitted. See `SECURITY.md` in the repository.
- Raw post text is deleted after 48 hours by default; URLs and scores remain.
- Radar never writes posts/comments, never votes, never sends messages.
- Keys travel only from your machine directly to the provider.
- Compliance and legal contact: **hi@creativefactory.tr**.

## License

MIT
