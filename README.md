# Reddit Radar

[![CI](https://github.com/oguzhankayan/reddit-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzhankayan/reddit-radar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/reddit-radar.svg)](https://www.npmjs.com/package/reddit-radar)
[![MCP](https://img.shields.io/badge/MCP-server-blue.svg)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A fully local MCP server that takes a research question in plain language,
semantically classifies thousands of Reddit posts, and returns structured
market intelligence **with real Reddit evidence behind every claim**.

It runs entirely on your own machine. No central server, no account, no quota:
just your own API keys and the Chrome already installed on your system.

**English** · [Türkçe](README.tr.md)

## What it does

It answers two questions, both grounded in evidence:

- **"What is the market saying?"** — Recurring themes as clusters, each one
  linked to the actual posts that produced it.
- **"Who do I reach out to?"** — A flat, ranked list of people: author, post
  link, post age, comment count, and subreddit breakdown.

```
"Find people on Reddit I could sell SEO services to"
"What do small SaaS founders complain about with support tools?"
"Which subreddits concentrate people looking for a Zendesk alternative?"
```

## Features

- **Evidence required.** Results come with post URLs, excerpts, and scores; you
  do not have to trust a model's summary.
- **Structural prompt-injection defense.** Reddit text reaches the model only
  inside a nonce-fenced block and only through the `state` channel; it cannot
  change the questions being asked.
- **Honest coverage.** Classification failures are counted; above `2%` the
  result is marked `partial`. Cache hits are reported separately from live
  requests.
- **Retention policy.** Raw Reddit text is deleted after 48 hours by default;
  URLs, scores, and short excerpts remain.
- **Low cost.** Classification is batched at 10 items per call: 5.6x faster,
  33% cheaper, with identical shortlist ordering.

## Install

Requirements: **Node.js 20+** to run (the MCP itself), **Google Chrome**
(installed). Contributing additionally needs **Node.js 22+** and **pnpm** for
the workspace toolchain — see [CONTRIBUTING.md](CONTRIBUTING.md).

### 1. API keys

Two keys are needed:

| variable | purpose | where |
|---|---|---|
| `TYPESAFE_API_KEY` | Stage 1/2 classification | https://typesafe.ai |
| `DEEPSEEK_API_KEY` | plan compilation + cluster synthesis | https://platform.deepseek.com |

The LLM key can be any OpenAI-compatible provider; override `LLM_BASE_URL` and
`LLM_MODEL` in `.env` (OpenRouter, a local vLLM, ...).

### 2. Add the MCP to Claude

```bash
claude mcp add reddit-radar \
  -e TYPESAFE_API_KEY=ts_xxx \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -- npx -y --prefer-online reddit-radar
```

`--prefer-online` is there on purpose: without it npm caches the "latest
version" answer and updates can lag.

Alternatively, put the keys in `~/.reddit-radar/.env`; the MCP reads that file
at startup. An existing environment variable is never overwritten.

A Reddit account is **not required**. The first scan opens a Chrome window;
this is expected, do not close it.

## Usage

Ask Claude in plain language. Language, preset, and the right tool are selected
automatically:

> "Use Reddit Radar to research the recurring problems small SaaS founders have
> with customer support tools."

The scan runs in the background (5,000 items ≈ 7 minutes). Claude tracks status
and returns clusters with the underlying Reddit posts once it finishes.

### Tools

| tool | purpose |
|---|---|
| `radar_scan` | Starts a scan, immediately returns a `scan_id` + time estimate |
| `radar_scan_status` | Progress |
| `radar_results` | **What the market says** — clusters, coverage, cost |
| `radar_prospects` | **Who to contact** — a flat ranked people/post list |
| `radar_evidence` | The real posts behind one cluster |
| `radar_usage` | Estimated API spend accumulated on this machine |
| `radar_export` | Full result JSON |
| `radar_scans` | Scans on this machine |
| `radar_cancel` | Stops a running scan (partial results are kept) |
| `radar_forget` | Deletes scan data |
| `radar_version` | Version check and update command |
| `radar_login` | Optional; not for access, only for Reddit quota |

### What the agent is told

Tool descriptions and the server `instructions` field steer the agent to the
right tool and **guard it against false claims**: because subreddit rules/member
counts and comments are not collected, the agent cannot speak about them, nor
present `signal_coverage` as data coverage.

## Architecture — why local

Reddit data can only be obtained from a **real, visible Chrome instance**.
Measured (`docs/source-report.md`):

```
curl (residential IP)  → 403 bot-challenge
headless Chrome        → 403
headful Chrome (fetch from the page context) → 200 JSON
```

What matters is not login but a real browser. Collection therefore cannot be
centralized; the product had to be local from the start. As of 0.5.0,
classification and synthesis run in the same process too:

```
Claude ──MCP(stdio)──► reddit-radar  (single Node process, your machine)
                         │ Playwright + Chrome   → Reddit collection
                         │ TYPESAFE_API_KEY      → Stage 1/2 classification
                         │ DEEPSEEK_API_KEY      → plan + cluster synthesis
                         ▼
                       ~/.reddit-radar/scans/<scan_id>/
                         plan.json · items.ndjson · stage1.ndjson
                         stage2.ndjson · results.json · evidence.csv
```

No data passes through an intermediary server; keys travel only from your own
machine directly to the providers.

## Cost

Measured values (`docs/bench-stage1.md`):

- Stage 1: 712 tokens/item, **~$0.03 / 1,000 items**.
- DeepSeek: ~$0.01 per scan.
- A typical 5,000-item scan: roughly **$0.15**.

`radar_usage` reports the accumulated estimate on this machine; the actual bill
is with your key providers.

## Reddit compliance and legal

Read the full statement in [COMPLIANCE.md](COMPLIANCE.md). In short:

- This project **does not scrape Reddit**: it does not parse HTML, bypass bot
  protection, or circumvent authentication.
- It reads public content from `www.reddit.com/...json` endpoints **from within
  the user's own real browser session and page context**, exactly as the user's
  own browser would load the page.
- It never writes: no posts, comments, votes, messages, or account actions.
- It respects rate limits: it reads `x-ratelimit-*` headers and waits before
  ever hitting a 429. Only publicly available content is collected.
- Raw content is retained for 48 hours by default; see `SECURITY.md`.
- Collected data is the user's responsibility and must be used in line with
  Reddit's terms.

**Compliance and legal contact:** for any compliance, legal, or takedown
concern, write to **hi@creativefactory.tr**.

## Developer setup

```bash
pnpm install
cp .env.example .env     # TYPESAFE_API_KEY, DEEPSEEK_API_KEY
```

Chrome must be installed (`channel: "chrome"`). Reddit login is not required.

### Commands

```bash
pnpm radar scan --question "..." [--preset ...] [--target 5000] [--language en]
pnpm radar gate                     # G3 gate: manually verify evidence
pnpm radar collect --target 5000    # collection only
pnpm radar source-probe             # source health check
pnpm radar bench -n 500             # Stage 1 benchmark
pnpm radar label --top 25 --sample 10
pnpm radar score                    # G2 gate measurement
pnpm radar                          # command list
```

Commands work from outside the project directory: paths are derived from the
module's own location, not `process.cwd()`.

### Verify

```bash
pnpm typecheck && pnpm test && pnpm build:mcp
```

## Measured facts

All from the `docs/*.md` reports in this repo; not guesses.

**Source** (`docs/source-report.md`)
- Anonymous `.json` access returns **403 bot-challenge** with curl, and **403**
  with headless Chrome. Headful Chrome returns **200 JSON** from the page
  context. What matters is a real browser, not login.
- Reddit login is **not required**. `old.reddit` is unusable logged out.
- Global `/search.json` returns 10 items; subreddit-scoped search returns 100 →
  the planner uses subreddit-scoped search.

**Rate limit** (`docs/wall-report.md`)
- Quota-based: **~100 requests / ~10 min**; slowing down does not buy volume.
  The collector reads the quota and waits before ever seeing a 429.
- The real bottleneck is not quota but **listing depth**: ~930-1000 items per
  subreddit, after which it is pure duplicate. A 20k target is reached through
  partition count, not deeper pages.

**Collection** (`docs/collection-report.md`)
- 5,022 unique / 52 requests / 306 s / **0 rate-limit hits** / 1.3% duplicate /
  0 malformed records.

**Classification** (`docs/bench-stage1.md`, `docs/bench-gate.md`)
- precision@20 **90.0%** (18/20) · overall 83.9% (26/31) · 49 human labels.
- Jev agrees with the human 73.5% of the time, DeepSeek 63.3% → the silver
  labeler is loose, Jev is conservative.
- **Throughput ceiling ~3.3 calls/s**, independent of concurrency → the binding
  constraint is not cost but **call count**.

**Batching** (`docs/batch-bench.md`) — Stage 1, items per call:

| items/call | speedup | cost | decision agreement | shortlist overlap |
|---:|---:|---:|---:|---:|
| 5 | 2.9x | 71% | 94.8% | 100% |
| **10** | **5.6x** | **67%** | 93.0% | **100%** |
| 20 | 10.6x | 66% | 93.8% | 80% ← contamination |

10 was chosen: ordering is preserved exactly. At 20, cross-item contamination
breaks the shortlist.

## Design lessons

Two mistakes were found and fixed through measurement (`docs/DECISIONS.md`):

1. **Each criterion must measure one thing.** Asking `relevant_to_topic` with
   the problem statement was applying `contains_real_problem` twice → recall
   5.3%. Splitting into `in_domain` + `about_topic` fixed it.
2. **Do not threshold atomic decisions and AND them.** Thresholding four
   criteria at 0.8 and multiplying them dropped the shortlist to 1%. The right
   path is a weighted geometric mean of raw probabilities plus a top-5% cut.

Retrieval parameters were wrong too: I measured global search with the wrong
`sort`/`t` and dismissed it for "returning only 10 items". With the correct
parameters (`sort=relevance&t=year`) it returns 100 items across 67 subreddits.
Channels were re-ordered: **global search → subreddit-scoped search → listing
(width only)**.

## Documents

| file | contents |
|---|---|
| `docs/OPERATIONS.md` | Keys, cost, retention, troubleshooting, publishing |
| `docs/DECISIONS.md` | The measurement behind every design decision — read before changing |
| `docs/source-report.md` | Reddit access measurements (curl/headless/headful) |
| `docs/wall-report.md` | Rate limit and listing depth |
| `docs/bench-gate.md` | G2 precision gate |
| `docs/gate-g3.md` | G3 end-to-end gate |
| `docs/batch-bench.md` | Batching comparison |
| `COMPLIANCE.md` | Reddit compliance and legal statement |
| `SECURITY.md` | Threat model and vulnerability reporting |
| `CONTRIBUTING.md` | Contribution guide and measurement discipline |

## Security and data

- **Prompt injection:** Reddit text reaches the model inside a nonce-fenced
  block; a fixed tag was not enough. See `SECURITY.md`.
- **Path traversal:** `scan_id` is restricted at the schema level to
  `^scan_[a-z0-9]{1,32}$`.
- **Cookies:** the code never reads, serializes, logs, or transmits the Reddit
  session.
- **Retention:** raw Reddit text is deleted after 48 hours by default, with a
  trace left behind.
- **Secrets:** keys live in `.env` (600) and never enter the repository.
- Radar never writes posts/comments, votes, or sends messages.

## Contributing

Contributions are welcome. Read `CONTRIBUTING.md` first, and `docs/DECISIONS.md`
if you are changing classification or scoring. Optimization without measurement
is not accepted.

## License

MIT — see [LICENSE](LICENSE).
