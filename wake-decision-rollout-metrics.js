"use strict";

const OUTCOMES = new Set(["not_evaluated", "allowed", "rejected", "unavailable"]);

function safeReasonCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "";
}

class WakeDecisionRolloutMetrics {
  constructor() {
    this.reset();
  }

  record(result) {
    if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.rolloutEnabled !== "boolean") return false;
    const outcome = result.adapterOutcome ?? "not_evaluated";
    if (!OUTCOMES.has(outcome)) return false;
    this.totalEvaluated++;
    if (result.rolloutEnabled) this.rolloutEnabled++;
    if (outcome === "allowed") this.adapterAllowed++;
    else if (outcome === "rejected") this.adapterRejected++;
    else if (outcome === "unavailable") this.adapterUnavailable++;
    if (result.legacyContinued === true) this.legacyContinued++;
    if (result.decisionBlocked === true) this.decisionBlocked++;
    const reasonCode = safeReasonCode(result.reasonCode);
    if (reasonCode) this.rejectionReasons[reasonCode] = (this.rejectionReasons[reasonCode] || 0) + 1;
    return true;
  }

  snapshot() {
    return {
      totalEvaluated: this.totalEvaluated,
      rolloutEnabled: this.rolloutEnabled,
      adapterAllowed: this.adapterAllowed,
      adapterRejected: this.adapterRejected,
      adapterUnavailable: this.adapterUnavailable,
      legacyContinued: this.legacyContinued,
      decisionBlocked: this.decisionBlocked,
      rejectionReasons: { ...this.rejectionReasons }
    };
  }

  reset() {
    this.totalEvaluated = 0;
    this.rolloutEnabled = 0;
    this.adapterAllowed = 0;
    this.adapterRejected = 0;
    this.adapterUnavailable = 0;
    this.legacyContinued = 0;
    this.decisionBlocked = 0;
    this.rejectionReasons = Object.create(null);
  }
}

module.exports = { WakeDecisionRolloutMetrics };
