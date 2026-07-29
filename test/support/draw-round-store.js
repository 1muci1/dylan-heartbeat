"use strict";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createMemoryDrawRoundStore() {
  const rounds = new Map();
  const activeRounds = new Map();
  const recentRounds = new Map();
  return {
    createRound(round) {
      const stored = {
        ...clone(round),
        expiresAt: round.expiresAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      };
      rounds.set(round.id, stored);
      return clone(stored);
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
    setActiveRound(scopeId, activeRound) {
      if (!rounds.has(String(activeRound?.roundId || ""))) return null;
      activeRounds.set(String(scopeId), clone(activeRound));
      return clone(activeRound);
    },
    getActiveRound(scopeId) {
      return clone(activeRounds.get(String(scopeId)) || null);
    },
    clearActiveRound(scopeId) {
      return activeRounds.delete(String(scopeId));
    },
    setRecentRound(scopeId, recentRound) {
      recentRounds.set(String(scopeId), clone(recentRound));
      return clone(recentRound);
    },
    getRecentRound(scopeId) {
      return clone(recentRounds.get(String(scopeId)) || null);
    },
    clearRecentRound(scopeId) {
      return recentRounds.delete(String(scopeId));
    },
    deleteExpiredRounds() {
      return 0;
    },
    resetForTest() {
      rounds.clear();
      activeRounds.clear();
      recentRounds.clear();
    }
  };
}

module.exports = { createMemoryDrawRoundStore };
