"use strict";

const fs = require("fs");
const path = require("path");

const { runGenerator } = require("../../../server/generator");
const { getModels, resolveModel } = require("../../../server/models");

const PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "public");
const OUTPUT_DIR = path.join(__dirname, "..", "..", "..", "outputs");
const MAX_JSON_BODY_BYTES = 1_000_000;

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function createProviderApiHandler({ log }) {
  return async function providerApiHandler(req, res) {
    const reqPath = (req.url || "").split("?")[0];
    const method = req.method || "GET";

    if (method === "GET" && reqPath === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        models: getModels().length,
        output_dir: OUTPUT_DIR,
      });
      return true;
    }

    if (method === "GET" && reqPath === "/api/models") {
      const models = getModels().map(({ name, file, family, defaults }) => ({
        name,
        file,
        family,
        defaults,
      }));
      sendJson(res, 200, { ok: true, models });
      return true;
    }

    if (method === "POST" && reqPath === "/api/generate") {
      try {
        const body = await readJson(req, MAX_JSON_BODY_BYTES);
        const prompt = sanitizePromptText(body.prompt);
        if (!prompt) {
          sendJson(res, 400, {
            error: "Missing required field: prompt",
          });
          return true;
        }

        const modelName = String(body.model || "").trim();
        if (!modelName) {
          sendJson(res, 400, {
            error: "Missing required field: model",
          });
          return true;
        }

        const entry = resolveModel(modelName);
        if (!entry) {
          sendJson(res, 400, {
            error: `Unknown model: \"${modelName}\". Check GET /api/models.`,
          });
          return true;
        }

        const payload = {
          ...body,
          prompt,
          prompt_2: sanitizePromptText(body.prompt_2 || ""),
          negative_prompt: sanitizePromptText(body.negative_prompt || ""),
          model: entry.fullPath,
          family: entry.family,
        };

        const result = await runGenerator(payload, OUTPUT_DIR);
        if (!result?.ok || !result.file_name) {
          log.warn("api.generate.failed", {
            reason: result?.error || "unknown",
            model: entry.name,
            family: entry.family,
          });
          sendJson(res, 500, {
            error: result?.error || "Generator did not return an image.",
          });
          return true;
        }

        sendJson(res, 200, {
          ok: true,
          file_name: result.file_name,
          image_url: `/outputs/${result.file_name}`,
          seed: result.seed,
          family: result.family,
          model: result.model,
          elapsed_ms: result.elapsed_ms,
        });
        return true;
      } catch (err) {
        log.error("api.generate.error", {
          error: err.message,
        });
        sendJson(res, 500, {
          error: err.message || "Generation failed.",
        });
        return true;
      }
    }

    if (method === "GET" && reqPath.startsWith("/outputs/")) {
      const filePath = path.join(OUTPUT_DIR, path.basename(reqPath));
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, {
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(data);
      });
      return true;
    }

    if (method === "GET" && (reqPath === "/" || reqPath.startsWith("/app"))) {
      const rel = reqPath === "/" ? "app.html" : reqPath.slice(1);
      const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
      if (
        !filePath.startsWith(PUBLIC_DIR + path.sep) &&
        filePath !== PUBLIC_DIR
      ) {
        sendJson(res, 403, { error: "Forbidden" });
        return true;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          sendJson(res, err.code === "ENOENT" ? 404 : 500, {
            error: err.code === "ENOENT" ? "Not found" : "Server error",
          });
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".css"
              ? "text/css; charset=utf-8"
              : ext === ".js"
                ? "text/javascript; charset=utf-8"
                : "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
      });
      return true;
    }

    return false;
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("Request too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function sanitizePromptText(value) {
  if (value == null) {
    return "";
  }

  let out = String(value).normalize("NFKC");

  const map = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201A": "'",
    "\u201B": "'",
    "\u2032": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u201E": '"',
    "\u201F": '"',
    "\u2033": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\u2026": "...",
    "\u00A0": " ",
  };

  out = out.replace(
    /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033\u2013\u2014\u2212\u2026\u00A0]/g,
    (ch) => map[ch] || ch,
  );

  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return out.trim();
}

module.exports = {
  createProviderApiHandler,
};
