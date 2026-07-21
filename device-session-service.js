"use strict";

const { randomUUID } = require("node:crypto");
const { DeviceSessionStore } = require("./device-session-store");

const DEFAULT_SESSION_TTL_MS = 90_000;

class DeviceSessionError extends Error {
  constructor(message, code = "DEVICE_SESSION_INVALID") {
    super(message);
    this.name = "DeviceSessionError";
    this.code = code;
  }
}

function exactInput(input, keys) {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === keys.length && keys.every(key => typeof input[key] === "string" && input[key]);
}

class DeviceSessionService {
  constructor({ identityStore, sessionStore = new DeviceSessionStore(), sessionIdFactory = randomUUID,
    clock = () => new Date(), sessionTtlMs = DEFAULT_SESSION_TTL_MS } = {}) {
    if (!identityStore || typeof identityStore.get !== "function" ||
        !sessionStore || typeof sessionStore.create !== "function" || typeof sessionStore.get !== "function" ||
        typeof sessionStore.findByDeviceId !== "function" || typeof sessionStore.touch !== "function" ||
        typeof sessionStore.delete !== "function" ||
        typeof sessionIdFactory !== "function" || typeof clock !== "function" ||
        !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0) {
      throw new TypeError("Device Session 配置无效");
    }
    this.identityStore = identityStore;
    this.sessionStore = sessionStore;
    this.sessionIdFactory = sessionIdFactory;
    this.clock = clock;
    this.sessionTtlMs = sessionTtlMs;
  }

  connect(input = {}) {
    if (!exactInput(input, ["deviceId"])) throw new DeviceSessionError("Connect 输入无效");
    this.#assertPaired(input.deviceId);
    const now = this.#now();
    const sessionId = this.sessionIdFactory();
    if (typeof sessionId !== "string" || !sessionId) throw new DeviceSessionError("Session ID 无效");
    return this.sessionStore.create({
      sessionId,
      deviceId: input.deviceId,
      connectedAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString()
    });
  }

  heartbeat(input = {}) {
    if (!exactInput(input, ["sessionId"])) throw new DeviceSessionError("Heartbeat 输入无效");
    const now = this.#now();
    const session = this.#activeSession(input.sessionId, now);
    try {
      this.#assertPaired(session.deviceId);
    } catch (error) {
      this.sessionStore.delete(session.sessionId);
      throw error;
    }
    return this.sessionStore.touch(session.sessionId, now.toISOString());
  }

  disconnect(input = {}) {
    if (!exactInput(input, ["sessionId"])) throw new DeviceSessionError("Disconnect 输入无效");
    const now = this.#now();
    const session = this.#activeSession(input.sessionId, now);
    this.sessionStore.delete(session.sessionId);
    return session;
  }

  assertOnline(deviceId) {
    if (typeof deviceId !== "string" || !deviceId) throw new DeviceSessionError("Device ID 无效");
    const session = this.sessionStore.findByDeviceId(deviceId);
    if (!session) throw new DeviceSessionError("Device session 不在线", "DEVICE_SESSION_OFFLINE");
    const active = this.#activeSession(session.sessionId, this.#now());
    try {
      this.#assertPaired(active.deviceId);
    } catch (error) {
      this.sessionStore.delete(active.sessionId);
      throw error;
    }
    return active;
  }

  #assertPaired(deviceId) {
    const device = this.identityStore.get(deviceId);
    if (!device) throw new DeviceSessionError("Device 不存在", "DEVICE_NOT_FOUND");
    if (device.status === "revoked") throw new DeviceSessionError("Device 已撤销", "DEVICE_REVOKED");
    if (device.status !== "paired") throw new DeviceSessionError("Device 尚未配对", "DEVICE_NOT_PAIRED");
    return device;
  }

  #activeSession(sessionId, now) {
    const session = this.sessionStore.get(sessionId);
    if (!session) throw new DeviceSessionError("Device session 不存在", "DEVICE_SESSION_NOT_FOUND");
    if (now.getTime() - Date.parse(session.lastHeartbeatAt) >= this.sessionTtlMs) {
      this.sessionStore.delete(sessionId);
      throw new DeviceSessionError("Device session 已过期", "DEVICE_SESSION_EXPIRED");
    }
    return session;
  }

  #now() {
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new DeviceSessionError("Clock 无效");
    return now;
  }
}

module.exports = { DEFAULT_SESSION_TTL_MS, DeviceSessionError, DeviceSessionService };
