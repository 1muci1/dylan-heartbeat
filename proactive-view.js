"use strict";

const TIMELINE_TYPES = new Set([
  "delivery.created", "delivery.sent", "delivery.failed", "delivery.retry_scheduled", "preference.changed"
]);

function stateValue(states, key) {
  return states.find(item => item?.stateKey === key)?.value;
}

function publicDelivery(item) {
  return { id: item.id, channel: item.channel, status: item.status, reasonCode: item.reasonCode,
    createdAt: item.createdAt, sentAt: item.sentAt };
}

class ProactiveView {
  constructor({ deliveryStore, stateStore, relationshipView, eventStore, feedbackStore = null } = {}) {
    if (!deliveryStore || typeof deliveryStore.list !== "function") throw new TypeError("deliveryStore 必填");
    if (!stateStore || typeof stateStore.list !== "function") throw new TypeError("stateStore 必填");
    if (!relationshipView || typeof relationshipView.get !== "function") throw new TypeError("relationshipView 必填");
    if (!eventStore || typeof eventStore.list !== "function") throw new TypeError("eventStore 必填");
    this.deliveryStore = deliveryStore;
    this.stateStore = stateStore;
    this.relationshipView = relationshipView;
    this.eventStore = eventStore;
    if (feedbackStore && typeof feedbackStore.list !== "function") throw new TypeError("feedbackStore 无效");
    this.feedbackStore = feedbackStore;
  }

  getOverview() {
    const recent = this.deliveryStore.list({ page: 1, limit: 5, sort: "newest" });
    const pending = this.deliveryStore.list({ page: 1, limit: 1, status: "pending" });
    const failed = this.deliveryStore.list({ page: 1, limit: 1, status: "failed" });
    const states = this.stateStore.list("companion", "default");
    const relationship = this.relationshipView.get() || {};
    const timeline = this.eventStore.list({ page: 1, limit: 100, sort: "newest" }).items
      .filter(event => TIMELINE_TYPES.has(event.eventType));

    const enabledState = stateValue(states, "proactive_contact.enabled");
    const quietState = stateValue(states, "proactive_contact.quiet_hours");
    const relationshipHasState = relationship.proactiveContact?.source === "state";
    const enabled = typeof enabledState === "boolean" ? enabledState
      : relationshipHasState && typeof relationship.proactiveContact?.enabled === "boolean" ? relationship.proactiveContact.enabled : true;
    const quietHours = quietState && typeof quietState === "object" && !Array.isArray(quietState)
      ? { start: quietState.start, end: quietState.end }
      : relationshipHasState && relationship.proactiveContact?.quietHours
        ? relationship.proactiveContact.quietHours : { start: "23:00", end: "08:00" };
    const sentEvent = timeline.find(event => event.eventType === "delivery.sent");
    const reasonEvent = timeline.find(event => typeof event.payload?.reasonCode === "string");
    const sentDelivery = recent.items.find(item => item.status === "sent" && item.sentAt);
    const reasonDelivery = recent.items.find(item => typeof item.reasonCode === "string" && item.reasonCode);
    const feedbackSummary = {};
    if (this.feedbackStore) {
      for (const type of ["liked", "dismissed", "not_relevant", "disable_future"]) {
        const count = this.feedbackStore.list({ page: 1, limit: 1, feedbackType: type }).meta.total;
        if (count > 0) feedbackSummary[type] = count;
      }
    }

    return {
      enabled,
      quietHours: { start: quietHours.start, end: quietHours.end },
      recentDeliveries: recent.items.slice(0, 5).map(publicDelivery),
      pendingCount: pending.meta.total,
      failedCount: failed.meta.total,
      lastContactAt: sentEvent?.occurredAt || sentDelivery?.sentAt || null,
      lastReasonCode: reasonEvent?.payload?.reasonCode || reasonDelivery?.reasonCode || null,
      feedbackSummary
    };
  }
}

module.exports = { ProactiveView, TIMELINE_TYPES, publicDelivery };
