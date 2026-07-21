"use strict";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { DeviceIdentityStore } = require("./device-identity-store");

class DevicePairingError extends Error {
  constructor(message, code = "DEVICE_PAIRING_INVALID") {
    super(message);
    this.name = "DevicePairingError";
    this.code = code;
  }
}

function hashToken(token) {
  if (typeof token !== "string" || !token) throw new DevicePairingError("Pairing token 无效", "DEVICE_PAIRING_TOKEN_INVALID");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class DevicePairingService {
  constructor({ store = new DeviceIdentityStore(), idFactory = randomUUID,
    tokenFactory = () => randomBytes(32).toString("base64url"), clock = () => new Date() } = {}) {
    if (!store || typeof store.create !== "function" || typeof store.get !== "function" ||
        typeof store.hasTokenHash !== "function" || typeof store.setStatus !== "function" ||
        typeof idFactory !== "function" || typeof tokenFactory !== "function" || typeof clock !== "function") {
      throw new TypeError("Device Pairing 配置无效");
    }
    this.store = store;
    this.idFactory = idFactory;
    this.tokenFactory = tokenFactory;
    this.clock = clock;
  }

  createPairingRequest(input = {}) {
    if (!plainObject(input) || Object.keys(input).some(key => !["deviceName", "platform"].includes(key)) ||
        typeof input.deviceName !== "string" || !input.deviceName.trim() || input.platform !== "android") {
      throw new DevicePairingError("Pairing request 无效");
    }
    const deviceId = this.idFactory();
    const pairingToken = this.tokenFactory();
    const now = this.clock();
    if (typeof deviceId !== "string" || !deviceId || typeof pairingToken !== "string" || !pairingToken ||
        !(now instanceof Date) || Number.isNaN(now.getTime())) throw new DevicePairingError("Pairing request 无效");
    const device = this.store.create({
      deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
      tokenHash: hashToken(pairingToken),
      createdAt: now.toISOString()
    });
    return Object.freeze({ device, pairingToken });
  }

  confirmPairing({ deviceId, pairingToken } = {}) {
    const device = this.store.get(deviceId);
    if (!device) throw new DevicePairingError("Device 不存在", "DEVICE_NOT_FOUND");
    if (device.status === "paired") throw new DevicePairingError("Pairing token 已使用", "DEVICE_PAIRING_TOKEN_USED");
    if (device.status === "revoked") throw new DevicePairingError("Device 已撤销", "DEVICE_REVOKED");
    if (device.status !== "pending") throw new DevicePairingError("Device pairing 状态无效", "DEVICE_STATUS_INVALID");
    const suppliedHash = hashToken(pairingToken);
    const matches = this.store.hasTokenHash(deviceId, suppliedHash);
    if (!matches) throw new DevicePairingError("Pairing token 无效", "DEVICE_PAIRING_TOKEN_INVALID");
    return this.store.setStatus(deviceId, "paired");
  }

  revoke(deviceId) {
    const device = this.store.get(deviceId);
    if (!device) throw new DevicePairingError("Device 不存在", "DEVICE_NOT_FOUND");
    if (device.status === "revoked") return device;
    if (device.status !== "paired") throw new DevicePairingError("Device 尚未配对", "DEVICE_NOT_PAIRED");
    return this.store.setStatus(deviceId, "revoked");
  }

  assertDeviceCanRequest(deviceId) {
    const device = this.store.get(deviceId);
    if (!device) throw new DevicePairingError("Device 不存在", "DEVICE_NOT_FOUND");
    if (device.status === "revoked") throw new DevicePairingError("Device 已撤销", "DEVICE_REVOKED");
    if (device.status !== "paired") throw new DevicePairingError("Device 尚未配对", "DEVICE_NOT_PAIRED");
    return device;
  }
}

module.exports = { DevicePairingError, DevicePairingService, hashToken };
