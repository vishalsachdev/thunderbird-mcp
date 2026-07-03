# Session Archive

Older entries moved out of CLAUDE.md's `## Session Log` (which keeps only the most recent entry).

### 2026-07-02
- Completed: Forked upstream, cloned locally, installed the Thunderbird extension, set `blockSkipReview=true` directly in `prefs.js` before first launch, registered the MCP server in `~/.claude.json`, enabled the extension. Built `scripts/bulk-delete-sender.mjs` (mailcorpus for fast local ID lookup + live bridge pagination for the gap, dry-run by default) and used it to delete 468 promotional emails from 1-800-Flowers plus create an auto-delete filter. Deletes initially appeared to silently fail (message still readable, folder counts unchanged) even after restarting both Thunderbird and Outlook — root-caused to unsubscribed Trash/Sent folders left over from the account's original read-only-only setup, not a sync bug. Fixed by subscribing to `Deleted Items`/`Sent Items`/`INBOX`; the queued deletes then flushed automatically, confirmed gone in Thunderbird and Outlook both.
- Next: The 1-800-Flowers filter should now be genuinely functional (untested against a real new incoming message yet) — worth confirming next time one arrives. Consider reporting the `deleteMessages` false-success-on-missing-Trash-folder behavior upstream to TKasperczyk/thunderbird-mcp.
