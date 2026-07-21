"use strict";

const crypto = require("node:crypto");

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicSnapshot(value) {
  const snapshot = value && typeof value === "object" ? value : {};
  const rollout = snapshot.rollout && typeof snapshot.rollout === "object" ? snapshot.rollout : {};
  const shadow = snapshot.shadow && typeof snapshot.shadow === "object" ? snapshot.shadow : {};
  const enforced = snapshot.enforced && typeof snapshot.enforced === "object" ? snapshot.enforced : {};
  const count = item => Number.isSafeInteger(item) && item >= 0 ? item : 0;
  const rate = Number.isFinite(shadow.agreementRate) && shadow.agreementRate >= 0 && shadow.agreementRate <= 1
    ? shadow.agreementRate : 0;
  const reasons = {};
  if (enforced.rejectionReasons && typeof enforced.rejectionReasons === "object" && !Array.isArray(enforced.rejectionReasons)) {
    for (const [key, item] of Object.entries(enforced.rejectionReasons)) {
      if (/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) reasons[key] = count(item);
    }
  }
  const mode = new Set(["legacy", "shadow", "enforced"]).has(snapshot.mode) ? snapshot.mode : "legacy";
  const percent = count(rollout.percent) <= 100 ? count(rollout.percent) : 0;
  return {
    mode,
    rollout: { percent, enabled: rollout.enabled === true || (mode === "enforced" && percent > 0) },
    shadow: {
      total: count(shadow.total),
      agreementRate: rate,
      eligible: shadow.eligible === true,
      reasonCodes: Array.isArray(shadow.reasonCodes)
        ? shadow.reasonCodes.filter(item => typeof item === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(item)) : []
    },
    enforced: {
      totalEvaluated: count(enforced.totalEvaluated),
      rolloutEnabled: count(enforced.rolloutEnabled),
      adapterAllowed: count(enforced.adapterAllowed),
      adapterRejected: count(enforced.adapterRejected),
      adapterUnavailable: count(enforced.adapterUnavailable),
      legacyContinued: count(enforced.legacyContinued),
      decisionBlocked: count(enforced.decisionBlocked),
      rejectionReasons: reasons
    }
  };
}

function registerWakeDecisionRoutes(app, options = {}) {
  const gate = options.gate;
  const snapshotClient = options.snapshotClient || null;
  const apiKey = options.apiKey || process.env.GATEWAY_API_KEY;
  if (!gate || typeof gate.getDashboardSnapshot !== "function") throw new TypeError("WakeDecisionGate 必填");

  function bearerAuth(req, reply, done) {
    const auth = req.headers.authorization || "";
    if (!apiKey) return reply.code(503).send({ error: { code: "GATEWAY_KEY_MISSING", message: "GATEWAY_API_KEY 未配置" } });
    if (!safeEqual(auth, `Bearer ${apiKey}`)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer")
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid gateway API key" } });
    }
    done();
  }

  app.get("/api/v1/wake-decision/dashboard", { preHandler: bearerAuth }, async (req, reply) => {
    if (Object.keys(req.query || {}).length) {
      return reply.code(400).send({ error: { code: "WAKE_DECISION_QUERY_INVALID", message: "该接口不接受查询参数" } });
    }
    try {
      const remote = snapshotClient && typeof snapshotClient.fetchSnapshot === "function"
        ? await snapshotClient.fetchSnapshot() : null;
      return publicSnapshot(remote || gate.getDashboardSnapshot());
    } catch (error) {
      req.log.error({ errorName: error.name }, "wake decision dashboard failed");
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Wake Decision Dashboard 暂时不可用" } });
    }
  });

  return { bearerAuth };
}

module.exports = { publicSnapshot, registerWakeDecisionRoutes };
