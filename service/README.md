# Windows AI Service (Phase 1)

Supervisor for the local AI provider: bootable Windows service, `/healthz`, `/status`, structured logging.

## Local run

From **service/**:

```bash
npm start
```

From **repo root** (same working directory as service mode):

```bash
node service/src/supervisor/index.js
```

Default port: `3090` (override with `SERVICE_PORT`).

## Windows service install (single path)

Use this exact flow:

1. Place `WinSW.exe` at `service/scripts/` and rename it to `parascene-service.exe`.
2. From the repo root, run:

   ```bash
   node service/scripts/install.js
   ```

   The script validates paths, creates `service/runtime` and `service/logs`, and generates `service/scripts/parascene-service.xml`.

3. In an **Administrator** terminal, install and start the service:

   ```powershell
   .\service\scripts\parascene-service.exe install
   .\service\scripts\parascene-service.exe start
   ```

4. Set recovery:

   ```powershell
   sc.exe failure "ParasceneProviderLocal" reset= 86400 actions= restart/5000/restart/10000/restart/30000
   ```

## Verify

- `curl http://localhost:3090/healthz` → `{"ok":true}`
- `curl http://localhost:3090/status` → JSON with version, uptime, parentPid, worker/gpu/updater
- Check `service/logs/service.log` for `service.start`

## Verify (GUI)

- Open `services.msc` and confirm `ParasceneProviderLocal` is `Running`.
- Open `eventvwr.msc` → **Windows Logs > Application** for service start/error events.
