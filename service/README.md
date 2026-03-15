# Windows AI Service (Phase 1)

Supervisor for the local AI provider: bootable Windows service, `/healthz`, `/status`, structured logging.

## Run locally

From **service/** directory:

```bash
npm start
```

Or from **repo root** (matches deployed layout; working directory = repo root):

```bash
node service/src/supervisor/index.js
```

Default port: 3090 (override with `SERVICE_PORT`).

- **GET** http://localhost:3090/healthz → `{ "ok": true }`
- **GET** http://localhost:3090/status → version, uptime, parentPid, worker/gpu/updater

Logs: `service/logs/service.log` (JSON lines). This path is **created at runtime** and is **gitignored** — it is never committed and is local to the machine where the service runs.

## Install as Windows service

See **PHASE1_QUICKSTART.md** in this folder for full steps; summary:

1. Deploy repo to a release directory (e.g. `C:\svc\service\current`).
2. From that directory, run `node service/scripts/install.js` (or pass the base path as first arg) to create runtime/logs dirs and generate `service/scripts/service.generated.xml`.
3. Use WinSW to install the service (config: `service/scripts/service.generated.xml`).
4. Set recovery: `sc failure ParasceneProviderLocal reset=86400 actions=restart/5000/restart/10000/restart/30000`
