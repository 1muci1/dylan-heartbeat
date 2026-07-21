"use strict";

const MODES = new Set(["legacy", "shadow", "enforced"]);

function normalizeMode(value) {
  const mode = String(value || "legacy").trim().toLowerCase();
  return MODES.has(mode) ? mode : "legacy";
}

function safeReasonCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "";
}

function publicCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  return {
    type: typeof candidate.type === "string" ? candidate.type : "",
    eventId: typeof candidate.eventId === "string" ? candidate.eventId : "",
    topicKey: typeof candidate.topicKey === "string" ? candidate.topicKey : "",
    priority: Number.isInteger(candidate.priority) ? candidate.priority : null,
    expiresAt: typeof candidate.expiresAt === "string" ? candidate.expiresAt : "",
    reasonCode: safeReasonCode(candidate.reasonCode)
  };
}

class WakeDecisionGate {
  constructor({ mode = "legacy", adapter = null, logger = null, debug = false, metrics = null, evaluator = null, evaluationDebug = false, rollout = null, rolloutDebug = false, rolloutMetrics = null, rolloutMetricsDebug = false, dashboardDebug = false } = {}) {
    this.mode = normalizeMode(mode);
    this.adapter = adapter;
    this.logger = logger;
    this.debug = debug === true;
    this.metrics = metrics;
    this.evaluator = evaluator;
    this.evaluationDebug = evaluationDebug === true;
    this.rollout = rollout;
    this.rolloutDebug = rolloutDebug === true;
    this.rolloutMetrics = rolloutMetrics;
    this.rolloutMetricsDebug = rolloutMetricsDebug === true;
    this.dashboardDebug = dashboardDebug === true;
  }

  getDashboardSnapshot() {
    const { WakeDecisionDashboardView } = require("./wake-decision-dashboard-view");
    const snapshot = new WakeDecisionDashboardView({ gate: this, rollout: this.rollout }).getSnapshot();
    if (this.dashboardDebug) {
      this.logger?.debug?.("Wake decision dashboard", {
        mode: snapshot.mode,
        shadowEligible: snapshot.shadow.eligible,
        agreementRate: snapshot.shadow.agreementRate,
        rolloutPercent: snapshot.rollout.percent,
        enforcedTotal: snapshot.enforced.totalEvaluated
      });
    }
    return snapshot;
  }

  getRolloutMetrics() {
    if (!this.rolloutMetrics) {
      const { WakeDecisionRolloutMetrics } = require("./wake-decision-rollout-metrics");
      this.rolloutMetrics = new WakeDecisionRolloutMetrics();
    }
    return this.rolloutMetrics.snapshot();
  }

  recordRollout(result) {
    try {
      if (!this.rolloutMetrics) {
        const { WakeDecisionRolloutMetrics } = require("./wake-decision-rollout-metrics");
        this.rolloutMetrics = new WakeDecisionRolloutMetrics();
      }
      this.rolloutMetrics.record(result);
      if (this.rolloutMetricsDebug) {
        const snapshot = this.rolloutMetrics.snapshot();
        this.logger?.debug?.("Wake decision rollout metrics", {
          totalEvaluated: snapshot.totalEvaluated,
          rolloutEnabled: snapshot.rolloutEnabled,
          adapterRejected: snapshot.adapterRejected,
          adapterUnavailable: snapshot.adapterUnavailable
        });
      }
    } catch {
      this.logger?.debug?.("Wake decision rollout metrics unavailable", {
        totalEvaluated: 0,
        rolloutEnabled: 0,
        adapterRejected: 0,
        adapterUnavailable: 0
      });
    }
  }

  shouldUseEnforced(context = {}) {
    let result;
    if (this.mode !== "enforced") {
      result = { enabled: false, bucket: 0, percent: 0 };
    } else {
      const { WakeDecisionRollout } = require("./wake-decision-rollout");
      const rollout = this.rollout || new WakeDecisionRollout();
      result = rollout.shouldEnforce(structuredClone(context));
    }
    if (this.rolloutDebug) {
      this.logger?.debug?.("Wake decision rollout", {
        mode: this.mode,
        enabled: result.enabled === true,
        bucket: Number(result.bucket) || 0,
        percent: Number(result.percent) || 0
      });
    }
    return result;
  }

  getEvaluation() {
    const { WakeDecisionEvaluator } = require("./wake-decision-evaluator");
    const evaluator = this.evaluator || new WakeDecisionEvaluator();
    const snapshot = this.metrics && typeof this.metrics.snapshot === "function" ? this.metrics.snapshot() : {};
    const result = evaluator.evaluate(snapshot);
    if (this.evaluationDebug) {
      this.logger?.debug?.("Wake decision evaluation", {
        eligible: result.eligible,
        reasonCodes: [...result.reasonCodes],
        agreementRate: result.summary.agreementRate,
        total: result.summary.total
      });
    }
    return result;
  }

  log(result) {
    if (!this.debug) return;
    this.logger?.debug?.("Wake decision mode", {
      mode: result.mode,
      shouldContact: result.shouldContact,
      reasonCode: safeReasonCode(result.reasonCode || result.shadowDecision?.reasonCode)
    });
  }

  decide(context = {}) {
    if (this.mode === "legacy") {
      const result = { mode: "legacy", shouldContact: null, source: "legacy" };
      this.log(result);
      return result;
    }
    const rollout = this.shouldUseEnforced(context);
    if (this.mode === "enforced" && !rollout.enabled) {
      this.recordRollout({ rolloutEnabled: false, adapterOutcome: "not_evaluated", legacyContinued: true, decisionBlocked: false });
      const result = { mode: "enforced", shouldContact: null, source: "rollout" };
      this.log(result);
      return result;
    }
    try {
      if (!this.adapter || typeof this.adapter.evaluate !== "function") throw new TypeError("Decision Adapter 不可用");
      const decision = this.adapter.evaluate(structuredClone(context));
      const shouldContact = decision?.shouldContact === true;
      const reasonCode = safeReasonCode(decision?.reasonCode);
      if (this.mode === "shadow") {
        const result = {
          mode: "shadow",
          shouldContact: null,
          shadowDecision: { shouldContact, reasonCode }
        };
        this.log(result);
        return result;
      }
      const result = shouldContact
        ? { mode: "enforced", shouldContact: true, candidate: publicCandidate(decision.candidate) }
        : { mode: "enforced", shouldContact: false, reasonCode: "DECISION_REJECTED" };
      this.recordRollout(shouldContact
        ? { rolloutEnabled: true, adapterOutcome: "allowed", legacyContinued: true, decisionBlocked: false }
        : { rolloutEnabled: true, adapterOutcome: "rejected", legacyContinued: false, decisionBlocked: true, reasonCode: "DECISION_REJECTED" });
      this.log(result);
      return result;
    } catch {
      const result = this.mode === "enforced"
        ? { mode: "enforced", shouldContact: false, reasonCode: "DECISION_UNAVAILABLE" }
        : { mode: "shadow", shouldContact: null, shadowDecision: null, reasonCode: "DECISION_UNAVAILABLE" };
      if (this.mode === "enforced") {
        this.recordRollout({
          rolloutEnabled: true,
          adapterOutcome: "unavailable",
          legacyContinued: false,
          decisionBlocked: true,
          reasonCode: "DECISION_UNAVAILABLE"
        });
      }
      this.log(result);
      return result;
    }
  }
}

module.exports = { WakeDecisionGate, normalizeMode };
