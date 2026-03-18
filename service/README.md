# Windows AI Service

Node supervisor service for local provider operations:

## Recent Maintenance

On March 18, 2026, a duplicate declaration in `server/handlers/health.js` was fixed. If the service fails to start, check logs for JavaScript errors and restart using WinSW (`parascene-service.exe`).

- `GET /healthz`
- `GET /status`
- `POST /webhooks/github`
- `GET /api/health`
- `GET /api/models`
- `POST /api/generate`
- `GET /outputs/:file`

## Env (`dotenv`)

Loaded in this order:

1. persistent service root `.env` (`SERVICE_DATA_ROOT/.env` when set, otherwise `service/.env`)
2. persistent repo root `.env`
3. release-local `service/.env` (fallback only)
4. release-local repo root `.env` (fallback only)

Start from [service/.env.example](service/.env.example).

When the Windows service runs from `service/runtime/current`, the staged release remains code-only while secrets continue loading from the persistent service root.

Required for webhooks:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_WEBHOOK_REPO`
- `GITHUB_WEBHOOK_BRANCH`

Optional for private repo fetch:

- `GITHUB_FETCH_TOKEN`

Optional:

- `SERVICE_PORT` (default `3090`)
- `GPU_PROBE_INTERVAL_MS` (default `30000`)

Provider API auth:

- `PARASCENE_API_KEY` (shared bearer token for `/api` and related client calls; defaults to `parascene-local-dev-token` in local development)

The Python image generator is owned by the server (Node app): the server spawns it on first generate and it is torn down when the server process exits. The service does not start or monitor a separate worker.

## Run

From [service](service):

```bash
npm start
```

## Windows service control (WinSW)

From repo root:

```powershell
.\service\scripts\parascene-service.exe restart
```

Use this after changing `service/.env` or deploying new service code.

Note: direct `sc stop/start ParasceneProviderLocal` can fail with Access Denied in a non-elevated shell; use the WinSW wrapper restart command above.

## Quick verify

- `curl https://blue.parascene.com/healthz`
- `curl https://blue.parascene.com/status`
