# Windows AI Service

Node supervisor service for local provider operations:

- `GET /healthz`
- `GET /status`
- `POST /webhooks/github`

## Env (`dotenv`)

Loaded in this order:

1. `service/.env`
2. repo root `.env`

Start from [service/.env.example](service/.env.example).

Required for webhooks:

- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_WEBHOOK_REPO`
- `GITHUB_WEBHOOK_BRANCH`

Optional for private repo fetch:

- `GITHUB_FETCH_TOKEN`

Optional:

- `SERVICE_PORT` (default `3090`)
- `WORKER_MODE` (default `normal`)

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

- `curl https://provider-green.parascene.com/healthz`
- `curl https://provider-green.parascene.com/status`
