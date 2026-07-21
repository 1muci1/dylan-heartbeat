"use strict";

function clone(value) {
  return structuredClone(value);
}

class WakeDecisionAdapter {
  constructor({ decisionService } = {}) {
    if (!decisionService || typeof decisionService.evaluate !== "function") {
      throw new TypeError("decisionService.evaluate 必填");
    }
    this.decisionService = decisionService;
  }

  evaluate(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("input 必须是对象");
    const context = {
      events: clone(input.events ?? []),
      state: clone(input.state ?? {}),
      relationship: clone(input.relationship ?? {}),
      now: clone(input.now ?? new Date())
    };
    const result = this.decisionService.evaluate(context);
    const approved = Array.isArray(result?.approved) ? result.approved : [];
    if (approved.length > 0) {
      return {
        shouldContact: true,
        reasonCode: approved[0].decision?.reasonCode || "",
        candidate: clone(approved[0].candidate),
        decision: clone(approved[0].decision)
      };
    }
    const rejected = Array.isArray(result?.rejected) ? result.rejected : [];
    return {
      shouldContact: false,
      reasonCode: rejected[0]?.reasonCode || "",
      candidate: null,
      decision: null
    };
  }
}

module.exports = { WakeDecisionAdapter };
