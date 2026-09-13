# Video request storm control plan (exact-parameter duplicates)

Goal: prevent waste when many callers request the same video with the same effective parameters.

Primary idea: if a matching video already exists and is still retained, serve that result instead of generating again.

## Problem statement

Today, every new start request creates a new scheduler job and eventually a new Comfy prompt. For bursty clients or retries, this can cause duplicate video renders that are byte-for-byte equivalent in intent.

Current behavior reference:
- Start path always enqueues for video methods in [server/handlers/api.js](../handlers/api.js)
- Queue persistence survives restarts in [server/lib/scheduler.js](../lib/scheduler.js)
- Output retention may remove artifacts after TTL in [server/lib/retention.js](../lib/retention.js)

## Desired outcomes

1. One active render per unique request fingerprint.
2. Duplicate starts during an active render should join the same job, not enqueue new jobs.
3. Duplicate starts after completion should replay the prior result while it is still available.
4. Behavior should be deterministic and observable (metrics and logs).

## Non-goals (v1)

1. Perceptual similarity matching across near-equal prompts.
2. Cross-model equivalence (different workflows/models are different requests).
3. Long-term artifact archive beyond current retention windows.

## Design options

### Option A: Client-only idempotency key

Client sends an idempotency key and server reuses result for that key.

Pros:
- Simple server logic.
- Caller controls dedupe boundary.

Cons:
- Not robust for multiple independent clients.
- Bugs in clients still create storms.

### Option B: Server in-flight coalescing only

Server computes a canonical fingerprint for each video start request and returns existing in-flight job_id when duplicate arrives.

Pros:
- Immediately stops queue growth during bursts.
- No client changes required.

Cons:
- Does not reuse completed outputs; repeats work after completion.

### Option C: Server completed-result replay only

Server fingerprints request and returns last successful matching artifact if still retained.

Pros:
- Saves compute for repeated exact requests.
- Easy mental model for users.

Cons:
- Does not stop in-flight duplicate storms.

### Option D: Hybrid (recommended)

Combine in-flight coalescing and completed-result replay.

Pros:
- Handles both storm phases: during render and after completion.
- Highest compute savings.
- Still transparent to clients.

Cons:
- Requires small amount of new state and careful fingerprinting.

## Recommended approach (Option D)

### 1. Canonical request fingerprint

Compute a deterministic hash for video methods based on effective generation inputs.

Candidate fingerprint payload:
- method
- resolved model identity (family/model/workflow)
- effective args after defaults
- fully built generation payload from buildComfyArgs, with volatile fields removed
- staged input references (input filenames, audio/video/image refs)

Do not include:
- job_id
- timestamps
- outputDir absolute path
- transient probe timestamps

Implementation note:
- Hash JSON with stable key ordering.
- Use SHA-256 from Node crypto.

### 2. In-flight coalescing

Before enqueue:
- If fingerprint has a pending/running job, return that job_id with 202.
- Add response flag, for example deduped: true and dedupe_state: joined_inflight.

On terminal state:
- Remove in-flight pointer.

### 3. Completed-result replay

Maintain last successful job per fingerprint.

On start request:
- If prior successful job exists and artifact still present (and not data_removed), return replay result.

Replay response shape choices:
1. Return 202 with prior job_id and dedupe_state: replay_cached, forcing normal poll flow.
2. Return 200 and directly stream artifact immediately.

Recommendation:
- Use choice 1 first to preserve current client behavior.
- Consider choice 2 later as optional optimization.

### 4. Persistence model

Persist dedupe index under runtime so behavior survives service restarts.

Possible file:
- runtime/video-dedupe-state.json

Stored fields:
- fingerprint
- latest_success_job_id
- latest_success_completed_at
- in_flight_job_id (optional)

On boot:
- Rebuild pointers from scheduler state when possible.
- Drop pointers to missing/failed/expired jobs.

### 5. Retention coupling

When retention marks output removed:
- Invalidate replay eligibility for that fingerprint.

Safety rule:
- Never replay a job whose artifact file is missing.

### 6. Observability

Add counters/log tags:
- dedupe_joined_inflight_total
- dedupe_replay_hit_total
- dedupe_miss_total
- dedupe_replay_stale_total

Add fields in start response for debugging:
- dedupe_state: miss | joined_inflight | replay_cached
- dedupe_fingerprint_prefix (shortened)

## API behavior proposal

For start requests on video methods:

1. dedupe miss
- enqueue new job
- return 202 async with new job_id

2. joined in-flight
- return 202 async with existing job_id

3. replay cached
- return 202 async with existing succeeded job_id
- poll endpoint continues to serve artifact as today

This preserves current poll contract and minimizes client changes.

## Edge cases and policy decisions

1. Seed handling
- Seed must be part of fingerprint.
- If seed is omitted and auto-generated upstream, fingerprint should use the effective seed used for generation.

2. File inputs
- Prefer staged input filenames in fingerprint for deterministic identity.
- If raw URL inputs are accepted, either force staging first or include resolved content hash.

3. Prompt normalization
- Fingerprint should use post-normalization values (same normalization path as generation).

4. Model aliases
- Fingerprint should use resolved concrete model/workflow identity, not caller alias.

5. Failures
- Failed jobs should not be replayed.
- Optional: short failure backoff key to reduce immediate failure storms.

## Incremental rollout plan

1. Phase 1: in-flight coalescing only (no replay)
- Lowest risk and immediate storm protection.

2. Phase 2: replay last successful result
- Add retention-aware validity checks.

3. Phase 3: add direct artifact response option for replay
- Optional; only if clients benefit.

## Suggested implementation touchpoints

1. New module: server/lib/video-dedupe.js
- fingerprint builder
- in-flight + replay index APIs
- persistence load/save

2. Update start path: server/handlers/api.js
- call dedupe check before enqueue
- set dedupe response fields

3. Update scheduler hooks: server/lib/scheduler.js
- notify dedupe module on status transitions (running, succeeded, failed)

4. Update retention integration: server/lib/retention.js
- clear replay pointers when artifact removed

## Test plan

1. Unit tests
- canonical fingerprint stable ordering
- same effective args => same fingerprint
- alias differences with same resolved model => same fingerprint
- different seed => different fingerprint

2. Integration tests
- duplicate burst while pending returns same job_id
- duplicate after success reuses prior job_id
- replay disabled after output TTL deletion
- restart preserves dedupe behavior via persisted state

3. Negative tests
- failed prior job is not replayed
- missing artifact file is not replayed

## Open questions

1. Should replay be limited to a maximum age lower than output TTL?
2. Should we expose an opt-out flag for callers that always want a fresh render?
3. Should non-video methods adopt the same mechanism now or later?
4. Should replay return artifact directly (200) or always preserve poll flow (202 + job_id)?

## Recommendation summary

Implement the hybrid strategy with poll-compatible responses:
1. join in-flight duplicates,
2. replay last successful exact-match job while retained,
3. keep existing client polling contract unchanged in v1.

This gives high impact on compute and queue stability with minimal API surface change.