"use strict";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createMemoryDrawRoundStore() {
  const rounds = new Map();
  return {
    createRound(round) {
      rounds.set(round.id, clone(round));
      return clone(round);
    },
    getRound(roundId) {
      return clone(rounds.get(String(roundId)) || null);
    },
    updateRound(roundId, patch) {
      const current = rounds.get(String(roundId));
      if (!current) return null;
      const updated = { ...current, ...clone(patch), id: current.id };
      rounds.set(current.id, updated);
      return clone(updated);
    },
    deleteExpiredRounds() {
      return 0;
    },
    resetForTest() {
      rounds.clear();
    }
  };
}

module.exports = { createMemoryDrawRoundStore };
