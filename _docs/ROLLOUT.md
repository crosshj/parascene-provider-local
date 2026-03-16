# Windows AI Service — Phased Rollout Instructions

## Purpose

This service will ultimately run a **Node API** that supervises a **Python AI worker**
(image generation + prompt enhancement).

The initial goal is not functionality. The goal is **operational reliability**.

The system must prove it can:

- boot automatically on Windows
- run under a service account
- supervise a worker process
- expose operational API routes
- receive GitHub webhook notifications
- stage updates safely
- monitor GPU health
- recover from crashes

The skeleton will **grow into the final service**.

---

# Architecture Overview

The system contains five major components.

## 1. Service Supervisor

Responsibilities:

- long-lived parent process
- worker lifecycle management
- webhook ingestion
- update orchestration
- operational API

---

## 2. Worker Process

Initially a **dummy worker**.

Later replaced with the **Python AI worker**.

Responsibilities:

- respond to health checks
- run inference
- restart when unhealthy

---

## 3. Updater

Responsible for:

- processing GitHub webhook events
- staging new releases
- smoke testing
- performing cutover

---

## 4. GPU Watchdog

Responsible for:

- probing GPU health
- detecting driver failures
- escalating restart actions

---

## 5. Operational API

Endpoints exposed by the service:

```text
GET  /healthz
GET  /status
POST /webhooks/github
```

---

# Phase 0 — Repository Layout

Create the base structure.

```text
service/
  src/
    supervisor/
    api/
    worker/
    updater/
    gpu/
    config/
  scripts/
  runtime/
  logs/
```

Directory responsibilities:

| Directory  | Purpose                |
| ---------- | ---------------------- |
| supervisor | service orchestration  |
| api        | HTTP endpoints         |
| worker     | dummy worker initially |
| updater    | update pipeline        |
| gpu        | GPU probe module       |
| config     | configuration loader   |
| runtime    | pid/state files        |
| logs       | structured logs        |

---

# Phase 1 — Bootable Windows Service — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Create the parent supervisor.

Entry point:

```text
node src/supervisor/index.js
```

Wrap the service using **WinSW**.

The Windows service must:

- start automatically on boot
- log startup metadata
- expose `/healthz`
- expose `/status`

Startup log must include:

- timestamp
- hostname
- version
- service account
- working directory
- process PID

## Windows Service Recovery

Configure recovery policy:

```text
sc.exe failure "MyService" reset= 86400 actions= restart/5000/restart/10000/restart/30000
```

Meaning:

- restart after first failure
- restart after second
- restart after third
- reset counter after 24h

---

# Phase 2 — Supervised Worker — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Introduce a child worker process.

The worker supports simulation modes:

```text
normal
crash-after=30
hang-after=30
stop-heartbeat-after=30
```

Worker responsibilities:

- emit heartbeat every 3 seconds
- optionally expose `/healthz`
- simulate failures

Supervisor responsibilities:

- track worker PID
- monitor heartbeat
- restart worker on failure

Restart rules:

| Condition           | Action              |
| ------------------- | ------------------- |
| worker exit         | restart immediately |
| 3 missed heartbeats | restart             |
| worker unresponsive | kill + restart      |

## Worker State Model

```text
stopped
starting
healthy
unhealthy
restarting
```

## Service State Model

```text
starting
running
degraded
stopping
```

---

# Phase 3 — GitHub Webhook Ingress — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Expose a public endpoint through **Cloudflare Tunnel**.

```text
POST /webhooks/github
```

Webhook responsibilities:

1. capture raw body
2. verify `X-Hub-Signature-256`
3. validate repository
4. validate branch
5. persist event
6. enqueue update job
7. return HTTP 202

Webhook must **not execute deployment logic**.

## Event Object

```json
{
  "id": "delivery-id",
  "type": "push",
  "repo": "owner/repo",
  "ref": "refs/heads/main",
  "sha": "abc123",
  "receivedAt": "2026-03-15T13:00:00Z"
}
```

---

# Phase 4 — Fake Update Pipeline — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Implement an update state machine.

```text
idle
queued
fetching
staging
smoke-testing
ready
cutover
restarting
complete
failed
```

During this phase:

- fetching may be simulated
- staging creates folder
- smoke test launches temporary worker

Never modify the live directory.

---

# Phase 5 — Real GitHub Fetch — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Replace fake fetch with real repository sync.

Never run `git pull` inside running directory.

Use staged releases.

Example structure:

```text
C:\svc\service\
  current\
  releases\
  logs\
```

Release example:

```text
releases/2026-03-15_130500_sha/
```

Cutover occurs by updating a `current` pointer.

---

# Phase 6 — GPU Probe — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Add GPU health monitoring.

Run every 30 seconds:

```text
nvidia-smi
```

Capture:

- GPU UUID
- temperature
- memory usage
- utilization

Escalation rules:

```text
probe failure -> mark degraded
worker unhealthy + GPU failure -> escalate restart
```

---

# Phase 7 — Replace Dummy Worker — ✅ IMPLEMENTED IN THIS REPO (2026-03-16, with Python-runtime prerequisite)

Replace dummy worker with the real Python AI worker.

Python worker must support:

```text
/healthz
/readyz
```

Supervisor responsibilities:

- wait for readiness
- restart on failure
- track restart counts

---

# Phase 8 — Replace Placeholder API — ✅ IMPLEMENTED IN THIS REPO (2026-03-16)

Replace placeholder endpoints with real API routes.

Operational endpoints must remain:

```text
/healthz
/status
/webhooks/github
```

---

# Phase 9 — Production Safety

Before cutover:

1. stage new version
2. start staged service
3. verify worker start
4. verify health
5. run smoke API call

If any step fails:

```text
do not cut over
```

Rollback must always be possible.

---

# Logging

Structured JSON logs.

Event types:

```text
service.start
service.stop
worker.start
worker.exit
worker.restart
worker.unhealthy
webhook.accepted
webhook.rejected
update.queued
update.stage-start
update.stage-failed
update.cutover
gpu.probe-ok
gpu.probe-failed
```

---

# Key Rules

1. Worker must always run as a separate process.
2. All system state must be visible via `/status`.
3. Webhook handler must be fast.
4. Updates must always be staged.
5. Long operations require timeouts.
6. Service must remain operational even when worker fails.
