"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

const SNAPSHOT_PATH = "/internal/wake-decision/snapshot";

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function safeSnapshot(value) {
  const input = value && typeof value === "object" ? value : {};
  const shadow = input.shadow && typeof input.shadow === "object" ? input.shadow : {};
  const rollout = input.rollout && typeof input.rollout === "object" ? input.rollout : {};
  const enforced = input.enforced && typeof input.enforced === "object" ? input.enforced : {};
  const count = item => Number.isSafeInteger(item) && item >= 0 ? item : 0;
  const reasons = {};
  for (const [key, item] of Object.entries(enforced.rejectionReasons || {})) {
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) reasons[key] = count(item);
  }
  return {
    mode: new Set(["legacy", "shadow", "enforced"]).has(input.mode) ? input.mode : "legacy",
    rollout: { percent: count(rollout.percent) <= 100 ? count(rollout.percent) : 0 },
    shadow: {
      total: count(shadow.total),
      agreementRate: Number.isFinite(shadow.agreementRate) && shadow.agreementRate >= 0 && shadow.agreementRate <= 1 ? shadow.agreementRate : 0,
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

function createSnapshotHandler({ gate, token } = {}) {
  if (!gate || typeof gate.getDashboardSnapshot !== "function") throw new TypeError("WakeDecisionGate 必填");
  const internalToken = typeof token === "string" ? token.trim() : "";
  return (req, res) => {
    const send = (statusCode, body) => {
      res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (pathname !== SNAPSHOT_PATH) return send(404, { error: { code: "NOT_FOUND" } });
    if (req.method !== "GET") return send(405, { error: { code: "METHOD_NOT_ALLOWED" } });
    if (!internalToken) return send(503, { error: { code: "INTERNAL_TOKEN_MISSING" } });
    if (!safeEqual(req.headers.authorization || "", `Bearer ${internalToken}`)) {
      return send(401, { error: { code: "UNAUTHORIZED" } });
    }
    try {
      return send(200, safeSnapshot(gate.getDashboardSnapshot()));
    } catch {
      return send(500, { error: { code: "SNAPSHOT_UNAVAILABLE" } });
    }
  };
}

function createWakeDecisionSnapshotServer({ gate, token, host = "127.0.0.1", port = 3001, logger = console } = {}) {
  const handler = createSnapshotHandler({ gate, token });
  const server = http.createServer(handler);
  return {
    handler,
    server,
    async start() {
      if (server.listening) return server.address();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => { server.off("error", reject); resolve(); });
      });
      logger.debug?.("Wake decision snapshot server ready", { host, port: server.address().port });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

module.exports = { SNAPSHOT_PATH, createSnapshotHandler, createWakeDecisionSnapshotServer, safeSnapshot };
