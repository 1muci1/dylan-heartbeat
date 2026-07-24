"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { AgentMemoryWriter } = require("../agent-memory-writer");
const { applyMigrations } = require("../database");
const { MemoryReviewQueue } = require("../memory-review-queue");
const {
  MemoryReviewService,
  MemoryReviewServiceError,
  REDACTED_TITLE
} = require("../memory-review-service");
const { StructuredMemoryStore } = require("../structured-memory-store");

function proposal(overrides = {}) {
  return {
    proposalId: "internal-proposal-1",
    category: "relationship",
    title: "互动关系",
    content: "用户明确确认了一项长期互动规则。",
    importance: 4,
    ...overrides
  };
}

function fakeWriter(implementation) {
  const calls = [];
  return {
    calls,
    create(input) {
      calls.push(input);
      if (implementation) return implementation(input);
      return { id: `memory-${calls.length}` };
    }
  };
}

function fixture({ writer = fakeWriter() } = {}) {
  const queue = new MemoryReviewQueue({ writer });
  queue.submit({ status: "needs_review", proposal: proposal() });
  const service = new MemoryReviewService({
    queue,
    idFactory: () => "review-public-1"
  });
  return { queue, service, writer };
}

test("pending proposals are listed as metadata without content or internal IDs", () => {
  const { service } = fixture();
  const items = service.list();

  assert.deepEqual(items, [{
    id: "review-public-1",
    category: "relationship",
    title: "互动关系",
    importance: 4,
    status: "pending"
  }]);
  assert.equal(Object.hasOwn(items[0], "content"), false);
  assert.equal(Object.hasOwn(items[0], "proposalId"), false);
});

test("sensitive pending metadata is hidden defensively", () => {
  const writer = fakeWriter();
  const queue = new MemoryReviewQueue({ writer });
  queue.submit({
    status: "needs_review",
    proposal: proposal({
      proposalId: "sensitive-pending",
      title: "Bearer token candidate"
    })
  });
  const service = new MemoryReviewService({
    queue,
    idFactory: () => "review-sensitive"
  });
  const [item] = service.list();

  assert.equal(item.title, REDACTED_TITLE);
  assert.equal(Object.hasOwn(item, "content"), false);
});

test("approve creates Memory through the existing Writer", () => {
  const { queue, service, writer } = fixture();
  const [{ id }] = service.list();
  const result = service.approve(id);

  assert.deepEqual(result, { id, status: "approved" });
  assert.equal(writer.calls.length, 1);
  assert.deepEqual(writer.calls[0], {
    category: "relationship",
    title: "互动关系",
    content: "用户明确确认了一项长期互动规则。",
    importance: 4
  });
  assert.deepEqual(queue.listPending(), []);
});

test("reject removes pending without creating Memory", () => {
  const { queue, service, writer } = fixture();
  const [{ id }] = service.list();
  const result = service.reject(id);

  assert.deepEqual(result, { id, status: "rejected" });
  assert.equal(writer.calls.length, 0);
  assert.deepEqual(queue.listPending(), []);
});

test("Writer failure returns a safe result and leaves pending available", () => {
  const { service, writer } = fixture({
    writer: fakeWriter(() => {
      throw new Error("private database failure");
    })
  });
  const [{ id }] = service.list();
  const result = service.approve(id);

  assert.deepEqual(result, {
    id,
    status: "failed",
    reasonCode: "MEMORY_WRITE_FAILED"
  });
  assert.equal(writer.calls.length, 1);
  assert.deepEqual(service.list().map(item => item.id), [id]);
  assert.equal(Object.hasOwn(result, "proposal"), false);
});

test("Service exposes no Memory update, delete, or archive capability", () => {
  const { service } = fixture();
  assert.equal(service.update, undefined);
  assert.equal(service.delete, undefined);
  assert.equal(service.archive, undefined);
  assert.equal(service.database, undefined);
  assert.equal(service.store, undefined);
  assert.equal(service.writer, undefined);
});

test("approving adds one Memory without changing existing Memory", t => {
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
  const snapshot = store.get(existing.id);
  const queue = new MemoryReviewQueue({
    writer: new AgentMemoryWriter({ store })
  });
  queue.submit({ status: "needs_review", proposal: proposal() });
  const service = new MemoryReviewService({
    queue,
    idFactory: () => "review-public-existing"
  });

  service.approve(service.list()[0].id);

  assert.deepEqual(store.get(existing.id), snapshot);
  assert.equal(store.list({ status: "active", limit: 100 }).meta.total, 2);
});

test("unknown review IDs fail without exposing pending details", () => {
  const { service } = fixture();
  assert.throws(
    () => service.approve("review-missing"),
    error => error instanceof MemoryReviewServiceError &&
      error.code === "MEMORY_REVIEW_NOT_FOUND"
  );
});
