"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { openDatabase } = require("../database");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { MemorySeedPreviewRegistry } = require("../memory-seed-preview");
const { MemorySeedCommitter } = require("../memory-seed-commit");

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "memory-seed-commit-"));
  const connection = openDatabase(path.join(dir, "database.sqlite"));
  t.after(async () => {
    connection.db.close();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  const store = new StructuredMemoryStore({ database: connection.db });
  const registry = new MemorySeedPreviewRegistry();
  return { database: connection.db, store, registry };
}

function seed(memories, seedId = "commit-seed") {
  return { schemaVersion: 1, seedId, mode: "merge", source: "manual-seed", reviewed: false, memories };
}

const memories = [
  { type: "MEMORY", title: "偏好", content: "用户重视人工审核记忆。", importance: 5, source: "manual-seed" },
  { type: "MEMORY", title: "目标", content: "用户持续建设长期记忆能力。", importance: 4, source: "manual-seed" }
];

test("preview then commit creates approved memories and repeated commit is idempotent", async t => {
  const { database, store, registry } = await fixture(t);
  let createCalls = 0;
  const originalCreate = store.create.bind(store);
  store.create = input => { createCalls++; return originalCreate(input); };
  const preview = registry.create(seed(memories), database);
  const committer = new MemorySeedCommitter({ store, previewRegistry: registry });
  const input = { seedId: preview.seedId, previewId: preview.previewId, approvedItemIds: preview.items.map(item => item.id) };
  const before = Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count);

  const first = committer.commit(input);
  assert.equal(first.created, 2);
  assert.equal(first.skipped, 0);
  assert.deepEqual(first.results.map(item => item.status), ["created", "created"]);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), before + 2);
  assert.equal(createCalls, 2, "commit must use StructuredMemoryStore.create");
  assert.ok(database.prepare("SELECT id FROM memory_items WHERE source='manual-seed'").get());

  const second = committer.commit(input);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 2);
  assert.equal(second.duplicates.length, 2);
  assert.equal(second.failed.length, 0);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), before + 2);
});

test("commit skips content that became duplicate after preview", async t => {
  const { database, store, registry } = await fixture(t);
  const preview = registry.create(seed([memories[0]]), database);
  store.create(memories[0]);
  const result = new MemorySeedCommitter({ store, previewRegistry: registry }).commit({
    seedId: preview.seedId,
    previewId: preview.previewId,
    approvedItemIds: [preview.items[0].id]
  });
  assert.equal(result.created, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.duplicates[0].id, preview.items[0].id);
});

test("commit rejects invalid previewId and never calls a model", async t => {
  const { store, registry } = await fixture(t);
  const model = { calls: 0, generate() { this.calls++; throw new Error("model must not be called"); } };
  const committer = new MemorySeedCommitter({ store, previewRegistry: registry, model });
  assert.throws(() => committer.commit({ seedId: "missing", previewId: "missing", approvedItemIds: [] }), error => error.code === "MEMORY_SEED_PREVIEW_NOT_FOUND");
  assert.equal(model.calls, 0);
});

test("one item failure does not roll back successful items", async t => {
  const { database, store, registry } = await fixture(t);
  const preview = registry.create(seed(memories, "partial-seed"), database);
  const originalCreate = store.create.bind(store);
  store.create = input => {
    if (input.title === "目标") throw new Error("simulated item failure");
    return originalCreate(input);
  };
  const result = new MemorySeedCommitter({ store, previewRegistry: registry }).commit({
    seedId: preview.seedId,
    previewId: preview.previewId,
    approvedItemIds: preview.items.map(item => item.id)
  });
  assert.equal(result.created, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /simulated item failure/);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), 1);
});
