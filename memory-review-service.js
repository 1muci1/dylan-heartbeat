"use strict";

const crypto = require("node:crypto");

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SENSITIVE_METADATA_PATTERN = /(?:\bapi[\s_-]*key\b|\b(?:access|bearer|device)?[\s_-]*token\b|\bpassword\b|\bcookie\b|API\s*密钥|访问令牌|密码|验证码|身份证|银行卡|精确(?:地址|住址)|系统提示词)/iu;
const REDACTED_TITLE = "内容已隐藏";

class MemoryReviewServiceError extends Error {
  constructor(message, code = "MEMORY_REVIEW_NOT_FOUND") {
    super(message);
    this.name = "MemoryReviewServiceError";
    this.code = code;
  }
}

function publicId(value) {
  if (typeof value !== "string" || !PUBLIC_ID_PATTERN.test(value.trim())) {
    throw new MemoryReviewServiceError("Review id 无效", "MEMORY_REVIEW_ID_INVALID");
  }
  return value.trim();
}

class MemoryReviewService {
  #queue;
  #idFactory;
  #proposalToReview = new Map();
  #reviewToProposal = new Map();

  constructor({ queue, idFactory = () => `review-${crypto.randomUUID()}` } = {}) {
    if (
      !queue ||
      typeof queue.listPending !== "function" ||
      typeof queue.getPending !== "function" ||
      typeof queue.submit !== "function"
    ) {
      throw new TypeError("MemoryReviewQueue 必填");
    }
    if (typeof idFactory !== "function") throw new TypeError("idFactory 必须是函数");
    this.#queue = queue;
    this.#idFactory = idFactory;
  }

  #ensureReviewId(proposalId) {
    const existing = this.#proposalToReview.get(proposalId);
    if (existing) return existing;
    const id = publicId(this.#idFactory());
    if (this.#reviewToProposal.has(id)) {
      throw new MemoryReviewServiceError("Review id 冲突", "MEMORY_REVIEW_ID_CONFLICT");
    }
    this.#proposalToReview.set(proposalId, id);
    this.#reviewToProposal.set(id, proposalId);
    return id;
  }

  #forget(id, proposalId) {
    this.#reviewToProposal.delete(id);
    this.#proposalToReview.delete(proposalId);
  }

  #pendingForReviewId(id) {
    const normalizedId = publicId(id);
    const proposalId = this.#reviewToProposal.get(normalizedId);
    if (!proposalId) throw new MemoryReviewServiceError("Pending Proposal 不存在");
    const proposal = this.#queue.getPending(proposalId);
    if (!proposal) {
      this.#forget(normalizedId, proposalId);
      throw new MemoryReviewServiceError("Pending Proposal 不存在");
    }
    return { id: normalizedId, proposalId, proposal };
  }

  list() {
    const pending = this.#queue.listPending();
    const activeProposalIds = new Set(pending.map(proposal => proposal.proposalId));
    for (const [proposalId, id] of this.#proposalToReview) {
      if (!activeProposalIds.has(proposalId)) this.#forget(id, proposalId);
    }
    return pending.map(proposal => Object.freeze({
      id: this.#ensureReviewId(proposal.proposalId),
      category: proposal.category,
      title: SENSITIVE_METADATA_PATTERN.test(proposal.title) ? REDACTED_TITLE : proposal.title,
      importance: proposal.importance,
      status: "pending"
    }));
  }

  approve(id) {
    const pending = this.#pendingForReviewId(id);
    const result = this.#queue.submit({
      status: "approved",
      proposal: pending.proposal
    });
    if (result.status === "created") {
      this.#forget(pending.id, pending.proposalId);
      return Object.freeze({ id: pending.id, status: "approved" });
    }
    return Object.freeze({
      id: pending.id,
      status: "failed",
      reasonCode: result.reasonCode || "MEMORY_WRITE_FAILED"
    });
  }

  reject(id) {
    const pending = this.#pendingForReviewId(id);
    this.#queue.submit({
      status: "rejected",
      proposal: pending.proposal
    });
    this.#forget(pending.id, pending.proposalId);
    return Object.freeze({ id: pending.id, status: "rejected" });
  }
}

module.exports = {
  MemoryReviewService,
  MemoryReviewServiceError,
  REDACTED_TITLE
};
