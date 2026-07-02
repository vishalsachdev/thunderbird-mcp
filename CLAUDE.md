# CLAUDE.md - thunderbird-mcp

Fork of [TKasperczyk/thunderbird-mcp](https://github.com/TKasperczyk/thunderbird-mcp) — a Thunderbird extension + Node MCP bridge exposing full read/write mail, calendar, and contacts tools (pick up threads, reply, forward, delete, filters, calendar CRUD). Purpose here: an explicitly opt-in, separate write-capable companion to [[mailcorpus]] (`~/code/mailcorpus`), which stays deliberately read-only.

Origin: forked and security-reviewed 2026-07-02 (static review of upstream — clean code, no obfuscation, zero npm prod deps, no postinstall scripts) before adopting. See `~/code/mailcorpus/CLAUDE.md` roadmap entry for the review writeup.

## Guardrails (do not weaken without the user explicitly asking)

- **Review-required send is enforced at the Thunderbird preference level**, not just tool defaults: `extensions.thunderbird-mcp.blockSkipReview` is set `true` in the Thunderbird profile's `prefs.js` (also toggleable via the extension's Options page in Thunderbird). This makes `skipReview: true` on `composeMail`/`replyToMessage`/`forwardMessage` fail with an error instead of silently sending — every send/reply/forward opens a Thunderbird compose window for the user to review and click Send.
- **Confirm-before-delete is a Claude behavior rule, not a code-level gate** (this tool has no built-in delete confirmation). Before calling any delete/destructive tool (`deleteMessages`, `deleteFolder`, `emptyTrash`, `emptyJunk`, `deleteContact`, `deleteEvent`, `deleteFilter`), state exactly what will be deleted and wait for explicit user go-ahead in chat first.
- Extension listens on `127.0.0.1` only by default — do not enable the "listen on all interfaces" option.

## Setup state

- Forked to `vishalsachdev/thunderbird-mcp` (`origin`), `upstream` = original repo.
- Extension installed via `scripts/install.sh` into the same Thunderbird profile mailcorpus reads (`166uidqq.default-release`).
- Wired into Claude Code's global `~/.claude.json` as MCP server `thunderbird` (`node mcp-bridge.cjs`).

## Session Log

### 2026-07-02
- Completed: Forked upstream, cloned locally, installed the Thunderbird extension, set `blockSkipReview=true` directly in `prefs.js` before first launch (so review-required is active from the start, not a manual checkbox step), registered the MCP server in `~/.claude.json`.
- Next: Confirm the extension is enabled in Thunderbird (Tools → Add-ons and Themes — it was disabled by default after the outside-of-UI install, a normal Thunderbird security gate), then verify the bridge connects (`/mcp` in Claude Code) and test a read-only tool first (list accounts / search) before any write/delete tool.
