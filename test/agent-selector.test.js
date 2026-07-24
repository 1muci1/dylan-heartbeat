"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { AgentProfileRegistry } = require("../agent-profile-registry");
const { AgentSelector } = require("../agent-selector");

function fixture() {
  const registry = new AgentProfileRegistry();
  return { registry, selector: new AgentSelector({ profileRegistry: registry }) };
}

test("creative and Companion tasks select chen through Profile capabilities", () => {
  const { selector } = fixture();
  const result = selector.select({ task: "Create a companion story with relationship memory." });

  assert.deepEqual(result.agents, ["chen"]);
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /memory_context/);
  assert.match(result.reasons[0], /companion|story|relationship|memory/);
});

test("technical planning tasks select chatgpt", () => {
  const { selector } = fixture();
  const result = selector.select({ task: "Analyze the engineering architecture and planning risks." });

  assert.deepEqual(result.agents, ["chatgpt"]);
  assert.match(result.reasons[0], /independent_context/);
  assert.match(result.reasons[0], /analysis|planning|architecture|engineering/);
});

test("combined creative and architecture tasks select both Agents in Profile order", () => {
  const { selector } = fixture();
  const result = selector.select({
    task: "Design a creative companion story and analyze its software architecture."
  });

  assert.deepEqual(result.agents, ["chen", "chatgpt"]);
  assert.equal(result.reasons.length, 2);
});

test("unknown tasks return both default discussion Agents", () => {
  const { selector } = fixture();
  const result = selector.select({ task: "Discuss this topic together." });

  assert.deepEqual(result.agents, ["chen", "chatgpt"]);
  assert.ok(result.reasons.every(reason => reason.includes("discussion")));
});

test("selection reads isolated Profile copies without modifying Registry state", () => {
  const { registry, selector } = fixture();
  const before = registry.list();

  selector.select({ task: "memory architecture" });

  assert.deepEqual(registry.list(), before);
  assert.equal(registry.get("chen").memoryAccess, true);
  assert.equal(registry.get("chatgpt").memoryAccess, false);
});

test("Selector has no model, Room, Memory mutation, Identity, network, or database integration", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "agent-selector.js"), "utf8");

  assert.doesNotMatch(
    source,
    /ModelAdapter|createRoom|CollaborationRuntime|MemoryWriter|StructuredMemoryStore|IdentityBoundary|fetch\s*\(|database|migration/i
  );
  assert.doesNotMatch(source, /\.(?:register|create|update|delete|archive)\s*\(/);
});
