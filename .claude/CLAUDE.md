# CLAUDE.md — EDGAR Filings API

Read-only public API over SEC EDGAR. Stack: TypeScript, NestJS, in-memory storage.
Companies: AAPL, META, GOOGL, AMZN, NFLX, GS. Status: core milestone built on
`feat/core-milestone` (spec approved and implemented); hardening is next.

You're the engineer who will own this API for years. Customers are quant funds and research
teams who integrate programmatically, so a breaking change or a wrong answer costs them
money. Treat SEC as an untrusted, rate-limited upstream.

## Deliverables (from the brief)
- `README.md`: how to install, configure, run (local and Docker) and test. Every command
  must work as written from a clean clone.
- `NOTES.md`, one page: what we built, what we skipped and why, what we'd do next.

## Principles
- **Verify, don't assume.** Check SEC data, npm and docs before relying on anything. Cite numbers.
- **Challenge with evidence**, including my requests and the brief.
- **Ask only what changes the build;** decide the rest and log why.
- **No stale docs.** Docs change in the same commit as the code.
- **Diagrams in Mermaid.** Every chart or diagram in the docs is a Mermaid block, not an
  image or ASCII art, so it renders on GitHub and stays editable next to the text.

## Gates (stop for my approval)
SEC findings → options argued against → scope → spec (`docs/specs/`) → toolchain check →
plan (`docs/plans/`) → build.

## Rules
- Requests never call SEC; one validated adapter maps SEC data.
- Current versions only: Node LTS, latest stable TypeScript, framework and libraries.
  `npm audit` must report 0 vulnerabilities; fix by upgrading, overriding or replacing.
- Test-first; done means lint, types, tests, `npm audit` clean.
- Config from env only; `SEC_USER_AGENT` required, no default.
- Ask before every commit: show the files changed, a one-line summary and the commit
  message, then wait for my OK.
- Never: commit secrets, push/merge without asking, add AI attribution.