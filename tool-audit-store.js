"use strict";

const { NAME_PATTERN } = require("./tool-registry");

const APPROVAL_STATUSES = new Set(["pending", "approved", "rejected", "expired"]);
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

class ToolAuditStoreError extends Error {
  constructor(message, code = "TOOL_AUDIT_INVALID") {
    super(message);
    this.name = "ToolAuditStoreError";
    this.code = code;
  }
}

function toolName(value) {
  if (typeof value !== "string" || !NAME_PATTERN.test(value)) throw new ToolAuditStoreError("toolName 格式无效");
  return value;
}

function approvalStatus(value, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== "string" || !APPROVAL_STATUSES.has(value)) throw new ToolAuditStoreError("approvalStatus 无效");
  return value;
}

function errorCode(value) {
  if (typeof value !== "string" || !ERROR_CODE_PATTERN.test(value)) throw new ToolAuditStoreError("errorCode 格式无效");
  return value;
}

function exactInput(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolAuditStoreError("Audit 输入无效");
  const unknown = Object.keys(input).find(key => !allowed.has(key));
  if (unknown) throw new ToolAuditStoreError(`不允许 Audit 字段：${unknown}`);
  return input;
}

class ToolAuditStore {
  constructor({ eventStore } = {}) {
    if (!eventStore || typeof eventStore.create !== "function") throw new TypeError("eventStore 必填");
    this.eventStore = eventStore;
  }

  create(eventType, name, payload) {
    return this.eventStore.create({
      eventType,
      subjectType: "tool",
      subjectId: name,
      payload
    }, { source: "tool-audit-store" });
  }

  recordRequested(input) {
    exactInput(input, new Set(["toolName", "approvalStatus"]));
    const name = toolName(input.toolName);
    const status = approvalStatus(input.approvalStatus);
    return this.create("tool.requested", name, { toolName: name, ...(status ? { approvalStatus: status } : {}) });
  }

  recordApproved(input) {
    exactInput(input, new Set(["toolName", "approvalStatus"]));
    const name = toolName(input.toolName);
    const status = approvalStatus(input.approvalStatus ?? "approved", true);
    if (status !== "approved") throw new ToolAuditStoreError("tool.approved 的 approvalStatus 必须是 approved");
    return this.create("tool.approved", name, { toolName: name, approvalStatus: status });
  }

  recordCompleted(input) {
    exactInput(input, new Set(["toolName"]));
    const name = toolName(input.toolName);
    return this.create("tool.completed", name, { toolName: name, success: true });
  }

  recordFailed(input) {
    exactInput(input, new Set(["toolName", "errorCode"]));
    const name = toolName(input.toolName);
    return this.create("tool.failed", name, { toolName: name, success: false, errorCode: errorCode(input.errorCode) });
  }
}

module.exports = {
  APPROVAL_STATUSES,
  ERROR_CODE_PATTERN,
  ToolAuditStore,
  ToolAuditStoreError
};
