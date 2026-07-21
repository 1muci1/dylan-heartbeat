"use strict";

function clone(value) {
  return structuredClone(value);
}

function priorityOf(candidate) {
  const priority = Number(candidate?.priority);
  return Number.isFinite(priority) ? priority : Number.NEGATIVE_INFINITY;
}

class ProactiveDecisionService {
  constructor({ candidateGenerator, policyEngine } = {}) {
    if (!candidateGenerator || typeof candidateGenerator.generate !== "function") {
      throw new TypeError("candidateGenerator.generate 必填");
    }
    if (!policyEngine || typeof policyEngine.evaluate !== "function") {
      throw new TypeError("policyEngine.evaluate 必填");
    }
    this.candidateGenerator = candidateGenerator;
    this.policyEngine = policyEngine;
  }

  evaluate(context = {}) {
    const generated = this.candidateGenerator.generate(clone(context));
    if (!Array.isArray(generated)) throw new TypeError("CandidateGenerator 必须返回数组");
    const candidates = generated.map(candidate => clone(candidate)).sort((left, right) => priorityOf(right) - priorityOf(left));
    const allowed = [];
    const rejected = [];

    for (const candidate of candidates) {
      const policyContext = {
        state: clone(context.state ?? {}),
        relationship: clone(context.relationship ?? {}),
        now: clone(context.now ?? new Date())
      };
      const decision = this.policyEngine.evaluate(clone(candidate), policyContext);
      if (decision?.allowed === true) allowed.push({ candidate, decision: clone(decision) });
      else rejected.push({ candidate, reasonCode: decision?.reasonCode || "POLICY_REJECTED" });
    }

    return { candidates, approved: allowed.slice(0, 1), rejected };
  }
}

module.exports = { ProactiveDecisionService };
