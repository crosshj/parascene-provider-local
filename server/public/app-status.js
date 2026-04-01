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
  return fetch(path, init);
}

const $ = (id) => document.getElementById(id);
const set = (id, v) => {
  const el = $(id);
  if (!el) return;
  el.textContent = v == null || v === "" ? "—" : String(v);
};

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

function fmtBytes(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function extractPromptId(queueEntry) {
  if (!queueEntry) return null;
  if (typeof queueEntry === "string") return queueEntry;
  if (Array.isArray(queueEntry)) {
    for (const part of queueEntry) {
      if (typeof part === "string" && part.length >= 8) return part;
      if (part && typeof part === "object" && typeof part.prompt_id === "string") {
        return part.prompt_id;
      }
    }
    return null;
  }
  if (typeof queueEntry === "object" && typeof queueEntry.prompt_id === "string") {
    return queueEntry.prompt_id;
  }
  return null;
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
  const [h, s, ah] = await Promise.all([
    getJson("/healthz"),
    getJson("/status"),
    getJson("/api/health"),
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

  const apiHealth = ah.data || {};
  const comfy = apiHealth.comfy || {};
  const system = comfy.system_stats?.system || {};
  const devices = Array.isArray(comfy.system_stats?.devices)
    ? comfy.system_stats.devices
    : [];
  const queueRunning = Array.isArray(comfy.queue?.queue_running)
    ? comfy.queue.queue_running
    : [];
  const queuePending = Array.isArray(comfy.queue?.queue_pending)
    ? comfy.queue.queue_pending
    : [];
  const activePromptId = extractPromptId(queueRunning[0]);
  const vramTotal = devices.reduce(
    (sum, d) => sum + (typeof d?.vram_total === "number" ? d.vram_total : 0),
    0,
  );
  const vramFree = devices.reduce(
    (sum, d) => sum + (typeof d?.vram_free === "number" ? d.vram_free : 0),
    0,
  );

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
  set("comfyQueueHttp", comfy.queue_http_status != null ? comfy.queue_http_status : "—");
  set("comfyQueueRunning", queueRunning.length);
  set("comfyQueuePending", queuePending.length);
  set("comfyActivePromptId", activePromptId || "none");
  set("comfyDevices", devices.length);
  set("comfyDeviceNames", fmtComfyDeviceNames(comfy.system_stats));
  set("comfyVersion", system.comfyui_version || "—");
  const python = system.python_version || "—";
  const pytorch = system.pytorch_version || "—";
  set("comfyRuntime", `${python} / ${pytorch}`);
  if (typeof system.ram_free === "number" && typeof system.ram_total === "number") {
    set("comfyRam", `${fmtBytes(system.ram_free)} / ${fmtBytes(system.ram_total)}`);
  } else {
    set("comfyRam", "—");
  }
  if (vramTotal > 0) {
    set("comfyVram", `${fmtBytes(vramFree)} / ${fmtBytes(vramTotal)}`);
  } else {
    set("comfyVram", "—");
  }

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
  set("apiModelsCount", apiHealth.models ?? "—");

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

  const schedulerPending =
    typeof jobs.queueLength === "number" ? jobs.queueLength : 0;
  const schedulerRunning =
    typeof jobs.runningCount === "number" ? jobs.runningCount : 0;
  const comfyPendingCount = queuePending.length;
  const comfyRunningCount = queueRunning.length;

  let pipelineState = "idle";
  if (comfy.running !== true) {
    pipelineState = "comfy unreachable";
  } else if (schedulerPending > 0 && comfyPendingCount === 0 && comfyRunningCount === 0) {
    pipelineState = "queued at scheduler";
  } else if (schedulerPending > 0 || schedulerRunning > 0 || comfyPendingCount > 0 || comfyRunningCount > 0) {
    pipelineState = "flowing";
  }
  set("pipelineState", pipelineState);
  set(
    "pipelineLag",
    `${schedulerPending} scheduler / ${comfyPendingCount} comfy (Δ ${Math.max(0, schedulerPending - comfyPendingCount)})`,
  );

  const coreGood = h.ok && s.ok;
  const workerGood = comfy.running === true;
  const gpuGood = classifyState(gpu.status) === "ok";
  const apiGood = ah.ok && ah.data?.ok !== false;
  const updaterBad = classifyState(up.state) === "bad" || !!up.lastFailedJob;
  const jobsBad =
    typeof jobs.queueLength === "number" &&
    jobs.queueLength > 0 &&
    classifyState(comfy.running === true ? "running" : "stopped") === "bad";

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
