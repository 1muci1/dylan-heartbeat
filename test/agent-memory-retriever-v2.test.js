"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { detectMemoryIntent, extractMemoryKeywords, normalizeMemoryQuery } = require("../agent-memory-query");
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

test("detects memory overview intent without changing ordinary topic queries", () => {
  for (const query of [
    "你记得我吗",
    "沉沉现在记忆方面怎么样有细节了吗",
    "你现在能看到记忆了吗",
    "你还记得什么",
    "上一轮在讨论记忆是否可见\n现在能看到了吗"
  ]) {
    assert.equal(detectMemoryIntent(query), "overview", query);
  }
  assert.equal(detectMemoryIntent("你记得我的专业是什么吗"), "normal");
  assert.equal(detectMemoryIntent("今天继续修聊天页"), "normal");
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

test("overview mode selects representative memories across six groups within budget", () => {
  const memories = [
    memory("nickname", "relationship", "用户称呼", "用户希望被称为辞辞", 5),
    memory("relationship", "relationship", "AI Companion 的意义", "用户和沉的长期陪伴关系", 5),
    memory("academic", "fact", "学习专业与毕设", "数字媒体艺术专业，大四阶段正在准备毕设", 5),
    memory("project", "fact", "dylan-heartbeat 项目", "VPS Gateway、小窝、聊天页和议事厅的开发上下文", 5),
    memory("emotion", "preference", "互动语气偏好", "用户不喜欢冷淡说法，焦虑时希望得到具体回应", 5),
    memory("people", "fact", "闺蜜与社交习惯", "用户会和闺蜜分享日常，也重视家人边界", 4),
    memory("recent", "event", "近期状态变化", "这几天完成了一项重要调整", 5, "2026-07-29T12:00:00Z")
  ];
  const result = new AgentMemoryRetriever({ store: fixture(memories) }).retrieve({
    query: "你现在记忆方面怎么样",
    limit: 24,
    characterBudget: 5000
  });
  assert.equal(result.meta.memoryIntent, "overview");
  assert.deepEqual(result.meta.selectedGroups, [
    "identityRelationship",
    "academicLife",
    "projectTechnology",
    "emotionPreferences",
    "peopleDailyLife",
    "recentChanges"
  ]);
  for (const group of result.meta.selectedGroups) {
    assert.ok(result.meta.perGroupCount[group] >= 1, group);
    assert.ok(result.items.some(item => item.sourceGroup === group && item.content), group);
  }
  assert.ok(result.items.some(item => item.sourceGroup !== "identityRelationship"));
  assert.ok(result.items.some(item => item.id === "nickname"));
  assert.ok(result.meta.usedCharacters <= 5000);
  assert.ok(result.items.length <= 24);
});

test("overview mode truncates details instead of exceeding its character budget", () => {
  const memories = Array.from({ length: 30 }, (_, index) => memory(
    `memory-${index}`,
    index % 2 ? "preference" : "fact",
    index % 2 ? `偏好与情绪 ${index}` : `项目进展 ${index}`,
    "具体细节".repeat(600),
    5
  ));
  const result = new AgentMemoryRetriever({ store: fixture(memories) }).retrieve({
    query: "你记得哪些细节",
    limit: 24,
    characterBudget: 3000
  });
  assert.equal(result.meta.memoryIntent, "overview");
  assert.ok(result.meta.usedCharacters <= 3000);
  assert.ok(result.items.length <= 24);
});
