# Known issues

## searchMessages returns an empty result when the mailbox read fails (2026-10-04)

`searchMessages` returns an ordinary empty result when the mailbox database read fails, so a caller cannot tell "no matching mail" from "the read failed".

Found by the project-inbox intake engine on 2026-10-04 (decision log, "Declined review findings"). It currently mitigates by comparing Inbox message counts before and after each scan.

Expected: a failed folder or database read returns an error, or at least a flag in the result (for example `incomplete: true` with the folder that failed), so callers can retry instead of treating the failure as "no new mail".

This matters for any automation that acts on an empty result, for example intake scans and "did this email get sent" checks.
