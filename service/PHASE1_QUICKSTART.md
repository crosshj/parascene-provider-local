# Phase 1 — Quick start and verification

Get the Phase 1 supervisor running and confirm it works.

---

## Run locally

**Option A — from this directory (service/):**

```bash
npm start
```

**Option B — from the repo root** (same as deployed; working directory = repo root):

```bash
node service/src/supervisor/index.js
```

- Default port: **3090** (override with `SERVICE_PORT`).
- Logs: `service/logs/service.log` from repo root, or `logs/service.log` from here (created at runtime, gitignored).

---

## Verify (local)

| Check | How |
|-------|-----|
| **healthz** | `curl http://localhost:3090/healthz` → `{"ok":true}` |
| **status** | `curl http://localhost:3090/status` → JSON with version, uptime, parentPid, worker/gpu/updater |
| **Startup log** | Open `service/logs/service.log` (from repo root) or `logs/service.log` (from here) → `service.start` event with timestamp, hostname, version, serviceAccount, workingDirectory, processPid |

---

## Install as Windows service

### WinSW (Windows Service Wrapper)

WinSW runs any executable as a Windows service. You need it to register the Node supervisor as a service.

- **Download:** [GitHub Releases](https://github.com/winsw/winsw/releases). Use the `.exe` that matches your system (e.g. `WinSW-x64.exe` if you have .NET Framework; otherwise use the .NET Core build if needed).
- **Usage (two options):**
  1. **Bundled:** Rename `WinSW-x64.exe` to `ParasceneProviderLocal.exe`. Place it in `service/scripts/` next to `service.generated.xml`. Then:
     ```powershell
     cd service\scripts
     .\ParasceneProviderLocal.exe install
     ```
  2. **Global:** Keep `WinSW.exe` anywhere and point it at the config:
     ```powershell
     WinSW.exe install -c "D:\svc\current\service\scripts\service.generated.xml"
     ```
- **Commands:** `install`, `uninstall`, `start`, `stop`, `restart`, `status`. Run from the directory that contains the exe and XML (bundled), or pass `-c path\to\config.xml` (global).
- **Important:** The XML’s `<workingdirectory>` must be your **release root** (repo root), so the service runs with the same layout as when you run `node service/src/supervisor/index.js` from that directory. The install script generates the XML with those paths.

### Steps

1. **Deploy** the repo to your release directory (e.g. `D:\svc\current`).
2. From that directory, run the install script to create `service/runtime` and `service/logs` and generate `service/scripts/service.generated.xml`:
   ```bash
   node service/scripts/install.js D:\svc\current
   ```
   (Omit the path to use the current directory.)
3. **Install with WinSW** using one of the methods above (bundled exe + `install`, or global exe with `-c service.generated.xml`). Run as Administrator.
4. **Recovery policy:**
   ```powershell
   sc failure ParasceneProviderLocal reset=86400 actions=restart/5000/restart/10000/restart/30000
   ```

---

## Verify (Windows service)

| Check | How |
|-------|-----|
| **Starts on boot** | Reboot; confirm service is running (`Get-Service ParasceneProviderLocal`, or Services.msc). |
| **healthz** | `curl http://localhost:3090/healthz` → `{"ok":true}` |
| **status** | `curl http://localhost:3090/status` → JSON as above. |
| **Startup log** | Open `service/logs/service.log` in the release directory → `service.start` with expected fields. |
| **Recovery** | Kill the Node process; service should restart within the configured delays; healthz and status work again. |

---

See **_docs/PLAN_service.md** and **_docs/ROLLOUT.md** for full context.
