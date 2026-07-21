"use strict";

const DIFFERENCE_TYPES = new Set(["same", "old_only", "new_only"]);

function safeReasonCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "";
}

class WakeDecisionMetrics {
  constructor() {
    this.reset();
  }

  record(result) {
    if (!result || typeof result !== "object" || !DIFFERENCE_TYPES.has(result.differenceType)) return false;
    this.total++;
    if (result.differenceType === "same") this.same++;
    else if (result.differenceType === "old_only") this.oldOnly++;
    else this.newOnly++;
    const reasonCode = safeReasonCode(result.newDecision?.reasonCode ?? result.reasonCode);
    if (reasonCode) this.reasonCounts[reasonCode] = (this.reasonCounts[reasonCode] || 0) + 1;
    return true;
  }

  snapshot() {
    return {
      total: this.total,
      same: this.same,
      oldOnly: this.oldOnly,
      newOnly: this.newOnly,
      agreementRate: this.total ? this.same / this.total : 0,
      reasonCounts: { ...this.reasonCounts }
    };
  }

  reset() {
    this.total = 0;
    this.same = 0;
    this.oldOnly = 0;
    this.newOnly = 0;
    this.reasonCounts = Object.create(null);
  }
}

module.exports = { WakeDecisionMetrics };
