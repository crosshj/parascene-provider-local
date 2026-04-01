"use strict";

const CREDENTIALS_STORAGE_KEY = "credentials";

function getStoredCredentials() {
  try {
    const raw = localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredCredentials(value) {
  try {
    if (!value) {
      localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
    } else {
      localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // Ignore storage failures.
  }
}

async function apiFetch(path, options = {}) {
  const creds = getStoredCredentials();
  const init = { ...options };
  const headers = new Headers(init.headers || {});

  if (creds && typeof creds === "object") {
    if (typeof creds.token === "string" && creds.token.trim()) {
      headers.set("Authorization", `Bearer ${creds.token.trim()}`);
    }
    if (
      typeof creds.cfAccessClientId === "string" &&
      creds.cfAccessClientId.trim()
    ) {
      headers.set("CF-Access-Client-Id", creds.cfAccessClientId.trim());
    }
    if (
      typeof creds.cfAccessClientSecret === "string" &&
      creds.cfAccessClientSecret.trim()
    ) {
      headers.set("CF-Access-Client-Secret", creds.cfAccessClientSecret.trim());
    }
  }

  init.headers = headers;

  const res = await fetch(path, init);
  if (res.status === 401) {
    throw new Error(
      "Unauthorized: token or access credentials invalid or missing.",
    );
  }
  return res;
}

const $ = (id) => document.getElementById(id);
const set = (id, v) =>
  ($(id).textContent = v == null || v === "" ? "—" : String(v));

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleString()} (${relTime(d)})`;
}

function relTime(d) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.round(h / 24);
  return `${dd}d ago`;
}

function classifyState(state) {
  if (!state) return "warn";
  const s = String(state).toLowerCase();
  if (["healthy", "running", "complete", "idle", "ok"].includes(s)) {
    return "ok";
  }
  if (["failed", "error", "unhealthy", "degraded", "stopped"].includes(s)) {
    return "bad";
  }
  return "warn";
}

function setPill(label, cls) {
  const el = $("overall");
  el.textContent = label;
  el.className = `pill ${cls}`;
}

function fmtLastEvent(ev) {
  if (!ev) return "none";
  return `${ev.type || "?"} ${ev.ref || ""} ${ev.sha ? ev.sha.slice(0, 12) : ""} @ ${fmtTime(ev.receivedAt)}`;
}

function fmtJob(job) {
  if (!job) return "none";
  const id = job.id || "?";
  const sha = job.sha ? job.sha.slice(0, 12) : "?";
  const when = job.completedAt || job.failedAt || null;
  return `${id} (${sha}) @ ${fmtTime(when)}`;
}

function fmtCurrentJob(job) {
  if (!job) return "none";
  const id = job.id || "?";
  const sha = job.sha ? job.sha.slice(0, 12) : "?";
  const ref = job.ref || "?";
  return `${id} (${sha}) ${ref}`;
}

function fmtQueueShas(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return "none";
  return queue
    .map((job) => `${(job.sha || "?").slice(0, 12)}:${job.state || "?"}`)
    .join(" | ");
}

function fmtComfyDeviceNames(stats) {
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  if (!devices.length) return "none";
  return devices
    .map((d) => d?.name || d?.type || "unknown")
    .filter(Boolean)
    .join(" | ");
}

function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function inferSource(st, up) {
  const cwd = st.workingDirectory || "";
  const cur = up.currentRelease || null;
  const currentTarget =
    (up.currentLinkTarget && up.currentLinkTarget.pathAbs) ||
    up.currentLinkTarget ||
    "";
  const releaseDir = cur?.releaseDir || "";
  const sameAsRelease =
    normalizePath(currentTarget) &&
    normalizePath(releaseDir) &&
    normalizePath(currentTarget) === normalizePath(releaseDir);
  if (
    cwd.includes("\\service\\runtime\\current") ||
    cwd.includes("/service/runtime/current")
  ) {
    if (sameAsRelease) {
      return "runtime/current -> auto-updated release";
    }
    if (
      cur?.mode === "phase-9-bootstrap" ||
      cur?.releaseId === "seed-local-working-copy"
    ) {
      return "runtime/current -> repo working copy (seed/bootstrap)";
    }
    return "runtime/current -> manual/local target (pointer mismatch)";
  }
  if (!cwd) {
    return "unknown";
  }
  return "direct repo execution (not through runtime/current)";
}

async function getJson(url) {
  const res = await apiFetch(url, { cache: "no-store" });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function refresh() {
  const [h, s, ah, am] = await Promise.all([
    getJson("/healthz"),
    getJson("/status"),
    getJson("/api/health"),
    getJson("/api/models"),
  ]);

  set("lastRefresh", new Date().toLocaleTimeString());

  set("coreHealthz", `${h.status} ${h.ok ? "OK" : "FAIL"}`);
  set("coreStatus", `${s.status} ${s.ok ? "OK" : "FAIL"}`);

  const st = s.data || {};
  set("coreVersion", st.version);
  set(
    "coreUptime",
    st.uptime != null ? `${Math.round(st.uptime / 1000)}s` : "—",
  );
  set("corePid", st.parentPid);
  set("coreCwd", st.workingDirectory || "—");

  const wk = ah.data && ah.data.worker ? ah.data.worker : {};
  set("wkState", wk.running === true ? "running" : "stopped (or not started)");
  set("wkPid", wk.pid != null ? wk.pid : "—");

  const apiHealth = ah.data || {};
  const comfy = apiHealth.comfy || {};
  set("comfyState", comfy.running === true ? "running" : "unreachable");
  set("comfyManaged", comfy.managed === true ? "yes" : "no");
  set("comfyPid", comfy.pid != null ? comfy.pid : "—");
  set("comfyHost", comfy.host || "—");
  set("comfyPort", comfy.port != null ? comfy.port : "—");
  set("comfyRoot", comfy.root || "—");
  set(
    "comfyStatsHttp",
    comfy.system_stats_http_status != null ? comfy.system_stats_http_status : "—",
  );
  const comfyDevices = Array.isArray(comfy.system_stats?.devices)
    ? comfy.system_stats.devices.length
    : "—";
  set("comfyDevices", comfyDevices);
  set("comfyDeviceNames", fmtComfyDeviceNames(comfy.system_stats));

  const gpu = st.gpu || {};
  set("gpuState", gpu.status);
  set("gpuLastSuccess", fmtTime(gpu.lastSuccessAt));
  set("gpuLastFailure", fmtTime(gpu.lastFailureAt));
  set("gpuFailCount", gpu.failureCount);
  set("gpuCount", Array.isArray(gpu.gpus) ? gpu.gpus.length : "—");

  const up = st.updater || {};
  set("upState", up.state);
  set("upProcessing", up.processing);
  set("upQueue", up.queueLength);
  set("upCurrent", fmtCurrentJob(up.currentJob));
  set("upCurrentStage", up.currentJob?.state || "none");
  set("upCurrentTransition", fmtTime(up.currentJob?.transitionedAt));
  set("upQueuedShas", fmtQueueShas(up.queue));
  set("upLastEvent", fmtLastEvent(up.lastEvent));
  set("upCompleted", fmtJob(up.lastCompletedJob));
  set("upFailed", fmtJob(up.lastFailedJob));
  set(
    "upMode",
    up.lastCompletedJob?.result?.mode || up.currentRelease?.mode || "n/a",
  );
  set("upRetention", up.releaseRetentionMax);

  const commit = up.currentRelease?.headCommit || {};
  const curSha =
    (commit.id && String(commit.id).slice(0, 12)) ||
    (up.currentRelease?.resolvedSha || "unknown (no pointer)");
  set("curSha", curSha);
  set("curReleaseId", up.currentRelease?.releaseId);
  set("curMode", up.currentRelease?.mode);
  set("curUpdated", fmtTime(up.currentRelease?.updatedAt));
  set("curDir", up.currentRelease?.releaseDir || "—");
  const curLinkTargetPath =
    (up.currentLinkTarget && up.currentLinkTarget.path) ||
    up.currentLinkTarget ||
    "";
  set("curLinkTarget", curLinkTargetPath || "—");
  set("curSource", inferSource(st, up));
  set("curCommitMsg", commit.message || "—");
  const authorName =
    (commit.author && commit.author.name) || commit.author_name || null;
  const authorEmail =
    (commit.author && commit.author.email) || commit.author_email || null;
  const authorLabel = authorName
    ? authorEmail
      ? `${authorName} <${authorEmail}>`
      : authorName
    : authorEmail || "—";
  set("curCommitAuthor", authorLabel);
  const commitTime =
    commit.timestamp ||
    (commit.author && commit.author.date) ||
    commit.committer?.date ||
    null;
  set("curCommitTime", fmtTime(commitTime));

  set("apiHealth", `${ah.status} ${apiHealth.ok ? "OK" : "FAIL"}`);
  set("apiOutputDir", apiHealth.output_dir || "—");
  set("apiPublicDir", apiHealth.public_dir || "—");
  set(
    "apiModelsCount",
    Array.isArray(am.data?.models) ? am.data.models.length : "—",
  );

  const jobs = apiHealth.jobs || {};
  set("jobQueueLen", jobs.queueLength ?? "0");
  set("jobRunning", jobs.runningCount ?? "0");
  set("jobActiveModel", jobs.activeModel || "none");
  if (jobs.byModel && typeof jobs.byModel === "object") {
    const parts = [];
    for (const [key, val] of Object.entries(jobs.byModel)) {
      const pending = val && typeof val.pending === "number" ? val.pending : 0;
      parts.push(`${key}:${pending}`);
    }
    set("jobByModel", parts.length ? parts.join(" | ") : "none");
  } else {
    set("jobByModel", "none");
  }

  const coreGood = h.ok && s.ok;
  const workerGood = wk.running === true;
  const gpuGood = classifyState(gpu.status) === "ok";
  const apiGood = ah.ok && ah.data?.ok !== false;
  const updaterBad = classifyState(up.state) === "bad" || !!up.lastFailedJob;
  const jobsBad =
    typeof jobs.queueLength === "number" &&
    jobs.queueLength > 0 &&
    classifyState(wk.running === true ? "running" : "stopped") === "bad";

  if (!coreGood || updaterBad || !apiGood || jobsBad) setPill("NOT HEALTHY", "bad");
  else if (!workerGood || !gpuGood) setPill("DEGRADED", "warn");
  else setPill("HEALTHY", "ok");
}

let timer = null;
function syncAuto() {
  if (timer) clearInterval(timer);
  if ($("autoChk").checked) {
    timer = setInterval(refresh, 5000);
  }
}

function initTokenGate() {
  const gate = document.getElementById("token-gate");
  const appRoot = document.getElementById("app-root");
  const form = document.getElementById("token-form");
  const textarea = document.getElementById("credentials-json");
  if (!gate || !appRoot || !form || !textarea) return;

  const stored = getStoredCredentials();
  if (stored) {
    textarea.value = JSON.stringify(stored, null, 2);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = textarea.value.trim();
    if (!raw) {
      alert("Please paste credentials JSON.");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      alert("Invalid JSON. Please check your syntax.");
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      alert("Credentials JSON must be an object.");
      return;
    }

    const token =
      typeof parsed.token === "string" ? parsed.token.trim() : "";
    const cfId =
      typeof parsed.cfAccessClientId === "string"
        ? parsed.cfAccessClientId.trim()
        : "";
    const cfSecret =
      typeof parsed.cfAccessClientSecret === "string"
        ? parsed.cfAccessClientSecret.trim()
        : "";

    if (!token || !cfId || !cfSecret) {
      alert(
        'Credentials JSON must include non-empty "token", "cfAccessClientId", and "cfAccessClientSecret" string fields.',
      );
      return;
    }

    const normalized = {
      token,
      cfAccessClientId: cfId,
      cfAccessClientSecret: cfSecret,
    };

    setStoredCredentials(normalized);
    gate.hidden = true;
    appRoot.hidden = false;

    refresh();
    syncAuto();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const gate = document.getElementById("token-gate");
  const appRoot = document.getElementById("app-root");

  initTokenGate();

  const creds = getStoredCredentials();
  if (!creds) {
    if (gate) gate.hidden = false;
    if (appRoot) appRoot.hidden = true;
  } else {
    if (gate) gate.hidden = true;
    if (appRoot) appRoot.hidden = false;
    $("refreshBtn").addEventListener("click", refresh);
    $("autoChk").addEventListener("change", syncAuto);
    refresh();
    syncAuto();
  }
});
