# parascene-provider-local

a local provider for parascene

### current state

there are two apps here

1. image generator server in **Node** (`/server`, `/public`) that drives **ComfyUI** over HTTP (managed Comfy process + `server/workflows` JSON graphs).
2. Windows service (WinSW) that runs the orchestrator and proxies to the Node app (`/service`).

For details and maintenance notes about the Windows service, see [service/README.md](service/README.md).

**Port block:** The service listens on **3090** (orchestrator). It proxies app traffic to the Node server on **3091** (active) or **3092** (staging during deploys). The Node app warms Comfy on startup and reports engine PID in **`GET /api/health`** for deploy/orphan cleanup (same contract as the former in-repo Python worker; see `_docs/python_removal_node_comfy_only.md`). Comfy’s HTTP API defaults to **8188** on localhost (see `server/generator/managed-instance.js`).

### available on the internet

image gen:
https://provider1.parascene.com/

service:
https://blue.parascene.com/status
https://blue.parascene.com/healthx
