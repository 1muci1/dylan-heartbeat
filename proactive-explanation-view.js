"use strict";

const SUMMARY_CODES = Object.freeze({
  pending: "DELIVERY_PENDING",
  sending: "DELIVERY_SENDING",
  sent: "DELIVERY_SENT",
  failed: "DELIVERY_FAILED",
  cancelled: "DELIVERY_CANCELLED"
});

class ProactiveExplanationError extends Error {
  constructor(message, statusCode = 400, code = "PROACTIVE_EXPLANATION_INVALID") {
    super(message);
    this.name = "ProactiveExplanationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function deliveryId(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) {
    throw new ProactiveExplanationError("deliveryId 格式无效");
  }
  return value.trim();
}

function unavailable(fields) {
  return Object.freeze({ available: false, ...fields });
}

function optionalRead(read, notFoundCode, map, fallback) {
  try {
    return map(read());
  } catch (error) {
    if (error?.code === notFoundCode) return fallback;
    throw error;
  }
}

class ProactiveExplanationView {
  constructor({ deliveryStore, aiJobStore = null, eventStore = null, feedbackStore = null } = {}) {
    if (!deliveryStore || typeof deliveryStore.get !== "function") throw new TypeError("deliveryStore 必填");
    if (aiJobStore && typeof aiJobStore.getJob !== "function") throw new TypeError("aiJobStore 无效");
    if (eventStore && typeof eventStore.get !== "function") throw new TypeError("eventStore 无效");
    if (feedbackStore && typeof feedbackStore.getForDelivery !== "function") throw new TypeError("feedbackStore 无效");
    this.deliveryStore = deliveryStore;
    this.aiJobStore = aiJobStore;
    this.eventStore = eventStore;
    this.feedbackStore = feedbackStore;
  }

  get(deliveryIdValue) {
    const id = deliveryId(deliveryIdValue);
    const delivery = this.deliveryStore.get(id);
    const aiJob = this.#aiJob(delivery.jobId);
    const triggerEvent = this.#event(delivery.eventId);
    const feedback = this.#feedback(id);
    const summaryCode = SUMMARY_CODES[delivery.status];
    if (!summaryCode) throw new ProactiveExplanationError("Delivery 状态不可解释", 500, "PROACTIVE_EXPLANATION_UNAVAILABLE");

    return Object.freeze({
      deliveryId: delivery.id,
      summaryCode,
      delivery: Object.freeze({
        status: delivery.status,
        channel: delivery.channel,
        reasonCode: delivery.reasonCode,
        attemptCount: delivery.attemptCount,
        createdAt: delivery.createdAt,
        sentAt: delivery.sentAt,
        failedAt: delivery.failedAt,
        lastErrorCode: delivery.lastErrorCode
      }),
      aiJob,
      triggerEvent,
      wakeDecision: unavailable({ decision: null, reasonCode: null }),
      feedback
    });
  }

  #aiJob(id) {
    const fallback = unavailable({ id: null, status: null });
    if (!this.aiJobStore || !id) return fallback;
    return optionalRead(() => this.aiJobStore.getJob(id), "AI_JOB_NOT_FOUND", job => Object.freeze({
      available: true,
      id: job.id,
      status: job.status
    }), fallback);
  }

  #event(id) {
    const fallback = unavailable({ eventType: null, occurredAt: null });
    if (!this.eventStore || !id) return fallback;
    return optionalRead(() => this.eventStore.get(id), "EVENT_NOT_FOUND", event => Object.freeze({
      available: true,
      eventType: event.eventType,
      occurredAt: event.occurredAt
    }), fallback);
  }

  #feedback(id) {
    if (!this.feedbackStore) return null;
    const feedback = this.feedbackStore.getForDelivery(id);
    return feedback ? Object.freeze({ feedbackType: feedback.feedbackType, createdAt: feedback.createdAt }) : null;
  }
}

module.exports = { ProactiveExplanationError, ProactiveExplanationView, SUMMARY_CODES, deliveryId };
