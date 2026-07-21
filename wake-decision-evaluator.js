"use strict";

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function rate(value, same, total) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && number <= 1) return number;
  return total ? same / total : 0;
}

class WakeDecisionEvaluator {
  evaluate(metrics) {
    const input = metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : {};
    const total = nonNegativeInteger(input.total);
    const same = nonNegativeInteger(input.same);
    const oldOnly = nonNegativeInteger(input.oldOnly);
    const newOnly = nonNegativeInteger(input.newOnly);
    const agreementRate = rate(input.agreementRate, same, total);
    const reasonCodes = [];
    if (total < 50) reasonCodes.push("INSUFFICIENT_SAMPLE");
    if (agreementRate < 0.90) reasonCodes.push("LOW_AGREEMENT");
    if (newOnly > total * 0.05) reasonCodes.push("TOO_MANY_NEW_CONTACTS");
    if (oldOnly > total * 0.15) reasonCodes.push("TOO_MANY_MISSED_CONTACTS");
    return {
      eligible: reasonCodes.length === 0,
      reasonCodes,
      summary: { total, agreementRate, same, oldOnly, newOnly }
    };
  }
}

module.exports = { WakeDecisionEvaluator };
