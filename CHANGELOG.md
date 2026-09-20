# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/) and the format of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] — 2026-09-20

> **Notice.** The hosted service (`redditradar.creativefactory.tr`) is
> discontinued, and versions `0.1.0`–`0.4.0` are hosted builds that consume
> server-side API keys. They are deprecated on npm. Use `0.5.0` or newer, which
> runs entirely locally with your own keys, or install from source.

### Changed
- **The product is now fully local (self-hosted).** The MCP runs the entire scan
  through `packages/core/src/scan.ts` in its own process: collection from real
  Chrome, classification with the user's `TYPESAFE_API_KEY`, planning and
  synthesis with the user's LLM key. The dependency on a central API is gone.
- `runScan` results now also produce `prospects` and `subreddit_breakdown`, so
  `radar_prospects` works from local data.
- `runScan` supports a language override (`language`).
- At startup, `~/.reddit-radar/.env` and the working directory's `.env` are
  loaded. An existing environment variable is never overwritten.
- LLM `base_url`/`model` are read at call time, so `.env` can point at any
  OpenAI-compatible provider (OpenRouter, local vLLM).
- `radar_usage` reports the accumulated **estimated API spend** on this machine
  instead of quota.

### Removed
- The Cloudflare Workers API (`apps/api`), and the D1/R2/Queues dependencies.
- `rr_` API key issuance, quota enforcement, and the `radar key` command.
- `packages/radar-client`, `packages/core/src/hosted-scan.ts`,
  `packages/shared/src/plans.ts`.
- The `hono` and `@cloudflare/workers-types` dependencies.

### Added
- `LICENSE` (MIT), `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `COMPLIANCE.md`, `CHANGELOG.md`.
- GitHub CI (typecheck + test + MCP build), issue/PR templates.
- `radar_forget` now genuinely deletes local raw text.

## [0.4.0] — 2026-09-19

### Added
- `radar_prospects`: a flat ranked people/post list independent of clusters
  (author, post age, comment count, subreddit breakdown).
- The opportunity score is renormalized over the signals the preset actually
  produces; `score_basis` reports which signals were used.

### Fixed
- Search partitions were moved ahead of listings in plan ordering; on-topic
  queries now actually run.
- `RadarBrowser.launch()` was moved inside the `try` block — if it threw, the
  browser mutex stayed locked and every later scan hung forever.

## [0.3.0] — 2026-09-18

### Added
- Stage 1 batching: 10 items per call, 5.6x faster, 33% cheaper, 100% shortlist
  overlap.
- Nonce-fenced untrusted-content boundary (prompt-injection defense).
- A 48-hour raw-text retention policy with an automatic sweep.

## [0.2.0] — 2026-09-17

### Added
- `packages/jev`: the TypeSafe classification wrapper (never throws, never
  generates text, state is hostile).
- Stage 2 preset rubrics and the opportunity score.

## [0.1.0] — 2026-09-16

### Added
- Reddit collection from real Chrome; curl and headless were measured to return
  403.
- Dedupe, normalize, page cache, rate-limit awareness.
- The evidence-first result shape: cluster + count + evidence + URL.
