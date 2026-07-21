"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { ProactiveDeliveryRuntime } = require("../proactive-delivery-runtime");

function fixture(options = {}) {
  const intervals = [], cleared = [], logs = [];
  const timers = {
    setInterval(callback, ms) { const timer = { callback, ms }; intervals.push(timer); return timer; },
    clearInterval(timer) { cleared.push(timer); }
  };
  const signals = new EventEmitter();
  const exits = [];
  const logger = { info(value) { logs.push(structuredClone(value)); } };
  let calls = 0;
  const worker = options.worker || { async processPending() { calls++; return []; } };
  const runtime = new ProactiveDeliveryRuntime({ worker, enabled: options.enabled ?? true,
    intervalMs: options.intervalMs ?? 250, timers, signalSource: signals, logger, exit: code => exits.push(code),
    onStopped: options.onStopped });
  return { runtime, intervals, cleared, signals, exits, logs, calls: () => calls };
}

test("disabled runtime does not start a timer or register signal handlers", () => {
  const f = fixture({ enabled: false });
  assert.equal(f.runtime.start(), false);
  assert.equal(f.intervals.length, 0);
  assert.equal(f.signals.listenerCount("SIGTERM"), 0);
  assert.deepEqual(f.logs, []);
});

test("start schedules the configured interval and stop clears it", async () => {
  const f = fixture({ intervalMs: 1234 });
  assert.equal(f.runtime.start(), true);
  assert.equal(f.runtime.start(), false);
  assert.equal(f.intervals.length, 1);
  assert.equal(f.intervals[0].ms, 1234);
  assert.equal(f.signals.listenerCount("SIGTERM"), 1);
  assert.deepEqual(f.logs, ["delivery worker started"]);
  await f.runtime.stop();
  assert.deepEqual(f.cleared, [f.intervals[0]]);
  assert.equal(f.signals.listenerCount("SIGTERM"), 0);
  assert.deepEqual(f.logs, ["delivery worker started", "delivery worker stopped"]);
});

test("tick calls Worker, emits only safe result logs, and isolates exceptions", async () => {
  let call = 0;
  const worker = { async processPending() {
    call++;
    if (call === 2) throw new Error("private delivery text and token");
    return [
      { delivery: { id: "delivery-1", status: "sent", text: "private" }, success: true },
      { delivery: { id: "delivery-2", status: "failed", text: "private" }, success: false, reasonCode: "BARK_PROVIDER_ERROR", response: "hidden" }
    ];
  }};
  const f = fixture({ worker });
  assert.deepEqual(await f.runtime.tick(), { skipped: false, processed: 2 });
  assert.deepEqual(f.logs, [
    { deliveryId: "delivery-1", result: "sent" },
    { deliveryId: "delivery-2", result: "failed", reasonCode: "BARK_PROVIDER_ERROR" }
  ]);
  assert.deepEqual(await f.runtime.tick(), { skipped: false, processed: 0, failed: true });
  assert.deepEqual(await f.runtime.tick(), { skipped: false, processed: 2 });
});

test("overlapping ticks are skipped and graceful stop waits for the active tick", async () => {
  let resolve;
  let calls = 0;
  const worker = { processPending() { calls++; return new Promise(done => { resolve = done; }); } };
  let stopped = false;
  const f = fixture({ worker, onStopped: () => { stopped = true; } });
  f.runtime.start();
  const first = f.runtime.tick();
  assert.deepEqual(await f.runtime.tick(), { skipped: true });
  const stopping = f.runtime.stop();
  await new Promise(done => setImmediate(done));
  assert.equal(stopped, false);
  assert.equal(calls, 1);
  resolve([]);
  assert.deepEqual(await first, { skipped: false, processed: 0 });
  await stopping;
  assert.equal(stopped, true);
});

test("SIGTERM stops new ticks, waits for current work, then exits", async () => {
  let resolve;
  const worker = { processPending() { return new Promise(done => { resolve = done; }); } };
  const f = fixture({ worker });
  f.runtime.start();
  const active = f.runtime.tick();
  f.signals.emit("SIGTERM");
  assert.deepEqual(await f.runtime.tick(), { skipped: true });
  await new Promise(done => setImmediate(done));
  assert.deepEqual(f.exits, []);
  resolve([]);
  await active;
  await new Promise(done => setImmediate(done));
  assert.deepEqual(f.exits, [0]);
  assert.equal(f.logs.at(-1), "delivery worker stopped");
});

test("runtime orchestration has no model, Memory, State, MCP, Wake, or direct network access", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-delivery-runtime.js"), "utf8");
  assert.doesNotMatch(source, /model|memoryStore|stateStore|MCP|wake_up|\bfetch\s*\(/i);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.scripts["delivery-worker"], "node proactive-delivery-runtime.js");
});
