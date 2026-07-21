"use strict";

const { BarkPushAdapter } = require("./bark-push-adapter");
const { DeliveryRetryPolicy } = require("./delivery-retry-policy");

class ProactiveDeliveryWorker {
  constructor({ deliveryStore, pushAdapter = new BarkPushAdapter(), retryPolicy = new DeliveryRetryPolicy(), eventStore = null, logger = null, batchSize = 10 } = {}) {
    if (!deliveryStore) throw new TypeError("deliveryStore 必填");
    if (!pushAdapter || typeof pushAdapter.send !== "function") throw new TypeError("pushAdapter.send 必填");
    this.deliveryStore = deliveryStore;
    this.pushAdapter = pushAdapter;
    this.retryPolicy = retryPolicy;
    this.eventStore = eventStore;
    this.logger = logger;
    this.batchSize = batchSize;
  }

  recordEvent(input) {
    if (!this.eventStore) return null;
    try {
      return this.eventStore.create(input, { source: "proactive-delivery-worker" });
    } catch (error) {
      if (error?.code !== "EVENT_DUPLICATE") {
        this.logger?.error?.({ errorCode: error?.code, eventType: input.eventType, deliveryId: input.subjectId }, "Delivery Event 写入失败");
      }
      return null;
    }
  }

  async process(delivery) {
    if (!delivery || typeof delivery !== "object") throw new TypeError("delivery 必填");
    if (delivery.status === "sent") {
      const error = new Error("Delivery 已发送");
      error.code = "DELIVERY_ALREADY_SENT";
      throw error;
    }
    if (delivery.status !== "sending") {
      const error = new Error("Delivery 未被领取");
      error.code = "DELIVERY_NOT_CLAIMED";
      throw error;
    }

    this.recordEvent({
      eventType: "delivery.created", subjectType: "delivery", subjectId: delivery.id,
      payload: { deliveryId: delivery.id, channel: delivery.channel, attemptCount: delivery.attemptCount },
      dedupeKey: `delivery:${delivery.id}:created`, occurredAt: delivery.createdAt
    });

    let outcome;
    try {
      outcome = await this.pushAdapter.send({ ...delivery });
    } catch {
      outcome = { success: false, reasonCode: "PUSH_FAILED" };
    }

    if (outcome?.success === true) {
      const sent = this.deliveryStore.markSent(delivery.id);
      this.recordEvent({
        eventType: "delivery.sent", subjectType: "delivery", subjectId: delivery.id,
        payload: { deliveryId: delivery.id, channel: delivery.channel, attemptCount: sent.attemptCount },
        dedupeKey: `delivery:${delivery.id}:sent`, occurredAt: sent.sentAt
      });
      return { delivery: sent, success: true };
    }

    const reasonCode = typeof outcome?.reasonCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.reasonCode)
      ? outcome.reasonCode : "PUSH_FAILED";
    const failed = this.deliveryStore.markFailed(delivery.id, reasonCode);
    this.recordEvent({
      eventType: "delivery.failed", subjectType: "delivery", subjectId: delivery.id,
      payload: { deliveryId: delivery.id, channel: delivery.channel, reasonCode },
      dedupeKey: `delivery:${delivery.id}:failed:${failed.attemptCount}`, occurredAt: failed.failedAt
    });
    const retryDecision = this.retryPolicy.evaluate(failed);
    if (retryDecision.retry) {
      const scheduled = this.deliveryStore.scheduleRetry(delivery.id, {
        nextRetryAt: retryDecision.nextRetryAt,
        lastErrorCode: reasonCode
      });
      this.recordEvent({
        eventType: "delivery.retry_scheduled", subjectType: "delivery", subjectId: delivery.id,
        payload: { deliveryId: delivery.id, attemptCount: scheduled.attemptCount, nextRetryAt: scheduled.nextRetryAt, reasonCode },
        dedupeKey: `delivery:${delivery.id}:retry:${scheduled.attemptCount}`, occurredAt: failed.failedAt
      });
      return { delivery: scheduled, success: false, reasonCode, retryScheduled: true };
    }
    return { delivery: failed, success: false, reasonCode };
  }

  async runOnce(limit = this.batchSize) {
    const deliveries = this.deliveryStore.claimPending(limit);
    const results = [];
    for (const delivery of deliveries) results.push(await this.process(delivery));
    return results;
  }

  async processPending(limit = this.batchSize) {
    return this.runOnce(limit);
  }
}

module.exports = { ProactiveDeliveryWorker };
