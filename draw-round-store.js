"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Draw rounds are transient game state: keep them long enough to follow a chat link,
// then remove them automatically instead of accumulating private drawings forever.
const DEFAULT_DRAW_ROUND_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_DRAW_ROUND_FILE = path.join(__dirname, "runtime-data", "draw-rounds.json");
const LOCK_RETRY_COUNT = 200;
const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 30000;
const sleepSignal = new Int32Array(new SharedArrayBuffer(4));

class DrawRoundStoreError extends Error {
  constructor(code, message = "画作回合存储暂时不可用") {
    super(message);
    this.name = "DrawRoundStoreError";
    this.code = code;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { version: 1, rounds: {}, activeRounds: {}, recentRounds: {} };
}

class DrawRoundStore {
  constructor({
    filePath = process.env.DRAW_ROUND_STORE_FILE || DEFAULT_DRAW_ROUND_FILE,
    ttlMs = DEFAULT_DRAW_ROUND_TTL_MS,
    maxRounds = 100,
    now = () => Date.now()
  } = {}) {
    if (!path.isAbsolute(filePath)) throw new TypeError("DrawRoundStore filePath 必须是绝对路径");
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError("DrawRoundStore ttlMs 必须大于 0");
    if (!Number.isInteger(maxRounds) || maxRounds <= 0) throw new TypeError("DrawRoundStore maxRounds 必须大于 0");
    if (typeof now !== "function") throw new TypeError("DrawRoundStore now 必须是函数");
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.ttlMs = ttlMs;
    this.maxRounds = maxRounds;
    this.now = now;
  }

  createRound(round) {
    if (!round || typeof round.id !== "string" || !round.id) {
      throw new DrawRoundStoreError("DRAW_ROUND_INVALID");
    }
    return this.#transaction(state => {
      const stored = clone(round);
      stored.expiresAt = new Date(this.now() + this.ttlMs).toISOString();
      state.rounds[stored.id] = stored;
      const ordered = Object.values(state.rounds).sort((left, right) =>
        String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      );
      while (ordered.length > this.maxRounds) {
        const oldest = ordered.shift();
        delete state.rounds[oldest.id];
        this.#removeRoundReferences(state, oldest.id);
      }
      return { changed: true, value: clone(stored) };
    });
  }

  getRound(roundId) {
    const id = String(roundId || "");
    if (!id) return null;
    return this.#transaction(state => ({
      changed: false,
      value: clone(state.rounds[id] || null)
    }));
  }

  updateRound(roundId, patch = {}) {
    const id = String(roundId || "");
    if (!id || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new DrawRoundStoreError("DRAW_ROUND_INVALID");
    }
    return this.#transaction(state => {
      const current = state.rounds[id];
      if (!current) return { changed: false, value: null };
      const updated = { ...current, ...clone(patch), id: current.id };
      state.rounds[id] = updated;
      return { changed: true, value: clone(updated) };
    });
  }

  setActiveRound(scopeId, activeRound) {
    const scope = String(scopeId || "");
    if (!scope || !activeRound || typeof activeRound.roundId !== "string" || !activeRound.roundId) {
      throw new DrawRoundStoreError("DRAW_ACTIVE_ROUND_INVALID");
    }
    return this.#transaction(state => {
      const round = state.rounds[activeRound.roundId];
      if (!round) return { changed: false, value: null };
      const stored = {
        roundId: round.id,
        mode: "chen_draw_user_guess",
        created_at: String(activeRound.created_at || round.createdAt || new Date(this.now()).toISOString()),
        updated_at: String(activeRound.updated_at || new Date(this.now()).toISOString()),
        expires_at: String(round.expiresAt),
        source: "chat"
      };
      state.activeRounds[scope] = stored;
      return { changed: true, value: clone(stored) };
    });
  }

  getActiveRound(scopeId) {
    const scope = String(scopeId || "");
    if (!scope) return null;
    return this.#transaction(state => {
      const activeRound = state.activeRounds[scope];
      if (!activeRound) return { changed: false, value: null };
      const expiresAt = Date.parse(activeRound.expires_at || "");
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || !state.rounds[activeRound.roundId]) {
        delete state.activeRounds[scope];
        if (state.rounds[activeRound.roundId] && expiresAt <= this.now()) {
          delete state.rounds[activeRound.roundId];
        }
        return {
          changed: true,
          value: { ...clone(activeRound), expired: true }
        };
      }
      return { changed: false, value: clone(activeRound) };
    }, { removeExpired: false });
  }

  clearActiveRound(scopeId) {
    const scope = String(scopeId || "");
    if (!scope) return false;
    return this.#transaction(state => {
      if (!state.activeRounds[scope]) return { changed: false, value: false };
      delete state.activeRounds[scope];
      return { changed: true, value: true };
    });
  }

  setRecentRound(scopeId, recentRound) {
    const scope = String(scopeId || "");
    if (!scope || !recentRound || typeof recentRound.roundId !== "string" || !recentRound.roundId) {
      throw new DrawRoundStoreError("DRAW_RECENT_ROUND_INVALID");
    }
    return this.#transaction(state => {
      if (!state.rounds[recentRound.roundId]) return { changed: false, value: null };
      const stored = {
        roundId: recentRound.roundId,
        completed_at: String(recentRound.completed_at || new Date(this.now()).toISOString()),
        expires_at: String(recentRound.expires_at || ""),
        source: "chat"
      };
      state.recentRounds[scope] = stored;
      return { changed: true, value: clone(stored) };
    });
  }

  getRecentRound(scopeId) {
    const scope = String(scopeId || "");
    if (!scope) return null;
    return this.#transaction(state => {
      const recentRound = state.recentRounds[scope];
      if (!recentRound) return { changed: false, value: null };
      const expiresAt = Date.parse(recentRound.expires_at || "");
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || !state.rounds[recentRound.roundId]) {
        delete state.recentRounds[scope];
        return { changed: true, value: null };
      }
      return { changed: false, value: clone(recentRound) };
    }, { removeExpired: false });
  }

  clearRecentRound(scopeId) {
    const scope = String(scopeId || "");
    if (!scope) return false;
    return this.#transaction(state => {
      if (!state.recentRounds[scope]) return { changed: false, value: false };
      delete state.recentRounds[scope];
      return { changed: true, value: true };
    });
  }

  deleteExpiredRounds() {
    return this.#transaction(state => {
      const removed = this.#removeExpired(state);
      return { changed: removed > 0, value: removed };
    }, { removeExpired: false });
  }

  resetForTest() {
    for (const target of [this.filePath, this.lockPath]) {
      try {
        fs.unlinkSync(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  #transaction(operation, { removeExpired = true } = {}) {
    const lock = this.#acquireLock();
    try {
      const state = this.#read();
      const expired = removeExpired ? this.#removeExpired(state) : 0;
      const result = operation(state) || {};
      if (expired > 0 || result.changed === true) this.#write(state);
      return result.value;
    } finally {
      try {
        fs.closeSync(lock);
      } finally {
        try {
          fs.unlinkSync(this.lockPath);
        } catch {}
      }
    }
  }

  #removeExpired(state) {
    const now = this.now();
    let removed = 0;
    for (const [id, round] of Object.entries(state.rounds)) {
      const expiresAt = Date.parse(round?.expiresAt || "");
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        delete state.rounds[id];
        this.#removeRoundReferences(state, id);
        removed++;
      }
    }
    for (const [scope, activeRound] of Object.entries(state.activeRounds)) {
      const expiresAt = Date.parse(activeRound?.expires_at || "");
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= now ||
        !state.rounds[activeRound?.roundId]
      ) {
        delete state.activeRounds[scope];
        removed++;
      }
    }
    for (const [scope, recentRound] of Object.entries(state.recentRounds)) {
      const expiresAt = Date.parse(recentRound?.expires_at || "");
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= now ||
        !state.rounds[recentRound?.roundId]
      ) {
        delete state.recentRounds[scope];
        removed++;
      }
    }
    return removed;
  }

  #removeRoundReferences(state, roundId) {
    for (const [scope, activeRound] of Object.entries(state.activeRounds)) {
      if (activeRound?.roundId === roundId) delete state.activeRounds[scope];
    }
    for (const [scope, recentRound] of Object.entries(state.recentRounds)) {
      if (recentRound?.roundId === roundId) delete state.recentRounds[scope];
    }
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (parsed?.version !== 1 || !parsed.rounds || typeof parsed.rounds !== "object" || Array.isArray(parsed.rounds)) {
        throw new DrawRoundStoreError("DRAW_ROUND_STORE_INVALID");
      }
      if (!parsed.activeRounds || typeof parsed.activeRounds !== "object" || Array.isArray(parsed.activeRounds)) {
        parsed.activeRounds = {};
      }
      if (!parsed.recentRounds || typeof parsed.recentRounds !== "object" || Array.isArray(parsed.recentRounds)) {
        parsed.recentRounds = {};
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      if (error instanceof DrawRoundStoreError) throw error;
      throw new DrawRoundStoreError("DRAW_ROUND_STORE_INVALID");
    }
  }

  #write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      fs.renameSync(temporary, this.filePath);
    } catch {
      try {
        fs.unlinkSync(temporary);
      } catch {}
      throw new DrawRoundStoreError("DRAW_ROUND_STORE_WRITE_FAILED");
    }
  }

  #acquireLock() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
      try {
        return fs.openSync(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (error.code !== "EEXIST") throw new DrawRoundStoreError("DRAW_ROUND_STORE_WRITE_FAILED");
        try {
          const age = this.now() - fs.statSync(this.lockPath).mtimeMs;
          if (age > STALE_LOCK_MS) {
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch {}
        Atomics.wait(sleepSignal, 0, 0, LOCK_RETRY_MS);
      }
    }
    throw new DrawRoundStoreError("DRAW_ROUND_STORE_BUSY");
  }
}

module.exports = {
  DEFAULT_DRAW_ROUND_FILE,
  DEFAULT_DRAW_ROUND_TTL_MS,
  DrawRoundStore,
  DrawRoundStoreError
};
