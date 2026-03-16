"use strict";

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

function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function inferSource(st, up) {
  const cwd = st.workingDirectory || "";
  const cur = up.currentRelease || null;
  const currentTarget = up.currentLinkTarget || "";
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
  const res = await fetch(url, { cache: "no-store" });
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
  set("coreCwd", st.workingDirectory);

  const wk = ah.data && ah.data.worker ? ah.data.worker : {};
  set("wkState", wk.running === true ? "running" : "stopped (or not started)");
  set("wkPid", wk.pid != null ? wk.pid : "—");

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

  set("curSha", up.currentRelease?.resolvedSha || "unknown (no pointer)");
  set("curReleaseId", up.currentRelease?.releaseId);
  set("curMode", up.currentRelease?.mode);
  set("curUpdated", fmtTime(up.currentRelease?.updatedAt));
  set("curDir", up.currentRelease?.releaseDir);
  set("curLinkTarget", up.currentLinkTarget);
  set("curSource", inferSource(st, up));

  const apiHealth = ah.data || {};
  set("apiHealth", `${ah.status} ${apiHealth.ok ? "OK" : "FAIL"}`);
  set("apiOutputDir", apiHealth.output_dir);
  set("apiPublicDir", apiHealth.public_dir);
  set(
    "apiModelsCount",
    Array.isArray(am.data?.models) ? am.data.models.length : "—",
  );

  const coreGood = h.ok && s.ok;
  const workerGood = wk.running === true;
  const gpuGood = classifyState(gpu.status) === "ok";
  const apiGood = ah.ok && ah.data?.ok !== false;
  const updaterBad = classifyState(up.state) === "bad" || !!up.lastFailedJob;

  if (!coreGood || updaterBad || !apiGood) setPill("NOT HEALTHY", "bad");
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

$("refreshBtn").addEventListener("click", refresh);
$("autoChk").addEventListener("change", syncAuto);

refresh();
syncAuto();
