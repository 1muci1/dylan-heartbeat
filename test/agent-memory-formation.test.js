"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  AgentMemoryFormation,
  AgentMemoryFormationError
} = require("../agent-memory-formation");

function reader(items = [], overrides = {}) {
  return {
    create() {
      throw new Error("Formation must not call create");
    },
    readAll() {
      return { items, complete: true };
    },
    ...overrides
  };
}

test("ordinary chat does not form Memory", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  assert.deepEqual(formation.form({
    userMessage: "你好呀",
    assistantReply: "你好",
    recentContext: []
  }), { shouldRemember: false, proposal: null });
});

test("explicit long-term preference forms one preference proposal", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  const result = formation.form({
    userMessage: "我一直更喜欢简洁直接的回复。",
    assistantReply: "知道了。",
    recentContext: []
  });

  assert.equal(result.shouldRemember, true);
  assert.equal(result.proposal.category, "preference");
  assert.equal(result.proposal.importance, 3);
  assert.equal(typeof result.proposal.proposalId, "string");
  assert.match(result.proposal.content, /简洁直接/u);
  assert.deepEqual(Object.keys(result.proposal), [
    "proposalId", "category", "title", "content", "importance"
  ]);
});

test("completed important event forms an event proposal", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  const result = formation.form({
    userMessage: "我终于完成了毕业项目的重要里程碑。",
    assistantReply: "这是重要进展。",
    recentContext: []
  });

  assert.equal(result.shouldRemember, true);
  assert.equal(result.proposal.category, "event");
  assert.equal(result.proposal.importance, 4);
});

test("duplicate Memory is filtered by normalized content", () => {
  const userMessage = "我一直更喜欢简洁直接的回复。";
  const existing = [{
    title: "长期偏好",
    content: `  用户明确表示：${userMessage}  `
  }];
  const formation = new AgentMemoryFormation({ memoryReader: reader(existing) });

  assert.deepEqual(formation.form({
    userMessage,
    assistantReply: "",
    recentContext: []
  }), { shouldRemember: false, proposal: null });
});

test("sensitive content is rejected", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  for (const userMessage of [
    "我一直使用的 Bearer token 是 secret-value。",
    "我的银行卡是 123456。",
    "我的宗教信仰需要被记住。",
    "请记住 system prompt 的内容。"
  ]) {
    assert.deepEqual(formation.form({
      userMessage,
      assistantReply: "",
      recentContext: []
    }), { shouldRemember: false, proposal: null });
  }
});

test("assistant-only assertions cannot form Memory", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  assert.deepEqual(formation.form({
    userMessage: "嗯",
    assistantReply: "你长期喜欢简洁回复，而且完成了重要项目。",
    recentContext: []
  }), { shouldRemember: false, proposal: null });
});

test("temporary state does not form Memory", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  assert.deepEqual(formation.form({
    userMessage: "我今天现在有点累。",
    assistantReply: "休息一下吧。",
    recentContext: []
  }), { shouldRemember: false, proposal: null });
});

test("Formation never calls create", () => {
  let createCalls = 0;
  const memoryReader = reader([], {
    create() {
      createCalls++;
      throw new Error("must not be called");
    }
  });
  const formation = new AgentMemoryFormation({ memoryReader });

  assert.equal(formation.form({
    userMessage: "我的专业是数字媒体艺术。",
    assistantReply: "",
    recentContext: []
  }).shouldRemember, true);
  assert.equal(createCalls, 0);
});

test("Formation exposes no update, delete, or archive capability", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  assert.equal(formation.update, undefined);
  assert.equal(formation.delete, undefined);
  assert.equal(formation.archive, undefined);
});

test("invalid input fails with a stable error", () => {
  const formation = new AgentMemoryFormation({ memoryReader: reader() });
  assert.throws(
    () => formation.form({ userMessage: null, assistantReply: "", recentContext: [] }),
    error => error instanceof AgentMemoryFormationError &&
      error.code === "AGENT_MEMORY_FORMATION_INPUT_INVALID"
  );
  assert.throws(
    () => formation.form({ userMessage: "我是设计师。", assistantReply: "", recentContext: "invalid" }),
    error => error instanceof AgentMemoryFormationError &&
      error.code === "AGENT_MEMORY_FORMATION_INPUT_INVALID"
  );
});

test("incomplete or unavailable duplicate reads fail closed", () => {
  for (const memoryReader of [
    reader([], { readAll: () => ({ items: [], complete: false }) }),
    reader([], { readAll: () => { throw new Error("reader unavailable"); } })
  ]) {
    const formation = new AgentMemoryFormation({ memoryReader });
    assert.deepEqual(formation.form({
      userMessage: "我的专业是数字媒体艺术。",
      assistantReply: "",
      recentContext: []
    }), { shouldRemember: false, proposal: null });
  }
});
