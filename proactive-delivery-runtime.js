"use strict";

require("dotenv").config();

const { openDatabase } = require("./database");
const { DeliveryStore } = require("./delivery-store");
const { EventStore } = require("./event-store");
const { BarkPushAdapter } = require("./bark-push-adapter");
const { ProactiveDeliveryWorker } = require("./proactive-delivery-worker");

const DEFAULT_INTERVAL_MS = 60000;

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function intervalValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : DEFAULT_INTERVAL_MS;
}

class ProactiveDeliveryRuntime {
  constructor({
    worker,
    enabled = process.env.DELIVERY_WORKER_ENABLED,
    intervalMs = process.env.DELIVERY_WORKER_INTERVAL_MS,
    logger = console,
    timers = { setInterval, clearInterval },
    signalSource = process,
    exit = code => process.exit(code),
    onStopped = null
  } = {}) {
    if (!worker || typeof worker.processPending !== "function") throw new TypeError("worker.processPending 必填");
    this.worker = worker;
    this.enabled = typeof enabled === "boolean" ? enabled : booleanValue(enabled);
    this.intervalMs = intervalValue(intervalMs);
    this.logger = logger;
    this.timers = timers;
    this.signalSource = signalSource;
    this.exit = exit;
    this.onStopped = onStopped;
    this.timer = null;
    this.activeTick = null;
    this.started = false;
    this.stopping = false;
    this.signalHandler = () => { void this.stop().then(() => this.exit(0)); };
  }

  start() {
    if (!this.enabled || this.started) return false;
    this.started = true;
    this.stopping = false;
    this.signalSource?.on?.("SIGTERM", this.signalHandler);
    this.signalSource?.on?.("SIGINT", this.signalHandler);
    this.timer = this.timers.setInterval(() => { void this.tick(); }, this.intervalMs);
    this.logger?.info?.("delivery worker started");
    return true;
  }

  async tick() {
    if (!this.enabled || this.stopping) return { skipped: true };
    if (this.activeTick) return { skipped: true };
    const execution = (async () => {
      try {
        const results = await this.worker.processPending();
        for (const item of Array.isArray(results) ? results : []) {
          const result = item?.delivery?.status === "sent" ? "sent" : "failed";
          this.logger?.info?.({
            deliveryId: item?.delivery?.id,
            result,
            ...(result === "failed" && item?.reasonCode ? { reasonCode: item.reasonCode } : {})
          });
        }
        return { skipped: false, processed: Array.isArray(results) ? results.length : 0 };
      } catch {
        return { skipped: false, processed: 0, failed: true };
      }
    })();
    this.activeTick = execution;
    try {
      return await execution;
    } finally {
      if (this.activeTick === execution) this.activeTick = null;
    }
  }

  async stop() {
    if (this.stopping) {
      if (this.activeTick) await this.activeTick;
      return;
    }
    this.stopping = true;
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.signalSource?.off?.("SIGTERM", this.signalHandler);
    this.signalSource?.off?.("SIGINT", this.signalHandler);
    if (this.activeTick) await this.activeTick;
    if (this.started) {
      await this.onStopped?.();
      this.logger?.info?.("delivery worker stopped");
    }
    this.started = false;
  }
}

function createRuntime(env = process.env) {
  const connection = openDatabase(env.SESSION_DB_FILE || "./chat-sessions.sqlite");
  const deliveryStore = new DeliveryStore({
    database: connection.db,
    lockTimeoutMinutes: Number(env.DELIVERY_LOCK_TIMEOUT_MINUTES) || 10
  });
  const eventStore = new EventStore({ database: connection.db });
  const pushAdapter = new BarkPushAdapter();
  const worker = new ProactiveDeliveryWorker({ deliveryStore, eventStore, pushAdapter });
  const runtime = new ProactiveDeliveryRuntime({
    worker,
    enabled: env.DELIVERY_WORKER_ENABLED,
    intervalMs: env.DELIVERY_WORKER_INTERVAL_MS,
    onStopped: () => connection.db.close()
  });
  return { connection, runtime };
}

if (require.main === module) {
  const { connection, runtime } = createRuntime();
  if (!runtime.start()) connection.db.close();
}

module.exports = { DEFAULT_INTERVAL_MS, ProactiveDeliveryRuntime, booleanValue, createRuntime, intervalValue };
