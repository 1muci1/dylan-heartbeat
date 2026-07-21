"use strict";

const { NAME_PATTERN } = require("./tool-registry");

const REQUEST_FIELDS = new Set(["id", "toolName", "riskLevel", "reasonCode", "summary", "inputHash", "expiresAt"]);
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

class ToolApprovalRequestError extends Error {
  constructor(message, code = "TOOL_APPROVAL_REQUEST_INVALID") {
    super(message); this.name = "ToolApprovalRequestError"; this.code = code;
  }
}

function boundedText(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ToolApprovalRequestError(`${field} 格式无效`);
  }
  return value.trim();
}

function createToolApprovalRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolApprovalRequestError("Approval Request 格式无效");
  const unknown = Object.keys(input).find(key => !REQUEST_FIELDS.has(key));
  if (unknown) throw new ToolApprovalRequestError(`不允许 Approval Request 字段：${unknown}`);
  const missing = [...REQUEST_FIELDS].find(key => !Object.hasOwn(input, key));
  if (missing) throw new ToolApprovalRequestError(`Approval Request 缺少字段：${missing}`);
  const id = boundedText(input.id, "id", 200);
  const toolName = boundedText(input.toolName, "toolName", 120);
  if (!NAME_PATTERN.test(toolName)) throw new ToolApprovalRequestError("toolName 格式无效");
  if (!RISK_LEVELS.has(input.riskLevel)) throw new ToolApprovalRequestError("riskLevel 无效");
  if (typeof input.reasonCode !== "string" || !REASON_CODE_PATTERN.test(input.reasonCode)) throw new ToolApprovalRequestError("reasonCode 格式无效");
  const summary = boundedText(input.summary, "summary", 240);
  if (typeof input.inputHash !== "string" || !HASH_PATTERN.test(input.inputHash)) throw new ToolApprovalRequestError("inputHash 格式无效");
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime())) throw new ToolApprovalRequestError("expiresAt 时间无效");
  return Object.freeze({ id, toolName, riskLevel: input.riskLevel, reasonCode: input.reasonCode,
    summary, inputHash: input.inputHash, expiresAt: expires.toISOString() });
}

function approvalRequestFromRecord(record) {
  if (!record || typeof record !== "object") throw new ToolApprovalRequestError("Approval record 无效");
  return createToolApprovalRequest({
    id: record.id, toolName: record.toolName, riskLevel: record.riskLevel, reasonCode: record.reasonCode,
    summary: record.summary, inputHash: record.inputHash, expiresAt: record.expiresAt
  });
}

module.exports = { HASH_PATTERN, REASON_CODE_PATTERN, REQUEST_FIELDS, RISK_LEVELS,
  ToolApprovalRequestError, approvalRequestFromRecord, createToolApprovalRequest };
