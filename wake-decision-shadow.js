"use strict";

function shouldContact(value) {
  return value?.shouldContact === true;
}

function safeReasonCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "";
}

class WakeDecisionShadow {
  compare({ oldDecision, newDecision, context: _context } = {}) {
    const oldShouldContact = shouldContact(oldDecision);
    const newShouldContact = shouldContact(newDecision);
    const agreement = oldShouldContact === newShouldContact;
    return {
      oldDecision: { shouldContact: oldShouldContact },
      newDecision: {
        shouldContact: newShouldContact,
        reasonCode: safeReasonCode(newDecision?.reasonCode)
      },
      agreement,
      differenceType: agreement ? "same" : oldShouldContact ? "old_only" : "new_only"
    };
  }
}

module.exports = { WakeDecisionShadow };
