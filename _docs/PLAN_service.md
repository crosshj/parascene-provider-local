# Windows AI Service — Implementation Plan

This plan ties the phased rollout (\_docs/ROLLOUT.md) and build sheet (\_docs/BUILD_SHEET.md) to this repo. It defines how the service code is organized so Phase 1 aligns with all later phases, this repo remains the one pulled for releases, and existing application code stays intact.

---

## 1. Repo layout: service under one tree

All Windows-service code lives under a single top-level **`service/`** directory. The rest of the repo is unchanged.

**Repo root = release root** when the updater pulls this repo into `releases/<id>/` (Phase 5+). One clone contains both the Node supervisor and the Python worker (generator).

```text
parascene-provider-local/           # repo root = release root when pulled
├── _docs/
├── generator/                     # unchanged — becomes real worker in Phase 7
├── public/
├── server/                        # unchanged — existing Node app
├── package.json                   # unchanged
│
└── service/                       # NEW — everything from ROLLOUT Phase 0
    ├── src/
    │   ├── supervisor/            # index.js, nodeAppManager.js, proxy.js, deployState.js (no WorkerManager; Python owned by server)
    │   ├── api/                   # healthz, status, githubWebhook (Phases 1, 2, 5, …)
    │   ├── worker/                # (obsolete — was dummyWorker; Python is now server-owned)
    │   ├── updater/               # Phase 4+
    │   ├── gpu/                   # Phase 6
    │   └── config/                # config loader
    ├── scripts/
    │   └── install.js            # create runtime/logs, generate WinSW config (Phase 1)
    ├── runtime/                   # pid/state (created at run time, .gitignore)
    └── logs/                      # service.log (created at run time, .gitignore)
```

**Principles:**

- Current code stays intact: `generator/`, `server/`, `public/`, `package.json` are not moved or renamed.
- Later phases only add or extend under `service/` (same `src/` and scripts layout).
- When we pull this repo into `releases/<id>/`, that directory is the full repo; no separate “app” copy.

---

## 2. How the service runs

- **Working directory:** The Node process is started with **cwd = repo root** (the release directory), e.g. `C:\svc\service\current\`.
- **Entry point:**  
  `node service/src/supervisor/index.js`  
  So WinSW (or the install script) uses:
  - **Executable:** `node`
  - **Arguments:** `service/src/supervisor/index.js`
  - **Working directory:** the release root (repo root).

Inside the supervisor:

- **Service root:** Resolve once, e.g.  
  `const serviceRoot = path.join(process.cwd(), 'service')`  
  Use it for:
  - `path.join(serviceRoot, 'runtime')`
  - `path.join(serviceRoot, 'logs')`
  - any paths under `service/scripts` or `service/src`.
- **Phase 7 (real worker):** The worker is the existing Python stack; the supervisor spawns it from repo root (e.g. `python generator/...` or a small runner), with **cwd = process.cwd()** (repo root). The same clone runs both the service and the generator.

---

## 3. Build sheet path → repo path

Paths in the build sheet are interpreted as **under the service**:

| Build sheet path            | Repo path                           |
| --------------------------- | ----------------------------------- |
| `src/supervisor/index.js`   | `service/src/supervisor/index.js`   |
| `src/api/status.js`         | `service/src/api/status.js`         |
| `src/worker/dummyWorker.js` | `service/src/worker/dummyWorker.js` |
| `src/updater/*`             | `service/src/updater/*`             |
| `src/gpu/*`                 | `service/src/gpu/*`                 |
| `src/config/*`              | `service/src/config/*`              |
| `src/utils/logger.js`       | `service/src/utils/logger.js`       |
| `runtime/`, `logs/`         | `service/runtime/`, `service/logs/` |
| `scripts/install.js`        | `service/scripts/install.js`        |

---

## 4. Phase 1 scope (Bootable Windows Service) — ✅ DONE (2026-03-16)

**Goal:** A bootable Windows service that starts on boot, exposes `/healthz` and `/status`, logs startup metadata, and uses Windows recovery (restart on failure).

**Add for Phase 1:**

| Item              | Location                                 | Notes                                                                                                                                                                |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supervisor entry  | `service/src/supervisor/index.js`        | Start HTTP server; mount `/healthz` and `/status`; set `serviceRoot`; write startup log.                                                                             |
| Health endpoint   | `service/src/api/`                       | e.g. `healthz.js` and `status.js` (or one small router).                                                                                                             |
| Status endpoint   | `service/src/api/status.js`              | Return version, uptime, parentPid; worker/gpu/updater can be empty stubs for Phase 1.                                                                                |
| Config            | `service/src/config/index.js` (optional) | Read version from repo root `package.json`, port, etc.                                                                                                               |
| Logger            | `service/src/utils/logger.js`            | Structured JSON to `service/logs/service.log`; used for startup event.                                                                                               |
| Runtime/logs dirs | `service/runtime/`, `service/logs/`      | Created at startup or by install script; add to `.gitignore`.                                                                                                        |
| Install script    | `service/scripts/install.js`             | Create runtime/logs; require bundled `parascene-service.exe`; generate `parascene-service.xml` (working dir = repo root); print install/start and recovery commands. |

**Startup log must include (ROLLOUT):**

- timestamp
- hostname
- version
- service account
- working directory
- process PID

**Recovery (ROLLOUT):**

```text
sc.exe failure "<ServiceName>" reset= 86400 actions= restart/5000/restart/10000/restart/30000
```

---

## 5. Phase 1 verification

| Check          | How                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starts on boot | Reboot the Windows machine; confirm the service is running (e.g. `Get-Service`, Services.msc).                                                                                                     |
| `/healthz`     | `curl http://localhost:<port>/healthz` → 200, e.g. `{ "ok": true }`.                                                                                                                               |
| `/status`      | `curl http://localhost:<port>/status` → 200, JSON with version, uptime, PID.                                                                                                                       |
| Startup log    | Open `service/logs/service.log`; one startup event with timestamp, hostname, version, service account, working directory, PID. (This file is created at runtime and gitignored — never committed.) |
| Recovery       | Kill the Node process; within the configured delays the service should restart; `/healthz` and `/status` work again.                                                                               |

---

## 6. Later phases (summary)

- **Phase 2:** Worker manager + dummy worker (heartbeat, restart rules). ✅ DONE (2026-03-16)
- **Phase 3:** GitHub webhook ingress (`POST /webhooks/github`). ✅ DONE (2026-03-16)
- **Phase 4:** Fake update pipeline (state machine). ✅ DONE (2026-03-16)
- **Phase 5:** Real GitHub fetch; staged releases; `current` pointer. ✅ DONE (2026-03-16)
- **Phase 6:** GPU probe (nvidia-smi, `runtime/gpu-state.json`). ✅ DONE (2026-03-16)
- **Phase 7:** Replace dummy worker with Python generator (this repo’s `generator/`). ✅ DONE (2026-03-16, requires runnable Python for service account; falls back to dummy if unavailable)
- **Phase 8:** Replace placeholder API with real routes; keep `/healthz`, `/status`, `/webhooks/github`. ✅ DONE (2026-03-16)
- **Phase 9:** Production safety (stage → smoke test → cutover; rollback always possible).

All new code continues to live under `service/`; worker runs from repo root (`generator/`).
