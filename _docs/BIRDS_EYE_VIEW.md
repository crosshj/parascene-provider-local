# Bird's eye view — current state and deploy readiness

**Last updated:** from refactor work (single Python owner, rollout-safe orphan cleanup, health worker status).

---

## 1. Architecture in one paragraph

- **Port 3090:** Windows service (orchestrator) — single entry point. Proxies all app traffic to the **Node server** on 3091 (active) or 3092 (staging). Handles `/healthz`, `/status`, `POST /webhooks/github`, and the update pipeline. Does **not** start or monitor Python.
- **Ports 3091 / 3092:** Node image-generator server (one process at a time). Serves `/api/health`, `/api/gpu`, `/api/models`, `POST /api/generate`, `/outputs/*`, and static files. **Owns the single Python worker**: spawns `generate.py --worker` on first generate, keeps it for the process lifetime, tears it down on exit (SIGTERM/SIGINT). Reports worker status in `/api/health` (`worker: { running, pid }`).
- **Python:** One process per Node server — `generator/generate.py --worker` (stdin/stdout). No separate HTTP worker or ports 3096/3097. When the Node process is torn down, the Python process goes with it (graceful); orphan cleanup is rollout-safe and uses a shared PID file under `DATA_ROOT/runtime/.worker.pid` when set.

---

## 2. Component map

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Orchestrator** | `service/src/supervisor/index.js` | HTTP on 3090, proxy to Node app, health/status/webhook, UpdateQueue, GPU poll (writes `gpu-state.json`), rollout + post-rollout worker cleanup. |
| **Proxy** | `service/src/supervisor/proxy.js` | Forward requests to `activeNodeTarget` (3091 or 3092). |
| **Node app lifecycle** | `service/src/supervisor/nodeAppManager.js` | `startNodeApp`, `waitForHealth`, `getHealthJson`, `killOrphanWorker` (cold start), `cleanupWorkerPid` (post-rollout). Rollout uses `skipOrphanCleanup: true`; cold start runs orphan cleanup from PID file. |
| **Deploy state** | `service/src/supervisor/deployState.js` | `dataRoot/runtime/deploy-state.json`: `currentReleaseDir`, `activeNodePort`, `deployedAt`. |
| **Updater** | `service/src/updater/` | UpdateQueue, UpdatePipeline, ReleaseManager. Webhook → enqueue → fetch repo → stage → smoke → cutover (symlink `current`) → then **onRollingNodeRollout(releaseDir)** → then **onRollingPythonRecycle()** (no-op; one rollout per deploy). |
| **Server (Node app)** | `server/server.js` + `server/handlers/*` | One app: health, gpu, models, generate, outputs, public. Requires `PORT`, `HOST`, `OUTPUT_DIR`; optional `DATA_ROOT` for shared PID file. |
| **Generator (Python)** | `server/handlers/generate.js` | Spawns `generate.py --worker`, queue, timeout, PID file (`DATA_ROOT/runtime/.worker.pid` or `generator/.worker.pid`), `getWorkerStatus()`, `_killOrphan()` only when `DATA_ROOT` is **not** set (so rollout doesn’t kill old worker on new server load). |
| **Python worker** | `generator/generate.py` | `--worker`: stdin/stdout JSON, one process per Node server. |

---

## 3. Data flow (deploy and rollout)

1. **Webhook** → UpdateQueue enqueues job → pipeline runs: fetch → stage → smoke → cutover (symlink `runtime/current` to new release).
2. **onRollingNodeRollout(releaseDir):**
   - Fetch `/api/health` from **current** (old) server → save `worker.pid` as `previousWorkerPid`.
   - Start **new** Node app with `skipOrphanCleanup: true` on staging port (3091↔3092).
   - Wait for new app health.
   - Switch `activeNodeTarget` to new port; SIGTERM old Node process.
   - After `POST_ROLLOUT_CLEANUP_DELAY_MS` (default 2s), run `cleanupWorkerPid(previousWorkerPid)` so any surviving old worker is killed (GPU freed for new server).
3. **onRollingPythonRecycle():** No-op (log only). One Node rollout per deploy; new server spawns fresh worker on first generate.

---

## 4. Orphan and PID file behavior

- **Shared PID file (when `DATA_ROOT` set):** `dataRoot/runtime/.worker.pid`. Server writes it when spawning the worker; server clears it in `_stopWorker()`.
- **Server startup:** If `DATA_ROOT` is **not** set (e.g. dev), server runs `_killOrphan()` at load (cleans stale PID file). If `DATA_ROOT` **is** set, server does **not** run `_killOrphan()` at load (avoids killing old server’s worker during rollout).
- **Cold start (service, no current server):** `startNodeApp` is called **without** `skipOrphanCleanup` → `killOrphanWorker(dataRoot)` runs and cleans any leftover PID file from a previous hard-kill.
- **Rollout:** `startNodeApp(..., skipOrphanCleanup: true)` so we don’t kill the old worker before the new server is up. After old Node is killed, delayed `cleanupWorkerPid(previousWorkerPid)` cleans the old worker if it survived.

---

## 5. Plan vs current state

| Plan item | Status |
|-----------|--------|
| Orchestrator on 3090, proxy only; no in-process provider API | ✅ Done. No `providerApi.js` in service; proxy to Node app. |
| Node app on 3091/3092, single canonical app in `/server` | ✅ Done. Handlers in `server/handlers/`, no duplicate logic in service. |
| GPU owned by Node app, not service | ✅ Done. `server/handlers/gpu.js`; service only polls `/api/gpu` and writes `gpu-state.json`, escalates by Node rollout. |
| Python worker ownership | ✅ **Diverged by design:** plan had WorkerManager + ports 3096/3097. Current: **server owns single Python process** (generate.py --worker), no separate HTTP worker; service does not start or monitor Python. |
| Rolling Node update (health-check, swap, kill old) | ✅ Done. performNodeRollout with health wait, target swap, SIGTERM old process, then cleanupWorkerPid. |
| Python recycle | ✅ No-op after deploy (one Node rollout; new server owns worker). |
| Deploy state (current release, port) | ✅ `deploy-state.json` with `currentReleaseDir`, `activeNodePort`, `deployedAt`. Plan also mentioned nodeHash/pythonHash; not implemented (pipeline is “full release + Node rollout + Python recycle”). |
| Hash-based “Node-only vs Python-only” deploy | ❌ Not implemented. Every webhook-triggered deploy does: cutover + Node rollout; Python recycle is a no-op. |

---

## 6. Deploy readiness — covered bases

- **Single Python owner:** Server spawns and tears down the worker; no double management. ✅  
- **Orphan cleanup:** Cold start cleans PID file; rollout does not kill old worker until after new server is up and old process is torn down; delayed cleanup by PID frees GPU. ✅  
- **Health:** `/api/health` includes `worker: { running, pid }`. ✅  
- **Ports:** 3090 = orchestrator, 3091/3092 = Node app. No Python ports in use. ✅  
- **Docs vs code (done):** Plan docs and BUILD_SHEET updated to match as-built (server-owned Python, no WorkerManager).

---

## 7. Recommended before deploy

1. **Update docs** — ✅ Done. Plan docs and BUILD_SHEET updated (as-built, no WorkerManager, server-owned Python).
2. **README** — ✅ Done. Port sentence points to BIRDS_EYE_VIEW.
3. **Smoke / manual test:** From repo root: start orchestrator (`node service/src/supervisor/index.js`), trigger a webhook or run a release + rollout once, confirm Node swap and that `/api/health` shows worker after a generate.
4. **Python recycle** — ✅ Done. performPythonRecycle is a no-op; one Node rollout per deploy.

---

## 8. Summary

**Ready to deploy:** Yes. Docs aligned; one Node rollout per deploy (Python recycle no-op). Optional: hash-based Node-vs-Python deploy (not required for correctness).

