#!/usr/bin/env node
/**
 * lan-file-server.js
 * Two hard-coded shares. Mobile-first UI. Range streaming. No deps.
 * Updated: always fresh directory listings (handles bfcache + no-store).
 */

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const url = require("url");

// ---- configure your two shares here ----
const SHARES = [
  {
    name: "Thumb",
    base: "/thumb/",
    fsRoot: "E:\\",
  },
  // {
  //   name: "Output",
  //   base: "/output/",
  //   fsRoot: "C:\\ComfyUI_windows_portable\\ComfyUI\\output",
  // },
  {
    name: "Output (new)",
    base: "/outputNew/",
    fsRoot: "C:\\ComfyUI_windows_portable_2\\ComfyUI\\output",
  },
  // { name: "Shared", base: "/shared/", fsRoot: "C:\\shared" },
];
// Optional: use POSIX paths on macOS/Linux like '/Users/you/Media'

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PORT = Number(args.port || process.env.PORT || 8080);
const READ_ONLY = args.readOnly !== "false";

// ---- utils ----
const escHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
const VIDEO_EXT = new Set([".mp4", ".m4v", ".webm", ".ogv", ".mov"]);
const isVideo = (p) => VIDEO_EXT.has(path.extname(p).toLowerCase());
const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
]);
const isImage = (p) => IMAGE_EXT.has(path.extname(p).toLowerCase());
const isMedia = (p) => isVideo(p) || isImage(p);

const encURL = (s) => encodeURIComponent(s).replace(/%2F/g, "/");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".7z": "application/x-7z-compressed",
};
const mimeOf = (p) =>
  MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
const niceSize = (b) =>
  b === 0
    ? "0"
    : ["B", "KB", "MB", "GB", "TB", "PB"]
        .map((u, i) => ({ u, i }))
        .reduce((a, x) => a, 0) ||
      (() => {
        const i = Math.floor(Math.log(b) / Math.log(1024));
        return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${
          ["B", "KB", "MB", "GB", "TB", "PB"][i]
        }`;
      })();
function etag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(
    16
  )}"`;
}
function addTrailingSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}
function ifaceURLs(port) {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets))
    for (const ni of nets[name] || [])
      if (ni.family === "IPv4" && !ni.internal)
        out.push(`http://${ni.address}:${port}`);
  return out;
}
function normBase(b) {
  let x = b || "/";
  if (!x.startsWith("/")) x = "/" + x;
  if (!x.endsWith("/")) x = x + "/";
  return x;
}
for (const s of SHARES) {
  s.base = normBase(s.base);
  s.fsRoot = path.resolve(s.fsRoot);
}

// ---- HTML shell ----
function htmlPage({ title, body, extraHead = "" }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escHtml(title)}</title>
<style>
:root{--bg:#0b0b0c;--fg:#e7e7ea;--mut:#9aa0a6;--card:#141417;--accent:#4c8bf5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial}
a{color:var(--accent);text-decoration:none}a:hover,a:focus{text-decoration:underline}
header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,var(--bg),rgba(11,11,12,.9));backdrop-filter:saturate(1.2) blur(8px);padding:12px;border-bottom:1px solid #1f2023}
h1{margin:0 0 6px;font-size:16px}
main{padding:10px}
.card{background:var(--card);border:1px solid #202226;border-radius:16px;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.toolbar{display:flex;gap:8px;align-items:center}
input[type=search]{flex:1;min-width:120px;border:1px solid #2a2c31;border-radius:12px;background:#101114;color:var(--fg);padding:10px 12px}
.btn{display:inline-flex;gap:8px;align-items:center;border:1px solid #2a2c31;border-radius:12px;background:#101114;color:var(--fg);padding:10px 12px}
.grid{display:grid;grid-template-columns:1fr auto auto;gap:0;border-top:1px solid #202226}
.row{display:contents}.cell{padding:12px;border-bottom:1px solid #202226}.cell.name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
@media (max-width:600px){.grid{grid-template-columns:1fr auto}.col-size{display:none}.toolbar{flex-wrap:wrap}}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#1a1b1f;border:1px solid #2a2c31;color:#9aa0a6;font-size:12px}
.bc{padding:4px 8px;border-radius:999px;background:#101114;border:1px solid #2a2c31;margin-right:6px}
.addr{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
small{color:#9aa0a6}
</style>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';">
${extraHead}</head><body>
<header>
    <h1>${escHtml(title)}</h1>
    <div class="toolbar">
        <input id="q" type="search" placeholder="Filter files or shares" aria-label="Filter">
        <button class="btn" id="clear">Clear</button>
    </div>
</header>
<main>${body}</main>
<script>
(function(){
  // live filtering
  const q=document.getElementById('q'), clear=document.getElementById('clear');
  function apply(){
    const s=(q.value||'').trim().toLowerCase();
    for(const r of document.querySelectorAll('[data-row]')){
      r.style.display = s && !r.getAttribute('data-name').includes(s) ? 'none' : '';
    }
  }
  q.addEventListener('input',apply);
  clear.addEventListener('click',()=>{q.value='';apply();q.focus();});

  // ensure freshness when navigating back from bfcache
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const t = Number(sessionStorage.getItem('lastHide')||0);
      if (Date.now() - t > 10000) location.reload();
    } else {
      sessionStorage.setItem('lastHide', String(Date.now()));
    }
  });
})();
</script>
</body></html>`;
}

// ---- UI parts ----
function shareIndexHTML() {
  const shareCards = SHARES.map(
    (s) => `
        <div class="row" data-row data-name="${escHtml(
          (s.name + " " + s.base).toLowerCase()
        )}">
            <div class="cell name" >📁 <a href="${encURL(s.base)}">${escHtml(
      s.name
    )}</a> <small class="badge"  style="display:none;">${escHtml(
      s.base
    )}</small></div>
            <div class="cell col-size"><small>—</small></div>
            <div class="cell"><small>${escHtml(s.fsRoot)}</small></div>
        </div>`
  ).join("");
  return htmlPage({
    title: "Shares",
    body: `
        <section class="card" style="overflow:hidden">
            <div style="padding:12px;border-bottom:1px solid #202226"><small>Pick a share</small></div>
            <div class="grid">
                <div class="cell"><small>Name</small></div>
                <div class="cell col-size"><small>Size</small></div>
                <div class="cell"><small>Location</small></div>
                ${shareCards}
            </div>
        </section>`,
  });
}
function breadcrumbsHTML(share, relURLPath) {
  const parts = relURLPath.replace(/\/+$/, "").split("/").filter(Boolean);
  let acc = share.base.replace(/\/+$/, "");
  const segs = [
    `<span class="bc"><a href="/">/</a></span>`,
    `<span class="bc"><a href="${encURL(share.base)}">${escHtml(
      share.name
    )}</a></span>`,
  ];
  for (const p of parts) {
    acc += "/" + p;
    segs.push(
      `<span class="bc"><a href="${encURL(addTrailingSlash(acc))}">${escHtml(
        p
      )}</a></span>`
    );
  }
  return segs.join("");
}
async function dirHTML(share, absDir, relURLPath, query) {
  const showHidden = query.hidden === "1";
  const entries = await fsp.readdir(absDir, { withFileTypes: true });
  const list = await Promise.all(
    entries
      .filter((d) => showHidden || !d.name.startsWith("."))
      .map(async (d) => {
        const p = path.join(absDir, d.name);
        const s = await fsp.stat(p).catch(() => null);
        return s
          ? {
              name: d.name,
              isDir: d.isDirectory(),
              size: s.size,
              mtime: s.mtime,
            }
          : null;
      })
  );
  list.sort((a, b) => {
    if (!a || !b) return 0;
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  const rows = list
    .filter(Boolean)
    .map((x) => {
      const rel = relURLPath.replace(/^\/+/, "");
      const filePath = `${share.base}${rel ? rel + "/" : ""}${x.name}`;
      const href = encURL(x.isDir ? filePath + "/" : filePath);
      // Use /view for both images and videos
      const nameLink = x.isDir
        ? `<a href="${href}">${escHtml(x.name)}</a>`
        : isMedia(x.name)
        ? `<a href="/view?p=${encURL(filePath)}">${escHtml(x.name)}</a>`
        : `<a href="${href}">${escHtml(x.name)}</a>`;
      return `<div class="row" data-row data-name="${escHtml(
        x.name.toLowerCase()
      )}">
        <div class="cell name">${x.isDir ? "📁" : "📄"} ${nameLink} ${
        x.isDir
          ? ""
          : `<small class="badge" style="display:none;"><a href="${href}?download=1">download</a></small>`
      }</div>
        <div class="cell col-size">${
          x.isDir ? "<small>—</small>" : niceSize(x.size)
        }</div>
        <div class="cell"><small>${escHtml(
          x.mtime.toLocaleString()
        )}</small></div>
        </div>`;
    })
    .join("");

  return htmlPage({
    title: share.name + " " + (relURLPath || "/"),
    body: `
        <section class="card" style="overflow:hidden">
            <div style="padding:12px;border-bottom:1px solid #202226">
                <nav>${breadcrumbsHTML(share, relURLPath)}</nav>
                <div><small>${escHtml(absDir)}</small></div>
            </div>
            <div class="grid">
                <div class="cell"><small>Name</small></div>
                <div class="cell col-size"><small>Size</small></div>
                <div class="cell"><small>Modified</small></div>
                ${rows}
            </div>
        </section>`,
  });
}

// ---- routing ----
function matchShare(reqPath) {
  for (const s of SHARES) {
    if (reqPath === s.base || reqPath.startsWith(s.base)) return s;
  }
  return null;
}
function withinShare(share, abs) {
  const rel = path.relative(share.fsRoot, abs);
  return (
    abs === share.fsRoot ||
    (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
  );
}

// ---- http handler ----
async function handler(req, res) {
  try {
    const u = url.parse(req.url, true);
    let reqPath = decodeURIComponent(u.pathname || "/");
    if (!reqPath.startsWith("/")) reqPath = "/";

    // Unified media viewer: /view?p=/share/rel/path/file
    if (u.pathname === "/view") {
      const p = (u.query && u.query.p ? String(u.query.p) : "").replaceAll(
        "//",
        "/"
      );
      if (!p.startsWith("/")) return sendError(res, 400, "Bad Request");

      const sh = matchShare(p);
      if (!sh) return sendError(res, 404, "Not Found");

      const relURLPath = p.slice(sh.base.length);
      const abs = path.resolve(sh.fsRoot, relURLPath);
      if (!withinShare(sh, abs)) return sendError(res, 403, "Forbidden");

      const st = await fsp.stat(abs).catch(() => null);
      if (!st || st.isDirectory() || !isMedia(abs))
        return sendError(res, 404, "Not Found");

      // Get directory listing for navigation
      const dir = path.dirname(abs);
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const files = entries
        .filter((d) => !d.isDirectory() && isMedia(d.name))
        .map((d) => d.name);
      const idx = files.indexOf(path.basename(abs));
      const prev = idx > 0 ? files[idx - 1] : null;
      const next = idx < files.length - 1 ? files[idx + 1] : null;
      const basePath =
        sh.base + path.relative(sh.fsRoot, dir).replace(/\\/g, "/");
      const prevURL = prev ? `/view?p=${encURL(basePath + "/" + prev)}` : null;
      const nextURL = next ? `/view?p=${encURL(basePath + "/" + next)}` : null;

      const title = path.basename(abs);
      let mediaHtml = "";
      if (isVideo(abs)) {
        mediaHtml = `<video id="media" src="${encURL(
          p
        )}" controls loop autoplay muted playsinline preload="metadata"
          style="width:100%;max-height:80vh;background:#000;display:block;object-fit:contain"></video>`;
      } else {
        mediaHtml = `<img id="media" src="${encURL(p)}" alt="${escHtml(title)}"
          style="width:100%;max-height:80vh;background:#000;display:block;object-fit:contain" />`;
      }

      const html = htmlPage({
        title: title,
        body: `
          <section class="card" style="padding:12px">
            <div style="margin-bottom:8px"><strong>${escHtml(
              title
            )}</strong></div>
            ${mediaHtml}
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              ${
                prevURL
                  ? `<a class="btn" href="${prevURL}">&larr; Prev</a>`
                  : ""
              }
              ${
                nextURL
                  ? `<a class="btn" href="${nextURL}">Next &rarr;</a>`
                  : ""
              }
              <a class="btn" href="${encURL(p)}">Open raw</a>
              <a class="btn" href="${encURL(p)}?download=1">Download</a>
              <button class="btn" id="fit">Fill</button>
            </div>
            <script>
            (function(){
              const m=document.getElementById('media');
              const f=document.getElementById('fit');
              f.addEventListener('click', ()=>{ m.style.objectFit=m.style.objectFit==='contain'?'cover':'contain'; });
            })();
            </script>
          </section>`,
      });
      return sendHTML(res, 200, html);
    }

    // root or share
    const share = matchShare(reqPath);
    if (!share) {
      if (reqPath === "/") {
        const html = shareIndexHTML();
        return sendHTML(res, 200, html);
      }
      return sendError(res, 404, "Not Found");
    }

    // compute share-relative URL path like '/sub/dir/'
    let relURLPath = reqPath.slice(share.base.length);
    if (!relURLPath.startsWith("/")) relURLPath = "/" + relURLPath;
    const abs = path.resolve(share.fsRoot, "." + relURLPath);

    if (!withinShare(share, abs)) return sendError(res, 403, "Forbidden");

    const st = await fsp.stat(abs).catch(() => null);
    if (!st) return sendError(res, 404, "Not Found");

    if (st.isDirectory()) {
      if (!reqPath.endsWith("/")) {
        res.writeHead(301, { Location: addTrailingSlash(reqPath) });
        return res.end();
      }
      const html = await dirHTML(share, abs, relURLPath, u.query || {});
      return sendHTML(res, 200, html);
    }

    // file
    const type = mimeOf(abs);
    const tag = etag(st);
    const last = st.mtime.toUTCString();

    // conditional
    if (
      req.headers["if-none-match"] === tag ||
      (req.headers["if-modified-since"] &&
        new Date(req.headers["if-modified-since"]).getTime() >=
          st.mtime.getTime())
    ) {
      res.writeHead(304, {
        ETag: tag,
        "Last-Modified": last,
        "Cache-Control": "public, max-age=86400",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end();
    }

    const isDownload =
      u.query && (u.query.download === "1" || u.query.download === "true");

    // range
    let start = 0,
      end = st.size ? st.size - 1 : 0,
      status = 200;
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1] !== "") start = parseInt(m[1], 10);
        if (m[2] !== "") end = parseInt(m[2], 10);
        if (isNaN(start) || isNaN(end) || start > end || end >= st.size) {
          res.writeHead(416, {
            "Content-Range": `bytes */${st.size}`,
            "X-Content-Type-Options": "nosniff",
          });
          return res.end();
        }
        status = 206;
      }
    }

    const headers = {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ETag: tag,
      "Last-Modified": last,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';",
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    if (isDownload)
      headers[
        "Content-Disposition"
      ] = `attachment; filename*=UTF-8''${encodeURIComponent(
        path.basename(abs)
      )}`;

    res.writeHead(status, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(abs, { start, end })
      .on("error", () => {
        try {
          res.destroy();
        } catch (_) {}
      })
      .pipe(res);
  } catch (e) {
    sendError(res, 500, "Internal Server Error");
  }
}

function sendHTML(res, code, html) {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "X-Content-Type-Options": "nosniff",
    // Strong anti-cache to avoid stale directory listings and defeat bfcache heuristics
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(html);
}
function sendError(res, code, message) {
  const body = htmlPage({
    title: `${code} ${message}`,
    body: `<section class="card" style="padding:16px"><h2>${code} ${escHtml(
      message
    )}</h2><p><small>Request could not be completed.</small></p></section>`,
  });
  sendHTML(res, code, body);
}

// ---- start ----
const server = http.createServer(handler);
server.listen(PORT, "0.0.0.0", () => {
  const addrs = ifaceURLs(PORT);
  console.log("Shares:");
  for (const s of SHARES) {
    console.log(`- ${s.name}: ${s.fsRoot} at ${s.base}`);
  }
  console.log("Listening on:");
  console.log(`  http://localhost:${PORT}/`);
  for (const a of addrs) console.log(`  ${a}/`);
  console.log("Open the root URL then choose a share.");
});
process.on("SIGINT", () => {
  console.log("\nShutting down.");
  server.close(() => process.exit(0));
});
