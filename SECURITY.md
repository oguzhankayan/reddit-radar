# Security Policy

**English** · Türkçe özet için `README.tr.md` ve `COMPLIANCE.md`'ye bakın.

## Supported versions

Only the latest version is actively supported.

| Version | Supported |
|---|---|
| 0.5.x | ✅ |
| < 0.5 | ❌ |

## Reporting a vulnerability

Do **not** open a public issue for a security vulnerability. Instead, email
**oguzhankayan@outlook.com.tr**. Please include:

- the affected version,
- steps to reproduce,
- expected and observed behavior,
- a proof of concept if you have one.

We aim to respond within 72 hours and to credit you once a fix is released.

For compliance, legal, or takedown concerns, use **hi@creativefactory.tr**
(see `COMPLIANCE.md`).

## Threat model

Reddit Radar runs entirely on the user's machine. That reduces the attack
surface but does not eliminate it. The following are deliberate defenses; read
them before changing anything.

### 1. Prompt injection (end to end)

Reddit text is hostile input: a post can easily contain "ignore previous
instructions".

- Text reaches the LLM only inside a **nonce-fenced** block:
  `<UNTRUSTED_REDDIT_CONTENT id="a7f3c2">`. A fixed tag was not enough — a post
  could escape the block by writing the closing tag in its text.
- Fence-like sequences and line-leading role markers (`System:`, `Assistant:`)
  are stripped (`packages/shared/src/untrusted.ts`).
- In classification, Reddit text enters **only the `state` channel**; it is
  never interpolated into `instructions`/`criteria`. State cannot change what is
  being asked (`packages/jev/src/client.ts`).
- With no key, text is never sent anywhere.

### 2. Path traversal

`scan_id` is treated as hostile and restricted at the schema level:

```
^scan_[a-z0-9]{1,32}$
```

Without this, `radar_forget({scan_id:"../../..", scope:"all"})` deleted the
user's home directory. The same validation is applied independently in
`apps/mcp/src/store.ts` and `packages/core/src/retention.ts`.

### 3. Cookies and sessions

- The code never reads, serializes, logs, or transmits the Reddit session via
  `context.cookies()` / `context.storageState()`.
- The cookie stays only inside the persistent browser profile and is used only
  by `fetch(credentials:"include")` from the page context.
- The Reddit password is never requested; there is no OAuth.

This is a code-discipline rule, not an absolute isolation guarantee. Playwright
can technically access cookies; contributions must preserve this rule.

### 4. Retention

- Raw Reddit text is deleted after **48 hours** by default
  (`RADAR_RAW_RETENTION_HOURS`), with a trace left behind.
- The page cache is subject to the same policy — it holds full bodies and
  usernames. Exempting it invalidated the policy.
- Results, scores, and URLs remain; `radar_forget` deletes them on request.

### 5. Secret management

- Keys live in `.env` (local, 600) or the MCP configuration; they never enter
  the repository.
- `.env`, `.radar-key`, and `~/.reddit-radar` are gitignored.
- The code never logs a key.
- The user's own keys travel only from their machine directly to the provider;
  there is no server in between.

### 6. Network

- Outbound traffic only ever goes to: Reddit (browser), TypeSafe
  (classification), the LLM provider (planning/synthesis), and the npm registry
  (version check).
- The version check times out at 3 seconds and is silently ignored on failure;
  the product works offline.

## Data responsibility

Reddit Radar never **writes** posts/comments, never votes, and never sends
messages. It only reads public content. The user is responsible for ensuring
their collected data complies with the rules of their jurisdiction.
