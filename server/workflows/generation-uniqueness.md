# Generation uniqueness

Exact-parameter join so retries do not enqueue a second video job.

Code: `server/lib/generation-uniqueness.js`  
Wired: `startOrJoin` in `server/handlers/api.js`; release/rebuild in `server/lib/scheduler.js`  
Tests: `tests/generation-uniqueness.test.js`

**Now (video only):** same fingerprint while pending/running → 202 same `job_id`, `dedupe_state: joined_inflight`. Terminal → next start is a miss. Restart rebuilds in-flight from job records (`job.fingerprint`). Images skip join.

**Fingerprint (caller intent, not Comfy payload):** method + resolved model (family / workflow / file) + sanitized prompt + advertised field defaults + media slots. Seed only if the caller sent one. Strip `job_id`, timestamps, output paths. `upload_<time>_<hash>.ext` → `upload_*_<hash>.ext`. Do not hash minted seeds or `prep_<time>_<rand>.mp4`.

**Wire:** `dedupe_state` (`miss` | `joined_inflight`) and `dedupe_fingerprint_prefix` (12 hex). Poll contract unchanged.

**Not in scope yet:** perceptual / cross-model match; always-fresh opt-out.

## Next (bang-for-buck)

1. **Observe** — log miss/join + prefix (and counters if easy). Confirm retries actually join before adding more.
2. **Replay last success** — remember last succeeded job per fingerprint; if artifact exists and not `data_removed`, 202 + `dedupe_state: replay_cached`. Failures never replay. Drop pointer from `markDataRemoved`. No separate runtime index; job records are enough. Direct 200 of the file later, only if poll replay is not enough.
3. **Pending-only cancel** — dequeue waiting jobs. Running Comfy interrupt is machine-wide; leave it.

Images / opt-out: after replay exists, if anyone needs them.
