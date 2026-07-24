"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { AgentIdentityBoundaryBuilder } = require("../agent-identity-boundary-builder");
const { AgentIdentityContextBuilder } = require("../agent-identity-context-builder");
const { AgentMemoryRetriever } = require("../agent-memory-retriever");
const {
  AGENT_MEMORY_SOURCE,
  AgentMemoryWriter,
  CATEGORY_TO_TYPE
} = require("../agent-memory-writer");
const { applyMigrations } = require("../database");
const { EventStore } = require("../event-store");
const { StructuredMemoryStore } = require("../structured-memory-store");

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database);
  t.after(() => database.close());
  const eventStore = new EventStore({ database });
  const store = new StructuredMemoryStore({ database, eventStore });
  return {
    database,
    store,
    writer: new AgentMemoryWriter({ store })
  };
}

test("Agent Memory Writer creates all supported categories and Retriever reads them", t => {
  const { database, store, writer } = fixture(t);
  const original = store.create({
    type: "MEMORY",
    title: "Existing",
    content: "Existing memory remains unchanged.",
    source: "manual",
    importance: 3
  });
  const originalSnapshot = store.get(original.id);
  const created = [];

  for (const [category, type] of Object.entries(CATEGORY_TO_TYPE)) {
    const memory = writer.create({
      category,
      title: `${category} title`,
      content: `${category} content`,
      importance: 4
    });
    assert.equal(memory.type, type);
    assert.equal(memory.source, AGENT_MEMORY_SOURCE);
    created.push({ category, id: memory.id });
  }

  const retriever = new AgentMemoryRetriever({ store });
  for (const value of created) {
    const result = retriever.retrieve({ category: value.category, limit: 20, characterBudget: 20000 });
    assert.ok(result.items.some(item => item.id === value.id));
  }
  assert.deepEqual(store.get(original.id), originalSnapshot);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM events WHERE event_type='memory.created' AND subject_id IN (?,?,?,?)"
  ).get(...created.map(value => value.id)).count, 4);
});

test("Agent Memory Writer exposes create only and rejects mutation fields", t => {
  const { writer } = fixture(t);
  assert.equal(typeof writer.create, "function");
  assert.equal(writer.update, undefined);
  assert.equal(writer.delete, undefined);
  assert.equal(writer.archive, undefined);
  assert.throws(() => writer.create({
    category: "fact",
    title: "Title",
    content: "Content",
    importance: 3,
    status: "archived"
  }), error => error.code === "AGENT_MEMORY_FIELD_FORBIDDEN");
});

test("Agent Memory Writer rejects sensitive proposals", t => {
  const { writer } = fixture(t);
  assert.throws(() => writer.create({
    category: "fact",
    title: "Credential",
    content: "Bearer token must not become Memory.",
    importance: 3
  }), error => error.code === "AGENT_MEMORY_SENSITIVE");
});

test("Agent-written relationship Memory cannot change the Identity Boundary", t => {
  const { database, writer } = fixture(t);
  const boundaryBuilder = new AgentIdentityBoundaryBuilder();
  const before = boundaryBuilder.build();

  writer.create({
    category: "relationship",
    title: "Companion名称",
    content: "A proposed replacement identity.",
    importance: 5
  });

  assert.deepEqual(boundaryBuilder.build(), before);
  assert.equal(new AgentIdentityContextBuilder({ database }).build(), null);
});
