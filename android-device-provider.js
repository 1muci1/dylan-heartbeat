"use strict";

const { ToolProvider } = require("./tool-provider");
const { normalizeToolResult } = require("./tool-result-normalizer");
const { ANDROID_DEVICE_TOOLS } = require("./android-device-tools");

const STATUS_TOOL = "android.device.status_get";
const STATUS_ACTION = "device.status_get";
const REMINDER_TOOL = "android.reminder.draft_create";
const REMINDER_ACTION = "reminder.draft_create";
const TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/i;
const MAX_DRAFT_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
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

function validateReminderInput(input) {
  if (!plainObject(input) || Object.keys(input).length !== 2 ||
      !Object.hasOwn(input, "title") || !Object.hasOwn(input, "time") ||
      typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 120 ||
      typeof input.time !== "string" || !input.time || input.time.length > 40 ||
      !TIMEZONE_SUFFIX.test(input.time) || Number.isNaN(Date.parse(input.time))) {
    throw new AndroidDeviceProviderError("Reminder Draft 输入无效", "REMINDER_DRAFT_INVALID");
  }
  return Object.freeze({ title: input.title.trim(), time: new Date(input.time).toISOString() });
}

function validateReminderResult(result) {
  if (!plainObject(result) || Object.keys(result).length !== 2 ||
      typeof result.draftId !== "string" || !result.draftId || result.draftId.length > 200 ||
      result.status !== "created") {
    throw new AndroidDeviceProviderError("Device command 失败", "DEVICE_COMMAND_FAILED");
  }
  return { draftId: result.draftId, status: result.status };
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
  constructor({ deviceId, authorizationGateway, commandService, clock = () => new Date(),
    maxDraftLeadMs = MAX_DRAFT_LEAD_MS } = {}) {
    super({ name: "android_device" });
    if (typeof deviceId !== "string" || !deviceId ||
        !authorizationGateway || typeof authorizationGateway.authorize !== "function" ||
        !commandService || typeof commandService.execute !== "function" || typeof clock !== "function" ||
        !Number.isSafeInteger(maxDraftLeadMs) || maxDraftLeadMs <= 0) {
      throw new TypeError("Android Device Runtime 配置无效");
    }
    this.deviceId = deviceId;
    this.authorizationGateway = authorizationGateway;
    this.commandService = commandService;
    this.clock = clock;
    this.maxDraftLeadMs = maxDraftLeadMs;
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
    if (!this.tools.has(toolName)) {
      throw new AndroidDeviceProviderError("Android Tool 不支持", "ANDROID_TOOL_UNSUPPORTED");
    }
    const action = toolName === STATUS_TOOL ? STATUS_ACTION : REMINDER_ACTION;
    const payload = toolName === STATUS_TOOL ? (validateEmptyInput(input), {}) : validateReminderInput(input);
    if (toolName === REMINDER_TOOL) {
      const now = this.clock();
      if (!(now instanceof Date) || Number.isNaN(now.getTime()) || Date.parse(payload.time) <= now.getTime() ||
          Date.parse(payload.time) - now.getTime() > this.maxDraftLeadMs) {
        throw new AndroidDeviceProviderError("Reminder Draft 输入无效", "REMINDER_DRAFT_INVALID");
      }
    }
    try {
      this.authorizationGateway.authorize(this.deviceId, action);
      const commandInput = toolName === STATUS_TOOL
        ? { deviceId: this.deviceId, action }
        : { deviceId: this.deviceId, action, payload };
      const result = await this.commandService.execute(commandInput);
      if (!plainObject(result) || !plainObject(result.response) || result.response.success !== true ||
          !plainObject(result.response.result)) {
        throw new AndroidDeviceProviderError("Device command 失败", "DEVICE_COMMAND_FAILED");
      }
      const output = toolName === REMINDER_TOOL
        ? validateReminderResult(result.response.result)
        : result.response.result;
      return normalizeToolResult({ toolName, result: output });
    } catch (error) {
      throw runtimeError(error);
    }
  }
}

module.exports = {
  AndroidDeviceProvider,
  AndroidDeviceProviderError,
  validateEmptyInput,
  validateReminderInput,
  validateReminderResult,
  MAX_DRAFT_LEAD_MS
};
