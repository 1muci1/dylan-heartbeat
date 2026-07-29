"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { AgentMemoryRetriever } = require("../agent-memory-retriever");
const { applyMigrations } = require("../database");
const {
  MAX_IMPORT_ITEMS,
  MEMORY_IMPORT_FORMAT,
  createMemoryImportSourceMarker,
  parseMemoryImportDocument
} = require("../memory-import-contract");
const { MemoryImportCommitService } = require("../memory-import-commit");
const { MemoryImportPreviewService } = require("../memory-import-preview");
const { StructuredMemoryStore } = require("../structured-memory-store");

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  const store = new StructuredMemoryStore({ database });
  return { database, store };
}

function item(overrides = {}) {
  return {
    externalId: "memory-1",
    category: "fact",
    title: "长期项目",
    content: "用户正在持续开发 AI Companion Runtime。",
    importance: 4,
    occurredAt: null,
    ...overrides
  };
}

function document(items = [item()], overrides = {}) {
  return {
    format: MEMORY_IMPORT_FORMAT,
    importId: "runtime-import-1",
    mode: "merge",
    source: { kind: "user_export", sourceId: "personal-backup" },
    items,
    ...overrides
  };
}

test("Memory Import v1 contract normalizes four categories and creates safe source markers", () => {
  const input = document([
    item({ externalId: "f", category: "fact" }),
    item({ externalId: "p", category: "preference" }),
    item({ externalId: "e", category: "event", occurredAt: "2026-07-20T10:00:00+08:00" }),
    item({ externalId: "r", category: "relationship" })
  ]);
  const parsed = parseMemoryImportDocument(input);
  assert.deepEqual(parsed.items.map(value => value.category), ["fact", "preference", "event", "relationship"]);
  assert.equal(parsed.items[2].occurredAt, "2026-07-20T02:00:00.000Z");
  assert.equal(createMemoryImportSourceMarker("preference", "personal-backup"), "memory-import:v1:preference:personal-backup");
  assert.equal(input.items[2].occurredAt, "2026-07-20T10:00:00+08:00", "contract must not mutate input");
});

test("Memory Import v1 is strict and rejects approval claims, unknown fields, invalid events, and oversized lists", () => {
  for (const field of ["approved", "reviewed", "trusted", "unexpected"]) {
    assert.throws(
      () => parseMemoryImportDocument(document([{ ...item(), [field]: true }])),
      error => error.code === "MEMORY_IMPORT_FIELD_FORBIDDEN"
    );
  }
  assert.throws(() => parseMemoryImportDocument(document([item()], { reviewed: true })), error => error.code === "MEMORY_IMPORT_FIELD_FORBIDDEN");
  assert.throws(() => parseMemoryImportDocument(document([item({ category: "event" })])), /occurredAt/);
  assert.throws(
    () => parseMemoryImportDocument(document(Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, index) => item({ externalId: `m-${index}` })))),
    error => error.code === "MEMORY_IMPORT_TOO_LARGE"
  );
  assert.throws(() => parseMemoryImportDocument(document([item({ content: "x".repeat(20001) })])), /content/);
});

test("preview is read-only, binds item hashes, detects duplicate, conflict, sensitive, and invalid", t => {
  const { database, store } = fixture(t);
  const duplicate = store.create({ type: "MEMORY", title: "已存在", content: "完全相同的内容", importance: 3 });
  const conflict = store.create({
    type: "MEMORY",
    title: "交流偏好",
    content: "用户偏好简洁回复。",
    importance: 4,
    source: createMemoryImportSourceMarker("preference", "existing")
  });
  const before = Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count);
  const service = new MemoryImportPreviewService({ store });
  const preview = service.create(document([
    item({ externalId: "ready", title: "新事实", content: "用户维护一个私人 Companion 项目。" }),
    item({ externalId: "duplicate", title: "重复", content: "完全相同的内容" }),
    item({ externalId: "conflict", category: "preference", title: "交流偏好", content: "用户偏好详细回复。" }),
    item({ externalId: "sensitive", title: "凭据", content: "API key: secret-value" }),
    item({ externalId: "invalid", category: "event", occurredAt: null })
  ]));
  assert.deepEqual(preview.items.map(value => value.decision), ["ready", "duplicate", "conflict", "sensitive", "invalid"]);
  assert.match(preview.items[0].itemHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.items[1].existingMemoryIds, [duplicate.id]);
  assert.deepEqual(preview.items[2].existingMemoryIds, [conflict.id]);
  assert.equal(Number(database.prepare("SELECT COUNT(*) count FROM memory_items").get().count), before);
  assert.equal(Object.hasOwn(service.getInternal(preview.previewId), "document"), false);
});

test("preview expires at its TTL and cannot be recovered", t => {
  const { store } = fixture(t);
  let now = Date.parse("2026-07-23T00:00:00.000Z");
  const service = new MemoryImportPreviewService({ store, ttlMs: 1000, clock: () => now });
  const preview = service.create(document());
  assert.equal(service.get(preview.previewId).previewId, preview.previewId);
  now += 1000;
  assert.throws(() => service.get(preview.previewId), error => error.code === "MEMORY_IMPORT_PREVIEW_EXPIRED");
});

test("commit accepts only ready hash-bound items and repeated commit is idempotent", t => {
  const { database, store } = fixture(t);
  let createCalls = 0;
  const createOptions = [];
  const originalCreate = store.create.bind(store);
  store.create = (input, options) => {
    createCalls++;
    createOptions.push(options);
    return originalCreate(input, options);
  };
  store.update = () => { throw new Error("commit must not call update"); };
  store.softDelete = () => { throw new Error("commit must not call softDelete"); };
  store.restore = () => { throw new Error("commit must not call restore"); };
  const previewService = new MemoryImportPreviewService({ store });
  const preview = previewService.create(document());
  const selected = [{ id: preview.items[0].id, itemHash: preview.items[0].itemHash }];
  const committer = new MemoryImportCommitService({ store, previewService });

  assert.throws(
    () => committer.commit({ previewId: preview.previewId, importId: preview.importId, approvedItems: [{ ...selected[0], itemHash: "0".repeat(64) }] }),
    error => error.code === "MEMORY_IMPORT_SELECTION_MISMATCH"
  );
  const first = committer.commit({ previewId: preview.previewId, importId: preview.importId, approvedItems: selected });
  assert.equal(first.created, 1);
  assert.equal(first.results[0].status, "created");
  assert.equal(createCalls, 1);
  assert.deepEqual(createOptions, [{ eventContext: { source: "memory-import-runtime" } }]);
  const row = database.prepare("SELECT source FROM memory_items WHERE id=?").get(first.results[0].memoryId);
  assert.equal(row.source, "memory-import:v1:fact:personal-backup");

  const second = committer.commit({ previewId: preview.previewId, importId: preview.importId, approvedItems: selected });
  assert.equal(second.created, 0);
  assert.equal(second.results[0].status, "already_committed");
  assert.equal(createCalls, 1);
});

test("commit rejects non-ready items and safely skips content that becomes duplicate or conflicting", t => {
  const { store } = fixture(t);
  const previewService = new MemoryImportPreviewService({ store });
  const sensitivePreview = previewService.create(document([item({ content: "password: secret" })], { importId: "sensitive-import" }));
  const committer = new MemoryImportCommitService({ store, previewService });
  assert.throws(
    () => committer.commit({
      previewId: sensitivePreview.previewId,
      importId: sensitivePreview.importId,
      approvedItems: [{ id: sensitivePreview.items[0].id, itemHash: sensitivePreview.items[0].itemHash }]
    }),
    error => error.code === "MEMORY_IMPORT_SELECTION_MISMATCH"
  );

  const duplicatePreview = previewService.create(document([item({ content: "稍后成为重复的内容" })], { importId: "duplicate-import" }));
  store.create({ type: "NOTE", title: "并发写入", content: "稍后成为重复的内容" });
  const duplicateResult = committer.commit({
    previewId: duplicatePreview.previewId,
    importId: duplicatePreview.importId,
    approvedItems: [{ id: duplicatePreview.items[0].id, itemHash: duplicatePreview.items[0].itemHash }]
  });
  assert.equal(duplicateResult.results[0].reasonCode, "MEMORY_IMPORT_DUPLICATE");

  const conflictPreview = previewService.create(document([
    item({ externalId: "preference-new", category: "preference", title: "输出风格", content: "用户偏好自然回复。" })
  ], { importId: "conflict-import" }));
  store.create({
    type: "MEMORY",
    title: "输出风格",
    content: "用户偏好简洁回复。",
    source: createMemoryImportSourceMarker("preference", "concurrent")
  });
  const conflictResult = committer.commit({
    previewId: conflictPreview.previewId,
    importId: conflictPreview.importId,
    approvedItems: [{ id: conflictPreview.items[0].id, itemHash: conflictPreview.items[0].itemHash }]
  });
  assert.equal(conflictResult.results[0].reasonCode, "MEMORY_IMPORT_CONFLICT");
});

test("Agent Memory Retriever returns only active categorized whitelist fields within limits and character budget", t => {
  const { store } = fixture(t);
  const fact = store.create({
    type: "MEMORY",
    title: "项目",
    content: "用户维护 Companion Runtime。",
    importance: 5,
    source: createMemoryImportSourceMarker("fact", "runtime")
  });
  store.create({
    type: "MEMORY",
    title: "风格",
    content: "用户偏好简洁回复。",
    importance: 4,
    source: createMemoryImportSourceMarker("preference", "runtime")
  });
  store.create({ type: "EVENT", title: "里程碑", content: "完成第一阶段。", occurredAt: "2026-07-20", importance: 3 });
  store.create({ type: "PROMISE", title: "约定", content: "重要修改前先确认。", importance: 3 });
  const archived = store.create({ type: "MEMORY", title: "归档", content: "归档内容不应检索", status: "archived" });
  const deleted = store.create({ type: "MEMORY", title: "删除", content: "删除内容不应检索" });
  store.softDelete(deleted.id);

  const retriever = new AgentMemoryRetriever({ store });
  const all = retriever.retrieve({ limit: 20, characterBudget: 1000 });
  assert.deepEqual(new Set(all.items.map(value => value.category)), new Set(["fact", "preference", "event", "relationship"]));
  assert.ok(all.items.some(value => value.id === fact.id && value.categorySource === "explicit"));
  assert.ok(!all.items.some(value => value.id === archived.id || value.id === deleted.id));
  const allowed = ["id", "layer", "category", "categorySource", "type", "title", "content", "importance", "occurredAt", "createdAt", "updatedAt"];
  for (const value of all.items) assert.deepEqual(Object.keys(value), allowed);
  assert.ok(all.items.every(value => !Object.hasOwn(value, "sourceSessionId") && !Object.hasOwn(value, "hash") && !Object.hasOwn(value, "deletedAt")));

  const preferences = retriever.retrieve({ category: "preference", limit: 1, characterBudget: 8 });
  assert.equal(preferences.items.length, 1);
  assert.equal(preferences.items[0].category, "preference");
  assert.ok(preferences.meta.usedCharacters <= 8);
});

test("Agent Memory Retriever reserves relationship and fact before preference and event", () => {
  const candidates = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `preference-${index}`,
      type: "MEMORY",
      title: `Preference ${index}`,
      content: "preferred",
      importance: 5,
      source: `memory-import:v1:preference:test-${index}`
    })),
    {
      id: "event-1",
      type: "EVENT",
      title: "Event",
      content: "event",
      importance: 5,
      source: "memory-import:v1:event:test"
    },
    {
      id: "relationship-1",
      type: "MEMORY",
      title: "Relationship",
      content: "relationship",
      importance: 1,
      source: "memory-import:v1:relationship:test"
    },
    {
      id: "fact-1",
      type: "MEMORY",
      title: "Fact",
      content: "fact",
      importance: 1,
      source: "memory-import:v1:fact:test"
    }
  ];
  const store = {
    list() {
      return { items: candidates, meta: { totalPages: 1 } };
    }
  };

  const result = new AgentMemoryRetriever({ store }).retrieve({ limit: 8, characterBudget: 3000 });
  const categories = result.items.map(item => item.category);

  assert.equal(result.items.length, 8);
  assert.ok(categories.includes("relationship"));
  assert.ok(categories.includes("fact"));
  assert.ok(categories.some(category => category === "preference" || category === "event"));
  assert.equal(categories[0], "relationship");
  assert.equal(categories[1], "fact");
  assert.ok(result.meta.usedCharacters <= 3000);
});

test("Agent Memory Retriever leaves empty stores empty", () => {
  const store = {
    list() {
      return { items: [], meta: { totalPages: 0 } };
    }
  };
  const result = new AgentMemoryRetriever({ store }).retrieve({ limit: 8, characterBudget: 3000 });
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.usedCharacters, 0);
});
