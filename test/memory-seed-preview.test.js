"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { applyMigrations } = require("../database");
const { StructuredMemoryStore } = require("../structured-memory-store");
const { parseSeedDocument, previewSeedDocument, previewSeedFile } = require("../memory-seed-preview");

const seedFile = path.join(__dirname, "..", "memory-seed-v1.json");

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  return { database, store: new StructuredMemoryStore({ database }) };
}

function seed(memories) {
  return { schemaVersion: 1, seedId: "test-seed", mode: "merge", source: "manual-seed", reviewed: false, memories };
}

const validMemory = {
  type: "MEMORY", title: "偏好", content: "用户偏好人工审核长期记忆。", importance: 5, source: "manual-seed"
};

test("legal Memory Seed v1 file parses and previews as ready", async t => {
  const { database } = fixture(t);
  const preview = await previewSeedFile(seedFile, database);
  assert.equal(preview.length, 4);
  assert.ok(preview.every(item => item.decision === "ready"));
  assert.deepEqual(Object.keys(preview[0]), ["id", "type", "title", "content", "importance", "occurredAt", "decision", "reason"]);
});

test("Memory Seed v1 rejects forbidden and unknown fields", () => {
  for (const field of ["id", "createdAt", "updatedAt", "contentHash", "deletedAt", "sourceSessionId", "unexpected"]) {
    assert.throws(() => parseSeedDocument(seed([{ ...validMemory, [field]: "forbidden" }])), error => error.code === "MEMORY_SEED_FIELD_FORBIDDEN");
  }
  assert.throws(() => parseSeedDocument({ ...seed([]), mode: "replace" }), /只允许 merge/);
});

test("preview detects duplicate content with the existing content hash logic", t => {
  const { database, store } = fixture(t);
  const existing = store.create(validMemory);
  const [item] = previewSeedDocument(seed([{ ...validMemory, content: "  用户偏好人工审核长期记忆。  " }]), database);
  assert.equal(item.decision, "duplicate");
  assert.match(item.reason, new RegExp(existing.id));
});

test("preview marks obvious secrets and device tokens as sensitive", t => {
  const { database } = fixture(t);
  const values = ["API key: abc", "token: abc", "password: abc", "cookie: abc", "private key: abc", "设备 token: abc"];
  for (const [index, content] of values.entries()) {
    const [item] = previewSeedDocument(seed([{ ...validMemory, title: `敏感项 ${index}`, content }]), database);
    assert.equal(item.decision, "sensitive", content);
  }
});

test("preview is read-only, does not call a model, and is deterministic", async t => {
  const { database } = fixture(t);
  const model = { calls: 0, generate() { this.calls++; throw new Error("model must not be called"); } };
  const before = Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count);
  const first = await previewSeedFile(seedFile, database, model);
  const second = await previewSeedFile(seedFile, database, model);
  const after = Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count);
  assert.equal(after, before);
  assert.equal(model.calls, 0);
  assert.deepEqual(second, first);
});

test("invalid memory values produce an invalid preview decision", t => {
  const { database } = fixture(t);
  const [item] = previewSeedDocument(seed([{ ...validMemory, importance: 9 }]), database);
  assert.equal(item.decision, "invalid");
  assert.match(item.reason, /importance/);
});
