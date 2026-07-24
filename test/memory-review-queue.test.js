"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { AgentMemoryWriter } = require("../agent-memory-writer");
const { applyMigrations } = require("../database");
const { MemoryReviewQueue } = require("../memory-review-queue");
const { StructuredMemoryStore } = require("../structured-memory-store");

function proposal(overrides = {}) {
  return {
    proposalId: "proposal-1",
    category: "preference",
    title: "长期偏好",
    content: "用户明确表示：我一直喜欢简洁直接的回复。",
    importance: 3,
    ...overrides
  };
}

function fakeWriter() {
  const calls = [];
  return {
    calls,
    create(input) {
      calls.push(input);
      return { id: `memory-${calls.length}` };
    }
  };
}

test("approved preference is passed to Writer.create", () => {
  const writer = fakeWriter();
  const queue = new MemoryReviewQueue({ writer });
  const result = queue.submit({ status: "approved", proposal: proposal() });

  assert.deepEqual(result, {
    status: "created",
    proposalId: "proposal-1",
    memoryId: "memory-1"
  });
  assert.deepEqual(writer.calls, [{
    category: "preference",
    title: "长期偏好",
    content: "用户明确表示：我一直喜欢简洁直接的回复。",
    importance: 3
  }]);
  assert.deepEqual(queue.listPending(), []);
});

test("approved event is passed to Writer.create", () => {
  const writer = fakeWriter();
  const queue = new MemoryReviewQueue({ writer });
  const result = queue.submit({
    status: "approved",
    proposal: proposal({
      proposalId: "event-1",
      category: "event",
      title: "重要事件",
      content: "用户明确表示：我完成了重要项目。",
      importance: 4
    })
  });

  assert.equal(result.status, "created");
  assert.equal(writer.calls.length, 1);
  assert.equal(writer.calls[0].category, "event");
});

test("relationship requiring review enters pending without writing Memory", () => {
  const writer = fakeWriter();
  const queue = new MemoryReviewQueue({ writer });
  const input = proposal({
    proposalId: "relationship-1",
    category: "relationship",
    title: "互动关系",
    content: "用户明确确认了一项互动规则。",
    importance: 4
  });
  const result = queue.submit({ status: "needs_review", proposal: input });

  assert.equal(result.status, "pending");
  assert.deepEqual(queue.getPending(input.proposalId), input);
  assert.equal(writer.calls.length, 0);
});

test("rejected proposal is discarded and never retained or written", () => {
  const writer = fakeWriter();
  const queue = new MemoryReviewQueue({ writer });
  const input = proposal({ proposalId: "rejected-1" });

  queue.submit({ status: "needs_review", proposal: input });
  const result = queue.submit({ status: "rejected", proposal: input });

  assert.deepEqual(result, {
    status: "discarded",
    proposalId: "rejected-1"
  });
  assert.equal(queue.getPending(input.proposalId), null);
  assert.equal(writer.calls.length, 0);
});

test("Writer failures return a safe result without retaining proposal content", () => {
  const queue = new MemoryReviewQueue({
    writer: {
      create() {
        throw new Error("private writer failure");
      }
    }
  });
  const result = queue.submit({ status: "approved", proposal: proposal() });

  assert.deepEqual(result, {
    status: "failed",
    proposalId: "proposal-1",
    reasonCode: "MEMORY_WRITE_FAILED"
  });
  assert.equal(Object.hasOwn(result, "proposal"), false);
  assert.deepEqual(queue.listPending(), []);
});

test("Queue has no database or Memory mutation capability", () => {
  const queue = new MemoryReviewQueue({ writer: fakeWriter() });
  assert.equal(queue.database, undefined);
  assert.equal(queue.store, undefined);
  assert.equal(queue.create, undefined);
  assert.equal(queue.update, undefined);
  assert.equal(queue.delete, undefined);
  assert.equal(queue.archive, undefined);
});

test("Queue creates only the approved Memory and leaves existing Memory unchanged", t => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  const store = new StructuredMemoryStore({ database });
  const existing = store.create({
    type: "MEMORY",
    title: "Existing",
    content: "Existing Memory remains unchanged.",
    source: "manual",
    importance: 3
  });
  const existingSnapshot = store.get(existing.id);
  const queue = new MemoryReviewQueue({
    writer: new AgentMemoryWriter({ store })
  });

  const result = queue.submit({ status: "approved", proposal: proposal() });

  assert.equal(result.status, "created");
  assert.deepEqual(store.get(existing.id), existingSnapshot);
  assert.equal(store.list({ status: "active", limit: 100 }).meta.total, 2);
});
