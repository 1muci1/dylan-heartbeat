"use strict";

const { randomUUID } = require("node:crypto");
const { DeviceCommandStore } = require("./device-command-store");
const { DeviceBridgeProtocol } = require("./device-bridge-protocol");

const DEVICE_COMMAND_ACTIONS = Object.freeze(["device.status_get"]);
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

class DeviceCommandError extends Error {
  constructor(message, code = "DEVICE_COMMAND_INVALID") {
    super(message);
    this.name = "DeviceCommandError";
    this.code = code;
  }
}

function exactInput(input) {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).length === 2 && typeof input.deviceId === "string" && Boolean(input.deviceId) &&
    typeof input.action === "string" && Boolean(input.action);
}

class DeviceCommandService {
  constructor({ identityStore, sessionService, transport, commandStore = new DeviceCommandStore(),
    protocol = new DeviceBridgeProtocol(), commandIdFactory = randomUUID, clock = () => new Date(),
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    if (!identityStore || typeof identityStore.get !== "function" ||
        !sessionService || typeof sessionService.assertOnline !== "function" ||
        !transport || typeof transport.send !== "function" ||
        !commandStore || typeof commandStore.create !== "function" || typeof commandStore.markSent !== "function" ||
        typeof commandStore.get !== "function" || typeof commandStore.complete !== "function" ||
        typeof commandStore.fail !== "function" ||
        !protocol || typeof protocol.createRequest !== "function" || typeof protocol.validateResponse !== "function" ||
        typeof commandIdFactory !== "function" || typeof clock !== "function" ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("Device Command 配置无效");
    this.identityStore = identityStore;
    this.sessionService = sessionService;
    this.transport = transport;
    this.commandStore = commandStore;
    this.protocol = protocol;
    this.commandIdFactory = commandIdFactory;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  async execute(input = {}) {
    if (!exactInput(input)) throw new DeviceCommandError("Command 输入无效");
    if (!DEVICE_COMMAND_ACTIONS.includes(input.action)) {
      throw new DeviceCommandError("Device action 不支持", "DEVICE_ACTION_UNSUPPORTED");
    }
    this.#assertPaired(input.deviceId);
    this.sessionService.assertOnline(input.deviceId);

    const createdAt = this.#now().toISOString();
    const commandId = this.commandIdFactory();
    if (typeof commandId !== "string" || !commandId) throw new DeviceCommandError("Command ID 无效");
    this.commandStore.create({ commandId, deviceId: input.deviceId, action: input.action, createdAt });

    let timer;
    try {
      const request = this.protocol.createRequest({ deviceId: input.deviceId, action: input.action, payload: {} });
      this.commandStore.markSent(commandId);
      const response = await Promise.race([
        Promise.resolve().then(() => this.transport.send(request)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new DeviceCommandError("Device command 超时", "DEVICE_COMMAND_TIMEOUT")),
            this.timeoutMs);
        })
      ]);
      const validated = this.protocol.validateResponse(response, { requestId: request.requestId });
      this.commandStore.complete(commandId, this.#now().toISOString());
      return Object.freeze({ command: this.commandStore.get(commandId), response: validated });
    } catch (error) {
      this.commandStore.fail(commandId, this.#now().toISOString());
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  #assertPaired(deviceId) {
    const device = this.identityStore.get(deviceId);
    if (!device) throw new DeviceCommandError("Device 不存在", "DEVICE_NOT_FOUND");
    if (device.status === "revoked") throw new DeviceCommandError("Device 已撤销", "DEVICE_REVOKED");
    if (device.status !== "paired") throw new DeviceCommandError("Device 尚未配对", "DEVICE_NOT_PAIRED");
  }

  #now() {
    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new DeviceCommandError("Clock 无效");
    return now;
  }
}

module.exports = { DEFAULT_COMMAND_TIMEOUT_MS, DEVICE_COMMAND_ACTIONS, DeviceCommandError, DeviceCommandService };
