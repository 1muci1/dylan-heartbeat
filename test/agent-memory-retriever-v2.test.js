"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { extractMemoryKeywords, normalizeMemoryQuery } = require("../agent-memory-query");
const { AgentMemoryRetriever } = require("../agent-memory-retriever");

const memory = (id, category, title, content, importance = 3, updatedAt = "2026-07-01T00:00:00Z", extra = {}) => ({
  id,
  type: category === "event" ? "EVENT" : "MEMORY",
  title,
  content,
  importance,
  updatedAt,
  source: `memory-import:v1:${category}:test-${id}`,
  ...extra
});

const fixture = memories => ({
  list(query = {}) {
    const keyword = String(query.keyword || "").toLocaleLowerCase();
    const items = keyword
      ? memories.filter(item => `${item.title}\n${item.content}`.toLocaleLowerCase().includes(keyword))
      : memories;
    return { items, meta: { totalPages: items.length ? 1 : 0 } };
  }
});

const retrieve = (memories, query) => new AgentMemoryRetriever({ store: fixture(memories) })
  .retrieve({ query, limit: 8, characterBudget: 3000 });

test("normalizes user messages and extracts bounded meaningful Chinese keywords", () => {
  assert.equal(normalizeMemoryQuery("  我们什么时候认识？  "), "我们什么时候认识?");
  const meeting = extractMemoryKeywords("我们什么时候认识？");
  assert.deepEqual(meeting.keywords.slice(0, 3), ["相遇", "认识", "日期"]);
  assert.ok(meeting.keywords.length <= 6);
  assert.ok(!meeting.keywords.includes("什么"));
  assert.deepEqual(extractMemoryKeywords("").keywords, []);
});

test("什么时候认识 prioritizes the meeting Memory", () => {
  const result = retrieve([
    memory("noise", "event", "重要里程碑", "完成一个重要项目", 5),
    memory("meeting", "relationship", "相遇日期", "第一次认识的日期", 2),
    memory("fact", "fact", "普通事实", "其他事实", 4)
  ], "我们什么时候认识？");
  assert.equal(result.items[0].id, "meeting");
  assert.equal(result.meta.queryApplied, true);
  assert.ok(result.meta.relevantCount >= 1);
});

test("喜欢什么 prioritizes preference Memory", () => {
  const result = retrieve([
    memory("noise", "event", "高重要事件", "无关内容", 5),
    memory("preference", "preference", "饮食偏好", "用户喜欢清淡口味", 2),
    memory("relationship", "relationship", "相处约定", "保持尊重", 4)
  ], "我喜欢什么？");
  assert.equal(result.items[0].id, "preference");
  assert.equal(result.items[0].category, "preference");
});

test("unrelated high importance does not outrank an explicit keyword match", () => {
  const result = retrieve([
    memory("unrelated", "event", "最高优先事项", "完全无关", 5, "2026-07-27T00:00:00Z"),
    memory("matched", "fact", "猫咪", "用户喜欢猫咪", 1, "2026-01-01T00:00:00Z")
  ], "猫咪");
  assert.equal(result.items[0].id, "matched");
});

test("empty query preserves relationship and fact fallback", () => {
  const result = retrieve([
    memory("preference", "preference", "偏好", "偏好内容", 5),
    memory("relationship", "relationship", "关系", "关系内容", 1),
    memory("fact", "fact", "事实", "事实内容", 1)
  ], "");
  assert.deepEqual(result.items.slice(0, 2).map(item => item.category), ["relationship", "fact"]);
  assert.equal(result.meta.queryApplied, false);
});

test("identity, sensitive Memory, and non-whitelist fields are filtered", () => {
  const result = retrieve([
    memory("identity", "relationship", "Companion名称", "身份数据", 5),
    memory("sensitive", "fact", "Credential", "Bearer token secret", 5),
    memory("safe", "fact", "安全事实", "可以检索的内容", 3, undefined, {
      apiKey: "forbidden",
      sourceSessionId: "forbidden",
      deletedAt: "forbidden"
    })
  ], "可以检索");
  assert.deepEqual(result.items.map(item => item.id), ["safe"]);
  assert.equal(Object.hasOwn(result.items[0], "apiKey"), false);
  assert.equal(Object.hasOwn(result.items[0], "sourceSessionId"), false);
  assert.equal(Object.hasOwn(result.items[0], "deletedAt"), false);
});

test("short queries still inject stable core profile and relationship memories", () => {
  const result = retrieve([
    memory("major", "fact", "学习专业", "用户的长期学习专业", 5),
    memory("school", "fact", "学校阶段", "用户目前所处的学校阶段", 5),
    memory("relationship", "relationship", "AI Companion的意义", "长期关系设定", 5),
    memory("project", "relationship", "沉的小世界初衷", "持续陪伴项目背景", 5),
    memory("noise", "event", "普通事件", "无关事件", 5)
  ], "沉沉");
  assert.deepEqual(
    result.items.filter(item => item.layer === "core").map(item => item.id),
    ["major", "project", "relationship", "school"]
  );
  assert.equal(result.meta.selectedAlwaysOn, 4);
  assert.ok(result.meta.candidateCount >= 5);
});

test("query-aware results and recent important memories share the final bounded selection", () => {
  const memories = [
    memory("major", "fact", "学习专业", "用户专业信息", 5, "2026-01-01T00:00:00Z"),
    memory("cats", "preference", "猫咪偏好", "用户喜欢猫咪", 3, "2026-01-02T00:00:00Z"),
    memory("recent", "event", "近期变化", "最近的重要变化", 5, "2026-07-29T00:00:00Z")
  ];
  const result = new AgentMemoryRetriever({ store: fixture(memories) })
    .retrieve({ query: "猫咪", limit: 12, characterBudget: 1000 });
  assert.ok(result.items.some(item => item.id === "major" && item.layer === "core"));
  assert.ok(result.items.some(item => item.id === "cats" && item.layer === "relevant"));
  assert.ok(result.items.some(item => item.id === "recent"));
  assert.ok(result.items.length <= 12);
  assert.ok(result.meta.usedCharacters <= 1000);
});
