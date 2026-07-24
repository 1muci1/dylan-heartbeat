"use strict";

const {
  APPROVAL_STATUSES,
  AgentMemoryApprovalError,
  normalizeProposal
} = require("./agent-memory-approval");

const DEFAULT_MAX_PENDING = 100;

class MemoryReviewQueueError extends Error {
  constructor(message, code = "MEMORY_REVIEW_QUEUE_INPUT_INVALID") {
    super(message);
    this.name = "MemoryReviewQueueError";
    this.code = code;
  }
}

function normalizeApprovalResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MemoryReviewQueueError("Approval Result 必须是对象");
  }
  const unknown = Object.keys(input).find(field => !new Set(["status", "proposal"]).has(field));
  if (unknown) {
    throw new MemoryReviewQueueError(
      `Approval Result 包含不允许的字段：${unknown}`,
      "MEMORY_REVIEW_QUEUE_FIELD_FORBIDDEN"
    );
  }
  if (!APPROVAL_STATUSES.includes(input.status)) {
    throw new MemoryReviewQueueError("Approval status 无效");
  }
  try {
    return Object.freeze({
      status: input.status,
      proposal: normalizeProposal(input.proposal)
    });
  } catch (error) {
    if (error instanceof AgentMemoryApprovalError) {
      throw new MemoryReviewQueueError(error.message);
    }
    throw error;
  }
}

function writerProposal(proposal) {
  return {
    category: proposal.category,
    title: proposal.title,
    content: proposal.content,
    importance: proposal.importance
  };
}

function publicProposal(proposal) {
  return Object.freeze({ ...proposal });
}

class MemoryReviewQueue {
  #writer;
  #pending = new Map();
  #maxPending;

  constructor({ writer, maxPending = DEFAULT_MAX_PENDING } = {}) {
    if (!writer || typeof writer.create !== "function") {
      throw new TypeError("create-only Writer 必填");
    }
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 1000) {
      throw new TypeError("maxPending 必须是 1 到 1000");
    }
    this.#writer = writer;
    this.#maxPending = maxPending;
  }

  submit(input) {
    const decision = normalizeApprovalResult(input);
    const { proposal } = decision;

    if (decision.status === "rejected") {
      this.#pending.delete(proposal.proposalId);
      return Object.freeze({
        status: "discarded",
        proposalId: proposal.proposalId
      });
    }

    if (decision.status === "needs_review") {
      if (!this.#pending.has(proposal.proposalId) && this.#pending.size >= this.#maxPending) {
        throw new MemoryReviewQueueError("Pending Queue 已满", "MEMORY_REVIEW_QUEUE_FULL");
      }
      this.#pending.set(proposal.proposalId, proposal);
      return Object.freeze({
        status: "pending",
        proposal: publicProposal(proposal)
      });
    }

    try {
      const memory = this.#writer.create(writerProposal(proposal));
      this.#pending.delete(proposal.proposalId);
      return Object.freeze({
        status: "created",
        proposalId: proposal.proposalId,
        memoryId: typeof memory?.id === "string" ? memory.id : null
      });
    } catch {
      return Object.freeze({
        status: "failed",
        proposalId: proposal.proposalId,
        reasonCode: "MEMORY_WRITE_FAILED"
      });
    }
  }

  listPending() {
    return [...this.#pending.values()].map(publicProposal);
  }

  getPending(proposalId) {
    const proposal = this.#pending.get(String(proposalId || ""));
    return proposal ? publicProposal(proposal) : null;
  }
}

module.exports = {
  DEFAULT_MAX_PENDING,
  MemoryReviewQueue,
  MemoryReviewQueueError,
  normalizeApprovalResult
};
