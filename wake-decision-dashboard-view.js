"use strict";

const MODES = new Set(["legacy", "shadow", "enforced"]);

function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function rate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 0;
}

function reasonCodes(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(item))
    : [];
}

function reasonCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) output[key] = count(item);
  }
  return output;
}

class WakeDecisionDashboardView {
  constructor({ gate, rollout = null } = {}) {
    if (!gate || typeof gate.getEvaluation !== "function" || typeof gate.getRolloutMetrics !== "function") {
      throw new TypeError("WakeDecisionGate 只读接口必填");
    }
    this.gate = gate;
    this.rollout = rollout;
  }

  getSnapshot() {
    const mode = MODES.has(this.gate.mode) ? this.gate.mode : "legacy";
    const percent = count(this.rollout?.percent);
    const evaluation = this.gate.getEvaluation() || {};
    const summary = evaluation.summary && typeof evaluation.summary === "object" ? evaluation.summary : {};
    const enforced = this.gate.getRolloutMetrics() || {};
    return {
      mode,
      rollout: { percent: percent <= 100 ? percent : 0, enabled: mode === "enforced" && percent > 0 },
      shadow: {
        total: count(summary.total),
        agreementRate: rate(summary.agreementRate),
        eligible: evaluation.eligible === true,
        reasonCodes: reasonCodes(evaluation.reasonCodes)
      },
      enforced: {
        totalEvaluated: count(enforced.totalEvaluated),
        rolloutEnabled: count(enforced.rolloutEnabled),
        adapterAllowed: count(enforced.adapterAllowed),
        adapterRejected: count(enforced.adapterRejected),
        adapterUnavailable: count(enforced.adapterUnavailable),
        legacyContinued: count(enforced.legacyContinued),
        decisionBlocked: count(enforced.decisionBlocked),
        rejectionReasons: reasonCounts(enforced.rejectionReasons)
      }
    };
  }
}

module.exports = { WakeDecisionDashboardView };
