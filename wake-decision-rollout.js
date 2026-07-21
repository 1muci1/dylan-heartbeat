"use strict";

function normalizePercent(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100 ? number : 0;
}

function stableBucket(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

class WakeDecisionRollout {
  constructor({ percent = 0 } = {}) {
    this.percent = normalizePercent(percent);
  }

  shouldEnforce(context = {}) {
    const input = context && typeof context === "object" && !Array.isArray(context) ? context : {};
    const identity = input.userId ?? input.scopeId ?? "default";
    const bucket = stableBucket(identity);
    return { enabled: bucket < this.percent, bucket, percent: this.percent };
  }
}

module.exports = { WakeDecisionRollout, normalizePercent, stableBucket };
