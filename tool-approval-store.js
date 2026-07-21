"use strict";

const crypto = require("node:crypto");
const { createToolApprovalRequest } = require("./tool-approval-request");

const APPROVAL_STATUSES = Object.freeze(["pending", "approved", "rejected", "expired"]);

class ToolApprovalStoreError extends Error {
  constructor(message, code = "TOOL_APPROVAL_INVALID") {
    super(message);
    this.name = "ToolApprovalStoreError";
    this.code = code;
  }
}

function requiredText(value, field, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ToolApprovalStoreError(`${field} 格式无效`);
  }
  return value.trim();
}

function publicApproval(item) {
  return item ? {
    id: item.id,
    toolName: item.toolName,
    inputHash: item.inputHash,
    riskLevel: item.riskLevel,
    reasonCode: item.reasonCode,
    summary: item.summary,
    status: item.status,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    decidedAt: item.decidedAt
  } : null;
}

class ToolApprovalStore {
  constructor({ clock = () => new Date(), idFactory = () => crypto.randomUUID(), ttlMs = 5 * 60 * 1000 } = {}) {
    if (typeof clock !== "function" || typeof idFactory !== "function") throw new TypeError("clock 和 idFactory 必须是函数");
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 24 * 60 * 60 * 1000) {
      throw new TypeError("ttlMs 必须是 1000 到 86400000");
    }
    this.clock = clock;
    this.idFactory = idFactory;
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  now() {
    const value = this.clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new ToolApprovalStoreError("clock 返回时间无效");
    return value;
  }

  create({ toolName, inputHash, riskLevel = "medium", reasonCode = "TOOL_USER_CONFIRM_REQUIRED", summary } = {}) {
    const name = requiredText(toolName, "toolName", 120);
    const hash = requiredText(inputHash, "inputHash", 128);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ToolApprovalStoreError("inputHash 格式无效");
    const now = this.now();
    const request = createToolApprovalRequest({
      id: requiredText(this.idFactory(), "id"), toolName: name, inputHash: hash, riskLevel, reasonCode,
      summary: summary ?? `Confirm execution of ${name}`,
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString()
    });
    const item = {
      ...request,
      status: "pending",
      createdAt: now.toISOString(),
      decidedAt: null
    };
    if (this.items.has(item.id)) throw new ToolApprovalStoreError("Approval ID 已存在", "TOOL_APPROVAL_DUPLICATE");
    this.items.set(item.id, item);
    return publicApproval(item);
  }

  get(id) {
    const item = this.items.get(requiredText(id, "id"));
    if (!item) return null;
    if (["pending", "approved"].includes(item.status) && this.now().toISOString() >= item.expiresAt) {
      item.status = "expired";
      item.decidedAt = item.expiresAt;
    }
    return publicApproval(item);
  }

  approve(id) {
    return this.transition(id, "approved");
  }

  reject(id) {
    return this.transition(id, "rejected");
  }

  expire(id) {
    return this.transition(id, "expired");
  }

  transition(id, status) {
    const approval = this.get(id);
    if (!approval) throw new ToolApprovalStoreError("Approval 不存在", "TOOL_APPROVAL_NOT_FOUND");
    if (approval.status === status) return approval;
    if (approval.status !== "pending") {
      throw new ToolApprovalStoreError("Approval 状态不可转换", "TOOL_APPROVAL_STATE_INVALID");
    }
    const item = this.items.get(approval.id);
    item.status = status;
    item.decidedAt = this.now().toISOString();
    return publicApproval(item);
  }

  list({ status } = {}) {
    if (status != null && !APPROVAL_STATUSES.includes(status)) throw new ToolApprovalStoreError("status 无效");
    const items = [];
    for (const id of this.items.keys()) {
      const item = this.get(id);
      if (!status || item.status === status) items.push(item);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
}

module.exports = { APPROVAL_STATUSES, ToolApprovalStore, ToolApprovalStoreError, publicApproval };
