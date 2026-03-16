#!/usr/bin/env python3
"""
Phase 7 worker server.

Lightweight HTTP worker process that exposes:
- GET /healthz
- GET /readyz

This runs as a separate Python process supervised by the Node service.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STARTED_AT = time.time()
READY = False
SHUTTING_DOWN = False


class Handler(BaseHTTPRequestHandler):
    server_version = "ParascenePythonWorker/1.0"

    def log_message(self, _format: str, *_args) -> None:
        # Quiet default HTTP access logs.
        return

    def do_GET(self):
        if self.path == "/healthz":
            return self._send_json(
                200,
                {
                    "ok": True,
                    "pid": os.getpid(),
                    "uptimeMs": int((time.time() - STARTED_AT) * 1000),
                },
            )

        if self.path == "/readyz":
            if READY and not SHUTTING_DOWN:
                return self._send_json(200, {"ready": True})
            return self._send_json(503, {"ready": False})

        return self._send_json(404, {"error": "Not found"})

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _set_ready_after(delay_sec: float) -> None:
    global READY
    if delay_sec > 0:
        time.sleep(delay_sec)
    if not SHUTTING_DOWN:
        READY = True


def main() -> int:
    global SHUTTING_DOWN

    host = os.environ.get("PY_WORKER_HOST", "127.0.0.1")
    port = int(os.environ.get("PY_WORKER_PORT", "3199"))
    ready_delay_ms = int(os.environ.get("PY_WORKER_READY_DELAY_MS", "500"))

    server = ThreadingHTTPServer((host, port), Handler)

    def _shutdown(_signum=None, _frame=None):
        global READY, SHUTTING_DOWN
        SHUTTING_DOWN = True
        READY = False
        try:
            server.shutdown()
        except Exception:
            pass

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    threading.Thread(
        target=_set_ready_after,
        args=(max(0, ready_delay_ms) / 1000.0,),
        daemon=True,
    ).start()

    sys.stderr.write(
        f"[python-worker] listening on http://{host}:{port} (pid={os.getpid()})\n"
    )
    sys.stderr.flush()

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        try:
            server.server_close()
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
