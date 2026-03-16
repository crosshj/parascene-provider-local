## Service refactor — orchestrated, always-on port 3090

**As-built (post-refactor):** The Python worker is **owned by the Node server** (one `generate.py --worker` process per Node process). The service does **not** start or monitor a separate Python process; there is no WorkerManager, no `worker_server.py`, and no Python ports 3096/3097. See `_docs/BIRDS_EYE_VIEW.md` for current topology.

---

**Goal:** Keep port `3090` always responsive while allowing independent, rolling updates of:

- **Node image generator server** (current `/server` app, HTTP API + static assets)
- **Python image generation worker** (current `/generator` stack)
- **Windows service host** (WinSW → Node supervisor/orchestrator)

The orchestrator process (Node, started by WinSW) is **long‑lived and stable**; it never talks to Python directly and never needs to restart when backend code changes.

---

### 0. Critique of current design (what we are fixing)

#### 0.1 The service does too much

The single Windows service process (`service/src/supervisor/index.js`) is responsible for all of the following in one Node process:

- **HTTP server** on the public port (e.g. 3090): the only entry point for clients.
- **Health and status** endpoints (`/healthz`, `/status`) for the service itself.
- **GitHub webhook** ingestion (`POST /webhooks/github`) and the full **update pipeline** (UpdateQueue, release staging, etc.).
- **Worker supervision**: *(obsolete)* Previously spawning/monitoring a separate Python worker (WorkerManager). Now the **Node server** owns the single Python worker; the service does not.
- **GPU reporting** (GpuProbe, nvidia-smi, `runtime/gpu-state.json`) and escalation into worker restarts. GPU state is a concern of the app that uses the GPU for generation; the service should not own it.
- **"Provider" API**: *(obsolete in-service)* Handling app traffic; now proxied to the Node app (see 0.2).

So one binary does: lifecycle, updates, worker process management, hardware probing, and all user-facing app traffic. Any change to update logic, worker behavior, or app behavior lives in or is triggered by this same process. Deploying new app or Python code today implies **restarting the whole service** (via `requestServiceRestart` → `shutdown("restart_from_updater")`), so port 3090 goes down and everything (webhook, status, app) restarts together. The service is a monolith, not a thin edge.


#### 0.2 The service does a crappy job of being a reverse proxy for the server

The service does **not** act as a reverse proxy in the usual sense (forwarding requests to a separate backend process). Instead:

- **Provider API was in-process re-implementation of the server.**  
  *(Historical.)* `service/src/api/providerApi.js` used to implement the same routes as `server/server.js` (`/api/health`, `/api/models`, `POST /api/generate`, etc.). That file has been **removed**; app traffic is now proxied to the Node app.

- **There is no separate server to proxy to.**  
  The standalone `server/server.js` (listening on its own port) is not in the request path when the service is running. The service *is* the app for that traffic. So there is no reverse proxy at all—only a single process that both owns the port and runs the app code.

- **Consequences.**  
  - Rolling updates are impossible: to run new server or generator code you must restart the service, so 3090 drops.  
  - No health-checked backend to swap: no second process to bring up, check, then cut over to.  
  - Proxying (once we add it) means the service actually forwarding to a real `server/server.js` (or equivalent) on another port; today that role does not exist in production.

**Refactor intention:** make the service a **thin, well-defined orchestrator + reverse proxy** that:

- Owns port `3090` and **forwards** traffic to one or more Node app backends (real `server` processes on internal ports).
- Does **not** host app logic itself; the Node app runs in separate processes that the orchestrator can start, health-check, and swap.
- Treats Node and Python as **replaceable components** behind stable contracts, so most changes are handled by rolling backends, not by restarting or complicating the service itself.

---

### 1. Target runtime topology

**Port block: 3090–3099** (tight grouping, service port first)

| Port   | Role |
| ------ | ----- |
| **3090** | Orchestrator (reverse proxy + deploy). Single public entry point. |
| **3091** | Active Node app (current backend). |
| **3092** | Staging Node app (for rolling deploy). |
| 3093–3099 | Reserved. *(Python is a child process of the Node app; no separate worker ports.)* |

- **WinSW service → Node orchestrator**
  - Executable: `node`
  - Args: `service/src/supervisor/index.js` (or successor entry)
  - Role: **reverse proxy + deployment orchestrator**, listening on **port `3090`**.
  - Always owns port `3090`; this process is the single “front door”.

- **Active Node generator app instance(s)**
  - Current implementation lives under `/server` (plus `/public`, `/generator` as today).
  - Run on **3091** (active) and **3092** (staging for rollouts); never on `3090`.
  - The orchestrator forwards external HTTP/WebSocket traffic from `3090` → active Node port (3091 or 3092).
  - Node app is solely responsible for calling into Python.
  - **GPU reporting** (nvidia-smi, GPU state) is owned by the Node app, not the orchestrator; the app that uses the GPU for generation reports and exposes GPU status.

- **Python worker**
  - *(As-built:)* Owned by the **Node app** (spawned by `server/handlers/generate.js` as `generate.py --worker`, stdin/stdout). One process per Node process; no separate ports. When the Node app is torn down, the Python process goes with it. Orphan cleanup is rollout-safe (see BIRDS_EYE_VIEW.md).

**Invariant:** Port `3090` is always owned by the orchestrator; it only proxies to **healthy** Node app instances and never depends on Python directly.

---

### 2. Deployment / rolling update behavior

**Trigger:** GitHub push / release event, received by the existing service webhook or by a separate GitHub Action, initiates an update pipeline that:

1. **Fetches latest code** into a new release directory (existing `releases/<id>` flow).
2. **Computes Git tree hashes** for:
   - **Node server code** (e.g. `server/`, `public/`, and any shared libs it depends on).
   - **Python worker code** (e.g. `generator/` and any associated config/scripts).
3. **Compares hashes** with the last successfully deployed release state:
   - If **only Node hash changed** → roll Node app only.
   - If **only Python hash changed** → roll Python worker only.
   - If **both changed** → roll Node and Python together.
4. **Updates persisted deploy state** (JSON on disk under `service/runtime/`) only after a successful cutover.

---

### 3. Node app rolling update (Node‑only or Node+Python)

**Objective:** Swap traffic on port `3090` from old Node instance → new Node instance **without downtime**.

Required changes:

- **Orchestrator reverse proxy**
  - Accept HTTP (and WebSocket) connections on `3090`.
  - Maintain an in‑memory `activeNodeTarget`:
    - `{ host: "127.0.0.1", port: 3091 }` or `3092` (active vs staging).
  - Forward all external requests to `activeNodeTarget` using a streaming proxy (e.g. `http-proxy` or manual piping).
  - Expose `/health` on `3090` that returns **OK only if**:
    - Orchestrator itself is up, and
    - The current active Node target passes a fast health probe (e.g. `/api/health` on the Node app), with reasonable timeout.

- **Rolling swap algorithm (Node)**
  - On “Node changed” decision:
    1. Start a **new Node generator app process** from the new release root:
       - Executable: `node`
       - Args: `server/server.js` (or future entry), with `PORT=3092` (staging) if current is 3091, or `PORT=3091` if current is 3092.
       - `cwd`: new release root directory.
    2. Probe its health endpoint (`GET /api/health`) on that port until:
       - 200 OK and valid JSON, or
       - A configurable timeout is hit → abort and leave old instance active.
    3. Once healthy, **atomically update** `activeNodeTarget.port` (3091 ↔ 3092) in orchestrator memory.
    4. After a configurable drain delay (or immediately, if acceptable), send a graceful shutdown signal to the **old** Node process and wait for exit; force‑kill on timeout.
  - All of this happens **without changing WinSW**; the orchestrator stays up and continues to own port `3090`.

---

### 4. Python worker rolling update (Python‑only or Node+Python)

**Objective:** Refresh the Python worker when its code changes while keeping the orchestrator and port `3090` stable. Node remains the only client of Python.

Required changes:

- **Hash‑based decision**
  - When comparing release hashes:
    - If **Python hash changed and Node hash did not**, orchestrator triggers a **Python‑only recycle**.
    - If **both hashes changed**, orchestrator performs:
      - Python recycle (in the context of the new release), then
      - Node rolling update that targets the new Python worker.

- **Python recycle path**
  - Use existing `WorkerManager` or `server/generator.js` mechanisms:
    - Start Python worker for the new release on **3097** (staging) or recycle in-place on **3096** (primary); correct script path, venv, env vars.
    - Wait for `/readyz` or equivalent health signal.
    - For in-place recycle (Python-only, same port): Python stays on **3096**; supervisor restarts the process; Node keeps `PY_WORKER_PORT=3096`. For rolling Python (e.g. Node+Python change): new worker on **3097**, then start new Node with `PY_WORKER_PORT=3097` and cut over.
  - For **Python‑only change**:
    - Orchestrator keeps **current Node app** (already using `PY_WORKER_HOST`/`PY_WORKER_PORT` = 3096).
    - Triggers worker restart via internal mechanism (e.g. `workerManager.requestRestart("python_update")` or admin API).
    - No change in `activeNodeTarget`; only the Python process on 3096 is recycled.

- **Node+Python change**
  - Orchestrator provisions the new release such that:
    1. Python worker from the new release is healthy.
    2. New Node app instance (from the same release) is configured to talk to that worker.
  - Then execute the **Node rolling swap** (section 3) to cut over traffic.

---

### 5. Deploy state and hash persistence

Add a small, explicit deploy state file under `service/runtime/`, e.g. `service/runtime/deploy-state.json`:

- Shape:
  - `currentReleaseId` (string or path)
  - `nodeHash` (string, tree hash for Node app)
  - `pythonHash` (string, tree hash for Python worker)
  - `deployedAt` (ISO timestamp)
- On each new candidate release:
  - Orchestrator (or updater pipeline) reads **current state**.
  - Computes **candidate hashes** in the new release tree.
  - Decides which components need recycling.
  - Only after successful cutover, writes a new `deploy-state.json` with the updated values.

This keeps deployment decisions deterministic and audit‑friendly.

---

### 6. API surface and triggers (minimal set)

To integrate with GitHub and external tooling while keeping the orchestrator simple:

- **Existing `/webhooks/github`** (service API)
  - Continues to validate and enqueue update events.
  - Passes commit/release metadata into the update queue / pipeline.

- **Internal orchestrator actions**
  - A small set of internal functions (not public APIs) invoked by the update pipeline:
    - `performNodeRollout(newReleaseRoot, reason)`
    - `performPythonRecycle(newReleaseRoot, mode)`
    - `performNodeAndPythonRollout(newReleaseRoot, reason)`
  - These functions encapsulate child process spawn/health‑check/kill logic and `deploy-state.json` updates.

No new public HTTP endpoints are required beyond what already exists for status and webhooks; the orchestrator’s external contract is simply:

- **Listen on port `3090`**
- **Always return a valid `/health` response**
- **Forward app/API traffic to the current active Node instance**

---

### 7. Guardrails and acceptance criteria (from split plan)

**Guardrails**

- Keep external API behavior unchanged while refactoring (URLs, methods, payloads, and response shapes for existing clients).
- Keep service/runtime path behavior compatible with the existing release layout (e.g. active `runtime/current` or its equivalent in the new scheme).
- Favor adapter-style refactors where possible: introduce new code paths and delegate from old ones before deleting, to minimize deploy risk.

**Acceptance criteria**

1. No endpoint behavior regression for current clients (image generation API and status/health endpoints behave the same, aside from intentional additions like new fields).
2. Static files and outputs are still served correctly from the active release’s `public`/`outputs` (or their equivalent), even after moving to a proxy + separate Node app.
3. Provider API logic has a single canonical implementation in `/server` (the Node app), not reimplemented inside the orchestrator.
4. `/service/src` contains orchestration, proxying, and health/webhook surfaces only; it does not own provider business logic or GPU behavior.

---

### 8. Current implementation status

- **Reverse proxy vs. in-process provider**
  - The original critique (0.2) described the service as re-implementing the provider API in-process via `service/src/api/providerApi.js`. That file has been **removed**; the service no longer calls into any provider code. All app traffic on port 3090 is now proxied to the Node app backend on 3091/3092.
  - The canonical app lives in `server/` (handlers, lib, server.js). There is no `server/providerApi.js`; the server uses handlers directly. The service never hosts provider logic.

- **Rolling behavior**
  - The orchestrator resolves the active release via the `runtime/current` link, starts the Node app from that release on 3091, and writes `service/runtime/deploy-state.json` with `currentReleaseDir` and `activeNodePort`. Rolling rollout (3091 ↔ 3092) is wired into `UpdateQueue`: on a successful pipeline run it starts a new Node instance from the staged release, health-checks it, swaps `activeNodeTarget`, and falls back to a full restart only if rollout fails.
  - Python worker recycle: the Node server owns the worker, so “Python recycle” is implemented as triggering another Node app rollout (or a no-op after the deploy’s Node rollout, since the new server spawns a fresh worker on first generate).

