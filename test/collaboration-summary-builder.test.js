"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { CollaborationSummaryBuilder } = require("../collaboration-summary-builder");

function room(messages = []) {
  return {
    id: "council-room-1",
    topic: "怎样建设议事厅",
    participants: ["chen", "chatgpt"],
    createdAt: "2026-07-24T21:00:00.000Z",
    messages,
    summary: null
  };
}

test("builds a structured Council record from a two-Agent discussion", () => {
  const record = new CollaborationSummaryBuilder().build(room([
    {
      agent: "chen",
      content: "建议先保留温柔的讨论体验。共识是所有状态变化都需要用户确认。"
    },
    {
      agent: "chatgpt",
      content: "下一步需要完成只读原型。推荐为结构化结果增加边界测试。"
    }
  ]));

  assert.equal(record.topic, "怎样建设议事厅");
  assert.deepEqual(record.participants, ["chen", "chatgpt"]);
  assert.equal(record.decisions.length, 1);
  assert.equal(record.suggestions.length, 2);
  assert.equal(record.actionItems.length, 1);
  assert.match(record.summary, /2 条有效发言/);
});

test("empty discussions return a safe, deterministic Council record", () => {
  const record = new CollaborationSummaryBuilder().build(room());

  assert.match(record.summary, /暂无可记录的讨论内容/);
  assert.deepEqual(record.decisions, []);
  assert.deepEqual(record.suggestions, []);
  assert.deepEqual(record.actionItems, []);
});

test("Memory and Identity Context markers are excluded from every output field", () => {
  const secret = "private-memory-value";
  const record = new CollaborationSummaryBuilder().build(room([
    {
      agent: "chen",
      content: `<memory_reference_data>${secret}，建议泄露</memory_reference_data>`
    },
    {
      agent: "chatgpt",
      content: "建议只保留公开的讨论观点。"
    },
    {
      agent: "chen",
      content: `<identity_reference_data>${secret}</identity_reference_data>`
    }
  ]));
  const serialized = JSON.stringify(record);

  assert.doesNotMatch(serialized, /private-memory-value|memory_reference_data|identity_reference_data/);
  assert.equal(record.suggestions.length, 1);
  assert.match(record.summary, /1 条有效发言/);
});

test("building a record does not modify Room or nested message data", () => {
  const source = room([
    { agent: "chen", content: "建议使用确定性规则。" },
    { agent: "chatgpt", content: "决定采纳这条建议。" }
  ]);
  const before = structuredClone(source);

  const record = new CollaborationSummaryBuilder().build(source);
  record.participants.push("changed");
  record.decisions[0].text = "changed";

  assert.deepEqual(source, before);
});

test("actionItems have an attributed, proposed-only record format", () => {
  const record = new CollaborationSummaryBuilder().build(room([
    { agent: "chen", content: "下一步需要完成移动端检查。" },
    { agent: "chatgpt", content: "Action item: implement the isolated test fixture." }
  ]));

  assert.equal(record.actionItems.length, 2);
  for (const item of record.actionItems) {
    assert.deepEqual(Object.keys(item), ["agent", "text", "status"]);
    assert.ok(["chen", "chatgpt"].includes(item.agent));
    assert.equal(typeof item.text, "string");
    assert.equal(item.text.length > 0, true);
    assert.equal(item.status, "proposed");
  }
});

test("Summary Builder has no model, Memory write, Identity, task, network, or database integration", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "collaboration-summary-builder.js"),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /ModelAdapter|MemoryWriter|StructuredMemoryStore|IdentityBoundary|TaskStore|EventStore|fetch\s*\(|database|migration/i
  );
  assert.doesNotMatch(source, /\.(?:create|update|delete|archive)\s*\(/);
});
