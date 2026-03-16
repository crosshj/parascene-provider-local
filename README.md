# parascene-provider-local

a local provider for parascene

### current state

there are two apps here

1. image generator server which in node and python (/server, /public, /generator)
2. Windows service (WinSW) that runs the orchestrator and proxies to the Node app (/service)

**Port block:** The service listens on **3090** (orchestrator). It proxies app traffic to the Node server on **3091** (active) or **3092** (staging during deploys). The Node server owns a single Python worker process (spawned on first generate; no separate worker ports). See `_docs/BIRDS_EYE_VIEW.md` for the current layout.

### available on the internet

image gen:
https://provider1.parascene.com/

service:
https://blue.parascene.com/status
https://blue.parascene.com/healthx
