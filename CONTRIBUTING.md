# Contributing Guide

**English** · Türkçe özet: bu rehberin Türkçe anlatımı için
[README.tr.md](README.tr.md) ve `docs/DECISIONS.md`'ye bakın. Sorularınızı
issue açarak sorabilirsiniz.

Contributions are welcome. This file covers the project's own rules, especially
its measurement and data policies.

## Requirements

- **Node.js 20+**
- **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Google Chrome** — Reddit data can only be obtained from a real, visible
  Chrome. Measured: `curl` 403, headless Chrome 403, headful Chrome 200. The
  system Chrome is used (`channel: "chrome"`), not the Chromium that Playwright
  downloads.

## Setup

```bash
pnpm install
cp .env.example .env     # add TYPESAFE_API_KEY and DEEPSEEK_API_KEY
```

Everything works without keys; only commands that make live API calls (`scan`,
`bench`) return `no_key`.

## Verify

Pass all three before sending a change:

```bash
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm build:mcp    # can the MCP be bundled into a single file
```

CI (`.github/workflows/ci.yml`) runs exactly these three.

## Architecture

```
apps/
  cli/     developer commands (scan, bench, gate, ...)
  mcp/     the MCP server Claude connects to
packages/
  core/           scan pipeline + retention policy
  browser/        Playwright Chrome, lock, persistent profile
  reddit-json/    collection, normalize, dedupe, cache
  query-compiler/ plan and partitions from a question
  classifiers/    Stage 1 filter, preset-specific Stage 2 questions
  jev/            TypeSafe classification wrapper
  llm/            OpenAI-compatible LLM client + synthesis
  scoring/        opportunity score
  shared/         types, paths, env, security helpers
```

Flow: `packages/core/src/scan.ts` is the end-to-end pipeline. Collection comes
from real Chrome, classification from TypeSafe, planning and synthesis from the
LLM. The MCP runs this function in the background and writes to
`~/.reddit-radar/scans/<id>/`.

## Measurement discipline

Contributions that change classification, scoring, or retrieval are **not
accepted without measurement**.

- `docs/DECISIONS.md` holds the measurement behind every design decision. Read
  it before changing a threshold or a weight.
- `pnpm radar bench`, `pnpm radar score`, and `pnpm radar gate` run the gates.
- An improvement claim must come with numbers: "it works better" without a
  before/after table is not enough.

## Data policy

- **Raw Reddit text never enters the repository.** Tests use the redacted
  `tests/fixtures/listing-sample.json`; persisting the full bodies of real users
  contradicts the 48-hour retention policy.
- The Reddit session cookie is never read, serialized, logged, or transmitted
  (see `SECURITY.md`).
- When adding a new collection path, update the scope of
  `packages/core/src/retention.ts`; otherwise the new data type stays outside
  the policy.

## Code style

- TypeScript, ESM, `.ts`-suffixed imports, `strict` + `noUncheckedIndexedAccess`.
- Comments explain **why**, not **what**. Example:
  `// launch() is inside try on purpose: if it throws, the mutex is never released.`
- Do not add a dependency without thinking twice. The project is deliberately
  light: `playwright`, `zod`, `@modelcontextprotocol/sdk`, `@typesafe-ai/sdk`.

## Commits and PRs

- Commit messages short and imperative.
- One topic per PR; include the measurement alongside any behavior change.
- Update `CHANGELOG.md` for user-visible changes.
- Do not ask for review until `pnpm typecheck && pnpm test && pnpm build:mcp` is
  green.

## Security

Do not open security issues publicly; follow `SECURITY.md`.
