"use strict";

const RETRYABLE_ERRORS = new Set([
  "BARK_NETWORK_ERROR",
  "BARK_TIMEOUT",
  "BARK_PROVIDER_ERROR",
  "BARK_RATE_LIMITED"
]);

const BACKOFF_MINUTES = Object.freeze([1, 5, 30]);

class DeliveryRetryPolicy {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
  }

  evaluate(delivery) {
    if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return { retry: false, reasonCode: "DELIVERY_INVALID" };
    const status = delivery.status;
    if (status === "sent") return { retry: false, reasonCode: "ALREADY_SENT" };
    if (status === "cancelled") return { retry: false, reasonCode: "CANCELLED" };
    if (status !== "failed") return { retry: false, reasonCode: "NOT_FAILED" };

    const attemptCount = Number(delivery.attemptCount ?? delivery.attempt_count ?? 0);
    const maxAttemptCount = Number(delivery.maxAttemptCount ?? delivery.max_attempt_count ?? 3);
    if (!Number.isInteger(attemptCount) || !Number.isInteger(maxAttemptCount) || attemptCount < 0 || maxAttemptCount < 1) {
      return { retry: false, reasonCode: "DELIVERY_INVALID" };
    }
    if (attemptCount >= maxAttemptCount) return { retry: false, reasonCode: "MAX_ATTEMPTS_REACHED" };

    const errorCode = delivery.lastErrorCode ?? delivery.last_error_code;
    if (!RETRYABLE_ERRORS.has(errorCode)) return { retry: false, reasonCode: errorCode || "ERROR_NOT_RETRYABLE" };

    const now = this.clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { retry: false, reasonCode: "TIME_INVALID" };
    const minutes = BACKOFF_MINUTES[Math.min(Math.max(attemptCount - 1, 0), BACKOFF_MINUTES.length - 1)];
    return { retry: true, nextRetryAt: new Date(now.getTime() + minutes * 60000).toISOString() };
  }
}

module.exports = { DeliveryRetryPolicy, RETRYABLE_ERRORS, BACKOFF_MINUTES };
