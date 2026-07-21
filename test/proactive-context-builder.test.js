"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { ProactiveContextBuilder } = require("../proactive-context-builder");

function sourceContext() {
  return {
    event: {
      id: "event-1", eventType: "project.milestone_reached", reasonCode: "PROJECT_MILESTONE",
      subjectType: "project", subjectId: "project-1", payload: { content: "secret event body" },
      prompt: "secret prompt", stack: "secret stack", error: "internal"
    },
    state: {
      last_user_interaction_at: { timestamp: "2026-07-18T00:00:00.000Z" },
      current_focus_project: { id: "project-1", title: "Heartbeat", prompt: "hidden" },
      pending_follow_up: { dueAt: "2026-07-19T00:00:00.000Z", content: "private body" },
      preferred_interaction_style: "concise",
      mood: "happy", energy: 5, relationship_level: 9, token: "secret"
    },
    relationship: {
      interactionStyle: { value: "concise", source: "memory", content: "hidden" },
      proactiveContact: { enabled: true, quietHours: { start: "22:00", end: "08:00" }, token: "hidden" },
      familiarity: { level: 3 }, personality: "fictional", emotion: "attached"
    },
    memories: Array.from({ length: 8 }, (_, index) => ({
      id: `memory-${index + 1}`, type: "MEMORY", title: `Memory ${index + 1}`,
      importance: index % 5 + 1, content: `private ${index}`, summary: "hidden", embedding: [1, 2], metadata: { secret: true }
    }))
  };
}

test("build creates a fixed safe context without mutating input", () => {
  const builder = new ProactiveContextBuilder();
  const input = sourceContext();
  const before = structuredClone(input);
  const result = builder.build(input);

  assert.deepEqual(result.trigger, {
    eventId: "event-1", eventType: "project.milestone_reached", reasonCode: "PROJECT_MILESTONE",
    subjectType: "project", subjectId: "project-1"
  });
  assert.deepEqual(Object.keys(result.state).sort(), [
    "current_focus_project", "last_user_interaction_at", "pending_follow_up", "preferred_interaction_style"
  ]);
  assert.deepEqual(result.relationship.proactiveContact, { enabled: true });
  assert.deepEqual(result.relationship.quietHours, { start: "22:00", end: "08:00" });
  assert.deepEqual(result.constraints, { maxLength: 8000, channel: "proactive_contact" });
  assert.equal(result.memories.length, 5);
  assert.deepEqual(input, before);
  assert.doesNotMatch(JSON.stringify(result), /secret event|secret prompt|secret stack|private body|private \d|embedding|familiarity|personality|emotion|"mood"|"energy"/i);
  for (const memory of result.memories) assert.deepEqual(Object.keys(memory), ["id", "type", "title", "importance"]);
});

test("length limit removes lower-priority context deterministically", () => {
  const builder = new ProactiveContextBuilder({ maxContextSize: 420 });
  const input = sourceContext();
  input.memories.forEach((memory, index) => { memory.title = `${index}`.repeat(300); });
  input.state.current_focus_project = { name: "x".repeat(1000) };
  const first = builder.build(input);
  const second = builder.build(input);

  assert.ok(JSON.stringify(first).length <= 420);
  assert.deepEqual(first, second);
  assert.ok(first.memories.length < 5);
});

test("empty and invalid collections return a safe empty package without I/O", () => {
  const builder = new ProactiveContextBuilder();
  assert.deepEqual(builder.build(null), {
    trigger: { eventId: "", eventType: "", reasonCode: "" },
    state: {}, relationship: {}, memories: [],
    constraints: { maxLength: 8000, channel: "proactive_contact" }
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "proactive-context-builder.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\/(?:database|event-store|state-store|structured-memory-store|model-adapter)["']\)|fetch\(|Bark|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i);
});
