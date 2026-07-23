"use strict";

const PROACTIVE_EXPLANATION_TOOL_NAME = "proactive_explanation_get";
const MAX_DELIVERY_ID_LENGTH = 200;
const PROACTIVE_EXPLANATION_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    deliveryId: Object.freeze({ type: "string", minLength: 1, maxLength: MAX_DELIVERY_ID_LENGTH })
  }),
  required: Object.freeze(["deliveryId"]),
  additionalProperties: false
});
const SUMMARY_CODES = Object.freeze({
  pending: "DELIVERY_PENDING",
  sending: "DELIVERY_SENDING",
  sent: "DELIVERY_SENT",
  failed: "DELIVERY_FAILED",
  cancelled: "DELIVERY_CANCELLED"
});
const DELIVERY_STATUSES = Object.freeze(Object.keys(SUMMARY_CODES));
const FEEDBACK_TYPES = Object.freeze(["liked", "dismissed", "not_relevant", "disable_future"]);

class ProactiveExplanationContractError extends Error {
  constructor(message, code = "PROACTIVE_EXPLANATION_UNAVAILABLE") {
    super(message);
    this.name = "ProactiveExplanationContractError";
    this.code = code;
    this.statusCode = 500;
  }
}

function normalizeDeliveryId(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_DELIVERY_ID_LENGTH) {
    const error = new ProactiveExplanationContractError("deliveryId 格式无效", "PROACTIVE_EXPLANATION_INVALID");
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProactiveExplanationContractError(`${field} 格式无效`);
  }
  return value;
}

function text(value, field, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !value) throw new ProactiveExplanationContractError(`${field} 格式无效`);
  return value;
}

function timestamp(value, field, nullable = false) {
  const result = text(value, field, nullable);
  if (result !== null && Number.isNaN(Date.parse(result))) {
    throw new ProactiveExplanationContractError(`${field} 格式无效`);
  }
  return result;
}

function availability(value, fields, field) {
  const item = object(value, field);
  if (typeof item.available !== "boolean") throw new ProactiveExplanationContractError(`${field}.available 格式无效`);
  const result = { available: item.available };
  for (const [name, kind] of fields) {
    if (!item.available && item[name] != null) {
      throw new ProactiveExplanationContractError(`${field}.${name} 必须为空`);
    }
    result[name] = kind === "timestamp"
      ? timestamp(item[name], `${field}.${name}`, !item.available)
      : text(item[name], `${field}.${name}`, !item.available);
  }
  return Object.freeze(result);
}

function mapPublicExplanation(value) {
  const input = object(value, "explanation");
  const delivery = object(input.delivery, "delivery");
  if (!DELIVERY_STATUSES.includes(delivery.status)) {
    throw new ProactiveExplanationContractError("delivery.status 格式无效");
  }
  const expectedSummary = SUMMARY_CODES[delivery.status];
  if (input.summaryCode !== expectedSummary) {
    throw new ProactiveExplanationContractError("summaryCode 格式无效");
  }
  if (!Number.isSafeInteger(delivery.attemptCount) || delivery.attemptCount < 0) {
    throw new ProactiveExplanationContractError("delivery.attemptCount 格式无效");
  }
  const feedback = input.feedback == null ? null : object(input.feedback, "feedback");
  if (feedback && !FEEDBACK_TYPES.includes(feedback.feedbackType)) {
    throw new ProactiveExplanationContractError("feedback.feedbackType 格式无效");
  }
  const wakeDecision = availability(input.wakeDecision, [
    ["decision", "text"], ["reasonCode", "text"]
  ], "wakeDecision");
  if (wakeDecision.available) throw new ProactiveExplanationContractError("wakeDecision 尚不可用");

  return Object.freeze({
    deliveryId: normalizeDeliveryId(input.deliveryId),
    summaryCode: expectedSummary,
    delivery: Object.freeze({
      status: delivery.status,
      channel: text(delivery.channel, "delivery.channel"),
      reasonCode: text(delivery.reasonCode, "delivery.reasonCode"),
      attemptCount: delivery.attemptCount,
      createdAt: timestamp(delivery.createdAt, "delivery.createdAt"),
      sentAt: timestamp(delivery.sentAt, "delivery.sentAt", true),
      failedAt: timestamp(delivery.failedAt, "delivery.failedAt", true),
      lastErrorCode: text(delivery.lastErrorCode, "delivery.lastErrorCode", true)
    }),
    aiJob: availability(input.aiJob, [["id", "text"], ["status", "text"]], "aiJob"),
    triggerEvent: availability(input.triggerEvent, [
      ["eventType", "text"], ["occurredAt", "timestamp"]
    ], "triggerEvent"),
    wakeDecision,
    feedback: feedback ? Object.freeze({
      feedbackType: feedback.feedbackType,
      createdAt: timestamp(feedback.createdAt, "feedback.createdAt")
    }) : null
  });
}

function createPublicExplanation({ delivery, aiJob, triggerEvent, feedback } = {}) {
  const item = object(delivery, "delivery");
  return mapPublicExplanation({
    deliveryId: item.id,
    summaryCode: SUMMARY_CODES[item.status],
    delivery: item,
    aiJob,
    triggerEvent,
    wakeDecision: { available: false, decision: null, reasonCode: null },
    feedback
  });
}

module.exports = {
  DELIVERY_STATUSES,
  FEEDBACK_TYPES,
  MAX_DELIVERY_ID_LENGTH,
  PROACTIVE_EXPLANATION_INPUT_SCHEMA,
  PROACTIVE_EXPLANATION_TOOL_NAME,
  ProactiveExplanationContractError,
  SUMMARY_CODES,
  createPublicExplanation,
  mapPublicExplanation,
  normalizeDeliveryId
};
