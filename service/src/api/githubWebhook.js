"use strict";

const crypto = require("crypto");

const MAX_BODY_SIZE_BYTES = 1024 * 1024;

function createGitHubWebhookHandler({ config, log, updateQueue }) {
  return async function githubWebhookHandler(req, res) {
    if (!config.githubWebhookSecret) {
      log.error("webhook.github.misconfigured", {
        reason: "missing GITHUB_WEBHOOK_SECRET",
      });
      return sendJson(res, 503, {
        error: "Webhook not configured",
      });
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req, MAX_BODY_SIZE_BYTES);
    } catch (err) {
      log.warn("webhook.github.body.invalid", { error: err.message });
      return sendJson(res, 400, { error: err.message });
    }

    const signature = req.headers["x-hub-signature-256"];
    if (
      !signature ||
      !isValidSignature(signature, rawBody, config.githubWebhookSecret)
    ) {
      log.warn("webhook.github.signature.invalid", {
        deliveryId: getHeader(req, "x-github-delivery"),
      });
      return sendJson(res, 401, { error: "Invalid signature" });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch (_) {
      return sendJson(res, 400, { error: "Invalid JSON payload" });
    }

    const eventType = getHeader(req, "x-github-event") || "unknown";
    const deliveryId =
      getHeader(req, "x-github-delivery") || `delivery-${Date.now()}`;
    const repo = body?.repository?.full_name || "";
    const ref = body?.ref || "";
    const sha = body?.after || body?.head_commit?.id || "";

    if (!isAllowedRepo(repo, config.githubWebhookRepo)) {
      log.warn("webhook.github.repo.rejected", {
        deliveryId,
        eventType,
        repo,
        allowedRepo: config.githubWebhookRepo,
      });
      return sendJson(res, 403, { error: "Repository not allowed" });
    }

    if (eventType === "ping") {
      log.info("webhook.github.ping.accepted", {
        deliveryId,
        repo,
      });
      return sendJson(res, 202, { accepted: true, event: "ping" });
    }

    if (eventType !== "push") {
      log.info("webhook.github.ignored", {
        deliveryId,
        eventType,
        repo,
      });
      return sendJson(res, 202, {
        accepted: false,
        reason: "event_not_supported",
      });
    }

    if (!isAllowedBranch(ref, config.githubWebhookBranch)) {
      log.warn("webhook.github.branch.rejected", {
        deliveryId,
        repo,
        ref,
        allowedBranch: config.githubWebhookBranch,
      });
      return sendJson(res, 403, { error: "Branch not allowed" });
    }

    const event = {
      id: deliveryId,
      type: eventType,
      repo,
      ref,
      sha,
      receivedAt: new Date().toISOString(),
      // Store the full webhook payload so we can inspect commit details later.
      payload: body,
      headCommit: body?.head_commit || null,
    };

    updateQueue.recordWebhookEvent(event);
    const job = updateQueue.enqueueFromWebhook(event);

    log.info("webhook.github.accepted", {
      deliveryId,
      repo,
      ref,
      sha,
      jobId: job.id,
    });

    return sendJson(res, 202, {
      accepted: true,
      deliveryId,
      queued: true,
      jobId: job.id,
    });
  };
}

function isAllowedRepo(receivedRepo, configuredRepo) {
  if (!configuredRepo) {
    return true;
  }
  return (
    String(receivedRepo).toLowerCase() === String(configuredRepo).toLowerCase()
  );
}

function isAllowedBranch(receivedRef, configuredBranch) {
  const expectedRef = normalizeBranchToRef(configuredBranch);
  return receivedRef === expectedRef;
}

function normalizeBranchToRef(branchOrRef) {
  if (!branchOrRef) {
    return "refs/heads/main";
  }
  if (branchOrRef.startsWith("refs/")) {
    return branchOrRef;
  }
  return `refs/heads/${branchOrRef}`;
}

function isValidSignature(signatureHeader, rawBody, secret) {
  if (typeof signatureHeader !== "string") {
    return false;
  }
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const providedBuffer = Buffer.from(signatureHeader, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function getHeader(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readRawBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

module.exports = {
  createGitHubWebhookHandler,
};
