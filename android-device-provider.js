"use strict";

const { ToolProvider } = require("./tool-provider");
const { normalizeToolResult } = require("./tool-result-normalizer");
const { ANDROID_DEVICE_TOOLS } = require("./android-device-tools");

const STATUS_TOOL = "android.device.status_get";
const STATUS_ACTION = "device.status_get";
const PUBLIC_ERROR_CODES = new Set([
  "DEVICE_NOT_AUTHORIZED",
  "DEVICE_OFFLINE",
  "DEVICE_COMMAND_TIMEOUT",
  "DEVICE_COMMAND_FAILED"
]);

class AndroidDeviceProviderError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AndroidDeviceProviderError";
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateEmptyInput(input) {
  if (!plainObject(input) || Object.keys(input).length) {
    throw new AndroidDeviceProviderError("Android Tool 输入无效", "ANDROID_INVALID_INPUT");
  }
}

function runtimeError(error) {
  if (PUBLIC_ERROR_CODES.has(error?.code)) return error;
  if (["DEVICE_NOT_FOUND", "DEVICE_NOT_PAIRED", "DEVICE_REVOKED"].includes(error?.code)) {
    return new AndroidDeviceProviderError("Device 未授权", "DEVICE_NOT_AUTHORIZED");
  }
  if (["DEVICE_SESSION_OFFLINE", "DEVICE_SESSION_NOT_FOUND", "DEVICE_SESSION_EXPIRED"].includes(error?.code)) {
    return new AndroidDeviceProviderError("Device 不在线", "DEVICE_OFFLINE");
  }
  return new AndroidDeviceProviderError("Device command 失败", "DEVICE_COMMAND_FAILED");
}

class AndroidDeviceProvider extends ToolProvider {
  constructor({ deviceId, authorizationGateway, commandService } = {}) {
    super({ name: "android_device" });
    if (typeof deviceId !== "string" || !deviceId ||
        !authorizationGateway || typeof authorizationGateway.authorize !== "function" ||
        !commandService || typeof commandService.execute !== "function") {
      throw new TypeError("Android Device Runtime 配置无效");
    }
    this.deviceId = deviceId;
    this.authorizationGateway = authorizationGateway;
    this.commandService = commandService;
    this.tools = new Map(ANDROID_DEVICE_TOOLS.map(tool => [tool.name, tool]));
  }

  getMetadata() {
    return {
      name: this.name,
      platform: "android",
      mode: "command_channel",
      version: "2",
      toolCount: this.tools.size
    };
  }

  listTools() {
    return clone([...this.tools.values()]);
  }

  async execute(toolName, input) {
    if (toolName !== STATUS_TOOL || !this.tools.has(toolName)) {
      throw new AndroidDeviceProviderError("Android Tool 不支持", "ANDROID_TOOL_UNSUPPORTED");
    }
    validateEmptyInput(input);
    try {
      this.authorizationGateway.authorize(this.deviceId, STATUS_ACTION);
      const result = await this.commandService.execute({ deviceId: this.deviceId, action: STATUS_ACTION });
      if (!plainObject(result) || !plainObject(result.response) || result.response.success !== true ||
          !plainObject(result.response.result)) {
        throw new AndroidDeviceProviderError("Device command 失败", "DEVICE_COMMAND_FAILED");
      }
      return normalizeToolResult({ toolName, result: result.response.result });
    } catch (error) {
      throw runtimeError(error);
    }
  }
}

module.exports = { AndroidDeviceProvider, AndroidDeviceProviderError, validateEmptyInput };
