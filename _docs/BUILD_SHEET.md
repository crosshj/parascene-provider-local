# Windows AI Service — Build Sheet

This document defines **implementation tasks and acceptance criteria**.

Goal: produce a working skeleton service capable of:

- running as a Windows service
- supervising a worker
- accepting GitHub webhooks
- staging updates
- monitoring GPU health

---

# Step 1 — Supervisor Application

Create:

```text
src/supervisor/index.js
```

Responsibilities:

- start HTTP server
- start worker manager
- start updater
- start GPU watcher

Endpoints:

```text
GET /healthz
GET /status
POST /webhooks/github
```

Acceptance criteria:

- service starts
- `/healthz` returns `{ ok: true }`
- `/status` returns runtime information

---

# Step 2 — Worker (superseded)

**As-built:** The Python worker is owned by the **Node server** (`server/handlers/generate.js` spawns `generate.py --worker`). The service does not run a separate WorkerManager or worker process. No `src/supervisor/workerManager.js`. See `_docs/BIRDS_EYE_VIEW.md`.

---

# Step 3 — Dummy Worker — ✅ DONE (2026-03-16)

Create:

```text
src/worker/dummyWorker.js
```

Modes:

```text
--mode normal
--mode crash-after=30
--mode hang-after=30
--mode stop-heartbeat-after=30
```

Heartbeat every 3 seconds.

Acceptance criteria:

- supervisor restarts worker correctly

---

# Step 4 — Status Endpoint

Create:

```text
src/api/status.js
```

Return JSON:

```json
{
  "version": "0.1.0",
  "uptime": 12345,
  "parentPid": 1000,
  "worker": {
    "pid": 1001,
    "state": "healthy",
    "restartCount": 0,
    "lastHeartbeat": "2026-03-15T13:00:00Z"
  },
  "gpu": {},
  "updater": {}
}
```

---

# Step 5 — GitHub Webhook Handler — ✅ DONE (2026-03-16)

Create:

```text
src/api/githubWebhook.js
```

Responsibilities:

- read raw body
- compute HMAC
- validate signature
- validate repo and branch
- enqueue update job

Acceptance criteria:

- invalid signatures rejected
- valid webhook accepted

---

# Step 6 — Update Queue — ✅ DONE (2026-03-16)

Create:

```text
src/updater/updateQueue.js
```

Responsibilities:

- receive webhook events
- enqueue jobs
- start update pipeline

State file:

```text
runtime/update-state.json
```

---

# Step 7 — Update Pipeline — ✅ DONE (2026-03-16)

Create:

```text
src/updater/updatePipeline.js
```

Pipeline states:

```text
queued
fetching
staging
smoke-testing
ready
cutover
complete
failed
```

Acceptance criteria:

- pipeline progresses through states

---

# Step 8 — Release Manager — ✅ DONE (2026-03-16)

Create:

```text
src/updater/releaseManager.js
```

Responsibilities:

- create release folders
- record metadata
- update `current` pointer

Directory layout:

```text
C:\svc\service
  current
  releases
  logs
```

---

# Step 9 — GPU Probe — ✅ DONE (2026-03-16)

Create:

```text
src/gpu/gpuProbe.js
```

Run every 30 seconds:

```text
nvidia-smi --query-gpu=uuid,temperature.gpu,memory.used,utilization.gpu
```

Store results:

```text
runtime/gpu-state.json
```

---

# Step 10 — Logging System

Create:

```text
src/utils/logger.js
```

Output JSON logs:

```json
{
  "timestamp": "2026-03-15T13:00:00Z",
  "level": "info",
  "event": "service.start",
  "data": {}
}
```

Write to:

```text
logs/service.log
```

---

# Step 11 — WinSW config and install script — ✅ DONE (2026-03-16)

Create:

```text
scripts/install.js
```

Responsibilities:

- create service/runtime and service/logs
- require bundled `service/scripts/parascene-service.exe` (fail fast with download/place/rename guidance if missing)
- generate `service/scripts/parascene-service.xml` (WinSW config: executable node, args service/src/supervisor/index.js, workingdirectory = repo root, logpath = service/logs)
- print WinSW install/start and recovery-policy commands

Recovery is configured separately (e.g. `sc.exe failure "ParasceneProviderLocal" reset= 86400 actions= restart/5000/restart/10000/restart/30000`).

---

# Step 13 — Service Smoke Test

Test sequence:

1. reboot machine
2. verify service starts
3. call `/healthz`
4. simulate worker crash
5. verify restart
6. send webhook
7. verify updater triggered
8. simulate GPU probe failure
9. verify degraded state reported

---

# Final Acceptance Criteria

The system must:

- survive reboot
- restart worker automatically
- validate GitHub webhooks
- stage updates
- report status
- monitor GPU health
- never remain permanently crashed
