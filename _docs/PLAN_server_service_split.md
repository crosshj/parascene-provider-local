# Server / Service Split Plan

Date: 2026-03-16

## Goal

Make `/server` the single owner of provider/runtime behavior, while `/service/src` remains focused on:

- supervisor lifecycle
- updater/release orchestration
- service-only status/health/webhook interfaces

## Scope and phases

### Phase 0 — Guardrails (now)

- Keep external API behavior unchanged.
- Keep service runtime path behavior (`runtime/current`) unchanged.
- Minimize deploy risk with adapter-style refactors.

### Phase 1 — Canonical provider module in `/server` (in progress)

- Add `server/providerApi.js` with canonical request handlers for:
  - `GET /api/health`
  - `GET /api/models`
  - `POST /api/generate`
  - `GET /outputs/*`
  - `GET /app*` and `/`
- Support injected path resolvers for `public` and `outputs` so service can keep runtime/current behavior.

### Phase 2 — Service adapter only

- Refactor `service/src/api/providerApi.js` to:
  - resolve `public`/`outputs` paths for service runtime
  - delegate request handling to `server/providerApi.js`
- Remove duplicated request parsing, prompt sanitization, and response shaping from service copy.

### Phase 3 — Standalone server alignment

- Refactor `server/server.js` to use `server/providerApi.js` for route behavior.
- Keep logging and security middleware local to `server/server.js`.

### Phase 4 — Service boundary cleanup

- Keep in `/service/src/api` only:
  - `healthz.js`
  - `status.js`
  - `githubWebhook.js`
- Keep provider API implementation entirely in `/server`.

### Phase 5 — Rolling-ready architecture

- Introduce stable front process in supervisor and release app instances behind it.
- Add health-gated traffic switch and rollback.
- Keep Python worker warm unless Python fingerprint changes.

## Acceptance criteria

1. No endpoint behavior regression for current clients.
2. Service still serves static files from active `runtime/current/public` after cutover.
3. Provider API logic has a single canonical implementation in `/server`.
4. `/service/src` contains orchestration concerns only.

## Started now

- Phase 1 + Phase 2 implementation kickoff.
