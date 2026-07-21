"use strict";

const COMMAND_STATUSES = Object.freeze(["created", "sent", "completed", "failed"]);

class DeviceCommandStoreError extends Error {
  constructor(message, code = "DEVICE_COMMAND_INVALID") {
    super(message);
    this.name = "DeviceCommandStoreError";
    this.code = code;
  }
}

function publicCommand(record) {
  if (!record) return null;
  return Object.freeze({
    commandId: record.commandId,
    deviceId: record.deviceId,
    action: record.action,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt
  });
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

class DeviceCommandStore {
  constructor() {
    this.records = new Map();
  }

  create({ commandId, deviceId, action, createdAt }) {
    if (typeof commandId !== "string" || !commandId || this.records.has(commandId) ||
        typeof deviceId !== "string" || !deviceId || typeof action !== "string" || !action ||
        !validTimestamp(createdAt)) throw new DeviceCommandStoreError("Device command 无效");
    const record = {
      commandId,
      deviceId,
      action,
      status: "created",
      createdAt: new Date(createdAt).toISOString(),
      completedAt: null
    };
    this.records.set(commandId, record);
    return publicCommand(record);
  }

  get(commandId) {
    return publicCommand(this.records.get(commandId));
  }

  markSent(commandId) {
    return this.#transition(commandId, "created", "sent", null);
  }

  complete(commandId, completedAt) {
    return this.#transition(commandId, "sent", "completed", completedAt);
  }

  fail(commandId, completedAt) {
    return this.#transition(commandId, ["created", "sent"], "failed", completedAt);
  }

  #transition(commandId, expected, status, completedAt) {
    const record = this.records.get(commandId);
    if (!record) throw new DeviceCommandStoreError("Device command 不存在", "DEVICE_COMMAND_NOT_FOUND");
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (!expectedStatuses.includes(record.status) || !COMMAND_STATUSES.includes(status) ||
        (completedAt !== null && !validTimestamp(completedAt))) {
      throw new DeviceCommandStoreError("Device command 状态转换无效", "DEVICE_COMMAND_STATUS_INVALID");
    }
    record.status = status;
    record.completedAt = completedAt === null ? null : new Date(completedAt).toISOString();
    return publicCommand(record);
  }
}

module.exports = { COMMAND_STATUSES, DeviceCommandStore, DeviceCommandStoreError };
